-- 0021_vehicles.sql
--
-- Vehicles (Phase 2b): design-table vehicles become real gear.
--
--   1. SCHEMA. profiles gains vehicle_fuel (the tank, in fuel units;
--      one Generic Fuel Cell = 100 units). item_instances needs no
--      new columns: kind 'vehicle' was reserved, and condition_
--      current / condition_max have existed since 0003 — this
--      migration gives them their first writers.
--
--   2. LOADOUT. The 'vehicle' slot joins cc_item_accepts_slot
--      (payload carries vehicleClassId; the relic predicate now
--      excludes vehicle payloads), cc_equip_item / cc_unequip_slot
--      (slot lists), and cc_loadout_snapshot. Equip is LEVEL-GATED
--      server-side: cc_equip_item checks the profile's level against
--      cc_vehicle_unlock_level (the SQL twin of the class table in
--      src/lib/vehicles/vehicles.ts — parity pinned by tests).
--
--   3. STARTER GRANT. cc_initial_bundle (0004 body) also grants the
--      starter Scrap Bike once, auto-equipped when no vehicle is
--      equipped. Idempotency keys on the bundle's own claim flag
--      plus a grantSource marker on the instance.
--
--   4. FUEL + REPAIR OPS. cc_refuel_vehicle moves Generic Fuel
--      Cells from inventory into the tank; cc_use_patch_kit
--      consumes one Patch Kit (FIFO batches, the dual count-map +
--      batch maintenance cc_consume_consumable performs) and
--      restores 30 × quality% condition (the untrained base rate;
--      the TS twin is PATCH_KIT_RESTORE_POINTS in
--      src/lib/vehicles/vehicles.ts).
--
--   5. CLAIM PERSISTENCE. cc_apply_vehicle_usage writes a claim's
--      vehicle outcome (tank fuel + equipped instance condition),
--      guarded on the instance still being the equipped vehicle.
--      cc_store_chef_items learns the vehicle kind (payload carries
--      vehicleClassId — checked FIRST, since vehicle payloads also
--      carry affixes and would otherwise file as relics) and stores
--      fresh vehicles at full condition. cc_compute_item_estimated_
--      value gains the vehicle kind bonus (affix count, the relic
--      shape). cc_profile_snapshot gains vehicle_fuel.
--
--   6. MARKET. listing_kind gains 'vehicle' (check constraint
--      restated): cc_market_create stamps vehicle listings with the
--      vehicle identity key (vehicle:{classId}:{rarity} — the twin
--      of vehicleIdentityKey in src/lib/market/identityKey.ts), and
--      cc_accept_listing / cc_market_cancel treat 'vehicle' exactly
--      like 'gear' (same fee path — vehicles carry find provenance
--      in sourceTag, so the Market Manipulator term applies — and
--      the item row, condition included, transfers intact).
--
--   7. VENDOR. cc_vendor_catalog gains the two baseline staples —
--      Generic Fuel Cell (40cr) and Patch Kit (150cr) — matching
--      the consumable defs (market.vendorStocked) that
--      src/lib/vendor/catalog.ts derives its staples from.
--
-- Idempotent: add-if-missing column, create-or-replace functions,
-- constraint restated via drop-if-exists/add.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists vehicle_fuel numeric(14, 4) not null default 0;

-- ---------------------------------------------------------------------------
-- 2a. Vehicle class unlock levels — SQL twin of VEHICLE_CLASSES
-- (src/lib/vehicles/vehicles.ts). Only the unlock level is needed in
-- SQL (equip gate); yield/burn/decay stay engine-side in TS.
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
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2b. Slot acceptance — 0004 body + the vehicle slot; the relic
-- predicate excludes vehicle payloads (they carry affixes).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_item_accepts_slot(payload jsonb, slot_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when slot_name in ('primary','secondary','heavy') then payload ? 'weaponType'
    when slot_name = 'shield' then payload ? 'hp' and not payload ? 'weaponType'
    when slot_name = 'classMod' then payload ? 'treeBonus'
    when slot_name = 'ordnance' then payload ? 'damage' and payload ? 'effect' and not payload ? 'weaponType'
    when slot_name = 'relic' then payload ? 'affixes' and not payload ? 'weaponType' and not payload ? 'hp' and not payload ? 'treeBonus' and not payload ? 'damage' and not payload ? 'vehicleClassId'
    when slot_name = 'vehicle' then payload ? 'vehicleClassId'
    else false
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 2c. cc_equip_item — 0004 body + 'vehicle' slot + the equip-time
-- level gate for vehicles.
-- ---------------------------------------------------------------------------

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
  if item.runtime_state in ('listed','consumed','salvaged') then raise exception 'Item state invalid'; end if;
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

-- ---------------------------------------------------------------------------
-- 2d. cc_unequip_slot — 0004 body + 'vehicle' slot.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 2e. cc_loadout_snapshot — 0004 body + the vehicle slot.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_loadout_snapshot(actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'primary', null,
    'secondary', null,
    'heavy', null,
    'ordnance', null,
    'shield', null,
    'classMod', null,
    'relic', null,
    'vehicle', null
  ) || coalesce(
    jsonb_object_agg(equipped_slot, id::text) filter (where equipped_slot is not null),
    '{}'::jsonb
  )
  from public.item_instances
  where owner_user_id = actor
    and runtime_state = 'equipped'
    and equipped_slot in ('primary','secondary','heavy','ordnance','shield','classMod','relic','vehicle');
$function$;

-- ---------------------------------------------------------------------------
-- 3. cc_initial_bundle — 0004 body + the starter Scrap Bike grant.
-- The payload matches buildStarterVehicle (src/server/lib/generators/
-- vehicleGenerator.ts) plus the grantSource marker the grant keys
-- on. Granted inside the bundle's own once-only claim, so a second
-- bundle call raises before any duplicate can be created.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_initial_bundle(p_player_id uuid, nonce text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  result jsonb;
  bike_id uuid;
  bike public.item_instances%rowtype;
  has_equipped_vehicle boolean;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger
  where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if coalesce(p.boss_state ->> 'initial_bundle_claimed', 'false') = 'true' then raise exception 'Initial bundle already claimed'; end if;

  update public.profiles
  set credits = credits + 5000,
      scrap = scrap + 500,
      cache_tokens = cache_tokens + 3,
      boss_state = jsonb_set(coalesce(boss_state, '{}'::jsonb), '{initial_bundle_claimed}', 'true'::jsonb, true)
  where id = actor
  returning * into p;

  -- Starter vehicle: granted once, auto-equipped when the vehicle
  -- slot is empty. (The bundle claim flag already makes this
  -- once-only; the grantSource existence check is the belt to that
  -- suspender for profiles whose flag predates this migration.)
  if not exists (
    select 1 from public.item_instances
    where owner_user_id = actor and kind = 'vehicle' and payload ->> 'grantSource' = 'initial_bundle'
  ) then
    bike_id := gen_random_uuid();
    has_equipped_vehicle := exists (
      select 1 from public.item_instances
      where owner_user_id = actor and runtime_state = 'equipped' and equipped_slot = 'vehicle'
    );
    insert into public.item_instances (
      id, owner_user_id, kind, item_level, rarity, condition_current, condition_max,
      supply_mode, tradeable, account_bound, payload, runtime_state, equipped_slot, estimated_value
    ) values (
      bike_id, actor, 'vehicle', 1, 'Common', 100, 100,
      'verified_action', true, false,
      jsonb_build_object(
        'id', bike_id::text,
        'name', 'Scrap Bike',
        'vehicleClassId', 'scrap_bike',
        'level', 1,
        'rarity', 'Common',
        'affixes', '[]'::jsonb,
        'sourceTag', 'World Drop',
        'isLocked', false,
        'pixelSeed', 0,
        'grantSource', 'initial_bundle'
      ),
      case when has_equipped_vehicle then 'available' else 'equipped' end,
      case when has_equipped_vehicle then null else 'vehicle' end,
      public.cc_compute_item_estimated_value(
        jsonb_build_object('affixes', '[]'::jsonb), 'vehicle', 'Common', 1)
    ) returning * into bike;
  end if;

  result := jsonb_build_object(
    'action_type', 'cc_initial_bundle',
    'profile', public.cc_profile_snapshot(p),
    'item', case when bike.id is null then null else to_jsonb(bike) end,
    'loadout', public.cc_loadout_snapshot(actor)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_initial_bundle', nonce, result);

  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4a. cc_refuel_vehicle — load Generic Fuel Cells into the tank.
-- Consumption uses the same dual maintenance as cc_consume_
-- consumable: count-map check, legacy batch backfill, FIFO batch
-- consumption, count decrement. 100 fuel units per cell (the TS
-- twin is FUEL_UNITS_PER_CELL in src/lib/vehicles/vehicles.ts).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_refuel_vehicle(p_player_id uuid, nonce text, cells integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  qty integer := coalesce(cells, 0);
  current_count integer;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if qty < 1 then raise exception 'cells must be a positive integer'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  current_count := coalesce((coalesce(p.consumables, '{}'::jsonb) ->> 'GenericFuelCell')::integer, 0);
  if current_count < qty then raise exception 'Insufficient consumable quantity for %', 'GenericFuelCell'; end if;

  if not exists (select 1 from public.consumable_batches where owner_user_id = actor and consumable_type = 'GenericFuelCell' and quantity > 0) then
    perform public.cc_add_consumable_batch(actor, 'GenericFuelCell', current_count, 100, 'vendor', null, null, 'admin_adjust', 'Backfilled legacy count into 100% batch before consumption', '{}'::jsonb);
  end if;
  perform public.cc_consume_consumable_batch(actor, 'GenericFuelCell', qty, 'vehicle', 'Loaded into vehicle tank', '{}'::jsonb);

  update public.profiles
     set consumables = jsonb_set(coalesce(consumables, '{}'::jsonb), array['GenericFuelCell'], to_jsonb(greatest(current_count - qty, 0)), true),
         vehicle_fuel = vehicle_fuel + qty * 100,
         updated_at = now()
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_refuel_vehicle',
    'profile', public.cc_profile_snapshot(p),
    'cells_loaded', qty,
    'fuel_units_added', qty * 100,
    'vehicle_fuel', p.vehicle_fuel
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_refuel_vehicle', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4b. cc_use_patch_kit — consume one Patch Kit (FIFO; the consumed
-- batch's quality scales the restore) and restore condition on any
-- owned vehicle instance. 30 points at 100% quality — the untrained
-- base rate (TS twin: PATCH_KIT_RESTORE_POINTS).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_use_patch_kit(p_player_id uuid, nonce text, item_id uuid)
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
  current_count integer;
  consumed jsonb;
  kit_quality numeric;
  restored numeric;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.kind <> 'vehicle' then raise exception 'Item is not a vehicle'; end if;
  if item.runtime_state in ('listed','consumed','salvaged') then raise exception 'Item state invalid'; end if;

  current_count := coalesce((coalesce(p.consumables, '{}'::jsonb) ->> 'PatchKit')::integer, 0);
  if current_count < 1 then raise exception 'Insufficient consumable quantity for %', 'PatchKit'; end if;

  if not exists (select 1 from public.consumable_batches where owner_user_id = actor and consumable_type = 'PatchKit' and quantity > 0) then
    perform public.cc_add_consumable_batch(actor, 'PatchKit', current_count, 100, 'vendor', null, null, 'admin_adjust', 'Backfilled legacy count into 100% batch before consumption', '{}'::jsonb);
  end if;
  consumed := public.cc_consume_consumable_batch(actor, 'PatchKit', 1, 'vehicle', 'Vehicle condition repair', '{}'::jsonb);
  kit_quality := coalesce((consumed -> 'consumed' -> 0 ->> 'quality_percent')::numeric, 100);
  restored := greatest(1, round(30 * kit_quality / 100));

  update public.profiles
     set consumables = jsonb_set(coalesce(consumables, '{}'::jsonb), array['PatchKit'], to_jsonb(greatest(current_count - 1, 0)), true),
         updated_at = now()
   where id = actor
   returning * into p;

  update public.item_instances
     set condition_current = least(coalesce(condition_max, 100), coalesce(condition_current, coalesce(condition_max, 100)) + restored),
         updated_at = now()
   where id = item.id
   returning * into item;

  result := jsonb_build_object(
    'action_type', 'cc_use_patch_kit',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'restored', restored,
    'condition_current', item.condition_current,
    'condition_max', item.condition_max
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_use_patch_kit', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5a. cc_apply_vehicle_usage — a claim's vehicle outcome. Guarded:
-- applies only while the instance is still the player's equipped
-- vehicle (a mid-claim swap means the claim's wear belongs to a
-- vehicle no longer in use — the fuel/condition writes are skipped
-- rather than written to the wrong vehicle).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_apply_vehicle_usage(p_player_id uuid, item_id uuid, fuel_units numeric, condition_current numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  item public.item_instances%rowtype;
  new_fuel numeric;
begin
  if actor is null then raise exception 'Authentication required'; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor
     and runtime_state = 'equipped' and equipped_slot = 'vehicle'
   for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'vehicle_not_equipped');
  end if;

  update public.profiles
     set vehicle_fuel = greatest(0, coalesce(fuel_units, 0)), updated_at = now()
   where id = actor
   returning vehicle_fuel into new_fuel;

  update public.item_instances
     set condition_current = greatest(0, least(coalesce(condition_max, 100), coalesce(condition_current, 0))),
         updated_at = now()
   where id = item.id
   returning * into item;

  return jsonb_build_object(
    'applied', true,
    'vehicle_fuel', new_fuel,
    'condition_current', item.condition_current,
    'condition_max', item.condition_max
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5b. cc_profile_snapshot — 0004 body + vehicle_fuel.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_profile_snapshot(profile_row profiles)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', profile_row.id,
    'player_level', profile_row.player_level,
    'player_xp', profile_row.player_xp,
    'credits', profile_row.credits,
    'scrap', profile_row.scrap,
    'cache_tokens', profile_row.cache_tokens,
    'cache_token_parts', profile_row.cache_token_parts,
    'materials', profile_row.materials,
    'essences', profile_row.essences,
    'consumables', profile_row.consumables,
    'consumable_batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'consumable_type', b.consumable_type,
        'quality_percent', b.quality_percent,
        'quantity', b.quantity,
        'origin', b.origin,
        'creator_user_id', b.creator_user_id,
        'source_recipe_id', b.source_recipe_id,
        'metadata', b.metadata,
        'created_at', b.created_at,
        'updated_at', b.updated_at
      ) order by b.consumable_type, b.quality_percent desc, b.created_at)
      from public.consumable_batches b
      where b.owner_user_id = profile_row.id and b.quantity > 0
    ), '[]'::jsonb),
    'vehicle_fuel', profile_row.vehicle_fuel,
    'skill_spends', profile_row.skill_spends,
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at
  );
$function$;

-- ---------------------------------------------------------------------------
-- 5c. cc_store_chef_items — 0007 body + vehicle kind derivation
-- (checked FIRST: vehicle payloads carry affixes) and condition
-- columns for stored vehicles (fresh drops arrive at full wear).
-- ---------------------------------------------------------------------------

create or replace function public.cc_store_chef_items(
  p_player_id uuid,
  p_items jsonb,
  p_source text default 'chef_claim'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  entry jsonb;
  item_id text;
  kind text;
  stored integer := 0;
  stored_items jsonb := '[]'::jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'items must be an array'; end if;

  for entry in select value from jsonb_array_elements(p_items)
  loop
    item_id := entry ->> 'id';
    if item_id is null or item_id = '' then continue; end if;
    if exists (select 1 from public.item_instances where owner_user_id = actor and payload ->> 'id' = item_id) then continue; end if;

    kind := case
      when entry ? 'vehicleClassId' then 'vehicle'
      when entry ? 'weaponType' then 'weapon'
      when entry ? 'mitigation' then 'shield'
      when entry ? 'treeBonus' then 'classMod'
      when entry ? 'damage' then 'ordnance'
      when entry ? 'affixes' then 'relic'
      else 'gear'
    end;

    insert into public.item_instances (
      id, owner_user_id, kind, item_level, rarity,
      condition_current, condition_max,
      supply_mode, tradeable, account_bound, payload, runtime_state,
      estimated_value
    ) values (
      gen_random_uuid(), actor, kind,
      coalesce(nullif(entry ->> 'level', '')::integer, 1),
      coalesce(nullif(entry ->> 'rarity', ''), 'Common'),
      case when kind = 'vehicle' then 100 else null end,
      case when kind = 'vehicle' then 100 else null end,
      'verified_action', true, false, entry, 'available',
      public.cc_compute_item_estimated_value(entry, kind, coalesce(nullif(entry ->> 'rarity', ''), 'Common'), coalesce(nullif(entry ->> 'level', '')::integer, 1))
    );
    stored := stored + 1;
    stored_items := stored_items || entry;
  end loop;

  return jsonb_build_object('source', p_source, 'stored', stored, 'items', stored_items);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5d. cc_compute_item_estimated_value — 0004 body + the vehicle
-- kind bonus (affix count, mirroring src/lib/vendor/catalog.ts).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_compute_item_estimated_value(_payload jsonb, _kind text, _rarity text, _item_level integer)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rarity_mult numeric := case _rarity
    when 'Common' then 1
    when 'Uncommon' then 2
    when 'Rare' then 5
    when 'Epic' then 10
    when 'Legendary' then 25
    else 1
  end;
  v_level numeric := greatest(1, coalesce(_item_level, 1));
  v_base numeric := v_level * 100 * v_rarity_mult;
  v_kind_bonus numeric := 0;
  v_affix_count integer;
begin
  if _kind = 'weapon' then
    v_kind_bonus := coalesce((_payload ->> 'combatPower')::numeric, 0) * 2;
  elsif _kind = 'shield' then
    v_kind_bonus := coalesce((_payload ->> 'hp')::numeric, 0) * 0.5
                  * (1 + coalesce((_payload ->> 'mitigation')::numeric, 0));
  elsif _kind = 'classMod' then
    v_affix_count := coalesce(jsonb_array_length(_payload -> 'affixes'), 0);
    v_kind_bonus := (coalesce((select count(*) from jsonb_object_keys(coalesce(_payload -> 'nodeBoosts', '{}'::jsonb))), 0) * 50 + v_affix_count * 30) * v_level;
  elsif _kind = 'relic' then
    v_affix_count := coalesce(jsonb_array_length(_payload -> 'affixes'), 0);
    v_kind_bonus := v_affix_count * 40 * v_rarity_mult;
  elsif _kind = 'vehicle' then
    v_affix_count := coalesce(jsonb_array_length(_payload -> 'affixes'), 0);
    v_kind_bonus := v_affix_count * 40 * v_rarity_mult;
  elsif _kind = 'ordnance' then
    v_kind_bonus := (
      coalesce((_payload ->> 'damage')::numeric, 0)
      + coalesce((_payload ->> 'shieldDamage')::numeric, 0)
      + coalesce((_payload ->> 'armorDamage')::numeric, 0)
    ) * 1.5;
  end if;

  return floor(v_base + v_kind_bonus)::bigint;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6a. listing_kind gains 'vehicle'.
-- ---------------------------------------------------------------------------

alter table public.market_listings
  drop constraint if exists market_listings_listing_kind_check;
alter table public.market_listings
  add constraint market_listings_listing_kind_check
  check (listing_kind = any (array['gear'::text, 'consumable'::text, 'material'::text, 'vehicle'::text]));

-- ---------------------------------------------------------------------------
-- 6b. cc_market_create — 0019 body + the vehicle stamp branch
-- (identity key / category twins of src/lib/market/identityKey.ts).
-- ---------------------------------------------------------------------------

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
  if item.account_bound or not item.tradeable or item.runtime_state in ('listed','equipped','salvaged','consumed') then raise exception 'Item not listable'; end if;

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

-- ---------------------------------------------------------------------------
-- 6c. cc_accept_listing — the 0019 definition with 'vehicle' folded
-- into the gear branches (fee + delivery). Vehicles carry find
-- provenance in payload sourceTag, so the found-item fee logic
-- applies unchanged; the item row — condition included — transfers
-- to the buyer intact.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_accept_listing(p_player_id uuid, nonce text, listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  listing public.market_listings%rowtype;
  item public.item_instances%rowtype;
  seller public.profiles%rowtype;
  mod_payload jsonb;
  darknet_pts numeric := 0;
  manip_pts numeric := 0;
  fee_reduction numeric := 0;
  fee_credits bigint := 0;
  fee_rate numeric := 0.05;
  found_item boolean := false;
  delivered_batch_id uuid;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into listing from public.market_listings where id = listing_id for update;
  if not found or listing.status <> 'active' then raise exception 'Active listing not found'; end if;
  if listing.seller_user_id = actor then raise exception 'Cannot accept own listing'; end if;
  if p.credits < listing.price_credits then raise exception 'Insufficient credits'; end if;

  select * into seller from public.profiles where id = listing.seller_user_id;

  if listing.listing_kind in ('gear', 'vehicle') then
    -- Market fee (0017; rate levered in 0018): derived from the
    -- seller's OWN database records inside this transaction. NPC
    -- listings (supply_mode 'npc_market') are exempt.
    select * into item from public.item_instances where id = listing.item_instance_id;
    if seller.id is not null and item.id is not null and coalesce(item.supply_mode, '') <> 'npc_market' then
      fee_rate := least(1::numeric, greatest(0::numeric,
        public.cc_economy_config_number('marketFeeRate', 0.05)));
      select payload into mod_payload from public.item_instances
       where owner_user_id = seller.id and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((seller.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      manip_pts := coalesce((seller.skill_spends ->> 'scav_major_3')::numeric, 0)
                 + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_major_3')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
        manip_pts := least(1::numeric, manip_pts + 1);
      end if;
      found_item := coalesce(item.payload ->> 'sourceTag', '') in ('World Drop', 'Boss Drop', 'Cache-Forged', 'Event')
        and not exists (
          select 1 from public.verified_action_ledger l
           where l.user_id = seller.id
             and l.action_type = 'cc_accept_listing'
             and l.result_payload -> 'item' ->> 'id' = item.id::text
        );
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when found_item then 0.15 * manip_pts else 0 end));
      fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
    end if;
  else
    -- Consumable / material sale: same fee, Darknet Broker reduction
    -- only — stacks carry no find provenance, so the Market
    -- Manipulator term never applies. Player listings only (these
    -- kinds have no NPC source; seller_type pins it regardless).
    if seller.id is not null and coalesce(listing.seller_type, 'player') <> 'npc' then
      fee_rate := least(1::numeric, greatest(0::numeric,
        public.cc_economy_config_number('marketFeeRate', 0.05)));
      select payload into mod_payload from public.item_instances
       where owner_user_id = seller.id and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((seller.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
      end if;
      fee_reduction := least(1::numeric, greatest(0::numeric, 0.05 * darknet_pts));
      fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
    end if;
  end if;

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + (listing.price_credits - fee_credits) where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;

  if listing.listing_kind in ('gear', 'vehicle') then
    update public.item_instances set owner_user_id = actor, runtime_state = 'available', is_locked = false, equipped_slot = null where id = listing.item_instance_id returning * into item;
  elsif listing.listing_kind = 'consumable' then
    delivered_batch_id := public.cc_add_consumable_batch(
      actor,
      listing.consumable_type,
      listing.quantity,
      listing.quality_percent,
      coalesce(listing.batch_origin, 'market'),
      listing.batch_creator_user_id,
      listing.batch_source_recipe_id,
      'market_buy',
      'Player market purchase',
      jsonb_build_object('listing_id', listing.id, 'seller_user_id', listing.seller_user_id)
    );
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, listing.consumable_type, listing.quantity)
     where id = actor;
  elsif listing.listing_kind = 'material' then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, listing.material_id, listing.quantity)
     where id = actor;
  end if;

  -- Re-read the buyer so the result snapshot carries the delivery.
  select * into p from public.profiles where id = actor;

  result := jsonb_build_object('action_type', 'cc_accept_listing', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item), 'delivery', jsonb_build_object('kind', listing.listing_kind, 'quantity', listing.quantity, 'quality_percent', listing.quality_percent, 'consumable_type', listing.consumable_type, 'material_id', listing.material_id, 'batch_id', delivered_batch_id), 'market_fee', jsonb_build_object('fee_credits', fee_credits, 'seller_proceeds', listing.price_credits - fee_credits, 'fee_rate', fee_rate, 'fee_reduction', fee_reduction, 'found_item', found_item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_accept_listing', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6d. cc_market_cancel — 0019 body with 'vehicle' in the gear
-- restore branch.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_market_cancel(p_player_id uuid, nonce text, listing_id uuid)
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
  batch public.consumable_batches%rowtype;
  listing public.market_listings%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into listing from public.market_listings where id = listing_id for update;
  if not found or listing.seller_user_id <> actor then raise exception 'Listing not found'; end if;
  if listing.status <> 'active' then raise exception 'Listing not active'; end if;

  update public.market_listings set status = 'cancelled' where id = listing.id returning * into listing;

  if listing.listing_kind in ('gear', 'vehicle') then
    update public.item_instances set runtime_state = case when is_locked then 'locked' else 'available' end where id = listing.item_instance_id returning * into item;
  elsif listing.listing_kind = 'consumable' then
    update public.consumable_batches
       set quantity = consumable_batches.quantity + listing.quantity, updated_at = now()
     where id = listing.consumable_batch_id
    returning * into batch;
    if batch.id is null then
      -- The escrowed batch row is gone (e.g. progress reset): rebuild
      -- the stack from the listing's snapshot instead of losing it.
      perform public.cc_add_consumable_batch(
        actor, listing.consumable_type, listing.quantity, listing.quality_percent,
        coalesce(listing.batch_origin, 'market'), listing.batch_creator_user_id,
        listing.batch_source_recipe_id, 'market_sell',
        'Listing cancelled — escrow returned', jsonb_build_object('listing_id', listing.id));
    else
      insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, reason, metadata)
      values (actor, batch.id, listing.consumable_type, listing.quantity, listing.quality_percent, 'market_sell', 'Listing cancelled — escrow returned', jsonb_build_object('listing_id', listing.id));
    end if;
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, listing.consumable_type, listing.quantity)
     where id = actor
    returning * into p;
  elsif listing.listing_kind = 'material' then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, listing.material_id, listing.quantity)
     where id = actor
    returning * into p;
  end if;

  result := jsonb_build_object('action_type', 'cc_market_cancel', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_cancel', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. cc_vendor_catalog — 0020 body + the two vehicle staples
-- (Generic Fuel Cell 40cr, Patch Kit 150cr), matching the
-- consumable defs' market configs that src/lib/vendor/catalog.ts
-- derives its staple list from.
-- ---------------------------------------------------------------------------

create or replace function public.cc_vendor_catalog()
returns table(item_key text, base_price integer, pool text)
language sql
immutable
set search_path = public
as $$
  values
    -- Staples (consumable defs with market.vendorStocked)
    ('MedKit', 250, 'staple'),
    ('ShieldCell', 300, 'staple'),
    ('AmmoPack', 150, 'staple'),
    ('Grenade', 400, 'staple'),
    ('BossScanner', 600, 'staple'),
    ('InsuranceToken', 800, 'staple'),
    ('LuckBooster', 350, 'staple'),
    ('GenericFuelCell', 40, 'staple'),
    ('PatchKit', 150, 'staple'),
    -- Rotation consumables (priced, player-marketable, not staples)
    ('MedKitRefined', 600, 'rotation'),
    ('NanoSwarm', 800, 'rotation'),
    ('AdrenalineShot', 1200, 'rotation'),
    ('HighCapacityAmmoPack', 375, 'rotation'),
    ('ArmorPiercingAmmo', 400, 'rotation'),
    ('IncendiaryAmmo', 450, 'rotation'),
    ('ShockAmmo', 450, 'rotation'),
    ('CorrosiveAmmo', 450, 'rotation'),
    ('CryoAmmo', 450, 'rotation'),
    ('VoidAmmo', 700, 'rotation'),
    ('OrdnanceCharge', 400, 'rotation'),
    ('EMPCharge', 650, 'rotation'),
    ('CorrosiveCharge', 650, 'rotation'),
    ('PhaseShiftGrenade', 1000, 'rotation'),
    ('MagnetizedPayload', 650, 'rotation'),
    ('OverchargeStim', 800, 'rotation'),
    ('TargetPainter', 600, 'rotation'),
    ('Jammer', 750, 'rotation'),
    ('SignalScrambler', 500, 'rotation'),
    ('LootBeacon', 900, 'rotation'),
    ('DataSkimmer', 900, 'rotation'),
    ('SalvageContract', 700, 'rotation'),
    ('WorkshopRushTicket', 1000, 'rotation'),
    -- Materials (profile counters; rotation pool + buyback values)
    ('ScrapAlloy', 10, 'material'),
    ('BallisticParts', 15, 'material'),
    ('ReactiveComponents', 20, 'material'),
    ('TechFragments', 35, 'material'),
    ('VoidDust', 75, 'material'),
    -- Essences (profile counters; rotation pool + buyback values)
    ('IgnitionFluid', 30, 'essence'),
    ('ConduitWire', 30, 'essence'),
    ('AcidCompound', 30, 'essence'),
    ('CryoGel', 30, 'essence'),
    ('VoidEssence', 90, 'essence')
$$;
