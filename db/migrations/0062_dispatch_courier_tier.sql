-- 0062: Dispatch courier tiers retargeted from class unlockLevel to
-- class tier index (gate-removal step 5; audit item G7).
--
-- Owner law (Michael, 2026-11-02): progression is gated by scarcity,
-- difficulty, and supply — not level numbers. The courier bands were
-- the last gate keyed on a level-shaped number: cc_dispatch_depart
-- (migration 0032) compared the VEHICLE class's ladder value
-- (cc_vehicle_unlock_level: 1 / 18 / 42 for the three tiers) — never
-- the player's level, but a ladder whose values are levels invites
-- exactly the confusion the program is removing, and the vehicles
-- slice (0054) already deleted the equip gate keyed on the same
-- field family.
--
-- The retarget: eligibility now reads the class TIER INDEX — the
-- class's position in the shipped ladder (src/lib/vehicles/
-- vehicles.ts VEHICLE_CLASSES), via the new SQL twin
-- cc_vehicle_class_tier. The anchors are classes, not numbers:
--   Local Run    (2h)  — any class            (tier >= 0)
--   Regional Haul (8h) — Utility Rover tier+  (tier >= 2)
--   Deep Haul    (24h) — Armored Crawler tier+ (tier >= 4)
-- The qualifying class sets are IDENTICAL to the old bands (the old
-- 18 admitted exactly the classes at tier >= 2; 42 exactly tier
-- >= 4): payouts, durations, and yields do not change — this is a
-- gate-carrier swap, not a rebalance. The TS twin
-- (vehicleClassEligibleForTier in src/content/dispatch.ts, over
-- vehicleClassTierIndex) and parity are pinned by
-- src/test/gateRemovalStep5.test.ts.
--
-- cc_vehicle_unlock_level is deliberately NOT dropped: the ladder
-- stays as design data. cc_equip_item (0054) still calls it as a
-- class-existence check ('Unknown vehicle class'), and the TS
-- roaming drop flavor weighting still reads the ladder values
-- against AREA ladders. Only the dispatch comparison moves.
--
-- What lands here:
--   1. cc_vehicle_class_tier — SQL twin of vehicleClassTierIndex.
--   2. cc_dispatch_depart restated VERBATIM from 0032 with exactly
--      one block changed: the courier gate comparison (and its
--      comment). Every refusal, charge, and lock is byte-identical,
--      including the refusal text 'Vehicle class cannot run this
--      courier tier'.

-- ---------------------------------------------------------------------------
-- 1. cc_vehicle_class_tier — tier index of a vehicle class in the
--    shipped ladder (Scrap Bike 0 -> Leviathan Rig 6); null for an
--    unknown class, mirroring cc_vehicle_unlock_level's contract.
-- ---------------------------------------------------------------------------

create or replace function public.cc_vehicle_class_tier(class_id text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case class_id
    when 'scrap_bike' then 0
    when 'dune_buggy' then 1
    when 'utility_rover' then 2
    when 'cargo_hauler' then 3
    when 'armored_crawler' then 4
    when 'relay_skimmer' then 5
    when 'leviathan_rig' then 6
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. cc_dispatch_depart — verbatim from 0032; only the courier gate
--    block reads cc_vehicle_class_tier instead of
--    cc_vehicle_unlock_level (see header).
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
    -- class tier (courier brief §2.1), never the player's level:
    -- tier index of the vehicle's class against the tier's anchor
    -- (gate-removal step 5 — the capability carrier that replaced
    -- the class ladder's unlockLevel values 1 / 18 / 42).
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
    if coalesce(public.cc_vehicle_class_tier(v_vehicle.payload ->> 'vehicleClassId'), -1)
       < (case v_duration when 2 then 0 when 8 then 2 when 24 then 4 end) then
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
