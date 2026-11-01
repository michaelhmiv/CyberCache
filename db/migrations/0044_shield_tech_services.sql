-- ============================================================================
-- 0044 — Shield-Tech services (behavior recalibration on the service board)
-- ============================================================================
--
-- Design: cybercache-prep/design-briefs/expansion-pack/
-- shield-tech-services.md; Michael's defaults settled 2026-10-31
-- (DECISIONS.md). Single source of truth for the math:
-- src/content/shieldTech.ts. The repair rulings of migration 0025
-- carry over wholesale; this lane's functions are SIBLINGS of the
-- repair functions on the same tables (repair's hard-check
-- profession_id = 'repair' and refuse everything else).
--
-- WHAT THIS MIGRATION DOES
--   1. service_jobs gains the recalibration facts (from/to behavior
--      + the shieldtech snapshot); mastery_definitions seeds
--      services.shield_tech; economy_metrics gains the shield-tech
--      panel (restated cc_compute_economy_metrics below).
--   2. The board flow (cc_post_shieldtech_job →
--      cc_accept_shieldtech_job → cc_settle_shieldtech_job →
--      cc_shieldtech_finalize_job): the owner posts at a SET PRICE
--      and escrows the full price up front; any verified shield tech
--      accepts (open market only — no private hires, no NPC tech);
--      the tech supplies the Calibration Cores, burned worst-first
--      as work needs capacity; work accrues only while the job is
--      the tech's active action (workshop_service targeting the
--      job), settled from server timestamps with crafting's
--      attended/away split. Money follows the repair rule exactly —
--      every terminal state pays PRO-RATA floor(price × points /
--      target) for work actually done, the shared market fee is
--      destroyed from the paid part (the provider's Darknet Broker
--      reduction applies, Market Manipulator's does not), the
--      remainder refunds. The FLIP follows the work: payload.behavior
--      changes only at 100% completion, via the shipped
--      invert/apply generation-stats pair (Turtle un-bake / re-bake);
--      partial, abandoned, cancelled and expired jobs leave the
--      shield bit-identical to posting.
--   3. TARGET LEGALITY IS THE GENERATION RULE (brief §2.3, R8):
--      a target behavior is legal iff its SHIELD_BEHAVIOR_WEIGHTS
--      weight for the shield's rarity is > 0. Legendary standard
--      weight is 0 — recalibrating a Legendary shield down to
--      Standard is BANNED, enforced here (cc_shieldtech_behavior_
--      legal), in the TS twin (src/content/shieldTech.ts), and in
--      the in-memory store; pinned by tests at every layer.
--   4. The self-lane (cc_enqueue_shieldtech_job): a timed craft_jobs
--      row of kind 'shieldtech' on bench 0 burning the owner's own
--      cores at the owner's services.shield_tech mastery rate,
--      progress only while workshop_service is the active action.
--      No price, no fee, NO player XP (the self-repair rule);
--      mastery still trains. Restated cc_complete_craft_unit /
--      cc_settle_craft_jobs / cc_cancel_craft_job carry the lane;
--      restated cc_set_active_action / cc_clear_active_action gain
--      the shieldtech settler hook beside repair's.
--   5. The Calibration Core consumable joins the craft catalog
--      (restated cc_craft_recipe_catalog: ReactiveComponents ×20,
--      TechFragments ×15, PrismShards ×2, VoidDust ×2; 40 min;
--      requiresLevel 15; bench 2) and the quality bounds (restated
--      cc_craft_quality_bounds). The TS def is crafter-only
--      (vendorExcluded) on the #219 pattern.
--   6. Shield-tech levers resolve live through
--      cc_economy_config_number (shieldTechWorkRateBase,
--      shieldTechMasterySpeedPerLevel,
--      shieldTechMasteryEfficiencyPerLevel, shieldTechXpPerPoint,
--      shieldTechAbandonWindowHours, shieldTechListingExpiryDays),
--      each clamped inline to its registry range; the registry lives
--      in src/server/economy/config.ts. The fee is NOT a new lever —
--      it is marketFeeRate (the one player-to-player fee rule).
--
-- RESTATED BODIES (hazard discipline): every restatement below is
-- built on the CURRENT body of its function — cc_complete_craft_unit
-- from 0042, cc_settle_craft_jobs + cc_cancel_craft_job's settler
-- family from 0038/0026, the activity transitions from 0033, the
-- recipe catalog + quality bounds + economy metrics from 0043 —
-- with only the marked shield-tech lines added; nothing from
-- Research (0038), Contracts (0042), or Manufacturer Standing
-- (0043) is dropped. No restated function changes signature, so no
-- predecessor overload is stranded (migrationOverloadGuard).
--
-- XP LAW (§2.6): a tech earns shieldTechXpPerPoint (default 0.25)
-- player XP per calibration point ACTUALLY completed, plus one
-- services.shield_tech mastery XP per 10 points, once, at terminal
-- settlement (the self-lane trains mastery per unit instead and
-- pays no player XP). Recalibration writes NO collection
-- discoveries — behavior is not a collection axis (the reforge
-- precedent).

-- ---------------------------------------------------------------------------
-- Schema: service_jobs recalibration state + metrics panel + mastery
-- ---------------------------------------------------------------------------

alter table public.service_jobs
  add column if not exists from_behavior text,
  add column if not exists to_behavior text,
  add column if not exists shieldtech_snapshot jsonb;

alter table public.economy_metrics
  add column if not exists shieldtech_jobs_posted bigint not null default 0,
  add column if not exists shieldtech_jobs_completed integer not null default 0,
  add column if not exists shieldtech_points_calibrated numeric not null default 0,
  add column if not exists shieldtech_credits_volume bigint not null default 0,
  add column if not exists shieldtech_fees_destroyed bigint not null default 0,
  add column if not exists shieldtech_cores_consumed integer not null default 0,
  add column if not exists shieldtech_xp_awarded bigint not null default 0;

insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at)
values ('services.shield_tech', 'services', 'Shield-Tech Services', 'Shield behavior recalibrations completed for other players.', 'jobs', 50, true, true, now(), now())
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Behavior helpers: the SQL twins of shieldBehaviorOf and the
-- legality rule in src/lib/combat/shieldBehaviors.ts /
-- src/content/shieldTech.ts (parity-pinned by tests over the full
-- rarity × behavior matrix).
-- ---------------------------------------------------------------------------

-- shieldBehaviorOf: missing or unrecognized payload behavior reads
-- as Standard; legacy items are never rewritten by a read.
create or replace function public.cc_shieldtech_behavior_of(p_payload jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_payload ->> 'behavior' in ('standard', 'nova', 'absorb', 'amp', 'turtle')
      then p_payload ->> 'behavior'
    else 'standard'
  end;
$$;

-- The generation rule: a target is legal iff its weight in
-- SHIELD_BEHAVIOR_WEIGHTS for the rarity is > 0. Non-Standard
-- weights are positive at every rarity (2.5 / 6.25 / 11.25 / 17 /
-- 25); the Standard weight is 90 / 75 / 55 / 32 / 0 — so the only
-- refusal the weight table ever produces is Legendary → Standard
-- (R8). Unknown rarities and unknown behaviors refuse.
create or replace function public.cc_shieldtech_behavior_legal(p_rarity text, p_target text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_target not in ('standard', 'nova', 'absorb', 'amp', 'turtle') then false
    when p_target <> 'standard' then p_rarity in ('Common', 'Uncommon', 'Rare', 'Epic', 'Legendary')
    else p_rarity in ('Common', 'Uncommon', 'Rare', 'Epic')
  end;
$$;

-- The flip: un-transform under the FROM behavior, re-apply under the
-- TO behavior — the SQL twin of the shipped
-- invert/applyShieldBehaviorGenerationStats pair
-- (src/lib/combat/shieldBehaviors.ts). Turtle is the only behavior
-- that transforms generation stats: capacity ×1.5, recharge ×0.5.
-- Only behavior / hp / rechargeRate change; every other payload
-- field passes through bit-identical.
create or replace function public.cc_shieldtech_rebased_payload(
  p_payload jsonb, p_from text, p_to text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_hp numeric := coalesce((p_payload ->> 'hp')::numeric, 0);
  v_rr numeric := coalesce((p_payload ->> 'rechargeRate')::numeric, 0);
begin
  if p_from = 'turtle' then
    v_hp := round(v_hp / 1.5);
    v_rr := round((v_rr / 0.5)::numeric, 1);
  end if;
  if p_to = 'turtle' then
    v_hp := round(v_hp * 1.5);
    v_rr := round((v_rr * 0.5)::numeric, 1);
  end if;
  return p_payload
    || jsonb_build_object('behavior', p_to, 'hp', v_hp, 'rechargeRate', v_rr);
end;
$$;

-- ---------------------------------------------------------------------------
-- Terminal settlement (internal): pro-rata pay, shared fee, refund,
-- shield release, XP + mastery by points actually completed, and —
-- at 100% only — the behavior flip with its identity check.
-- ---------------------------------------------------------------------------

create or replace function public.cc_shieldtech_finalize_job(p_job_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.service_jobs%rowtype;
  provider public.profiles%rowtype;
  item public.item_instances%rowtype;
  v_price bigint;
  v_done numeric;
  v_target integer;
  v_payout bigint := 0;
  v_fee_rate numeric := least(1, greatest(0,
    public.cc_economy_config_number('marketFeeRate', 0.05)));
  v_xp_per_point numeric := least(2, greatest(0,
    public.cc_economy_config_number('shieldTechXpPerPoint', 0.25)));
  mod_payload jsonb;
  darknet_pts numeric := 0;
  v_fee_reduction numeric := 0;
  v_fee bigint := 0;
  v_xp bigint := 0;
  v_next jsonb;
  v_flipped boolean := false;
begin
  select * into job from public.service_jobs where id = p_job_id for update;
  if not found then raise exception 'Shield-tech job not found'; end if;
  if job.status in ('completed', 'cancelled') then
    return jsonb_build_object('job_id', job.id, 'outcome', job.outcome,
      'already_terminal', true);
  end if;

  v_price := coalesce(job.quoted_price_credits, 0);
  v_done := coalesce(job.points_restored, 0);
  v_target := coalesce(job.target_points, 0);
  -- Price is per-point under the hood: full completion pays in
  -- full; anything else pays floor(price x done / target).
  if p_outcome = 'completed' then
    v_payout := v_price;
  elsif v_target > 0 and v_done > 0 then
    v_payout := floor(v_price * v_done / v_target)::bigint;
  end if;

  -- The flip (completion only): the shield must still be the shield
  -- that was posted — behavior untouched since posting and a
  -- payload identical outside behavior/hp/rechargeRate (the
  -- reforge identity discipline). Any drift refuses the flip; the
  -- money still settles for the work done.
  if p_outcome = 'completed' then
    select * into item from public.item_instances
     where id = job.target_item_instance_id for update;
    if found and item.kind = 'shield'
       and public.cc_shieldtech_behavior_of(item.payload) is not distinct from job.from_behavior
       and (item.payload - 'behavior' - 'hp' - 'rechargeRate')
           is not distinct from
           ((job.shieldtech_snapshot -> 'payload') - 'behavior' - 'hp' - 'rechargeRate') then
      update public.item_instances
         set payload = public.cc_shieldtech_rebased_payload(item.payload, job.from_behavior, job.to_behavior),
             updated_at = now()
       where id = item.id;
      v_flipped := true;
    end if;
  end if;

  if job.provider_user_id is not null then
    select * into provider from public.profiles where id = job.provider_user_id for update;
    if found and v_payout > 0 then
      -- The ONE player-to-player fee rule: the shared market fee,
      -- with the tech's Darknet Broker derivation mirrored from
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
    if found and v_done > 0 then
      v_xp := round(v_xp_per_point * v_done)::bigint;
      if v_xp > 0 then
        v_next := public.cc_apply_xp(provider.player_level, provider.player_xp, v_xp);
        update public.profiles
           set player_level = (v_next ->> 'player_level')::integer,
               player_xp = (v_next ->> 'player_xp')::bigint,
               updated_at = now()
         where id = provider.id;
      end if;
      perform public.cc_add_mastery_xp(provider.id, 'services.shield_tech', ceil(v_done / 10)::integer);
      if p_outcome = 'completed' then
        perform public.cc_add_stat(provider.id, 'services.completed', 1);
      end if;
    end if;
    -- Abandonment is a conduct record, not work: it lands even when
    -- zero points were completed (the usual case).
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
  -- The shield is never hostage: every terminal state releases it.
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
         shieldtech_snapshot = coalesce(shieldtech_snapshot, '{}'::jsonb)
           || jsonb_build_object('flipApplied', v_flipped),
         completed_at = now()
   where id = job.id;

  return jsonb_build_object('job_id', job.id, 'outcome', p_outcome,
    'paid_credits', v_payout, 'fee_credits', v_fee, 'xp_awarded', v_xp,
    'points_completed', v_done, 'behavior_flipped', v_flipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- The board settler (internal): advance one active job from server
-- timestamps. Progress accrues ONLY while the provider's recorded
-- active action is workshop_service targeting this job; every call
-- rebases last_settled_at. Attended/away split mirrors the craft
-- settler (heartbeat + 5 min grace; away tail capped by the
-- provider's internal effective offline cap). Cores burn
-- worst-quality-first as capacity runs out; work points accumulate
-- toward the target — there is no item condition to write (a shield
-- has none), the flip lands in finalize at 100%.
-- ---------------------------------------------------------------------------

create or replace function public.cc_settle_shieldtech_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.service_jobs%rowtype;
  provider public.profiles%rowtype;
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
  v_done numeric;
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

  v_work := coalesce(job.work_points_banked, 0)
    + (v_advance::numeric / 3600000)
      * coalesce((job.shieldtech_snapshot ->> 'workRatePointsPerHour')::numeric, 500);
  v_done := coalesce(job.points_restored, 0);
  v_capacity := coalesce(job.open_kit_capacity, 0);

  while v_work > 0.000001 and v_done < coalesce(job.target_points, 0) - 0.0001 loop
    if v_capacity <= 0.000001 then
      -- Open the tech's next Calibration Core: worst quality first.
      -- Legacy counts without batch rows backfill first, the
      -- cc_consume_consumable guard.
      if not exists (select 1 from public.consumable_batches
                      where owner_user_id = provider.id
                        and consumable_type = 'CalibrationCore' and quantity > 0) then
        if coalesce((provider.consumables ->> 'CalibrationCore')::integer, 0) > 0 then
          perform public.cc_add_consumable_batch(provider.id, 'CalibrationCore',
            (provider.consumables ->> 'CalibrationCore')::integer, 100, 'vendor',
            null, null, 'admin_adjust',
            'Backfilled legacy count into 100% batch before consumption',
            '{}'::jsonb);
        else
          exit; -- Out of cores: work stalls, banked points are kept.
        end if;
      end if;
      v_burn := public.cc_consume_consumable_batch(
        provider.id, 'CalibrationCore', 1, 'workshop_service', 'shieldtech_job', '{}'::jsonb);
      update public.profiles
         set consumables = public.cc_jsonb_add_int(consumables, 'CalibrationCore', -1),
             updated_at = now()
       where id = provider.id
       returning * into provider;
      v_entry := v_burn -> 'consumed' -> 0;
      v_quality := coalesce((v_entry ->> 'quality_percent')::numeric, 100);
      v_capacity := round(2500 * v_quality / 100
        * coalesce((job.shieldtech_snapshot ->> 'efficiency')::numeric, 1), 2);
      job.open_kit_total := v_capacity;
      job.open_kit_quality := v_quality;
      job.kits_consumed := coalesce(job.kits_consumed, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('kitType', 'CalibrationCore', 'quality', v_quality,
          'pointsApplied', 0));
    end if;
    v_applied := least(v_work, v_capacity,
      coalesce(job.target_points, 0) - v_done);
    exit when v_applied <= 0.000001;
    v_work := v_work - v_applied;
    v_capacity := v_capacity - v_applied;
    v_done := round(v_done + v_applied, 4);
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
         points_restored = v_done,
         open_kit_capacity = v_capacity,
         open_kit_total = job.open_kit_total,
         open_kit_quality = job.open_kit_quality,
         kits_consumed = job.kits_consumed,
         last_progress_at = job.last_progress_at
   where id = job.id;

  if v_done >= coalesce(job.target_points, 0) - 0.0001 then
    perform public.cc_shieldtech_finalize_job(job.id, 'completed');
  end if;
  return jsonb_build_object('settled', true, 'advanced_ms', v_advance,
    'points_completed', v_done);
end;
$$;

-- Settle (and expire) every shield-tech job one player owns or
-- provides. Called by the board read, every shield-tech op, and the
-- activity transitions (the 0044 hook in cc_set/clear_active_action).
create or replace function public.cc_settle_shieldtech_jobs_for(p_player_id uuid)
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
     where profession_id = 'shield_tech'
       and (owner_user_id = actor or provider_user_id = actor)
       and status in ('listed', 'active')
     order by created_at asc
  loop
    if v_job.status = 'listed' and v_job.expires_at is not null
       and v_job.expires_at <= now() then
      perform public.cc_shieldtech_finalize_job(v_job.id, 'expired');
      v_expired := v_expired + 1;
    elsif v_job.status = 'active' then
      perform public.cc_settle_shieldtech_job(v_job.id);
      v_settled := v_settled + 1;
    end if;
  end loop;
  return jsonb_build_object('settled_jobs', v_settled, 'expired_jobs', v_expired);
end;
$$;

-- ---------------------------------------------------------------------------
-- Board ops (§2.2): post → accept → finish / cancel / reclaim
-- ---------------------------------------------------------------------------

-- Post: verified accounts only; the FULL price escrows from the
-- owner's verified balance at posting, terms fixed at posting; the
-- shield must be unequipped and available (§2.3 — recalibrating an
-- equipped shield would change survival math between claims) and
-- locks in service until a terminal state releases it. The target
-- must satisfy the generation rule (R8 enforced here).
create or replace function public.cc_post_shieldtech_job(
  p_player_id uuid, nonce text, item_id uuid,
  p_to_behavior text, price_credits bigint default 0
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
  v_from text;
  v_target integer;
  v_price bigint := floor(coalesce(price_credits, 0))::bigint;
  v_expiry_days numeric := least(30, greatest(1,
    public.cc_economy_config_number('shieldTechListingExpiryDays', 7)));
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  perform public.cc_settle_shieldtech_jobs_for(actor);
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.kind <> 'shield' then raise exception 'Item is not a shield'; end if;
  if item.runtime_state <> 'available' or item.is_locked then
    raise exception 'Item state invalid';
  end if;
  v_from := public.cc_shieldtech_behavior_of(item.payload);
  if p_to_behavior not in ('standard', 'nova', 'absorb', 'amp', 'turtle') then
    raise exception 'Unknown shield behavior';
  end if;
  if p_to_behavior = v_from then
    raise exception 'Shield already carries that behavior';
  end if;
  if not public.cc_shieldtech_behavior_legal(item.rarity, p_to_behavior) then
    if item.rarity = 'Legendary' and p_to_behavior = 'standard' then
      raise exception 'Legendary shields cannot be recalibrated to Standard';
    end if;
    raise exception 'Behavior cannot be generated for this rarity';
  end if;
  if (item.payload ->> 'hp') is null then
    raise exception 'Shield has no stored capacity';
  end if;
  v_target := round((item.payload ->> 'hp')::numeric)::integer;
  if v_target < 1 then raise exception 'Shield has no stored capacity'; end if;
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
    quoted_duration_minutes, escrow_id, target_points, expires_at,
    from_behavior, to_behavior, kit_type, shieldtech_snapshot)
  values (actor, null, 'shield_tech', 'listed', item.id, 'shield_recalibration',
    v_price, null, v_escrow_id, v_target,
    now() + (v_expiry_days || ' days')::interval,
    v_from, p_to_behavior, 'CalibrationCore',
    jsonb_build_object(
      'fromBehavior', v_from, 'toBehavior', p_to_behavior,
      'targetPoints', v_target, 'payload', item.payload))
  returning * into job;
  update public.item_instances
     set runtime_state = 'in_service', is_locked = true, updated_at = now()
   where id = item.id returning * into item;

  result := jsonb_build_object('action_type', 'cc_post_shieldtech_job',
    'profile', public.cc_profile_snapshot(p),
    'job', to_jsonb(job), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_post_shieldtech_job', nonce, result);
  return result;
end;
$$;

-- Accept: any verified shield tech who is not the owner and holds
-- at least one Calibration Core; the tech's mastery snapshot prices
-- rate + efficiency (the edge is time + efficiency, never
-- permission).
create or replace function public.cc_accept_shieldtech_job(
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
  v_mastery integer;
  v_base numeric := least(5000, greatest(50,
    public.cc_economy_config_number('shieldTechWorkRateBase', 500)));
  v_speed numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('shieldTechMasterySpeedPerLevel', 0.02)));
  v_eff numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('shieldTechMasteryEfficiencyPerLevel', 0.02)));
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
  if not found or job.profession_id <> 'shield_tech' then raise exception 'Shield-tech job not found'; end if;
  if job.status = 'listed' and job.expires_at is not null and job.expires_at <= now() then
    perform public.cc_shieldtech_finalize_job(job.id, 'expired');
    raise exception 'Listing has expired';
  end if;
  if job.status <> 'listed' then raise exception 'Service job not available'; end if;
  if job.owner_user_id = actor then raise exception 'Cannot accept own job'; end if;
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if coalesce((p.consumables ->> 'CalibrationCore')::integer, 0) < 1 then
    raise exception 'No CalibrationCore available';
  end if;

  v_mastery := public.cc_player_mastery_level(actor, 'services.shield_tech');
  v_rate := v_base * least(2.0, 1 + v_speed * greatest(0, v_mastery - 1));
  v_efficiency := least(1.5, 1 + v_eff * greatest(0, v_mastery - 1));
  update public.service_jobs
     set provider_user_id = actor, status = 'active',
         shieldtech_snapshot = coalesce(shieldtech_snapshot, '{}'::jsonb)
           || jsonb_build_object(
             'masteryLevel', v_mastery,
             'workRatePointsPerHour', v_rate,
             'efficiency', v_efficiency),
         accepted_at = now(), last_settled_at = now(), last_progress_at = now()
   where id = job.id returning * into job;
  update public.escrow_records set payee_user_id = actor
   where id = job.escrow_id;

  result := jsonb_build_object('action_type', 'cc_accept_shieldtech_job',
    'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_accept_shieldtech_job', nonce, result);
  return result;
end;
$$;

-- Finish (deliver): the provider settles the job and hands it back
-- as-is — full price only at 100% (with the flip), pro-rata below
-- it (shield unchanged), nothing at zero.
create or replace function public.cc_shieldtech_job_finish(
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
  if not found or job.profession_id <> 'shield_tech' or job.provider_user_id is distinct from actor then
    raise exception 'Job not found';
  end if;
  if job.status <> 'active' then raise exception 'Job is not active'; end if;
  perform public.cc_settle_shieldtech_job(job.id);
  select * into job from public.service_jobs where id = job_id;
  if job.status = 'active' then
    perform public.cc_shieldtech_finalize_job(job.id,
      case when coalesce(job.points_restored, 0) > 0
        then 'delivered_partial' else 'cancelled_by_provider' end);
    select * into job from public.service_jobs where id = job_id;
  end if;
  select * into p from public.profiles where id = actor;
  result := jsonb_build_object('action_type', 'cc_shieldtech_job_finish',
    'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_shieldtech_job_finish', nonce, result);
  return result;
end;
$$;

-- Cancel: pre-acceptance the owner withdraws for a full refund;
-- mid-job either side ends it — points completed so far are paid
-- pro-rata, the remainder refunds, the shield is unchanged.
create or replace function public.cc_shieldtech_job_cancel(
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
  if not found or job.profession_id <> 'shield_tech'
     or (job.owner_user_id <> actor and job.provider_user_id is distinct from actor) then
    raise exception 'Job not found';
  end if;
  if job.status = 'listed' then
    if job.owner_user_id <> actor then raise exception 'Job not found'; end if;
    perform public.cc_shieldtech_finalize_job(job.id, 'cancelled_by_owner');
  elsif job.status = 'active' then
    perform public.cc_settle_shieldtech_job(job.id);
    select * into job from public.service_jobs where id = job_id;
    if job.status = 'active' then
      perform public.cc_shieldtech_finalize_job(job.id,
        case when job.owner_user_id = actor
          then 'cancelled_by_owner' else 'cancelled_by_provider' end);
    end if;
    select * into job from public.service_jobs where id = job_id;
  else
    raise exception 'Job is not active';
  end if;
  select * into p from public.profiles where id = actor;
  result := jsonb_build_object('action_type', 'cc_shieldtech_job_cancel',
    'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_shieldtech_job_cancel', nonce, result);
  return result;
end;
$$;

-- Reclaim: after the abandonment window without progress, the
-- owner takes the shield back. Points already completed are still
-- paid pro-rata (work done is work paid); the unspent escrow
-- refunds and the abandonment lands on the provider's record.
create or replace function public.cc_shieldtech_job_reclaim(
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
    public.cc_economy_config_number('shieldTechAbandonWindowHours', 48)));
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into job from public.service_jobs where id = job_id for update;
  if not found or job.profession_id <> 'shield_tech' or job.owner_user_id <> actor then
    raise exception 'Job not found';
  end if;
  if job.status <> 'active' then raise exception 'Job is not active'; end if;
  perform public.cc_settle_shieldtech_job(job.id);
  select * into job from public.service_jobs where id = job_id;
  if job.status <> 'active' then raise exception 'Job already completed'; end if;
  if job.last_progress_at is not null
     and job.last_progress_at > now() - (v_window_hours || ' hours')::interval then
    raise exception 'Shield tech is still within the abandonment window';
  end if;
  perform public.cc_shieldtech_finalize_job(job.id, 'abandoned');
  select * into job from public.service_jobs where id = job_id;
  select * into p from public.profiles where id = actor;
  result := jsonb_build_object('action_type', 'cc_shieldtech_job_reclaim',
    'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_shieldtech_job_reclaim', nonce, result);
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Self-lane enqueue (§2.5): a timed craft_jobs row of kind
-- 'shieldtech' on bench 0. The owner's cores escrow at enqueue —
-- exactly the cores the job will burn, counted by walking the
-- owner's batches in the game's one burn order (worst quality
-- first) until their true capacity covers the target; each core's
-- quality and origin is recorded in the snapshot so completion
-- prices the ACTUAL core and refunds return the exact batches.
-- Units apply while workshop_service is the active action (the
-- restated settler). No verified-account gate — consumption, like
-- self-repair. No player XP; mastery trains per unit.
-- ---------------------------------------------------------------------------

create or replace function public.cc_enqueue_shieldtech_job(
  p_player_id uuid, nonce text, item_id uuid, p_to_behavior text
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
  v_from text;
  v_target integer;
  v_count integer;
  v_burn jsonb;
  v_entry jsonb;
  v_batch record;
  v_i integer;
  v_qualities jsonb := '[]'::jsonb;
  v_origins jsonb := '[]'::jsonb;
  v_mastery integer;
  v_base numeric := least(5000, greatest(50,
    public.cc_economy_config_number('shieldTechWorkRateBase', 500)));
  v_speed numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('shieldTechMasterySpeedPerLevel', 0.02)));
  v_eff numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('shieldTechMasteryEfficiencyPerLevel', 0.02)));
  v_rate numeric;
  v_efficiency numeric;
  v_duration bigint;
  v_batch_row record;
  v_covered numeric := 0;
  v_needed integer := 0;
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

  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Shield not found'; end if;
  if item.kind <> 'shield' then raise exception 'Only shields can be recalibrated'; end if;
  if item.runtime_state <> 'available' or item.is_locked then
    raise exception 'Shield is not available for recalibration';
  end if;
  v_from := public.cc_shieldtech_behavior_of(item.payload);
  if p_to_behavior not in ('standard', 'nova', 'absorb', 'amp', 'turtle') then
    raise exception 'Unknown shield behavior';
  end if;
  if p_to_behavior = v_from then
    raise exception 'Shield already carries that behavior';
  end if;
  if not public.cc_shieldtech_behavior_legal(item.rarity, p_to_behavior) then
    if item.rarity = 'Legendary' and p_to_behavior = 'standard' then
      raise exception 'Legendary shields cannot be recalibrated to Standard';
    end if;
    raise exception 'Behavior cannot be generated for this rarity';
  end if;
  if (item.payload ->> 'hp') is null then
    raise exception 'Shield has no stored capacity';
  end if;
  v_target := round((item.payload ->> 'hp')::numeric)::integer;
  if v_target < 1 then raise exception 'Shield has no stored capacity'; end if;
  if exists (select 1 from public.craft_jobs
              where owner_user_id = actor and kind = 'shieldtech' and status = 'active'
                and snapshot -> 'shieldtech' ->> 'itemId' = item.id::text) then
    raise exception 'A recalibration job is already running for this shield';
  end if;
  select count(*) into v_count from public.craft_jobs
   where owner_user_id = actor and kind = 'shieldtech' and status = 'active';
  if v_count >= 3 then raise exception 'Too many recalibration jobs already running'; end if;

  v_mastery := public.cc_player_mastery_level(actor, 'services.shield_tech');
  v_rate := v_base * least(2.0, 1 + v_speed * greatest(0, v_mastery - 1));
  v_efficiency := least(1.5, 1 + v_eff * greatest(0, v_mastery - 1));

  -- Count the cores this job must escrow: walk the owner's batches
  -- in burn order (worst quality first — the order
  -- cc_consume_consumable_batch burns) accumulating true capacity.
  -- Legacy counts without batch rows backfill first (the
  -- cc_consume_consumable guard).
  if not exists (select 1 from public.consumable_batches
                  where owner_user_id = actor
                    and consumable_type = 'CalibrationCore' and quantity > 0)
     and coalesce((p.consumables ->> 'CalibrationCore')::integer, 0) > 0 then
    perform public.cc_add_consumable_batch(actor, 'CalibrationCore',
      (p.consumables ->> 'CalibrationCore')::integer, 100, 'vendor', null, null,
      'admin_adjust', 'Backfilled legacy count into 100% batch before consumption',
      '{}'::jsonb);
  end if;
  for v_batch_row in
    select quality_percent, quantity from public.consumable_batches
     where owner_user_id = actor and consumable_type = 'CalibrationCore'
       and quantity > 0
     order by quality_percent asc, created_at asc, id asc
  loop
    for v_i in 1 .. v_batch_row.quantity loop
      v_covered := v_covered + round(2500 * v_batch_row.quality_percent / 100 * v_efficiency, 2);
      v_needed := v_needed + 1;
      exit when v_covered >= v_target;
    end loop;
    exit when v_covered >= v_target;
  end loop;
  if v_covered < v_target then
    raise exception 'Not enough Calibration Core capacity for this shield';
  end if;

  -- Escrow the cores: burn exactly v_needed and record each unit's
  -- quality and origin, so completion prices the ACTUAL core and
  -- refunds return the exact batches.
  v_burn := public.cc_consume_consumable_batch(
    actor, 'CalibrationCore', v_needed, 'workshop_service', 'shieldtech_self', '{}'::jsonb);
  for v_entry in select * from jsonb_array_elements(v_burn -> 'consumed') loop
    select origin into v_batch from public.consumable_batches
     where id = (v_entry ->> 'batch_id')::uuid;
    for v_i in 1 .. (v_entry ->> 'quantity')::integer loop
      v_qualities := v_qualities || jsonb_build_array((v_entry ->> 'quality_percent')::numeric);
      v_origins := v_origins || jsonb_build_array(coalesce(v_batch.origin, 'vendor'));
    end loop;
  end loop;
  update public.profiles
     set consumables = public.cc_jsonb_add_int(consumables, 'CalibrationCore', -v_needed),
         updated_at = now()
   where id = actor returning * into p;

  v_duration := greatest(1, ceil(2500 / v_rate * 3600000))::bigint;

  insert into public.craft_jobs(
    owner_user_id, bench, kind, recipe_id, units_total, unit_duration_ms,
    escrow_inputs, escrow_catalyst, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (actor, 0, 'shieldtech', 'shieldtech_recalibration', v_needed, v_duration,
    '{}'::jsonb, '{}'::jsonb, null, null,
    jsonb_build_object(
      'toolId', null, 'toolQualityMultiplier', 1, 'toolDurationMultiplier', 1,
      'toolRefineYieldBonus', 0, 'toolBonusUnitChance', 0,
      'skillDurationMultiplier', 1, 'rushReduction', 0, 'craftTimeScalar', 1,
      'catalystMaterialId', null, 'gearRarity', null,
      'shieldtech', jsonb_build_object(
        'itemId', item.id, 'fromBehavior', v_from, 'toBehavior', p_to_behavior,
        'targetPoints', v_target, 'payload', item.payload,
        'coreQualities', v_qualities, 'coreOrigins', v_origins,
        'efficiency', v_efficiency, 'workRatePointsPerHour', v_rate,
        'masteryLevel', v_mastery, 'pointsApplied', 0)))
  returning * into v_job;

  result := jsonb_build_object('action_type', 'cc_enqueue_shieldtech_job',
    'profile', public.cc_profile_snapshot(p),
    'job', public.cc_craft_job_json(v_job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enqueue_shieldtech_job', nonce, result);
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- ── Restated cc_complete_craft_unit (0042 body + the shieldtech self-lane branch, 0044) ──
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
  -- Fixer completion terms (0029)
  v_mod_payload jsonb;
  v_craft_quality_bonus numeric := 0;
  v_research_shift numeric := 0;
  v_research_temper numeric := 0;
  v_research_draws integer := 0;
  v_craft_temper_bonus numeric := 0;
  v_shift numeric;
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
  -- Research (0038): the owner's completion-derived terms, read once
  -- from research_completions (server records only).
  v_research_shift := public.cc_research_bonus_number(p.id, 'craftQualityShift');
  v_research_temper := public.cc_research_bonus_number(p.id, 'gearTemperBonus');
  v_research_draws := public.cc_research_bonus_number(p.id, 'gearDrawBonus')::integer;
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
      perform public.cc_add_stat(actor, 'services.points_restored', round(v_restored)::bigint);
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
    -- 0030: Overclock charge accrual — self-repair points restored
    -- charge a Fixer-selected owner's pool (per-point lever rate).
    if v_restored > 0 and coalesce(p.action_skill_selection, '') = 'Fixer' then
      select payload into v_mod_payload from public.item_instances
       where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      if public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, 'Fixer') then
        update public.profiles
           set action_skill_charge = least(100, action_skill_charge
             + least(2, greatest(0, public.cc_economy_config_number('actionSkillChargePerRepairPoint', 0.2))) * v_restored)
         where id = actor;
      end if;
    end if;
    return v_output;
  end if;

  if job.kind = 'shieldtech' then
    -- Self-lane recalibration unit (0044): apply the next escrowed
    -- Calibration Core. Its capacity (base 2,500 x quality% x the
    -- owner's efficiency snapshot) accrues toward the target; the
    -- flip lands only when the accumulated points cover the target,
    -- and only if the shield is still exactly the shield that was
    -- enqueued (identity diff outside behavior/hp/rechargeRate —
    -- the finalize rule). No player XP (consumption, the self-repair
    -- rule); shield-tech mastery trains by points applied.
    v_output := jsonb_build_object(
      'unit', job.units_completed + 1,
      'kind', 'shieldtech',
      'xp', 0,
      'completedAtMs', (extract(epoch from now()) * 1000)::bigint
    );
    select * into v_item from public.item_instances
     where id = (job.snapshot -> 'shieldtech' ->> 'itemId')::uuid
       and owner_user_id = actor;
    if not found or v_item.kind <> 'shield'
       or v_item.runtime_state <> 'available' or v_item.is_locked
       or public.cc_shieldtech_behavior_of(v_item.payload)
          is distinct from (job.snapshot -> 'shieldtech' ->> 'fromBehavior') then
      -- The unit never starts: the settler ends the job here and
      -- refunds this and every later core at its recorded quality.
      return v_output || jsonb_build_object('shieldUnavailable', true);
    end if;
    v_quality := coalesce(
      (job.snapshot -> 'shieldtech' -> 'coreQualities' ->> job.units_completed)::numeric, 100);
    v_restore := round(2500 * v_quality / 100
      * coalesce((job.snapshot -> 'shieldtech' ->> 'efficiency')::numeric, 1), 2);
    v_restored := round(coalesce(
      (job.snapshot -> 'shieldtech' ->> 'pointsApplied')::numeric, 0) + v_restore, 4);
    update public.craft_jobs
       set snapshot = jsonb_set(snapshot, '{shieldtech,pointsApplied}',
             to_jsonb(v_restored), true)
     where id = job.id
     returning * into job;
    if v_restore > 0 then
      perform public.cc_add_mastery_xp(actor, 'services.shield_tech',
        ceil(v_restore / 10)::integer);
    end if;
    v_output := v_output || jsonb_build_object(
      'itemId', v_item.id,
      'quality', v_quality,
      'pointsApplied', v_restore,
      'totalPointsApplied', v_restored
    );
    if v_restored >= (job.snapshot -> 'shieldtech' ->> 'targetPoints')::numeric then
      if (v_item.payload - 'behavior' - 'hp' - 'rechargeRate')
         is distinct from ((job.snapshot -> 'shieldtech' -> 'payload')
           - 'behavior' - 'hp' - 'rechargeRate') then
        -- The shield changed under the job (e.g. a reforge landed
        -- first): the flip refuses; the settler ends the job and
        -- refunds the unstarted cores. This core is spent — the
        -- work happened.
        v_output := v_output || jsonb_build_object('shieldDrift', true);
      else
        update public.item_instances
           set payload = public.cc_shieldtech_rebased_payload(v_item.payload,
                 job.snapshot -> 'shieldtech' ->> 'fromBehavior',
                 job.snapshot -> 'shieldtech' ->> 'toBehavior'),
               updated_at = now()
         where id = v_item.id;
        v_output := v_output || jsonb_build_object(
          'flipped', true,
          'fromBehavior', job.snapshot -> 'shieldtech' ->> 'fromBehavior',
          'toBehavior', job.snapshot -> 'shieldtech' ->> 'toBehavior',
          'shieldtechComplete', true);
      end if;
    end if;
    v_output := public.cc_jsonb_strip_nulls(v_output);
    update public.craft_jobs
       set units_completed = units_completed + 1,
           outputs = outputs || jsonb_build_array(v_output)
     where id = job.id;
    return v_output;
  end if;

  -- Fixer derivation (0029): the completing crafter's OWN records.
  -- The quality shift composes lever + skill under ONE clamp
  -- [-10, +20] (a future Research shift joins the same sum); the
  -- temper term adds Master Artificer's flat bonus under the 0.30 cap.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_craft_quality_bonus := 1.0 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_2', 'Fixer', 5));
  v_craft_temper_bonus := 0.05 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_major_1', 'Fixer', 1);
  v_shift := least(20, greatest(-10, p_quality_shift + v_craft_quality_bonus + v_research_shift));

  recipe := public.cc_craft_recipe(job.recipe_id);
  if recipe is null then raise exception 'Unknown craft recipe'; end if;

  v_xp := public.cc_craft_unit_xp(job.unit_duration_ms, p.player_level, p_xp_rate);
  -- Cache Rank Fast Learner (0031): craft XP carries the same XP
  -- bonus as every other source (applied after the peg rate,
  -- before cc_apply_xp — the shipped composition order).
  v_xp := round(v_xp * (1 + public.cc_cache_rank_bonus_fraction(p.cache_rank_spends, 'xp')))::bigint;
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
      v_shift
    );
    v_roll := round((
      ((v_bounds ->> 'min')::numeric
        + random() * greatest(0, (v_bounds ->> 'max')::numeric - (v_bounds ->> 'min')::numeric))
      * case job.bench when 2 then 1.05 when 3 then 1.10 else 1.0 end
      * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
    )::numeric, 2);
    v_roll := least((v_bounds ->> 'cap')::numeric, greatest(1, v_roll));
    v_qty := coalesce((recipe ->> 'outputQuantity')::integer, 1);
    v_bonus := false;
    if coalesce((job.snapshot ->> 'toolBonusUnitChance')::numeric, 0) > 0
       and random() < (job.snapshot ->> 'toolBonusUnitChance')::numeric then
      v_qty := v_qty + 1;
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
    v_tempered := random() < least(0.3, greatest(0, p_temper_base) + 0.01 * v_ml + v_craft_temper_bonus + v_research_temper);
    v_output := v_output || jsonb_build_object(
      'pending', true,
      'slot', recipe ->> 'gearSlot',
      'rarity', job.snapshot ->> 'gearRarity',
      'item_level', p.player_level,
      'draws', (case when v_tempered then 3 else 1 end)
        + case when job.snapshot ->> 'coreCatalyst' = 'true'
            then 2 + coalesce((job.snapshot ->> 'coreCatalystDrawBonus')::integer, 0)
            else 0 end
        + v_research_draws,
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
  -- 0030: Overclock charge accrual — a completed craft unit charges
  -- a Fixer-selected crafter's pool (per-unit lever rate).
  if coalesce(p.action_skill_selection, '') = 'Fixer'
     and public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, 'Fixer') then
    update public.profiles
       set action_skill_charge = least(100, action_skill_charge
         + least(25, greatest(0, public.cc_economy_config_number('actionSkillChargePerCraftUnit', 3))))
     where id = actor;
  end if;
  return v_output;
end;$$;


-- ---------------------------------------------------------------------------
-- ── Restated cc_settle_craft_jobs (0038 body + shieldtech self-lane handling, 0044) ──
-- ---------------------------------------------------------------------------

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
  v_refund_from integer := 0;
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
      public.cc_earned_offline_cap_hours(p.player_level)
        + public.cc_research_offline_cap_bonus(p.id),
      coalesce(nullif(p.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours(p.player_level)
        + public.cc_research_offline_cap_bonus(p.id))
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
    if v_action is distinct from (case when v_job.kind in ('repair', 'shieldtech')
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
          if coalesce((v_output ->> 'shieldUnavailable')::boolean, false) then
            -- Shield-tech self-lane (0044): the shield is gone, busy,
            -- or no longer carries the enqueued behavior — this unit
            -- never started. End the job and refund this and every
            -- later core at its escrowed quality/origin.
            for v_i in v_job.units_completed .. v_job.units_total - 1 loop
              perform public.cc_add_consumable_batch(actor,
                'CalibrationCore', 1,
                (v_job.snapshot -> 'shieldtech' -> 'coreQualities' ->> v_i)::numeric,
                coalesce(v_job.snapshot -> 'shieldtech' -> 'coreOrigins' ->> v_i, 'crafted'),
                actor, null, 'shieldtech_refund',
                'Calibration Core refunded (shield no longer recalibratable)',
                '{}'::jsonb);
            end loop;
            if v_job.units_total - v_job.units_completed > 0 then
              update public.profiles
                 set consumables = public.cc_jsonb_add_int(consumables,
                       'CalibrationCore',
                       v_job.units_total - v_job.units_completed),
                     updated_at = now()
               where id = actor;
            end if;
            v_force_complete := true;
            exit;
          end if;
          if coalesce((v_output ->> 'shieldtechComplete')::boolean, false)
             or coalesce((v_output ->> 'shieldDrift')::boolean, false) then
            -- The job's work is done (flip landed, or the flip was
            -- refused on drift): this unit's core is spent; refund
            -- only the unstarted cores and end the job. Completion
            -- accounting below still records the unit.
            v_refund_from := v_job.units_completed + 1;
            for v_i in v_refund_from .. v_job.units_total - 1 loop
              perform public.cc_add_consumable_batch(actor,
                'CalibrationCore', 1,
                (v_job.snapshot -> 'shieldtech' -> 'coreQualities' ->> v_i)::numeric,
                coalesce(v_job.snapshot -> 'shieldtech' -> 'coreOrigins' ->> v_i, 'crafted'),
                actor, null, 'shieldtech_refund',
                'Calibration Core refunded (recalibration job ended)',
                '{}'::jsonb);
            end loop;
            if v_job.units_total - v_refund_from > 0 then
              update public.profiles
                 set consumables = public.cc_jsonb_add_int(consumables,
                       'CalibrationCore',
                       v_job.units_total - v_refund_from),
                     updated_at = now()
               where id = actor;
            end if;
            v_force_complete := true;
          end if;
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


-- ---------------------------------------------------------------------------
-- ── Restated cc_cancel_craft_job (0026 body + shieldtech refund branch, 0044) ──
-- ---------------------------------------------------------------------------

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
  v_cores_refunded bigint := 0;
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

  if job.kind = 'shieldtech' then
    -- Shield-tech jobs (0044): cores are discrete items, not
    -- divisible inputs — every core not yet applied refunds whole,
    -- including the in-progress unit's core (it has not been applied
    -- yet). Applied cores stay spent; the shield is unchanged (the
    -- flip only ever lands at full coverage, inside the completion
    -- that ends the job).
    v_refunded := '{}'::jsonb;
    for v_i in job.units_completed .. job.units_total - 1 loop
      perform public.cc_add_consumable_batch(actor,
        'CalibrationCore', 1,
        (job.snapshot -> 'shieldtech' -> 'coreQualities' ->> v_i)::numeric,
        coalesce(job.snapshot -> 'shieldtech' -> 'coreOrigins' ->> v_i, 'crafted'),
        actor, null, 'shieldtech_refund',
        'Calibration Core refunded (recalibration job cancelled)', '{}'::jsonb);
    end loop;
    if job.units_total - job.units_completed > 0 then
      update public.profiles
         set consumables = public.cc_jsonb_add_int(consumables,
               'CalibrationCore',
               job.units_total - job.units_completed),
             updated_at = now()
       where id = actor;
      v_refunded := jsonb_build_object(
        'CalibrationCore', job.units_total - job.units_completed);
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

  -- Legendary cores (0026): escrowed cores refund on the material
  -- catalyst's schedule — full for unstarted units, half (floored)
  -- for the in-progress unit.
  if coalesce(job.escrow_cores, 0) > 0 then
    v_per_unit := job.escrow_cores::numeric / job.units_total;
    v_cores_refunded := (v_per_unit * v_unstarted)::bigint
      + case when v_in_progress = 1 then floor(v_per_unit * 0.5)::bigint else 0 end;
    if v_cores_refunded > 0 then
      update public.profiles
         set legendary_cores = legendary_cores + v_cores_refunded::integer,
             updated_at = now()
       where id = actor;
    end if;
  end if;

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
    'rush_ticket_refunded', v_rush_refunded,
    'cores_refunded', v_cores_refunded
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_cancel_craft_job', nonce, result);
  return result;
end;
$$;


-- ---------------------------------------------------------------------------
-- ── Restated cc_set_active_action (0033 body + shieldtech settler hook, 0044) ──
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
    'market_listing',
    'endless_run',
    'extraction'
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

  -- Shield-tech settler hook (0044): board jobs settle on transitions too.
  perform public.cc_settle_shieldtech_jobs_for(actor);

  -- Extraction settler hook (0033): the outgoing action accrues
  -- its extraction time before the switch. Rolls finalize later,
  -- when the passes are settled at a read/claim (cc_apply_extraction
  -- via the Chef) — time accounting is all that happens here.
  perform public.cc_settle_extraction_time(actor);

  -- Extraction start gates + selection sync (0033): an incoming
  -- 'extraction' set claims the site. Every gate reads server
  -- records only (verified account, no standing death record,
  -- a real + unlocked area, Deep Delve mastery) — client claims
  -- about any of them are never consulted. The standing selection
  -- syncs here so the row the settler reads always names the site
  -- the player chose; the in-progress pass keeps its own terms.
  if normalized_kind = 'extraction' then
    if not public.can_use_player_economy(actor) then
      raise exception 'Verified account required';
    end if;
    if exists (
      select 1 from public.profiles p
      where p.id = actor and coalesce(p.death_state, '{}'::jsonb) <> '{}'::jsonb
    ) then
      raise exception 'Character is dead — resurrect before extracting';
    end if;
    if nullif(target_id, '') is null or not exists (
      select 1 from public.roaming_areas ra where ra.id = target_id
    ) then
      raise exception 'Unknown extraction area';
    end if;
    if (select coalesce(ra.unlock_level, 1) from public.roaming_areas ra where ra.id = target_id)
       > (select coalesce(p.player_level, 1) from public.profiles p where p.id = actor) then
      raise exception 'Area locked for this hunter level';
    end if;
    if coalesce(nullif(activity_payload ->> 'method', ''), 'surface') not in ('surface', 'deep') then
      raise exception 'Unsupported extraction method';
    end if;
    if coalesce(nullif(activity_payload ->> 'method', ''), 'surface') = 'deep'
       and public.cc_player_mastery_level(actor, 'gathering.extraction') < 5 then
      raise exception 'Deep Delve requires Extraction mastery 5';
    end if;
    insert into public.extraction_state (user_id, area_id, method, last_settled_at)
    values (actor, target_id, coalesce(nullif(activity_payload ->> 'method', ''), 'surface'), now())
    on conflict (user_id) do update set
      area_id = excluded.area_id,
      method = excluded.method,
      updated_at = now();
  end if;

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


-- ---------------------------------------------------------------------------
-- ── Restated cc_clear_active_action (0033 body + shieldtech settler hook, 0044) ──
-- ---------------------------------------------------------------------------

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

  -- Shield-tech settler hook (0044): board jobs settle on transitions too.
  perform public.cc_settle_shieldtech_jobs_for(actor);

  -- Extraction settler hook (0033), same as cc_set_active_action.
  perform public.cc_settle_extraction_time(actor);

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
-- ── Restated cc_craft_recipe_catalog (0043 body + the Calibration Core recipe, 0044) ──
-- ---------------------------------------------------------------------------

create or replace function public.cc_craft_recipe_catalog()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select $catalog$
[
  {
    "id": "recipe_medkit",
    "kind": "consumable",
    "name": "Med Kit",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 15,
      "ReactiveComponents": 8
    },
    "unitDurationMs": 720000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "MedKit"
  },
  {
    "id": "recipe_medkit_refined",
    "kind": "consumable",
    "name": "Med Kit (Refined)",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 25,
      "ReactiveComponents": 15,
      "VoidDust": 1
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 10,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "MedKitRefined"
  },
  {
    "id": "recipe_shieldcell",
    "kind": "consumable",
    "name": "Shield Cell",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 20,
      "ReactiveComponents": 12
    },
    "unitDurationMs": 900000,
    "requiresLevel": 3,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ShieldCell"
  },
  {
    "id": "recipe_nanoswarm",
    "kind": "consumable",
    "name": "Nano-Swarm",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 30,
      "ReactiveComponents": 20,
      "VoidDust": 2
    },
    "unitDurationMs": 2400000,
    "requiresLevel": 15,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "NanoSwarm"
  },
  {
    "id": "recipe_adrenaline",
    "kind": "consumable",
    "name": "Adrenaline Shot",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 40,
      "ReactiveComponents": 25,
      "VoidDust": 3
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 20,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "AdrenalineShot"
  },
  {
    "id": "recipe_ammo_pack",
    "kind": "consumable",
    "name": "Ammo Pack",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 10,
      "BallisticParts": 6
    },
    "unitDurationMs": 600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "AmmoPack"
  },
  {
    "id": "recipe_high_capacity_ammo_pack",
    "kind": "consumable",
    "name": "High-Capacity Ammo Pack",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 18,
      "BallisticParts": 12,
      "TechFragments": 2
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 6,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "HighCapacityAmmoPack"
  },
  {
    "id": "recipe_ap_ammo",
    "kind": "consumable",
    "name": "Armor-Piercing Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 10
    },
    "unitDurationMs": 900000,
    "requiresLevel": 5,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ArmorPiercingAmmo"
  },
  {
    "id": "recipe_fire_ammo",
    "kind": "consumable",
    "name": "Incendiary Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "IgnitionFluid": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "IncendiaryAmmo"
  },
  {
    "id": "recipe_shock_ammo",
    "kind": "consumable",
    "name": "Shock Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "ConduitWire": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ShockAmmo"
  },
  {
    "id": "recipe_corrosive_ammo",
    "kind": "consumable",
    "name": "Corrosive Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "AcidCompound": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "CorrosiveAmmo"
  },
  {
    "id": "recipe_cryo_ammo",
    "kind": "consumable",
    "name": "Cryo Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "CryoGel": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "CryoAmmo"
  },
  {
    "id": "recipe_void_ammo",
    "kind": "consumable",
    "name": "Void Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 20,
      "BallisticParts": 10,
      "VoidEssence": 5
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 15,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "VoidAmmo"
  },
  {
    "id": "recipe_ordnance",
    "kind": "consumable",
    "name": "Ordnance Charge",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 12,
      "BallisticParts": 10
    },
    "unitDurationMs": 720000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "OrdnanceCharge"
  },
  {
    "id": "recipe_emp_charge",
    "kind": "consumable",
    "name": "EMP Charge",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 18,
      "BallisticParts": 8,
      "ConduitWire": 4,
      "TechFragments": 2
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 9,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "EMPCharge"
  },
  {
    "id": "recipe_corrosive_charge",
    "kind": "consumable",
    "name": "Corrosive Charge",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 18,
      "BallisticParts": 8,
      "AcidCompound": 4,
      "TechFragments": 2
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 9,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "CorrosiveCharge"
  },
  {
    "id": "recipe_overcharge",
    "kind": "consumable",
    "name": "Overcharge Stim",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 25,
      "BallisticParts": 15,
      "VoidDust": 2
    },
    "unitDurationMs": 1800000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "OverchargeStim"
  },
  {
    "id": "recipe_targetpainter",
    "kind": "consumable",
    "name": "Target Painter",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 20,
      "BallisticParts": 10,
      "TechFragments": 2
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "TargetPainter"
  },
  {
    "id": "recipe_phaseshift",
    "kind": "consumable",
    "name": "Phase Shift Grenade",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 30,
      "BallisticParts": 15,
      "VoidDust": 5
    },
    "unitDurationMs": 2100000,
    "requiresLevel": 18,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "PhaseShiftGrenade"
  },
  {
    "id": "recipe_luck",
    "kind": "consumable",
    "name": "Luck Booster",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 15,
      "TechFragments": 8
    },
    "unitDurationMs": 900000,
    "requiresLevel": 5,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "LuckBooster"
  },
  {
    "id": "recipe_scanner",
    "kind": "consumable",
    "name": "Boss Scanner",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 20,
      "TechFragments": 12
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 10,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "BossScanner"
  },
  {
    "id": "recipe_insurance",
    "kind": "consumable",
    "name": "Insurance Token",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 30,
      "TechFragments": 15,
      "VoidDust": 2
    },
    "unitDurationMs": 2100000,
    "requiresLevel": 15,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "InsuranceToken"
  },
  {
    "id": "recipe_dataskimmer",
    "kind": "consumable",
    "name": "Data Skimmer",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 25,
      "TechFragments": 15,
      "VoidDust": 3
    },
    "unitDurationMs": 2400000,
    "requiresLevel": 18,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "DataSkimmer"
  },
  {
    "id": "recipe_jammer",
    "kind": "consumable",
    "name": "Jammer",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 20,
      "TechFragments": 10,
      "ConduitWire": 2
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "Jammer"
  },
  {
    "id": "recipe_magnetized",
    "kind": "consumable",
    "name": "Magnetized Payload",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 10,
      "TechFragments": 5
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 10,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "MagnetizedPayload"
  },
  {
    "id": "recipe_signal_scrambler",
    "kind": "consumable",
    "name": "Signal Scrambler",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 15,
      "TechFragments": 10,
      "ConduitWire": 2
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 7,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "SignalScrambler"
  },
  {
    "id": "recipe_loot_beacon",
    "kind": "consumable",
    "name": "Loot Beacon",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 20,
      "TechFragments": 14,
      "VoidDust": 2
    },
    "unitDurationMs": 1800000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "LootBeacon"
  },
  {
    "id": "recipe_salvage_contract",
    "kind": "consumable",
    "name": "Salvage Contract",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 12,
      "TechFragments": 8
    },
    "unitDurationMs": 960000,
    "requiresLevel": 5,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "SalvageContract"
  },
  {
    "id": "recipe_workshop_rush_ticket",
    "kind": "consumable",
    "name": "Workshop Rush Ticket",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 18,
      "TechFragments": 12,
      "VoidDust": 1
    },
    "unitDurationMs": 1440000,
    "requiresLevel": 10,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "WorkshopRushTicket"
  },
  {
    "id": "recipe_patch_kit",
    "kind": "consumable",
    "name": "Patch Kit",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 4,
      "ReactiveComponents": 1
    },
    "unitDurationMs": 720000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "PatchKit"
  },
  {
    "id": "recipe_field_patch_kit",
    "kind": "consumable",
    "name": "Field Patch Kit",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 6,
      "ReactiveComponents": 3,
      "TechFragments": 1,
      "HeartwoodResin": 1
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "FieldPatchKit"
  },
  {
    "id": "recipe_master_patch_kit",
    "kind": "consumable",
    "name": "Master Patch Kit",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 8,
      "ReactiveComponents": 5,
      "TechFragments": 3,
      "VoidDust": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "requiresMastery": {
      "track": "crafting_consumables",
      "level": 15
    },
    "consumableType": "MasterPatchKit"
  },
  {
    "id": "recipe_fuel_cell",
    "kind": "consumable",
    "name": "Fuel Cell",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 6,
      "NitrocellGel": 1
    },
    "unitDurationMs": 900000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "FuelCell"
  },
  {
    "id": "recipe_calibration_core",
    "kind": "consumable",
    "name": "Calibration Core",
    "category": "utility",
    "inputs": {
      "ReactiveComponents": 20,
      "TechFragments": 15,
      "PrismShards": 2,
      "VoidDust": 2
    },
    "unitDurationMs": 2400000,
    "requiresLevel": 15,
    "requiresBench": 2,
    "station": "bench",
    "consumableType": "CalibrationCore"
  },
  {
    "id": "refine_refined_alloy",
    "kind": "refine",
    "name": "Refined Alloy",
    "category": "refining",
    "inputs": {
      "ScrapAlloy": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "RefinedAlloy",
    "outputBase": 8
  },
  {
    "id": "refine_tempered_parts",
    "kind": "refine",
    "name": "Tempered Parts",
    "category": "refining",
    "inputs": {
      "BallisticParts": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "TemperedParts",
    "outputBase": 8
  },
  {
    "id": "refine_stabilized_cells",
    "kind": "refine",
    "name": "Stabilized Cells",
    "category": "refining",
    "inputs": {
      "ReactiveComponents": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "StabilizedCells",
    "outputBase": 8
  },
  {
    "id": "refine_woven_circuits",
    "kind": "refine",
    "name": "Woven Circuits",
    "category": "refining",
    "inputs": {
      "TechFragments": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "WovenCircuits",
    "outputBase": 8
  },
  {
    "id": "refine_condensed_void",
    "kind": "refine",
    "name": "Condensed Void",
    "category": "refining",
    "inputs": {
      "VoidDust": 10
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "CondensedVoid",
    "outputBase": 8
  },
  {
    "id": "refine_composite_plating",
    "kind": "refine",
    "name": "Composite Plating",
    "category": "refining",
    "inputs": {
      "RefinedAlloy": 4,
      "StabilizedCells": 2
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "furnace",
    "outputMaterial": "CompositePlating",
    "outputBase": 2
  },
  {
    "id": "refine_circuit_lattice",
    "kind": "refine",
    "name": "Circuit Lattice",
    "category": "refining",
    "inputs": {
      "WovenCircuits": 4,
      "TemperedParts": 2
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "furnace",
    "outputMaterial": "CircuitLattice",
    "outputBase": 2
  },
  {
    "id": "refine_voidweave",
    "kind": "refine",
    "name": "Voidweave",
    "category": "refining",
    "inputs": {
      "CondensedVoid": 2,
      "WovenCircuits": 2
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "furnace",
    "outputMaterial": "Voidweave",
    "outputBase": 2
  },
  {
    "id": "frame_weapon",
    "kind": "gear",
    "name": "Weapon Frame",
    "category": "gear",
    "inputs": {
      "RefinedAlloy": 6,
      "TemperedParts": 4,
      "ForgeheartIngots": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "weapon",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_shield",
    "kind": "gear",
    "name": "Shield Frame",
    "category": "gear",
    "inputs": {
      "StabilizedCells": 6,
      "RefinedAlloy": 4,
      "HeartwoodResin": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "shield",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_class_mod",
    "kind": "gear",
    "name": "Class Mod Frame",
    "category": "gear",
    "inputs": {
      "WovenCircuits": 5,
      "CircuitLattice": 2,
      "PrismShards": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "classMod",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_relic",
    "kind": "gear",
    "name": "Relic Frame",
    "category": "gear",
    "inputs": {
      "CondensedVoid": 4,
      "Voidweave": 2,
      "MycoSteelFiber": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "relic",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_ordnance",
    "kind": "gear",
    "name": "Ordnance Frame",
    "category": "gear",
    "inputs": {
      "TemperedParts": 6,
      "StabilizedCells": 3,
      "ForgeheartIngots": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "ordnance",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "tool_precision_calipers",
    "kind": "tool",
    "name": "Precision Calipers",
    "category": "tools",
    "inputs": {
      "CircuitLattice": 2,
      "PrismShards": 2
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "toolId": "tool_precision_calipers"
  },
  {
    "id": "tool_servo_bench_rig",
    "kind": "tool",
    "name": "Servo Bench Rig",
    "category": "tools",
    "inputs": {
      "CompositePlating": 2,
      "MagnetiteCores": 2
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "toolId": "tool_servo_bench_rig"
  },
  {
    "id": "tool_reclaimer_head",
    "kind": "tool",
    "name": "Reclaimer Head",
    "category": "tools",
    "inputs": {
      "CompositePlating": 1,
      "CircuitLattice": 1,
      "Voidweave": 1
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "toolId": "tool_reclaimer_head"
  },
  {
    "id": "recipe_shield_cell_batch",
    "kind": "consumable",
    "name": "Shield Cell ×3 (Batch)",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 50,
      "ReactiveComponents": 30
    },
    "unitDurationMs": 1980000,
    "requiresLevel": 3,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ShieldCell",
    "requiresResearch": "production_systems",
    "outputQuantity": 3
  },
  {
    "id": "recipe_patch_kit_batch",
    "kind": "consumable",
    "name": "Patch Kit ×3 (Batch)",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 10,
      "ReactiveComponents": 3
    },
    "unitDurationMs": 1584000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "PatchKit",
    "requiresResearch": "production_systems",
    "outputQuantity": 3
  },
  {
    "id": "recipe_ordnance_batch",
    "kind": "consumable",
    "name": "Ordnance Charge ×3 (Batch)",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 30,
      "BallisticParts": 25
    },
    "unitDurationMs": 1584000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "OrdnanceCharge",
    "requiresResearch": "production_systems",
    "outputQuantity": 3
  },
  {
    "id": "recipe_redline_standing",
    "kind": "consumable",
    "name": "Redline Tonic",
    "category": "offense",
    "inputs": {
      "BallisticParts": 12,
      "NitrocellGel": 2,
      "ReactiveComponents": 6
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "RedlineTonic",
    "requiresStanding": {
      "manufacturer": "Redline",
      "rank": 2
    }
  },
  {
    "id": "recipe_ironwood_standing",
    "kind": "consumable",
    "name": "Heartwood Sight Oil",
    "category": "offense",
    "inputs": {
      "HeartwoodResin": 2,
      "TechFragments": 10,
      "ReactiveComponents": 6
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "HeartwoodSightOil",
    "requiresStanding": {
      "manufacturer": "Ironwood",
      "rank": 2
    }
  },
  {
    "id": "recipe_blastforge_standing",
    "kind": "consumable",
    "name": "Forgeheart Charge",
    "category": "offense",
    "inputs": {
      "ForgeheartIngots": 2,
      "BallisticParts": 12,
      "ReactiveComponents": 8
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ForgeheartCharge",
    "requiresStanding": {
      "manufacturer": "BlastForge",
      "rank": 2
    }
  },
  {
    "id": "recipe_prismatek_standing",
    "kind": "consumable",
    "name": "Prism Coating",
    "category": "offense",
    "inputs": {
      "PrismShards": 2,
      "VoidEssence": 3,
      "TechFragments": 8
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "PrismCoating",
    "requiresStanding": {
      "manufacturer": "Prismatek",
      "rank": 2
    }
  },
  {
    "id": "recipe_throwtech_standing",
    "kind": "consumable",
    "name": "ThrowTech Decoy Kit",
    "category": "utility",
    "inputs": {
      "MagnetiteCores": 2,
      "TechFragments": 12,
      "ScrapAlloy": 20
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ThrowTechDecoyKit",
    "requiresStanding": {
      "manufacturer": "ThrowTech",
      "rank": 2
    }
  },
  {
    "id": "recipe_helixworks_standing",
    "kind": "consumable",
    "name": "Helix Calibration Kit",
    "category": "utility",
    "inputs": {
      "Siltglass": 2,
      "TechFragments": 12,
      "VoidDust": 2
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "HelixCalibrationKit",
    "requiresStanding": {
      "manufacturer": "HelixWorks",
      "rank": 2
    }
  }
]
$catalog$::jsonb
$$;


-- ---------------------------------------------------------------------------
-- ── Restated cc_craft_quality_bounds (0043 body + the Calibration Core row, 0044) ──
-- ---------------------------------------------------------------------------

create or replace function public.cc_craft_quality_bounds(
  p_item_key text,
  p_mastery_level integer,
  p_bench integer,
  p_catalyst boolean,
  p_quality_shift numeric
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_base_min numeric;
  v_base_max numeric;
  v_cap numeric := 175;
  v_mastery numeric := greatest(1, coalesce(p_mastery_level, 1));
  v_min numeric;
  v_max numeric;
begin
  select craft_min, craft_max into v_base_min, v_base_max
  from (values
    ('MedKit', 75::numeric, 125::numeric),
    ('MedKitRefined', 80::numeric, 140::numeric),
    ('ShieldCell', 75::numeric, 130::numeric),
    ('NanoSwarm', 80::numeric, 145::numeric),
    ('AdrenalineShot', 75::numeric, 150::numeric),
    ('AmmoPack', 70::numeric, 125::numeric),
    ('HighCapacityAmmoPack', 75::numeric, 140::numeric),
    ('ArmorPiercingAmmo', 75::numeric, 135::numeric),
    ('IncendiaryAmmo', 75::numeric, 140::numeric),
    ('ShockAmmo', 75::numeric, 140::numeric),
    ('CorrosiveAmmo', 75::numeric, 140::numeric),
    ('CryoAmmo', 75::numeric, 140::numeric),
    ('VoidAmmo', 70::numeric, 155::numeric),
    ('OrdnanceCharge', 75::numeric, 145::numeric),
    ('EMPCharge', 75::numeric, 145::numeric),
    ('CorrosiveCharge', 75::numeric, 145::numeric),
    ('OverchargeStim', 70::numeric, 150::numeric),
    ('TargetPainter', 75::numeric, 145::numeric),
    ('PhaseShiftGrenade', 75::numeric, 155::numeric),
    ('LuckBooster', 75::numeric, 135::numeric),
    ('BossScanner', 80::numeric, 160::numeric),
    ('InsuranceToken', 80::numeric, 145::numeric),
    ('DataSkimmer', 75::numeric, 150::numeric),
    ('Jammer', 75::numeric, 150::numeric),
    ('MagnetizedPayload', 75::numeric, 150::numeric),
    ('SignalScrambler', 75::numeric, 145::numeric),
    ('LootBeacon', 70::numeric, 150::numeric),
    ('SalvageContract', 75::numeric, 150::numeric),
    ('WorkshopRushTicket', 75::numeric, 150::numeric),
    ('PatchKit', 75::numeric, 130::numeric),
    ('FieldPatchKit', 75::numeric, 140::numeric),
    ('MasterPatchKit', 80::numeric, 160::numeric),
    ('FuelCell', 75::numeric, 150::numeric),
    ('CalibrationCore', 75::numeric, 150::numeric),
    ('RedlineTonic', 70::numeric, 150::numeric),
    ('HeartwoodSightOil', 75::numeric, 150::numeric),
    ('ForgeheartCharge', 70::numeric, 150::numeric),
    ('PrismCoating', 75::numeric, 150::numeric),
    ('ThrowTechDecoyKit', 75::numeric, 150::numeric),
    ('HelixCalibrationKit', 75::numeric, 150::numeric)
  ) as bounds(consumable_type, craft_min, craft_max)
  where consumable_type = p_item_key;

  v_min := coalesce(v_base_min, 75)
    + least(20, 1.5 * (v_mastery - 1))
    + case when coalesce(p_bench, 1) >= 3 then 5 else 0 end
    + coalesce(p_quality_shift, 0);
  v_max := coalesce(v_base_max, 150)
    + least(25, 2.0 * (v_mastery - 1))
    + coalesce(p_quality_shift, 0);
  if coalesce(p_catalyst, false) then
    v_min := v_min + 10;
    v_max := v_max + 15;
  end if;
  v_max := least(v_max, 175);
  if v_min > v_max then v_min := v_max; end if;
  return jsonb_build_object('min', v_min, 'max', v_max, 'cap', v_cap);
end;
$$;


-- ---------------------------------------------------------------------------
-- Restated cc_compute_economy_metrics (0043 body + the shield-tech panel,
-- 0044). The Research, Contracts and Standing panels are carried verbatim;
-- the shield-tech fee enters credits_destroyed_total.
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
  sj record;
  er record;
  sd record;
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
     + coalesce(sum((result_payload -> 'market_fee' ->> 'cache_rank_proceeds_bonus')::bigint)
        filter (where action_type = 'cc_accept_listing'), 0)
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
    count(*) filter (where action_type = 'cc_make_item' and coalesce(result_payload ->> 'payment', 'key') = 'free') as cache_boxes_opened_free,
    count(*) filter (where action_type = 'cc_make_item' and coalesce(result_payload ->> 'payment', 'key') = 'ad') as cache_boxes_opened_ad,
    count(*) filter (where action_type = 'cc_make_item' and coalesce(result_payload ->> 'payment', 'key') = 'key') as cache_boxes_opened_key,
    coalesce(sum((result_payload ->> 'cache_keys_awarded')::bigint)
      filter (where action_type = 'cc_leaderboard_settlement'), 0) as cache_keys_from_leaderboards,
    count(*) filter (where action_type in ('cc_make_item', 'cc_draw_item')) as cache_opens,
    coalesce(sum((result_payload -> 'rewards' ->> 'cache_fragments_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_fragments_awarded,
    -- Legendary salvage + cores (0026): destroyed legendaries are a
    -- LEDGER fact (the recycle result carries the consumed item) —
    -- distinct from legendaries_minted_by_source above, which counts
    -- item_instances at creation. No double counting: creation and
    -- destruction are separate meters by design.
    count(*) filter (where action_type = 'cc_recycle_item'
      and result_payload -> 'item' ->> 'rarity' = 'Legendary') as legendaries_salvaged,
    coalesce(sum((result_payload ->> 'cores_award')::bigint)
      filter (where action_type = 'cc_recycle_item'), 0) as legendary_cores_minted,
    -- Cache Rank (0031): token meters — counted from the grant /
    -- spend ledger payloads (tokens are not credits; these never
    -- enter the minted/destroyed credit totals).
    coalesce(sum((result_payload ->> 'tokens_granted')::bigint)
      filter (where action_type = 'cc_cache_rank_grant'), 0) as cache_rank_tokens_granted,
    coalesce(sum((result_payload ->> 'cost')::bigint)
      filter (where action_type = 'cc_cache_rank_spend'), 0) as cache_rank_tokens_spent,
    (coalesce(sum((result_payload -> 'job' ->> 'escrow_cores')::bigint)
        filter (where action_type = 'cc_enqueue_craft_job'), 0)
     - coalesce(sum((result_payload ->> 'cores_refunded')::bigint)
        filter (where action_type = 'cc_cancel_craft_job'), 0)
     -- Reforge (0027): cores destroyed outright extend the spent
     -- meter — each destroyed core is counted exactly once, here;
     -- the dedicated column below breaks the reforge share out.
     + coalesce(sum((result_payload ->> 'cores_charged')::bigint)
        filter (where action_type = 'cc_reforge_item'), 0)) as legendary_cores_spent,
    -- Reforge meters (0027): completions, scrap destroyed, cores
    -- destroyed — all ledger facts from cc_reforge_item results.
    count(*) filter (where action_type = 'cc_reforge_item') as reforges_completed,
    coalesce(sum((result_payload ->> 'scrap_charged')::bigint)
      filter (where action_type = 'cc_reforge_item'), 0) as scrap_destroyed_reforge,
    coalesce(sum((result_payload ->> 'cores_charged')::bigint)
      filter (where action_type = 'cc_reforge_item'), 0) as legendary_cores_destroyed_reforge,
    -- Endless meters (0028): runs, encounters, fees, payouts — all
    -- ledger facts from the three endless appliers' result payloads.
    -- Run-end payouts appear on cc_end_endless_run (bank), on
    -- cc_apply_endless_encounter (death / depth-cap bank), and as
    -- abandoned_settlement inside cc_start_endless_run.
    count(*) filter (where action_type = 'cc_start_endless_run') as endless_runs_started,
    (count(*) filter (where action_type = 'cc_end_endless_run'
        and coalesce((result_payload ->> 'ended')::boolean, false))
     + count(*) filter (where action_type = 'cc_apply_endless_encounter'
        and result_payload ->> 'run_status' in ('died', 'banked'))
     + count(*) filter (where action_type = 'cc_start_endless_run'
        and result_payload -> 'abandoned_settlement' is not null
        and result_payload -> 'abandoned_settlement' <> 'null'::jsonb)) as endless_runs_ended,
    count(*) filter (where action_type = 'cc_apply_endless_encounter'
      and coalesce((result_payload ->> 'victory')::boolean, false)) as endless_encounters_cleared,
    coalesce(sum((result_payload ->> 'entry_fee')::bigint)
      filter (where action_type = 'cc_start_endless_run'), 0) as endless_fees_destroyed,
    (coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'credits')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as endless_credits_paid,
    (coalesce(sum((result_payload -> 'payout' ->> 'xp')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'xp')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as endless_xp_paid,
    -- Action skill fires (0030): counted from the appliers' recorded
    -- action_skill blocks; the workshop fire's own ledger rows are
    -- Fixer fires. Firing moves no currency — these are pure counts.
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Gunslinger') as action_skill_fires_gunslinger,
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Demolition') as action_skill_fires_demolition,
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Scavenger') as action_skill_fires_scavenger,
    (count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
        and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
        and result_payload -> 'action_skill' ->> 'tree' = 'Fixer')
     + count(*) filter (where action_type = 'cc_fire_overclock_workshop')) as action_skill_fires_fixer,
    -- Dispatch meters (0032): foot + courier settle payouts — real
    -- mints from the cc_dispatch_settle ledger payloads (recalls
    -- included: a pro-rata payout is still a payout). The courier
    -- column is the premium family's breakout of the same fold.
    coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
      filter (where action_type = 'cc_dispatch_settle'
        and result_payload ->> 'family' = 'foot'), 0) as minted_dispatch,
    coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
      filter (where action_type = 'cc_dispatch_settle'
        and result_payload ->> 'family' = 'courier'), 0) as minted_courier,
    coalesce(sum((result_payload ->> 'passes_completed')::bigint)
      filter (where action_type = 'cc_apply_extraction'), 0) as extraction_passes,
    coalesce(sum((result_payload ->> 'xp_awarded')::bigint)
      filter (where action_type = 'cc_apply_extraction'), 0) as extraction_xp,
    -- Login streak (0036): the day's cc_login_streak_claim grants.
    -- Credits are a real faucet and fold into the minted total
    -- below; fragments and keys are metered as their own sources,
    -- distinct from roaming fragments, leaderboard keys, and
    -- ad-lane key issuance.
    coalesce(sum((result_payload ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_login_streak_claim'), 0) as minted_login_streak,
    coalesce(sum((result_payload ->> 'fragments_awarded')::bigint)
      filter (where action_type = 'cc_login_streak_claim'), 0) as fragments_login_streak,
    coalesce(sum((result_payload ->> 'cache_keys_awarded')::bigint)
      filter (where action_type = 'cc_login_streak_claim'), 0) as keys_login_streak,
    -- Research (0038): enrollments, completions, and the enrollment
    -- fees destroyed at enroll (ledger facts; the destroyed fold
    -- joins credits_destroyed_total below — Research is the sink).
    count(*) filter (where action_type = 'cc_enroll_research') as research_started,
    count(*) filter (where action_type = 'cc_research_complete') as research_completed,
    coalesce(sum((result_payload ->> 'cost_credits')::bigint)
      filter (where action_type = 'cc_enroll_research'), 0) as research_destroyed,
    -- Contracts board (0042): claim/set-bonus mints, reroll
    -- scrap destroyed, keys awarded, expired-unclaimed count
    -- (ledger + instance facts; minted joins minted_total).
      coalesce(sum((result_payload ->> 'credits_awarded')::bigint)
        filter (where action_type in ('cc_claim_contract_reward', 'cc_claim_contract_set_bonus')), 0) as minted_contracts,
      coalesce(count(*)
        filter (where action_type = 'cc_claim_contract_reward'), 0) as contracts_claimed,
      coalesce(count(*)
        filter (where action_type = 'cc_reroll_contract'), 0) as contract_rerolls,
      coalesce(sum((result_payload ->> 'scrap_charged')::bigint)
        filter (where action_type = 'cc_reroll_contract'), 0) as scrap_destroyed_contract_rerolls,
      coalesce(sum((result_payload ->> 'cache_keys_awarded')::bigint)
        filter (where action_type = 'cc_claim_contract_set_bonus'), 0) as contract_keys_awarded,
      (select count(*) from public.contract_instances ci
        where ci.status = 'active'
          and ((ci.period_kind = 'daily' and ci.period_key = (_day - 1)::text)
            or (ci.period_kind = 'weekly' and ci.period_key = (_day - 7)::text))) as contracts_expired_unclaimed,
    -- Manufacturer Standing (0043): turn-in points by manufacturer,
    -- rank-ups by manufacturer, tribute + desk purchases destroyed,
    -- orders fulfilled — all from the day's standing ledger rows.
    -- Turned-in legendaries deliberately do NOT join
    -- legendaries_salvaged (that meter is cc_recycle_item only): a
    -- turn-in mints no cores and pays no scrap.
    (select coalesce(jsonb_object_agg(manufacturer, points), '{}'::jsonb)
       from (select l2.result_payload ->> 'manufacturer' as manufacturer,
                    sum((l2.result_payload ->> 'standing_awarded')::bigint) as points
               from public.verified_action_ledger l2
              where l2.action_type = 'cc_turn_in_item'
                and l2.created_at >= v_start and l2.created_at < v_end
                and l2.result_payload ->> 'manufacturer' is not null
              group by 1) t) as standing_turn_in_points,
    count(*) filter (where action_type = 'cc_turn_in_item') as standing_turn_ins,
    count(*) filter (where action_type = 'cc_rank_up_manufacturer'
      and result_payload ->> 'tribute_item_id' is not null) as standing_tribute_items,
    coalesce(sum((result_payload ->> 'tribute_credits')::bigint)
      filter (where action_type = 'cc_rank_up_manufacturer'), 0) as standing_tribute_destroyed,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type in ('cc_standing_buy', 'cc_standing_order_weapon')), 0) as standing_purchases_destroyed,
    (select coalesce(jsonb_object_agg(manufacturer, rank_ups), '{}'::jsonb)
       from (select l3.result_payload ->> 'manufacturer' as manufacturer,
                    count(*)::bigint as rank_ups
               from public.verified_action_ledger l3
              where l3.action_type = 'cc_rank_up_manufacturer'
                and l3.created_at >= v_start and l3.created_at < v_end
                and l3.result_payload ->> 'manufacturer' is not null
              group by 1) t) as standing_rank_ups,
    count(*) filter (where action_type = 'cc_standing_order_weapon') as standing_orders
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

  -- Shield-tech meters (0044): the repair panel's shape for the
  -- shield_tech profession — job-level facts from service_jobs at
  -- their terminal day (posted at posting day); Calibration Core
  -- consumption counted per board job plus per completed self-lane
  -- unit output, the same settle-day stamp the craft meters use.
  select
    (select count(*) from public.service_jobs j
      where j.profession_id = 'shield_tech'
        and j.created_at >= v_start and j.created_at < v_end) as jobs_posted,
    (select count(*) from public.service_jobs j
      where j.profession_id = 'shield_tech' and j.status = 'completed'
        and j.completed_at >= v_start and j.completed_at < v_end)::integer as jobs_completed,
    (select coalesce(sum(j.points_restored), 0) from public.service_jobs j
      where j.profession_id = 'shield_tech'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled')) as points_calibrated,
    (select coalesce(sum(j.paid_credits), 0) from public.service_jobs j
      where j.profession_id = 'shield_tech'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as credits_volume,
    (select coalesce(sum(j.fee_credits), 0) from public.service_jobs j
      where j.profession_id = 'shield_tech'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as fees_destroyed,
    (select coalesce(sum(j.xp_awarded), 0) from public.service_jobs j
      where j.profession_id = 'shield_tech'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as xp_awarded,
    ((select coalesce(sum(jsonb_array_length(j.kits_consumed)), 0)
        from public.service_jobs j
       where j.profession_id = 'shield_tech'
         and j.completed_at >= v_start and j.completed_at < v_end
         and j.status in ('completed', 'cancelled'))
     + (select count(*) from public.craft_jobs j,
              lateral jsonb_array_elements(j.outputs) o
         where o ->> 'kind' = 'shieldtech'
           and (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
           and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint
           and not coalesce((o ->> 'shieldUnavailable')::boolean, false)))::integer as cores_consumed
  into sj;

  -- Endless depth + milestone facts (0028): deepest run ENDED today
  -- (bank, death, cap, or carried-out abandonment — each ending is a
  -- ledger fact on its own row), and milestone drops by rarity from
  -- the encounter payloads that recorded them.
  select
    (select coalesce(max(d), 0)::integer from (
       select (result_payload ->> 'depth_reached')::integer as d
         from public.verified_action_ledger
        where action_type = 'cc_end_endless_run'
          and coalesce((result_payload ->> 'ended')::boolean, false)
          and created_at >= v_start and created_at < v_end
       union all
       select (result_payload ->> 'depth')::integer
         from public.verified_action_ledger
        where action_type = 'cc_apply_endless_encounter'
          and result_payload ->> 'run_status' in ('died', 'banked')
          and created_at >= v_start and created_at < v_end
       union all
       select (result_payload -> 'abandoned_settlement' ->> 'depth_reached')::integer
         from public.verified_action_ledger
        where action_type = 'cc_start_endless_run'
          and result_payload -> 'abandoned_settlement' is not null
          and result_payload -> 'abandoned_settlement' <> 'null'::jsonb
          and created_at >= v_start and created_at < v_end
     ) depths) as deepest_depth,
    (select count(*)::integer
       from public.verified_action_ledger
      where action_type = 'cc_apply_endless_encounter'
        and created_at >= v_start and created_at < v_end
        and result_payload -> 'milestone_drop' ->> 'rarity' is not null) as milestone_drops,
    (select coalesce(jsonb_object_agg(g.rarity, g.cnt), '{}'::jsonb)
       from (
         select result_payload -> 'milestone_drop' ->> 'rarity' as rarity,
                count(*)::integer as cnt
           from public.verified_action_ledger
          where action_type = 'cc_apply_endless_encounter'
            and created_at >= v_start and created_at < v_end
            and result_payload -> 'milestone_drop' ->> 'rarity' is not null
          group by 1
       ) g) as milestone_by_rarity
  into er;


  -- Manufacturer Standing (0043): the day's use-drip points by
  -- manufacturer, from the daily counter table (the accrual writes
  -- no per-claim ledger rows by design).
  select coalesce(jsonb_object_agg(manufacturer, points), '{}'::jsonb) as drip_points
    into sd
    from (select d.manufacturer, sum(d.drip_points) as points
            from public.manufacturer_standing_daily d
           where d.utc_day = _day
           group by 1) t;

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other
    + m.endless_credits_paid + m.minted_dispatch + m.minted_courier
    + m.minted_login_streak
    + m.minted_contracts;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees
    + rj.fees_destroyed + sj.fees_destroyed + m.endless_fees_destroyed + m.research_destroyed
    + m.standing_tribute_destroyed + m.standing_purchases_destroyed;

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
    cache_keys_from_ads, cache_keys_from_leaderboards, cache_opens, cache_fragments_awarded,
    cache_boxes_opened_free, cache_boxes_opened_ad, cache_boxes_opened_key,
    craft_jobs_completed, craft_units_completed, craft_xp_awarded,
    materials_destroyed_crafting, refined_units_produced,
    gear_items_crafted, crafted_market_sales, crafted_market_volume,
    repair_jobs_posted, repair_jobs_completed, repair_points_restored,
    repair_credits_volume, repair_fees_destroyed, repair_kits_consumed,
    repair_xp_awarded,
    shieldtech_jobs_posted, shieldtech_jobs_completed,
    shieldtech_points_calibrated, shieldtech_credits_volume,
    shieldtech_fees_destroyed, shieldtech_cores_consumed,
    shieldtech_xp_awarded,
    legendaries_salvaged, legendary_cores_minted, legendary_cores_spent,
    reforges_completed, scrap_destroyed_reforge, legendary_cores_destroyed_reforge,
    endless_runs_started, endless_runs_ended, endless_encounters_cleared,
    endless_deepest_depth, endless_credits_paid, endless_xp_paid,
    endless_fees_destroyed, endless_milestone_drops,
    endless_milestone_drops_by_rarity,
    action_skill_fires_gunslinger, action_skill_fires_demolition,
    action_skill_fires_scavenger, action_skill_fires_fixer,
    cache_rank_tokens_granted, cache_rank_tokens_spent,
    credits_minted_dispatch, credits_minted_courier,
    extraction_passes, extraction_xp_awarded, materials_minted_extraction,
    credits_minted_login_streak, cache_fragments_from_login_streak,
    cache_keys_from_login_streak,
    research_enrollments_started, research_courses_completed,
    research_credits_destroyed,
    credits_minted_contracts, contracts_claimed, contracts_expired_unclaimed,
    contract_rerolls, contract_keys_awarded, scrap_destroyed_contract_rerolls,
    standing_points_awarded, standing_items_destroyed,
    standing_tribute_credits_destroyed, standing_credits_destroyed,
    standing_orders_fulfilled, standing_rank_ups,
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
    m.cache_keys_from_ads, m.cache_keys_from_leaderboards, m.cache_opens, m.cache_fragments_awarded,
    m.cache_boxes_opened_free, m.cache_boxes_opened_ad, m.cache_boxes_opened_key,
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
    sj.jobs_posted, sj.jobs_completed, sj.points_calibrated,
    sj.credits_volume, sj.fees_destroyed, sj.cores_consumed,
    sj.xp_awarded,
    m.legendaries_salvaged, m.legendary_cores_minted, m.legendary_cores_spent,
    m.reforges_completed, m.scrap_destroyed_reforge, m.legendary_cores_destroyed_reforge,
    m.endless_runs_started, m.endless_runs_ended, m.endless_encounters_cleared,
    er.deepest_depth, m.endless_credits_paid, m.endless_xp_paid,
    m.endless_fees_destroyed, er.milestone_drops,
    er.milestone_by_rarity,
    m.action_skill_fires_gunslinger, m.action_skill_fires_demolition,
    m.action_skill_fires_scavenger, m.action_skill_fires_fixer,
    m.cache_rank_tokens_granted, m.cache_rank_tokens_spent,
    m.minted_dispatch, m.minted_courier,
    m.extraction_passes::integer, m.extraction_xp,
    (select coalesce(jsonb_object_agg(key, total), '{}'::jsonb)
       from (
         select f.key, sum((f.value)::bigint) as total
           from public.verified_action_ledger l,
                jsonb_each_text(
                  coalesce(l.result_payload -> 'finds_materials', '{}'::jsonb)
                  || coalesce(l.result_payload -> 'finds_essences', '{}'::jsonb)) as f
          where l.action_type = 'cc_apply_extraction'
            and l.created_at >= v_start and l.created_at < v_end
          group by f.key
         having sum((f.value)::bigint) > 0
       ) minted),
    m.minted_login_streak, m.fragments_login_streak, m.keys_login_streak::integer,
    m.research_started, m.research_completed, m.research_destroyed,
    m.minted_contracts, m.contracts_claimed::integer, m.contracts_expired_unclaimed::integer,
    m.contract_rerolls::integer, m.contract_keys_awarded::integer, m.scrap_destroyed_contract_rerolls,
    jsonb_build_object('turn_in', m.standing_turn_in_points, 'drip', coalesce(sd.drip_points, '{}'::jsonb)),
    (m.standing_turn_ins + m.standing_tribute_items)::integer,
    m.standing_tribute_destroyed,
    (m.standing_tribute_destroyed + m.standing_purchases_destroyed),
    m.standing_orders::integer, m.standing_rank_ups,
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
    cache_keys_from_leaderboards = excluded.cache_keys_from_leaderboards,
    cache_opens = excluded.cache_opens,
    cache_fragments_awarded = excluded.cache_fragments_awarded,
    cache_boxes_opened_free = excluded.cache_boxes_opened_free,
    cache_boxes_opened_ad = excluded.cache_boxes_opened_ad,
    cache_boxes_opened_key = excluded.cache_boxes_opened_key,
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
    shieldtech_jobs_posted = excluded.shieldtech_jobs_posted,
    shieldtech_jobs_completed = excluded.shieldtech_jobs_completed,
    shieldtech_points_calibrated = excluded.shieldtech_points_calibrated,
    shieldtech_credits_volume = excluded.shieldtech_credits_volume,
    shieldtech_fees_destroyed = excluded.shieldtech_fees_destroyed,
    shieldtech_cores_consumed = excluded.shieldtech_cores_consumed,
    shieldtech_xp_awarded = excluded.shieldtech_xp_awarded,
    legendaries_salvaged = excluded.legendaries_salvaged,
    legendary_cores_minted = excluded.legendary_cores_minted,
    legendary_cores_spent = excluded.legendary_cores_spent,
    reforges_completed = excluded.reforges_completed,
    scrap_destroyed_reforge = excluded.scrap_destroyed_reforge,
    legendary_cores_destroyed_reforge = excluded.legendary_cores_destroyed_reforge,
    endless_runs_started = excluded.endless_runs_started,
    endless_runs_ended = excluded.endless_runs_ended,
    endless_encounters_cleared = excluded.endless_encounters_cleared,
    endless_deepest_depth = excluded.endless_deepest_depth,
    endless_credits_paid = excluded.endless_credits_paid,
    endless_xp_paid = excluded.endless_xp_paid,
    endless_fees_destroyed = excluded.endless_fees_destroyed,
    endless_milestone_drops = excluded.endless_milestone_drops,
    endless_milestone_drops_by_rarity = excluded.endless_milestone_drops_by_rarity,
    action_skill_fires_gunslinger = excluded.action_skill_fires_gunslinger,
    action_skill_fires_demolition = excluded.action_skill_fires_demolition,
    action_skill_fires_scavenger = excluded.action_skill_fires_scavenger,
    action_skill_fires_fixer = excluded.action_skill_fires_fixer,
    cache_rank_tokens_granted = excluded.cache_rank_tokens_granted,
    cache_rank_tokens_spent = excluded.cache_rank_tokens_spent,
    credits_minted_dispatch = excluded.credits_minted_dispatch,
    credits_minted_courier = excluded.credits_minted_courier,
    extraction_passes = excluded.extraction_passes,
    extraction_xp_awarded = excluded.extraction_xp_awarded,
    materials_minted_extraction = excluded.materials_minted_extraction,
    credits_minted_login_streak = excluded.credits_minted_login_streak,
    cache_fragments_from_login_streak = excluded.cache_fragments_from_login_streak,
    cache_keys_from_login_streak = excluded.cache_keys_from_login_streak,
    research_enrollments_started = excluded.research_enrollments_started,
    research_courses_completed = excluded.research_courses_completed,
    research_credits_destroyed = excluded.research_credits_destroyed,
    credits_minted_contracts = excluded.credits_minted_contracts,
    contracts_claimed = excluded.contracts_claimed,
    contracts_expired_unclaimed = excluded.contracts_expired_unclaimed,
    contract_rerolls = excluded.contract_rerolls,
    contract_keys_awarded = excluded.contract_keys_awarded,
    scrap_destroyed_contract_rerolls = excluded.scrap_destroyed_contract_rerolls,
    standing_points_awarded = excluded.standing_points_awarded,
    standing_items_destroyed = excluded.standing_items_destroyed,
    standing_tribute_credits_destroyed = excluded.standing_tribute_credits_destroyed,
    standing_credits_destroyed = excluded.standing_credits_destroyed,
    standing_orders_fulfilled = excluded.standing_orders_fulfilled,
    standing_rank_ups = excluded.standing_rank_ups,
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;$$;


-- ---------------------------------------------------------------------------
-- Restated cc_add_consumable_batch (0043 body + the shieldtech_refund
-- event type, 0044) — the 0043 precedent: a new consumable flow that
-- writes its own event type extends the validated list and the
-- consumable_events CHECK together. Sole change: the two lists gain
-- 'shieldtech_refund'.
-- ---------------------------------------------------------------------------

alter table public.consumable_events
  drop constraint consumable_events_event_type_check,
  add constraint consumable_events_event_type_check
    check ((event_type = any (array['vendor_buy'::text, 'crafted'::text, 'market_buy'::text, 'market_sell'::text, 'used'::text, 'expired'::text, 'admin_adjust'::text, 'reset'::text, 'standing_buy'::text, 'shieldtech_refund'::text])));

CREATE OR REPLACE FUNCTION public.cc_add_consumable_batch(p_owner_id uuid, p_item_key text, p_quantity integer, p_quality_percent numeric DEFAULT 100, p_origin text DEFAULT 'vendor'::text, p_creator_id uuid DEFAULT NULL::uuid, p_source_recipe_id text DEFAULT NULL::text, p_event_type text DEFAULT 'vendor_buy'::text, p_reason text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  qty integer := greatest(1, coalesce(p_quantity, 1));
  q numeric := greatest(1, least(250, coalesce(p_quality_percent, 100)));
  batch_id uuid;
begin
  if p_owner_id is null then raise exception 'owner_id is required'; end if;
  if p_item_key is null or length(trim(p_item_key)) = 0 then raise exception 'item_key is required'; end if;
  if p_origin not in ('vendor', 'crafted', 'market', 'reward', 'admin', 'standing') then raise exception 'invalid consumable origin'; end if;
  if p_event_type not in ('vendor_buy', 'crafted', 'market_buy', 'market_sell', 'used', 'expired', 'admin_adjust', 'reset', 'standing_buy', 'shieldtech_refund') then raise exception 'invalid consumable event type'; end if;

  select b.id into batch_id
  from public.consumable_batches b
  where b.owner_user_id = p_owner_id
    and b.consumable_type = p_item_key
    and b.quality_percent = q
    and b.origin = p_origin
    and coalesce(b.creator_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_creator_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(b.source_recipe_id, '') = coalesce(p_source_recipe_id, '')
  for update
  limit 1;

  if batch_id is null then
    insert into public.consumable_batches(owner_user_id, consumable_type, quality_percent, quantity, origin, creator_user_id, source_recipe_id, metadata)
    values (p_owner_id, p_item_key, q, qty, p_origin, p_creator_id, p_source_recipe_id, coalesce(p_metadata, '{}'::jsonb))
    returning id into batch_id;
  else
    update public.consumable_batches
    set quantity = quantity + qty,
        metadata = coalesce(public.consumable_batches.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where id = batch_id;
  end if;

  insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, reason, metadata)
  values (p_owner_id, batch_id, p_item_key, qty, q, p_event_type, p_reason, coalesce(p_metadata, '{}'::jsonb));

  return batch_id;
end;
$function$;
