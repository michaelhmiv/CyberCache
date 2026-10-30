-- 0017_market_sale_fee.sql
--
-- Market fee slice (owner-approved, 2026-10-30): the player market
-- gains its first real credit sink. A completed sale charges a fee of
-- 5% of the listed price, DESTROYED (credited to nobody). The buyer
-- always pays the listed price; the seller receives price − fee.
--
-- The seller's Scavenger fee-reduction nodes — dead since launch
-- because no market fee existed — now apply, exactly as their defs
-- describe (src/constants/skillTrees.ts):
--   - Darknet Broker (scav_fee_1): +5% fee reduction per effective
--     point (marketFeeReduction 0.05, maxPoints 5 from spends).
--   - Market Manipulator (scav_major_3): an additional 15% fee
--     reduction (foundItemFeeReduction 0.15) for items the seller
--     PERSONALLY FOUND — the item payload carries a find drop source
--     (World Drop / Boss Drop / Cache-Forged / Event) and the seller
--     has no cc_accept_listing ledger record of acquiring this item
--     from another player (a bought-and-relisted item does not
--     qualify).
-- Reductions are relative (they shrink the fee) and stack additively,
-- mirroring computeSkillBonuses (src/lib/skills/skillBonuses.ts):
-- effective points = spends + class mod nodeBoosts, then the class
-- mod's Scavenger treeBonus adds +1 capped at each node's maxPoints.
-- The math is shared with the TS owner in src/lib/market/marketFee.ts
-- (MARKET_FEE_RATE); parity between this SQL and that helper is
-- pinned by tests. A later slice moves the rate into server config.
--
-- NPC-seeded listings (item supply_mode 'npc_market') are exempt: the
-- fee does not apply and the NPC payout is unchanged (full price).
--
-- cc_accept_listing keeps its 0004 signature and body apart from the
-- fee block: the seller's skill records are read from the database
-- inside the same transaction (never from the request), the seller
-- credit becomes price − fee, and the result gains a 'market_fee'
-- breakdown object. Everything else — validation order, ledger
-- replay, ownership transfer — is the 0004 definition verbatim.

CREATE OR REPLACE FUNCTION public.cc_accept_listing(p_player_id uuid, nonce text, listing_id uuid)
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
  fee_reduction numeric := 0;
  fee_credits bigint := 0;
  found_item boolean := false;
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

  -- Market fee (0017): derive the seller's fee reduction from the
  -- seller's OWN database records — skill_spends plus the equipped
  -- class mod payload — inside this transaction. NPC-seeded listings
  -- (supply_mode 'npc_market') are exempt: fee stays 0 and the NPC
  -- payout below is the full price, unchanged from 0004.
  select * into item from public.item_instances where id = listing.item_instance_id;
  select * into seller from public.profiles where id = listing.seller_user_id;
  if seller.id is not null and item.id is not null and coalesce(item.supply_mode, '') <> 'npc_market' then
    -- Class mod boosts, mirroring classModBoostsFromGear: the
    -- equipped gear whose payload carries treeBonus.
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
    fee_reduction := least(1::numeric, greatest(0::numeric,
      0.05 * darknet_pts + case when found_item then 0.15 * manip_pts else 0 end));
    fee_credits := floor(listing.price_credits * 0.05 * (1 - fee_reduction))::bigint;
  end if;

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + (listing.price_credits - fee_credits) where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;
  update public.item_instances set owner_user_id = actor, runtime_state = 'available', is_locked = false, equipped_slot = null where id = listing.item_instance_id returning * into item;

  result := jsonb_build_object('action_type', 'cc_accept_listing', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item), 'market_fee', jsonb_build_object('fee_credits', fee_credits, 'seller_proceeds', listing.price_credits - fee_credits, 'fee_rate', 0.05, 'fee_reduction', fee_reduction, 'found_item', found_item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_accept_listing', nonce, result);
  return result;
end;
$function$;
