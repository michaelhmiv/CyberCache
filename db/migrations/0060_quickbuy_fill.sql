-- 0060 — QuickBuy (QB-1): the atomic shortfall fill.
--
-- Owner directive (2026-11-03): every shortfall goods line gains a
-- + button; its pop-up sheet lists Market and Vendor (when stocked
-- today) pricing on two tabs and fills the shortfall in place. The
-- server half of that pattern is this migration:
--
--   cc_quickbuy_quote(player, good_kind, good_id, quantity)
--     The advisory quote read: the market sweep plan over OPEN
--     stack listings for the good (cheapest unit price first, the
--     buyer's own listings excluded) + today's vendor offer for the
--     good (cc_vendor_price — rotation + Item of the Day resolved
--     at read time) + the buyer's balance. No locks, no writes.
--
--   cc_quickbuy_fill(player, nonce, source, good_kind, good_id,
--                    quantity, quoted_total)
--     The atomic fill. ONE source leg per call — the tab the player
--     confirmed:
--       'market': re-run the sweep under row locks and take the
--         cheapest stacks until the quantity is covered. Stacks may
--         be taken PARTIALLY (the one new market invariant, below).
--       'vendor': settle through cc_vendor_buy itself (derived
--         nonce), so price, rotation, quality and delivery are the
--         shipped vendor semantics by construction.
--     The quote is a CEILING: the fill charges the re-planned total
--     only when supply still covers the confirmed quantity AND the
--     total is <= the quoted ceiling AND the balance covers it.
--     Otherwise it writes nothing (except its own ledger row) and
--     returns status 'requote' with a reason and a FRESH quote —
--     never an overcharge, never a silent under-fill.
--
-- The partial-stack invariant (SCOPE §4.3): taking q from a stack
-- of (Q, P) charges floor(P * q / Q); the remainder listing keeps
-- P - charge for Q - q. A full take is exactly today's
-- cc_accept_listing. Per leg, the fee treatment is
-- cc_accept_listing's stack branch verbatim (levered rate, Darknet
-- Broker, House Brand on crafted batches, Syndicate Ledger
-- research term, then the Cache Rank Silver Tongue uplift on the
-- post-fee proceeds; NPC-seeded listings exempt), and each leg
-- writes a cc_accept_listing ledger row under a derived nonce
-- (nonce || ':leg:' || listing_id) whose payload is shaped like an
-- accept of the taken portion — so the economy metrics, the
-- lifetime fold, the leaderboard fold and the mastery trigger see
-- exactly what the equivalent manual accepts would have written.
--
-- Guests: the quote is a read and stays open (the sheet renders in
-- full for guests); the fill refuses through can_use_player_economy
-- with the same 'Verified account required' refusal as
-- cc_accept_listing — the lock sits on the transacting action.
--
-- Goods are the five stack kinds: material / essence (profile
-- counters), consumable (quality-bearing batches), fragment and
-- core (the two 0050 commodities). The vendor leg resolves through
-- the vendor catalog, so fragments and cores — which the vendor
-- never sells — requote as 'vendor_unavailable'.

-- ---------------------------------------------------------------------------
-- cc_quickbuy_quote: the advisory read.
-- ---------------------------------------------------------------------------
create or replace function public.cc_quickbuy_quote(
  p_player_id uuid,
  p_good_kind text,
  p_good_id text,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  qty integer := greatest(1, coalesce(p_quantity, 1));
  v_balance bigint;
  v_plan jsonb;
  v_listings jsonb;
  v_day date := (now() at time zone 'utc')::date;
  v_unit integer;
  v_base integer;
  v_pool text;
  v_vendor jsonb := null;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_good_kind not in ('material', 'essence', 'consumable', 'fragment', 'core') then
    raise exception 'Unknown quick-buy good';
  end if;

  select credits into v_balance from public.profiles where id = actor;
  if not found then raise exception 'Profile not found'; end if;

  -- The sweep: eligible rows (open, not the buyer's own, this good),
  -- cheapest unit price first, listed_at then id as tie-breaks —
  -- the same order the fill locks in.
  with elig as (
    select l.id, l.seller_user_id, coalesce(l.seller_type, 'player') as seller_kind,
           l.quantity, l.price_credits, l.quality_percent, l.listed_at,
           (l.price_credits::numeric / nullif(l.quantity, 0)) as unit_price
      from public.market_listings l
     where l.status = 'active'
       and l.seller_user_id <> actor
       and l.listing_kind = p_good_kind
       and (
         (p_good_kind = 'material' and l.material_id = p_good_id)
         or (p_good_kind = 'essence' and l.essence_id = p_good_id)
         or (p_good_kind = 'consumable' and l.consumable_type = p_good_id)
         or p_good_kind in ('fragment', 'core')
       )
  ),
  run as (
    select e.*, sum(e.quantity) over (order by e.unit_price, e.listed_at, e.id) as cum_qty
      from elig e
  ),
  takes as (
    select r.*,
           greatest(0, least(r.quantity, qty - (r.cum_qty - r.quantity))) as take_qty,
           case
             when greatest(0, least(r.quantity, qty - (r.cum_qty - r.quantity))) >= r.quantity
               then r.price_credits
             else floor(r.price_credits::numeric
                        * greatest(0, least(r.quantity, qty - (r.cum_qty - r.quantity)))
                        / nullif(r.quantity, 0))::bigint
           end as charge
      from run r
  )
  select jsonb_build_object(
           'supplyQty', coalesce((select sum(quantity) from elig), 0),
           'fillableQty', least(qty, coalesce((select sum(quantity) from elig), 0)),
           'partial', coalesce((select sum(quantity) from elig), 0) < qty,
           'total', coalesce((select sum(charge) from takes where take_qty > 0), 0),
           'worstUnitPrice', (select max(unit_price) from takes where take_qty > 0),
           'fills', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'listingId', t.id,
                      'sellerKind', t.seller_kind,
                      'takeQty', t.take_qty,
                      'unitPrice', t.unit_price,
                      'charge', t.charge,
                      'qualityPercent', t.quality_percent
                    ) order by t.unit_price, t.listed_at, t.id)
               from takes t where t.take_qty > 0), '[]'::jsonb)
         ),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', e.id,
                    'sellerUserId', e.seller_user_id,
                    'sellerKind', e.seller_kind,
                    'quantity', e.quantity,
                    'priceCredits', e.price_credits,
                    'qualityPercent', e.quality_percent,
                    'listedAt', e.listed_at
                  ) order by e.unit_price, e.listed_at, e.id)
             from (select * from elig order by unit_price, listed_at, id limit 100) e), '[]'::jsonb)
    into v_plan, v_listings
    from (select 1) dummy;

  -- The vendor half: the catalog resolves stock + price for TODAY.
  -- Fragment/core goods have no catalog row, so their vendor half
  -- is null by construction.
  if p_good_kind in ('consumable', 'material', 'essence') then
    v_unit := public.cc_vendor_price(p_good_id, v_day);
    if v_unit is not null then
      select c.base_price, c.pool into v_base, v_pool
        from public.cc_vendor_catalog() c where c.item_key = p_good_id;
      v_vendor := jsonb_build_object(
        'unitPrice', v_unit,
        'basePrice', v_base,
        'itemOfTheDay', p_good_id = public.cc_vendor_item_of_the_day(v_day),
        'staple', v_pool = 'staple',
        'total', v_unit::bigint * qty
      );
    end if;
  end if;

  return jsonb_build_object(
    'action_type', 'cc_quickbuy_quote',
    'good', jsonb_build_object('kind', p_good_kind, 'id', p_good_id),
    'requested_qty', qty,
    'balance', v_balance,
    'market', v_plan || jsonb_build_object('listings', v_listings),
    'vendor', v_vendor
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- cc_quickbuy_requote: the abort payload. Records the attempt in
-- the ledger (a replay returns the same answer) and embeds a FRESH
-- quote so the sheet re-renders without a second round trip.
-- Called only from cc_quickbuy_fill, after its validations and
-- before any economy write — the abort moves nothing.
-- ---------------------------------------------------------------------------
create or replace function public.cc_quickbuy_requote(
  p_player_id uuid,
  nonce text,
  reason text,
  p_good_kind text,
  p_good_id text,
  p_quantity integer,
  snap jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  result jsonb;
begin
  result := jsonb_build_object(
    'action_type', 'cc_quickbuy_fill',
    'status', 'requote',
    'reason', reason,
    'quote', public.cc_quickbuy_quote(p_player_id, p_good_kind, p_good_id, p_quantity),
    'profile', snap
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (p_player_id, 'cc_quickbuy_fill', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- cc_quickbuy_fill: the atomic fill.
-- ---------------------------------------------------------------------------
create or replace function public.cc_quickbuy_fill(
  p_player_id uuid,
  nonce text,
  p_source text,
  p_good_kind text,
  p_good_id text,
  p_quantity integer,
  p_quoted_total bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  qty integer := greatest(1, coalesce(p_quantity, 1));
  ceiling bigint := coalesce(p_quoted_total, -1);
  v_day date := (now() at time zone 'utc')::date;
  -- market sweep state
  listing public.market_listings%rowtype;
  seller public.profiles%rowtype;
  remaining integer;
  supply integer := 0;
  plan_total bigint := 0;
  take integer;
  leg_charge bigint;
  leg record;
  take_row jsonb;
  legs jsonb := '[]'::jsonb;
  leg_rows jsonb := '[]'::jsonb;
  -- per-leg fee state (cc_accept_listing's stack branch)
  mod_payload jsonb;
  darknet_pts numeric;
  house_pts numeric;
  crafted_item boolean;
  fee_rate numeric;
  fee_reduction numeric;
  fee_credits bigint;
  proceeds_bonus bigint;
  delivered_batch_id uuid;
  -- fragment delivery accumulators (the 0050 conversion runs on the
  -- profile row exactly as cc_accept_listing's does)
  v_parts integer;
  v_tokens integer;
  -- vendor leg state
  v_unit integer;
  vendor_result jsonb;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if p_source not in ('market', 'vendor') then raise exception 'Unknown quick-buy source'; end if;
  if p_good_kind not in ('material', 'essence', 'consumable', 'fragment', 'core') then
    raise exception 'Unknown quick-buy good';
  end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  -- ── Vendor leg ──────────────────────────────────────────────────
  if p_source = 'vendor' then
    v_unit := public.cc_vendor_price(p_good_id, v_day);
    if v_unit is null then
      return public.cc_quickbuy_requote(actor, nonce, 'vendor_unavailable',
        p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
    end if;
    if v_unit::bigint * qty > ceiling then
      return public.cc_quickbuy_requote(actor, nonce, 'price_moved',
        p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
    end if;
    if p.credits < v_unit::bigint * qty then
      return public.cc_quickbuy_requote(actor, nonce, 'insufficient_credits',
        p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
    end if;
    -- Settle through the shipped vendor op itself: rotation, IoTD,
    -- flat-100% batches, counter grants and its ledger row are the
    -- vendor semantics by construction. It re-derives the same
    -- price inside this transaction (now() is transaction-stable),
    -- and the validations above have already guaranteed it cannot
    -- refuse on price or balance.
    vendor_result := public.cc_vendor_buy(actor, nonce || ':vendor', p_good_id, qty);
    result := jsonb_build_object(
      'action_type', 'cc_quickbuy_fill',
      'status', 'filled',
      'source', 'vendor',
      'good', jsonb_build_object('kind', p_good_kind, 'id', p_good_id),
      'quantity', qty,
      'total_charged', vendor_result -> 'total_price',
      'vendor', jsonb_build_object(
        'unit_price', vendor_result -> 'unit_price',
        'item_of_the_day', vendor_result -> 'item_of_the_day',
        'kind', vendor_result -> 'kind',
        'batch_id', vendor_result -> 'batch_id'
      ),
      'profile', vendor_result -> 'profile'
    );
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_quickbuy_fill', nonce, result);
    return result;
  end if;

  -- ── Market leg ──────────────────────────────────────────────────
  -- Plan under lock: walk the good's open stacks cheapest-unit
  -- first (own listings excluded), locking in sweep order.
  remaining := qty;
  for listing in
    select * from public.market_listings l
     where l.status = 'active'
       and l.seller_user_id <> actor
       and l.listing_kind = p_good_kind
       and (
         (p_good_kind = 'material' and l.material_id = p_good_id)
         or (p_good_kind = 'essence' and l.essence_id = p_good_id)
         or (p_good_kind = 'consumable' and l.consumable_type = p_good_id)
         or p_good_kind in ('fragment', 'core')
       )
     order by (l.price_credits::numeric / nullif(l.quantity, 0)), l.listed_at, l.id
     for update
  loop
    supply := supply + listing.quantity;
    if remaining > 0 then
      take := least(remaining, listing.quantity);
      leg_charge := case when take >= listing.quantity then listing.price_credits
                         else floor(listing.price_credits::numeric * take / listing.quantity)::bigint end;
      plan_total := plan_total + leg_charge;
      legs := legs || jsonb_build_object(
        'listing_id', listing.id,
        'take_qty', take,
        'charge', leg_charge,
        'stack_qty', listing.quantity,
        'stack_price', listing.price_credits
      );
      remaining := remaining - take;
    end if;
  end loop;

  if supply < qty then
    return public.cc_quickbuy_requote(actor, nonce, 'supply_changed',
      p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
  end if;
  if plan_total > ceiling then
    return public.cc_quickbuy_requote(actor, nonce, 'price_moved',
      p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
  end if;
  if p.credits < plan_total then
    return public.cc_quickbuy_requote(actor, nonce, 'insufficient_credits',
      p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
  end if;

  -- Charge the buyer once, then settle leg by leg.
  update public.profiles set credits = credits - plan_total where id = actor returning * into p;
  v_parts := coalesce(p.cache_token_parts, 0);
  v_tokens := coalesce(p.cache_tokens, 0);

  for leg in select * from jsonb_to_recordset(legs) as x(listing_id uuid, take_qty integer, charge bigint, stack_qty integer, stack_price bigint)
  loop
    select * into listing from public.market_listings where id = leg.listing_id;
    select * into seller from public.profiles where id = listing.seller_user_id;

    -- Fee: cc_accept_listing's stack branch, applied to the leg's
    -- charge. Player sellers only; NPC-seeded listings are exempt,
    -- as is the Silver Tongue uplift outside a fee branch.
    fee_credits := 0;
    proceeds_bonus := 0;
    fee_rate := 0.05;
    fee_reduction := 0;
    crafted_item := coalesce(listing.batch_origin, '') = 'crafted';
    if seller.id is not null and coalesce(listing.seller_type, 'player') <> 'npc' then
      fee_rate := least(1::numeric, greatest(0::numeric,
        public.cc_economy_config_number('marketFeeRate', 0.05)));
      select payload into mod_payload from public.item_instances
       where owner_user_id = seller.id and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((seller.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
      end if;
      house_pts := public.cc_skill_effective_points(
        seller.skill_spends, mod_payload, 'fix_major_3', 'Fixer', 1);
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when crafted_item then 0.15 * house_pts else 0 end
        + public.cc_research_bonus_number(seller.id, 'marketFeeReduction')));
      fee_credits := floor(leg.charge * fee_rate * (1 - fee_reduction))::bigint;
      proceeds_bonus := floor((leg.charge - fee_credits)
        * public.cc_cache_rank_bonus_fraction(seller.cache_rank_spends, 'marketProceeds'))::bigint;
    end if;

    update public.profiles
       set credits = credits + (leg.charge - fee_credits + proceeds_bonus)
     where id = listing.seller_user_id;

    if leg.take_qty >= listing.quantity then
      update public.market_listings set status = 'sold', sold_at = now() where id = listing.id;
    else
      update public.market_listings
         set quantity = listing.quantity - leg.take_qty,
             price_credits = listing.price_credits - leg.charge
       where id = listing.id;
    end if;

    -- Delivery, mirroring cc_accept_listing per kind.
    delivered_batch_id := null;
    if listing.listing_kind = 'consumable' then
      delivered_batch_id := public.cc_add_consumable_batch(
        actor,
        listing.consumable_type,
        leg.take_qty,
        listing.quality_percent,
        coalesce(listing.batch_origin, 'market'),
        listing.batch_creator_user_id,
        listing.batch_source_recipe_id,
        'market_buy',
        'Player market purchase',
        jsonb_build_object('listing_id', listing.id, 'seller_user_id', listing.seller_user_id)
      );
      update public.profiles
         set consumables = public.cc_jsonb_add_int(consumables, listing.consumable_type, leg.take_qty)
       where id = actor;
    elsif listing.listing_kind = 'material' then
      update public.profiles
         set materials = public.cc_jsonb_add_int(materials, listing.material_id, leg.take_qty)
       where id = actor;
    elsif listing.listing_kind = 'essence' then
      update public.profiles
         set essences = public.cc_jsonb_add_int(essences, listing.essence_id, leg.take_qty)
       where id = actor;
    elsif listing.listing_kind = 'fragment' then
      v_parts := v_parts + leg.take_qty;
      while v_parts >= 5 loop
        v_parts := v_parts - 5;
        v_tokens := v_tokens + 1;
      end loop;
      update public.profiles
         set cache_token_parts = v_parts, cache_tokens = v_tokens
       where id = actor;
    elsif listing.listing_kind = 'core' then
      update public.profiles
         set legendary_cores = legendary_cores + leg.take_qty
       where id = actor;
    end if;

    leg_rows := leg_rows || jsonb_build_object(
      'listing_id', listing.id,
      'take_qty', leg.take_qty,
      'charge', leg.charge,
      'fee_credits', fee_credits,
      'seller_proceeds', leg.charge - fee_credits + proceeds_bonus,
      'proceeds_bonus', proceeds_bonus,
      'fee_rate', fee_rate,
      'fee_reduction', fee_reduction,
      'crafted_item', crafted_item,
      'quality_percent', listing.quality_percent,
      'seller_kind', coalesce(listing.seller_type, 'player'),
      'batch_id', delivered_batch_id,
      'listing_snapshot', to_jsonb(listing)
    );
  end loop;

  -- Re-read the buyer so every payload carries the settled state.
  select * into p from public.profiles where id = actor;

  -- Per-leg accept rows (derived nonces): the folds and the
  -- mastery trigger read these exactly as manual accepts.
  for leg in select * from jsonb_to_recordset(leg_rows) as x(
    listing_id uuid, take_qty integer, charge bigint, fee_credits bigint,
    seller_proceeds bigint, proceeds_bonus bigint, fee_rate numeric,
    fee_reduction numeric, crafted_item boolean, quality_percent numeric,
    seller_kind text, batch_id uuid, listing_snapshot jsonb)
  loop
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_accept_listing', nonce || ':leg:' || leg.listing_id::text,
      jsonb_build_object(
        'action_type', 'cc_accept_listing',
        'profile', public.cc_profile_snapshot(p),
        'listing', leg.listing_snapshot || jsonb_build_object(
          'quantity', leg.take_qty,
          'price_credits', leg.charge,
          'status', 'sold',
          'sold_at', now()
        ),
        'item', null,
        'delivery', jsonb_build_object(
          'kind', p_good_kind,
          'quantity', leg.take_qty,
          'quality_percent', leg.quality_percent,
          'consumable_type', case when p_good_kind = 'consumable' then p_good_id else null end,
          'material_id', case when p_good_kind = 'material' then p_good_id else null end,
          'essence_id', case when p_good_kind = 'essence' then p_good_id else null end,
          'batch_id', leg.batch_id
        ),
        'market_fee', jsonb_build_object(
          'fee_credits', leg.fee_credits,
          'seller_proceeds', leg.seller_proceeds,
          'cache_rank_proceeds_bonus', leg.proceeds_bonus,
          'fee_rate', leg.fee_rate,
          'fee_reduction', leg.fee_reduction,
          'found_item', false,
          'crafted_item', leg.crafted_item
        )
      ));
  end loop;

  result := jsonb_build_object(
    'action_type', 'cc_quickbuy_fill',
    'status', 'filled',
    'source', 'market',
    'good', jsonb_build_object('kind', p_good_kind, 'id', p_good_id),
    'quantity', qty,
    'total_charged', plan_total,
    'fills', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'listing_id', (t.r ->> 'listing_id'),
               'take_qty', (t.r ->> 'take_qty')::integer,
               'charge', (t.r ->> 'charge')::bigint,
               'fee_credits', (t.r ->> 'fee_credits')::bigint,
               'seller_proceeds', (t.r ->> 'seller_proceeds')::bigint,
               'quality_percent', (t.r ->> 'quality_percent')::numeric,
               'seller_kind', (t.r ->> 'seller_kind')
             ) order by t.ord), '[]'::jsonb)
        from jsonb_array_elements(leg_rows) with ordinality as t(r, ord)
    ),
    'profile', public.cc_profile_snapshot(p)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_quickbuy_fill', nonce, result);
  return result;
end;
$function$;
