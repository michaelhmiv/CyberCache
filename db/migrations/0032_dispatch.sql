-- 0032_dispatch.sql
--
-- Dispatch missions + courier contracts + the Leviathan Rig
-- (Dispatch slice). Design: src/content/dispatch.ts (the content
-- owner) and design-briefs/expansion-pack/courier-contracts.md +
-- endgame-vehicle-class.md (defaults approved 2026-10-31,
-- DECISIONS.md R10/R11).
--
-- What lands here:
--   1. public.dispatch_missions — one row per contract, carrying
--      the courier brief §2.7 reserved fields from the first
--      migration (contract_family, vehicle_item_id, vehicle_class_id
--      snapshot, destination_area_id, route_ticks,
--      fuel_charged_units, fuel_refunded_units,
--      condition_at_departure, wear_projected, wear_applied,
--      breakdown_fraction, cargo_bonus_units, premium_multiplier).
--      Terms are SNAPSHOTTED at departure; settlement reads only
--      the row, so lever moves never reprice a running contract.
--   2. cc_dispatch_depart — validates state from server records
--      (queue slots from the dispatchQueueSlots lever, item/vehicle
--      availability, the courier class-band gate via
--      cc_vehicle_unlock_level, the fuel tank), locks the committed
--      instances into runtime_state 'in_service' + is_locked (the
--      repair board's state — every shipped op already refuses it),
--      debits courier fuel, and writes the verified-action ledger.
--      The route (TS) computes the payout/cost snapshot from the
--      content owner over server records; this function is the
--      authority for every state transition and sanity-caps the
--      snapshot.
--   3. cc_dispatch_settle_due / cc_dispatch_recall — the settler.
--      Pro-rata is the house shape: payout x fraction, fuel
--      refunded for the unflown fraction, wear applied for the
--      flown fraction. Breakdown is deterministic (fraction =
--      condition_at_departure / wear_projected, computed at
--      departure); there is no RNG anywhere in this system.
--   4. cc_vehicle_unlock_level restated with 'leviathan_rig' -> 75
--      (the SQL twin of the new VEHICLE_CLASSES row).
--   5. Economy metrics: credits_minted_dispatch (foot) +
--      credits_minted_courier columns, folded into the minted
--      total; cc_compute_economy_metrics restated (0031 body +
--      the dispatch ledger aggregates).
--
-- Dispatch never touches active_actions: missions run parallel to
-- the personal action slot by law. Settlement is lazy (on the next
-- dispatch read/departure) and settles IN FULL at term — the
-- AFK/offline cap does not truncate a fixed-term contract.

-- ---------------------------------------------------------------------------
-- 1. The mission row
-- ---------------------------------------------------------------------------

create table if not exists public.dispatch_missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contract_family text not null check (contract_family in ('foot', 'courier')),
  offer_id text not null,
  seed text not null,
  destination_area_id text not null,
  duration_hours integer not null check (duration_hours in (2, 8, 24)),
  status text not null default 'active' check (status in ('active', 'settled', 'recalled')),
  -- Foot terms (null/empty on courier rows).
  loadout_item_ids uuid[] not null default '{}',
  loadout_strength numeric not null default 0,
  -- Payout snapshot (both families).
  payout_credits bigint not null default 0,
  payout_scrap bigint not null default 0,
  payout_material_id text,
  payout_material_units integer not null default 0,
  -- Courier-only columns (courier brief §2.7; null on foot rows).
  vehicle_item_id uuid references public.item_instances(id) on delete set null,
  vehicle_class_id text,
  route_ticks integer,
  fuel_charged_units numeric not null default 0,
  fuel_refunded_units numeric not null default 0,
  condition_at_departure numeric,
  wear_projected numeric,
  wear_applied numeric,
  breakdown_fraction numeric,
  cargo_bonus_units integer not null default 0,
  premium_multiplier numeric,
  -- Settlement facts.
  payout_fraction numeric,
  departed_at timestamptz not null default now(),
  ends_at timestamptz not null,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_dispatch_missions_user_status
  on public.dispatch_missions (user_id, status, ends_at);

-- ---------------------------------------------------------------------------
-- 2. cc_vehicle_unlock_level — 0021 body + the Leviathan Rig (75).
--    SQL twin of VEHICLE_CLASSES in src/lib/vehicles/vehicles.ts.
-- ---------------------------------------------------------------------------

create or replace function public.cc_vehicle_unlock_level(class_id text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case class_id
    when 'scrap_bike' then 1
    when 'dune_buggy' then 8
    when 'utility_rover' then 18
    when 'cargo_hauler' then 28
    when 'armored_crawler' then 42
    when 'relay_skimmer' then 60
    when 'leviathan_rig' then 75
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. cc_dispatch_depart — commit a spare loadout / spare vehicle.
--    p_terms is the route's snapshot (see src/server/routes/
--    dispatch.ts); every state fact is re-validated here from
--    server records, and the snapshot is sanity-capped.
-- ---------------------------------------------------------------------------

create or replace function public.cc_dispatch_depart(p_player_id uuid, nonce text, p_terms jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  v_family text := p_terms ->> 'family';
  v_duration integer := (p_terms ->> 'duration_hours')::integer;
  v_item_ids uuid[];
  v_item public.item_instances%rowtype;
  v_vehicle public.item_instances%rowtype;
  v_slots integer;
  v_active_count integer;
  v_mission public.dispatch_missions%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if p_terms is null then raise exception 'Dispatch terms are required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  if v_family not in ('foot', 'courier') then raise exception 'Unknown dispatch family'; end if;
  if v_duration not in (2, 8, 24) then raise exception 'Invalid dispatch duration'; end if;
  if coalesce((p_terms ->> 'payout_credits')::bigint, -1) not between 0 and 10000000
     or coalesce((p_terms ->> 'payout_scrap')::bigint, -1) not between 0 and 1000000
     or coalesce((p_terms ->> 'payout_material_units')::integer, -1) not between 0 and 10000 then
    raise exception 'Dispatch payout snapshot out of bounds';
  end if;

  -- One shared queue pool (foot + courier), sized by the lever.
  v_slots := greatest(1, least(8, coalesce(
    public.cc_economy_config_number('dispatchQueueSlots', 2), 2)::integer));
  select count(*) into v_active_count from public.dispatch_missions
   where user_id = actor and status = 'active';
  if v_active_count >= v_slots then raise exception 'Dispatch queue full'; end if;

  if v_family = 'foot' then
    select coalesce(array_agg(x::uuid), '{}') into v_item_ids
      from jsonb_array_elements_text(coalesce(p_terms -> 'loadout_item_ids', '[]'::jsonb)) x;
    if coalesce(array_length(v_item_ids, 1), 0) not between 1 and 8 then
      raise exception 'Dispatch loadout must carry 1 to 8 items';
    end if;
    -- Every committed item: owned, available, unequipped, not a
    -- vehicle. Lock the set into in_service for the duration.
    for v_item in
      select * from public.item_instances where id = any(v_item_ids) and owner_user_id = actor for update
    loop
      if v_item.runtime_state <> 'available' or v_item.equipped_slot is not null then
        raise exception 'Dispatch item is not spare: %', v_item.id;
      end if;
      if v_item.kind = 'vehicle' then
        raise exception 'Vehicles ride courier contracts, not foot loadouts';
      end if;
    end loop;
    if (select count(*) from public.item_instances where id = any(v_item_ids) and owner_user_id = actor)
       <> coalesce(array_length(v_item_ids, 1), 0) then
      raise exception 'Dispatch item not found';
    end if;
    update public.item_instances
       set runtime_state = 'in_service', is_locked = true, updated_at = now()
     where id = any(v_item_ids) and owner_user_id = actor;
  else
    -- Courier: the vehicle does the work. Gate reads the VEHICLE's
    -- class band (courier brief §2.1), never the player's level.
    select * into v_vehicle from public.item_instances
     where id = (p_terms ->> 'vehicle_item_id')::uuid and owner_user_id = actor for update;
    if not found then raise exception 'Courier vehicle not found'; end if;
    if v_vehicle.kind <> 'vehicle' then raise exception 'Courier assignment is not a vehicle'; end if;
    if v_vehicle.runtime_state <> 'available' or v_vehicle.equipped_slot is not null then
      raise exception 'Courier vehicle is not spare';
    end if;
    if (v_vehicle.payload ->> 'vehicleClassId') is distinct from (p_terms ->> 'vehicle_class_id') then
      raise exception 'Courier vehicle class mismatch';
    end if;
    if coalesce(public.cc_vehicle_unlock_level(v_vehicle.payload ->> 'vehicleClassId'), -1)
       < (case v_duration when 2 then 1 when 8 then 18 when 24 then 42 end) then
      raise exception 'Vehicle class cannot run this courier tier';
    end if;
    -- Fuel is charged in full at departure; never partially.
    if coalesce(p.vehicle_fuel, 0) < coalesce((p_terms ->> 'fuel_charged_units')::numeric, 0) then
      raise exception 'Insufficient vehicle fuel';
    end if;
    update public.profiles
       set vehicle_fuel = vehicle_fuel - coalesce((p_terms ->> 'fuel_charged_units')::numeric, 0),
           updated_at = now()
     where id = actor
     returning * into p;
    update public.item_instances
       set runtime_state = 'in_service', is_locked = true, updated_at = now()
     where id = v_vehicle.id;
  end if;

  insert into public.dispatch_missions (
    user_id, contract_family, offer_id, seed, destination_area_id, duration_hours,
    loadout_item_ids, loadout_strength,
    payout_credits, payout_scrap, payout_material_id, payout_material_units,
    vehicle_item_id, vehicle_class_id, route_ticks, fuel_charged_units,
    condition_at_departure, wear_projected, breakdown_fraction,
    cargo_bonus_units, premium_multiplier,
    departed_at, ends_at
  ) values (
    actor, v_family, p_terms ->> 'offer_id', coalesce(p_terms ->> 'seed', ''),
    p_terms ->> 'area_id', v_duration,
    case when v_family = 'foot' then v_item_ids else '{}' end,
    coalesce((p_terms ->> 'loadout_strength')::numeric, 0),
    coalesce((p_terms ->> 'payout_credits')::bigint, 0),
    coalesce((p_terms ->> 'payout_scrap')::bigint, 0),
    p_terms ->> 'payout_material_id',
    coalesce((p_terms ->> 'payout_material_units')::integer, 0),
    case when v_family = 'courier' then v_vehicle.id else null end,
    case when v_family = 'courier' then p_terms ->> 'vehicle_class_id' else null end,
    case when v_family = 'courier' then (p_terms ->> 'route_ticks')::integer else null end,
    case when v_family = 'courier' then coalesce((p_terms ->> 'fuel_charged_units')::numeric, 0) else 0 end,
    case when v_family = 'courier' then (p_terms ->> 'condition_at_departure')::numeric else null end,
    case when v_family = 'courier' then (p_terms ->> 'wear_projected')::numeric else null end,
    case when v_family = 'courier' then (p_terms ->> 'breakdown_fraction')::numeric else null end,
    coalesce((p_terms ->> 'cargo_bonus_units')::integer, 0),
    case when v_family = 'courier' then (p_terms ->> 'premium_multiplier')::numeric else null end,
    now(), now() + make_interval(hours => v_duration)
  ) returning * into v_mission;

  result := jsonb_build_object(
    'action_type', 'cc_dispatch_depart',
    'mission', to_jsonb(v_mission),
    'profile', public.cc_profile_snapshot(p)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_dispatch_depart', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. The settler. cc_dispatch_settle_mission applies one settlement
--    at a given fraction: pro-rata payout, item/vehicle release,
--    courier wear + fuel refund, and the cc_dispatch_settle ledger
--    row the economy metrics fold reads. The caller owns the row
--    lock + fraction computation; this helper owns the money.
-- ---------------------------------------------------------------------------

create or replace function public.cc_dispatch_settle_mission(
  p_mission public.dispatch_missions,
  p_fraction numeric,
  p_recalled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_mission.user_id;
  p public.profiles%rowtype;
  f numeric := least(1, greatest(0, coalesce(p_fraction, 1)));
  v_credits bigint := floor(p_mission.payout_credits * f);
  v_scrap bigint := floor(p_mission.payout_scrap * f);
  v_units integer := floor(p_mission.payout_material_units * f);
  v_wear numeric := null;
  v_refund numeric := 0;
  result jsonb;
begin
  select * into p from public.profiles where id = actor for update;

  -- Release the committed loadout (foot) — only rows still in the
  -- dispatch state; a row the owner somehow moved is left alone.
  if coalesce(array_length(p_mission.loadout_item_ids, 1), 0) > 0 then
    update public.item_instances
       set runtime_state = 'available', is_locked = false, updated_at = now()
     where id = any(p_mission.loadout_item_ids)
       and owner_user_id = actor
       and runtime_state = 'in_service';
  end if;

  if p_mission.contract_family = 'courier' and p_mission.vehicle_item_id is not null then
    v_wear := coalesce(p_mission.wear_projected, 0) * f;
    v_refund := coalesce(p_mission.fuel_charged_units, 0) * (1 - f);
    update public.item_instances
       set runtime_state = 'available', is_locked = false,
           condition_current = greatest(0, coalesce(p_mission.condition_at_departure, 0) - v_wear),
           updated_at = now()
     where id = p_mission.vehicle_item_id
       and owner_user_id = actor
       and runtime_state = 'in_service';
  end if;

  update public.profiles
     set credits = credits + v_credits,
         scrap = scrap + v_scrap,
         materials = case
           when p_mission.payout_material_id is not null and v_units > 0 then
             jsonb_set(coalesce(materials, '{}'::jsonb), array[p_mission.payout_material_id],
               to_jsonb(coalesce((materials ->> p_mission.payout_material_id)::bigint, 0) + v_units), true)
           else materials end,
         vehicle_fuel = vehicle_fuel + v_refund,
         updated_at = now()
   where id = actor
   returning * into p;

  update public.dispatch_missions
     set status = case when p_recalled then 'recalled' else 'settled' end,
         settled_at = now(),
         payout_fraction = f,
         wear_applied = v_wear,
         fuel_refunded_units = v_refund
   where id = p_mission.id;

  result := jsonb_build_object(
    'action_type', 'cc_dispatch_settle',
    'mission_id', p_mission.id,
    'family', p_mission.contract_family,
    'offer_id', p_mission.offer_id,
    'area_id', p_mission.destination_area_id,
    'duration_hours', p_mission.duration_hours,
    'fraction', f,
    'recalled', p_recalled,
    'breakdown', p_mission.breakdown_fraction is not null and p_mission.breakdown_fraction < 1 and f >= p_mission.breakdown_fraction - 0.000000001,
    'payout', jsonb_build_object(
      'credits', v_credits,
      'scrap', v_scrap,
      'material_id', p_mission.payout_material_id,
      'material_units', v_units
    ),
    'wear_applied', v_wear,
    'fuel_refunded_units', v_refund,
    'profile', public.cc_profile_snapshot(p)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_dispatch_settle', 'dispatch-settle:' || p_mission.id::text, result)
  on conflict (user_id, idempotency_key) do nothing;
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. cc_dispatch_settle_due — settle every active mission whose term
--    has ended (server clock). Breakdown missions settle at their
--    breakdown fraction; the rest at 1. Idempotent: settled rows are
--    no longer 'active', and the settle ledger key is deterministic.
-- ---------------------------------------------------------------------------

create or replace function public.cc_dispatch_settle_due(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  v_mission public.dispatch_missions%rowtype;
  v_settled jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtext(actor::text));
  for v_mission in
    select * from public.dispatch_missions
     where user_id = actor and status = 'active' and ends_at <= now()
     order by ends_at asc
     for update
  loop
    v_result := public.cc_dispatch_settle_mission(
      v_mission,
      coalesce(v_mission.breakdown_fraction, 1),
      false
    );
    v_settled := v_settled || jsonb_build_array(v_result);
  end loop;
  return jsonb_build_object('action_type', 'cc_dispatch_settle_due', 'settled', v_settled);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. cc_dispatch_recall — end a running contract now, pro-rata by
--    elapsed fraction (server timestamps), capped at the breakdown
--    point: a vehicle that would have broken down before the recall
--    broke down (courier brief §2.4.3).
-- ---------------------------------------------------------------------------

create or replace function public.cc_dispatch_recall(p_player_id uuid, nonce text, p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  v_mission public.dispatch_missions%rowtype;
  v_elapsed_ms numeric;
  v_fraction numeric;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into v_mission from public.dispatch_missions
   where id = p_mission_id and user_id = actor for update;
  if not found then raise exception 'Dispatch mission not found'; end if;
  if v_mission.status <> 'active' then raise exception 'Dispatch mission not active'; end if;

  v_elapsed_ms := extract(epoch from (now() - v_mission.departed_at)) * 1000;
  v_fraction := least(1, greatest(0, v_elapsed_ms / (v_mission.duration_hours * 3600000.0)));
  if v_mission.breakdown_fraction is not null then
    v_fraction := least(v_fraction, v_mission.breakdown_fraction);
  end if;

  result := public.cc_dispatch_settle_mission(v_mission, v_fraction, true);
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_dispatch_recall', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Economy metrics: dispatch + courier mint columns (the 0031
--    recompute restated with the dispatch fold — the only change
--    from the 0031 body is the two aggregates, the minted-total
--    fold, and the two insert/conflict columns).
-- ---------------------------------------------------------------------------

alter table public.economy_metrics
  add column if not exists credits_minted_dispatch integer not null default 0,
  add column if not exists credits_minted_courier integer not null default 0;

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
  er record;
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
        and result_payload ->> 'family' = 'courier'), 0) as minted_courier
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

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other
    + m.endless_credits_paid + m.minted_dispatch + m.minted_courier;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees
    + rj.fees_destroyed + m.endless_fees_destroyed;

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
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;$$;

-- ---------------------------------------------------------------------------
-- 8. Escrow hardening: the item-moving ops whose state blocklists
--    predate the in_service runtime state. cc_recycle_item (0026),
--    cc_reforge_item (0027), and cc_post_repair_job (0025) already
--    refuse in_service; the three below are restated VERBATIM from
--    their final bodies with in_service added to the refusal list,
--    so a dispatched instance cannot be equipped, listed, or lock-
--    toggled while away. (The lock toggle matters most: unlocking
--    used to flip the row straight back to available, silently
--    un-escrowing it.) The retired cc_use_patch_kit /
--    cc_item_service_request were dropped in 0025 and stay dropped;
--    the live repair lanes (cc_post_repair_job, and
--    cc_enqueue_repair_job's own in_service refusal) already refuse.
-- ---------------------------------------------------------------------------

-- cc_equip_item: verbatim from 0021_vehicles.sql, refusal list + in_service.
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

  if slot_name = 'vehicle' then
    vehicle_unlock := public.cc_vehicle_unlock_level(item.payload ->> 'vehicleClassId');
    if vehicle_unlock is null then raise exception 'Unknown vehicle class'; end if;
    if coalesce(p.player_level, 1) < vehicle_unlock then
      raise exception 'Vehicle requires hunter level %', vehicle_unlock;
    end if;
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

-- cc_market_create: verbatim from 0021_vehicles.sql, refusal list + in_service.
CREATE OR REPLACE FUNCTION public.cc_market_create(p_player_id uuid, nonce text, item_id uuid, price_credits bigint)
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
  listing public.market_listings%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if price_credits <= 0 then raise exception 'price_credits must be positive'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.account_bound or not item.tradeable or item.runtime_state in ('listed','equipped','salvaged','consumed','in_service') then raise exception 'Item not listable'; end if;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, identity_key, category, display_name,
    weapon_type, element, rarity, item_level, seller_type)
  values (
    actor, item.id, price_credits, 'active',
    case when item.kind = 'vehicle' then 'vehicle' else 'gear' end, 1,
    case when item.kind = 'vehicle'
      then 'vehicle:' || coalesce(item.payload ->> 'vehicleClassId', '') || ':' || item.rarity
      else public.cc_market_gear_identity(item.payload, item.kind, item.rarity, item.item_level) end,
    case when item.kind = 'vehicle' then 'vehicle'
      else public.cc_market_gear_category(item.payload, item.kind) end,
    item.payload ->> 'name',
    item.payload ->> 'weaponType',
    item.payload ->> 'element',
    coalesce(item.rarity, item.payload ->> 'rarity'),
    coalesce(item.item_level, (item.payload ->> 'level')::integer, 1),
    case when coalesce(item.supply_mode, '') = 'npc_market' then 'npc' else 'player' end)
  returning * into listing;

  update public.item_instances set runtime_state = 'listed' where id = item.id returning * into item;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

-- cc_item_lock: verbatim from 0004_write_apis.sql, refusal list + in_service.
CREATE OR REPLACE FUNCTION public.cc_item_lock(p_player_id uuid, nonce text, item_id uuid, locked boolean)
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

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.runtime_state in ('listed','consumed','salvaged','in_service') then raise exception 'Item state invalid'; end if;

  update public.item_instances
  set is_locked = locked,
      runtime_state = case when locked then 'locked' else 'available' end
  where id = item.id
  returning * into item;

  result := jsonb_build_object('action_type', 'cc_item_lock', 'profile', public.cc_profile_snapshot(p), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_item_lock', nonce, result);
  return result;
end;
$function$;
