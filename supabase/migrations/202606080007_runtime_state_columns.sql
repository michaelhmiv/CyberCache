alter table public.profiles
  add column if not exists scrap bigint not null default 0,
  add column if not exists cache_tokens integer not null default 0,
  add column if not exists cache_token_parts integer not null default 0,
  add column if not exists materials jsonb not null default '{}'::jsonb,
  add column if not exists essences jsonb not null default '{}'::jsonb,
  add column if not exists consumables jsonb not null default '{}'::jsonb,
  add column if not exists skill_spends jsonb not null default '{}'::jsonb,
  add column if not exists boss_state jsonb not null default '{}'::jsonb,
  add column if not exists last_idle_claim_at timestamptz not null default now();

alter table public.item_instances
  add column if not exists runtime_state text not null default 'available',
  add column if not exists is_locked boolean not null default false,
  add column if not exists equipped_slot text;
