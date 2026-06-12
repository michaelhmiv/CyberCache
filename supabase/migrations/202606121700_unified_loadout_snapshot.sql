create or replace function public.cc_loadout_snapshot(actor uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'primary', null,
    'secondary', null,
    'heavy', null,
    'ordnance', null,
    'shield', null,
    'classMod', null,
    'relic', null
  ) || coalesce(
    jsonb_object_agg(equipped_slot, id::text) filter (where equipped_slot is not null),
    '{}'::jsonb
  )
  from public.item_instances
  where owner_user_id = actor
    and runtime_state = 'equipped'
    and equipped_slot in ('primary','secondary','heavy','ordnance','shield','classMod','relic');
$$;

create or replace function public.cc_item_accepts_slot(payload jsonb, slot_name text)
returns boolean
language sql
immutable
as $$
  select case
    when slot_name in ('primary','secondary','heavy') then payload is null or payload = '{}'::jsonb or payload ? 'weaponType'
    when slot_name = 'shield' then payload ? 'hp' and not payload ? 'weaponType'
    when slot_name = 'classMod' then payload ? 'treeBonus'
    when slot_name = 'ordnance' then payload ? 'damage' and payload ? 'effect' and not payload ? 'weaponType'
    when slot_name = 'relic' then payload ? 'affixes' and not payload ? 'weaponType' and not payload ? 'hp' and not payload ? 'treeBonus' and not payload ? 'damage'
    else false
  end;
$$;

create or replace function public.cc_equip_item(nonce text, item_id uuid, slot_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  cleared_items jsonb := '[]'::jsonb;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if slot_name not in ('primary','secondary','heavy','ordnance','shield','classMod','relic') then raise exception 'Invalid slot'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.runtime_state in ('listed','consumed','salvaged') then raise exception 'Item state invalid'; end if;
  if not public.cc_item_accepts_slot(coalesce(item.payload, '{}'::jsonb), slot_name) then raise exception 'Item type does not match loadout slot'; end if;

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
$$;

create or replace function public.cc_unequip_slot(nonce text, slot_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if slot_name not in ('primary','secondary','heavy','ordnance','shield','classMod','relic') then raise exception 'Invalid slot'; end if;

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
$$;

create or replace function public.cc_recycle_item(nonce text, item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
  award integer;
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

  award := public.cc_salvage_scrap(item.rarity, item.item_level);

  update public.item_instances
  set runtime_state = 'consumed', tradeable = false, equipped_slot = null
  where id = item.id
  returning * into item;

  update public.profiles
  set scrap = scrap + award
  where id = actor
  returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_recycle_item',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'scrap_award', award,
    'loadout', public.cc_loadout_snapshot(actor)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_recycle_item', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_loadout_snapshot(uuid) from public, anon;
revoke execute on function public.cc_item_accepts_slot(jsonb, text) from public, anon;
revoke execute on function public.cc_equip_item(text, uuid, text) from public, anon;
revoke execute on function public.cc_unequip_slot(text, text) from public, anon;
revoke execute on function public.cc_recycle_item(text, uuid) from public, anon;
grant execute on function public.cc_equip_item(text, uuid, text) to authenticated, service_role;
grant execute on function public.cc_unequip_slot(text, text) to authenticated, service_role;
grant execute on function public.cc_recycle_item(text, uuid) to authenticated, service_role;
