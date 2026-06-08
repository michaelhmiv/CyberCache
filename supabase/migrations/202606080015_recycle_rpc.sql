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

  result := jsonb_build_object('action_type', 'cc_recycle_item', 'profile', public.cc_profile_snapshot(p), 'item', to_jsonb(item), 'scrap_award', award);

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_recycle_item', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_recycle_item(text, uuid) from public, anon;
grant execute on function public.cc_recycle_item(text, uuid) to authenticated, service_role;
