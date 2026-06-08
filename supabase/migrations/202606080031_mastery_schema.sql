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

alter table public.mastery_definitions enable row level security;
alter table public.player_stat_counters enable row level security;
alter table public.player_masteries enable row level security;

drop policy if exists "mastery_definitions_select" on public.mastery_definitions;
drop policy if exists "player_stat_counters_select_own" on public.player_stat_counters;
drop policy if exists "player_masteries_select_own" on public.player_masteries;

create policy "mastery_definitions_select" on public.mastery_definitions for select to authenticated using (is_active = true);
create policy "player_stat_counters_select_own" on public.player_stat_counters for select to authenticated using ((select auth.uid()) = user_id);
create policy "player_masteries_select_own" on public.player_masteries for select to authenticated using ((select auth.uid()) = user_id);

create index if not exists player_stat_counters_key_value_idx on public.player_stat_counters(stat_key, stat_value desc);
create index if not exists player_masteries_mastery_xp_idx on public.player_masteries(mastery_id, mastery_xp desc);
