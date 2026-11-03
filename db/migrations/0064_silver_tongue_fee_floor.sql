-- 0064 — Silver Tongue fee floor (economy redesign brief §5, ruling 2).
--
-- THE DEFECT: the market fee is burned in full, but the Cache Rank
-- Silver Tongue uplift then MINTED up to +5% of post-fee proceeds on
-- top. Stacked with fee reductions (best effective fee 2.75%), a
-- maxed seller's 10,000-cr sale burned 275 and minted 486 — the
-- transfer layer created credits.
--
-- THE FIX — one clamp at the computation: the uplift may offset the
-- fee, never exceed it.
--   proceeds_bonus := least(fee_credits, floor((price − fee) × bonus))
-- Silver Tongue is now, in effect, a fee rebate: seller proceeds can
-- reach the full price (fee fully rebated) but never exceed what the
-- buyer paid. Per sale, credits_destroyed(market fees) −
-- credits_minted(Silver Tongue) ≥ 0 by construction.
--
-- This migration restates BOTH settlement paths that compute the
-- uplift, verbatim from their current definitions except the clamped
-- bonus line (and its comment):
--   * public.cc_accept_listing  — verbatim from 0053 (lines 3171-3358)
--   * public.cc_quickbuy_fill   — verbatim from 0060 (lines 225-561);
--     the fill's per-leg fee block is a copy of cc_accept_listing's
--     stack branch and carried the same unclamped uplift.
-- The TypeScript owner (src/lib/market/marketFee.ts) and the
-- InMemory twin (which routes through it) carry the identical clamp.
-- NPC-seeded listings remain exempt from fee and uplift, untouched.

create or replace function public.cc_accept_listing(p_player_id uuid, nonce text, listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  listing public.market_listings%rowtype;
  item public.item_instances%rowtype;
  seller public.profiles%rowtype;
  mod_payload jsonb;
  darknet_pts numeric := 0;
  manip_pts numeric := 0;
  house_pts numeric := 0;
  crafted_item boolean := false;
  fee_reduction numeric := 0;
  fee_credits bigint := 0;
  proceeds_bonus bigint := 0;
  fee_rate numeric := 0.05;
  found_item boolean := false;
  delivered_batch_id uuid;
  buyer_parts integer := 0;
  buyer_tokens integer := 0;
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

  select * into seller from public.profiles where id = listing.seller_user_id;

  if listing.listing_kind in ('gear', 'vehicle', 'cosmetic') then
    -- Market fee (0017; rate levered in 0018): derived from the
    -- seller's OWN database records inside this transaction. NPC
    -- listings (supply_mode 'npc_market') are exempt.
    select * into item from public.item_instances where id = listing.item_instance_id;
    if seller.id is not null and item.id is not null and coalesce(item.supply_mode, '') <> 'npc_market' then
      fee_rate := least(1::numeric, greatest(0::numeric,
        public.cc_economy_config_number('marketFeeRate', 0.05)));
      select payload into mod_payload from public.item_instances
       where owner_user_id = seller.id and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((seller.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      manip_pts := coalesce((seller.skill_spends ->> 'scav_major_3')::numeric, 0)
                 + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_major_3')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
        manip_pts := least(1::numeric, manip_pts + 1);
      end if;
      found_item := coalesce(item.payload ->> 'sourceTag', '') in ('World Drop', 'Boss Drop', 'Cache-Forged', 'Event')
        and not exists (
          select 1 from public.verified_action_ledger l
           where l.user_id = seller.id
             and l.action_type = 'cc_accept_listing'
             and l.result_payload -> 'item' ->> 'id' = item.id::text
        );
      -- House Brand (fix_major_3, 0029): the crafted gate is the
      -- economy metrics' crafted-sale rule — payload origin 'crafted'.
      -- Found and crafted are disjoint by the drop-source taxonomy,
      -- so this term never stacks with the Manipulator term.
      house_pts := public.cc_skill_effective_points(
        seller.skill_spends, mod_payload, 'fix_major_3', 'Fixer', 1);
      crafted_item := coalesce(item.payload ->> 'origin', '') = 'crafted';
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when found_item then 0.15 * manip_pts else 0 end
        + case when crafted_item then 0.15 * house_pts else 0 end
        + public.cc_research_bonus_number(seller.id, 'marketFeeReduction')));
      fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
    end if;
  else
    -- Consumable / material sale: same fee, Darknet Broker reduction
    -- only — stacks carry no find provenance, so the Market
    -- Manipulator term never applies. Player listings only (these
    -- kinds have no NPC source; seller_type pins it regardless).
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
      -- House Brand (fix_major_3, 0029) applies to crafted consumable
      -- batches: batch_origin 'crafted' is the metrics crafted-sale
      -- rule. Materials carry no origin and are never crafted.
      house_pts := public.cc_skill_effective_points(
        seller.skill_spends, mod_payload, 'fix_major_3', 'Fixer', 1);
      crafted_item := coalesce(listing.batch_origin, '') = 'crafted';
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when crafted_item then 0.15 * house_pts else 0 end
        + public.cc_research_bonus_number(seller.id, 'marketFeeReduction')));
      fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
    end if;
  end if;

  -- Cache Rank Silver Tongue (0031; fee floor 0064): the proceeds
  -- uplift applies AFTER the fee, on the post-fee proceeds, and only
  -- where a fee branch ran (real player seller; NPC listings
  -- exempt). The uplift is CLAMPED to the fee it offsets
  -- (least(fee_credits, …)): it is a rebate of the burned fee, never
  -- a mint — seller proceeds can reach the price but never exceed
  -- it. The clamped figure is still reported as
  -- market_fee.cache_rank_proceeds_bonus and folds into
  -- credits_minted_other in cc_compute_economy_metrics, so the
  -- meter's per-sale mint never exceeds its market-fee burn.
  -- Composition order: fee rate (lever) x (1 - Darknet/Manipulator/
  -- House Brand reductions) first, then the clamped uplift.
  if (listing.listing_kind in ('gear', 'vehicle', 'cosmetic') and seller.id is not null
        and item.id is not null and coalesce(item.supply_mode, '') <> 'npc_market')
     or (listing.listing_kind not in ('gear', 'vehicle') and seller.id is not null
        and coalesce(listing.seller_type, 'player') <> 'npc') then
    proceeds_bonus := least(fee_credits, floor((listing.price_credits - fee_credits)
      * public.cc_cache_rank_bonus_fraction(seller.cache_rank_spends, 'marketProceeds'))::bigint);
  end if;

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + (listing.price_credits - fee_credits + proceeds_bonus) where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;

  if listing.listing_kind in ('gear', 'vehicle', 'cosmetic') then
    update public.item_instances set owner_user_id = actor, runtime_state = 'available', is_locked = false, equipped_slot = null where id = listing.item_instance_id returning * into item;
  elsif listing.listing_kind = 'consumable' then
    delivered_batch_id := public.cc_add_consumable_batch(
      actor,
      listing.consumable_type,
      listing.quantity,
      listing.quality_percent,
      coalesce(listing.batch_origin, 'market'),
      listing.batch_creator_user_id,
      listing.batch_source_recipe_id,
      'market_buy',
      'Player market purchase',
      jsonb_build_object('listing_id', listing.id, 'seller_user_id', listing.seller_user_id)
    );
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, listing.consumable_type, listing.quantity)
     where id = actor;
  elsif listing.listing_kind = 'material' then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, listing.material_id, listing.quantity)
     where id = actor;
  elsif listing.listing_kind = 'fragment' then
    -- Fragment delivery settles like a reward application (0050):
    -- the shards join the buyer's unescrowed cache_token_parts and
    -- the 5-to-1 auto-conversion runs immediately, so parts never
    -- sit above 4 after a purchase. (Cancels, by contrast, restore
    -- raw -- see cc_market_cancel.)
    buyer_parts := coalesce(p.cache_token_parts, 0) + listing.quantity;
    buyer_tokens := coalesce(p.cache_tokens, 0);
    while buyer_parts >= 5 loop
      buyer_parts := buyer_parts - 5;
      buyer_tokens := buyer_tokens + 1;
    end loop;
    update public.profiles
       set cache_token_parts = buyer_parts,
           cache_tokens = buyer_tokens
     where id = actor;
  elsif listing.listing_kind = 'core' then
    update public.profiles
       set legendary_cores = legendary_cores + listing.quantity
     where id = actor;
  elsif listing.listing_kind = 'essence' then
    update public.profiles
       set essences = public.cc_jsonb_add_int(essences, listing.essence_id, listing.quantity)
     where id = actor;
  end if;

  -- Re-read the buyer so the result snapshot carries the delivery.
  select * into p from public.profiles where id = actor;

  result := jsonb_build_object('action_type', 'cc_accept_listing', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item), 'delivery', jsonb_build_object('kind', listing.listing_kind, 'quantity', listing.quantity, 'quality_percent', listing.quality_percent, 'consumable_type', listing.consumable_type, 'material_id', listing.material_id, 'essence_id', listing.essence_id, 'batch_id', delivered_batch_id), 'market_fee', jsonb_build_object('fee_credits', fee_credits, 'seller_proceeds', listing.price_credits - fee_credits + proceeds_bonus, 'cache_rank_proceeds_bonus', proceeds_bonus, 'fee_rate', fee_rate, 'fee_reduction', fee_reduction, 'found_item', found_item, 'crafted_item', crafted_item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_accept_listing', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- cc_quickbuy_fill restated with the same fee floor (see header).
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
      -- Fee floor (0064): the Silver Tongue uplift is clamped to
      -- the leg's fee — a rebate, never a mint (see cc_accept_listing).
      proceeds_bonus := least(fee_credits, floor((leg.charge - fee_credits)
        * public.cc_cache_rank_bonus_fraction(seller.cache_rank_spends, 'marketProceeds'))::bigint);
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
