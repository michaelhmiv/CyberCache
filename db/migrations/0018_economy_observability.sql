-- 0018_economy_observability.sql
--
-- Economy observability + live tuning levers (owner directive,
-- 2026-10-30: "make sure we have the tools to monitor all economy
-- activity and make tweaks if things are way too out of line").
--
-- Three additions:
--
--   1. economy_config + economy_config_history — the live lever store.
--      key/value (jsonb) rows an operator can change without a
--      redeploy; every accepted change appends to the history log.
--      The Chef reads values through src/server/economy/config.ts
--      (code defaults = the shipped constants, short cache), and
--      cc_accept_listing reads the fee rate from the table through
--      cc_economy_config_number (fallback to the shipped default when
--      the row is missing or malformed — a bad row can never break a
--      purchase).
--
--   2. economy_metrics + cc_compute_economy_metrics(day) — daily
--      economy meters computed from the verified action ledger (the
--      economy's truth) and item_instances. The daily-heartbeat job
--      route recomputes yesterday UTC plus a short backfill; the
--      function is a full recompute upserted on the day, so re-running
--      a day replaces its row and never double-counts.
--
--   3. cc_accept_listing — the 0017 definition verbatim except the
--      fee rate: the hardcoded 0.05 literals in the fee charge and the
--      result's fee_rate now come from economy_config 'marketFeeRate'
--      (default 0.05). The 0.05 inside fee_reduction is the Darknet
--      Broker skill effect (5% per point), NOT the fee rate — it is
--      deliberately untouched.
--
-- Idempotent migration: create-if-missing tables, create-or-replace
-- functions; safe to apply twice.

-- ---------------------------------------------------------------------------
-- Live lever store
-- ---------------------------------------------------------------------------

create table if not exists public.economy_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.economy_config_history (
  id bigint generated always as identity primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb not null,
  updated_by text,
  created_at timestamptz not null default now()
);

create index if not exists economy_config_history_key_idx
  on public.economy_config_history (key, created_at desc);

-- Set one lever and log the change atomically. Validation of keys and
-- ranges lives in the admin route (src/server/economy/config.ts); this
-- function is the single write path so history can never be skipped.
create or replace function public.cc_set_economy_config(
  _key text,
  _value jsonb,
  _updated_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
begin
  select value into v_old from public.economy_config where key = _key for update;

  insert into public.economy_config (key, value, updated_at, updated_by)
  values (_key, _value, now(), _updated_by)
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  insert into public.economy_config_history (key, old_value, new_value, updated_by)
  values (_key, v_old, _value, _updated_by);

  return jsonb_build_object('key', _key, 'old_value', v_old, 'new_value', _value);
end;
$$;

-- Numeric lever read for SQL consumers. Returns _default when the row
-- is missing, is not a JSON number, or cannot be cast — config must
-- never be able to break the purchase path.
create or replace function public.cc_economy_config_number(
  _key text,
  _default numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value jsonb;
  v_number numeric;
begin
  select value into v_value from public.economy_config where key = _key;
  if v_value is null or jsonb_typeof(v_value) <> 'number' then
    return _default;
  end if;
  begin
    v_number := (v_value #>> '{}')::numeric;
  exception when others then
    return _default;
  end;
  return coalesce(v_number, _default);
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily economy metrics
-- ---------------------------------------------------------------------------

create table if not exists public.economy_metrics (
  day date primary key,
  credits_minted_roaming bigint not null default 0,
  credits_minted_boss bigint not null default 0,
  credits_minted_offline bigint not null default 0,
  credits_minted_other bigint not null default 0,
  credits_minted_total bigint not null default 0,
  credits_destroyed_market_fees bigint not null default 0,
  credits_destroyed_vendor bigint not null default 0,
  credits_destroyed_resurrection bigint not null default 0,
  credits_destroyed_respec bigint not null default 0,
  credits_destroyed_boss_entry_fees bigint not null default 0,
  credits_destroyed_boss_death_fees bigint not null default 0,
  credits_destroyed_total bigint not null default 0,
  net_credit_change bigint not null default 0,
  legendaries_roaming integer not null default 0,
  legendaries_boss integer not null default 0,
  legendaries_cache integer not null default 0,
  legendaries_total integer not null default 0,
  market_listings_created integer not null default 0,
  market_sales integer not null default 0,
  market_volume bigint not null default 0,
  market_median_price numeric,
  market_median_by_rarity jsonb not null default '{}'::jsonb,
  cache_keys_from_ads integer not null default 0,
  cache_opens integer not null default 0,
  cache_fragments_awarded bigint not null default 0,
  computed_at timestamptz not null default now()
);

-- Full recompute of one UTC day's economy metrics from the verified
-- action ledger + item_instances, upserted on the day. Attribution
-- rules (see docs/ECONOMY.md for the dictionary):
--   * Mints are credits created by a faucet; market sales and service
--     jobs are transfers between players and are NOT mints — only the
--     destroyed fee leaves the supply.
--   * Boss victory rewards are counted GROSS: the ledger payload's
--     creditsGained is already net of the entry fee (the Chef folds
--     the fee into creditsDelta), so the fee is added back here and
--     counted once as a sink.
--   * Legacy June faucets (cc_idle_claim, cc_claim_roaming_rewards)
--     and the signup bundle land in credits_minted_other.
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

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees;

  insert into public.economy_metrics (
    day,
    credits_minted_roaming, credits_minted_boss, credits_minted_offline,
    credits_minted_other, credits_minted_total,
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

-- ---------------------------------------------------------------------------
-- cc_accept_listing: 0017 verbatim except the fee RATE comes from
-- economy_config ('marketFeeRate', default 0.05, clamped to [0, 1]).
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

  -- Market fee (0017; rate levered in 0018): derive the seller's fee
  -- reduction from the seller's OWN database records — skill_spends
  -- plus the equipped class mod payload — inside this transaction.
  -- NPC-seeded listings (supply_mode 'npc_market') are exempt: fee
  -- stays 0 and the NPC payout below is the full price, unchanged
  -- from 0004. The fee RATE is the economy_config lever
  -- 'marketFeeRate' (default 0.05), read through the guarded helper —
  -- a missing/malformed row falls back to the shipped default.
  select * into item from public.item_instances where id = listing.item_instance_id;
  select * into seller from public.profiles where id = listing.seller_user_id;
  if seller.id is not null and item.id is not null and coalesce(item.supply_mode, '') <> 'npc_market' then
    fee_rate := least(1::numeric, greatest(0::numeric,
      public.cc_economy_config_number('marketFeeRate', 0.05)));
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
    fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
  end if;

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + (listing.price_credits - fee_credits) where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;
  update public.item_instances set owner_user_id = actor, runtime_state = 'available', is_locked = false, equipped_slot = null where id = listing.item_instance_id returning * into item;

  result := jsonb_build_object('action_type', 'cc_accept_listing', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item), 'market_fee', jsonb_build_object('fee_credits', fee_credits, 'seller_proceeds', listing.price_credits - fee_credits, 'fee_rate', fee_rate, 'fee_reduction', fee_reduction, 'found_item', found_item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_accept_listing', nonce, result);
  return result;
end;
$function$;
