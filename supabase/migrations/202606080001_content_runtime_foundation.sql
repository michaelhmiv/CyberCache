-- CyberCache runtime foundation
-- Static gameplay content lives in src/content. These tables store player-owned runtime state only.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  player_level integer not null default 1 check (player_level >= 1),
  player_xp bigint not null default 0 check (player_xp >= 0),
  credits bigint not null default 0 check (credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (account_bound and tradeable))
);

create table if not exists public.player_professions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  profession_id text not null,
  level integer not null default 1 check (level >= 1 and level <= 100),
  xp bigint not null default 0 check (xp >= 0),
  total_crafts bigint not null default 0 check (total_crafts >= 0),
  total_services_completed bigint not null default 0 check (total_services_completed >= 0),
  reputation_score numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, profession_id)
);

create table if not exists public.active_actions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  active_action text not null default 'none',
  started_at timestamptz,
  completes_at timestamptz,
  target_id text,
  notes text,
  updated_at timestamptz not null default now()
);

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

create table if not exists public.escrow_records (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'reserved',
  payer_user_id uuid not null references public.profiles(id) on delete cascade,
  payee_user_id uuid references public.profiles(id) on delete set null,
  credit_amount bigint not null default 0 check (credit_amount >= 0),
  locked_item_instance_ids uuid[] not null default '{}',
  locked_material_instance_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  released_at timestamptz,
  check (status in ('none', 'reserved', 'locked', 'released', 'refunded', 'disputed'))
);

create table if not exists public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  provider_user_id uuid references public.profiles(id) on delete set null,
  profession_id text not null,
  status text not null default 'draft',
  target_item_instance_id uuid not null references public.item_instances(id) on delete restrict,
  requested_service_id text not null,
  quoted_price_credits bigint check (quoted_price_credits is null or quoted_price_credits >= 0),
  quoted_duration_minutes integer check (quoted_duration_minutes is null or quoted_duration_minutes > 0),
  owner_supplied_material_ids uuid[] not null default '{}',
  provider_supplied_material_ids uuid[] not null default '{}',
  escrow_id uuid references public.escrow_records(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  check (status in ('draft', 'listed', 'quoted', 'accepted', 'in_escrow', 'active', 'completed', 'cancelled', 'disputed'))
);

create index if not exists item_instances_owner_idx on public.item_instances(owner_user_id);
create index if not exists item_instances_tradeable_idx on public.item_instances(tradeable, account_bound, kind);
create index if not exists market_listings_status_idx on public.market_listings(status, listed_at desc);
create index if not exists service_jobs_owner_idx on public.service_jobs(owner_user_id, status);
create index if not exists service_jobs_provider_idx on public.service_jobs(provider_user_id, status);

alter table public.profiles enable row level security;
alter table public.item_instances enable row level security;
alter table public.player_professions enable row level security;
alter table public.active_actions enable row level security;
alter table public.market_listings enable row level security;
alter table public.escrow_records enable row level security;
alter table public.service_jobs enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "items_select_own_or_market" on public.item_instances for select using (
  auth.uid() = owner_user_id
  or exists (
    select 1 from public.market_listings ml
    where ml.item_instance_id = item_instances.id and ml.status = 'active'
  )
);
create policy "items_insert_own" on public.item_instances for insert with check (auth.uid() = owner_user_id);
create policy "items_update_own_unlisted" on public.item_instances for update using (
  auth.uid() = owner_user_id
  and not exists (
    select 1 from public.market_listings ml
    where ml.item_instance_id = item_instances.id and ml.status = 'active'
  )
) with check (auth.uid() = owner_user_id);

create policy "professions_select_own" on public.player_professions for select using (auth.uid() = user_id);
create policy "professions_insert_own" on public.player_professions for insert with check (auth.uid() = user_id);
create policy "professions_update_own" on public.player_professions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "actions_select_own" on public.active_actions for select using (auth.uid() = user_id);
create policy "actions_insert_own" on public.active_actions for insert with check (auth.uid() = user_id);
create policy "actions_update_own" on public.active_actions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "market_select_active_or_own" on public.market_listings for select using (
  status = 'active' or auth.uid() = seller_user_id
);
create policy "market_insert_own" on public.market_listings for insert with check (auth.uid() = seller_user_id);
create policy "market_update_own" on public.market_listings for update using (auth.uid() = seller_user_id) with check (auth.uid() = seller_user_id);

create policy "escrow_select_party" on public.escrow_records for select using (
  auth.uid() = payer_user_id or auth.uid() = payee_user_id
);
create policy "escrow_insert_payer" on public.escrow_records for insert with check (auth.uid() = payer_user_id);
create policy "escrow_update_party" on public.escrow_records for update using (
  auth.uid() = payer_user_id or auth.uid() = payee_user_id
) with check (auth.uid() = payer_user_id or auth.uid() = payee_user_id);

create policy "service_jobs_select_party" on public.service_jobs for select using (
  auth.uid() = owner_user_id or auth.uid() = provider_user_id
);
create policy "service_jobs_insert_owner" on public.service_jobs for insert with check (auth.uid() = owner_user_id);
create policy "service_jobs_update_party" on public.service_jobs for update using (
  auth.uid() = owner_user_id or auth.uid() = provider_user_id
) with check (auth.uid() = owner_user_id or auth.uid() = provider_user_id);

comment on table public.item_instances is 'CyberCache generated/player-owned items. Static item definitions remain in src/content.';
comment on table public.active_actions is 'One productive action per player at a time: roaming, boss fight, crafting, refining, repair, travel, or service work.';
comment on table public.service_jobs is 'Player-to-player service jobs for repairs, core processing, and future shop work.';
