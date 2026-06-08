create or replace function public.cc_vendor_buy(nonce text, item_key text, quantity integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  p public.profiles%rowtype;
  result jsonb;
  unit_price bigint;
  qty integer := greatest(1, coalesce(quantity, 1));
  total_price bigint;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  unit_price := public.cc_vendor_price(item_key);
  if unit_price is null then raise exception 'Unknown vendor item'; end if;
  total_price := unit_price * qty;
  if p.credits < total_price then raise exception 'Insufficient credits'; end if;

  update public.profiles
  set credits = credits - total_price,
      consumables = public.cc_jsonb_add_int(consumables, item_key, qty)
  where id = actor
  returning * into p;

  result := jsonb_build_object('action_type', 'cc_vendor_buy', 'profile', public.cc_profile_snapshot(p), 'item_key', item_key, 'quantity', qty, 'total_price', total_price);

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_vendor_buy', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_vendor_buy(text, text, integer) from public, anon;
grant execute on function public.cc_vendor_buy(text, text, integer) to authenticated, service_role;
