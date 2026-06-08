create or replace function public.cc_item_service_request(nonce text, item_id uuid, service_id text default 'repair')
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
  job public.service_jobs%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.runtime_state in ('listed','consumed','salvaged') then raise exception 'Item state invalid'; end if;

  insert into public.service_jobs(owner_user_id, profession_id, status, target_item_instance_id, requested_service_id)
  values (actor, 'repair', 'listed', item.id, service_id)
  returning * into job;

  update public.item_instances set runtime_state = 'locked', is_locked = true where id = item.id returning * into item;

  result := jsonb_build_object('action_type', 'cc_item_service_request', 'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_item_service_request', nonce, result);
  return result;
end;
$$;

revoke execute on function public.cc_item_service_request(text, uuid, text) from public, anon;
grant execute on function public.cc_item_service_request(text, uuid, text) to authenticated, service_role;
