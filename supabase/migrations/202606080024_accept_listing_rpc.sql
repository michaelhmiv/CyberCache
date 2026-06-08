create or replace function public.cc_accept_listing(nonce text, listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  p public.profiles%rowtype;
  listing public.market_listings%rowtype;
  item public.item_instances%rowtype;
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

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + listing.price_credits where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;
  update public.item_instances set owner_user_id = actor, runtime_state = 'available', is_locked = false, equipped_slot = null where id = listing.item_instance_id returning * into item;

  result := jsonb_build_object('action_type', 'cc_accept_listing', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_accept_listing', nonce, result);
  return result;
end;
$$;

revoke execute on function public.cc_accept_listing(text, uuid) from public, anon;
grant execute on function public.cc_accept_listing(text, uuid) to authenticated, service_role;
