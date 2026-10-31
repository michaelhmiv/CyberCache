-- 0020_vendor_rotation_buyback.sql
--
-- Vendor 2a (owner-approved design, 2026-10-30): the NPC vendor gains
-- a date-seeded rotation, an Item of the Day, and buyback — all
-- priced from ONE catalog.
--
-- THE CATALOG. The vendor's price list used to exist as three
-- hardcoded copies: the CASE inside cc_vendor_price (0004), the
-- VENDOR_CATALOG record in src/server/writes/store.ts, and the
-- market() configs in src/constants/consumables.ts. The single
-- source of truth is now src/lib/vendor/catalog.ts (consumables
-- derive from the defs; materials/essences are defined there). This
-- migration carries the SQL twin — cc_vendor_catalog(), one VALUES
-- list — in the same way migration 0019 carries SQL twins of the
-- market identity keys. Parity between the TS catalog and these
-- functions is pinned by tests and the real-Postgres harness.
--
-- ROTATION. Three rotating slots per UTC day (2 consumables + 1
-- material/essence), computed on read from the date — never
-- cron-dependent. Picks are ordered by cc_hash_string with the seed
-- strings 'vendor-rotation:<date>:<key>' / 'vendor-iotd:<date>:<key>',
-- exactly as the TS catalog orders by hashString, so server and
-- client show identical stock for a date. Stock is INFINITE (daily
-- variety, no stock counts — the shipped vendor model has none).
--
-- ITEM OF THE DAY. One consumable per UTC day drawn from that day's
-- sellable consumables (staples + rotating), 25% off, applied per
-- unit and floored: floor(base * 3/4). Prices stay integer credits,
-- so no fractional credits arise on the vendor path and the
-- 0009/0010 remainder columns are untouched (the market fee's floor
-- convention, 0017).
--
-- BUYBACK (cc_vendor_sell). The vendor buys back gear instances
-- (at the row's stored estimated_value), consumable batches (value
-- scales with the batch's quality %), and material/essence stacks
-- (at catalog unit value), paying floor(total value * rate) where
-- rate is the economy_config lever 'vendorBuybackRate' (default
-- 0.4, clamped [0, 0.9]) read inside the transaction through
-- cc_economy_config_number (0018). Equipped and locked gear cannot
-- be sold. Payouts are ledger-recorded as cc_vendor_sell with
-- total_payout, and cc_compute_economy_metrics is restated to count
-- them as a mint source (credits_minted_vendor_buyback) so the
-- daily net stays exact.

-- ---------------------------------------------------------------------------
-- cc_vendor_catalog: the SQL twin of src/lib/vendor/catalog.ts.
-- pool: 'staple' (always stocked) | 'rotation' (consumable pool) |
--       'material' | 'essence' (rotation pool + buyback values).
-- ---------------------------------------------------------------------------
create or replace function public.cc_vendor_catalog()
returns table(item_key text, base_price integer, pool text)
language sql
immutable
set search_path = public
as $$
  values
    -- Staples (consumable defs with market.vendorStocked)
    ('MedKit', 250, 'staple'),
    ('ShieldCell', 300, 'staple'),
    ('AmmoPack', 150, 'staple'),
    ('Grenade', 400, 'staple'),
    ('BossScanner', 600, 'staple'),
    ('InsuranceToken', 800, 'staple'),
    ('LuckBooster', 350, 'staple'),
    -- Rotation consumables (priced, player-marketable, not staples)
    ('MedKitRefined', 600, 'rotation'),
    ('NanoSwarm', 800, 'rotation'),
    ('AdrenalineShot', 1200, 'rotation'),
    ('HighCapacityAmmoPack', 375, 'rotation'),
    ('ArmorPiercingAmmo', 400, 'rotation'),
    ('IncendiaryAmmo', 450, 'rotation'),
    ('ShockAmmo', 450, 'rotation'),
    ('CorrosiveAmmo', 450, 'rotation'),
    ('CryoAmmo', 450, 'rotation'),
    ('VoidAmmo', 700, 'rotation'),
    ('OrdnanceCharge', 400, 'rotation'),
    ('EMPCharge', 650, 'rotation'),
    ('CorrosiveCharge', 650, 'rotation'),
    ('PhaseShiftGrenade', 1000, 'rotation'),
    ('MagnetizedPayload', 650, 'rotation'),
    ('OverchargeStim', 800, 'rotation'),
    ('TargetPainter', 600, 'rotation'),
    ('Jammer', 750, 'rotation'),
    ('SignalScrambler', 500, 'rotation'),
    ('LootBeacon', 900, 'rotation'),
    ('DataSkimmer', 900, 'rotation'),
    ('SalvageContract', 700, 'rotation'),
    ('WorkshopRushTicket', 1000, 'rotation'),
    -- Materials (profile counters; rotation pool + buyback values)
    ('ScrapAlloy', 10, 'material'),
    ('BallisticParts', 15, 'material'),
    ('ReactiveComponents', 20, 'material'),
    ('TechFragments', 35, 'material'),
    ('VoidDust', 75, 'material'),
    -- Essences (profile counters; rotation pool + buyback values)
    ('IgnitionFluid', 30, 'essence'),
    ('ConduitWire', 30, 'essence'),
    ('AcidCompound', 30, 'essence'),
    ('CryoGel', 30, 'essence'),
    ('VoidEssence', 90, 'essence')
$$;

-- ---------------------------------------------------------------------------
-- Rotation + Item of the Day, computed from a UTC date.
-- ---------------------------------------------------------------------------
create or replace function public.cc_vendor_rotation(_day date)
returns table(item_key text, pool text)
language sql
stable
set search_path = public
as $$
  (select c.item_key, c.pool
     from public.cc_vendor_catalog() c
    where c.pool = 'rotation'
    order by public.cc_hash_string('vendor-rotation:' || _day::text || ':' || c.item_key), c.item_key
    limit 2)
  union all
  (select c.item_key, c.pool
     from public.cc_vendor_catalog() c
    where c.pool in ('material', 'essence')
    order by public.cc_hash_string('vendor-rotation:' || _day::text || ':' || c.item_key), c.item_key
    limit 1)
$$;

create or replace function public.cc_vendor_item_of_the_day(_day date)
returns text
language sql
stable
set search_path = public
as $$
  select c.item_key
    from public.cc_vendor_catalog() c
   where c.pool = 'staple'
      or c.item_key in (select r.item_key from public.cc_vendor_rotation(_day) r where r.pool = 'rotation')
   order by public.cc_hash_string('vendor-iotd:' || _day::text || ':' || c.item_key), c.item_key
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- Prices.
-- ---------------------------------------------------------------------------
create or replace function public.cc_vendor_base_price(_item_key text)
returns integer
language sql
stable
set search_path = public
as $$
  select c.base_price from public.cc_vendor_catalog() c where c.item_key = _item_key
$$;

-- The 0004 one-argument staple-only function is replaced by the
-- catalog price for a date (default: today, UTC).
drop function if exists public.cc_vendor_price(text);

create or replace function public.cc_vendor_price(
  _item_key text,
  _day date default ((now() at time zone 'utc')::date)
)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_base integer;
  v_pool text;
begin
  select c.base_price, c.pool into v_base, v_pool
    from public.cc_vendor_catalog() c
   where c.item_key = _item_key;
  if v_base is null then
    return null;
  end if;
  if v_pool <> 'staple'
     and _item_key not in (select r.item_key from public.cc_vendor_rotation(_day) r) then
    return null; -- rotation item on a day it does not rotate in
  end if;
  if _item_key = public.cc_vendor_item_of_the_day(_day) then
    return (v_base * 3) / 4; -- 25% off, per unit, floored
  end if;
  return v_base;
end;
$$;

-- ---------------------------------------------------------------------------
-- cc_vendor_buy: 0004 body, with the price (and the material/essence
-- grant branch) driven by the catalog. Consumable purchases keep the
-- exact 0004 behavior: flat 100% quality 'vendor' batch.
-- ---------------------------------------------------------------------------
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

  unit_price := public.cc_vendor_price(item_key, v_day);
  if unit_price is null then raise exception 'Unknown vendor item'; end if;
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

-- ---------------------------------------------------------------------------
-- cc_vendor_sell: buyback. One sale target per call:
--   kind 'gear'       -> p_item_id (stored estimated_value)
--   kind 'consumable' -> p_batch_id + p_quantity (quality-scaled)
--   kind 'material'   -> p_material_id + p_quantity (catalog value;
--                        materials and essences share this kind)
-- Payout = floor(total vendor value * buyback rate lever).
-- ---------------------------------------------------------------------------
create or replace function public.cc_vendor_sell(
  p_player_id uuid,
  nonce text,
  p_kind text,
  p_item_id uuid default null,
  p_batch_id uuid default null,
  p_material_id text default null,
  p_quantity integer default 1
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
  result jsonb;
  rate numeric := least(0.9::numeric, greatest(0::numeric,
    public.cc_economy_config_number('vendorBuybackRate', 0.4)));
  qty integer := greatest(1, coalesce(p_quantity, 1));
  item public.item_instances%rowtype;
  batch public.consumable_batches%rowtype;
  v_pool text;
  base_price integer;
  vendor_value numeric := 0;
  payout bigint := 0;
  current_count integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  if p_kind = 'gear' then
    select * into item from public.item_instances where id = p_item_id and owner_user_id = actor for update;
    if not found then raise exception 'Item not found'; end if;
    if item.is_locked then raise exception 'Locked item'; end if;
    if item.runtime_state <> 'available' then raise exception 'Item state invalid'; end if;

    vendor_value := greatest(0, coalesce(item.estimated_value, 0));
    payout := floor(vendor_value * rate)::bigint;

    update public.item_instances
    set runtime_state = 'consumed', tradeable = false, equipped_slot = null
    where id = item.id
    returning * into item;

    update public.profiles set credits = credits + payout where id = actor returning * into p;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'gear',
      'item', to_jsonb(item),
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', 1,
      'total_payout', payout,
      'loadout', public.cc_loadout_snapshot(actor)
    );
  elsif p_kind = 'consumable' then
    select * into batch from public.consumable_batches where id = p_batch_id and owner_user_id = actor for update;
    if not found then raise exception 'Batch not found'; end if;
    if batch.quantity < qty then raise exception 'Insufficient quantity'; end if;

    base_price := public.cc_vendor_base_price(batch.consumable_type);
    if base_price is null then raise exception 'Item has no vendor value'; end if;

    vendor_value := base_price * batch.quality_percent / 100 * qty;
    payout := floor(vendor_value * rate)::bigint;

    update public.consumable_batches
    set quantity = quantity - qty, updated_at = now()
    where id = batch.id;

    current_count := coalesce((coalesce(p.consumables, '{}'::jsonb) ->> batch.consumable_type)::integer, 0);
    update public.profiles
    set credits = credits + payout,
        consumables = jsonb_set(coalesce(consumables, '{}'::jsonb), array[batch.consumable_type],
          to_jsonb(greatest(current_count - qty, 0)), true)
    where id = actor
    returning * into p;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'consumable',
      'item_key', batch.consumable_type,
      'batch_id', batch.id,
      'quality_percent', batch.quality_percent,
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', qty,
      'total_payout', payout
    );
  elsif p_kind = 'material' then
    select c.pool, c.base_price into v_pool, base_price
      from public.cc_vendor_catalog() c where c.item_key = p_material_id;
    if v_pool is null or v_pool not in ('material', 'essence') then
      raise exception 'Unknown material';
    end if;

    if v_pool = 'material' then
      current_count := coalesce((coalesce(p.materials, '{}'::jsonb) ->> p_material_id)::integer, 0);
    else
      current_count := coalesce((coalesce(p.essences, '{}'::jsonb) ->> p_material_id)::integer, 0);
    end if;
    if current_count < qty then raise exception 'Insufficient material %', p_material_id; end if;

    vendor_value := base_price * qty;
    payout := floor(vendor_value * rate)::bigint;

    update public.profiles
    set credits = credits + payout,
        materials = case when v_pool = 'material'
          then public.cc_jsonb_add_int(materials, p_material_id, -qty) else materials end,
        essences = case when v_pool = 'essence'
          then public.cc_jsonb_add_int(essences, p_material_id, -qty) else essences end
    where id = actor
    returning * into p;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'material',
      'item_key', p_material_id,
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', qty,
      'total_payout', payout
    );
  else
    raise exception 'Unknown vendor sell kind';
  end if;

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_vendor_sell', nonce, result);

  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Economy metrics: vendor buyback payouts are a credit mint (the
-- vendor counter creates them), counted in their own column so the
-- daily minted total — and therefore net_credit_change — stays
-- exact. cc_compute_economy_metrics restated from 0018 with the one
-- added source.
-- ---------------------------------------------------------------------------
alter table public.economy_metrics
  add column if not exists credits_minted_vendor_buyback bigint not null default 0;

create or replace function public.cc_compute_economy_metrics(_day date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := (_day::timestamp) at time zone 'UTC';
  v_end timestamptz := ((_day + 1)::timestamp) at time zone 'UTC';
  m record;
  v_minted_total bigint;
  v_destroyed_total bigint;
begin
  select
    -- Mints -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_apply_chef_rewards'), 0) as minted_roaming,
    coalesce(sum(
      case when coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)
        then coalesce((result_payload -> 'attempt' ->> 'creditsGained')::bigint, 0)
           + coalesce((result_payload ->> 'entry_fee')::bigint, 0)
        else 0 end)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as minted_boss,
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_settle_offline_roaming'), 0) as minted_offline,
    (coalesce(sum((result_payload -> 'rewards' ->> 'credits')::bigint)
        filter (where action_type = 'cc_idle_claim'), 0)
     + coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
        filter (where action_type = 'cc_claim_roaming_rewards'), 0)
     + 5000 * count(*) filter (where action_type = 'cc_initial_bundle')
    ) as minted_other,
    coalesce(sum((result_payload ->> 'total_payout')::bigint)
      filter (where action_type = 'cc_vendor_sell'), 0) as minted_vendor_buyback,
    -- Sinks -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'market_fee' ->> 'fee_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as destroyed_market_fees,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_vendor_buy'), 0) as destroyed_vendor,
    coalesce(sum((result_payload ->> 'creditsCharged')::bigint)
      filter (where action_type = 'cc_resurrect'), 0) as destroyed_resurrection,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_retrain'), 0) as destroyed_respec,
    coalesce(sum((result_payload ->> 'entry_fee')::bigint)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as destroyed_boss_entry_fees,
    coalesce(sum(greatest(0,
        coalesce((result_payload -> 'attempt' ->> 'creditsLost')::bigint, 0)
        - coalesce((result_payload ->> 'entry_fee')::bigint, 0)))
      filter (where action_type = 'cc_apply_boss_attempt'
        and not coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)),
      0) as destroyed_boss_death_fees,
    -- Market ----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_market_create') as market_listings_created,
    count(*) filter (where action_type = 'cc_accept_listing') as market_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as market_volume,
    -- Cache -----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_claim_rewarded_cache_key') as cache_keys_from_ads,
    count(*) filter (where action_type in ('cc_make_item', 'cc_draw_item')) as cache_opens,
    coalesce(sum((result_payload -> 'rewards' ->> 'cache_fragments_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_fragments_awarded
  into m
  from public.verified_action_ledger
  where created_at >= v_start and created_at < v_end;

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other
    + m.minted_vendor_buyback;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees;

  insert into public.economy_metrics (
    day,
    credits_minted_roaming, credits_minted_boss, credits_minted_offline,
    credits_minted_other, credits_minted_vendor_buyback, credits_minted_total,
    credits_destroyed_market_fees, credits_destroyed_vendor,
    credits_destroyed_resurrection, credits_destroyed_respec,
    credits_destroyed_boss_entry_fees, credits_destroyed_boss_death_fees,
    credits_destroyed_total, net_credit_change,
    legendaries_roaming, legendaries_boss, legendaries_cache, legendaries_total,
    market_listings_created, market_sales, market_volume,
    market_median_price, market_median_by_rarity,
    cache_keys_from_ads, cache_opens, cache_fragments_awarded,
    computed_at
  )
  select
    _day,
    m.minted_roaming, m.minted_boss, m.minted_offline, m.minted_other,
    m.minted_vendor_buyback,
    v_minted_total,
    m.destroyed_market_fees, m.destroyed_vendor, m.destroyed_resurrection,
    m.destroyed_respec, m.destroyed_boss_entry_fees, m.destroyed_boss_death_fees,
    v_destroyed_total, v_minted_total - v_destroyed_total,
    leg.roaming, leg.boss, leg.cache, leg.roaming + leg.boss + leg.cache,
    m.market_listings_created, m.market_sales, m.market_volume,
    (select percentile_cont(0.5) within group (
        order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric)
       from public.verified_action_ledger l
      where l.action_type = 'cc_accept_listing'
        and l.created_at >= v_start and l.created_at < v_end),
    (select coalesce(jsonb_object_agg(g.rarity, g.median), '{}'::jsonb)
       from (
         select l.result_payload -> 'item' ->> 'rarity' as rarity,
                percentile_cont(0.5) within group (
                  order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric) as median
           from public.verified_action_ledger l
          where l.action_type = 'cc_accept_listing'
            and l.created_at >= v_start and l.created_at < v_end
            and l.result_payload -> 'item' ->> 'rarity' is not null
          group by 1
       ) g),
    m.cache_keys_from_ads, m.cache_opens, m.cache_fragments_awarded,
    now()
  from (
    select
      count(*) filter (where payload ->> 'sourceTag' = 'World Drop') as roaming,
      count(*) filter (where payload ->> 'sourceTag' = 'Boss Drop') as boss,
      count(*) filter (where payload ->> 'sourceTag' = 'Cache-Forged') as cache
    from public.item_instances
    where rarity = 'Legendary' and created_at >= v_start and created_at < v_end
  ) leg
  on conflict (day) do update set
    credits_minted_roaming = excluded.credits_minted_roaming,
    credits_minted_boss = excluded.credits_minted_boss,
    credits_minted_offline = excluded.credits_minted_offline,
    credits_minted_other = excluded.credits_minted_other,
    credits_minted_vendor_buyback = excluded.credits_minted_vendor_buyback,
    credits_minted_total = excluded.credits_minted_total,
    credits_destroyed_market_fees = excluded.credits_destroyed_market_fees,
    credits_destroyed_vendor = excluded.credits_destroyed_vendor,
    credits_destroyed_resurrection = excluded.credits_destroyed_resurrection,
    credits_destroyed_respec = excluded.credits_destroyed_respec,
    credits_destroyed_boss_entry_fees = excluded.credits_destroyed_boss_entry_fees,
    credits_destroyed_boss_death_fees = excluded.credits_destroyed_boss_death_fees,
    credits_destroyed_total = excluded.credits_destroyed_total,
    net_credit_change = excluded.net_credit_change,
    legendaries_roaming = excluded.legendaries_roaming,
    legendaries_boss = excluded.legendaries_boss,
    legendaries_cache = excluded.legendaries_cache,
    legendaries_total = excluded.legendaries_total,
    market_listings_created = excluded.market_listings_created,
    market_sales = excluded.market_sales,
    market_volume = excluded.market_volume,
    market_median_price = excluded.market_median_price,
    market_median_by_rarity = excluded.market_median_by_rarity,
    cache_keys_from_ads = excluded.cache_keys_from_ads,
    cache_opens = excluded.cache_opens,
    cache_fragments_awarded = excluded.cache_fragments_awarded,
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;
$$;
