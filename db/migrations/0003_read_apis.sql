-- Route B, slice B2: read-side game schema + read functions on plain
-- Postgres (Railway). Ports the final state of the Supabase migrations
-- that the read surface depends on (B0 rehearsal: the source migrations
-- apply cleanly; this file consolidates their end state, minus RLS and
-- minus every auth.uid()).
--
-- What lands here:
-- * The game tables the read APIs need, at their final migrated shape:
--   profiles, item_instances, market_listings,
--   player_progression_snapshots, mastery_definitions,
--   player_stat_counters, player_masteries, combat_stats,
--   username_reservations. Write-side tables/functions land additively
--   in B3 under the same if-not-exists style.
-- * The player_public_stats view, ported verbatim.
-- * The cc_* read functions. Authorization used to be RLS + auth.uid();
--   here the Chef is the only caller (service connection) and identity is
--   an explicit p_player_id parameter, resolved by the Chef from the
--   verified JWT. Functions that already took an explicit target id
--   (cc_get_public_profile, cc_public_stats, cc_mastery_leaderboard,
--   cc_is_username_available, cc_get_leaderboard) keep their signatures.
--
-- profiles.id references auth_accounts(id): the account id minted by the
-- B1 identity layer IS the player id everywhere (0001_auth.sql).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables (final migrated state; no RLS — Chef scoping replaces it)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth_accounts(id) on delete cascade,
  username text unique,
  display_name text,
  player_level integer not null default 1 check (player_level >= 1),
  player_xp bigint not null default 0 check (player_xp >= 0),
  credits bigint not null default 0 check (credits >= 0),
  scrap bigint not null default 0,
  cache_tokens integer not null default 0,
  cache_token_parts integer not null default 0,
  materials jsonb not null default '{}'::jsonb,
  essences jsonb not null default '{}'::jsonb,
  consumables jsonb not null default '{}'::jsonb,
  skill_spends jsonb not null default '{}'::jsonb,
  boss_state jsonb not null default '{}'::jsonb,
  last_idle_claim_at timestamptz not null default now(),
  last_claimed_tick bigint not null default 0,
  last_roaming_settled_at timestamptz,
  last_settlement_nonce text,
  offline_cap_hours numeric not null default 2,
  account_type text not null default 'guest'
    check (account_type in ('guest', 'registered_unverified', 'verified')),
  email text,
  email_verified_at timestamptz,
  verification_grace_expires_at timestamptz,
  verification_reminder_last_seen_at timestamptz,
  username_updated_at timestamptz,
  username_change_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_profiles_username_lower_unique
  on public.profiles (lower(trim(username)))
  where username is not null;

create index if not exists idx_profiles_username_lookup
  on public.profiles (lower(trim(username)));

create table if not exists public.item_instances (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  static_item_id text,
  item_level integer check (item_level is null or item_level >= 1),
  rarity text,
  quality text,
  material_tier text,
  condition_state text,
  condition_current numeric,
  condition_max numeric,
  supply_mode text not null,
  source_id text,
  creator_user_id uuid references public.profiles(id) on delete set null,
  tradeable boolean not null default true,
  account_bound boolean not null default false,
  locked_until timestamptz,
  payload jsonb not null default '{}'::jsonb,
  runtime_state text not null default 'available',
  is_locked boolean not null default false,
  equipped_slot text,
  estimated_value bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (account_bound and tradeable))
);

create index if not exists item_instances_owner_idx on public.item_instances(owner_user_id);
create index if not exists item_instances_tradeable_idx on public.item_instances(tradeable, account_bound, kind);
create index if not exists idx_item_instances_owner_kind on public.item_instances(owner_user_id, kind);
create index if not exists idx_item_instances_owner_rarity on public.item_instances(owner_user_id, rarity);

create table if not exists public.market_listings (
  id uuid primary key default gen_random_uuid(),
  seller_user_id uuid not null references public.profiles(id) on delete cascade,
  item_instance_id uuid not null references public.item_instances(id) on delete restrict,
  price_credits bigint not null check (price_credits > 0),
  status text not null default 'active',
  listed_at timestamptz not null default now(),
  sold_at timestamptz,
  check (status in ('active', 'sold', 'cancelled', 'expired'))
);

create index if not exists market_listings_status_idx on public.market_listings(status, listed_at desc);

create table if not exists public.player_progression_snapshots (
  id bigint generated always as identity primary key,
  player_id uuid not null references auth_accounts(id) on delete cascade,
  snapshot_at timestamptz not null default now(),
  source text not null,
  snapshot_version int not null default 1,
  level int,
  xp bigint,
  credits bigint,
  scrap bigint,
  total_kills bigint,
  total_deaths bigint,
  net_worth bigint,
  total_items int,
  weapons_owned int,
  legendary_items int,
  highest_item_level int,
  total_mastery_xp bigint,
  highest_mastery_level int,
  highest_boss_tier int,
  active_action text,
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_player_progression_snapshots_player_time
  on public.player_progression_snapshots (player_id, snapshot_at desc);
create index if not exists idx_player_progression_snapshots_source_time
  on public.player_progression_snapshots (source, snapshot_at desc);
create index if not exists idx_player_progression_snapshots_metric_time
  on public.player_progression_snapshots (snapshot_at desc)
  include (player_id, level, xp, net_worth, total_kills, total_deaths, highest_boss_tier, total_mastery_xp, highest_mastery_level, legendary_items, total_items);

create table if not exists public.mastery_definitions (
  id text primary key,
  category text not null,
  label text not null,
  description text not null default '',
  unit_label text not null default 'XP',
  xp_per_unit integer not null default 1 check (xp_per_unit > 0),
  is_ranked boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_stat_counters (
  user_id uuid not null references public.profiles(id) on delete cascade,
  stat_key text not null,
  stat_value bigint not null default 0 check (stat_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, stat_key)
);

create table if not exists public.player_masteries (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mastery_id text not null references public.mastery_definitions(id) on delete cascade,
  mastery_xp bigint not null default 0 check (mastery_xp >= 0),
  mastery_level integer not null default 1 check (mastery_level >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, mastery_id)
);

create index if not exists player_stat_counters_key_value_idx on public.player_stat_counters(stat_key, stat_value desc);
create index if not exists player_masteries_mastery_xp_idx on public.player_masteries(mastery_id, mastery_xp desc);
create index if not exists idx_player_masteries_user on public.player_masteries(user_id);
create index if not exists idx_player_stat_counters_user_key on public.player_stat_counters(user_id, stat_key);

create table if not exists public.combat_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  total_kills bigint not null default 0 check (total_kills >= 0),
  total_deaths bigint not null default 0 check (total_deaths >= 0),
  longest_kill_streak bigint not null default 0 check (longest_kill_streak >= 0),
  last_kill_at timestamptz,
  run_started_at timestamptz,
  kills_by_area jsonb not null default '{}'::jsonb,
  kills_by_weapon_type jsonb not null default '{}'::jsonb,
  kills_by_boss jsonb not null default '{}'::jsonb,
  kills_by_element jsonb not null default '{}'::jsonb,
  highest_boss_tier integer not null default 0 check (highest_boss_tier >= 0),
  active_play_seconds bigint not null default 0 check (active_play_seconds >= 0),
  idle_play_seconds bigint not null default 0 check (idle_play_seconds >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.username_reservations (
  username text primary key
);

insert into public.username_reservations (username)
values
  ('admin'), ('administrator'), ('mod'), ('moderator'),
  ('system'), ('support'), ('help'), ('null'),
  ('guest'), ('anonymous'), ('cybercache'), ('nousresearch')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Public stats projection (ported verbatim from 20260614170000)
-- One row per player: economy/combat/collection aggregates. This is the
-- exact field set cc_public_stats exposes to any authenticated caller
-- today; the Chef routes return no more than this.
-- ---------------------------------------------------------------------------

create or replace view public.player_public_stats as
select
  p.id as user_id,
  p.username,
  p.display_name,
  p.player_level,
  p.player_xp,
  p.credits,
  p.scrap,
  p.cache_tokens,
  p.cache_token_parts,
  coalesce(c.total_kills, 0) as total_kills,
  coalesce(c.total_deaths, 0) as total_deaths,
  (coalesce(c.total_kills, 0)::numeric / nullif(c.total_deaths, 0)::numeric) as kill_death_ratio,
  coalesce(c.highest_boss_tier, 0) as highest_boss_tier,
  coalesce(c.longest_kill_streak, 0) as longest_kill_streak,
  coalesce(c.active_play_seconds, 0) as active_play_seconds,
  coalesce(c.idle_play_seconds, 0) as idle_play_seconds,
  coalesce(c.kills_by_area, '{}'::jsonb) as kills_by_area,
  coalesce(c.kills_by_weapon_type, '{}'::jsonb) as kills_by_weapon_type,
  coalesce(c.kills_by_element, '{}'::jsonb) as kills_by_element,
  coalesce(psc.stat_value, 0) as net_worth,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id) as total_items,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.kind = 'weapon') as weapons_owned,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.rarity = 'Legendary') as legendary_items,
  (select coalesce(max(ii.item_level), 0) from public.item_instances ii where ii.owner_user_id = p.id) as highest_item_level,
  (select coalesce(sum(pm.mastery_xp), 0) from public.player_masteries pm where pm.user_id = p.id) as total_mastery_xp,
  (select coalesce(max(pm.mastery_level), 0) from public.player_masteries pm where pm.user_id = p.id) as highest_mastery_level,
  p.updated_at as last_active_at,
  p.created_at as joined_at
from public.profiles p
left join public.combat_stats c on c.user_id = p.id
left join public.player_stat_counters psc on psc.user_id = p.id and psc.stat_key = 'account.net_worth';

-- ---------------------------------------------------------------------------
-- Read functions
-- ---------------------------------------------------------------------------

-- Caller's own stats row (was cc_my_stats_summary() with auth.uid()).
create or replace function public.cc_my_stats_summary(p_player_id uuid)
returns public.player_public_stats
language sql
stable
set search_path = public
as $$
  select *
  from public.player_public_stats
  where user_id = p_player_id
  limit 1;
$$;

-- Any player's public stats row (signature unchanged; already explicit).
create or replace function public.cc_public_stats(_user_id uuid)
returns public.player_public_stats
language sql
stable
set search_path = public
as $$
  select *
  from public.player_public_stats
  where user_id = _user_id
  limit 1;
$$;

-- Public profile subset (signature unchanged; already explicit). Returns
-- only the public-facing fields — no credits, scrap, or wallet details.
create or replace function public.cc_get_public_profile(_player_id uuid)
returns table (
  player_id uuid,
  username text,
  display_name text,
  level int,
  xp bigint,
  net_worth bigint,
  total_kills bigint,
  total_deaths bigint,
  kill_death_ratio numeric,
  highest_boss_tier int,
  total_mastery_xp bigint,
  highest_mastery_level int,
  legendary_items int,
  total_items int,
  weapons_owned int,
  highest_item_level int,
  joined_at timestamptz,
  last_active_at timestamptz
)
language plpgsql
stable
set search_path = public
as $$
begin
  return query
  select
    s.user_id,
    s.username,
    s.display_name,
    s.player_level::int,
    s.player_xp::bigint,
    s.net_worth::bigint,
    s.total_kills::bigint,
    s.total_deaths::bigint,
    s.kill_death_ratio::numeric,
    s.highest_boss_tier::int,
    s.total_mastery_xp::bigint,
    s.highest_mastery_level::int,
    s.legendary_items::int,
    s.total_items::int,
    s.weapons_owned::int,
    s.highest_item_level::int,
    s.joined_at,
    s.last_active_at
  from public.player_public_stats s
  where s.user_id = _player_id;
end;
$$;

-- Global leaderboard over progression snapshots (ported verbatim from
-- 20260615120000; it never used auth.uid()).
create or replace function public.cc_get_leaderboard(
  _metric text,
  _period text default 'all_time',
  _limit int default 100
)
returns table (
  rank bigint,
  player_id uuid,
  username text,
  value numeric,
  previous_value numeric,
  trend numeric
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_min_time timestamptz;
  v_metric text;
begin
  if _metric not in ('level', 'xp', 'net_worth', 'total_kills', 'kdr', 'highest_boss_tier', 'total_mastery_xp', 'highest_mastery_level', 'legendary_items', 'total_items') then
    raise exception 'Invalid leaderboard metric: %', _metric;
  end if;

  if _period = 'all_time' then
    v_min_time := '1970-01-01'::timestamptz;
  elsif _period = 'weekly' then
    v_min_time := now() - interval '7 days';
  elsif _period = 'daily' then
    v_min_time := now() - interval '1 day';
  else
    raise exception 'Invalid leaderboard period: %', _period;
  end if;

  v_metric := _metric;

  return query
  with latest as (
    select distinct on (s.player_id)
      s.player_id,
      s.level,
      s.xp,
      s.net_worth,
      s.total_kills,
      s.total_deaths,
      s.highest_boss_tier,
      s.total_mastery_xp,
      s.highest_mastery_level,
      s.legendary_items,
      s.total_items,
      s.snapshot_at
    from public.player_progression_snapshots s
    where s.snapshot_at >= v_min_time
    order by s.player_id, s.snapshot_at desc
  ),
  prior as (
    select distinct on (s.player_id)
      s.player_id,
      s.level,
      s.xp,
      s.net_worth,
      s.total_kills,
      s.total_deaths,
      s.highest_boss_tier,
      s.total_mastery_xp,
      s.highest_mastery_level,
      s.legendary_items,
      s.total_items
    from public.player_progression_snapshots s
    where s.snapshot_at < v_min_time
    order by s.player_id, s.snapshot_at desc
  ),
  selected as (
    select
      l.player_id,
      p.username,
      case v_metric
        when 'level' then l.level::numeric
        when 'xp' then l.xp::numeric
        when 'net_worth' then l.net_worth::numeric
        when 'total_kills' then l.total_kills::numeric
        when 'kdr' then (l.total_kills::numeric / nullif(l.total_deaths, 0)::numeric)
        when 'highest_boss_tier' then l.highest_boss_tier::numeric
        when 'total_mastery_xp' then l.total_mastery_xp::numeric
        when 'highest_mastery_level' then l.highest_mastery_level::numeric
        when 'legendary_items' then l.legendary_items::numeric
        when 'total_items' then l.total_items::numeric
      end as current_value,
      case v_metric
        when 'level' then pr.level::numeric
        when 'xp' then pr.xp::numeric
        when 'net_worth' then pr.net_worth::numeric
        when 'total_kills' then pr.total_kills::numeric
        when 'kdr' then (pr.total_kills::numeric / nullif(pr.total_deaths, 0)::numeric)
        when 'highest_boss_tier' then pr.highest_boss_tier::numeric
        when 'total_mastery_xp' then pr.total_mastery_xp::numeric
        when 'highest_mastery_level' then pr.highest_mastery_level::numeric
        when 'legendary_items' then pr.legendary_items::numeric
        when 'total_items' then pr.total_items::numeric
      end as previous_value
    from latest l
    join public.profiles p on p.id = l.player_id
    left join prior pr on pr.player_id = l.player_id
  )
  select
    row_number() over (order by s.current_value desc nulls last)::bigint as rank,
    s.player_id,
    s.username,
    s.current_value as value,
    s.previous_value,
    case
      when s.previous_value is null or s.previous_value = 0 then 0
      else ((s.current_value - s.previous_value) / s.previous_value)::numeric
    end as trend
  from selected s
  where s.current_value is not null
  order by s.current_value desc nulls last
  limit _limit;
end;
$$;

-- Caller's own leaderboard rank (was cc_get_my_leaderboard_rank with
-- auth.uid(); the player id is now explicit).
create or replace function public.cc_get_my_leaderboard_rank(
  p_player_id uuid,
  _metric text,
  _period text default 'all_time'
)
returns table (
  rank bigint,
  value numeric,
  previous_value numeric,
  trend numeric,
  total_players bigint
)
language plpgsql
stable
set search_path = public
as $$
begin
  return query
  with board as (
    select * from public.cc_get_leaderboard(_metric, _period, 100000)
  )
  select
    b.rank,
    b.value,
    b.previous_value,
    b.trend,
    (select count(*)::bigint from board) as total_players
  from board b
  where b.player_id = p_player_id;
end;
$$;

-- Caller's own mastery summary (was cc_my_mastery_summary() with auth.uid()).
create or replace function public.cc_my_mastery_summary(p_player_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(summary_rows)), '[]'::jsonb)
  from (
    select
      pm.mastery_id,
      md.category,
      md.label,
      pm.mastery_xp,
      pm.mastery_level,
      1 + (
        select count(*)
        from public.player_masteries other
        where other.mastery_id = pm.mastery_id
          and other.mastery_xp > pm.mastery_xp
      ) as rank
    from public.player_masteries pm
    join public.mastery_definitions md on md.id = pm.mastery_id
    where pm.user_id = p_player_id
    order by md.category, pm.mastery_xp desc
  ) summary_rows;
$$;

-- Per-mastery leaderboard (signature unchanged; already explicit).
create or replace function public.cc_mastery_leaderboard(target_mastery_id text, limit_count integer default 25)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(board_rows)), '[]'::jsonb)
  from (
    select
      rank() over (order by pm.mastery_xp desc) as rank,
      pm.user_id,
      coalesce(p.display_name, p.username, 'Vault Runner') as display_name,
      pm.mastery_id,
      pm.mastery_xp,
      pm.mastery_level
    from public.player_masteries pm
    join public.profiles p on p.id = pm.user_id
    join public.mastery_definitions md on md.id = pm.mastery_id
    where pm.mastery_id = target_mastery_id
      and md.is_ranked = true
      and md.is_active = true
    order by pm.mastery_xp desc
    limit greatest(1, least(100, coalesce(limit_count, 25)))
  ) board_rows;
$$;

-- Username validation (ported verbatim from 20260614190000; no identity).
create or replace function public.cc_validate_username(_username text)
returns table (
  ok boolean,
  error text
)
language plpgsql
stable
set search_path = public
as $$
declare
  cleaned text;
begin
  if _username is null then
    return query select false, 'Username is required.';
    return;
  end if;

  cleaned := lower(trim(_username));

  if length(cleaned) < 3 then
    return query select false, 'Username must be at least 3 characters.';
    return;
  end if;

  if length(cleaned) > 24 then
    return query select false, 'Username must be 24 characters or fewer.';
    return;
  end if;

  if cleaned ~ '[^a-z0-9_-]' then
    return query select false, 'Username can only use letters, numbers, underscores, and hyphens.';
    return;
  end if;

  if exists (select 1 from public.username_reservations where username = cleaned) then
    return query select false, 'That username is reserved.';
    return;
  end if;

  return query select true, null::text;
end;
$$;

-- Username availability (ported verbatim; no identity).
create or replace function public.cc_is_username_available(_username text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_ok boolean;
  v_error text;
  cleaned text;
begin
  select * into v_ok, v_error from public.cc_validate_username(_username);
  if not v_ok then
    return false;
  end if;

  cleaned := lower(trim(_username));
  return not exists (
    select 1 from public.profiles
    where lower(trim(username)) = cleaned
  );
end;
$$;

-- Caller's own profile summary (was cc_my_profile_summary() with auth.uid()).
create or replace function public.cc_my_profile_summary(p_player_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'account_type', p.account_type,
    'has_username', p.username is not null,
    'username_updated_at', p.username_updated_at,
    'can_rename_at', p.username_updated_at + interval '7 days'
  )
  from public.profiles p
  where p.id = p_player_id;
$$;
