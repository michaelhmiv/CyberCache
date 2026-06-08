-- Persist client runtime state in Supabase so refreshes and device changes do not fall back to browser storage.

create table if not exists public.player_runtime_snapshots (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version >= 1),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists player_runtime_snapshots_updated_idx on public.player_runtime_snapshots(updated_at desc);

alter table public.player_runtime_snapshots enable row level security;

drop policy if exists "runtime_snapshots_select_own" on public.player_runtime_snapshots;
drop policy if exists "runtime_snapshots_insert_own" on public.player_runtime_snapshots;
drop policy if exists "runtime_snapshots_update_own" on public.player_runtime_snapshots;
drop policy if exists "runtime_snapshots_delete_own" on public.player_runtime_snapshots;

create policy "runtime_snapshots_select_own" on public.player_runtime_snapshots
  for select using (auth.uid() = user_id);

create policy "runtime_snapshots_insert_own" on public.player_runtime_snapshots
  for insert with check (auth.uid() = user_id);

create policy "runtime_snapshots_update_own" on public.player_runtime_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "runtime_snapshots_delete_own" on public.player_runtime_snapshots
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.player_runtime_snapshots to authenticated;
grant all on public.player_runtime_snapshots to service_role;

comment on table public.player_runtime_snapshots is 'Per-user runtime store snapshots used to hydrate CyberCache session state from Supabase.';
