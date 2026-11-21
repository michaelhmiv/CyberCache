-- 0104_audit_hardening.sql
--
-- The verified database half of the 2026-11-21 audit extraction
-- (PR #646 reviewed, not merged; this file carries only the sections
-- verified as semantics-preserving hardening, each restated from its
-- chain head with the single noted change):
--
--   1. player_reports table (App Store Guideline 1.2) + POST /api/reports backing.
--   2. Detach ON DELETE RESTRICT FKs on historical market_listings / service_jobs
--      so account deletion cannot be blocked by closed rows.
--   3. cc_delete_account(p_account_id uuid) — transactional account deletion
--      (App Store Guideline 5.1.1(v)): unwinds active listings & service jobs,
--      refunds counterparties, revokes refresh tokens, deletes auth_accounts.
--   4. cc_equip_item & cc_unequip_slot (0097 verbatim + one change):
--      RETURNING * INTO p on the hunter_loadouts sync so returned
--      snapshots are never one step stale.
--   5. cc_recycle_batch (0055 verbatim + one change): exclude gear
--      assigned to benched hunters (0097's existing
--      cc_item_in_any_hunter_loadout helper, called as-is — its
--      parameter names are unchanged, so this file applies cleanly).
--   6. cc_claim_login_streak_day (0101 verbatim + one change):
--      ON CONFLICT (user_id, idempotency_key) DO NOTHING on the ledger
--      write, so a boundary-shift replay cannot 500 a paid claim.
--   7. cc_bank_bench_time (0075 verbatim + one change): require a
--      non-empty p_ad_unit_id (the SQL backstop for the ad gate).
--   8. cc_compute_economy_metrics (0082 verbatim + one change): the
--      scrap_minted_salvage fold counts cc_recycle_item rows only —
--      a cc_recycle_batch row's scrap_award is the sum of its per-item
--      rows, so counting both double-counted batch salvage.
--
-- Deliberately NOT in this file (they return as owner rulings, not
-- silent restatements): the skill-points treeBonus rescope, the
-- vendor/salvage value caps and buyback clamp, the Rep Shelf catalog
-- swaps, the auto-salvage yield scaling, the settle-craft Lane-1 XP
-- change, the snapshot counter redefinitions, the apply_build
-- class-mod outcome, the economy-meter redefinitions (extraction
-- finds, deposit burns, vendor-buyback restore), and any change to
-- the auth_accounts email-or-guest invariant.

-- ---------------------------------------------------------------------
-- 1. Player reports table (App Store Guideline 1.2)
-- ---------------------------------------------------------------------

create table if not exists public.player_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.auth_accounts(id) on delete cascade,
  reported_account_id uuid not null references public.auth_accounts(id) on delete cascade,
  context text not null default 'leaderboard',
  created_at timestamptz not null default now(),
  constraint player_reports_no_self check (reporter_id <> reported_account_id)
);

create index if not exists player_reports_dedup_idx
  on public.player_reports (reporter_id, reported_account_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. Detach ON DELETE RESTRICT FKs on historical market_listings / service_jobs
-- ---------------------------------------------------------------------

alter table public.market_listings
  alter column item_instance_id drop not null;

alter table public.market_listings
  drop constraint if exists market_listings_item_instance_id_fkey,
  add constraint market_listings_item_instance_id_fkey
    foreign key (item_instance_id)
    references public.item_instances(id)
    on delete set null;

alter table public.service_jobs
  alter column target_item_instance_id drop not null;

alter table public.service_jobs
  drop constraint if exists service_jobs_target_item_instance_id_fkey,
  add constraint service_jobs_target_item_instance_id_fkey
    foreign key (target_item_instance_id)
    references public.item_instances(id)
    on delete set null;

-- ---------------------------------------------------------------------
-- 3. cc_delete_account — transactional in-app account deletion
-- ---------------------------------------------------------------------

create or replace function public.cc_delete_account(p_account_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_exists boolean;
  v_job record;
  v_escrow record;
begin
  if p_account_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_account_id::text));

  select exists(select 1 from public.auth_accounts where id = p_account_id) into v_exists;
  if not v_exists then
    return false;
  end if;

  -- 4a. Cancel active market listings owned by this player so no buyer can
  --     purchase an item belonging to a deleted account.
  update public.market_listings
     set status = 'cancelled',
         item_instance_id = null
   where seller_user_id = p_account_id
     and status = 'active';

  -- Detach historical closed listings referencing items owned by this player.
  update public.market_listings
     set item_instance_id = null
   where item_instance_id in (
     select id from public.item_instances where owner_user_id = p_account_id
   );

  -- 4b. Unwind open/accepted/in-progress service jobs where this player is
  --     the PROVIDER so customer items and escrowed credits are never stranded.
  for v_job in
    select id, owner_user_id, target_item_instance_id, escrow_id
      from public.service_jobs
     where provider_user_id = p_account_id
       and status not in ('completed', 'cancelled')
     for update
  loop
    if v_job.escrow_id is not null then
      select * into v_escrow from public.escrow_records where id = v_job.escrow_id for update;
      if found and v_escrow.status = 'held' then
        update public.profiles
           set credits = credits + coalesce(v_escrow.held_credits, 0)
         where id = v_job.owner_user_id;
        update public.escrow_records
           set status = 'refunded', released_at = now()
         where id = v_escrow.id;
      end if;
    end if;

    if v_job.target_item_instance_id is not null then
      update public.item_instances
         set runtime_state = case when is_locked then 'locked' else 'available' end
       where id = v_job.target_item_instance_id
         and owner_user_id = v_job.owner_user_id
         and runtime_state = 'in_service';
    end if;

    update public.service_jobs
       set status = 'cancelled',
           provider_user_id = null
     where id = v_job.id;
  end loop;

  -- Cancel any active service jobs owned by this player & detach historical rows.
  update public.service_jobs
     set status = case when status in ('completed', 'cancelled') then status else 'cancelled' end,
         target_item_instance_id = null
   where owner_user_id = p_account_id
      or target_item_instance_id in (
           select id from public.item_instances where owner_user_id = p_account_id
         );

  -- 4c. Revoke all refresh tokens and delete auth_accounts (cascades profiles,
  --     item_instances, identities, refresh tokens, and owned child rows).
  update public.auth_refresh_tokens
     set revoked_at = now()
   where account_id = p_account_id
     and revoked_at is null;

  delete from public.auth_accounts where id = p_account_id;
  return true;
end;
$function$;

-- ---------------------------------------------------------------------
-- 4. cc_equip_item & cc_unequip_slot — RETURNING * INTO p on loadout sync
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_equip_item(p_player_id uuid, nonce text, item_id uuid, slot_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  cleared_items jsonb := '[]'::jsonb;
  result jsonb;
  vehicle_unlock integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if slot_name not in ('primary','secondary','heavy','ordnance','shield','classMod','relic','vehicle') then raise exception 'Invalid slot'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.runtime_state in ('listed','consumed','salvaged','in_service') then raise exception 'Item state invalid'; end if;
  if not public.cc_item_accepts_slot(coalesce(item.payload, '{}'::jsonb), slot_name) then raise exception 'Item type does not match loadout slot'; end if;

  -- Class-mod binding (reshape slice (a), 0097): a class mod equips
  -- only on the hunter whose tree it boosts. The refusal names the
  -- owning hunter — every "no" carries its remedy.
  if slot_name = 'classMod' then
    declare
      mod_tree text := item.payload ->> 'treeBonus';
      active_tree text := public.cc_profile_active_tree(p);
    begin
      if mod_tree is not null and mod_tree <> active_tree then
        raise exception 'Class mod is bound to % (%) — field % to equip it',
          public.cc_hunter_name_for_tree(mod_tree), mod_tree, public.cc_hunter_name_for_tree(mod_tree);
      end if;
    end;
  end if;

  if slot_name = 'vehicle' then
    -- Owner ruling 2026-11-02: no player-level gate on equip —
    -- ownership is the gate. The class must still resolve (payload
    -- integrity); the ladder value itself is no longer read here.
    vehicle_unlock := public.cc_vehicle_unlock_level(item.payload ->> 'vehicleClassId');
    if vehicle_unlock is null then raise exception 'Unknown vehicle class'; end if;
  end if;

  with cleared as (
    update public.item_instances
    set equipped_slot = null,
        runtime_state = case when is_locked then 'locked' else 'available' end
    where owner_user_id = actor
      and equipped_slot = slot_name
      and id <> item.id
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(cleared)), '[]'::jsonb) into cleared_items from cleared;

  update public.item_instances
  set equipped_slot = slot_name,
      runtime_state = 'equipped'
  where id = item.id
  returning * into item;

-- Assignment sync (0097): the physically equipped set IS the
  -- active hunter's loadout assignment — keep hunter_loadouts
  -- mirroring it (belt picks preserved from the stored assignment).
  update public.profiles
     set hunter_loadouts = public.cc_sync_active_hunter_loadout(p.hunter_loadouts, public.cc_profile_active_hunter(p), public.cc_loadout_snapshot(actor))
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_equip_item',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'items', cleared_items || jsonb_build_array(to_jsonb(item)),
    'loadout', public.cc_loadout_snapshot(actor)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_equip_item', nonce, result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_unequip_slot(p_player_id uuid, nonce text, slot_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if slot_name not in ('primary','secondary','heavy','ordnance','shield','classMod','relic','vehicle') then raise exception 'Invalid slot'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;

  update public.item_instances
  set equipped_slot = null,
      runtime_state = case when is_locked then 'locked' else 'available' end
  where owner_user_id = actor and equipped_slot = slot_name
  returning * into item;

-- Assignment sync (0097): the physically equipped set IS the
  -- active hunter's loadout assignment — keep hunter_loadouts
  -- mirroring it (belt picks preserved from the stored assignment).
  update public.profiles
     set hunter_loadouts = public.cc_sync_active_hunter_loadout(p.hunter_loadouts, public.cc_profile_active_hunter(p), public.cc_loadout_snapshot(actor))
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_unequip_slot',
    'profile', public.cc_profile_snapshot(p),
    'item', case when item.id is null then null else to_jsonb(item) end,
    'slot_name', slot_name,
    'loadout', public.cc_loadout_snapshot(actor)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_unequip_slot', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------
-- 5. cc_recycle_batch — exclude gear assigned to benched hunters
-- ---------------------------------------------------------------------

create or replace function public.cc_recycle_batch(p_player_id uuid, nonce text, p_max_rarity text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  ceiling_rank integer;
  item_ids uuid[];
  item_rarities text[];
  r jsonb;
  i integer;
  n integer := 0;
  scrap_total integer := 0;
  cores_total integer := 0;
  counts_by_rarity jsonb := '{}'::jsonb;
  bonus_materials jsonb := '{}'::jsonb;
  items_out jsonb := '[]'::jsonb;
  bm text;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  ceiling_rank := case p_max_rarity
    when 'Common' then 1
    when 'Uncommon' then 2
    when 'Rare' then 3
    when 'Epic' then 4
    else null
  end;
  if ceiling_rank is null then raise exception 'Invalid salvage ceiling'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  select coalesce(array_agg(id order by id), '{}'::uuid[]),
         coalesce(array_agg(rarity order by id), '{}'::text[])
    into item_ids, item_rarities
    from public.item_instances
   where owner_user_id = actor
     and runtime_state = 'available'
     and is_locked = false
     and not public.cc_item_in_any_hunter_loadout(p.hunter_loadouts, id)
     and kind in ('weapon', 'shield', 'ordnance', 'classMod', 'relic')
     and (case rarity
            when 'Common' then 1
            when 'Uncommon' then 2
            when 'Rare' then 3
            when 'Epic' then 4
            when 'Legendary' then 5
            else 99
          end) <= ceiling_rank;

  n := coalesce(array_length(item_ids, 1), 0);

  for i in 1 .. n loop
    r := public.cc_recycle_item(actor, nonce || ':' || item_ids[i]::text, item_ids[i]);
    scrap_total := scrap_total + coalesce((r ->> 'scrap_award')::integer, 0);
    cores_total := cores_total + coalesce((r ->> 'cores_award')::integer, 0);
    counts_by_rarity := jsonb_set(
      counts_by_rarity,
      array[item_rarities[i]],
      to_jsonb(coalesce((counts_by_rarity ->> item_rarities[i])::integer, 0) + 1),
      true
    );
    bm := r ->> 'bonus_material';
    if bm is not null then
      bonus_materials := jsonb_set(
        bonus_materials,
        array[bm],
        to_jsonb(coalesce((bonus_materials ->> bm)::integer, 0) + 1),
        true
      );
    end if;
    items_out := items_out || jsonb_build_array(r -> 'item');
  end loop;

  select * into p from public.profiles where id = actor;

  result := jsonb_build_object(
    'action_type', 'cc_recycle_batch',
    'max_rarity', p_max_rarity,
    'scrapped_count', n,
    'counts_by_rarity', counts_by_rarity,
    'scrap_award', scrap_total,
    'cores_award', cores_total,
    'bonus_materials', bonus_materials,
    'items', items_out,
    'profile', public.cc_profile_snapshot(p),
    'loadout', public.cc_loadout_snapshot(actor)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_recycle_batch', nonce, result);

  return result;
end;
$function$;

-- ---------------------------------------------------------------------
-- 6. cc_claim_login_streak_day — collision-safe ledger write post-0101
-- ---------------------------------------------------------------------

create or replace function public.cc_claim_login_streak_day(
  p_player_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := ((p_now - interval '8 hours') at time zone 'UTC')::date;
  p public.profiles%rowtype;
  c public.login_streak_claims%rowtype;
  result jsonb;
begin
  if p_player_id is null then raise exception 'Authentication required'; end if;

  perform pg_advisory_xact_lock(hashtext(p_player_id::text));

  select * into p from public.profiles where id = p_player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Only TODAY's row can ever be paid: an unpaid row from a
  -- previous day is expired by construction (the 00:00 UTC
  -- rollover), never swept, never payable.
  select * into c from public.login_streak_claims
  where player_id = p_player_id and claim_day = v_today
  for update;
  if not found then raise exception 'No streak reward recorded today'; end if;

  -- Exactly-once: the paid stamp is the anchor. A replayed claim
  -- returns the stored claim and pays nothing again.
  if c.paid_at is not null then
    return jsonb_build_object(
      'action_type', 'cc_login_streak_claim',
      'already_claimed', true,
      'claimable', false,
      'day', c.claim_day,
      'streak_length', c.streak_length,
      'cycle_day', c.cycle_day,
      'tier', c.tier,
      'credits_awarded', c.credits_awarded,
      'fragments_awarded', c.fragments_awarded,
      'cache_keys_awarded', c.cache_keys_awarded,
      'profile', public.cc_profile_snapshot(p)
    );
  end if;

  -- The payment: 0036's application block, verbatim, moved from
  -- record time to claim time. Amounts are the row's stored
  -- (post-lever) stamps — the claim pays what the sheet showed.
  update public.profiles
  set credits = credits + c.credits_awarded,
      cache_token_parts = cache_token_parts + c.fragments_awarded,
      cache_tokens = cache_tokens + c.cache_keys_awarded
  where id = p_player_id
  returning * into p;

  update public.login_streak_claims
  set paid_at = p_now
  where player_id = p_player_id and claim_day = v_today;

  result := jsonb_build_object(
    'action_type', 'cc_login_streak_claim',
    'already_claimed', false,
    'claimable', false,
    'day', v_today,
    'streak_length', c.streak_length,
    'cycle_day', c.cycle_day,
    'tier', c.tier,
    'credits_awarded', c.credits_awarded,
    'fragments_awarded', c.fragments_awarded,
    'cache_keys_awarded', c.cache_keys_awarded,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (p_player_id, 'cc_login_streak_claim',
          'login-streak:' || p_player_id::text || ':' || v_today::text, result)
  on conflict (user_id, idempotency_key) do nothing;

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. cc_bank_bench_time — require non-empty ad_unit_id
-- ---------------------------------------------------------------------

create or replace function public.cc_bank_bench_time(
  p_player_id uuid,
  p_nonce text,
  p_ad_unit_id text default null
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
  v_grant bigint;
  v_cap bigint;
  v_bank bigint;
  v_new_bank bigint;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_nonce is null or length(trim(p_nonce)) < 8 then raise exception 'nonce is required'; end if;
  if p_ad_unit_id is null or length(trim(p_ad_unit_id)) = 0 then raise exception 'ad_unit_id is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = p_nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  -- Guests bank too (brief §8.7): crafting requires no verified
  -- account and banking is not transacting — no
  -- can_use_player_economy gate here, exactly as the cache lane
  -- attests ad value to guest accounts.

  -- The grant and the cap are economy-config levers, read live and
  -- clamped to the registry specs (src/server/economy/config.ts):
  -- benchTimeGrantSeconds [0, 86400] default 3600 (one hour per
  -- completed rewarded ad, §8.2); benchTimeBankCapSeconds
  -- [0, 604800] default 86400 (the 24 h bank cap, §8.2).
  v_grant := greatest(0, least(86400, coalesce(
    public.cc_economy_config_number('benchTimeGrantSeconds', 3600), 3600)))::bigint;
  v_cap := greatest(0, least(604800, coalesce(
    public.cc_economy_config_number('benchTimeBankCapSeconds', 86400), 86400)))::bigint;
  v_bank := coalesce(p.bench_time_banked_seconds, 0);
  if v_bank >= v_cap then
    raise exception 'Bench time bank full — 24 h';
  end if;
  v_new_bank := least(v_cap, v_bank + v_grant);

  update public.profiles
     set bench_time_banked_seconds = v_new_bank::integer,
         updated_at = now()
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_bank_bench_time',
    'granted_seconds', v_new_bank - v_bank,
    'banked_seconds', v_new_bank,
    'bank_cap_seconds', v_cap,
    'grant_seconds', v_grant,
    'ad_unit_id', p_ad_unit_id,
    'profile', public.cc_profile_snapshot(p)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_bank_bench_time', p_nonce, result);
  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. cc_compute_economy_metrics — scrap_minted_salvage counts cc_recycle_item rows only
-- ---------------------------------------------------------------------

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
  v_scrap_minted_total bigint;
  v_scrap_destroyed_total bigint;
  v_scrap_destroyed_crafting bigint;
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
    count(*) filter (where action_type = 'cc_make_item') as cache_opens,
    coalesce(sum((result_payload -> 'rewards' ->> 'cache_fragments_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_fragments_awarded,
    -- 0082: whole cache keys paid by roaming/offline claims (the
    -- fragment fold above freezes as history — new claim payloads
    -- carry cache_keys_awarded, never cache_fragments_awarded).
    coalesce(sum((result_payload -> 'rewards' ->> 'cache_keys_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_keys_from_roaming,
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
    -- Dispatch reroll sink (0068): credits burned re-dealing the
    -- board — its own breakout, folded into the destroyed total
    -- below (contracts/dispatch family).
    coalesce(sum((result_payload ->> 'credits_charged')::bigint)
      filter (where action_type = 'cc_reroll_dispatch_board'), 0) as destroyed_dispatch_rerolls,
    -- Scrap meters (0071, brief S4.4 + S6): the engine material's
    -- faucets, folded from the same ledger payloads as the credit
    -- meters. Salvage counts every application of the salvage rate
    -- to an item: manual recycles (single + batch scrap_award) and
    -- the boss Second Opinion auto-scrap (the attempt's top-level
    -- scrap_awarded, credited through the attempt's scrap delta).
    (coalesce(sum((result_payload ->> 'scrap_award')::bigint)
        filter (where action_type = 'cc_recycle_item'), 0)
     + coalesce(sum((result_payload ->> 'scrap_awarded')::bigint)
        filter (where action_type = 'cc_apply_boss_attempt'), 0)) as scrap_minted_salvage,
    -- Roaming folds the trickle wherever it is paid: live claims,
    -- offline settlement (the same trickle paid in arrears), and
    -- the retired legacy claim rows the credit fold still reads.
    coalesce(sum((result_payload -> 'rewards' ->> 'scrap_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as scrap_minted_roaming,
    coalesce(sum((result_payload -> 'payout' ->> 'scrap')::bigint)
      filter (where action_type = 'cc_dispatch_settle'), 0) as scrap_minted_dispatch,
    (coalesce(sum((result_payload -> 'payout' ->> 'scrap')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'scrap')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as scrap_minted_endless,
    -- The starter bundle's +500 Scrap (0069): the bundle result
    -- carries no scrap field, so the fold counts grants x the
    -- shipped grant, exactly as minted_other counts 5000 x grants
    -- for the bundle's credits.
    500 * count(*) filter (where action_type = 'cc_initial_bundle') as scrap_minted_bundle,
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
    + m.standing_tribute_destroyed + m.standing_purchases_destroyed
    + m.destroyed_dispatch_rerolls;

  -- Scrap destroyed by crafting (0071): the 'Scrap' leg of the
  -- materials fold below (enqueue escrows + catalysts, net of
  -- cancel refunds), PLUS tint escrows — tint jobs enqueue under
  -- their own action type, and the tint's flat Scrap leg is a
  -- crafting burn the brief names (S4.4). The materials jsonb fold
  -- keeps its shipped enqueue-only scope; this scalar is the
  -- scrap-complete view. Floored at 0 like the jsonb fold's
  -- per-key having clause (a cancel can outrun its enqueue day).
  select greatest(0, coalesce(sum(delta), 0))::bigint
    into v_scrap_destroyed_crafting
    from (
      select (e.value)::bigint as delta
        from public.verified_action_ledger l,
             jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_inputs', '{}'::jsonb)) as e
       where l.action_type = 'cc_enqueue_craft_job' and e.key = 'Scrap'
         and l.created_at >= v_start and l.created_at < v_end
      union all
      select (e.value)::bigint
        from public.verified_action_ledger l,
             jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_catalyst', '{}'::jsonb)) as e
       where l.action_type = 'cc_enqueue_craft_job' and e.key = 'Scrap'
         and l.created_at >= v_start and l.created_at < v_end
      union all
      select (e.value)::bigint
        from public.verified_action_ledger l,
             jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_inputs', '{}'::jsonb)) as e
       where l.action_type = 'cc_enqueue_tint_job' and e.key = 'Scrap'
         and l.created_at >= v_start and l.created_at < v_end
      union all
      select -(e.value)::bigint
        from public.verified_action_ledger l,
             jsonb_each_text(coalesce(l.result_payload -> 'refunded_inputs', '{}'::jsonb)) as e
       where l.action_type = 'cc_cancel_craft_job' and e.key = 'Scrap'
         and l.created_at >= v_start and l.created_at < v_end
    ) d;

  v_scrap_minted_total := m.scrap_minted_salvage + m.scrap_minted_roaming
    + m.scrap_minted_dispatch + m.scrap_minted_endless + m.scrap_minted_bundle;
  v_scrap_destroyed_total := v_scrap_destroyed_crafting
    + m.scrap_destroyed_reforge + m.scrap_destroyed_contract_rerolls;

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
    cache_keys_from_ads, cache_keys_from_leaderboards, cache_opens, cache_fragments_awarded, cache_keys_from_roaming,
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
    credits_destroyed_dispatch_rerolls,
    scrap_minted_salvage, scrap_minted_roaming, scrap_minted_dispatch,
    scrap_minted_endless, scrap_minted_bundle, scrap_minted_total,
    scrap_destroyed_crafting, scrap_destroyed_total, net_scrap_change,
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
    m.cache_keys_from_ads, m.cache_keys_from_leaderboards, m.cache_opens, m.cache_fragments_awarded, m.cache_keys_from_roaming,
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
    m.destroyed_dispatch_rerolls,
    m.scrap_minted_salvage, m.scrap_minted_roaming, m.scrap_minted_dispatch,
    m.scrap_minted_endless, m.scrap_minted_bundle, v_scrap_minted_total,
    v_scrap_destroyed_crafting, v_scrap_destroyed_total,
    v_scrap_minted_total - v_scrap_destroyed_total,
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
    cache_keys_from_roaming = excluded.cache_keys_from_roaming,
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
    credits_destroyed_dispatch_rerolls = excluded.credits_destroyed_dispatch_rerolls,
    scrap_minted_salvage = excluded.scrap_minted_salvage,
    scrap_minted_roaming = excluded.scrap_minted_roaming,
    scrap_minted_dispatch = excluded.scrap_minted_dispatch,
    scrap_minted_endless = excluded.scrap_minted_endless,
    scrap_minted_bundle = excluded.scrap_minted_bundle,
    scrap_minted_total = excluded.scrap_minted_total,
    scrap_destroyed_crafting = excluded.scrap_destroyed_crafting,
    scrap_destroyed_total = excluded.scrap_destroyed_total,
    net_scrap_change = excluded.net_scrap_change,
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

