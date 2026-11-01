-- 0031_cache_rank.sql
--
-- Cache Rank: the Badass-rank analogue. Tokens come from LEVELS
-- only — one per level gained plus a bundle at each milestone level
-- (10/25/50/75/100; +5/+10/+15/+20/+25 at the shipped defaults, so
-- lifetime earnable by L100 is 99 + 75 = 174) — and are spent on
-- seven tiny permanent bonus tracks (Greed/credits, Fast Learner/XP,
-- Salvage Hound/scrap, Heavy Hand/damage, Thick Skin/max HP, Cache
-- Optimizer/cache quality, Silver Tongue/market proceeds), each
-- capped at 10 ranks on a rising cost curve (1,1,2,2,3,3,4,4,5,5 =
-- 30 per track, 210 to max everything against 174 earnable: choices
-- matter). Content owner: src/content/cacheRank.ts.
--
-- THE MODEL
--   - profiles.cache_rank_tokens is the spendable balance,
--     profiles.cache_rank_grant_level is the GRANT WATERMARK (the
--     highest level whose entitlement has been paid), and
--     profiles.cache_rank_spends carries the per-track ranks.
--     Tokens are a SEPARATE currency: the skill-point budget
--     (level - 1) and cc_retrain are untouched, and Cache Rank
--     offers NO respec (deliberate — bonuses are tiny and broad).
--   - Entitlement is a pure function of the server's own level
--     record: cc_cache_rank_entitlement(level). Grants pay
--     entitlement(level) - entitlement(watermark) exactly once,
--     enforced two ways that can never double-pay: a BEFORE UPDATE
--     OF player_level trigger covers EVERY XP path by construction
--     (roaming claim, boss, offline settlement, endless, crafting,
--     repair, legacy) because they all advance player_level through
--     the profiles row; cc_grant_cache_rank_tokens is the idempotent
--     observation RPC the Cache Rank routes call (retroactive
--     grants for existing profiles land on first touch — a
--     pre-existing L50 profile receives exactly 79 tokens once).
--     Grant ledger rows (cc_cache_rank_grant, key
--     'cache-rank-grant:<uid>:<from>:<to>') make every grant
--     auditable and feed the daily token meters.
--   - Guests earn and spend identically — grants key on the profile
--     row, never on account state. Nothing here reads a challenge,
--     a kill count, or a checklist: NOT an achievement system.
--   - Composition order is fixed and documented per consumer: earn
--     multipliers apply last (after gear/skill/activity/hot
--     multipliers); the market proceeds uplift applies to the
--     POST-FEE proceeds (fee first: rate x (1 - Darknet/Manipulator/
--     House Brand reductions), then the uplift, which is minted);
--     cache quality is skill cacheQuality (spends x definitions;
--     class-mod boosts do not feed the draw) + the Cache Rank track,
--     read once by the draw. cc_draw_odds gains a quality overload;
--     the one-arg original is untouched for the boss tables.
--   - All Cache Rank constants are economy levers (0018 pattern):
--     cc_economy_config_number with the content module's defaults
--     and hard clamps applied at every read.
--
-- All changes are old-code compatible: the new profile columns
-- default to 0 / '{}', every restated function keeps its signature,
-- and the trigger only ever ADDS tokens when player_level advances.


-- ─── 1. Profile state + the bonus definition table ──────────────────

alter table public.profiles
  add column if not exists cache_rank_tokens integer not null default 0,
  add column if not exists cache_rank_grant_level integer not null default 0,
  add column if not exists cache_rank_spends jsonb not null default '{}'::jsonb;

-- The spend menu's SQL face — parity-tested against
-- CACHE_RANK_BONUS_DEFS in src/content/cacheRank.ts.
create table if not exists public.cache_rank_bonus_definitions (
  id text primary key,
  name text not null,
  max_ranks integer not null check (max_ranks > 0)
);

insert into public.cache_rank_bonus_definitions (id, name, max_ranks) values
  ('credits', 'Greed', 10),
  ('xp', 'Fast Learner', 10),
  ('scrap', 'Salvage Hound', 10),
  ('damage', 'Heavy Hand', 10),
  ('maxHp', 'Thick Skin', 10),
  ('cacheQuality', 'Cache Optimizer', 10),
  ('marketProceeds', 'Silver Tongue', 10)
on conflict (id) do update
  set name = excluded.name, max_ranks = excluded.max_ranks;


-- ─── 2. Helpers: entitlement, cost, bonus fraction, quality draw ────
--
-- cc_cache_rank_entitlement is the SQL twin of cacheRankEntitlement
-- in src/content/cacheRank.ts; cc_cache_rank_cost twins
-- cacheRankCostForRank; cc_cache_rank_bonus_fraction twins
-- cacheRankBonuses (ranks x the levered per-rank effect, clamped at
-- the definition cap).

create or replace function public.cc_cache_rank_entitlement(p_level integer)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_per_level integer := least(3, greatest(0,
    public.cc_economy_config_number('cacheRankTokensPerLevel', 1)))::integer;
  v_base integer := least(25, greatest(0,
    public.cc_economy_config_number('cacheRankMilestoneBundleBase', 5)))::integer;
  v_step integer := least(25, greatest(0,
    public.cc_economy_config_number('cacheRankMilestoneBundleStep', 5)))::integer;
  v_level integer := greatest(1, coalesce(p_level, 1));
  v_total integer := 0;
  v_milestones integer[] := array[10, 25, 50, 75, 100];
  i integer;
begin
  v_total := (v_level - 1) * v_per_level;
  for i in 1 .. array_length(v_milestones, 1) loop
    if v_milestones[i] <= v_level then
      v_total := v_total + v_base + (i - 1) * v_step;
    end if;
  end loop;
  return v_total;
end;
$$;

create or replace function public.cc_cache_rank_cost(p_current_ranks integer)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base integer := least(10, greatest(1,
    public.cc_economy_config_number('cacheRankCostBase', 1)))::integer;
  v_growth numeric := least(2::numeric, greatest(0::numeric,
    public.cc_economy_config_number('cacheRankCostGrowth', 1)));
  v_ranks integer := greatest(0, coalesce(p_current_ranks, 0));
begin
  return greatest(1, round(v_base + v_growth * (v_ranks / 2))::integer);
end;
$$;

create or replace function public.cc_cache_rank_bonus_fraction(
  p_spends jsonb,
  p_bonus_id text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ranks numeric := coalesce((p_spends ->> p_bonus_id)::numeric, 0);
  v_max integer;
  v_key text;
  v_default numeric;
  v_lo numeric;
  v_hi numeric;
  v_per_rank numeric;
begin
  select max_ranks into v_max
    from public.cache_rank_bonus_definitions where id = p_bonus_id;
  if v_max is null then return 0; end if;
  v_ranks := least(v_max::numeric, greatest(0::numeric, trunc(v_ranks)));
  case p_bonus_id
    when 'credits' then v_key := 'cacheRankCreditsPerRank'; v_default := 0.01; v_lo := 0; v_hi := 0.02;
    when 'xp' then v_key := 'cacheRankXpPerRank'; v_default := 0.01; v_lo := 0; v_hi := 0.02;
    when 'scrap' then v_key := 'cacheRankScrapPerRank'; v_default := 0.01; v_lo := 0; v_hi := 0.02;
    when 'damage' then v_key := 'cacheRankDamagePerRank'; v_default := 0.005; v_lo := 0; v_hi := 0.01;
    when 'maxHp' then v_key := 'cacheRankMaxHpPerRank'; v_default := 0.01; v_lo := 0; v_hi := 0.02;
    when 'cacheQuality' then v_key := 'cacheRankCacheQualityPerRank'; v_default := 0.02; v_lo := 0; v_hi := 0.04;
    when 'marketProceeds' then v_key := 'cacheRankMarketProceedsPerRank'; v_default := 0.005; v_lo := 0; v_hi := 0.01;
    else return 0;
  end case;
  v_per_rank := least(v_hi, greatest(v_lo,
    public.cc_economy_config_number(v_key, v_default)));
  return v_ranks * v_per_rank;
end;
$$;

-- Quality-aware draw overload: outcomes ABOVE the table's lowest
-- tier weigh (1 + quality) x base; the lowest tier is unchanged —
-- the TS twin is cacheQualityAdjustedWeights + drawOdds in
-- src/server/writes. The one-argument cc_draw_odds (0004) is
-- untouched; boss tables keep drawing through it.
create or replace function public.cc_draw_odds(table_name text, p_quality numeric)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  total numeric;
  pick numeric;
  running numeric := 0;
  candidate record;
  min_outcome text;
  q numeric := greatest(0::numeric, coalesce(p_quality, 0));
begin
  select min(outcome) into min_outcome
    from public.odds_outcomes where table_id = table_name;
  select sum(case when outcome = min_outcome then weight::numeric
                  else weight::numeric * (1 + q) end)
    into total
    from public.odds_outcomes
   where table_id = table_name;
  if total is null or total <= 0 then
    raise exception 'No outcomes configured for %', table_name;
  end if;
  pick := floor(random() * total)::numeric + 1;
  for candidate in
    select outcome, weight, payload
      from public.odds_outcomes
     where table_id = table_name
     order by outcome
  loop
    running := running + case when candidate.outcome = min_outcome
                              then candidate.weight::numeric
                              else candidate.weight::numeric * (1 + q) end;
    if pick <= running then
      return jsonb_build_object('table_id', table_name, 'outcome', candidate.outcome,
        'roll', pick, 'total_weight', total, 'payload', candidate.payload,
        'cache_quality', q);
    end if;
  end loop;
  raise exception 'Outcome resolution failed for %', table_name;
end;
$$;


-- ─── 3. Grants: the level trigger + the observation RPC ─────────────
--
-- The trigger fires inside whichever transaction advances
-- player_level, so every XP path grants exactly once BY
-- CONSTRUCTION. It writes its ledger row first (ON CONFLICT DO
-- NOTHING) and only credits the balance when the row landed, so a
-- racing observation can never double-pay; the watermark is then
-- advanced on NEW so the span is never reconsidered.

create or replace function public.cc_cache_rank_grant_on_level()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from integer := coalesce(old.cache_rank_grant_level, 0);
  v_grant integer;
begin
  if new.player_level is not distinct from old.player_level then
    return new;
  end if;
  if new.player_level <= v_from then return new; end if;
  v_grant := greatest(0, public.cc_cache_rank_entitlement(new.player_level)
                       - public.cc_cache_rank_entitlement(v_from));
  if v_grant > 0 then
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (new.id, 'cc_cache_rank_grant',
            'cache-rank-grant:' || new.id::text || ':' || v_from::text || ':' || new.player_level::text,
            jsonb_build_object('action_type', 'cc_cache_rank_grant',
              'tokens_granted', v_grant, 'from_level', v_from, 'to_level', new.player_level))
    on conflict (user_id, idempotency_key) do nothing;
    if found then
      new.cache_rank_tokens := coalesce(new.cache_rank_tokens, 0) + v_grant;
    end if;
  end if;
  new.cache_rank_grant_level := new.player_level;
  return new;
end;
$$;

drop trigger if exists trg_profiles_cache_rank_grant on public.profiles;
create trigger trg_profiles_cache_rank_grant
  before update of player_level on public.profiles
  for each row execute function public.cc_cache_rank_grant_on_level();

-- The observation RPC: pays any ungranted entitlement for the
-- profile's CURRENT server level and advances the watermark.
-- Idempotent by the watermark itself; the routes call it on Cache
-- Rank reads and before spends, so grants also land for profiles
-- whose level predates this migration (retroactive, exactly once).
create or replace function public.cc_grant_cache_rank_tokens(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  v_from integer;
  v_grant integer;
  v_paid boolean := false;
begin
  if p_user_id is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));
  select * into p from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Profile not found'; end if;
  v_from := coalesce(p.cache_rank_grant_level, 0);
  v_grant := greatest(0, public.cc_cache_rank_entitlement(p.player_level)
                       - public.cc_cache_rank_entitlement(v_from));
  if v_grant > 0 then
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (p_user_id, 'cc_cache_rank_grant',
            'cache-rank-grant:' || p_user_id::text || ':' || v_from::text || ':' || p.player_level::text,
            jsonb_build_object('action_type', 'cc_cache_rank_grant',
              'tokens_granted', v_grant, 'from_level', v_from, 'to_level', p.player_level))
    on conflict (user_id, idempotency_key) do nothing;
    v_paid := found;
  end if;
  if p.player_level > v_from and (v_paid or v_grant = 0) then
    update public.profiles
       set cache_rank_tokens = coalesce(cache_rank_tokens, 0)
             + case when v_paid then v_grant else 0 end,
           cache_rank_grant_level = p.player_level,
           updated_at = now()
     where id = p_user_id
    returning * into p;
  end if;
  return jsonb_build_object('granted', case when v_paid then v_grant else 0 end,
    'tokens', coalesce(p.cache_rank_tokens, 0),
    'grant_level', coalesce(p.cache_rank_grant_level, 0),
    'level', p.player_level);
end;
$$;


-- ─── 4. Spending: cc_spend_cache_rank ───────────────────────────────
--
-- Ledger-idempotent by nonce. Applies any pending grant inline
-- under the profile row lock first (observe-then-spend), then
-- validates the track against cache_rank_bonus_definitions and the
-- levered cost curve, debits the balance, and bumps the rank — all
-- derived from server records; the request carries only the bonus
-- id and a nonce.

create or replace function public.cc_spend_cache_rank(
  p_user_id uuid,
  nonce text,
  p_bonus_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_user_id;
  prior jsonb;
  p public.profiles%rowtype;
  v_def public.cache_rank_bonus_definitions%rowtype;
  v_from integer;
  v_grant integer;
  v_paid boolean := false;
  v_ranks integer;
  v_cost integer;
  v_result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Observe-then-spend (inline cc_grant_cache_rank_tokens): the
  -- pending entitlement lands under this same lock so the spend
  -- below sees the true balance.
  v_from := coalesce(p.cache_rank_grant_level, 0);
  v_grant := greatest(0, public.cc_cache_rank_entitlement(p.player_level)
                       - public.cc_cache_rank_entitlement(v_from));
  if v_grant > 0 then
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_cache_rank_grant',
            'cache-rank-grant:' || actor::text || ':' || v_from::text || ':' || p.player_level::text,
            jsonb_build_object('action_type', 'cc_cache_rank_grant',
              'tokens_granted', v_grant, 'from_level', v_from, 'to_level', p.player_level))
    on conflict (user_id, idempotency_key) do nothing;
    v_paid := found;
    if v_paid then
      p.cache_rank_tokens := coalesce(p.cache_rank_tokens, 0) + v_grant;
    end if;
  end if;
  if p.player_level > v_from and (v_paid or v_grant = 0) then
    p.cache_rank_grant_level := p.player_level;
  end if;

  select * into v_def from public.cache_rank_bonus_definitions where id = p_bonus_id;
  if not found then raise exception 'Unknown Cache Rank bonus'; end if;
  v_ranks := least(v_def.max_ranks, greatest(0,
    coalesce((p.cache_rank_spends ->> p_bonus_id)::numeric, 0)::integer));
  if v_ranks >= v_def.max_ranks then
    raise exception 'Cache Rank bonus maxed';
  end if;
  v_cost := public.cc_cache_rank_cost(v_ranks);
  if coalesce(p.cache_rank_tokens, 0) < v_cost then
    raise exception 'Not enough Cache Rank tokens';
  end if;

  update public.profiles
     set cache_rank_tokens = p.cache_rank_tokens - v_cost,
         cache_rank_grant_level = p.cache_rank_grant_level,
         cache_rank_spends = jsonb_set(coalesce(cache_rank_spends, '{}'::jsonb),
           array[p_bonus_id], to_jsonb(v_ranks + 1), true),
         updated_at = now()
   where id = actor
  returning * into p;

  v_result := jsonb_build_object('action_type', 'cc_cache_rank_spend',
    'bonus_id', p_bonus_id, 'rank_after', v_ranks + 1, 'cost', v_cost,
    'tokens', p.cache_rank_tokens,
    'profile', public.cc_profile_snapshot(p));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_cache_rank_spend', nonce, v_result);
  return v_result;
end;
$$;


-- ─── 5. cc_profile_snapshot restated (0030 body + Cache Rank) ───────

CREATE OR REPLACE FUNCTION public.cc_profile_snapshot(profile_row profiles)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', profile_row.id,
    'player_level', profile_row.player_level,
    'player_xp', profile_row.player_xp,
    'credits', profile_row.credits,
    'scrap', profile_row.scrap,
    'cache_tokens', profile_row.cache_tokens,
    'cache_token_parts', profile_row.cache_token_parts,
    'legendary_cores', coalesce(profile_row.legendary_cores, 0),
    'materials', profile_row.materials,
    'essences', profile_row.essences,
    'consumables', profile_row.consumables,
    'consumable_batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'consumable_type', b.consumable_type,
        'quality_percent', b.quality_percent,
        'quantity', b.quantity,
        'origin', b.origin,
        'creator_user_id', b.creator_user_id,
        'source_recipe_id', b.source_recipe_id,
        'metadata', b.metadata,
        'created_at', b.created_at,
        'updated_at', b.updated_at
      ) order by b.consumable_type, b.quality_percent desc, b.created_at)
      from public.consumable_batches b
      where b.owner_user_id = profile_row.id and b.quantity > 0
    ), '[]'::jsonb),
    'vehicle_fuel', profile_row.vehicle_fuel,
    'skill_spends', profile_row.skill_spends,
    'action_skill_charge', coalesce(profile_row.action_skill_charge, 0),
    'action_skill_selection', profile_row.action_skill_selection,
    'cache_rank_tokens', coalesce(profile_row.cache_rank_tokens, 0),
    'cache_rank_grant_level', coalesce(profile_row.cache_rank_grant_level, 0),
    'cache_rank_spends', coalesce(profile_row.cache_rank_spends, '{}'::jsonb),
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at
  );
$function$;


-- ─── 6. cc_make_item restated (0004 body + quality-aware draw) ──────

CREATE OR REPLACE FUNCTION public.cc_make_item(p_player_id uuid, nonce text)
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
  result jsonb;
  odds jsonb;
  cache_quality numeric := 0;
  skill_quality numeric := 0;
  rarity_value text;
  item_value bigint;
  item_level integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if p.cache_tokens < 1 then raise exception 'Not enough tokens'; end if;

  -- Cache quality (0031): the draw reads the TOTAL cache quality —
  -- the Scavenger node's cacheQuality effect (Encrypted Payloads,
  -- skill spends x node definitions; class-mod boosts do not feed
  -- the draw) PLUS the Cache Rank Cache Optimizer track. This is
  -- the first consumer of the cacheQuality effect (registry:
  -- src/lib/skills/skillConsumers.ts).
  select coalesce(sum((d.effects ->> 'cacheQuality')::numeric * s.points), 0)
    into skill_quality
    from (select key as node_id, (value)::numeric::integer as points
            from jsonb_each_text(coalesce(p.skill_spends, '{}'::jsonb))) s
    join public.skill_node_definitions d on d.id = s.node_id;
  cache_quality := greatest(0::numeric, coalesce(skill_quality, 0))
    + public.cc_cache_rank_bonus_fraction(p.cache_rank_spends, 'cacheQuality');
  odds := public.cc_draw_odds('cache_primary_rarity', cache_quality);
  rarity_value := odds ->> 'outcome';

  update public.profiles set cache_tokens = cache_tokens - 1 where id = actor returning * into p;

  item_level := greatest(1, p.player_level);
  item_value := public.cc_compute_item_estimated_value(
    jsonb_build_object('odds', odds),
    'weapon',
    rarity_value,
    item_level
  );

  insert into public.item_instances (
    owner_user_id,
    kind,
    item_level,
    rarity,
    estimated_value,
    supply_mode,
    payload
  ) values (
    actor,
    'weapon',
    item_level,
    rarity_value,
    item_value,
    'verified_action',
    public.cc_generate_weapon_payload(item_level, rarity_value)
  ) returning * into item;

  result := jsonb_build_object('action_type', 'cc_make_item', 'profile', public.cc_profile_snapshot(p), 'odds', odds, 'cache_quality', cache_quality, 'item', to_jsonb(item));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_make_item', nonce, result);

  return result;
end;
$function$;


-- ─── 7. cc_accept_listing restated (0029 body + Silver Tongue) ──────

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
  house_pts numeric := 0;
  crafted_item boolean := false;
  fee_reduction numeric := 0;
  fee_credits bigint := 0;
  proceeds_bonus bigint := 0;
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

  if listing.listing_kind in ('gear', 'vehicle') then
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
        + case when crafted_item then 0.15 * house_pts else 0 end));
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
        0.05 * darknet_pts + case when crafted_item then 0.15 * house_pts else 0 end));
      fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
    end if;
  end if;

  -- Cache Rank Silver Tongue (0031): the proceeds uplift applies
  -- AFTER the fee, on the post-fee proceeds, and only where a fee
  -- branch ran (real player seller; NPC listings exempt). The
  -- uplift is MINTED to the seller and metered as such
  -- (market_fee.cache_rank_proceeds_bonus folds into
  -- credits_minted_other in cc_compute_economy_metrics).
  -- Composition order: fee rate (lever) x (1 - Darknet/Manipulator/
  -- House Brand reductions) first, then the uplift.
  if (listing.listing_kind in ('gear', 'vehicle') and seller.id is not null
        and item.id is not null and coalesce(item.supply_mode, '') <> 'npc_market')
     or (listing.listing_kind not in ('gear', 'vehicle') and seller.id is not null
        and coalesce(listing.seller_type, 'player') <> 'npc') then
    proceeds_bonus := floor((listing.price_credits - fee_credits)
      * public.cc_cache_rank_bonus_fraction(seller.cache_rank_spends, 'marketProceeds'))::bigint;
  end if;

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + (listing.price_credits - fee_credits + proceeds_bonus) where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;

  if listing.listing_kind in ('gear', 'vehicle') then
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

  result := jsonb_build_object('action_type', 'cc_accept_listing', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item), 'delivery', jsonb_build_object('kind', listing.listing_kind, 'quantity', listing.quantity, 'quality_percent', listing.quality_percent, 'consumable_type', listing.consumable_type, 'material_id', listing.material_id, 'batch_id', delivered_batch_id), 'market_fee', jsonb_build_object('fee_credits', fee_credits, 'seller_proceeds', listing.price_credits - fee_credits + proceeds_bonus, 'cache_rank_proceeds_bonus', proceeds_bonus, 'fee_rate', fee_rate, 'fee_reduction', fee_reduction, 'found_item', found_item, 'crafted_item', crafted_item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_accept_listing', nonce, result);
  return result;
end;
$function$;


-- ─── 8. cc_complete_craft_unit restated (0030 body + Fast Learner) ──

create or replace function public.cc_complete_craft_unit(
  p_job_id uuid,
  p_xp_rate numeric,
  p_quality_shift numeric,
  p_temper_base numeric,
  p_refine_base numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  job public.craft_jobs%rowtype;
  p public.profiles%rowtype;
  recipe jsonb;
  v_xp bigint;
  v_output jsonb;
  v_next jsonb;
  v_mastery_track text;
  v_mastery_xp integer;
  -- consumable completion
  v_type text;
  v_ml integer;
  v_bounds jsonb;
  v_roll numeric;
  v_qty integer;
  v_bonus boolean;
  -- refine completion
  v_yield numeric;
  v_count integer;
  -- gear completion
  v_tempered boolean;
  -- repair completion (0025)
  v_item public.item_instances%rowtype;
  -- Fixer completion terms (0029)
  v_mod_payload jsonb;
  v_craft_quality_bonus numeric := 0;
  v_craft_temper_bonus numeric := 0;
  v_shift numeric;
  v_kit_base numeric;
  v_quality numeric;
  v_before numeric;
  v_restore numeric;
  v_restored numeric;
begin
  select * into job from public.craft_jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  actor := job.owner_user_id;
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if job.kind = 'repair' then
    -- Self-repair unit (0025): apply the next escrowed patch kit.
    -- Restoration = kit base x kit quality% x the owner's repair
    -- efficiency snapshot, clamped at the vehicle's max; the kit is
    -- spent even when the clamp wastes part of it. No player XP
    -- (consumption); repair mastery trains by points restored.
    v_output := jsonb_build_object(
      'unit', job.units_completed + 1,
      'kind', 'repair',
      'xp', 0,
      'completedAtMs', (extract(epoch from now()) * 1000)::bigint
    );
    select * into v_item from public.item_instances
     where id = (job.snapshot -> 'repair' ->> 'itemId')::uuid
       and owner_user_id = actor;
    if not found or v_item.kind <> 'vehicle'
       or v_item.runtime_state in ('listed', 'consumed', 'salvaged', 'in_service')
       or coalesce(v_item.condition_current, v_item.condition_max, 100)
          >= coalesce(v_item.condition_max, 100) then
      -- The unit never starts: the settler ends the job here and
      -- refunds this and every later kit at its recorded quality.
      return v_output || jsonb_build_object('vehicleFull', true);
    end if;
    v_kit_base := case job.snapshot -> 'repair' ->> 'kitType'
      when 'PatchKit' then 30 when 'FieldPatchKit' then 45
      when 'MasterPatchKit' then 80 else 0 end;
    v_quality := coalesce(
      (job.snapshot -> 'repair' -> 'kitQualities' ->> job.units_completed)::numeric, 100);
    v_before := coalesce(v_item.condition_current, v_item.condition_max, 100);
    v_restore := round(v_kit_base * v_quality / 100
      * coalesce((job.snapshot -> 'repair' ->> 'efficiency')::numeric, 1), 2);
    update public.item_instances
       set condition_current = least(coalesce(condition_max, 100), v_before + v_restore),
           updated_at = now()
     where id = v_item.id
     returning condition_current into v_item.condition_current;
    v_restored := round(v_item.condition_current - v_before, 2);
    if v_restored > 0 then
      perform public.cc_add_mastery_xp(actor, 'services.repair', ceil(v_restored)::integer);
    end if;
    v_output := v_output || jsonb_build_object(
      'itemId', v_item.id,
      'quality', v_quality,
      'pointsRestored', v_restored,
      'conditionCurrent', v_item.condition_current
    );
    v_output := public.cc_jsonb_strip_nulls(v_output);
    update public.craft_jobs
       set units_completed = units_completed + 1,
           outputs = outputs || jsonb_build_array(v_output)
     where id = job.id;
    -- 0030: Overclock charge accrual — self-repair points restored
    -- charge a Fixer-selected owner's pool (per-point lever rate).
    if v_restored > 0 and coalesce(p.action_skill_selection, '') = 'Fixer' then
      select payload into v_mod_payload from public.item_instances
       where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      if public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, 'Fixer') then
        update public.profiles
           set action_skill_charge = least(100, action_skill_charge
             + least(2, greatest(0, public.cc_economy_config_number('actionSkillChargePerRepairPoint', 0.2))) * v_restored)
         where id = actor;
      end if;
    end if;
    return v_output;
  end if;

  -- Fixer derivation (0029): the completing crafter's OWN records.
  -- The quality shift composes lever + skill under ONE clamp
  -- [-10, +20] (a future Research shift joins the same sum); the
  -- temper term adds Master Artificer's flat bonus under the 0.30 cap.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_craft_quality_bonus := 1.0 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_2', 'Fixer', 5));
  v_craft_temper_bonus := 0.05 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_major_1', 'Fixer', 1);
  v_shift := least(20, greatest(-10, p_quality_shift + v_craft_quality_bonus));

  recipe := public.cc_craft_recipe(job.recipe_id);
  if recipe is null then raise exception 'Unknown craft recipe'; end if;

  v_xp := public.cc_craft_unit_xp(job.unit_duration_ms, p.player_level, p_xp_rate);
  -- Cache Rank Fast Learner (0031): craft XP carries the same XP
  -- bonus as every other source (applied after the peg rate,
  -- before cc_apply_xp — the shipped composition order).
  v_xp := round(v_xp * (1 + public.cc_cache_rank_bonus_fraction(p.cache_rank_spends, 'xp')))::bigint;
  v_output := jsonb_build_object(
    'unit', job.units_completed + 1,
    'kind', job.kind,
    'xp', v_xp,
    -- The settle instant is the production instant for metrics: the
    -- outputs (and their XP/materials) observably land at settlement.
    'completedAtMs', (extract(epoch from now()) * 1000)::bigint
  );

  if job.kind = 'consumable' then
    v_type := recipe ->> 'consumableType';
    v_ml := public.cc_player_mastery_level(actor, 'crafting_consumables');
    v_bounds := public.cc_craft_quality_bounds(
      v_type, v_ml, job.bench,
      (job.snapshot ->> 'catalystMaterialId') is not null,
      v_shift
    );
    v_roll := round((
      ((v_bounds ->> 'min')::numeric
        + random() * greatest(0, (v_bounds ->> 'max')::numeric - (v_bounds ->> 'min')::numeric))
      * case job.bench when 2 then 1.05 when 3 then 1.10 else 1.0 end
      * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
    )::numeric, 2);
    v_roll := least((v_bounds ->> 'cap')::numeric, greatest(1, v_roll));
    v_qty := 1;
    v_bonus := false;
    if coalesce((job.snapshot ->> 'toolBonusUnitChance')::numeric, 0) > 0
       and random() < (job.snapshot ->> 'toolBonusUnitChance')::numeric then
      v_qty := 2;
      v_bonus := true;
    end if;
    perform public.cc_add_consumable_batch(
      actor, v_type, v_qty, v_roll, 'crafted', actor, job.recipe_id,
      'crafted', 'Crafted at the Workshop', '{}'::jsonb);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, v_type, v_qty),
           updated_at = now()
     where id = actor;
    perform public.cc_add_stat(actor, 'consumables_crafted', v_qty);
    v_output := v_output || jsonb_build_object(
      'consumableType', v_type,
      'quality', v_roll,
      'quantity', v_qty,
      'bonusUnit', v_bonus
    );
  elsif job.kind = 'refine' then
    v_ml := public.cc_player_mastery_level(actor, 'crafting.refining');
    v_yield := least(1, p_refine_base + 0.004 * v_ml
      + coalesce((job.snapshot ->> 'toolRefineYieldBonus')::numeric, 0));
    if coalesce((recipe ->> 'outputBase')::numeric, 0) <= 0 or p_refine_base <= 0 then
      v_count := coalesce((recipe ->> 'outputBase')::integer, 0);
    else
      v_count := floor((recipe ->> 'outputBase')::numeric * v_yield / p_refine_base)::integer;
    end if;
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, recipe ->> 'outputMaterial', v_count),
           updated_at = now()
     where id = actor;
    v_output := v_output || jsonb_build_object(
      'outputMaterial', recipe ->> 'outputMaterial',
      'outputQuantity', v_count
    );
  elsif job.kind = 'gear' then
    v_ml := public.cc_player_mastery_level(actor, 'crafting.gear');
    v_tempered := random() < least(0.3, greatest(0, p_temper_base) + 0.01 * v_ml + v_craft_temper_bonus);
    v_output := v_output || jsonb_build_object(
      'pending', true,
      'slot', recipe ->> 'gearSlot',
      'rarity', job.snapshot ->> 'gearRarity',
      'item_level', p.player_level,
      'draws', (case when v_tempered then 3 else 1 end)
        + case when job.snapshot ->> 'coreCatalyst' = 'true'
            then 2 + coalesce((job.snapshot ->> 'coreCatalystDrawBonus')::integer, 0)
            else 0 end,
      'tempered', v_tempered
    );
  elsif job.kind = 'tool' then
    -- All three fitted tools carry 25 jobs of durability (§2.5e).
    update public.profiles
       set workshop_tools = jsonb_set(
             jsonb_set(coalesce(workshop_tools, '{}'::jsonb),
               array['owned', recipe ->> 'toolId'], 'true'::jsonb, true),
             array['charges', recipe ->> 'toolId'], '25'::jsonb, true),
           updated_at = now()
     where id = actor;
    v_output := v_output || jsonb_build_object('toolId', recipe ->> 'toolId');
  end if;

  -- Mastery + player XP land after the output is priced.
  if job.kind = 'refine' then
    v_mastery_track := 'crafting.refining'; v_mastery_xp := 10;
  elsif job.kind in ('gear', 'tool') then
    v_mastery_track := 'crafting.gear'; v_mastery_xp := 25;
  else
    v_mastery_track := 'crafting_consumables'; v_mastery_xp := 10;
  end if;
  perform public.cc_add_mastery_xp(actor, v_mastery_track, v_mastery_xp);
  v_next := public.cc_apply_xp(p.player_level, p.player_xp, v_xp);
  update public.profiles
     set player_level = (v_next ->> 'player_level')::integer,
         player_xp = (v_next ->> 'player_xp')::bigint,
         updated_at = now()
   where id = actor;

  v_output := public.cc_jsonb_strip_nulls(v_output);
  update public.craft_jobs
     set units_completed = units_completed + 1,
         xp_awarded = xp_awarded + v_xp,
         outputs = outputs || jsonb_build_array(v_output)
   where id = job.id;
  -- 0030: Overclock charge accrual — a completed craft unit charges
  -- a Fixer-selected crafter's pool (per-unit lever rate).
  if coalesce(p.action_skill_selection, '') = 'Fixer'
     and public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, 'Fixer') then
    update public.profiles
       set action_skill_charge = least(100, action_skill_charge
         + least(25, greatest(0, public.cc_economy_config_number('actionSkillChargePerCraftUnit', 3))))
     where id = actor;
  end if;
  return v_output;
end;$$;


-- ─── 9. cc_repair_finalize_job restated (0030 body + Fast Learner) ──

create or replace function public.cc_repair_finalize_job(p_job_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.service_jobs%rowtype;
  provider public.profiles%rowtype;
  v_price bigint;
  v_restored numeric;
  v_target integer;
  v_payout bigint := 0;
  v_fee_rate numeric := least(1, greatest(0,
    public.cc_economy_config_number('marketFeeRate', 0.05)));
  v_xp_per_point numeric := least(10, greatest(0,
    public.cc_economy_config_number('serviceXpPerPoint', 2)));
  mod_payload jsonb;
  darknet_pts numeric := 0;
  v_fee_reduction numeric := 0;
  v_fee bigint := 0;
  v_xp bigint := 0;
  v_next jsonb;
begin
  select * into job from public.service_jobs where id = p_job_id for update;
  if not found then raise exception 'Repair job not found'; end if;
  if job.status in ('completed', 'cancelled') then
    return jsonb_build_object('job_id', job.id, 'outcome', job.outcome,
      'already_terminal', true);
  end if;

  v_price := coalesce(job.quoted_price_credits, 0);
  v_restored := coalesce(job.points_restored, 0);
  v_target := coalesce(job.target_points, 0);
  -- Price is per-point under the hood: full completion pays in
  -- full; anything else pays floor(price x restored / target).
  if p_outcome = 'completed' then
    v_payout := v_price;
  elsif v_target > 0 and v_restored > 0 then
    v_payout := floor(v_price * v_restored / v_target)::bigint;
  end if;

  if job.provider_user_id is not null then
    select * into provider from public.profiles where id = job.provider_user_id for update;
    if found and v_payout > 0 then
      -- The ONE player-to-player fee rule: the shared market fee,
      -- with the mechanic's Darknet Broker derivation mirrored from
      -- cc_accept_listing (0017) — skill_spends + equipped class mod.
      select payload into mod_payload from public.item_instances
       where owner_user_id = provider.id and runtime_state = 'equipped'
         and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((provider.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
      end if;
      v_fee_reduction := least(1::numeric, greatest(0::numeric, 0.05 * darknet_pts));
      v_fee := floor(v_payout * v_fee_rate * (1 - v_fee_reduction))::bigint;
      update public.profiles
         set credits = credits + (v_payout - v_fee), updated_at = now()
       where id = provider.id;
    end if;
    if found and v_restored > 0 then
      v_xp := round(v_xp_per_point * v_restored)::bigint;
      -- Cache Rank Fast Learner (0031): repair XP carries the same
      -- XP bonus as every other source.
      v_xp := round(v_xp * (1 + public.cc_cache_rank_bonus_fraction(provider.cache_rank_spends, 'xp')))::bigint;
      if v_xp > 0 then
        v_next := public.cc_apply_xp(provider.player_level, provider.player_xp, v_xp);
        update public.profiles
           set player_level = (v_next ->> 'player_level')::integer,
               player_xp = (v_next ->> 'player_xp')::bigint,
               updated_at = now()
         where id = provider.id;
      end if;
      perform public.cc_add_mastery_xp(provider.id, 'services.repair', ceil(v_restored)::integer);
      if p_outcome = 'completed' then
        perform public.cc_add_stat(provider.id, 'services.completed', 1);
      end if;
      -- 0030: Overclock charge accrual — board repair points charge
      -- a Fixer-selected mechanic's pool (per-point lever rate).
      if coalesce(provider.action_skill_selection, '') = 'Fixer' then
        select payload into mod_payload from public.item_instances
         where owner_user_id = provider.id and runtime_state = 'equipped'
           and payload ? 'treeBonus'
         limit 1;
        if public.cc_action_skill_qualified(provider.skill_spends, mod_payload, 'Fixer') then
          update public.profiles
             set action_skill_charge = least(100, action_skill_charge
               + least(2, greatest(0, public.cc_economy_config_number('actionSkillChargePerRepairPoint', 0.2))) * v_restored),
                 updated_at = now()
           where id = provider.id;
        end if;
      end if;
    end if;
    -- Abandonment is a conduct record, not work: it lands even when
    -- zero points were restored (the usual case).
    if found and p_outcome = 'abandoned' then
      perform public.cc_add_stat(provider.id, 'services.abandoned', 1);
    end if;
  end if;

  -- The unspent escrow returns to the owner; the fee is destroyed
  -- (credited to nobody), exactly like a market fee.
  if v_price - v_payout > 0 then
    update public.profiles
       set credits = credits + (v_price - v_payout), updated_at = now()
     where id = job.owner_user_id;
  end if;
  if job.escrow_id is not null then
    update public.escrow_records
       set status = case when v_payout > 0 then 'released' else 'refunded' end,
           released_at = now()
     where id = job.escrow_id;
  end if;
  -- The vehicle is never hostage: every terminal state releases it.
  update public.item_instances
     set runtime_state = 'available', is_locked = false, updated_at = now()
   where id = job.target_item_instance_id;
  update public.service_jobs
     set status = case when p_outcome in ('completed', 'delivered_partial')
                     then 'completed' else 'cancelled' end,
         outcome = p_outcome,
         paid_credits = v_payout,
         fee_credits = v_fee,
         xp_awarded = v_xp,
         completed_at = now()
   where id = job.id;

  return jsonb_build_object('job_id', job.id, 'outcome', p_outcome,
    'paid_credits', v_payout, 'fee_credits', v_fee, 'xp_awarded', v_xp,
    'points_restored', v_restored);
end;$$;


-- ─── 10. Economy metrics: Cache Rank token meters ───────────────────

alter table public.economy_metrics
  add column if not exists cache_rank_tokens_granted integer not null default 0,
  add column if not exists cache_rank_tokens_spent integer not null default 0;

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
  cj record;
  rj record;
  er record;
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
     + coalesce(sum((result_payload -> 'market_fee' ->> 'cache_rank_proceeds_bonus')::bigint)
        filter (where action_type = 'cc_accept_listing'), 0)
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
    -- Crafted market sales (0024) -------------------------------------------
    count(*) filter (where action_type = 'cc_accept_listing'
      and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
        or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')) as crafted_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'
        and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
          or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')), 0) as crafted_volume,
    -- Cache -----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_claim_rewarded_cache_key') as cache_keys_from_ads,
    count(*) filter (where action_type in ('cc_make_item', 'cc_draw_item')) as cache_opens,
    coalesce(sum((result_payload -> 'rewards' ->> 'cache_fragments_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_fragments_awarded,
    -- Legendary salvage + cores (0026): destroyed legendaries are a
    -- LEDGER fact (the recycle result carries the consumed item) —
    -- distinct from legendaries_minted_by_source above, which counts
    -- item_instances at creation. No double counting: creation and
    -- destruction are separate meters by design.
    count(*) filter (where action_type = 'cc_recycle_item'
      and result_payload -> 'item' ->> 'rarity' = 'Legendary') as legendaries_salvaged,
    coalesce(sum((result_payload ->> 'cores_award')::bigint)
      filter (where action_type = 'cc_recycle_item'), 0) as legendary_cores_minted,
    -- Cache Rank (0031): token meters — counted from the grant /
    -- spend ledger payloads (tokens are not credits; these never
    -- enter the minted/destroyed credit totals).
    coalesce(sum((result_payload ->> 'tokens_granted')::bigint)
      filter (where action_type = 'cc_cache_rank_grant'), 0) as cache_rank_tokens_granted,
    coalesce(sum((result_payload ->> 'cost')::bigint)
      filter (where action_type = 'cc_cache_rank_spend'), 0) as cache_rank_tokens_spent,
    (coalesce(sum((result_payload -> 'job' ->> 'escrow_cores')::bigint)
        filter (where action_type = 'cc_enqueue_craft_job'), 0)
     - coalesce(sum((result_payload ->> 'cores_refunded')::bigint)
        filter (where action_type = 'cc_cancel_craft_job'), 0)
     -- Reforge (0027): cores destroyed outright extend the spent
     -- meter — each destroyed core is counted exactly once, here;
     -- the dedicated column below breaks the reforge share out.
     + coalesce(sum((result_payload ->> 'cores_charged')::bigint)
        filter (where action_type = 'cc_reforge_item'), 0)) as legendary_cores_spent,
    -- Reforge meters (0027): completions, scrap destroyed, cores
    -- destroyed — all ledger facts from cc_reforge_item results.
    count(*) filter (where action_type = 'cc_reforge_item') as reforges_completed,
    coalesce(sum((result_payload ->> 'scrap_charged')::bigint)
      filter (where action_type = 'cc_reforge_item'), 0) as scrap_destroyed_reforge,
    coalesce(sum((result_payload ->> 'cores_charged')::bigint)
      filter (where action_type = 'cc_reforge_item'), 0) as legendary_cores_destroyed_reforge,
    -- Endless meters (0028): runs, encounters, fees, payouts — all
    -- ledger facts from the three endless appliers' result payloads.
    -- Run-end payouts appear on cc_end_endless_run (bank), on
    -- cc_apply_endless_encounter (death / depth-cap bank), and as
    -- abandoned_settlement inside cc_start_endless_run.
    count(*) filter (where action_type = 'cc_start_endless_run') as endless_runs_started,
    (count(*) filter (where action_type = 'cc_end_endless_run'
        and coalesce((result_payload ->> 'ended')::boolean, false))
     + count(*) filter (where action_type = 'cc_apply_endless_encounter'
        and result_payload ->> 'run_status' in ('died', 'banked'))
     + count(*) filter (where action_type = 'cc_start_endless_run'
        and result_payload -> 'abandoned_settlement' is not null
        and result_payload -> 'abandoned_settlement' <> 'null'::jsonb)) as endless_runs_ended,
    count(*) filter (where action_type = 'cc_apply_endless_encounter'
      and coalesce((result_payload ->> 'victory')::boolean, false)) as endless_encounters_cleared,
    coalesce(sum((result_payload ->> 'entry_fee')::bigint)
      filter (where action_type = 'cc_start_endless_run'), 0) as endless_fees_destroyed,
    (coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'credits')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as endless_credits_paid,
    (coalesce(sum((result_payload -> 'payout' ->> 'xp')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'xp')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as endless_xp_paid,
    -- Action skill fires (0030): counted from the appliers' recorded
    -- action_skill blocks; the workshop fire's own ledger rows are
    -- Fixer fires. Firing moves no currency — these are pure counts.
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Gunslinger') as action_skill_fires_gunslinger,
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Demolition') as action_skill_fires_demolition,
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Scavenger') as action_skill_fires_scavenger,
    (count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
        and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
        and result_payload -> 'action_skill' ->> 'tree' = 'Fixer')
     + count(*) filter (where action_type = 'cc_fire_overclock_workshop')) as action_skill_fires_fixer
  into m
  from public.verified_action_ledger
  where created_at >= v_start and created_at < v_end;

  -- Craft job meters (0024): jobs_completed is a job-level fact
  -- (status + completed_at); units / XP / refined output are counted
  -- per OUTPUT at the unit's settle-day stamp, across jobs of ANY
  -- status — units produced inside a job that is later cancelled (or
  -- still running at day's end) are real production and real XP.
  select
    (select count(*) from public.craft_jobs j
      where j.status = 'complete'
        and j.completed_at >= v_start and j.completed_at < v_end) as jobs_completed,
    count(*)::integer as units_completed,
    coalesce(sum((o ->> 'xp')::bigint), 0)::bigint as xp_awarded,
    coalesce(sum((o ->> 'outputQuantity')::integer)
      filter (where o ->> 'kind' = 'refine'), 0)::integer as refined_units
  into cj
  from public.craft_jobs j,
       lateral jsonb_array_elements(j.outputs) o
  where (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
    and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint;

  -- Repair meters (0025): job-level facts from service_jobs at
  -- their terminal day (posted counted at posting day); self-repair
  -- kit consumption counted per completed repair UNIT output, the
  -- same settle-day stamp the craft meters use.
  select
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.created_at >= v_start and j.created_at < v_end) as jobs_posted,
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair' and j.status = 'completed'
        and j.completed_at >= v_start and j.completed_at < v_end)::integer as jobs_completed,
    (select coalesce(sum(j.points_restored), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled')) as points_restored,
    (select coalesce(sum(j.paid_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as credits_volume,
    (select coalesce(sum(j.fee_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as fees_destroyed,
    (select coalesce(sum(j.xp_awarded), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as xp_awarded,
    ((select coalesce(sum(jsonb_array_length(j.kits_consumed)), 0)
        from public.service_jobs j
       where j.profession_id = 'repair'
         and j.completed_at >= v_start and j.completed_at < v_end
         and j.status in ('completed', 'cancelled'))
     + (select count(*) from public.craft_jobs j,
              lateral jsonb_array_elements(j.outputs) o
         where o ->> 'kind' = 'repair'
           and (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
           and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint))::integer as kits_consumed
  into rj;

  -- Endless depth + milestone facts (0028): deepest run ENDED today
  -- (bank, death, cap, or carried-out abandonment — each ending is a
  -- ledger fact on its own row), and milestone drops by rarity from
  -- the encounter payloads that recorded them.
  select
    (select coalesce(max(d), 0)::integer from (
       select (result_payload ->> 'depth_reached')::integer as d
         from public.verified_action_ledger
        where action_type = 'cc_end_endless_run'
          and coalesce((result_payload ->> 'ended')::boolean, false)
          and created_at >= v_start and created_at < v_end
       union all
       select (result_payload ->> 'depth')::integer
         from public.verified_action_ledger
        where action_type = 'cc_apply_endless_encounter'
          and result_payload ->> 'run_status' in ('died', 'banked')
          and created_at >= v_start and created_at < v_end
       union all
       select (result_payload -> 'abandoned_settlement' ->> 'depth_reached')::integer
         from public.verified_action_ledger
        where action_type = 'cc_start_endless_run'
          and result_payload -> 'abandoned_settlement' is not null
          and result_payload -> 'abandoned_settlement' <> 'null'::jsonb
          and created_at >= v_start and created_at < v_end
     ) depths) as deepest_depth,
    (select count(*)::integer
       from public.verified_action_ledger
      where action_type = 'cc_apply_endless_encounter'
        and created_at >= v_start and created_at < v_end
        and result_payload -> 'milestone_drop' ->> 'rarity' is not null) as milestone_drops,
    (select coalesce(jsonb_object_agg(g.rarity, g.cnt), '{}'::jsonb)
       from (
         select result_payload -> 'milestone_drop' ->> 'rarity' as rarity,
                count(*)::integer as cnt
           from public.verified_action_ledger
          where action_type = 'cc_apply_endless_encounter'
            and created_at >= v_start and created_at < v_end
            and result_payload -> 'milestone_drop' ->> 'rarity' is not null
          group by 1
       ) g) as milestone_by_rarity
  into er;

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other
    + m.endless_credits_paid;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees
    + rj.fees_destroyed + m.endless_fees_destroyed;

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
    craft_jobs_completed, craft_units_completed, craft_xp_awarded,
    materials_destroyed_crafting, refined_units_produced,
    gear_items_crafted, crafted_market_sales, crafted_market_volume,
    repair_jobs_posted, repair_jobs_completed, repair_points_restored,
    repair_credits_volume, repair_fees_destroyed, repair_kits_consumed,
    repair_xp_awarded,
    legendaries_salvaged, legendary_cores_minted, legendary_cores_spent,
    reforges_completed, scrap_destroyed_reforge, legendary_cores_destroyed_reforge,
    endless_runs_started, endless_runs_ended, endless_encounters_cleared,
    endless_deepest_depth, endless_credits_paid, endless_xp_paid,
    endless_fees_destroyed, endless_milestone_drops,
    endless_milestone_drops_by_rarity,
    action_skill_fires_gunslinger, action_skill_fires_demolition,
    action_skill_fires_scavenger, action_skill_fires_fixer,
    cache_rank_tokens_granted, cache_rank_tokens_spent,
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
    cj.jobs_completed, cj.units_completed, cj.xp_awarded,
    (select coalesce(jsonb_object_agg(key, net), '{}'::jsonb)
       from (
         select d.key, sum(d.delta) as net
           from (
             select e.key as key, (e.value)::bigint as delta
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, (e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_catalyst', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, -(e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'refunded_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_cancel_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
           ) d
          group by d.key
         having sum(d.delta) > 0
       ) nets),
    cj.refined_units,
    (select count(*)::integer from public.item_instances
      where payload ->> 'origin' = 'crafted'
        and created_at >= v_start and created_at < v_end),
    m.crafted_sales, m.crafted_volume,
    rj.jobs_posted, rj.jobs_completed, rj.points_restored,
    rj.credits_volume, rj.fees_destroyed, rj.kits_consumed,
    rj.xp_awarded,
    m.legendaries_salvaged, m.legendary_cores_minted, m.legendary_cores_spent,
    m.reforges_completed, m.scrap_destroyed_reforge, m.legendary_cores_destroyed_reforge,
    m.endless_runs_started, m.endless_runs_ended, m.endless_encounters_cleared,
    er.deepest_depth, m.endless_credits_paid, m.endless_xp_paid,
    m.endless_fees_destroyed, er.milestone_drops,
    er.milestone_by_rarity,
    m.action_skill_fires_gunslinger, m.action_skill_fires_demolition,
    m.action_skill_fires_scavenger, m.action_skill_fires_fixer,
    m.cache_rank_tokens_granted, m.cache_rank_tokens_spent,
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
    craft_jobs_completed = excluded.craft_jobs_completed,
    craft_units_completed = excluded.craft_units_completed,
    craft_xp_awarded = excluded.craft_xp_awarded,
    materials_destroyed_crafting = excluded.materials_destroyed_crafting,
    refined_units_produced = excluded.refined_units_produced,
    gear_items_crafted = excluded.gear_items_crafted,
    crafted_market_sales = excluded.crafted_market_sales,
    crafted_market_volume = excluded.crafted_market_volume,
    repair_jobs_posted = excluded.repair_jobs_posted,
    repair_jobs_completed = excluded.repair_jobs_completed,
    repair_points_restored = excluded.repair_points_restored,
    repair_credits_volume = excluded.repair_credits_volume,
    repair_fees_destroyed = excluded.repair_fees_destroyed,
    repair_kits_consumed = excluded.repair_kits_consumed,
    repair_xp_awarded = excluded.repair_xp_awarded,
    legendaries_salvaged = excluded.legendaries_salvaged,
    legendary_cores_minted = excluded.legendary_cores_minted,
    legendary_cores_spent = excluded.legendary_cores_spent,
    reforges_completed = excluded.reforges_completed,
    scrap_destroyed_reforge = excluded.scrap_destroyed_reforge,
    legendary_cores_destroyed_reforge = excluded.legendary_cores_destroyed_reforge,
    endless_runs_started = excluded.endless_runs_started,
    endless_runs_ended = excluded.endless_runs_ended,
    endless_encounters_cleared = excluded.endless_encounters_cleared,
    endless_deepest_depth = excluded.endless_deepest_depth,
    endless_credits_paid = excluded.endless_credits_paid,
    endless_xp_paid = excluded.endless_xp_paid,
    endless_fees_destroyed = excluded.endless_fees_destroyed,
    endless_milestone_drops = excluded.endless_milestone_drops,
    endless_milestone_drops_by_rarity = excluded.endless_milestone_drops_by_rarity,
    action_skill_fires_gunslinger = excluded.action_skill_fires_gunslinger,
    action_skill_fires_demolition = excluded.action_skill_fires_demolition,
    action_skill_fires_scavenger = excluded.action_skill_fires_scavenger,
    action_skill_fires_fixer = excluded.action_skill_fires_fixer,
    cache_rank_tokens_granted = excluded.cache_rank_tokens_granted,
    cache_rank_tokens_spent = excluded.cache_rank_tokens_spent,
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;$$;
