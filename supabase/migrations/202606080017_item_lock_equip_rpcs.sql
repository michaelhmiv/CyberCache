create or replace function public.cc_item_lock(nonce text, item_id uuid, locked boolean)
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

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.runtime_state in ('listed','consumed','salvaged') then raise exception 'Item state invalid'; end if;

  update public.item_instances
  set is_locked = locked,
      runtime_state = case when locked then 'locked' else 'available' end
  where id = item.id
  returning * into item;

  result := jsonb_build_object('action_type', 'cc_item_lock', 'profile', public.cc_profile_snapshot(p), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_item_lock', nonce, result);
  return result;
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

  update public.item_instances
  set equipped_slot = null,
      runtime_state = case when is_locked then 'locked' else 'available' end
  where owner_user_id = actor and equipped_slot = slot_name;

  update public.item_instances
  set equipped_slot = slot_name,
      runtime_state = 'equipped'
  where id = item.id
  returning * into item;

  result := jsonb_build_object('action_type', 'cc_equip_item', 'profile', public.cc_profile_snapshot(p), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_equip_item', nonce, result);
  return result;
end;
$$;

revoke execute on function public.cc_item_lock(text, uuid, boolean) from public, anon;
revoke execute on function public.cc_equip_item(text, uuid, text) from public, anon;
grant execute on function public.cc_item_lock(text, uuid, boolean) to authenticated, service_role;
grant execute on function public.cc_equip_item(text, uuid, text) to authenticated, service_role;
