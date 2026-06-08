create table if not exists public.odds_tables (
  id text primary key,
  version integer not null default 1,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.odds_outcomes (
  table_id text not null references public.odds_tables(id) on delete cascade,
  outcome text not null,
  weight integer not null check (weight > 0),
  payload jsonb not null default '{}'::jsonb,
  primary key (table_id, outcome)
);

alter table public.odds_tables enable row level security;
alter table public.odds_outcomes enable row level security;
