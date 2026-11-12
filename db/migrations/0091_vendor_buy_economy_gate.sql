-- 0091 — Vendor buy carries the verified-account gate (audit M-1).
--
-- cc_vendor_buy was the one money-moving op without the economy gate:
-- a guest (or an unverified-but-funded account) reached the price and
-- balance checks while market-create/accept refuse with 403
-- 'Verified account required'. This restates cc_vendor_buy from its
-- current definition (0084) with exactly one change — the
-- can_use_player_economy guard, in the siblings' form, placed after
-- the profile load and before any price/balance evaluation. The
-- in-memory twin (MemoryJobStore.vendorBuy) gains requireEconomy()
-- in the same position.
--

create or replace function public.cc_vendor_buy(p_player_id uuid, nonce text, item_key text, quantity integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  result jsonb;
  unit_price bigint;
  base_price integer;
  v_pool text;
  v_kind text;
  v_day date := (now() at time zone 'utc')::date;
  is_iotd boolean := false;
  qty integer := greatest(1, coalesce(quantity, 1));
  total_price bigint;
  batch_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Audit M-1: the verified-account gate every sibling money-moving op
  -- carries (cc_market_create / cc_accept_listing since 0004) — before
  -- any price or balance evaluation.
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  unit_price := public.cc_vendor_price(item_key, v_day);
  if unit_price is null then raise exception 'Not offered by the vendor today'; end if;
  select c.base_price, c.pool into base_price, v_pool from public.cc_vendor_catalog() c where c.item_key = cc_vendor_buy.item_key;
  v_kind := case when v_pool in ('material', 'essence') then v_pool else 'consumable' end;
  is_iotd := item_key = public.cc_vendor_item_of_the_day(v_day);
  total_price := unit_price * qty;
  if p.credits < total_price then raise exception 'Insufficient credits'; end if;

  update public.profiles
  set credits = credits - total_price,
      consumables = case when v_kind = 'consumable'
        then public.cc_jsonb_add_int(consumables, item_key, qty) else consumables end,
      materials = case when v_kind = 'material'
        then public.cc_jsonb_add_int(materials, item_key, qty) else materials end,
      essences = case when v_kind = 'essence'
        then public.cc_jsonb_add_int(essences, item_key, qty) else essences end
  where id = actor
  returning * into p;

  if v_kind = 'consumable' then
    batch_id := public.cc_add_consumable_batch(
      actor,
      item_key,
      qty,
      100,
      'vendor',
      null,
      null,
      'vendor_buy',
      'Vendor baseline 100% quality purchase',
      jsonb_build_object('unit_price', unit_price, 'total_price', total_price)
    );
  end if;

  result := jsonb_build_object(
    'action_type', 'cc_vendor_buy',
    'profile', public.cc_profile_snapshot(p),
    'item_key', item_key,
    'kind', v_kind,
    'quantity', qty,
    'quality_percent', case when v_kind = 'consumable' then 100 else null end,
    'batch_id', batch_id,
    'unit_price', unit_price,
    'item_of_the_day', is_iotd,
    'total_price', total_price
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_vendor_buy', nonce, result);

  return result;
end;
$function$;
