create or replace function public.cc_make_item(nonce text)
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
  odds jsonb;
  rarity_value text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if p.cache_tokens < 1 then raise exception 'Not enough tokens'; end if;

  odds := public.cc_draw_odds('cache_primary_rarity');
  rarity_value := odds ->> 'outcome';

  update public.profiles set cache_tokens = cache_tokens - 1 where id = actor returning * into p;

  insert into public.item_instances (owner_user_id, kind, item_level, rarity, supply_mode, payload)
  values (actor, 'gear', greatest(1, p.player_level), rarity_value, 'verified_action', jsonb_build_object('odds', odds))
  returning * into item;

  result := jsonb_build_object('action_type', 'cc_make_item', 'profile', public.cc_profile_snapshot(p), 'odds', odds, 'item', to_jsonb(item));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_make_item', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_make_item(text) from public, anon;
grant execute on function public.cc_make_item(text) to authenticated, service_role;
