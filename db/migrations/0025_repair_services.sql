-- ============================================================================
-- 0025 — Mechanics & repair services
-- ============================================================================
--
-- Design: cybercache-prep/design-briefs/mechanics-and-repair.md, as
-- amended by Michael's repair rulings (2026-10-30) and the crafting
-- brief's F1/F2 flags. Single source of truth for the math:
-- src/content/repair.ts.
--
-- WHAT THIS MIGRATION DOES
--   1. Extends service_jobs with the repair board's honest state
--      (target/restored points, kit consumption, settlement stamps,
--      outcome + payout facts). The 0004 schema (service_jobs +
--      escrow_records) is reused; the dormant 0004 FLOW is not —
--      its functions are dropped at the end of this file.
--   2. The board flow (cc_post_repair_job → cc_accept_repair_job →
--      cc_settle_repair_job → cc_repair_finalize_job): the owner
--      posts at a SET PRICE and escrows the full price up front
--      into escrow_records; any verified mechanic accepts (open
--      market only — no private hires, no quotes); the mechanic
--      supplies the patch kits, burned FIFO at work time; work
--      accrues only while the job is the mechanic's active action
--      (workshop_service targeting the job), settled from server
--      timestamps with crafting's attended/away split; every
--      terminal state pays PRO-RATA for the points actually
--      restored, minus the shared market fee (migration 0017's law
--      extended to player-to-player services; the mechanic's
--      Darknet Broker reduction applies exactly as on a market
--      sale, Market Manipulator's found-item reduction does not —
--      no item changes hands), destroys the fee, and refunds the
--      remainder. There is NO NPC mechanic (goods have an NPC
--      baseline; services never do — worst case you walk).
--   3. Self-repair becomes a TIMED job on the craft machinery
--      (craft_jobs kind 'repair', F2's resolution): kits escrow at
--      enqueue and apply while workshop_service is the active
--      action. cc_use_patch_kit's instant restore is retired —
--      both overloads are dropped at the end of this file.
--   4. Restates cc_complete_craft_unit / cc_settle_craft_jobs /
--      cc_cancel_craft_job for the repair lane, and
--      cc_set_active_action / cc_clear_active_action with the
--      repair settler hook (extracted verbatim from 0024; only the
--      marked lines differ).
--   5. Repair levers resolve live through cc_economy_config_number
--      (repairWorkRateBase, repairMasterySpeedPerLevel,
--      repairMasteryEfficiencyPerLevel, serviceXpPerPoint,
--      repairAbandonWindowHours, repairListingExpiryDays), each
--      clamped inline to its registry range exactly like the craft
--      levers; the registry itself lives in
--      src/server/economy/config.ts.
--   6. Economy metrics gain a repair panel (restated
--      cc_compute_economy_metrics); repair fees destroyed join the
--      destroyed total.
--
-- XP LAW (§2.7): a mechanic earns serviceXpPerPoint (default 2)
-- player XP per condition point ACTUALLY restored, plus one
-- services.repair mastery XP per point, once, at terminal
-- settlement. Self-repair pays no player XP; it trains the same
-- mastery by its restored points. The dormant trigger branches for
-- the old service ops become unreachable when those functions are
-- dropped below — mastery for repair is granted directly inside
-- the completion/finalize functions, the post-0014 pattern.

-- ---------------------------------------------------------------------------
-- Schema: service_jobs repair state + economy_metrics repair panel
-- ---------------------------------------------------------------------------

alter table public.service_jobs
  add column if not exists target_points integer,
  add column if not exists points_restored numeric not null default 0,
  add column if not exists work_points_banked numeric not null default 0,
  add column if not exists open_kit_capacity numeric not null default 0,
  add column if not exists open_kit_total numeric not null default 0,
  add column if not exists open_kit_quality numeric,
  add column if not exists accrued_work_ms bigint not null default 0,
  add column if not exists last_settled_at timestamptz,
  add column if not exists last_progress_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists outcome text,
  add column if not exists paid_credits bigint,
  add column if not exists fee_credits bigint,
  add column if not exists xp_awarded bigint,
  add column if not exists kit_type text,
  add column if not exists kits_consumed jsonb not null default '[]'::jsonb,
  add column if not exists repair_snapshot jsonb;

create index if not exists service_jobs_repair_board_idx
  on public.service_jobs (profession_id, status, expires_at);

alter table public.economy_metrics
  add column if not exists repair_jobs_posted bigint not null default 0,
  add column if not exists repair_jobs_completed integer not null default 0,
  add column if not exists repair_points_restored numeric not null default 0,
  add column if not exists repair_credits_volume bigint not null default 0,
  add column if not exists repair_fees_destroyed bigint not null default 0,
  add column if not exists repair_kits_consumed integer not null default 0,
  add column if not exists repair_xp_awarded bigint not null default 0;

-- ---------------------------------------------------------------------------
-- Terminal settlement (internal): pro-rata pay, shared fee, refund,
-- vehicle release, XP + mastery by points actually restored.
-- ---------------------------------------------------------------------------

create or replace function public.cc_repair_finalize_job(p_job_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.service_jobs%rowtype;
  provider public.profiles%rowtype;
  v_price bigint;
  v_restored numeric;
  v_target integer;
  v_payout bigint := 0;
  v_fee_rate numeric := least(1, greatest(0,
    public.cc_economy_config_number('marketFeeRate', 0.05)));
  v_xp_per_point numeric := least(10, greatest(0,
    public.cc_economy_config_number('serviceXpPerPoint', 2)));
  mod_payload jsonb;
  darknet_pts numeric := 0;
  v_fee_reduction numeric := 0;
  v_fee bigint := 0;
  v_xp bigint := 0;
  v_next jsonb;
begin
  select * into job from public.service_jobs where id = p_job_id for update;
  if not found then raise exception 'Repair job not found'; end if;
  if job.status in ('completed', 'cancelled') then
    return jsonb_build_object('job_id', job.id, 'outcome', job.outcome,
      'already_terminal', true);
  end if;

  v_price := coalesce(job.quoted_price_credits, 0);
  v_restored := coalesce(job.points_restored, 0);
  v_target := coalesce(job.target_points, 0);
  -- Price is per-point under the hood: full completion pays in
  -- full; anything else pays floor(price x restored / target).
  if p_outcome = 'completed' then
    v_payout := v_price;
  elsif v_target > 0 and v_restored > 0 then
    v_payout := floor(v_price * v_restored / v_target)::bigint;
  end if;

  if job.provider_user_id is not null then
    select * into provider from public.profiles where id = job.provider_user_id for update;
    if found and v_payout > 0 then
      -- The ONE player-to-player fee rule: the shared market fee,
      -- with the mechanic's Darknet Broker derivation mirrored from
      -- cc_accept_listing (0017) — skill_spends + equipped class mod.
      select payload into mod_payload from public.item_instances
       where owner_user_id = provider.id and runtime_state = 'equipped'
         and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((provider.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
      end if;
      v_fee_reduction := least(1::numeric, greatest(0::numeric, 0.05 * darknet_pts));
      v_fee := floor(v_payout * v_fee_rate * (1 - v_fee_reduction))::bigint;
      update public.profiles
         set credits = credits + (v_payout - v_fee), updated_at = now()
       where id = provider.id;
    end if;
    if found and v_restored > 0 then
      v_xp := round(v_xp_per_point * v_restored)::bigint;
      if v_xp > 0 then
        v_next := public.cc_apply_xp(provider.player_level, provider.player_xp, v_xp);
        update public.profiles
           set player_level = (v_next ->> 'player_level')::integer,
               player_xp = (v_next ->> 'player_xp')::bigint,
               updated_at = now()
         where id = provider.id;
      end if;
      perform public.cc_add_mastery_xp(provider.id, 'services.repair', ceil(v_restored)::integer);
      if p_outcome = 'completed' then
        perform public.cc_add_stat(provider.id, 'services.completed', 1);
      end if;
    end if;
    -- Abandonment is a conduct record, not work: it lands even when
    -- zero points were restored (the usual case).
    if found and p_outcome = 'abandoned' then
      perform public.cc_add_stat(provider.id, 'services.abandoned', 1);
    end if;
  end if;

  -- The unspent escrow returns to the owner; the fee is destroyed
  -- (credited to nobody), exactly like a market fee.
  if v_price - v_payout > 0 then
    update public.profiles
       set credits = credits + (v_price - v_payout), updated_at = now()
     where id = job.owner_user_id;
  end if;
  if job.escrow_id is not null then
    update public.escrow_records
       set status = case when v_payout > 0 then 'released' else 'refunded' end,
           released_at = now()
     where id = job.escrow_id;
  end if;
  -- The vehicle is never hostage: every terminal state releases it.
  update public.item_instances
     set runtime_state = 'available', is_locked = false, updated_at = now()
   where id = job.target_item_instance_id;
  update public.service_jobs
     set status = case when p_outcome in ('completed', 'delivered_partial')
                     then 'completed' else 'cancelled' end,
         outcome = p_outcome,
         paid_credits = v_payout,
         fee_credits = v_fee,
         xp_awarded = v_xp,
         completed_at = now()
   where id = job.id;

  return jsonb_build_object('job_id', job.id, 'outcome', p_outcome,
    'paid_credits', v_payout, 'fee_credits', v_fee, 'xp_awarded', v_xp,
    'points_restored', v_restored);
end;
$$;

-- ---------------------------------------------------------------------------
-- The board settler (internal): advance one active job from server
-- timestamps. Progress accrues ONLY while the provider's recorded
-- active action is workshop_service targeting this job; every call
-- rebases last_settled_at. Attended/away split mirrors the craft
-- settler (heartbeat + 5 min grace; away tail capped by the
-- provider's internal effective offline cap).
-- ---------------------------------------------------------------------------

create or replace function public.cc_settle_repair_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.service_jobs%rowtype;
  provider public.profiles%rowtype;
  item public.item_instances%rowtype;
  v_now timestamptz := now();
  v_now_ms bigint := (extract(epoch from v_now) * 1000)::bigint;
  v_last_ms bigint;
  v_raw bigint;
  v_action text;
  v_target_id text;
  v_heartbeat_ms bigint;
  v_attended bigint;
  v_away_cap_ms bigint;
  v_advance bigint;
  v_work numeric;
  v_applied numeric;
  v_capacity numeric;
  v_burn jsonb;
  v_entry jsonb;
  v_quality numeric;
  v_kit_base numeric;
  v_restored numeric;
  v_idx integer;
begin
  select * into job from public.service_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('settled', false, 'reason', 'not_found'); end if;
  if job.status <> 'active' or job.provider_user_id is null then
    return jsonb_build_object('settled', false, 'reason', 'not_active');
  end if;

  v_last_ms := (extract(epoch from coalesce(job.last_settled_at, job.accepted_at, v_now)) * 1000)::bigint;
  update public.service_jobs set last_settled_at = v_now where id = job.id;
  v_raw := greatest(0, v_now_ms - v_last_ms);
  if v_raw <= 0 then return jsonb_build_object('settled', true, 'advanced_ms', 0); end if;

  select * into provider from public.profiles where id = job.provider_user_id;
  if not found then return jsonb_build_object('settled', false, 'reason', 'no_provider'); end if;
  select active_action, target_id, (extract(epoch from last_heartbeat_at) * 1000)::bigint
    into v_action, v_target_id, v_heartbeat_ms
    from public.active_actions where user_id = provider.id;
  if v_action is distinct from 'workshop_service' or v_target_id is distinct from job.id::text then
    return jsonb_build_object('settled', true, 'advanced_ms', 0);
  end if;

  v_attended := least(v_raw, greatest(0,
    coalesce(v_heartbeat_ms, v_last_ms) + 300000 - v_last_ms));
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours(provider.player_level),
      coalesce(nullif(provider.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours(provider.player_level))
    )) * 3600000)::bigint;
  v_advance := v_attended + least(v_raw - v_attended, v_away_cap_ms);
  if v_advance <= 0 then return jsonb_build_object('settled', true, 'advanced_ms', 0); end if;

  select * into item from public.item_instances where id = job.target_item_instance_id for update;
  v_kit_base := case job.kit_type
    when 'PatchKit' then 30 when 'FieldPatchKit' then 45
    when 'MasterPatchKit' then 80 else 0 end;
  v_work := coalesce(job.work_points_banked, 0)
    + (v_advance::numeric / 3600000)
      * coalesce((job.repair_snapshot ->> 'workRatePointsPerHour')::numeric, 20);
  v_restored := coalesce(job.points_restored, 0);
  v_capacity := coalesce(job.open_kit_capacity, 0);

  while v_work > 0.000001 and v_restored < coalesce(job.target_points, 0) - 0.0001 loop
    if v_capacity <= 0.000001 then
      -- Open the mechanic's next kit: FIFO, worst quality first.
      -- Legacy counts without batch rows backfill first, the
      -- cc_consume_consumable guard.
      if not exists (select 1 from public.consumable_batches
                      where owner_user_id = provider.id
                        and consumable_type = job.kit_type and quantity > 0) then
        if coalesce((provider.consumables ->> job.kit_type)::integer, 0) > 0 then
          perform public.cc_add_consumable_batch(provider.id, job.kit_type,
            (provider.consumables ->> job.kit_type)::integer, 100, 'vendor',
            null, null, 'admin_adjust',
            'Backfilled legacy count into 100% batch before consumption',
            '{}'::jsonb);
        else
          exit; -- Out of kits: work stalls, banked points are kept.
        end if;
      end if;
      v_burn := public.cc_consume_consumable_batch(
        provider.id, job.kit_type, 1, 'workshop_service', 'repair_job', '{}'::jsonb);
      update public.profiles
         set consumables = public.cc_jsonb_add_int(consumables, job.kit_type, -1),
             updated_at = now()
       where id = provider.id
       returning * into provider;
      v_entry := v_burn -> 'consumed' -> 0;
      v_quality := coalesce((v_entry ->> 'quality_percent')::numeric, 100);
      v_capacity := round(v_kit_base * v_quality / 100
        * coalesce((job.repair_snapshot ->> 'efficiency')::numeric, 1), 2);
      job.open_kit_total := v_capacity;
      job.open_kit_quality := v_quality;
      job.kits_consumed := coalesce(job.kits_consumed, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('kitType', job.kit_type, 'quality', v_quality,
          'pointsApplied', 0));
    end if;
    v_applied := least(v_work, v_capacity,
      coalesce(job.target_points, 0) - v_restored,
      greatest(0, coalesce(item.condition_max, 100)
        - coalesce(item.condition_current, item.condition_max, 100)));
    exit when v_applied <= 0.000001;
    v_work := v_work - v_applied;
    v_capacity := v_capacity - v_applied;
    v_restored := round(v_restored + v_applied, 4);
    update public.item_instances
       set condition_current = least(coalesce(condition_max, 100),
             coalesce(condition_current, condition_max, 100) + v_applied),
           updated_at = now()
     where id = item.id
     returning * into item;
    v_idx := jsonb_array_length(job.kits_consumed) - 1;
    job.kits_consumed := jsonb_set(job.kits_consumed,
      array[v_idx::text, 'pointsApplied'],
      to_jsonb(round(coalesce(
        (job.kits_consumed -> v_idx ->> 'pointsApplied')::numeric, 0) + v_applied, 4)), true);
    job.last_progress_at := v_now;
  end loop;

  update public.service_jobs
     set accrued_work_ms = coalesce(accrued_work_ms, 0) + v_advance,
         work_points_banked = v_work,
         points_restored = v_restored,
         open_kit_capacity = v_capacity,
         open_kit_total = job.open_kit_total,
         open_kit_quality = job.open_kit_quality,
         kits_consumed = job.kits_consumed,
         last_progress_at = job.last_progress_at
   where id = job.id;

  if v_restored >= coalesce(job.target_points, 0) - 0.0001
     or coalesce(item.condition_current, 0) >= coalesce(item.condition_max, 100) - 0.0001 then
    perform public.cc_repair_finalize_job(job.id, 'completed');
  end if;
  return jsonb_build_object('settled', true, 'advanced_ms', v_advance,
    'points_restored', v_restored);
end;
$$;

-- Settle (and expire) every repair job one player owns or provides.
-- Called by the board read, every repair op, and the activity
-- transitions (the 0025 hook in cc_set/clear_active_action).
create or replace function public.cc_settle_repair_jobs_for(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  v_job record;
  v_settled integer := 0;
  v_expired integer := 0;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  for v_job in
    select id, status, expires_at from public.service_jobs
     where profession_id = 'repair'
       and (owner_user_id = actor or provider_user_id = actor)
       and status in ('listed', 'active')
     order by created_at asc
  loop
    if v_job.status = 'listed' and v_job.expires_at is not null
       and v_job.expires_at <= now() then
      perform public.cc_repair_finalize_job(v_job.id, 'expired');
      v_expired := v_expired + 1;
    elsif v_job.status = 'active' then
      perform public.cc_settle_repair_job(v_job.id);
      v_settled := v_settled + 1;
    end if;
  end loop;
  return jsonb_build_object('settled_jobs', v_settled, 'expired_jobs', v_expired);
end;
$$;

-- ---------------------------------------------------------------------------
-- Board ops (§2.4 as ruled): post → accept → finish / cancel / reclaim
-- ---------------------------------------------------------------------------

-- Post: verified accounts only; the FULL price escrows from the
-- owner's verified balance at posting, terms fixed at posting; the
-- vehicle unequips if needed and locks in service until a terminal
-- state releases it.
create or replace function public.cc_post_repair_job(
  p_player_id uuid, nonce text, item_id uuid,
  p_target_points integer default null, price_credits bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  job public.service_jobs%rowtype;
  v_escrow_id uuid;
  v_max numeric;
  v_current numeric;
  v_deficit integer;
  v_target integer;
  v_price bigint := floor(coalesce(price_credits, 0))::bigint;
  v_expiry_days numeric := least(30, greatest(1,
    public.cc_economy_config_number('repairListingExpiryDays', 7)));
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  perform public.cc_settle_repair_jobs_for(actor);
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.kind <> 'vehicle' then raise exception 'Item is not a vehicle'; end if;
  if item.runtime_state in ('listed', 'consumed', 'salvaged', 'in_service') then
    raise exception 'Item state invalid';
  end if;
  v_max := coalesce(item.condition_max, 100);
  v_current := coalesce(item.condition_current, v_max);
  if v_current >= v_max then raise exception 'Vehicle is already at full condition'; end if;
  v_deficit := ceil(v_max - v_current)::integer;
  v_target := v_deficit;
  if p_target_points is not null then
    if p_target_points < 1 then raise exception 'Target points must be positive'; end if;
    v_target := least(p_target_points, v_deficit);
  end if;
  if v_price < 1 then raise exception 'Invalid price'; end if;
  if p.credits < v_price then raise exception 'Insufficient credits'; end if;

  update public.profiles set credits = credits - v_price, updated_at = now()
   where id = actor returning * into p;
  insert into public.escrow_records(
    payer_user_id, payee_user_id, credit_amount, status, locked_item_instance_ids)
  values (actor, null, v_price, 'reserved', array[item.id])
  returning id into v_escrow_id;
  insert into public.service_jobs(
    owner_user_id, provider_user_id, profession_id, status,
    target_item_instance_id, requested_service_id, quoted_price_credits,
    quoted_duration_minutes, escrow_id, target_points, expires_at)
  values (actor, null, 'repair', 'listed', item.id, 'repair', v_price,
    null, v_escrow_id, v_target, now() + (v_expiry_days || ' days')::interval)
  returning * into job;
  update public.item_instances
     set runtime_state = 'in_service', is_locked = true, equipped_slot = null,
         updated_at = now()
   where id = item.id returning * into item;

  result := jsonb_build_object('action_type', 'cc_post_repair_job',
    'profile', public.cc_profile_snapshot(p),
    'job', to_jsonb(job), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_post_repair_job', nonce, result);
  return result;
end;
$$;

-- Accept: any verified mechanic who is not the owner; the
-- mechanic's mastery snapshot prices rate + efficiency; the kit
-- type is chosen now and supplied by the mechanic at work time.
create or replace function public.cc_accept_repair_job(
  p_player_id uuid, nonce text, job_id uuid, p_kit_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  job public.service_jobs%rowtype;
  v_mastery integer;
  v_base numeric := least(200, greatest(1,
    public.cc_economy_config_number('repairWorkRateBase', 20)));
  v_speed numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasterySpeedPerLevel', 0.02)));
  v_eff numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasteryEfficiencyPerLevel', 0.02)));
  v_rate numeric;
  v_efficiency numeric;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into job from public.service_jobs where id = job_id for update;
  if not found or job.profession_id <> 'repair' then raise exception 'Repair job not found'; end if;
  if job.status = 'listed' and job.expires_at is not null and job.expires_at <= now() then
    perform public.cc_repair_finalize_job(job.id, 'expired');
    raise exception 'Listing has expired';
  end if;
  if job.status <> 'listed' then raise exception 'Service job not available'; end if;
  if job.owner_user_id = actor then raise exception 'Cannot accept own job'; end if;
  if p_kit_type not in ('PatchKit', 'FieldPatchKit', 'MasterPatchKit') then
    raise exception 'Unknown patch kit type';
  end if;
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if coalesce((p.consumables ->> p_kit_type)::integer, 0) < 1 then
    raise exception 'No % available', p_kit_type;
  end if;

  v_mastery := public.cc_player_mastery_level(actor, 'services.repair');
  v_rate := v_base * least(2.0, 1 + v_speed * greatest(0, v_mastery - 1));
  v_efficiency := least(1.5, 1 + v_eff * greatest(0, v_mastery - 1));
  update public.service_jobs
     set provider_user_id = actor, status = 'active', kit_type = p_kit_type,
         repair_snapshot = jsonb_build_object(
           'masteryLevel', v_mastery,
           'workRatePointsPerHour', v_rate,
           'efficiency', v_efficiency),
         accepted_at = now(), last_settled_at = now(), last_progress_at = now()
   where id = job.id returning * into job;
  update public.escrow_records set payee_user_id = actor
   where id = job.escrow_id;

  result := jsonb_build_object('action_type', 'cc_accept_repair_job',
    'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_accept_repair_job', nonce, result);
  return result;
end;
$$;

-- Finish (deliver): the provider settles the job and hands it back
-- as-is — full price at target, pro-rata below it, nothing at zero.
create or replace function public.cc_repair_job_finish(
  p_player_id uuid, nonce text, job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  job public.service_jobs%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into job from public.service_jobs where id = job_id for update;
  if not found or job.profession_id <> 'repair' or job.provider_user_id is distinct from actor then
    raise exception 'Job not found';
  end if;
  if job.status <> 'active' then raise exception 'Job is not active'; end if;
  perform public.cc_settle_repair_job(job.id);
  select * into job from public.service_jobs where id = job_id;
  if job.status = 'active' then
    perform public.cc_repair_finalize_job(job.id,
      case when coalesce(job.points_restored, 0) > 0
        then 'delivered_partial' else 'cancelled_by_provider' end);
    select * into job from public.service_jobs where id = job_id;
  end if;
  select * into p from public.profiles where id = actor;
  result := jsonb_build_object('action_type', 'cc_repair_job_finish',
    'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_repair_job_finish', nonce, result);
  return result;
end;
$$;

-- Cancel: pre-acceptance the owner withdraws for a full refund;
-- mid-job either side ends it — points restored so far are paid
-- pro-rata, the remainder refunds (the §2.4 cancellation table).
create or replace function public.cc_repair_job_cancel(
  p_player_id uuid, nonce text, job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  job public.service_jobs%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into job from public.service_jobs where id = job_id for update;
  if not found or job.profession_id <> 'repair'
     or (job.owner_user_id <> actor and job.provider_user_id is distinct from actor) then
    raise exception 'Job not found';
  end if;
  if job.status = 'listed' then
    if job.owner_user_id <> actor then raise exception 'Job not found'; end if;
    perform public.cc_repair_finalize_job(job.id, 'cancelled_by_owner');
  elsif job.status = 'active' then
    perform public.cc_settle_repair_job(job.id);
    select * into job from public.service_jobs where id = job_id;
    if job.status = 'active' then
      perform public.cc_repair_finalize_job(job.id,
        case when job.owner_user_id = actor
          then 'cancelled_by_owner' else 'cancelled_by_provider' end);
    end if;
    select * into job from public.service_jobs where id = job_id;
  else
    raise exception 'Job is not active';
  end if;
  select * into p from public.profiles where id = actor;
  result := jsonb_build_object('action_type', 'cc_repair_job_cancel',
    'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_repair_job_cancel', nonce, result);
  return result;
end;
$$;

-- Reclaim: after the abandonment window without progress, the
-- owner takes the vehicle back. Points already restored are still
-- paid pro-rata (work done is work paid); the unspent escrow
-- refunds and the abandonment lands on the provider's record.
create or replace function public.cc_repair_job_reclaim(
  p_player_id uuid, nonce text, job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  job public.service_jobs%rowtype;
  v_window_hours numeric := least(720, greatest(1,
    public.cc_economy_config_number('repairAbandonWindowHours', 48)));
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into job from public.service_jobs where id = job_id for update;
  if not found or job.profession_id <> 'repair' or job.owner_user_id <> actor then
    raise exception 'Job not found';
  end if;
  if job.status <> 'active' then raise exception 'Job is not active'; end if;
  perform public.cc_settle_repair_job(job.id);
  select * into job from public.service_jobs where id = job_id;
  if job.status <> 'active' then raise exception 'Job already completed'; end if;
  if job.last_progress_at is not null
     and job.last_progress_at > now() - (v_window_hours || ' hours')::interval then
    raise exception 'Mechanic is still within the abandonment window';
  end if;
  perform public.cc_repair_finalize_job(job.id, 'abandoned');
  select * into job from public.service_jobs where id = job_id;
  select * into p from public.profiles where id = actor;
  result := jsonb_build_object('action_type', 'cc_repair_job_reclaim',
    'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_repair_job_reclaim', nonce, result);
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Self-repair enqueue (F2): a timed craft_jobs row of kind 'repair'.
-- The owner's kits escrow at enqueue (FIFO burn, per-unit quality /
-- origin recorded in the snapshot); units apply while
-- workshop_service is the active action (the restated settler).
-- No verified-account gate — consumption, like refuelling.
-- ---------------------------------------------------------------------------

create or replace function public.cc_enqueue_repair_job(
  p_player_id uuid, nonce text, item_id uuid, p_kit_type text, p_units integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  v_job public.craft_jobs%rowtype;
  v_units integer := coalesce(p_units, 0);
  v_kit_base numeric;
  v_recipe text;
  v_count integer;
  v_burn jsonb;
  v_entry jsonb;
  v_batch record;
  v_i integer;
  v_qualities jsonb := '[]'::jsonb;
  v_origins jsonb := '[]'::jsonb;
  v_mastery integer;
  v_base numeric := least(200, greatest(1,
    public.cc_economy_config_number('repairWorkRateBase', 20)));
  v_speed numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasterySpeedPerLevel', 0.02)));
  v_eff numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasteryEfficiencyPerLevel', 0.02)));
  v_rate numeric;
  v_efficiency numeric;
  v_duration bigint;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  perform public.cc_settle_craft_jobs(actor);
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  v_kit_base := case p_kit_type
    when 'PatchKit' then 30 when 'FieldPatchKit' then 45
    when 'MasterPatchKit' then 80 else null end;
  v_recipe := case p_kit_type
    when 'PatchKit' then 'repair_patch_kit'
    when 'FieldPatchKit' then 'repair_field_patch_kit'
    when 'MasterPatchKit' then 'repair_master_patch_kit' else null end;
  if v_kit_base is null then raise exception 'Unknown patch kit type'; end if;
  if v_units < 1 then raise exception 'units must be a positive integer'; end if;
  if v_units > 500 then raise exception 'units exceeds the per-job maximum of 500'; end if;

  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Vehicle not found'; end if;
  if item.kind <> 'vehicle' then raise exception 'Only vehicles can be repaired'; end if;
  if item.runtime_state in ('listed', 'consumed', 'salvaged', 'in_service') then
    raise exception 'Vehicle is not available for repair';
  end if;
  if coalesce(item.condition_current, item.condition_max, 100)
     >= coalesce(item.condition_max, 100) then
    raise exception 'Vehicle is already at full condition';
  end if;
  if exists (select 1 from public.craft_jobs
              where owner_user_id = actor and kind = 'repair' and status = 'active'
                and snapshot -> 'repair' ->> 'itemId' = item.id::text) then
    raise exception 'A repair job is already running for this vehicle';
  end if;
  select count(*) into v_count from public.craft_jobs
   where owner_user_id = actor and kind = 'repair' and status = 'active';
  if v_count >= 3 then raise exception 'Too many repair jobs already running'; end if;
  if coalesce((p.consumables ->> p_kit_type)::integer, 0) < v_units then
    raise exception 'Not enough % in inventory', p_kit_type;
  end if;

  -- Escrow the kits: burn FIFO and record each unit's quality and
  -- origin, so completion prices the ACTUAL kit and refunds return
  -- the exact batches. Legacy counts backfill first (the
  -- cc_consume_consumable guard).
  if not exists (select 1 from public.consumable_batches
                  where owner_user_id = actor and consumable_type = p_kit_type
                    and quantity > 0) then
    perform public.cc_add_consumable_batch(actor, p_kit_type,
      (p.consumables ->> p_kit_type)::integer, 100, 'vendor', null, null,
      'admin_adjust', 'Backfilled legacy count into 100% batch before consumption',
      '{}'::jsonb);
  end if;
  v_burn := public.cc_consume_consumable_batch(
    actor, p_kit_type, v_units, 'workshop_service', 'repair_self', '{}'::jsonb);
  for v_entry in select * from jsonb_array_elements(v_burn -> 'consumed') loop
    select origin into v_batch from public.consumable_batches
     where id = (v_entry ->> 'batch_id')::uuid;
    for v_i in 1 .. (v_entry ->> 'quantity')::integer loop
      v_qualities := v_qualities || jsonb_build_array((v_entry ->> 'quality_percent')::numeric);
      v_origins := v_origins || jsonb_build_array(coalesce(v_batch.origin, 'vendor'));
    end loop;
  end loop;
  update public.profiles
     set consumables = public.cc_jsonb_add_int(consumables, p_kit_type, -v_units),
         updated_at = now()
   where id = actor returning * into p;

  v_mastery := public.cc_player_mastery_level(actor, 'services.repair');
  v_rate := v_base * least(2.0, 1 + v_speed * greatest(0, v_mastery - 1));
  v_efficiency := least(1.5, 1 + v_eff * greatest(0, v_mastery - 1));
  v_duration := greatest(1, ceil(v_kit_base / v_rate * 3600000))::bigint;

  insert into public.craft_jobs(
    owner_user_id, bench, kind, recipe_id, units_total, unit_duration_ms,
    escrow_inputs, escrow_catalyst, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (actor, 0, 'repair', v_recipe, v_units, v_duration,
    '{}'::jsonb, '{}'::jsonb, null, null,
    jsonb_build_object(
      'toolId', null, 'toolQualityMultiplier', 1, 'toolDurationMultiplier', 1,
      'toolRefineYieldBonus', 0, 'toolBonusUnitChance', 0,
      'skillDurationMultiplier', 1, 'rushReduction', 0, 'craftTimeScalar', 1,
      'catalystMaterialId', null, 'gearRarity', null,
      'repair', jsonb_build_object(
        'itemId', item.id, 'kitType', p_kit_type, 'kitBase', v_kit_base,
        'kitQualities', v_qualities, 'kitOrigins', v_origins,
        'efficiency', v_efficiency, 'workRatePointsPerHour', v_rate,
        'masteryLevel', v_mastery)))
  returning * into v_job;

  result := jsonb_build_object('action_type', 'cc_enqueue_repair_job',
    'profile', public.cc_profile_snapshot(p),
    'job', public.cc_craft_job_json(v_job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enqueue_repair_job', nonce, result);
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Restated craft functions (0024 bodies, repair lane added)
-- ---------------------------------------------------------------------------

create or replace function public.cc_complete_craft_unit(
  p_job_id uuid,
  p_xp_rate numeric,
  p_quality_shift numeric,
  p_temper_base numeric,
  p_refine_base numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  job public.craft_jobs%rowtype;
  p public.profiles%rowtype;
  recipe jsonb;
  v_xp bigint;
  v_output jsonb;
  v_next jsonb;
  v_mastery_track text;
  v_mastery_xp integer;
  -- consumable completion
  v_type text;
  v_ml integer;
  v_bounds jsonb;
  v_roll numeric;
  v_qty integer;
  v_bonus boolean;
  -- refine completion
  v_yield numeric;
  v_count integer;
  -- gear completion
  v_tempered boolean;
  -- repair completion (0025)
  v_item public.item_instances%rowtype;
  v_kit_base numeric;
  v_quality numeric;
  v_before numeric;
  v_restore numeric;
  v_restored numeric;
begin
  select * into job from public.craft_jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  actor := job.owner_user_id;
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if job.kind = 'repair' then
    -- Self-repair unit (0025): apply the next escrowed patch kit.
    -- Restoration = kit base x kit quality% x the owner's repair
    -- efficiency snapshot, clamped at the vehicle's max; the kit is
    -- spent even when the clamp wastes part of it. No player XP
    -- (consumption); repair mastery trains by points restored.
    v_output := jsonb_build_object(
      'unit', job.units_completed + 1,
      'kind', 'repair',
      'xp', 0,
      'completedAtMs', (extract(epoch from now()) * 1000)::bigint
    );
    select * into v_item from public.item_instances
     where id = (job.snapshot -> 'repair' ->> 'itemId')::uuid
       and owner_user_id = actor;
    if not found or v_item.kind <> 'vehicle'
       or v_item.runtime_state in ('listed', 'consumed', 'salvaged', 'in_service')
       or coalesce(v_item.condition_current, v_item.condition_max, 100)
          >= coalesce(v_item.condition_max, 100) then
      -- The unit never starts: the settler ends the job here and
      -- refunds this and every later kit at its recorded quality.
      return v_output || jsonb_build_object('vehicleFull', true);
    end if;
    v_kit_base := case job.snapshot -> 'repair' ->> 'kitType'
      when 'PatchKit' then 30 when 'FieldPatchKit' then 45
      when 'MasterPatchKit' then 80 else 0 end;
    v_quality := coalesce(
      (job.snapshot -> 'repair' -> 'kitQualities' ->> job.units_completed)::numeric, 100);
    v_before := coalesce(v_item.condition_current, v_item.condition_max, 100);
    v_restore := round(v_kit_base * v_quality / 100
      * coalesce((job.snapshot -> 'repair' ->> 'efficiency')::numeric, 1), 2);
    update public.item_instances
       set condition_current = least(coalesce(condition_max, 100), v_before + v_restore),
           updated_at = now()
     where id = v_item.id
     returning condition_current into v_item.condition_current;
    v_restored := round(v_item.condition_current - v_before, 2);
    if v_restored > 0 then
      perform public.cc_add_mastery_xp(actor, 'services.repair', ceil(v_restored)::integer);
    end if;
    v_output := v_output || jsonb_build_object(
      'itemId', v_item.id,
      'quality', v_quality,
      'pointsRestored', v_restored,
      'conditionCurrent', v_item.condition_current
    );
    v_output := public.cc_jsonb_strip_nulls(v_output);
    update public.craft_jobs
       set units_completed = units_completed + 1,
           outputs = outputs || jsonb_build_array(v_output)
     where id = job.id;
    return v_output;
  end if;

  recipe := public.cc_craft_recipe(job.recipe_id);
  if recipe is null then raise exception 'Unknown craft recipe'; end if;

  v_xp := public.cc_craft_unit_xp(job.unit_duration_ms, p.player_level, p_xp_rate);
  v_output := jsonb_build_object(
    'unit', job.units_completed + 1,
    'kind', job.kind,
    'xp', v_xp,
    -- The settle instant is the production instant for metrics: the
    -- outputs (and their XP/materials) observably land at settlement.
    'completedAtMs', (extract(epoch from now()) * 1000)::bigint
  );

  if job.kind = 'consumable' then
    v_type := recipe ->> 'consumableType';
    v_ml := public.cc_player_mastery_level(actor, 'crafting_consumables');
    v_bounds := public.cc_craft_quality_bounds(
      v_type, v_ml, job.bench,
      (job.snapshot ->> 'catalystMaterialId') is not null,
      p_quality_shift
    );
    v_roll := round((
      ((v_bounds ->> 'min')::numeric
        + random() * greatest(0, (v_bounds ->> 'max')::numeric - (v_bounds ->> 'min')::numeric))
      * case job.bench when 2 then 1.05 when 3 then 1.10 else 1.0 end
      * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
    )::numeric, 2);
    v_roll := least((v_bounds ->> 'cap')::numeric, greatest(1, v_roll));
    v_qty := 1;
    v_bonus := false;
    if coalesce((job.snapshot ->> 'toolBonusUnitChance')::numeric, 0) > 0
       and random() < (job.snapshot ->> 'toolBonusUnitChance')::numeric then
      v_qty := 2;
      v_bonus := true;
    end if;
    perform public.cc_add_consumable_batch(
      actor, v_type, v_qty, v_roll, 'crafted', actor, job.recipe_id,
      'crafted', 'Crafted at the Workshop', '{}'::jsonb);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, v_type, v_qty),
           updated_at = now()
     where id = actor;
    perform public.cc_add_stat(actor, 'consumables_crafted', v_qty);
    v_output := v_output || jsonb_build_object(
      'consumableType', v_type,
      'quality', v_roll,
      'quantity', v_qty,
      'bonusUnit', v_bonus
    );
  elsif job.kind = 'refine' then
    v_ml := public.cc_player_mastery_level(actor, 'crafting.refining');
    v_yield := least(1, p_refine_base + 0.004 * v_ml
      + coalesce((job.snapshot ->> 'toolRefineYieldBonus')::numeric, 0));
    if coalesce((recipe ->> 'outputBase')::numeric, 0) <= 0 or p_refine_base <= 0 then
      v_count := coalesce((recipe ->> 'outputBase')::integer, 0);
    else
      v_count := floor((recipe ->> 'outputBase')::numeric * v_yield / p_refine_base)::integer;
    end if;
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, recipe ->> 'outputMaterial', v_count),
           updated_at = now()
     where id = actor;
    v_output := v_output || jsonb_build_object(
      'outputMaterial', recipe ->> 'outputMaterial',
      'outputQuantity', v_count
    );
  elsif job.kind = 'gear' then
    v_ml := public.cc_player_mastery_level(actor, 'crafting.gear');
    v_tempered := random() < least(0.3, greatest(0, p_temper_base) + 0.01 * v_ml);
    v_output := v_output || jsonb_build_object(
      'pending', true,
      'slot', recipe ->> 'gearSlot',
      'rarity', job.snapshot ->> 'gearRarity',
      'item_level', p.player_level,
      'draws', case when v_tempered then 3 else 1 end,
      'tempered', v_tempered
    );
  elsif job.kind = 'tool' then
    -- All three fitted tools carry 25 jobs of durability (§2.5e).
    update public.profiles
       set workshop_tools = jsonb_set(
             jsonb_set(coalesce(workshop_tools, '{}'::jsonb),
               array['owned', recipe ->> 'toolId'], 'true'::jsonb, true),
             array['charges', recipe ->> 'toolId'], '25'::jsonb, true),
           updated_at = now()
     where id = actor;
    v_output := v_output || jsonb_build_object('toolId', recipe ->> 'toolId');
  end if;

  -- Mastery + player XP land after the output is priced.
  if job.kind = 'refine' then
    v_mastery_track := 'crafting.refining'; v_mastery_xp := 10;
  elsif job.kind in ('gear', 'tool') then
    v_mastery_track := 'crafting.gear'; v_mastery_xp := 25;
  else
    v_mastery_track := 'crafting_consumables'; v_mastery_xp := 10;
  end if;
  perform public.cc_add_mastery_xp(actor, v_mastery_track, v_mastery_xp);
  v_next := public.cc_apply_xp(p.player_level, p.player_xp, v_xp);
  update public.profiles
     set player_level = (v_next ->> 'player_level')::integer,
         player_xp = (v_next ->> 'player_xp')::bigint,
         updated_at = now()
   where id = actor;

  v_output := public.cc_jsonb_strip_nulls(v_output);
  update public.craft_jobs
     set units_completed = units_completed + 1,
         xp_awarded = xp_awarded + v_xp,
         outputs = outputs || jsonb_build_array(v_output)
   where id = job.id;
  return v_output;
end;
$$;

create or replace function public.cc_settle_craft_jobs(
  p_player_id uuid,
  p_max_advance_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  p public.profiles%rowtype;
  v_now timestamptz := now();
  v_now_ms bigint := (extract(epoch from v_now) * 1000)::bigint;
  v_action text;
  v_heartbeat_ms bigint;
  v_away_cap_ms bigint;
  v_xp_rate numeric := least(0.85, greatest(0.70,
    public.cc_economy_config_number('craftXpRate', 0.775)));
  v_shift numeric := least(10, greatest(-10,
    public.cc_economy_config_number('craftQualityShift', 0)));
  v_temper numeric := least(0.30, greatest(0,
    public.cc_economy_config_number('gearTemperBaseChance', 0.05)));
  v_yield_base numeric := least(1.0, greatest(0.5,
    public.cc_economy_config_number('refineBaseYield', 0.8)));
  v_ids uuid[] := '{}';
  v_benches integer[] := '{}';
  v_advances bigint[] := '{}';
  v_job record;
  v_start_ms bigint;
  v_raw bigint;
  v_attended bigint;
  v_advance bigint;
  v_bench integer;
  v_budget bigint;
  v_need bigint;
  v_output jsonb;
  v_tools jsonb;
  v_tool_id text;
  v_charges integer;
  v_fitted_key text;
  v_total_xp bigint := 0;
  v_jobs_completed integer := 0;
  v_max_advance bigint := 0;
  v_completions jsonb := '[]'::jsonb;
  v_i integer;
  v_force_complete boolean := false;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into p from public.profiles where id = actor for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'no_profile',
      'advanced_ms', 0, 'xp_awarded', 0, 'jobs_completed', 0,
      'completions', '[]'::jsonb);
  end if;

  select active_action, (extract(epoch from last_heartbeat_at) * 1000)::bigint
    into v_action, v_heartbeat_ms
    from public.active_actions where user_id = actor;

  -- Internal away cap: min(earned tier, limiter when set), [1h, 24h].
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours(p.player_level),
      coalesce(nullif(p.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours(p.player_level))
    )) * 3600000)::bigint;

  -- Pass 1: rebase every active job and price its advance.
  for v_job in
    select * from public.craft_jobs
     where owner_user_id = actor and status = 'active'
     order by created_at asc, id asc
     for update
  loop
    v_start_ms := (extract(epoch from v_job.last_settled_at) * 1000)::bigint;
    v_raw := greatest(0, v_now_ms - v_start_ms);
    update public.craft_jobs set last_settled_at = v_now where id = v_job.id;
    if v_action is distinct from (case when v_job.kind = 'repair'
          then 'workshop_service' else 'crafting' end) or v_raw <= 0 then
      v_advance := 0;
    elsif p_max_advance_ms is not null then
      v_advance := least(v_raw, greatest(0, p_max_advance_ms));
    else
      v_attended := least(v_raw, greatest(0,
        coalesce(v_heartbeat_ms, v_start_ms) + 300000 - v_start_ms));
      v_advance := v_attended + least(v_raw - v_attended, v_away_cap_ms);
    end if;
    v_ids := v_ids || v_job.id;
    v_benches := v_benches || v_job.bench;
    v_advances := v_advances || v_advance;
    v_max_advance := greatest(v_max_advance, v_advance);
  end loop;

  if v_action is distinct from 'crafting' and v_action is distinct from 'workshop_service' then
    return jsonb_build_object('settled', true, 'advanced_ms', v_max_advance,
      'xp_awarded', 0, 'jobs_completed', 0, 'completions', '[]'::jsonb);
  end if;

  -- Pass 2: each bench's queue consumes its window in order; leftover
  -- flows to the next job on the bench.
  for v_bench in
    select distinct bench from public.craft_jobs
     where owner_user_id = actor and status = 'active'
     order by bench asc
  loop
    select coalesce(max(adv), 0) into v_budget
      from unnest(v_ids, v_benches, v_advances) as t(jid, b, adv)
     where b = v_bench;
    for v_job in
      select * from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench
       order by created_at asc, id asc
       for update
    loop
      exit when v_budget <= 0;
      -- A fitted tool's charge is spent when the job actually starts.
      if not v_job.tool_charged and (v_job.snapshot ->> 'toolId') is not null then
        v_tool_id := v_job.snapshot ->> 'toolId';
        update public.craft_jobs set tool_charged = true where id = v_job.id;
        select * into p from public.profiles where id = actor;
        v_tools := coalesce(p.workshop_tools, '{}'::jsonb);
        v_charges := coalesce((v_tools -> 'charges' ->> v_tool_id)::integer, 0) - 1;
        v_tools := jsonb_set(v_tools, array['charges', v_tool_id],
          to_jsonb(greatest(0, v_charges)), true);
        if v_charges <= 0 then
          v_tools := jsonb_set(v_tools, array['owned', v_tool_id], 'false'::jsonb, true);
          for v_fitted_key in
            select key from jsonb_each(coalesce(v_tools -> 'fitted', '{}'::jsonb))
          loop
            if v_tools -> 'fitted' ->> v_fitted_key = v_tool_id then
              v_tools := jsonb_set(v_tools, array['fitted', v_fitted_key], 'null'::jsonb, true);
            end if;
          end loop;
        end if;
        update public.profiles set workshop_tools = v_tools, updated_at = now()
         where id = actor;
      end if;
      v_force_complete := false;
      while v_budget > 0 and v_job.units_completed < v_job.units_total loop
        v_need := v_job.unit_duration_ms - v_job.accrued_ms;
        if v_budget < v_need then
          update public.craft_jobs
             set accrued_ms = accrued_ms + v_budget where id = v_job.id;
          v_budget := 0;
        else
          v_budget := v_budget - v_need;
          update public.craft_jobs set accrued_ms = 0 where id = v_job.id;
          v_output := public.cc_complete_craft_unit(
            v_job.id, v_xp_rate, v_shift, v_temper, v_yield_base);
          if coalesce((v_output ->> 'vehicleFull')::boolean, false) then
            -- Repair job whose vehicle is already whole (or gone):
            -- end it and refund every unstarted kit at its escrowed
            -- quality/origin (0025).
            for v_i in v_job.units_completed .. v_job.units_total - 1 loop
              perform public.cc_add_consumable_batch(actor,
                v_job.snapshot -> 'repair' ->> 'kitType', 1,
                (v_job.snapshot -> 'repair' -> 'kitQualities' ->> v_i)::numeric,
                coalesce(v_job.snapshot -> 'repair' -> 'kitOrigins' ->> v_i, 'crafted'),
                actor, null, 'repair_refund',
                'Patch kit refunded (vehicle already at full condition)',
                '{}'::jsonb);
            end loop;
            if v_job.units_total - v_job.units_completed > 0 then
              update public.profiles
                 set consumables = public.cc_jsonb_add_int(consumables,
                       v_job.snapshot -> 'repair' ->> 'kitType',
                       v_job.units_total - v_job.units_completed),
                     updated_at = now()
               where id = actor;
            end if;
            v_force_complete := true;
            exit;
          end if;
          v_total_xp := v_total_xp + (v_output ->> 'xp')::bigint;
          v_completions := v_completions || jsonb_build_array(
            v_output || jsonb_build_object('jobId', v_job.id, 'recipeId', v_job.recipe_id));
          v_job.units_completed := v_job.units_completed + 1;
        end if;
      end loop;
      if v_force_complete or v_job.units_completed >= v_job.units_total then
        update public.craft_jobs
           set status = 'complete', completed_at = v_now where id = v_job.id;
        v_jobs_completed := v_jobs_completed + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('settled', true, 'advanced_ms', v_max_advance,
    'xp_awarded', v_total_xp, 'jobs_completed', v_jobs_completed,
    'completions', v_completions);
end;
$$;

create or replace function public.cc_cancel_craft_job(
  p_player_id uuid,
  nonce text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  job public.craft_jobs%rowtype;
  v_started boolean;
  v_in_progress integer;
  v_unstarted integer;
  v_key text;
  v_total numeric;
  v_per_unit numeric;
  v_amount bigint;
  v_refunded jsonb := '{}'::jsonb;
  v_rush_refunded boolean := false;
  v_i integer;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  perform public.cc_settle_craft_jobs(actor);
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into job from public.craft_jobs
   where id = p_job_id and owner_user_id = actor for update;
  if not found then raise exception 'Job not found'; end if;
  if job.status <> 'active' then raise exception 'Job is not active'; end if;

  if job.kind = 'repair' then
    -- Repair jobs (0025): kits are discrete items, not divisible
    -- inputs — every kit not yet applied refunds whole, including
    -- the in-progress unit's kit (it has not been applied yet).
    v_refunded := '{}'::jsonb;
    for v_i in job.units_completed .. job.units_total - 1 loop
      perform public.cc_add_consumable_batch(actor,
        job.snapshot -> 'repair' ->> 'kitType', 1,
        (job.snapshot -> 'repair' -> 'kitQualities' ->> v_i)::numeric,
        coalesce(job.snapshot -> 'repair' -> 'kitOrigins' ->> v_i, 'crafted'),
        actor, null, 'repair_refund',
        'Patch kit refunded (repair job cancelled)', '{}'::jsonb);
    end loop;
    if job.units_total - job.units_completed > 0 then
      update public.profiles
         set consumables = public.cc_jsonb_add_int(consumables,
               job.snapshot -> 'repair' ->> 'kitType',
               job.units_total - job.units_completed),
             updated_at = now()
       where id = actor;
      v_refunded := jsonb_build_object(
        job.snapshot -> 'repair' ->> 'kitType',
        job.units_total - job.units_completed);
    end if;
    update public.craft_jobs set status = 'cancelled' where id = job.id;
    select * into p from public.profiles where id = actor;
    result := jsonb_build_object(
      'action_type', 'cc_cancel_craft_job',
      'profile', public.cc_profile_snapshot(p),
      'job_id', job.id,
      'refunded_inputs', v_refunded,
      'rush_ticket_refunded', false
    );
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_cancel_craft_job', nonce, result);
    return result;
  end if;

  v_started := job.units_completed > 0 or job.accrued_ms > 0;
  v_in_progress := case when job.accrued_ms > 0 then 1 else 0 end;
  v_unstarted := job.units_total - job.units_completed - v_in_progress;

  for v_key, v_total in
    select key, value::numeric from jsonb_each_text(job.escrow_inputs)
  loop
    v_per_unit := v_total / job.units_total;
    v_amount := (v_per_unit * v_unstarted)::bigint
      + case when v_in_progress = 1 then floor(v_per_unit * 0.5)::bigint else 0 end;
    if v_amount > 0 then
      v_refunded := jsonb_set(v_refunded, array[v_key],
        to_jsonb(coalesce((v_refunded ->> v_key)::bigint, 0) + v_amount), true);
      if public.cc_is_material_key(v_key) then
        update public.profiles
           set materials = public.cc_jsonb_add_int(materials, v_key, v_amount::integer),
               updated_at = now()
         where id = actor;
      else
        update public.profiles
           set essences = public.cc_jsonb_add_int(essences, v_key, v_amount::integer),
               updated_at = now()
         where id = actor;
      end if;
    end if;
  end loop;
  for v_key, v_total in
    select key, value::numeric from jsonb_each_text(job.escrow_catalyst)
  loop
    v_per_unit := v_total / job.units_total;
    v_amount := (v_per_unit * v_unstarted)::bigint
      + case when v_in_progress = 1 then floor(v_per_unit * 0.5)::bigint else 0 end;
    if v_amount > 0 then
      v_refunded := jsonb_set(v_refunded, array[v_key],
        to_jsonb(coalesce((v_refunded ->> v_key)::bigint, 0) + v_amount), true);
      update public.profiles
         set materials = public.cc_jsonb_add_int(materials, v_key, v_amount::integer),
             updated_at = now()
       where id = actor;
    end if;
  end loop;

  if job.rush_ticket_quality is not null and not v_started then
    perform public.cc_add_consumable_batch(actor, 'WorkshopRushTicket', 1,
      job.rush_ticket_quality, coalesce(job.rush_ticket_origin, 'crafted'),
      actor, null, 'crafted', 'Rush ticket refunded (job cancelled before start)',
      '{}'::jsonb);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, 'WorkshopRushTicket', 1),
           updated_at = now()
     where id = actor;
    v_rush_refunded := true;
  end if;

  update public.craft_jobs set status = 'cancelled' where id = job.id;
  select * into p from public.profiles where id = actor;
  result := jsonb_build_object(
    'action_type', 'cc_cancel_craft_job',
    'profile', public.cc_profile_snapshot(p),
    'job_id', job.id,
    'refunded_inputs', v_refunded,
    'rush_ticket_refunded', v_rush_refunded
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_cancel_craft_job', nonce, result);
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Restated activity transitions (0024 bodies + repair settler hook)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_set_active_action(p_player_id uuid, nonce text, action_kind text, target_type text DEFAULT NULL::text, target_id text DEFAULT NULL::text, target_label text DEFAULT NULL::text, scene_key text DEFAULT NULL::text, expected_finish_at timestamp with time zone DEFAULT NULL::timestamp with time zone, notes text DEFAULT NULL::text, activity_payload jsonb DEFAULT '{}'::jsonb, public_payload jsonb DEFAULT '{}'::jsonb, public_visible boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  result_row public.active_actions%rowtype;
  normalized_kind text := coalesce(nullif(trim(action_kind), ''), 'idle_standby');
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  if normalized_kind not in (
    'none',
    'idle_standby',
    'roaming_loot',
    'boss_prep',
    'boss_fight',
    'crafting',
    'salvaging',
    'workshop_service',
    'market_listing'
  ) then
    raise exception 'Unsupported active action: %', normalized_kind;
  end if;

  select result_payload into prior
  from public.verified_action_ledger vl
  where vl.user_id = actor and vl.idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  -- Crafting settler hook (0024): the outgoing action settles its
  -- craft jobs before the switch, at their exact accrued values.
  perform public.cc_settle_craft_jobs(actor);

  -- Repair settler hook (0025): board jobs settle on transitions too.
  perform public.cc_settle_repair_jobs_for(actor);

  insert into public.active_actions as aa (
    user_id,
    active_action,
    started_at,
    completes_at,
    target_type,
    target_id,
    target_label,
    scene_key,
    notes,
    activity_payload,
    public_payload,
    last_heartbeat_at,
    public_visible,
    schema_version,
    updated_at
  ) values (
    actor,
    normalized_kind,
    now(),
    expected_finish_at,
    nullif(target_type, ''),
    nullif(target_id, ''),
    nullif(target_label, ''),
    nullif(scene_key, ''),
    nullif(notes, ''),
    coalesce(activity_payload, '{}'::jsonb),
    coalesce(public_payload, '{}'::jsonb),
    now(),
    coalesce(public_visible, true),
    1,
    now()
  )
  on conflict (user_id) do update set
    active_action = excluded.active_action,
    started_at = excluded.started_at,
    completes_at = excluded.completes_at,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    target_label = excluded.target_label,
    scene_key = excluded.scene_key,
    notes = excluded.notes,
    activity_payload = excluded.activity_payload,
    public_payload = excluded.public_payload,
    last_heartbeat_at = excluded.last_heartbeat_at,
    public_visible = excluded.public_visible,
    schema_version = excluded.schema_version,
    updated_at = excluded.updated_at
  returning * into result_row;

  prior := jsonb_build_object(
    'action_type', 'cc_set_active_action',
    'activity', public.cc_active_action_snapshot(result_row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_set_active_action', nonce, prior);

  return prior;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_clear_active_action(p_player_id uuid, nonce text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  result_row public.active_actions%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger vl
  where vl.user_id = actor and vl.idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  -- Crafting settler hook (0024), same as cc_set_active_action.
  perform public.cc_settle_craft_jobs(actor);

  -- Repair settler hook (0025), same as cc_set_active_action.
  perform public.cc_settle_repair_jobs_for(actor);

  insert into public.active_actions as aa (
    user_id,
    active_action,
    started_at,
    completes_at,
    target_type,
    target_id,
    target_label,
    scene_key,
    notes,
    activity_payload,
    public_payload,
    last_heartbeat_at,
    public_visible,
    schema_version,
    updated_at
  ) values (
    actor,
    'idle_standby',
    now(),
    null,
    null,
    null,
    null,
    null,
    null,
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    true,
    1,
    now()
  )
  on conflict (user_id) do update set
    active_action = 'idle_standby',
    started_at = now(),
    completes_at = null,
    target_type = null,
    target_id = null,
    target_label = null,
    scene_key = null,
    notes = null,
    activity_payload = '{}'::jsonb,
    public_payload = '{}'::jsonb,
    last_heartbeat_at = now(),
    public_visible = true,
    schema_version = 1,
    updated_at = now()
  returning * into result_row;

  prior := jsonb_build_object(
    'action_type', 'cc_clear_active_action',
    'activity', public.cc_active_action_snapshot(result_row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_clear_active_action', nonce, prior);

  return prior;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Restated economy metrics (0024 body + repair panel)
-- ---------------------------------------------------------------------------

create or replace function public.cc_compute_economy_metrics(_day date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := (_day::timestamp) at time zone 'UTC';
  v_end timestamptz := ((_day + 1)::timestamp) at time zone 'UTC';
  m record;
  v_minted_total bigint;
  v_destroyed_total bigint;
  cj record;
  rj record;
begin
  select
    -- Mints -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_apply_chef_rewards'), 0) as minted_roaming,
    coalesce(sum(
      case when coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)
        then coalesce((result_payload -> 'attempt' ->> 'creditsGained')::bigint, 0)
           + coalesce((result_payload ->> 'entry_fee')::bigint, 0)
        else 0 end)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as minted_boss,
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_settle_offline_roaming'), 0) as minted_offline,
    (coalesce(sum((result_payload -> 'rewards' ->> 'credits')::bigint)
        filter (where action_type = 'cc_idle_claim'), 0)
     + coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
        filter (where action_type = 'cc_claim_roaming_rewards'), 0)
     + 5000 * count(*) filter (where action_type = 'cc_initial_bundle')
    ) as minted_other,
    -- Sinks -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'market_fee' ->> 'fee_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as destroyed_market_fees,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_vendor_buy'), 0) as destroyed_vendor,
    coalesce(sum((result_payload ->> 'creditsCharged')::bigint)
      filter (where action_type = 'cc_resurrect'), 0) as destroyed_resurrection,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_retrain'), 0) as destroyed_respec,
    coalesce(sum((result_payload ->> 'entry_fee')::bigint)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as destroyed_boss_entry_fees,
    coalesce(sum(greatest(0,
        coalesce((result_payload -> 'attempt' ->> 'creditsLost')::bigint, 0)
        - coalesce((result_payload ->> 'entry_fee')::bigint, 0)))
      filter (where action_type = 'cc_apply_boss_attempt'
        and not coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)),
      0) as destroyed_boss_death_fees,
    -- Market ----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_market_create') as market_listings_created,
    count(*) filter (where action_type = 'cc_accept_listing') as market_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as market_volume,
    -- Crafted market sales (0024) -------------------------------------------
    count(*) filter (where action_type = 'cc_accept_listing'
      and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
        or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')) as crafted_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'
        and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
          or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')), 0) as crafted_volume,
    -- Cache -----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_claim_rewarded_cache_key') as cache_keys_from_ads,
    count(*) filter (where action_type in ('cc_make_item', 'cc_draw_item')) as cache_opens,
    coalesce(sum((result_payload -> 'rewards' ->> 'cache_fragments_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_fragments_awarded
  into m
  from public.verified_action_ledger
  where created_at >= v_start and created_at < v_end;

  -- Craft job meters (0024): jobs_completed is a job-level fact
  -- (status + completed_at); units / XP / refined output are counted
  -- per OUTPUT at the unit's settle-day stamp, across jobs of ANY
  -- status — units produced inside a job that is later cancelled (or
  -- still running at day's end) are real production and real XP.
  select
    (select count(*) from public.craft_jobs j
      where j.status = 'complete'
        and j.completed_at >= v_start and j.completed_at < v_end) as jobs_completed,
    count(*)::integer as units_completed,
    coalesce(sum((o ->> 'xp')::bigint), 0)::bigint as xp_awarded,
    coalesce(sum((o ->> 'outputQuantity')::integer)
      filter (where o ->> 'kind' = 'refine'), 0)::integer as refined_units
  into cj
  from public.craft_jobs j,
       lateral jsonb_array_elements(j.outputs) o
  where (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
    and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint;

  -- Repair meters (0025): job-level facts from service_jobs at
  -- their terminal day (posted counted at posting day); self-repair
  -- kit consumption counted per completed repair UNIT output, the
  -- same settle-day stamp the craft meters use.
  select
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.created_at >= v_start and j.created_at < v_end) as jobs_posted,
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair' and j.status = 'completed'
        and j.completed_at >= v_start and j.completed_at < v_end)::integer as jobs_completed,
    (select coalesce(sum(j.points_restored), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled')) as points_restored,
    (select coalesce(sum(j.paid_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as credits_volume,
    (select coalesce(sum(j.fee_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as fees_destroyed,
    (select coalesce(sum(j.xp_awarded), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as xp_awarded,
    ((select coalesce(sum(jsonb_array_length(j.kits_consumed)), 0)
        from public.service_jobs j
       where j.profession_id = 'repair'
         and j.completed_at >= v_start and j.completed_at < v_end
         and j.status in ('completed', 'cancelled'))
     + (select count(*) from public.craft_jobs j,
              lateral jsonb_array_elements(j.outputs) o
         where o ->> 'kind' = 'repair'
           and (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
           and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint))::integer as kits_consumed
  into rj;

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees
    + rj.fees_destroyed;

  insert into public.economy_metrics (
    day,
    credits_minted_roaming, credits_minted_boss, credits_minted_offline,
    credits_minted_other, credits_minted_total,
    credits_destroyed_market_fees, credits_destroyed_vendor,
    credits_destroyed_resurrection, credits_destroyed_respec,
    credits_destroyed_boss_entry_fees, credits_destroyed_boss_death_fees,
    credits_destroyed_total, net_credit_change,
    legendaries_roaming, legendaries_boss, legendaries_cache, legendaries_total,
    market_listings_created, market_sales, market_volume,
    market_median_price, market_median_by_rarity,
    cache_keys_from_ads, cache_opens, cache_fragments_awarded,
    craft_jobs_completed, craft_units_completed, craft_xp_awarded,
    materials_destroyed_crafting, refined_units_produced,
    gear_items_crafted, crafted_market_sales, crafted_market_volume,
    repair_jobs_posted, repair_jobs_completed, repair_points_restored,
    repair_credits_volume, repair_fees_destroyed, repair_kits_consumed,
    repair_xp_awarded,
    computed_at
  )
  select
    _day,
    m.minted_roaming, m.minted_boss, m.minted_offline, m.minted_other,
    v_minted_total,
    m.destroyed_market_fees, m.destroyed_vendor, m.destroyed_resurrection,
    m.destroyed_respec, m.destroyed_boss_entry_fees, m.destroyed_boss_death_fees,
    v_destroyed_total, v_minted_total - v_destroyed_total,
    leg.roaming, leg.boss, leg.cache, leg.roaming + leg.boss + leg.cache,
    m.market_listings_created, m.market_sales, m.market_volume,
    (select percentile_cont(0.5) within group (
        order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric)
       from public.verified_action_ledger l
      where l.action_type = 'cc_accept_listing'
        and l.created_at >= v_start and l.created_at < v_end),
    (select coalesce(jsonb_object_agg(g.rarity, g.median), '{}'::jsonb)
       from (
         select l.result_payload -> 'item' ->> 'rarity' as rarity,
                percentile_cont(0.5) within group (
                  order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric) as median
           from public.verified_action_ledger l
          where l.action_type = 'cc_accept_listing'
            and l.created_at >= v_start and l.created_at < v_end
            and l.result_payload -> 'item' ->> 'rarity' is not null
          group by 1
       ) g),
    m.cache_keys_from_ads, m.cache_opens, m.cache_fragments_awarded,
    cj.jobs_completed, cj.units_completed, cj.xp_awarded,
    (select coalesce(jsonb_object_agg(key, net), '{}'::jsonb)
       from (
         select d.key, sum(d.delta) as net
           from (
             select e.key as key, (e.value)::bigint as delta
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, (e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_catalyst', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, -(e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'refunded_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_cancel_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
           ) d
          group by d.key
         having sum(d.delta) > 0
       ) nets),
    cj.refined_units,
    (select count(*)::integer from public.item_instances
      where payload ->> 'origin' = 'crafted'
        and created_at >= v_start and created_at < v_end),
    m.crafted_sales, m.crafted_volume,
    rj.jobs_posted, rj.jobs_completed, rj.points_restored,
    rj.credits_volume, rj.fees_destroyed, rj.kits_consumed,
    rj.xp_awarded,
    now()
  from (
    select
      count(*) filter (where payload ->> 'sourceTag' = 'World Drop') as roaming,
      count(*) filter (where payload ->> 'sourceTag' = 'Boss Drop') as boss,
      count(*) filter (where payload ->> 'sourceTag' = 'Cache-Forged') as cache
    from public.item_instances
    where rarity = 'Legendary' and created_at >= v_start and created_at < v_end
  ) leg
  on conflict (day) do update set
    credits_minted_roaming = excluded.credits_minted_roaming,
    credits_minted_boss = excluded.credits_minted_boss,
    credits_minted_offline = excluded.credits_minted_offline,
    credits_minted_other = excluded.credits_minted_other,
    credits_minted_total = excluded.credits_minted_total,
    credits_destroyed_market_fees = excluded.credits_destroyed_market_fees,
    credits_destroyed_vendor = excluded.credits_destroyed_vendor,
    credits_destroyed_resurrection = excluded.credits_destroyed_resurrection,
    credits_destroyed_respec = excluded.credits_destroyed_respec,
    credits_destroyed_boss_entry_fees = excluded.credits_destroyed_boss_entry_fees,
    credits_destroyed_boss_death_fees = excluded.credits_destroyed_boss_death_fees,
    credits_destroyed_total = excluded.credits_destroyed_total,
    net_credit_change = excluded.net_credit_change,
    legendaries_roaming = excluded.legendaries_roaming,
    legendaries_boss = excluded.legendaries_boss,
    legendaries_cache = excluded.legendaries_cache,
    legendaries_total = excluded.legendaries_total,
    market_listings_created = excluded.market_listings_created,
    market_sales = excluded.market_sales,
    market_volume = excluded.market_volume,
    market_median_price = excluded.market_median_price,
    market_median_by_rarity = excluded.market_median_by_rarity,
    cache_keys_from_ads = excluded.cache_keys_from_ads,
    cache_opens = excluded.cache_opens,
    cache_fragments_awarded = excluded.cache_fragments_awarded,
    craft_jobs_completed = excluded.craft_jobs_completed,
    craft_units_completed = excluded.craft_units_completed,
    craft_xp_awarded = excluded.craft_xp_awarded,
    materials_destroyed_crafting = excluded.materials_destroyed_crafting,
    refined_units_produced = excluded.refined_units_produced,
    gear_items_crafted = excluded.gear_items_crafted,
    crafted_market_sales = excluded.crafted_market_sales,
    crafted_market_volume = excluded.crafted_market_volume,
    repair_jobs_posted = excluded.repair_jobs_posted,
    repair_jobs_completed = excluded.repair_jobs_completed,
    repair_points_restored = excluded.repair_points_restored,
    repair_credits_volume = excluded.repair_credits_volume,
    repair_fees_destroyed = excluded.repair_fees_destroyed,
    repair_kits_consumed = excluded.repair_kits_consumed,
    repair_xp_awarded = excluded.repair_xp_awarded,
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;
$$;

-- ---------------------------------------------------------------------------
-- Retirements: the instant patch-kit op and the dormant 0004 service
-- flow. The dormant flow was flawed by design (provider set the
-- price at accept, escrow never moved, finish was instant and paid
-- regardless, no cancellation existed) — it is removed, not fixed.
-- Its mastery trigger branches (0014) key on action types these
-- functions produced; with the functions gone those branches can
-- never fire, and repair mastery is granted directly by
-- cc_complete_craft_unit / cc_repair_finalize_job.
-- ---------------------------------------------------------------------------

drop function if exists public.cc_use_patch_kit(uuid, text, uuid);
drop function if exists public.cc_use_patch_kit(uuid, text, uuid, text);
drop function if exists public.cc_item_service_request(uuid, text, uuid, text);
drop function if exists public.cc_item_service_accept(uuid, text, uuid, bigint, integer);
drop function if exists public.cc_item_job_finish(uuid, text, uuid);
