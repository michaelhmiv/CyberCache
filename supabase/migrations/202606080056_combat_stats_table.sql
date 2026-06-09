-- Migration 056: combat_stats table
--
-- Per-profile combat statistics. Lives as a separate normalized table
-- (rather than JSONB on profiles) so future analytics queries (top areas
-- by kills, weapon-type distribution, boss progression rates) are cheap
-- and the row updates don't have to rewrite the entire runtime_state blob.
--
-- The hydrate path is: client slice writes the whole row on every save;
-- server upserts via the application user (RLS enabled). The client also
-- keeps a runtime copy in the combatStatsSlice so React can read
-- synchronously.

create table if not exists public.combat_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_kills integer not null default 0,
  total_deaths integer not null default 0,
  longest_kill_streak integer not null default 0,
  last_kill_at timestamptz,
  run_started_at timestamptz,
  kills_by_area jsonb not null default '{}'::jsonb,
  kills_by_weapon_type jsonb not null default '{}'::jsonb,
  kills_by_boss jsonb not null default '{}'::jsonb,
  kills_by_element jsonb not null default '{}'::jsonb,
  highest_boss_tier integer not null default 0,
  active_play_seconds integer not null default 0,
  idle_play_seconds integer not null default 0,
  updated_at timestamptz not null default now()
);

-- RLS: each user can read and write their own row.
alter table public.combat_stats enable row level security;

create policy "combat_stats_select_own"
  on public.combat_stats
  for select
  using (auth.uid() = user_id);

create policy "combat_stats_insert_own"
  on public.combat_stats
  for insert
  with check (auth.uid() = user_id);

create policy "combat_stats_update_own"
  on public.combat_stats
  for update
  using (auth.uid() = user_id);

-- Indexes for the analytics queries the dashboard may run.
create index if not exists combat_stats_total_kills_idx
  on public.combat_stats (total_kills desc);

create index if not exists combat_stats_highest_boss_tier_idx
  on public.combat_stats (highest_boss_tier desc);
