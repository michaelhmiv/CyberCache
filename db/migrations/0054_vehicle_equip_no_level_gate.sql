-- 0054: Vehicles are pure market goods — the equip level gate dies
-- (owner ruling, 2026-11-02: "No level gate at all — if you can buy
-- it, you can drive it").
--
-- cc_equip_item is restated VERBATIM from its live body (migration
-- 0032, itself verbatim from 0021 plus the in_service refusal) with
-- exactly one block changed: the vehicle slot no longer compares
-- the player's level against the class ladder. Ownership (the item
-- row's owner_user_id) and class integrity (the class id must
-- resolve) are the only checks, mirroring InMemoryWriteStore.
--
-- cc_vehicle_unlock_level is deliberately NOT dropped: the dispatch
-- courier class bands (cc_dispatch_depart, migration 0032) read it
-- as the VEHICLE's class band — it never gated on the player there
-- either. The class ladder stays as design data (drop flavor +
-- courier bands); only the equip enforcement dies.

-- cc_equip_item: verbatim from 0032 (refusal list + in_service),
-- minus the vehicle player-level gate (see header).
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
