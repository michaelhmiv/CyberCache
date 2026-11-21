-- 0104 — Neon Audit Hardening (2026-11-21)
--
-- Ships every database schema and SQL function fix identified in the full
-- repository audit:
--   1. player_reports table (App Store Guideline 1.2) + POST /api/reports backing.
--   2. Relax auth_accounts_email_or_guest for email-less Apple Sign-In accounts.
--   3. Detach ON DELETE RESTRICT FKs on closed market_listings & service_jobs rows.
--   4. cc_delete_account(p_account_id uuid) — transactional account deletion
--      (App Store Guideline 5.1.1(v)) that unwinds active listings & service jobs,
--      refunds counterparties, revokes refresh tokens, and deletes auth_accounts.
--   5. cc_skill_effective_points — apply treeBonus BEFORE nodeBoosts on small
--      nodes only (p_max_points > 1) so over-cap nodeBoosts work and Level-1
--      Common class mods do not grant free Majors / Keystones / Action Skills.
--   6. cc_equip_item & cc_unequip_slot — RETURNING * INTO p on hunter_loadouts
--      sync so returned snapshots are never one step stale.
--   7. cc_apply_build — enforce Cache Hunter class-mod binding + hunter_loadouts
--      sync (0097 parity).
--   8. cc_recycle_batch — exclude items assigned to benched hunters in
--      profiles.hunter_loadouts.
--   9. cc_recycle_item & cc_vendor_sell — cap crafted gear (supply_mode='crafted'
--      or origin='crafted') salvage and buyback values to close the
--      tool_reclaimer_head / gear-frame printing press; clamp vendorBuybackRate
--      ceiling to 0.65 (effective cap 0.72 with skills + research).
--  10. cc_standing_catalog — replace 3 redundant Vendor Staples on Rank-1 Rep
--      Shelf with genuine rotation-only consumables (TargetPainter,
--      IncendiaryAmmo, DataSkimmer).
--  11. cc_claim_login_streak_day — ON CONFLICT (user_id, idempotency_key) DO
--      NOTHING on verified_action_ledger to prevent 0101 boundary-shift 500s.
--  12. cc_compute_player_snapshot — derive total_kills, total_deaths, and
--      highest_boss_tier from server-authoritative player_kill_stats,
--      player_lifetime_counters, and profiles.boss_state instead of
--      client-writable combat_stats.
--  13. cc_bank_bench_time — require non-empty p_ad_unit_id.
--  14. cc_auto_salvage_claim_items — scale converted material yield by Scrap
--      value (greatest(1, round(award / 15.0))) instead of flat +1.
--  15. cc_settle_craft_jobs — pay player XP only on baseline lane 1 during
--      Bench Time multi-lane crafting (upholding [0.70, 0.85] Occupations law).
--  16. cc_compute_economy_metrics — restore credits_minted_vendor_buyback,
--      fix 2x cc_recycle_batch Scrap double-count, include extraction/roaming
--      Scrap finds and market cancel deposit burns.

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
-- 2. Relax auth_accounts_email_or_guest for email-less Apple Sign-In
-- ---------------------------------------------------------------------

alter table public.auth_accounts
  drop constraint if exists auth_accounts_email_or_guest;

-- ---------------------------------------------------------------------
-- 3. Detach ON DELETE RESTRICT FKs on historical market_listings / service_jobs
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
-- 4. cc_delete_account — transactional in-app account deletion
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
-- 5. cc_skill_effective_points — treeBonus BEFORE nodeBoosts, small nodes only
-- ---------------------------------------------------------------------

create or replace function public.cc_skill_effective_points(
  p_spends jsonb,
  p_mod_payload jsonb,
  p_node_id text,
  p_tree text,
  p_max_points integer
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_mod_payload ->> 'treeBonus' = p_tree and coalesce(p_max_points, 1) > 1
      then least(p_max_points::numeric, coalesce((p_spends ->> p_node_id)::numeric, 0) + 1)
         + coalesce((p_mod_payload -> 'nodeBoosts' ->> p_node_id)::numeric, 0)
    else coalesce((p_spends ->> p_node_id)::numeric, 0)
       + coalesce((p_mod_payload -> 'nodeBoosts' ->> p_node_id)::numeric, 0)
  end;
$$;

-- ---------------------------------------------------------------------
-- 6. cc_equip_item & cc_unequip_slot — RETURNING * INTO p on loadout sync
-- ---------------------------------------------------------------------

create or replace function public.cc_equip_item(p_player_id uuid, nonce text, item_id uuid, slot_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  cleared_items jsonb;
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

  update public.profiles
     set hunter_loadouts = public.cc_sync_active_hunter_loadout(
           p.hunter_loadouts,
           public.cc_profile_active_hunter(p),
           public.cc_loadout_snapshot(actor)
         )
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_equip_item',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'items', cleared_items || jsonb_build_array(to_jsonb(item)),
    'loadout', public.cc_loadout_snapshot(actor)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_equip_item', nonce, result);
  return result;
end;
$function$;

create or replace function public.cc_unequip_slot(p_player_id uuid, nonce text, slot_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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

  update public.profiles
     set hunter_loadouts = public.cc_sync_active_hunter_loadout(
           p.hunter_loadouts,
           public.cc_profile_active_hunter(p),
           public.cc_loadout_snapshot(actor)
         )
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_unequip_slot',
    'profile', public.cc_profile_snapshot(p),
    'item', case when item.id is null then null else to_jsonb(item) end,
    'slot_name', slot_name,
    'loadout', public.cc_loadout_snapshot(actor)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_unequip_slot', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------
-- 7. cc_apply_build — Cache Hunter class-mod binding + hunter_loadouts sync
-- ---------------------------------------------------------------------

create or replace function public.cc_apply_build(p_player_id uuid, nonce text, slots jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  slot_name text;
  raw jsonb;
  target_text text;
  target_id uuid;
  item public.item_instances%rowtype;
  seen_ids uuid[] := '{}';
  outcomes jsonb := '[]'::jsonb;
  changed_items jsonb := '[]'::jsonb;
  cleared_items jsonb;
  v_listing_id uuid;
  v_job_id uuid;
  v_job_kind text;
  v_mission_id uuid;
  v_returns_at timestamptz;
  v_outcome text;
  v_applied boolean;
  v_equipped_count integer := 0;
  v_attention_count integer := 0;
  v_active_tree text;
  v_mod_tree text;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if slots is null or jsonb_typeof(slots) <> 'object' then raise exception 'Invalid build'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  v_active_tree := public.cc_profile_active_tree(p);

  foreach slot_name in array array['primary','secondary','heavy','ordnance','shield','classMod','relic','vehicle'] loop
    raw := slots -> slot_name;
    v_listing_id := null;
    v_job_id := null;
    v_job_kind := null;
    v_mission_id := null;
    v_returns_at := null;

    if raw is null or raw = 'null'::jsonb then
      with cleared as (
        update public.item_instances
        set equipped_slot = null,
            runtime_state = case when is_locked then 'locked' else 'available' end
        where owner_user_id = actor
          and equipped_slot = slot_name
        returning *
      )
      select coalesce(jsonb_agg(to_jsonb(cleared)), '[]'::jsonb) into cleared_items from cleared;
      changed_items := changed_items || cleared_items;
      outcomes := outcomes || jsonb_build_array(jsonb_build_object(
        'slot', slot_name,
        'item_id', null,
        'outcome', 'empty',
        'listing_id', null,
        'mission_id', null,
        'returns_at', null,
        'job_id', null,
        'job_kind', null
      ));
      continue;
    end if;

    if jsonb_typeof(raw) <> 'string' then raise exception 'Invalid build'; end if;
    target_text := raw #>> '{}';
    if target_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid build';
    end if;
    target_id := target_text::uuid;

    if target_id = any(seen_ids) then
      outcomes := outcomes || jsonb_build_array(jsonb_build_object(
        'slot', slot_name,
        'item_id', target_id,
        'outcome', 'gone',
        'listing_id', null,
        'mission_id', null,
        'returns_at', null,
        'job_id', null,
        'job_kind', null
      ));
      v_attention_count := v_attention_count + 1;
      continue;
    end if;
    seen_ids := seen_ids || target_id;

    select * into item from public.item_instances where id = target_id and owner_user_id = actor for update;

    if not found then
      v_outcome := 'gone';
    elsif item.runtime_state in ('consumed','salvaged') then
      v_outcome := 'gone';
    elsif item.runtime_state = 'listed' then
      v_outcome := 'listed';
      select id into v_listing_id
      from public.market_listings
      where seller_user_id = actor
        and item_instance_id = item.id
        and status = 'active'
      order by listed_at asc
      limit 1;
    elsif exists (
      select 1 from public.service_jobs j
      where j.owner_user_id = actor
        and j.target_item_instance_id = item.id
        and j.status not in ('completed','cancelled')
    ) then
      v_outcome := 'locked';
      select id, profession_id into v_job_id, v_job_kind
      from public.service_jobs j
      where j.owner_user_id = actor
        and j.target_item_instance_id = item.id
        and j.status not in ('completed','cancelled')
      order by j.created_at asc
      limit 1;
    elsif item.runtime_state = 'in_service' then
      v_outcome := 'in_service';
      select id, ends_at into v_mission_id, v_returns_at
      from public.dispatch_missions
      where user_id = actor
        and status = 'active'
        and (item.id = any(loadout_item_ids) or vehicle_item_id = item.id)
      order by ends_at asc
      limit 1;
    elsif not public.cc_item_accepts_slot(coalesce(item.payload, '{}'::jsonb), slot_name) then
      v_outcome := 'incompatible';
    elsif slot_name = 'classMod' and (item.payload ->> 'treeBonus') is not null and (item.payload ->> 'treeBonus') <> v_active_tree then
      v_outcome := 'incompatible';
    elsif slot_name = 'vehicle' and public.cc_vehicle_unlock_level(item.payload ->> 'vehicleClassId') is null then
      v_outcome := 'incompatible';
    else
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

      changed_items := changed_items || cleared_items || jsonb_build_array(to_jsonb(item));
      v_outcome := 'equipped';
    end if;

    if v_outcome = 'equipped' then
      v_equipped_count := v_equipped_count + 1;
    else
      v_attention_count := v_attention_count + 1;
    end if;

    outcomes := outcomes || jsonb_build_array(jsonb_build_object(
      'slot', slot_name,
      'item_id', target_id,
      'outcome', v_outcome,
      'listing_id', v_listing_id,
      'mission_id', v_mission_id,
      'returns_at', v_returns_at,
      'job_id', v_job_id,
      'job_kind', v_job_kind
    ));
  end loop;

  update public.profiles
     set hunter_loadouts = public.cc_sync_active_hunter_loadout(
           p.hunter_loadouts,
           public.cc_profile_active_hunter(p),
           public.cc_loadout_snapshot(actor)
         )
   where id = actor
   returning * into p;

  v_applied := v_attention_count = 0;

  result := jsonb_build_object(
    'action_type', 'cc_apply_build',
    'profile', public.cc_profile_snapshot(p),
    'loadout', public.cc_loadout_snapshot(actor),
    'items', changed_items,
    'outcomes', outcomes,
    'applied', v_applied,
    'equipped_count', v_equipped_count,
    'attention_count', v_attention_count
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_apply_build', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------
-- 8. cc_recycle_batch — exclude gear assigned to benched hunters
-- ---------------------------------------------------------------------

create or replace function public.cc_item_in_any_hunter_loadout(p_hunter_loadouts jsonb, p_item_id uuid)
returns boolean
language sql
immutable
set search_path = public
as $$
  select exists (
    select 1
      from jsonb_each(coalesce(p_hunter_loadouts, '{}'::jsonb)) h(hunter_key, slots),
           jsonb_each_text(case when jsonb_typeof(h.slots) = 'object' then h.slots else '{}'::jsonb end) s(slot_key, val)
     where s.val = p_item_id::text
  );
$$;

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
-- 9. cc_recycle_item & cc_vendor_sell — cap crafted gear printing & buyback
-- ---------------------------------------------------------------------

create or replace function public.cc_recycle_item(p_player_id uuid, nonce text, item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
  award integer;
  mod_payload jsonb;
  hoarder_pts numeric := 0;
  keystone_pts numeric := 0;
  salvage_bonus numeric := 0;
  low_rarity_bonus numeric := 0;
  material_chance numeric := 0;
  skill_mult numeric := 1;
  bonus_material text := null;
  cores integer := 0;
  is_crafted boolean := false;
  is_named_relic boolean := false;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.is_locked then raise exception 'Locked item'; end if;
  if item.runtime_state not in ('available','equipped') then raise exception 'Item state invalid'; end if;

  select * into p from public.profiles where id = actor;

  select payload into mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  hoarder_pts := public.cc_skill_effective_points(p.skill_spends, mod_payload, 'scav_major_1', 'Scavenger', 1);
  keystone_pts := public.cc_skill_effective_points(p.skill_spends, mod_payload, 'scav_keystone', 'Scavenger', 1);
  if public.cc_profile_active_tree(p) <> 'Scavenger' then
    hoarder_pts := 0;
    keystone_pts := 0;
  end if;
  salvage_bonus := 0.25 * hoarder_pts;
  low_rarity_bonus := 1.0 * keystone_pts;
  material_chance := 0.25 * keystone_pts;

  award := public.cc_salvage_scrap(item.rarity, item.item_level);

  is_crafted := (item.supply_mode = 'crafted') or (coalesce(item.payload ->> 'origin', '') = 'crafted');
  is_named_relic := is_crafted and (item.payload ->> 'name') in (
    'Precision Calipers', 'Servo Bench Rig', 'Reclaimer Head', 'Prime Laboratory'
  );
  if is_crafted then
    award := least(award, case when is_named_relic then 5 else 15 end);
  end if;

  if item.payload ->> 'legendaryEffectId' = 'market_crash' then
    award := award * 4;
  end if;

  skill_mult := (1 + salvage_bonus);
  if item.rarity in ('Common', 'Uncommon') then
    skill_mult := skill_mult * (1 + low_rarity_bonus);
  end if;
  award := round(award * skill_mult)::integer;

  if item.rarity = 'Legendary' then
    cores := 1
      + case when coalesce(item.item_level, 1) >= 25 then 1 else 0 end
      + case when coalesce(item.item_level, 1) >= 50 then 1 else 0 end
      + case when item.kind = 'weapon'
                  and nullif(item.payload ->> 'legendaryEffectId', '') is not null
             then 1 else 0 end;
  end if;

  if item.rarity = 'Common' and material_chance > 0 and random() < material_chance then
    bonus_material := case item.kind
      when 'weapon' then 'BallisticParts'
      when 'shield' then 'ReactiveComponents'
      when 'ordnance' then 'ReactiveComponents'
      when 'classMod' then 'TechFragments'
      when 'relic' then 'TechFragments'
      else 'Scrap'
    end;
  end if;

  update public.item_instances
  set runtime_state = 'consumed', tradeable = false, equipped_slot = null
  where id = item.id
  returning * into item;

  if item.kind = 'cosmetic' then
    update public.player_skin_selection
       set equipped = equipped - (item.payload ->> 'slot'), updated_at = now()
     where user_id = actor
       and equipped ->> (item.payload ->> 'slot') = item.id::text;
  end if;

  update public.profiles
  set materials = jsonb_set(coalesce(materials, '{}'::jsonb), '{Scrap}', to_jsonb(coalesce((materials ->> 'Scrap')::bigint, 0) + award), true)
  where id = actor;

  update public.profiles
  set legendary_cores = legendary_cores + cores,
      materials = case
        when bonus_material is not null then
          jsonb_set(
            coalesce(materials, '{}'::jsonb),
            array[bonus_material],
            to_jsonb(coalesce((materials ->> bonus_material)::bigint, 0) + 1),
            true
          )
        else materials
      end
  where id = actor
  returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_recycle_item',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'scrap_award', award,
    'cores_award', cores,
    'bonus_material', bonus_material,
    'loadout', public.cc_loadout_snapshot(actor)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_recycle_item', nonce, result);
  return result;
end;
$function$;

create or replace function public.cc_vendor_sell(
  p_player_id uuid,
  nonce text,
  p_kind text,
  p_item_id uuid default null,
  p_batch_id uuid default null,
  p_material_id text default null,
  p_quantity integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  result jsonb;
  rate numeric := least(0.65::numeric, greatest(0::numeric,
    public.cc_economy_config_number('vendorBuybackRate', 0.4)));
  qty integer := greatest(1, coalesce(p_quantity, 1));
  item public.item_instances%rowtype;
  batch public.consumable_batches%rowtype;
  v_pool text;
  base_price integer;
  vendor_value numeric := 0;
  payout bigint := 0;
  current_count integer;
  v_mod_payload jsonb;
  v_vendor_buyback_bonus numeric := 0;
  is_crafted boolean := false;
  is_named_relic boolean := false;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_vendor_buyback_bonus := 0.01 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_vendor_1', 'Fixer', 5);
  if public.cc_profile_active_tree(p) <> 'Fixer' then
    v_vendor_buyback_bonus := 0;
  end if;
  -- Combined buyback ceiling stays strictly below Item of the Day's 0.75 discount.
  rate := least(0.72::numeric, rate + greatest(0, v_vendor_buyback_bonus)
    + public.cc_research_bonus_number(actor, 'vendorBuybackBonus'));

  if p_kind = 'gear' then
    select * into item from public.item_instances where id = p_item_id and owner_user_id = actor for update;
    if not found then raise exception 'Item not found'; end if;
    if item.is_locked then raise exception 'Locked item'; end if;
    if item.runtime_state <> 'available' then raise exception 'Item state invalid'; end if;

    vendor_value := greatest(0, coalesce(item.estimated_value, 0));
    is_crafted := (item.supply_mode = 'crafted') or (coalesce(item.payload ->> 'origin', '') = 'crafted');
    is_named_relic := is_crafted and (item.payload ->> 'name') in (
      'Precision Calipers', 'Servo Bench Rig', 'Reclaimer Head', 'Prime Laboratory'
    );
    if is_crafted then
      vendor_value := least(vendor_value, case when is_named_relic then 250 else 500 end);
    end if;
    payout := floor(vendor_value * rate)::bigint;

    update public.item_instances
    set runtime_state = 'consumed', tradeable = false, equipped_slot = null
    where id = item.id
    returning * into item;

    update public.profiles set credits = credits + payout where id = actor returning * into p;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'gear',
      'item', to_jsonb(item),
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', 1,
      'total_payout', payout,
      'loadout', public.cc_loadout_snapshot(actor)
    );
  elsif p_kind = 'consumable' then
    select * into batch from public.consumable_batches where id = p_batch_id and owner_user_id = actor for update;
    if not found then raise exception 'Batch not found'; end if;
    if batch.quantity < qty then raise exception 'Insufficient quantity'; end if;

    base_price := public.cc_vendor_base_price(batch.consumable_type);
    if base_price is null then raise exception 'Item has no vendor value'; end if;

    vendor_value := base_price * batch.quality_percent / 100 * qty;
    payout := floor(vendor_value * rate)::bigint;

    update public.consumable_batches
    set quantity = quantity - qty, updated_at = now()
    where id = batch.id;

    current_count := coalesce((coalesce(p.consumables, '{}'::jsonb) ->> batch.consumable_type)::integer, 0);
    update public.profiles
    set credits = credits + payout,
        consumables = jsonb_set(coalesce(consumables, '{}'::jsonb), array[batch.consumable_type],
          to_jsonb(greatest(current_count - qty, 0)), true)
    where id = actor
    returning * into p;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'consumable',
      'item_key', batch.consumable_type,
      'batch_id', batch.id,
      'quality_percent', batch.quality_percent,
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', qty,
      'total_payout', payout
    );
  elsif p_kind = 'material' then
    select c.pool, c.base_price into v_pool, base_price
      from public.cc_vendor_catalog() c where c.item_key = p_material_id;
    if v_pool is null or v_pool not in ('material', 'essence') then
      raise exception 'Unknown material';
    end if;

    if v_pool = 'material' then
      current_count := coalesce((coalesce(p.materials, '{}'::jsonb) ->> p_material_id)::integer, 0);
    else
      current_count := coalesce((coalesce(p.essences, '{}'::jsonb) ->> p_material_id)::integer, 0);
    end if;
    if current_count < qty then raise exception 'Insufficient material %', p_material_id; end if;

    vendor_value := base_price * qty;
    payout := floor(vendor_value * rate)::bigint;

    if v_pool = 'material' then
      update public.profiles
      set credits = credits + payout,
          materials = jsonb_set(coalesce(materials, '{}'::jsonb), array[p_material_id],
            to_jsonb(greatest(current_count - qty, 0)), true)
      where id = actor
      returning * into p;
    else
      update public.profiles
      set credits = credits + payout,
          essences = jsonb_set(coalesce(essences, '{}'::jsonb), array[p_material_id],
            to_jsonb(greatest(current_count - qty, 0)), true)
      where id = actor
      returning * into p;
    end if;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'material',
      'item_key', p_material_id,
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', qty,
      'total_payout', payout
    );
  else
    raise exception 'Invalid sell kind';
  end if;

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_vendor_sell', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------
-- 10. cc_standing_catalog — genuine rotation-only Rank-1 Rep Shelf items
-- ---------------------------------------------------------------------

create or replace function public.cc_standing_catalog()
returns table(offer_key text, manufacturer text, kind text, rank_required integer, price_credits integer, consumable_type text, contents jsonb)
language sql
immutable
set search_path = public
as $$
  values
    ('shelf:Redline', 'Redline', 'shelf', 1, 800, 'OverchargeStim', '{"materials": {}, "essences": {}}'::jsonb),
    ('crate:Redline', 'Redline', 'crate', 4, 5000, null, '{"materials": {"BallisticParts": 10, "NitrocellGel": 4}, "essences": {}}'::jsonb),
    ('shelf:Ironwood', 'Ironwood', 'shelf', 1, 600, 'TargetPainter', '{"materials": {}, "essences": {}}'::jsonb),
    ('crate:Ironwood', 'Ironwood', 'crate', 4, 5000, null, '{"materials": {"HeartwoodResin": 4, "TechFragments": 10}, "essences": {}}'::jsonb),
    ('shelf:BlastForge', 'BlastForge', 'shelf', 1, 450, 'IncendiaryAmmo', '{"materials": {}, "essences": {}}'::jsonb),
    ('crate:BlastForge', 'BlastForge', 'crate', 4, 5000, null, '{"materials": {"ForgeheartIngots": 4, "ReactiveComponents": 10}, "essences": {}}'::jsonb),
    ('shelf:Prismatek', 'Prismatek', 'shelf', 1, 700, 'VoidAmmo', '{"materials": {}, "essences": {}}'::jsonb),
    ('crate:Prismatek', 'Prismatek', 'crate', 4, 6000, null, '{"materials": {"PrismShards": 4}, "essences": {"VoidEssence": 2, "CryoGel": 2}}'::jsonb),
    ('shelf:ThrowTech', 'ThrowTech', 'shelf', 1, 650, 'MagnetizedPayload', '{"materials": {}, "essences": {}}'::jsonb),
    ('crate:ThrowTech', 'ThrowTech', 'crate', 4, 5000, null, '{"materials": {"MagnetiteCores": 4, "TechFragments": 10}, "essences": {}}'::jsonb),
    ('shelf:HelixWorks', 'HelixWorks', 'shelf', 1, 900, 'DataSkimmer', '{"materials": {}, "essences": {}}'::jsonb),
    ('crate:HelixWorks', 'HelixWorks', 'crate', 4, 5500, null, '{"materials": {"Siltglass": 4, "VoidDust": 5}, "essences": {}}'::jsonb)
$$;

-- ---------------------------------------------------------------------
-- 11. cc_claim_login_streak_day — collision-safe ledger write post-0101
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

  select * into c from public.login_streak_claims
  where player_id = p_player_id and claim_day = v_today
  for update;
  if not found then raise exception 'No streak reward recorded today'; end if;

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
-- 12. cc_compute_player_snapshot — server-authoritative combat counters
--     (prevents leaderboard poisoning via PUT /api/stats/combat)
-- ---------------------------------------------------------------------

create or replace function public.cc_compute_player_snapshot(_player_id uuid)
returns public.player_progression_snapshots
language plpgsql
stable security definer
set search_path = public
as $function$
declare
  v_stats public.player_public_stats%rowtype;
  v_snapshot public.player_progression_snapshots;
  v_action text;
  v_server_kills bigint := 0;
  v_server_deaths bigint := 0;
  v_server_boss_tier integer := 0;
begin
  select * into v_stats
  from public.player_public_stats
  where user_id = _player_id;

  select coalesce(public_payload->>'activity_label', active_action)
  into v_action
  from public.active_actions
  where user_id = _player_id
  order by updated_at desc
  limit 1;

  -- Derive kills, deaths, and boss progression from server-authoritative
  -- Chef tables instead of client-writable combat_stats.
  select coalesce(sum(kills), 0)::bigint into v_server_kills
  from public.player_kill_stats
  where user_id = _player_id;

  select coalesce(deaths, 0)::bigint into v_server_deaths
  from public.player_lifetime_counters
  where user_id = _player_id;

  select coalesce(jsonb_array_length(coalesce(boss_state -> 'defeatedBossIds', '[]'::jsonb)), 0)::integer
  into v_server_boss_tier
  from public.profiles
  where id = _player_id;

  v_snapshot.player_id := _player_id;
  v_snapshot.snapshot_at := now();
  v_snapshot.snapshot_version := 1;
  v_snapshot.level := v_stats.player_level;
  v_snapshot.xp := v_stats.player_xp;
  v_snapshot.credits := v_stats.credits;
  v_snapshot.scrap := v_stats.scrap;
  v_snapshot.total_kills := v_server_kills;
  v_snapshot.total_deaths := v_server_deaths;
  v_snapshot.net_worth := v_stats.net_worth;
  v_snapshot.total_items := v_stats.total_items;
  v_snapshot.weapons_owned := v_stats.weapons_owned;
  v_snapshot.legendary_items := v_stats.legendary_items;
  v_snapshot.highest_item_level := v_stats.highest_item_level;
  v_snapshot.total_mastery_xp := v_stats.total_mastery_xp;
  v_snapshot.highest_mastery_level := v_stats.highest_mastery_level;
  v_snapshot.highest_boss_tier := v_server_boss_tier;
  v_snapshot.active_action := v_action;

  return v_snapshot;
end;
$function$;

-- ---------------------------------------------------------------------
-- 13. cc_bank_bench_time — require non-empty ad_unit_id
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
    'ad_unit_id', trim(p_ad_unit_id),
    'profile', public.cc_profile_snapshot(p)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_bank_bench_time', p_nonce, result);
  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- 14. cc_auto_salvage_claim_items — scale converted material yield by Scrap
-- ---------------------------------------------------------------------

create or replace function public.cc_auto_salvage_claim_items(
  p_player_id uuid,
  p_nonce text,
  p_source text,
  p_item_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  p public.profiles%rowtype;
  ceiling_rank integer;
  item_ids uuid[] := '{}'::uuid[];
  item_rarities text[] := '{}'::text[];
  item_kinds text[] := '{}'::text[];
  item_names text[] := '{}'::text[];
  item_levels integer[] := '{}'::integer[];
  r jsonb;
  i integer;
  n integer := 0;
  scrap_total integer := 0;
  converted_total integer := 0;
  cores_total integer := 0;
  counts_by_rarity jsonb := '{}'::jsonb;
  materials_out jsonb := '{}'::jsonb;
  items_out jsonb := '[]'::jsonb;
  award integer;
  mat text;
  mat_qty integer;
  bm text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_nonce is null or length(trim(p_nonce)) < 8 then raise exception 'nonce is required'; end if;
  if p_source is null or p_source not in ('roam', 'offline') then
    raise exception 'Invalid auto-salvage source';
  end if;

  select * into p from public.profiles where id = actor;
  if not found then raise exception 'Profile not found'; end if;

  if p.auto_salvage_enabled is distinct from true
     or p_item_ids is null or coalesce(array_length(p_item_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'action_type', 'cc_auto_salvage',
      'source', p_source,
      'enabled', coalesce(p.auto_salvage_enabled, true),
      'rule', jsonb_build_object(
        'max_rarity', p.auto_salvage_max_rarity,
        'max_quality', p.auto_salvage_max_quality,
        'to_materials', coalesce(p.auto_salvage_to_materials, false)
      ),
      'salvaged_count', 0,
      'counts_by_rarity', '{}'::jsonb,
      'scrap_award', 0,
      'converted_scrap', 0,
      'cores_award', 0,
      'materials', '{}'::jsonb,
      'items', '[]'::jsonb,
      'profile', public.cc_profile_snapshot(p)
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  ceiling_rank := case p.auto_salvage_max_rarity
    when 'Common' then 1
    when 'Uncommon' then 2
    when 'Rare' then 3
    when 'Epic' then 4
    else 0
  end;

  select coalesce(array_agg(e.id order by e.id), '{}'::uuid[]),
         coalesce(array_agg(e.rarity order by e.id), '{}'::text[]),
         coalesce(array_agg(e.kind order by e.id), '{}'::text[]),
         coalesce(array_agg(coalesce(e.payload ->> 'name', '') order by e.id), '{}'::text[]),
         coalesce(array_agg(coalesce(e.item_level, 1) order by e.id), '{}'::integer[])
    into item_ids, item_rarities, item_kinds, item_names, item_levels
    from (
      select ii.*,
             case
               when (ii.payload ->> 'rollQuality') ~ '^[0-9]+(\.[0-9]+)?$'
                 then (ii.payload ->> 'rollQuality')::numeric
               else null
             end as roll_q
        from public.item_instances ii
       where ii.owner_user_id = actor
         and (ii.id::text = any(p_item_ids) or ii.payload ->> 'id' = any(p_item_ids))
    ) e
   where e.runtime_state = 'available'
     and e.is_locked = false
     and e.kind in ('weapon', 'shield', 'ordnance', 'classMod', 'relic')
     and (case e.rarity
            when 'Common' then 1
            when 'Uncommon' then 2
            when 'Rare' then 3
            when 'Epic' then 4
            when 'Legendary' then 5
            else 99
          end) <= ceiling_rank
     and (e.roll_q is null or e.roll_q <= p.auto_salvage_max_quality);

  n := coalesce(array_length(item_ids, 1), 0);

  for i in 1 .. n loop
    r := public.cc_recycle_item(
      actor,
      'autosalvage:' || p_source || ':' || p_nonce || ':' || item_ids[i]::text,
      item_ids[i]
    );
    award := coalesce((r ->> 'scrap_award')::integer, 0);
    cores_total := cores_total + coalesce((r ->> 'cores_award')::integer, 0);
    counts_by_rarity := jsonb_set(
      counts_by_rarity,
      array[item_rarities[i]],
      to_jsonb(coalesce((counts_by_rarity ->> item_rarities[i])::integer, 0) + 1),
      true
    );

    mat := null;
    if coalesce(p.auto_salvage_to_materials, false) and award > 0 then
      mat := case item_kinds[i]
        when 'weapon' then 'BallisticParts'
        when 'shield' then 'ReactiveComponents'
        when 'ordnance' then 'ReactiveComponents'
        when 'classMod' then 'TechFragments'
        when 'relic' then 'TechFragments'
        else 'Scrap'
      end;
      if mat = 'Scrap' then
        mat := null;
        scrap_total := scrap_total + award;
      else
        -- Scale material yield proportionally to Scrap value instead of flat +1.
        mat_qty := greatest(1, round(award / 15.0)::integer);
        converted_total := converted_total + award;
        update public.profiles
           set materials = jsonb_set(
                 jsonb_set(
                   coalesce(materials, '{}'::jsonb),
                   '{Scrap}',
                   to_jsonb(greatest(0, coalesce((materials ->> 'Scrap')::bigint, 0) - award)),
                   true
                 ),
                 array[mat],
                 to_jsonb(coalesce((materials ->> mat)::bigint, 0) + mat_qty),
                 true
               )
         where id = actor;
        materials_out := jsonb_set(
          materials_out,
          array[mat],
          to_jsonb(coalesce((materials_out ->> mat)::integer, 0) + mat_qty),
          true
        );
      end if;
    else
      scrap_total := scrap_total + award;
    end if;

    bm := r ->> 'bonus_material';
    if bm is not null then
      materials_out := jsonb_set(
        materials_out,
        array[bm],
        to_jsonb(coalesce((materials_out ->> bm)::integer, 0) + 1),
        true
      );
    end if;

    items_out := items_out || jsonb_build_array(jsonb_build_object(
      'id', item_ids[i]::text,
      'name', item_names[i],
      'kind', item_kinds[i],
      'rarity', item_rarities[i],
      'level', item_levels[i],
      'scrap_award', award,
      'bonus_material', bm,
      'converted_material', mat
    ));
  end loop;

  select * into p from public.profiles where id = actor;

  return jsonb_build_object(
    'action_type', 'cc_auto_salvage',
    'source', p_source,
    'enabled', true,
    'rule', jsonb_build_object(
      'max_rarity', p.auto_salvage_max_rarity,
      'max_quality', p.auto_salvage_max_quality,
      'to_materials', coalesce(p.auto_salvage_to_materials, false)
    ),
    'salvaged_count', n,
    'counts_by_rarity', counts_by_rarity,
    'scrap_award', scrap_total,
    'converted_scrap', converted_total,
    'cores_award', cores_total,
    'materials', materials_out,
    'items', items_out,
    'profile', public.cc_profile_snapshot(p)
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- 15. cc_settle_craft_jobs — Bench Time extra lanes pay throughput only (Lane 1 XP)
-- ---------------------------------------------------------------------

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
  v_total_xp bigint := 0;
  v_jobs_completed integer := 0;
  v_max_advance bigint := 0;
  v_completions jsonb := '[]'::jsonb;
  v_i integer;
  v_force_complete boolean := false;
  v_refund_from integer := 0;
  -- Bench time (Econ 10, brief §8.3): the bank at settle start in
  -- milliseconds (whole banked seconds + the carried sub-second
  -- remainder). Extra-lane busy time this settle is accumulated in
  -- v_extra_ms, clamped by the bank, and deducted after pass 2;
  -- the baseline lane never touches it.
  v_bank_ms bigint := 0;
  v_extra_ms bigint := 0;
  v_lanes integer := 1;
  v_lane_budgets bigint[] := '{}';
  v_lane integer := 0;
  v_li integer := 0;
  v_avail bigint := 0;
  v_init_avail bigint := 0;
  v_new_bank_ms bigint := 0;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into p from public.profiles where id = actor for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'no_profile',
      'advanced_ms', 0, 'xp_awarded', 0, 'jobs_completed', 0,
      'completions', '[]'::jsonb);
  end if;
  v_bank_ms := coalesce(p.bench_time_banked_seconds, 0)::bigint * 1000
             + coalesce(p.bench_time_remainder_ms, 0);

  select active_action, (extract(epoch from last_heartbeat_at) * 1000)::bigint
    into v_action, v_heartbeat_ms
    from public.active_actions where user_id = actor;

  -- Internal away cap: min(earned cap, limiter when set), [1h, 24h].
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours_for(p.id),
      coalesce(nullif(p.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours_for(p.id))
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
  -- flows to the next job on the bench. Bench time (Econ 10, brief
  -- §8.3): while at least one whole second is banked, bench 1 runs
  -- THREE lanes — the window is spendable by up to three jobs
  -- concurrently, each lane holding the bench's full window, a
  -- finished lane's leftover flowing to the next queued job on that
  -- lane. Lanes past the first are the extra lanes: the time they
  -- spend is the bank's drain (accumulated as v_extra_ms and
  -- deducted after the pass), and their per-job allowance is
  -- clamped by the undrained bank, so the moment the bank empties
  -- the extra lanes stop accruing — mid-job, without killing,
  -- pausing out of existence, or repricing anything: the job
  -- simply waits for baseline capacity like any queued job. Every
  -- other bench (the bench-0 repair/shieldtech lane) keeps the
  -- single lane it has always had.
  for v_bench in
    select distinct bench from public.craft_jobs
     where owner_user_id = actor and status = 'active'
     order by bench asc
  loop
    select coalesce(max(adv), 0) into v_budget
      from unnest(v_ids, v_benches, v_advances) as t(jid, b, adv)
     where b = v_bench;
    v_lanes := case when v_bench = 1 and v_bank_ms >= 1000 then 3 else 1 end;
    v_lane_budgets := array_fill(v_budget, array[v_lanes]);
    for v_job in
      select * from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench
       order by created_at asc, id asc
       for update
    loop
      -- Take the usable lane holding the most window (ties go to
      -- the lowest lane, so a lone job always lands on the baseline
      -- lane and never drains). A lane past the first is usable
      -- only while undrained bank remains.
      v_lane := 0;
      v_avail := 0;
      for v_li in 1 .. v_lanes loop
        if v_lane_budgets[v_li] > v_avail
           and (v_li = 1 or v_extra_ms < v_bank_ms) then
          v_lane := v_li;
          v_avail := v_lane_budgets[v_li];
        end if;
      end loop;
      exit when v_lane = 0;
      if v_lane > 1 then
        v_avail := least(v_avail, v_bank_ms - v_extra_ms);
      end if;
      v_init_avail := v_avail;
      -- Tools are permanent (economy brief §9.2, 0067): the job is
      -- still marked tool_charged at its first unit for the record,
      -- but no charge is spent -- a fitted tool is never consumed,
      -- un-owned, or unfitted by use. Pre-0067 charges values stored
      -- in profiles.workshop_tools are inert.
      if not v_job.tool_charged and (v_job.snapshot ->> 'toolId') is not null then
        update public.craft_jobs set tool_charged = true where id = v_job.id;
      end if;
      v_force_complete := false;
      while v_avail > 0 and v_job.units_completed < v_job.units_total loop
        v_need := v_job.unit_duration_ms - v_job.accrued_ms;
        if v_avail < v_need then
          update public.craft_jobs
             set accrued_ms = accrued_ms + v_avail where id = v_job.id;
          v_avail := 0;
        else
          v_avail := v_avail - v_need;
          update public.craft_jobs set accrued_ms = 0 where id = v_job.id;
          v_output := public.cc_complete_craft_unit(
            v_job.id, case when v_lane = 1 then v_xp_rate else 0 end, v_shift, v_temper, v_yield_base);
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
      -- Lane bookkeeping: what this job drew from its lane leaves
      -- the lane; on an extra lane it is also the bank's drain.
      v_lane_budgets[v_lane] := v_lane_budgets[v_lane] - (v_init_avail - v_avail);
      if v_lane > 1 then
        v_extra_ms := v_extra_ms + (v_init_avail - v_avail);
      end if;
      if v_force_complete or v_job.units_completed >= v_job.units_total then
        update public.craft_jobs
           set status = 'complete', completed_at = v_now where id = v_job.id;
        v_jobs_completed := v_jobs_completed + 1;
      end if;
    end loop;
  end loop;

  -- Bench-time drain (Econ 10, brief §8.3): deduct this settle's
  -- extra-lane busy time from the bank — whole seconds into the
  -- bank column, the sub-second remainder carried on the profile
  -- so no fraction of a banked hour is ever lost to rounding.
  if v_extra_ms > 0 then
    v_new_bank_ms := greatest(0, v_bank_ms - v_extra_ms);
    update public.profiles
       set bench_time_banked_seconds = (v_new_bank_ms / 1000)::integer,
           bench_time_remainder_ms = (v_new_bank_ms % 1000)::integer,
           updated_at = now()
     where id = actor;
  end if;

  return jsonb_build_object('settled', true, 'advanced_ms', v_max_advance,
    'xp_awarded', v_total_xp, 'jobs_completed', v_jobs_completed,
    'completions', v_completions);
end;
$$;

-- ---------------------------------------------------------------------
-- 16. cc_compute_economy_metrics — restore vendor buyback, fix 2x batch scrap, include finds & deposits
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
    (coalesce(sum(coalesce((result_payload -> 'rewards' ->> 'scrap_awarded')::bigint, 0) + coalesce((result_payload -> 'rewards' -> 'materials_awarded' ->> 'Scrap')::bigint, 0))
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0)
     + coalesce(sum((result_payload -> 'finds_materials' ->> 'Scrap')::bigint)
      filter (where action_type = 'cc_apply_extraction'), 0)) as scrap_minted_roaming,
    coalesce(sum((result_payload ->> 'total_payout')::bigint)
      filter (where action_type = 'cc_vendor_sell'), 0) as minted_vendor_buyback,
    coalesce(sum((result_payload ->> 'deposit_forfeited_scrap')::bigint)
      filter (where action_type = 'cc_cancel_listing'), 0) as scrap_destroyed_market_cancel_deposits,
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

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other + m.minted_vendor_buyback
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
    + m.scrap_destroyed_reforge + m.scrap_destroyed_contract_rerolls + m.scrap_destroyed_market_cancel_deposits;

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
