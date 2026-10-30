-- 0019_market_depth.sql
--
-- Market depth & accessibility (owner directive, 2026-10-30: the
-- market "has to be extremely accessible"). Three changes:
--
--   1. LISTING TYPES GENERALIZE. market_listings gains a listing_kind
--      ('gear' | 'consumable' | 'material') plus the escrow snapshot
--      non-gear listings need. Gear listings keep working exactly as
--      before (item_instance_id stays the payload carrier); it
--      becomes nullable because consumable/material listings escrow
--      profile-side stock instead of an item row:
--        - consumable: the seller's consumable_batches row is
--          DECREMENTED at list time (escrow) and the listing records
--          batch id + type + quality + quantity (+ the batch's
--          origin/creator/recipe so delivery and cancellation can
--          restore the exact stack). profiles.consumables (the count
--          map the rest of the game reads) moves with the batch, the
--          same dual maintenance cc_vendor_buy performs.
--        - material: profiles.materials is decremented at list time;
--          the listing records material id + quantity.
--      Purchases of every kind flow through the SAME completion path
--      (cc_accept_listing): buyer pays list price, the 0017/0018 fee
--      applies to player sales of every kind (Darknet Broker
--      reduction included; Market Manipulator's found-item term is
--      gear-only — a consumable/material has no find provenance) and
--      NPC listings stay exempt. Cancellation returns escrow.
--
--   2. BROWSING DENORMALIZATION. Every listing carries the facts the
--      Buy tab filters/sorts on — category, weapon_type, element,
--      rarity, item_level, display_name, seller_type, and the
--      price-history identity_key — stamped at creation, so a browse
--      query never opens an item payload. Existing rows are
--      backfilled from their items below. The identity key scheme is
--      owned by src/lib/market/identityKey.ts; the SQL helpers here
--      are its twins and parity is pinned by tests:
--        gear weapon: gear:weapon:{weaponType}:{rarity}:b{band}
--        gear other:  gear:{category}:{rarity}:b{band}
--        consumable:  cons:{type}:{qualityBand}
--        material:    mat:{materialId}
--      (level band = 10 levels; quality bands sit around the shipped
--      craft ranges: q0 ≤79, q1 80–100, q2 101–120, q3 121–140,
--      q4 ≥141.)
--
--   3. cc_market_create is recreated to stamp the new columns for
--      gear; cc_accept_listing / cc_market_cancel are recreated with
--      per-kind delivery/escrow branches (gear paths verbatim).
--
-- Idempotent: add-if-missing columns, create-or-replace functions,
-- backfill only touches rows whose identity_key is still null.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.market_listings
  alter column item_instance_id drop not null;

alter table public.market_listings
  add column if not exists listing_kind text not null default 'gear',
  add column if not exists quantity integer not null default 1,
  add column if not exists quality_percent numeric,
  add column if not exists consumable_type text,
  add column if not exists consumable_batch_id uuid references public.consumable_batches(id) on delete set null,
  add column if not exists batch_origin text,
  add column if not exists batch_creator_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists batch_source_recipe_id text,
  add column if not exists material_id text,
  add column if not exists identity_key text,
  add column if not exists category text,
  add column if not exists display_name text,
  add column if not exists weapon_type text,
  add column if not exists element text,
  add column if not exists rarity text,
  add column if not exists item_level integer,
  add column if not exists seller_type text not null default 'player';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'market_listings_kind_check') then
    alter table public.market_listings
      add constraint market_listings_kind_check check (listing_kind in ('gear', 'consumable', 'material'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'market_listings_quantity_check') then
    alter table public.market_listings
      add constraint market_listings_quantity_check check (quantity >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'market_listings_seller_type_check') then
    alter table public.market_listings
      add constraint market_listings_seller_type_check check (seller_type in ('player', 'npc'));
  end if;
end $$;

create index if not exists market_listings_browse_idx
  on public.market_listings (status, category, listed_at desc);
create index if not exists market_listings_identity_idx
  on public.market_listings (status, identity_key, sold_at desc);
create index if not exists market_listings_seller_status_idx
  on public.market_listings (seller_user_id, status, listed_at desc);
create index if not exists market_listings_price_idx
  on public.market_listings (status, price_credits);

-- ---------------------------------------------------------------------------
-- Identity helpers — SQL twins of src/lib/market/identityKey.ts
-- ---------------------------------------------------------------------------

create or replace function public.cc_market_level_band(p_level integer)
 returns integer
 language sql
 immutable
 set search_path to 'public'
as $$
  select ((greatest(1, coalesce(p_level, 1)) - 1) / 10);
$$;

create or replace function public.cc_market_quality_band(p_quality numeric)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $$
  select case
    when coalesce(p_quality, 100) <= 79 then 'q0'
    when coalesce(p_quality, 100) <= 100 then 'q1'
    when coalesce(p_quality, 100) <= 120 then 'q2'
    when coalesce(p_quality, 100) <= 140 then 'q3'
    else 'q4'
  end;
$$;

-- The database's own item classification (migration 0007's insert
-- case), restated: weaponType → weapon, mitigation → shield,
-- treeBonus → classMod, damage → ordnance, affixes → relic; the row
-- kind ('weapon', 'gear:weapon', …) breaks remaining ties.
create or replace function public.cc_market_gear_category(p_payload jsonb, p_kind text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $$
  select case
    when p_payload ? 'weaponType' then 'weapon'
    when p_payload ? 'mitigation' or p_payload ? 'hp' then 'shield'
    when p_payload ? 'treeBonus' then 'classMod'
    when p_payload ? 'damage' then 'ordnance'
    when p_payload ? 'affixes' then 'relic'
    when replace(coalesce(p_kind, ''), 'gear:', '') in ('weapon', 'shield', 'classMod', 'ordnance', 'relic')
      then replace(coalesce(p_kind, ''), 'gear:', '')
    else 'relic'
  end;
$$;

create or replace function public.cc_market_gear_identity(p_payload jsonb, p_kind text, p_rarity text, p_level integer)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $$
  select case
    when public.cc_market_gear_category(p_payload, p_kind) = 'weapon' then
      'gear:weapon:' || coalesce(p_payload ->> 'weaponType', 'Unknown') || ':'
        || coalesce(p_rarity, p_payload ->> 'rarity', 'Common')
        || ':b' || public.cc_market_level_band(coalesce(p_level, (p_payload ->> 'level')::integer, 1))
    else
      'gear:' || public.cc_market_gear_category(p_payload, p_kind) || ':'
        || coalesce(p_rarity, p_payload ->> 'rarity', 'Common')
        || ':b' || public.cc_market_level_band(coalesce(p_level, (p_payload ->> 'level')::integer, 1))
  end;
$$;

create or replace function public.cc_market_consumable_identity(p_type text, p_quality numeric)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $$
  select 'cons:' || p_type || ':' || public.cc_market_quality_band(p_quality);
$$;

-- ---------------------------------------------------------------------------
-- Backfill: stamp every pre-0019 listing (all gear) from its item.
-- ---------------------------------------------------------------------------

update public.market_listings ml
   set listing_kind = 'gear',
       quantity = 1,
       category = public.cc_market_gear_category(ii.payload, ii.kind),
       weapon_type = ii.payload ->> 'weaponType',
       element = ii.payload ->> 'element',
       rarity = coalesce(ii.rarity, ii.payload ->> 'rarity'),
       item_level = coalesce(ii.item_level, (ii.payload ->> 'level')::integer, 1),
       display_name = ii.payload ->> 'name',
       identity_key = public.cc_market_gear_identity(
         ii.payload, ii.kind,
         coalesce(ii.rarity, ii.payload ->> 'rarity'),
         coalesce(ii.item_level, (ii.payload ->> 'level')::integer, 1)),
       seller_type = case when coalesce(ii.supply_mode, '') = 'npc_market' then 'npc' else 'player' end
  from public.item_instances ii
 where ii.id = ml.item_instance_id
   and ml.identity_key is null;

-- ---------------------------------------------------------------------------
-- cc_market_create (gear) — 0004 verbatim plus the browse stamps.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_market_create(p_player_id uuid, nonce text, item_id uuid, price_credits bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  listing public.market_listings%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if price_credits <= 0 then raise exception 'price_credits must be positive'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.account_bound or not item.tradeable or item.runtime_state in ('listed','equipped','salvaged','consumed') then raise exception 'Item not listable'; end if;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, identity_key, category, display_name,
    weapon_type, element, rarity, item_level, seller_type)
  values (
    actor, item.id, price_credits, 'active',
    'gear', 1,
    public.cc_market_gear_identity(item.payload, item.kind, item.rarity, item.item_level),
    public.cc_market_gear_category(item.payload, item.kind),
    item.payload ->> 'name',
    item.payload ->> 'weaponType',
    item.payload ->> 'element',
    coalesce(item.rarity, item.payload ->> 'rarity'),
    coalesce(item.item_level, (item.payload ->> 'level')::integer, 1),
    case when coalesce(item.supply_mode, '') = 'npc_market' then 'npc' else 'player' end)
  returning * into listing;

  update public.item_instances set runtime_state = 'listed' where id = item.id returning * into item;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- cc_market_create_consumable — escrow a slice of one owned batch.
--
-- The batch row is decremented immediately (escrow): the listed units
-- cannot be consumed, crafted with, or listed twice while the listing
-- lives. profiles.consumables moves with the batch (the dual
-- maintenance cc_vendor_buy / cc_claim_crafted_consumable keep).
-- The listing snapshots quality + origin/creator/recipe so a sale
-- delivers the exact stack and a cancel restores it exactly.
--
-- Player-market eligibility comes from the consumable defs
-- (src/constants/consumables.ts, market.playerMarketAllowed): every
-- shipped type is allowed EXCEPT the legacy ElementalCoating, which
-- is restated here as the single exclusion.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_market_create_consumable(p_player_id uuid, nonce text, batch_id uuid, quantity integer, price_credits bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  batch public.consumable_batches%rowtype;
  listing public.market_listings%rowtype;
  qty integer := coalesce(quantity, 0);
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if price_credits <= 0 then raise exception 'price_credits must be positive'; end if;
  if qty <= 0 then raise exception 'quantity must be positive'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into batch from public.consumable_batches where id = batch_id and owner_user_id = actor for update;
  if not found then raise exception 'Consumable batch not found'; end if;
  if batch.consumable_type = 'ElementalCoating' then raise exception 'Consumable not listable on the player market'; end if;
  if batch.quantity < qty then raise exception 'Insufficient consumable quantity'; end if;

  -- NB: `quantity` is also this function's parameter name, so the
  -- column side is table-qualified to stay unambiguous.
  update public.consumable_batches
     set quantity = consumable_batches.quantity - qty, updated_at = now()
   where id = batch.id
  returning * into batch;

  insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, reason, metadata)
  values (actor, batch.id, batch.consumable_type, -qty, batch.quality_percent, 'market_sell', 'Listed on the player market (escrow)', jsonb_build_object('price_credits', price_credits));

  update public.profiles
     set consumables = public.cc_jsonb_add_int(consumables, batch.consumable_type, -qty)
   where id = actor
  returning * into p;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, quality_percent, consumable_type,
    consumable_batch_id, batch_origin, batch_creator_user_id,
    batch_source_recipe_id, identity_key, category, display_name, seller_type)
  values (
    actor, null, price_credits, 'active',
    'consumable', qty, batch.quality_percent, batch.consumable_type,
    batch.id, batch.origin, batch.creator_user_id,
    batch.source_recipe_id,
    public.cc_market_consumable_identity(batch.consumable_type, batch.quality_percent),
    'consumable', batch.consumable_type, 'player')
  returning * into listing;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', null, 'delivery', jsonb_build_object('kind', 'consumable', 'consumable_type', batch.consumable_type, 'quantity', qty, 'quality_percent', batch.quality_percent, 'batch_id', batch.id));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- cc_market_create_material — escrow units of one profile material.
-- The listable set is the MaterialType enum (src/types/game.ts),
-- restated here: the five roaming materials in profiles.materials.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_market_create_material(p_player_id uuid, nonce text, material_id text, quantity integer, price_credits bigint)
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
  qty integer := coalesce(quantity, 0);
  owned integer := 0;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if price_credits <= 0 then raise exception 'price_credits must be positive'; end if;
  if qty <= 0 then raise exception 'quantity must be positive'; end if;
  if material_id not in ('ScrapAlloy','BallisticParts','ReactiveComponents','TechFragments','VoidDust') then
    raise exception 'Unknown material';
  end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  owned := public.cc_jsonb_int(coalesce(p.materials, '{}'::jsonb), material_id);
  if owned < qty then raise exception 'Insufficient material quantity'; end if;

  update public.profiles
     set materials = public.cc_jsonb_add_int(materials, material_id, -qty)
   where id = actor
  returning * into p;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, material_id, identity_key, category,
    display_name, seller_type)
  values (
    actor, null, price_credits, 'active',
    'material', qty, material_id, 'mat:' || material_id, 'material',
    material_id, 'player')
  returning * into listing;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', null, 'delivery', jsonb_build_object('kind', 'material', 'material_id', material_id, 'quantity', qty));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- cc_accept_listing — the 0018 definition with per-kind delivery.
-- Gear path verbatim (fee from the seller's DB records, NPC exempt,
-- rate from the economy_config lever). Consumable/material sales run
-- the same fee with the Darknet Broker reduction only (no find
-- provenance), then deliver the escrowed stack:
--   consumable → cc_add_consumable_batch with the batch's ORIGINAL
--                origin/creator/recipe (quality preserved exactly);
--                the buyer's profiles.consumables map moves with it.
--   material   → the buyer's profiles.materials gains the quantity.
-- The result gains a 'delivery' object; 'item' is null for non-gear.
-- ---------------------------------------------------------------------------

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
  fee_rate numeric := 0.05;
  found_item boolean := false;
  delivered_batch_id uuid;
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

  if listing.listing_kind = 'gear' then
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
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when found_item then 0.15 * manip_pts else 0 end));
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
      fee_reduction := least(1::numeric, greatest(0::numeric, 0.05 * darknet_pts));
      fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
    end if;
  end if;

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + (listing.price_credits - fee_credits) where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;

  if listing.listing_kind = 'gear' then
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
  end if;

  -- Re-read the buyer so the result snapshot carries the delivery.
  select * into p from public.profiles where id = actor;

  result := jsonb_build_object('action_type', 'cc_accept_listing', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item), 'delivery', jsonb_build_object('kind', listing.listing_kind, 'quantity', listing.quantity, 'quality_percent', listing.quality_percent, 'consumable_type', listing.consumable_type, 'material_id', listing.material_id, 'batch_id', delivered_batch_id), 'market_fee', jsonb_build_object('fee_credits', fee_credits, 'seller_proceeds', listing.price_credits - fee_credits, 'fee_rate', fee_rate, 'fee_reduction', fee_reduction, 'found_item', found_item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_accept_listing', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- cc_market_cancel — 0004 verbatim for gear; escrow return for the
-- new kinds (batch quantity restored + count map, or materials).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_market_cancel(p_player_id uuid, nonce text, listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  batch public.consumable_batches%rowtype;
  listing public.market_listings%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into listing from public.market_listings where id = listing_id for update;
  if not found or listing.seller_user_id <> actor then raise exception 'Listing not found'; end if;
  if listing.status <> 'active' then raise exception 'Listing not active'; end if;

  update public.market_listings set status = 'cancelled' where id = listing.id returning * into listing;

  if listing.listing_kind = 'gear' then
    update public.item_instances set runtime_state = case when is_locked then 'locked' else 'available' end where id = listing.item_instance_id returning * into item;
  elsif listing.listing_kind = 'consumable' then
    update public.consumable_batches
       set quantity = consumable_batches.quantity + listing.quantity, updated_at = now()
     where id = listing.consumable_batch_id
    returning * into batch;
    if batch.id is null then
      -- The escrowed batch row is gone (e.g. progress reset): rebuild
      -- the stack from the listing's snapshot instead of losing it.
      perform public.cc_add_consumable_batch(
        actor, listing.consumable_type, listing.quantity, listing.quality_percent,
        coalesce(listing.batch_origin, 'market'), listing.batch_creator_user_id,
        listing.batch_source_recipe_id, 'market_sell',
        'Listing cancelled — escrow returned', jsonb_build_object('listing_id', listing.id));
    else
      insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, reason, metadata)
      values (actor, batch.id, listing.consumable_type, listing.quantity, listing.quality_percent, 'market_sell', 'Listing cancelled — escrow returned', jsonb_build_object('listing_id', listing.id));
    end if;
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, listing.consumable_type, listing.quantity)
     where id = actor
    returning * into p;
  elsif listing.listing_kind = 'material' then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, listing.material_id, listing.quantity)
     where id = actor
    returning * into p;
  end if;

  result := jsonb_build_object('action_type', 'cc_market_cancel', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_cancel', nonce, result);
  return result;
end;
$function$;
