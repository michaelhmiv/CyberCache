-- =====================================================================
-- 0042 — Contracts Board: rotating work orders (content owner:
-- src/content/contracts.ts; brief contracts-board.md, DECISIONS
-- R3/R4 + Q3–Q7 defaults).
--
-- A contract is a time-boxed work order: a template, a target
-- scaled to the player's level band, a soft reward, a hard expiry.
-- Daily set (3) is seeded GLOBALLY PER BAND — a shared bulletin;
-- weekly set (5) is seeded PER PLAYER. Sets materialize lazily on
-- first read (cc_issue_contracts) with baselines frozen; progress
-- is evaluated from server facts only (cc_contract_progress);
-- claiming re-evaluates inside its transaction and pays exactly
-- once (cc_claim_contract_reward); reroll is the skip
-- (cc_reroll_contract — 1 free per set, then scrap, destroyed).
--
-- Rewards: credits + fragment parts; the weekly full-set bonus is
-- the ONLY key source (1 key/week max at defaults). NEVER cores
-- (R3 — salvage is the only mint), never legendaries, gear, or XP.
-- Unclaimed rewards FORFEIT at expiry (stated on the card from
-- issuance). Guests see the board; claims refuse (Q6).
--
-- Pieces:
--   1. Twin tables: contract_bands, contract_template_definitions
--      (id/family/kind/stat-key/targets — parity-pinned against
--      src/content/contracts.ts by vitest), contract_bounty_bosses.
--   2. contract_instances (+ contract_set_bonuses — the exactly-
--      once anchor for full-set bonuses).
--   3. Seed machinery: cc_contract_fnv1a / cc_contract_rand_step
--      (mulberry32) / cc_contract_draw / cc_contract_draw_reroll —
--      statement-for-statement mirrors of the content module's
--      draw; the slice harness pins identical sets for fixed seeds.
--   4. cc_issue_contracts / cc_contract_progress /
--      cc_claim_contract_reward / cc_reroll_contract.
--   5. Three new standing stats (brief §1.2): the 0014 ledger
--      trigger restated (+ combat.roaming_kills from
--      rewards.kills_recorded on both roaming claim paths,
--      + consumables.used from the trigger's already-translated
--      consumed map, + services.points_restored from
--      cc_repair_job_finish payloads), and cc_complete_craft_unit
--      restated from its 0031 body (+ services.points_restored
--      from repair-unit completions — the settler writes no
--      ledger row, so the unit function itself records the stat;
--      generated programmatically from the 0031 body).
--   6. Economy meters: credits_minted_contracts (folded into
--      credits_minted_total — contract rewards are a credit
--      SOURCE and never hide in _other), contracts_claimed,
--      contracts_expired_unclaimed, contract_rerolls,
--      contract_keys_awarded, scrap_destroyed_contract_rerolls;
--      cc_compute_economy_metrics restated from its 0037 body.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Twin tables.
-- ---------------------------------------------------------------------
create table if not exists public.contract_bands (
  band_index integer primary key check (band_index between 1 and 5),
  band_id text not null unique,
  min_level integer not null,
  max_level integer,
  target_multiplier numeric not null,
  daily_credits bigint not null,
  weekly_credits bigint not null
);

insert into public.contract_bands (band_index, band_id, min_level, max_level, target_multiplier, daily_credits, weekly_credits) values
  (1, 'B1', 1, 9, 0.5, 120, 500),
  (2, 'B2', 10, 24, 1, 220, 900),
  (3, 'B3', 25, 49, 1.5, 350, 1400),
  (4, 'B4', 50, 74, 2, 500, 2000),
  (5, 'B5', 75, null, 2.5, 650, 2600)
on conflict (band_index) do nothing;

create table if not exists public.contract_template_definitions (
  template_id text primary key,
  family text not null,
  kind text not null,
  stat_key text,
  daily boolean not null,
  weekly boolean not null,
  min_band integer not null check (min_band between 1 and 5),
  base_target_daily integer,
  base_target_weekly integer,
  target_by_band jsonb,
  fragment_parts_daily integer not null default 0,
  param_kind text not null default 'none'
);

insert into public.contract_template_definitions
  (template_id, family, kind, stat_key, daily, weekly, min_band, base_target_daily, base_target_weekly, target_by_band, fragment_parts_daily, param_kind) values
  ('field_work', 'combat', 'kills', 'combat.roaming_kills', true, true, 1, 200, 1200, null, 1, 'none'),
  ('elite_hunt', 'combat', 'elites', 'combat.elite_kills', true, true, 1, 1, 4, null, 1, 'none'),
  ('surge_watch', 'combat', 'events', 'roaming.events_fired', false, true, 1, null, 100, null, 0, 'none'),
  ('long_haul', 'combat', 'roaming_xp', 'combat.idle_xp_claimed', true, true, 1, 1000, 8000, null, 1, 'none'),
  ('gauntlet', 'combat', 'endless_depth', null, true, true, 1, null, null, '{"1":{"daily":2,"weekly":3},"2":{"daily":3,"weekly":5},"3":{"daily":5,"weekly":8},"4":{"daily":4,"weekly":6},"5":{"daily":3,"weekly":5}}'::jsonb, 1, 'none'),
  ('gauntlet_regular', 'combat', 'endless_runs', null, false, true, 1, null, 3, null, 0, 'none'),
  ('boss_contract', 'boss', 'boss_victories', 'combat.boss_defeats', true, true, 1, 1, 3, null, 1, 'none'),
  ('named_bounty', 'boss', 'specific_boss', null, false, true, 3, null, 1, null, 0, 'boss'),
  ('production_order', 'craft', 'crafts', null, true, true, 1, 4, 24, null, 0, 'none'),
  ('fine_work', 'craft', 'consumables_crafted', 'consumables_crafted', true, false, 1, 4, null, null, 0, 'none'),
  ('refinery_shift', 'craft', 'refines', null, false, true, 1, null, 8, null, 0, 'none'),
  ('perfectionist', 'craft', 'reforges', 'actions.cc_reforge_item', false, true, 3, null, 3, null, 0, 'none'),
  ('service_record', 'service', 'points_restored', 'services.points_restored', false, true, 2, null, 150, null, 0, 'none'),
  ('shopfront', 'market', 'seller_sales', null, true, true, 2, 1, 4, null, 0, 'none'),
  ('open_for_business', 'market', 'listings', 'economy.market_listings', true, false, 1, 2, null, null, 0, 'none'),
  ('supply_run', 'market', 'vendor_buys', 'economy.vendor_buys', true, false, 1, 3, null, null, 0, 'none'),
  ('breakdown', 'meta', 'salvages', 'inventory.recycle.count', true, true, 1, 6, 36, null, 1, 'none'),
  ('cache_work', 'meta', 'cache_opens', 'inventory.cache_draws', true, true, 1, 1, 3, null, 0, 'none'),
  ('field_kit', 'meta', 'consumables_used', 'consumables.used', true, false, 1, 5, null, null, 0, 'none'),
  ('archivist', 'meta', 'discoveries', null, false, true, 1, null, 3, null, 0, 'none'),
  ('gathering_order', 'meta', 'extraction_units', null, true, true, 1, 40, 240, null, 0, 'none')
on conflict (template_id) do nothing;

create table if not exists public.contract_bounty_bosses (
  boss_id text primary key,
  boss_level integer not null
);

insert into public.contract_bounty_bosses (boss_id, boss_level) values
  ('dune_tyrant', 5),
  ('siltstalker', 10),
  ('heap_guard', 15),
  ('ashgut', 22),
  ('mirage_duster', 28),
  ('rust_prophet', 35),
  ('scrap_bishop', 45),
  ('spinneret_widow', 50),
  ('mnemosyne_mirror', 55),
  ('static_choir', 60),
  ('verdant_maw', 65),
  ('sister_null', 70),
  ('vaultkeeper_omega', 75)
on conflict (boss_id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Instances + set-bonus anchor. A reroll keeps the replaced row
--    (status 'rerolled') and inserts the replacement at
--    generation + 1 in the same slot — the set's current contract
--    per slot is the max generation. 'expired' is never stored: an
--    active instance whose window has closed READS as expired.
-- ---------------------------------------------------------------------
create table if not exists public.contract_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_kind text not null check (period_kind in ('daily', 'weekly')),
  period_key text not null,
  slot integer not null check (slot >= 0),
  generation integer not null default 0 check (generation >= 0),
  template_id text not null,
  band text not null,
  params jsonb not null default '{}'::jsonb,
  baseline jsonb not null default '{}'::jsonb,
  target integer not null check (target >= 1),
  reward jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'claimed', 'rerolled')),
  issued_at timestamptz not null default now(),
  claimed_at timestamptz,
  unique (user_id, period_kind, period_key, slot, generation)
);

create index if not exists contract_instances_user_period_idx
  on public.contract_instances (user_id, period_kind, period_key, slot);

create table if not exists public.contract_set_bonuses (
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_kind text not null check (period_kind in ('daily', 'weekly')),
  period_key text not null,
  credits_awarded bigint not null default 0,
  fragments_awarded bigint not null default 0,
  cache_keys_awarded integer not null default 0,
  claimed_at timestamptz not null default now(),
  primary key (user_id, period_kind, period_key)
);

-- ---------------------------------------------------------------------
-- 3. Seed machinery — mirrors of the content module's FNV-1a and
--    mulberry32 (ASCII seed strings only: dates, band ids, UUIDs).
-- ---------------------------------------------------------------------
create or replace function public.cc_contract_fnv1a(p_text text)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
declare
  h bigint := 2166136261;
  bytes bytea := convert_to(p_text, 'UTF8');
  i integer;
begin
  for i in 0 .. octet_length(bytes) - 1 loop
    h := ((h # get_byte(bytes, i)) * 16777619) & 4294967295;
  end loop;
  return h;
end;
$$;

-- One mulberry32 step: returns the next state and a value in [0, 1).
-- The 32-bit multiplies go through numeric (a bigint product of two
-- 32-bit values overflows int8); the low 32 bits are the imul.
create or replace function public.cc_contract_rand_step(p_state bigint)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  a bigint := (p_state + 1831565813) & 4294967295;
  t bigint := a;
begin
  t := (((t # (t >> 15))::numeric * (t | 1)::numeric) % 4294967296)::bigint;
  t := t # ((t + (((t # (t >> 7))::numeric * (t | 61)::numeric) % 4294967296)::bigint) & 4294967295);
  return jsonb_build_object(
    'state', a,
    'value', ((t # (t >> 14)) & 4294967295)::numeric / 4294967296
  );
end;
$$;

-- Band-eligible bounty bosses in draw order (level, then id).
create or replace function public.cc_contract_eligible_bosses(p_band_index integer)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(b.boss_id order by b.boss_level, b.boss_id), '{}'::text[])
    from public.contract_bounty_bosses b,
         public.contract_bands band
   where band.band_index = p_band_index
     and b.boss_level <= coalesce(band.max_level, 2147483647);
$$;

-- THE draw (mirrors drawContractSet in src/content/contracts.ts):
-- pool = eligible templates sorted by id; each pick consumes one
-- rand step; a family-capped candidate is discarded (pick spent);
-- a boss-param template draws its boss with the next step.
create or replace function public.cc_contract_draw(
  p_seed text,
  p_kind text,
  p_band_index integer,
  p_count integer,
  p_exclude text[] default '{}'::text[]
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_state bigint := public.cc_contract_fnv1a(p_seed);
  v_step jsonb;
  v_pool_ids text[] := '{}'::text[];
  v_pool_families text[] := '{}'::text[];
  v_bosses text[] := public.cc_contract_eligible_bosses(p_band_index);
  v_set jsonb := '[]'::jsonb;
  v_family_counts jsonb := '{}'::jsonb;
  v_idx integer;
  v_candidate text;
  v_family text;
  v_params jsonb;
begin
  select coalesce(array_agg(d.template_id order by d.template_id), '{}'::text[]),
         coalesce(array_agg(d.family order by d.template_id), '{}'::text[])
    into v_pool_ids, v_pool_families
    from public.contract_template_definitions d
   where ((p_kind = 'daily' and d.daily) or (p_kind = 'weekly' and d.weekly))
     and d.min_band <= p_band_index
     and not (d.template_id = any (p_exclude));

  while jsonb_array_length(v_set) < p_count and coalesce(array_length(v_pool_ids, 1), 0) > 0 loop
    v_step := public.cc_contract_rand_step(v_state);
    v_state := (v_step ->> 'state')::bigint;
    v_idx := floor((v_step ->> 'value')::numeric * array_length(v_pool_ids, 1))::integer + 1;
    v_candidate := v_pool_ids[v_idx];
    v_family := v_pool_families[v_idx];
    select coalesce(array_agg(x order by ord), '{}'::text[]),
           coalesce(array_agg(y order by ord), '{}'::text[])
      into v_pool_ids, v_pool_families
      from unnest(v_pool_ids, v_pool_families) with ordinality as u(x, y, ord)
     where ord <> v_idx;
    if coalesce((v_family_counts ->> v_family)::integer, 0) >= 2 then
      continue;
    end if;
    v_family_counts := jsonb_set(v_family_counts, array[v_family],
      to_jsonb(coalesce((v_family_counts ->> v_family)::integer, 0) + 1));
    v_params := '{}'::jsonb;
    if (select param_kind from public.contract_template_definitions where template_id = v_candidate) = 'boss'
       and coalesce(array_length(v_bosses, 1), 0) > 0 then
      v_step := public.cc_contract_rand_step(v_state);
      v_state := (v_step ->> 'state')::bigint;
      v_params := jsonb_build_object('bossId',
        v_bosses[floor((v_step ->> 'value')::numeric * array_length(v_bosses, 1))::integer + 1]);
    end if;
    v_set := v_set || jsonb_build_array(jsonb_build_object(
      'template_id', v_candidate, 'params', v_params));
  end loop;
  return v_set;
end;
$$;

-- The reroll draw (mirrors drawContractReroll): one fresh contract
-- from the slot's own stream, family cap checked against the set's
-- other members (passed in), exclusions applied before the stream.
create or replace function public.cc_contract_draw_reroll(
  p_seed text,
  p_kind text,
  p_band_index integer,
  p_exclude text[],
  p_set_families text[]
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_state bigint := public.cc_contract_fnv1a(p_seed);
  v_step jsonb;
  v_pool_ids text[] := '{}'::text[];
  v_pool_families text[] := '{}'::text[];
  v_bosses text[] := public.cc_contract_eligible_bosses(p_band_index);
  v_family_counts jsonb := '{}'::jsonb;
  v_fam text;
  v_idx integer;
  v_candidate text;
  v_family text;
  v_params jsonb;
begin
  foreach v_fam in array coalesce(p_set_families, '{}'::text[]) loop
    v_family_counts := jsonb_set(v_family_counts, array[v_fam],
      to_jsonb(coalesce((v_family_counts ->> v_fam)::integer, 0) + 1));
  end loop;

  select coalesce(array_agg(d.template_id order by d.template_id), '{}'::text[]),
         coalesce(array_agg(d.family order by d.template_id), '{}'::text[])
    into v_pool_ids, v_pool_families
    from public.contract_template_definitions d
   where ((p_kind = 'daily' and d.daily) or (p_kind = 'weekly' and d.weekly))
     and d.min_band <= p_band_index
     and not (d.template_id = any (p_exclude));

  while coalesce(array_length(v_pool_ids, 1), 0) > 0 loop
    v_step := public.cc_contract_rand_step(v_state);
    v_state := (v_step ->> 'state')::bigint;
    v_idx := floor((v_step ->> 'value')::numeric * array_length(v_pool_ids, 1))::integer + 1;
    v_candidate := v_pool_ids[v_idx];
    v_family := v_pool_families[v_idx];
    select coalesce(array_agg(x order by ord), '{}'::text[]),
           coalesce(array_agg(y order by ord), '{}'::text[])
      into v_pool_ids, v_pool_families
      from unnest(v_pool_ids, v_pool_families) with ordinality as u(x, y, ord)
     where ord <> v_idx;
    if coalesce((v_family_counts ->> v_family)::integer, 0) >= 2 then
      continue;
    end if;
    v_params := '{}'::jsonb;
    if (select param_kind from public.contract_template_definitions where template_id = v_candidate) = 'boss'
       and coalesce(array_length(v_bosses, 1), 0) > 0 then
      v_step := public.cc_contract_rand_step(v_state);
      v_state := (v_step ->> 'state')::bigint;
      v_params := jsonb_build_object('bossId',
        v_bosses[floor((v_step ->> 'value')::numeric * array_length(v_bosses, 1))::integer + 1]);
    end if;
    return jsonb_build_object('template_id', v_candidate, 'params', v_params);
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Issuance terms: the frozen target / reward / baseline for one
--    template at one band, priced from the LIVE levers (a later
--    lever move never reprices the frozen row).
-- ---------------------------------------------------------------------
create or replace function public.cc_contract_terms(
  p_player_id uuid,
  p_template_id text,
  p_kind text,
  p_band_index integer
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  d public.contract_template_definitions%rowtype;
  band public.contract_bands%rowtype;
  v_target_scalar numeric := greatest(0.5, least(2,
    public.cc_economy_config_number('contractTargetScalar', 1)));
  v_reward_scalar numeric := greatest(0, least(2,
    public.cc_economy_config_number('contractRewardScalar', 1)));
  v_base numeric;
  v_target integer;
  v_credits bigint;
  v_parts integer;
  v_baseline jsonb := '{}'::jsonb;
  v_stat_value bigint;
begin
  select * into d from public.contract_template_definitions where template_id = p_template_id;
  if not found then raise exception 'Unknown contract template'; end if;
  select * into band from public.contract_bands where band_index = p_band_index;

  if d.target_by_band is not null then
    v_base := coalesce((d.target_by_band -> p_band_index::text ->> p_kind)::numeric, 1);
    v_target := greatest(1, round(v_base * v_target_scalar))::integer;
  else
    v_base := case when p_kind = 'daily' then d.base_target_daily else d.base_target_weekly end;
    v_target := greatest(1, round(v_base * band.target_multiplier * v_target_scalar))::integer;
  end if;

  v_credits := round((case when p_kind = 'daily' then band.daily_credits else band.weekly_credits end)
    * v_reward_scalar)::bigint;
  v_parts := floor((case when p_kind = 'daily' then d.fragment_parts_daily else 3 end)
    * v_reward_scalar)::integer;

  if d.stat_key is not null then
    select stat_value into v_stat_value from public.player_stat_counters
     where user_id = p_player_id and stat_key = d.stat_key;
    v_baseline := jsonb_build_object(d.stat_key, coalesce(v_stat_value, 0));
  end if;

  return jsonb_build_object(
    'target', v_target,
    'reward', jsonb_build_object('credits', v_credits, 'fragments', v_parts),
    'baseline', v_baseline
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Issuance. p_now exists ONLY so the slice harness can pin
--    periods deterministically; production callers omit it and the
--    database clock decides the period (forgery surface: none —
--    no caller names a period, a band, or a template).
-- ---------------------------------------------------------------------
create or replace function public.cc_issue_contracts(
  p_player_id uuid,
  p_period_kind text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  v_today date := (p_now at time zone 'UTC')::date;
  v_period_key text;
  band public.contract_bands%rowtype;
  v_count integer;
  v_seed text;
  v_draws jsonb;
  v_draw jsonb;
  v_terms jsonb;
  v_slot integer := 0;
  v_existing integer;
begin
  if p_player_id is null then raise exception 'Authentication required'; end if;
  if p_period_kind not in ('daily', 'weekly') then raise exception 'Invalid contract period'; end if;

  perform pg_advisory_xact_lock(hashtext(p_player_id::text));

  select * into p from public.profiles where id = p_player_id;
  if not found then raise exception 'Profile not found'; end if;

  v_period_key := case
    when p_period_kind = 'daily' then v_today::text
    else (date_trunc('week', v_today::timestamp)::date)::text
  end;

  select count(*) into v_existing from public.contract_instances
   where user_id = p_player_id and period_kind = p_period_kind and period_key = v_period_key;
  if v_existing > 0 then
    return jsonb_build_object('period_kind', p_period_kind, 'period_key', v_period_key,
      'issued', 0, 'already_issued', true);
  end if;

  select * into band from public.contract_bands
   where p.player_level >= min_level and (max_level is null or p.player_level <= max_level);

  v_count := case when p_period_kind = 'daily'
    then greatest(1, least(5, public.cc_economy_config_number('contractDailyCount', 3)))::integer
    else greatest(1, least(8, public.cc_economy_config_number('contractWeeklyCount', 5)))::integer
  end;

  v_seed := case when p_period_kind = 'daily'
    then 'contracts:daily:' || v_period_key || ':' || band.band_id
    else 'contracts:weekly:' || v_period_key || ':' || p_player_id::text
  end;

  v_draws := public.cc_contract_draw(v_seed, p_period_kind, band.band_index, v_count);

  for v_draw in select * from jsonb_array_elements(v_draws) loop
    v_terms := public.cc_contract_terms(p_player_id, v_draw ->> 'template_id', p_period_kind, band.band_index);
    insert into public.contract_instances (
      user_id, period_kind, period_key, slot, generation, template_id, band,
      params, baseline, target, reward, status, issued_at
    ) values (
      p_player_id, p_period_kind, v_period_key, v_slot, 0, v_draw ->> 'template_id', band.band_id,
      coalesce(v_draw -> 'params', '{}'::jsonb), v_terms -> 'baseline',
      (v_terms ->> 'target')::integer, v_terms -> 'reward', 'active', p_now
    );
    v_slot := v_slot + 1;
  end loop;

  return jsonb_build_object('period_kind', p_period_kind, 'period_key', v_period_key,
    'band', band.band_id, 'issued', v_slot, 'already_issued', false);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. The evaluator. Stat kinds diff the standing counter against
--    the frozen baseline; window kinds fold the period's records
--    (depth is a MAX; the rest are sums/counts). Read paths call
--    this for display; the claim op calls it again in-transaction —
--    the screen's number is advisory, the claim's is the truth.
-- ---------------------------------------------------------------------
create or replace function public.cc_contract_progress(p_instance_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  inst public.contract_instances%rowtype;
  d public.contract_template_definitions%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_start_ms bigint;
  v_end_ms bigint;
  v_progress bigint := 0;
  v_current bigint;
begin
  select * into inst from public.contract_instances where id = p_instance_id;
  if not found then raise exception 'Contract instance not found'; end if;
  select * into d from public.contract_template_definitions where template_id = inst.template_id;

  if d.stat_key is not null then
    select stat_value into v_current from public.player_stat_counters
     where user_id = inst.user_id and stat_key = d.stat_key;
    v_progress := greatest(0, coalesce(v_current, 0) - coalesce((inst.baseline ->> d.stat_key)::bigint, 0));
    return jsonb_build_object('progress', v_progress, 'target', inst.target,
      'complete', v_progress >= inst.target);
  end if;

  v_start := (inst.period_key || 'T00:00:00Z')::timestamptz;
  v_end := v_start + (case when inst.period_kind = 'daily' then interval '1 day' else interval '7 days' end);
  v_start_ms := (extract(epoch from v_start) * 1000)::bigint;
  v_end_ms := (extract(epoch from v_end) * 1000)::bigint;

  if d.kind = 'crafts' then
    select count(*) into v_progress
      from public.craft_jobs j, lateral jsonb_array_elements(j.outputs) o
     where j.owner_user_id = inst.user_id
       and (o ->> 'completedAtMs')::bigint >= v_start_ms
       and (o ->> 'completedAtMs')::bigint < v_end_ms;
  elsif d.kind = 'refines' then
    select count(*) into v_progress
      from public.craft_jobs j, lateral jsonb_array_elements(j.outputs) o
     where j.owner_user_id = inst.user_id
       and o ->> 'kind' = 'refine'
       and (o ->> 'completedAtMs')::bigint >= v_start_ms
       and (o ->> 'completedAtMs')::bigint < v_end_ms;
  elsif d.kind = 'seller_sales' then
    select count(*) into v_progress
      from public.verified_action_ledger l
     where l.action_type = 'cc_accept_listing'
       and l.result_payload -> 'listing' ->> 'seller_user_id' = inst.user_id::text
       and l.created_at >= v_start and l.created_at < v_end;
  elsif d.kind = 'discoveries' then
    select count(*) into v_progress
      from public.collection_discoveries cd
     where cd.user_id = inst.user_id
       and cd.discovered_at >= v_start and cd.discovered_at < v_end;
  elsif d.kind = 'endless_depth' then
    select coalesce(max(r.depth_reached), 0) into v_progress
      from public.endless_runs r
     where r.user_id = inst.user_id and r.status <> 'active'
       and r.ended_at >= v_start and r.ended_at < v_end;
  elsif d.kind = 'endless_runs' then
    select count(*) into v_progress
      from public.endless_runs r
     where r.user_id = inst.user_id and r.status <> 'active'
       and r.ended_at >= v_start and r.ended_at < v_end;
  elsif d.kind = 'extraction_units' then
    select coalesce(sum(units), 0) into v_progress
      from (
        select (f.value)::bigint as units
          from public.verified_action_ledger l,
               jsonb_each_text(
                 coalesce(l.result_payload -> 'finds_materials', '{}'::jsonb)
                 || coalesce(l.result_payload -> 'finds_essences', '{}'::jsonb)) as f
         where l.action_type = 'cc_apply_extraction' and l.user_id = inst.user_id
           and l.created_at >= v_start and l.created_at < v_end
      ) finds;
  elsif d.kind = 'specific_boss' then
    select count(*) into v_progress
      from public.verified_action_ledger l
     where l.action_type = 'cc_apply_boss_attempt' and l.user_id = inst.user_id
       and l.result_payload ->> 'boss_id' = inst.params ->> 'bossId'
       and coalesce((l.result_payload -> 'attempt' ->> 'victory')::boolean, false)
       and l.created_at >= v_start and l.created_at < v_end;
  end if;

  return jsonb_build_object('progress', v_progress, 'target', inst.target,
    'complete', v_progress >= inst.target);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Claim. Re-evaluates inside the transaction, pays the FROZEN
--    reward exactly once (nonce replay + status guard), then checks
--    the full-set bonus: when every current slot of the set is
--    claimed, the bonus pays in the same transaction, anchored by
--    the contract_set_bonuses primary key (insert conflict = the
--    bonus already paid). Guests refuse (Q6): progress stays
--    visible and accrues; rewards stay locked until the account is
--    verified. Expiry is truth here too — an expired claim refuses.
-- ---------------------------------------------------------------------
create or replace function public.cc_claim_contract_reward(
  p_player_id uuid,
  p_nonce text,
  p_instance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  inst public.contract_instances%rowtype;
  v_replay jsonb;
  v_progress jsonb;
  v_credits bigint;
  v_fragments bigint;
  v_end timestamptz;
  v_open integer;
  v_bonus jsonb := null;
  v_bonus_credits bigint := 0;
  v_bonus_fragments bigint := 0;
  v_bonus_keys integer := 0;
  band public.contract_bands%rowtype;
  v_result jsonb;
begin
  if p_player_id is null then raise exception 'Authentication required'; end if;
  if p_nonce is null or length(p_nonce) < 8 then raise exception 'A claim nonce is required'; end if;

  perform pg_advisory_xact_lock(hashtext(p_player_id::text));

  select * into p from public.profiles where id = p_player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  select result_payload into v_replay from public.verified_action_ledger
   where user_id = p_player_id and idempotency_key = p_nonce
     and action_type = 'cc_claim_contract_reward';
  if v_replay is not null then return v_replay; end if;

  if p.account_type = 'guest' then
    raise exception 'Contracts require a verified account — link Google sign-in to claim rewards';
  end if;

  select * into inst from public.contract_instances where id = p_instance_id and user_id = p_player_id;
  if not found then raise exception 'Contract not found'; end if;
  if inst.status = 'claimed' then raise exception 'Contract already claimed'; end if;
  if inst.status = 'rerolled' then raise exception 'Contract was rerolled'; end if;

  v_end := (inst.period_key || 'T00:00:00Z')::timestamptz
    + (case when inst.period_kind = 'daily' then interval '1 day' else interval '7 days' end);
  if now() >= v_end then raise exception 'Contract expired — the window has closed'; end if;

  v_progress := public.cc_contract_progress(p_instance_id);
  if not coalesce((v_progress ->> 'complete')::boolean, false) then
    raise exception 'Contract not complete';
  end if;

  v_credits := coalesce((inst.reward ->> 'credits')::bigint, 0);
  v_fragments := coalesce((inst.reward ->> 'fragments')::bigint, 0);

  update public.profiles
     set credits = credits + v_credits,
         cache_token_parts = cache_token_parts + v_fragments,
         updated_at = now()
   where id = p_player_id;

  update public.contract_instances
     set status = 'claimed', claimed_at = now()
   where id = p_instance_id;

  -- Full-set bonus: every slot of this set, at its current
  -- generation, is now claimed.
  select count(*) into v_open
    from public.contract_instances cur
   where cur.user_id = p_player_id
     and cur.period_kind = inst.period_kind
     and cur.period_key = inst.period_key
     and cur.status <> 'claimed'
     and cur.generation = (
       select max(g.generation) from public.contract_instances g
        where g.user_id = cur.user_id and g.period_kind = cur.period_kind
          and g.period_key = cur.period_key and g.slot = cur.slot);
  if v_open = 0 then
    select * into band from public.contract_bands where band_id = inst.band;
    if inst.period_kind = 'daily' then
      v_bonus_fragments := floor(2 * greatest(0, least(2,
        public.cc_economy_config_number('contractRewardScalar', 1))))::bigint;
    else
      v_bonus_keys := greatest(0, least(3,
        public.cc_economy_config_number('contractWeeklyKeys', 1)))::integer;
      v_bonus_credits := round(band.weekly_credits * greatest(0, least(2,
        public.cc_economy_config_number('contractRewardScalar', 1))))::bigint;
    end if;
    insert into public.contract_set_bonuses (
      user_id, period_kind, period_key, credits_awarded, fragments_awarded, cache_keys_awarded
    ) values (p_player_id, inst.period_kind, inst.period_key, v_bonus_credits, v_bonus_fragments, v_bonus_keys)
    on conflict (user_id, period_kind, period_key) do nothing;
    if found then
      update public.profiles
         set credits = credits + v_bonus_credits,
             cache_token_parts = cache_token_parts + v_bonus_fragments,
             cache_tokens = cache_tokens + v_bonus_keys,
             updated_at = now()
       where id = p_player_id;
      v_bonus := jsonb_build_object('credits', v_bonus_credits,
        'fragments', v_bonus_fragments, 'cache_keys', v_bonus_keys);
      -- The bonus is its own verified grant (its own ledger row is
      -- what the economy fold meters: credits_minted_contracts sums
      -- both rows, contract_keys_awarded reads this one).
      insert into public.verified_action_ledger (user_id, action_type, idempotency_key, result_payload)
      values (p_player_id, 'cc_claim_contract_set_bonus', p_nonce || ':set-bonus', jsonb_build_object(
        'action_type', 'cc_claim_contract_set_bonus',
        'instance_id', inst.id,
        'template_id', inst.template_id,
        'period_kind', inst.period_kind,
        'period_key', inst.period_key,
        'credits_awarded', v_bonus_credits,
        'fragments_awarded', v_bonus_fragments,
        'cache_keys_awarded', v_bonus_keys
      ));
    end if;
  end if;

  select * into p from public.profiles where id = p_player_id;

  v_result := jsonb_build_object(
    'action_type', 'cc_claim_contract_reward',
    'instance_id', inst.id,
    'template_id', inst.template_id,
    'period_kind', inst.period_kind,
    'period_key', inst.period_key,
    'credits_awarded', v_credits,
    'fragments_awarded', v_fragments,
    'set_bonus', v_bonus,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger (user_id, action_type, idempotency_key, result_payload)
  values (p_player_id, 'cc_claim_contract_reward', p_nonce, v_result);

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Reroll — the skip. One free reroll per set (derived from the
--    set's rerolled rows); further rerolls destroy scrap (100
--    daily / 400 weekly at defaults, levered), recorded on the
--    ledger row. The replacement is drawn fresh from the slot's
--    stream, excluding the whole set, with a fresh baseline and
--    today's terms. Completed-but-unclaimed refuses (claim it or
--    let it expire — no reward laundering); claimed and expired
--    refuse too. A draw with no eligible replacement aborts the
--    whole transaction (no scrap lost, no slot emptied).
-- ---------------------------------------------------------------------
create or replace function public.cc_reroll_contract(
  p_player_id uuid,
  p_nonce text,
  p_instance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  inst public.contract_instances%rowtype;
  v_replay jsonb;
  v_progress jsonb;
  v_end timestamptz;
  v_used integer;
  v_cost bigint;
  v_free boolean;
  v_exclude text[];
  v_families text[];
  v_band_index integer;
  v_draw jsonb;
  v_terms jsonb;
  v_new_id uuid;
  v_seed text;
  v_result jsonb;
begin
  if p_player_id is null then raise exception 'Authentication required'; end if;
  if p_nonce is null or length(p_nonce) < 8 then raise exception 'A reroll nonce is required'; end if;

  perform pg_advisory_xact_lock(hashtext(p_player_id::text));

  select * into p from public.profiles where id = p_player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  select result_payload into v_replay from public.verified_action_ledger
   where user_id = p_player_id and idempotency_key = p_nonce
     and action_type = 'cc_reroll_contract';
  if v_replay is not null then return v_replay; end if;

  select * into inst from public.contract_instances where id = p_instance_id and user_id = p_player_id;
  if not found then raise exception 'Contract not found'; end if;
  if inst.status = 'claimed' then raise exception 'Claimed contracts cannot be rerolled'; end if;
  if inst.status = 'rerolled' then raise exception 'Contract already rerolled'; end if;

  v_end := (inst.period_key || 'T00:00:00Z')::timestamptz
    + (case when inst.period_kind = 'daily' then interval '1 day' else interval '7 days' end);
  if now() >= v_end then raise exception 'Contract expired — the window has closed'; end if;

  v_progress := public.cc_contract_progress(p_instance_id);
  if coalesce((v_progress ->> 'complete')::boolean, false) then
    raise exception 'Contract complete — claim it or let it expire';
  end if;

  select count(*) into v_used from public.contract_instances
   where user_id = p_player_id and period_kind = inst.period_kind
     and period_key = inst.period_key and status = 'rerolled';
  v_free := v_used < 1;
  if v_free then
    v_cost := 0;
  elsif inst.period_kind = 'daily' then
    v_cost := greatest(0, least(1000,
      public.cc_economy_config_number('contractRerollScrapDaily', 100)))::bigint;
  else
    v_cost := greatest(0, least(5000,
      public.cc_economy_config_number('contractRerollScrapWeekly', 400)))::bigint;
  end if;
  if v_cost > 0 and p.scrap < v_cost then
    raise exception 'Insufficient scrap for a reroll';
  end if;

  -- The set as it stands (current generation per slot), templates
  -- excluded wholesale; the family cap counts the OTHER members.
  select coalesce(array_agg(cur.template_id), '{}'::text[]),
         coalesce(array_agg(d.family) filter (where cur.slot <> inst.slot), '{}'::text[])
    into v_exclude, v_families
    from public.contract_instances cur
    join public.contract_template_definitions d on d.template_id = cur.template_id
   where cur.user_id = p_player_id
     and cur.period_kind = inst.period_kind
     and cur.period_key = inst.period_key
     and cur.generation = (
       select max(g.generation) from public.contract_instances g
        where g.user_id = cur.user_id and g.period_kind = cur.period_kind
          and g.period_key = cur.period_key and g.slot = cur.slot);

  select band_index into v_band_index from public.contract_bands where band_id = inst.band;

  v_seed := 'contracts:reroll:' || inst.period_kind || ':' || inst.period_key || ':'
    || p_player_id::text || ':' || inst.slot::text || ':' || (inst.generation + 1)::text;
  v_draw := public.cc_contract_draw_reroll(v_seed, inst.period_kind, v_band_index, v_exclude, v_families);
  if v_draw is null then raise exception 'No replacement contract available on this board'; end if;

  v_terms := public.cc_contract_terms(p_player_id, v_draw ->> 'template_id', inst.period_kind, v_band_index);

  if v_cost > 0 then
    update public.profiles set scrap = scrap - v_cost, updated_at = now() where id = p_player_id;
  end if;

  update public.contract_instances set status = 'rerolled' where id = p_instance_id;

  insert into public.contract_instances (
    user_id, period_kind, period_key, slot, generation, template_id, band,
    params, baseline, target, reward, status
  ) values (
    p_player_id, inst.period_kind, inst.period_key, inst.slot, inst.generation + 1,
    v_draw ->> 'template_id', inst.band, coalesce(v_draw -> 'params', '{}'::jsonb),
    v_terms -> 'baseline', (v_terms ->> 'target')::integer, v_terms -> 'reward', 'active'
  ) returning id into v_new_id;

  select * into p from public.profiles where id = p_player_id;

  v_result := jsonb_build_object(
    'action_type', 'cc_reroll_contract',
    'instance_id', v_new_id,
    'replaced_instance_id', inst.id,
    'template_id', v_draw ->> 'template_id',
    'period_kind', inst.period_kind,
    'period_key', inst.period_key,
    'scrap_charged', v_cost,
    'free_reroll', v_free,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger (user_id, action_type, idempotency_key, result_payload)
  values (p_player_id, 'cc_reroll_contract', p_nonce, v_result);

  return v_result;
end;
$$;
-- ---------------------------------------------------------------------
-- 5 (cont). The 0014 ledger trigger, restated with the three new
-- stats (generated from the 0014 body — the only edits are the
-- marked Contracts branches).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cc_apply_mastery_for_verified_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  profile_payload jsonb := coalesce(new.result_payload -> 'profile', '{}'::jsonb);
  reward_payload jsonb := coalesce(new.result_payload -> 'rewards', '{}'::jsonb);
  action text := new.action_type;
  amount bigint;
  won boolean;
  credits_value bigint;
  scrap_value bigint;
  net_worth_value bigint;
  consumed_map jsonb;
  consumable_type text;
  consumable_count integer;
begin
  perform public.cc_add_stat(new.user_id, 'actions.total', 1);
  perform public.cc_add_stat(new.user_id, 'actions.' || action, 1);

  if action in ('cc_make_item', 'cc_draw_item') then
    perform public.cc_add_stat(new.user_id, 'inventory.cache_draws', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.cache_draws', 30);
  elsif action in ('cc_recycle_item', 'cc_salvage_item') then
    amount := greatest(0, coalesce((new.result_payload ->> 'scrap_award')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'inventory.recycle.count', 1);
    perform public.cc_add_stat(new.user_id, 'inventory.scrap_generated', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.recycle', 25);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.scrap_generated', amount);
  elsif action = 'cc_vendor_buy' then
    amount := greatest(1, coalesce((new.result_payload ->> 'quantity')::bigint, 1));
    perform public.cc_add_stat(new.user_id, 'economy.vendor_buys', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.vendor_buys', amount * 15);
  elsif action = 'cc_market_create' then
    perform public.cc_add_stat(new.user_id, 'economy.market_listings', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.market_listings', 20);
  elsif action in ('cc_accept_listing', 'cc_market_transfer') then
    amount := greatest(0, coalesce((new.result_payload -> 'listing' ->> 'price_credits')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'economy.market_sales', 1);
    perform public.cc_add_stat(new.user_id, 'economy.trade_volume', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.market_sales', 50);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.trade_volume', amount);
  elsif action in ('cc_item_service_request', 'cc_item_service_accept') then
    perform public.cc_add_stat(new.user_id, 'services.jobs_touched', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'services.repair', 10);
  elsif action = 'cc_item_job_finish' then
    amount := greatest(0, coalesce((new.result_payload ->> 'price_credits')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'services.completed', 1);
    perform public.cc_add_stat(new.user_id, 'services.revenue', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'services.repair', 50 + amount);
  elsif action in ('cc_battle_result', 'cc_boss_attempt') then
    won := coalesce(new.result_payload -> 'draw' ->> 'outcome', '') = 'victory';
    perform public.cc_add_stat(new.user_id, 'combat.boss_attempts', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_attempts', 20);
    perform public.cc_add_mastery_xp(new.user_id, 'locations.dustwaste', 25);
    if won then
      perform public.cc_add_stat(new.user_id, 'combat.boss_defeats', 1);
      perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_defeats', 100);
    end if;
  elsif action = 'cc_repair_job_finish' then
    amount := round(coalesce((new.result_payload -> 'job' ->> 'points_restored')::numeric, 0))::bigint;
    if amount > 0 then
      perform public.cc_add_stat(new.user_id, 'services.points_restored', amount);
    end if;
  elsif action in ('cc_retrain', 'cc_skill_reset') then
    perform public.cc_add_stat(new.user_id, 'skills.retrain', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'skills.training', 25);
  elsif action = 'cc_idle_claim' then
    amount := greatest(0, coalesce((reward_payload ->> 'xp')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'combat.idle_xp_claimed', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'locations.dustwaste', greatest(1, amount));
  -- 0014: the shipped Chef flows. Same grant rules as the legacy
  -- branches above, fed the shipped payload keys and the real
  -- area / equipped weapon instead of a hardcoded Dustwaste.
  elsif action = 'cc_apply_chef_rewards' then
    amount := greatest(0, coalesce((reward_payload ->> 'xp_awarded')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'combat.idle_xp_claimed', amount);
    perform public.cc_add_mastery_xp_if_defined(
      new.user_id,
      public.cc_location_mastery_id(new.result_payload ->> 'area_id'),
      greatest(1, amount)
    );
    perform public.cc_add_mastery_xp_if_defined(
      new.user_id,
      public.cc_equipped_weapon_mastery_id(new.user_id),
      amount
    );
  elsif action = 'cc_settle_offline_roaming' then
    amount := greatest(0, coalesce((reward_payload ->> 'xp_awarded')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'combat.idle_xp_claimed', amount);
    perform public.cc_add_mastery_xp_if_defined(
      new.user_id,
      public.cc_location_mastery_id(new.result_payload ->> 'area_id'),
      greatest(1, amount)
    );
    perform public.cc_add_mastery_xp_if_defined(
      new.user_id,
      public.cc_equipped_weapon_mastery_id(new.user_id),
      amount
    );
  elsif action = 'cc_apply_boss_attempt' then
    won := coalesce((new.result_payload -> 'attempt' ->> 'victory')::boolean, false);
    perform public.cc_add_stat(new.user_id, 'combat.boss_attempts', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_attempts', 20);
    if won then
      perform public.cc_add_stat(new.user_id, 'combat.boss_defeats', 1);
      perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_defeats', 100);
    end if;
    -- No location grant: bosses have no area in the data model.
    amount := greatest(0, coalesce((new.result_payload ->> 'xp_awarded')::bigint, 0));
    perform public.cc_add_mastery_xp_if_defined(
      new.user_id,
      public.cc_equipped_weapon_mastery_id(new.user_id),
      amount
    );
  end if;

  -- Consumable usage mastery (from roaming claims)
-- Contracts (0042): roaming kills join the standing stats from the
  -- same rewards payload key the economy fold already reads.
  if action in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming') then
    amount := greatest(0, coalesce((reward_payload ->> 'kills_recorded')::bigint, 0));
    if amount > 0 then
      perform public.cc_add_stat(new.user_id, 'combat.roaming_kills', amount);
    end if;
  end if;

  consumed_map := coalesce(new.result_payload -> 'consumedConsumables', '{}'::jsonb);
  -- 0014: the shipped flows carry consumption under their own keys —
  -- boss attempts as consumed_batches (one batch wrapper per type,
  -- summed here per type) and offline settlements as
  -- consumed_consumables. Translate both into the type -> count map
  -- the grants below already understand.
  if action = 'cc_apply_boss_attempt' then
    select coalesce(jsonb_object_agg(per_type.consumable_type, per_type.total), '{}'::jsonb)
      into consumed_map
      from (
        select entry ->> 'consumable_type' as consumable_type,
               sum((entry ->> 'quantity')::integer) as total
          from jsonb_array_elements(coalesce(new.result_payload -> 'consumed_batches', '[]'::jsonb)) as wrapper,
               jsonb_array_elements(coalesce(wrapper -> 'consumed', '[]'::jsonb)) as entry
         group by entry ->> 'consumable_type'
      ) per_type;
    if consumed_map is null then
      consumed_map := '{}'::jsonb;
    end if;
  elsif action = 'cc_settle_offline_roaming' then
    consumed_map := coalesce(new.result_payload -> 'consumed_consumables', '{}'::jsonb);
  end if;
  if consumed_map <> '{}'::jsonb then
    for consumable_type, consumable_count in select key, value::integer from jsonb_each_text(consumed_map)
    loop
      if consumable_count > 0 then
        perform public.cc_add_mastery_xp(new.user_id, 'consumable.efficiency', consumable_count * 10);
      perform public.cc_add_stat(new.user_id, 'consumables.used', consumable_count);
        -- Ordnance family gets combat.ordnance mastery
        if consumable_type like 'Ordnance%'
           or consumable_type like 'EMP%'
           or consumable_type like 'Corrosive%'
           or consumable_type like 'Magnetized%'
           or consumable_type like 'PhaseShift%'
           or consumable_type like 'Void%'
        then
          perform public.cc_add_mastery_xp(new.user_id, 'combat.ordnance', consumable_count * 10);
        end if;
      end if;
    end loop;
  end if;

  if profile_payload ? 'credits' then
    credits_value := greatest(0, coalesce((profile_payload ->> 'credits')::bigint, 0));
    scrap_value := greatest(0, coalesce((profile_payload ->> 'scrap')::bigint, 0));
    net_worth_value := credits_value + scrap_value;
    perform public.cc_set_stat(new.user_id, 'account.net_worth', net_worth_value);
    perform public.cc_set_mastery_xp(new.user_id, 'account.net_worth', net_worth_value);
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- 5 (cont). cc_complete_craft_unit, restated from its 0031 body
-- with ONE added line: repair-unit completions record
-- services.points_restored for the mechanic (the craft settler
-- writes no ledger row, so the unit function carries the stat).
-- ---------------------------------------------------------------------
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
      perform public.cc_add_stat(actor, 'services.points_restored', round(v_restored)::bigint);
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

-- ---------------------------------------------------------------------
-- 6 (cont). New economy_metrics columns + cc_compute_economy_metrics
-- restated from its 0037 body with the contract folds.
-- ---------------------------------------------------------------------
alter table public.economy_metrics
  add column if not exists credits_minted_contracts bigint not null default 0,
  add column if not exists contracts_claimed integer not null default 0,
  add column if not exists contracts_expired_unclaimed integer not null default 0,
  add column if not exists contract_rerolls integer not null default 0,
  add column if not exists contract_keys_awarded integer not null default 0,
  add column if not exists scrap_destroyed_contract_rerolls bigint not null default 0;

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
    count(*) filter (where action_type = 'cc_make_item' and coalesce(result_payload ->> 'payment', 'key') = 'free') as cache_boxes_opened_free,
    count(*) filter (where action_type = 'cc_make_item' and coalesce(result_payload ->> 'payment', 'key') = 'ad') as cache_boxes_opened_ad,
    count(*) filter (where action_type = 'cc_make_item' and coalesce(result_payload ->> 'payment', 'key') = 'key') as cache_boxes_opened_key,
    coalesce(sum((result_payload ->> 'cache_keys_awarded')::bigint)
      filter (where action_type = 'cc_leaderboard_settlement'), 0) as cache_keys_from_leaderboards,
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
     + count(*) filter (where action_type = 'cc_fire_overclock_workshop')) as action_skill_fires_fixer,
    -- Dispatch meters (0032): foot + courier settle payouts — real
    -- mints from the cc_dispatch_settle ledger payloads (recalls
    -- included: a pro-rata payout is still a payout). The courier
    -- column is the premium family's breakout of the same fold.
    coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
      filter (where action_type = 'cc_dispatch_settle'
        and result_payload ->> 'family' = 'foot'), 0) as minted_dispatch,
    coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
      filter (where action_type = 'cc_dispatch_settle'
        and result_payload ->> 'family' = 'courier'), 0) as minted_courier,
    coalesce(sum((result_payload ->> 'passes_completed')::bigint)
      filter (where action_type = 'cc_apply_extraction'), 0) as extraction_passes,
    coalesce(sum((result_payload ->> 'xp_awarded')::bigint)
      filter (where action_type = 'cc_apply_extraction'), 0) as extraction_xp,
    -- Login streak (0036): the day's cc_login_streak_claim grants.
    -- Credits are a real faucet and fold into the minted total
    -- below; fragments and keys are metered as their own sources,
    -- distinct from roaming fragments, leaderboard keys, and
    -- ad-lane key issuance.
    coalesce(sum((result_payload ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_login_streak_claim'), 0) as minted_login_streak,
    coalesce(sum((result_payload ->> 'fragments_awarded')::bigint)
      filter (where action_type = 'cc_login_streak_claim'), 0) as fragments_login_streak,
    coalesce(sum((result_payload ->> 'cache_keys_awarded')::bigint)
      filter (where action_type = 'cc_login_streak_claim'), 0) as keys_login_streak,
      coalesce(sum((result_payload ->> 'credits_awarded')::bigint)
        filter (where action_type in ('cc_claim_contract_reward', 'cc_claim_contract_set_bonus')), 0) as minted_contracts,
      coalesce(count(*)
        filter (where action_type = 'cc_claim_contract_reward'), 0) as contracts_claimed,
      coalesce(count(*)
        filter (where action_type = 'cc_reroll_contract'), 0) as contract_rerolls,
      coalesce(sum((result_payload ->> 'scrap_charged')::bigint)
        filter (where action_type = 'cc_reroll_contract'), 0) as scrap_destroyed_contract_rerolls,
      coalesce(sum((result_payload ->> 'cache_keys_awarded')::bigint)
        filter (where action_type = 'cc_claim_contract_set_bonus'), 0) as contract_keys_awarded,
      (select count(*) from public.contract_instances ci
        where ci.status = 'active'
          and ((ci.period_kind = 'daily' and ci.period_key = (_day - 1)::text)
            or (ci.period_kind = 'weekly' and ci.period_key = (_day - 7)::text))) as contracts_expired_unclaimed
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
    + m.endless_credits_paid + m.minted_dispatch + m.minted_courier
    + m.minted_login_streak
    + m.minted_contracts;
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
    cache_keys_from_ads, cache_keys_from_leaderboards, cache_opens, cache_fragments_awarded,
    cache_boxes_opened_free, cache_boxes_opened_ad, cache_boxes_opened_key,
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
    credits_minted_dispatch, credits_minted_courier,
    extraction_passes, extraction_xp_awarded, materials_minted_extraction,
    credits_minted_login_streak, cache_fragments_from_login_streak,
    cache_keys_from_login_streak,
    credits_minted_contracts, contracts_claimed, contracts_expired_unclaimed,
    contract_rerolls, contract_keys_awarded, scrap_destroyed_contract_rerolls,
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
    m.cache_keys_from_ads, m.cache_keys_from_leaderboards, m.cache_opens, m.cache_fragments_awarded,
    m.cache_boxes_opened_free, m.cache_boxes_opened_ad, m.cache_boxes_opened_key,
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
    m.minted_dispatch, m.minted_courier,
    m.extraction_passes::integer, m.extraction_xp,
    (select coalesce(jsonb_object_agg(key, total), '{}'::jsonb)
       from (
         select f.key, sum((f.value)::bigint) as total
           from public.verified_action_ledger l,
                jsonb_each_text(
                  coalesce(l.result_payload -> 'finds_materials', '{}'::jsonb)
                  || coalesce(l.result_payload -> 'finds_essences', '{}'::jsonb)) as f
          where l.action_type = 'cc_apply_extraction'
            and l.created_at >= v_start and l.created_at < v_end
          group by f.key
         having sum((f.value)::bigint) > 0
       ) minted),
    m.minted_login_streak, m.fragments_login_streak, m.keys_login_streak::integer,
    m.minted_contracts, m.contracts_claimed::integer, m.contracts_expired_unclaimed::integer,
    m.contract_rerolls::integer, m.contract_keys_awarded::integer, m.scrap_destroyed_contract_rerolls,
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
    cache_keys_from_leaderboards = excluded.cache_keys_from_leaderboards,
    cache_opens = excluded.cache_opens,
    cache_fragments_awarded = excluded.cache_fragments_awarded,
    cache_boxes_opened_free = excluded.cache_boxes_opened_free,
    cache_boxes_opened_ad = excluded.cache_boxes_opened_ad,
    cache_boxes_opened_key = excluded.cache_boxes_opened_key,
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
    credits_minted_dispatch = excluded.credits_minted_dispatch,
    credits_minted_courier = excluded.credits_minted_courier,
    extraction_passes = excluded.extraction_passes,
    extraction_xp_awarded = excluded.extraction_xp_awarded,
    materials_minted_extraction = excluded.materials_minted_extraction,
    credits_minted_login_streak = excluded.credits_minted_login_streak,
    cache_fragments_from_login_streak = excluded.cache_fragments_from_login_streak,
    cache_keys_from_login_streak = excluded.cache_keys_from_login_streak,
    credits_minted_contracts = excluded.credits_minted_contracts,
    contracts_claimed = excluded.contracts_claimed,
    contracts_expired_unclaimed = excluded.contracts_expired_unclaimed,
    contract_rerolls = excluded.contract_rerolls,
    contract_keys_awarded = excluded.contract_keys_awarded,
    scrap_destroyed_contract_rerolls = excluded.scrap_destroyed_contract_rerolls,
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;$$;
