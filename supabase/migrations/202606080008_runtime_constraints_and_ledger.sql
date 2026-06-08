alter table public.profiles drop constraint if exists profiles_runtime_balances_nonnegative;
alter table public.profiles add constraint profiles_runtime_balances_nonnegative check (
  credits >= 0
  and scrap >= 0
  and cache_tokens >= 0
  and cache_token_parts >= 0
  and cache_token_parts < 5
);

alter table public.item_instances drop constraint if exists item_instances_runtime_state_check;
alter table public.item_instances add constraint item_instances_runtime_state_check check (
  runtime_state in ('available','equipped','locked','listed','salvaged','consumed')
);

alter table public.item_instances drop constraint if exists item_instances_equipped_slot_check;
alter table public.item_instances add constraint item_instances_equipped_slot_check check (
  equipped_slot is null or equipped_slot in ('primary','secondary','heavy','ordnance','shield','classMod','relic')
);

create index if not exists item_instances_owner_runtime_state_idx on public.item_instances(owner_user_id, runtime_state);
create index if not exists item_instances_owner_equipped_slot_idx on public.item_instances(owner_user_id, equipped_slot) where equipped_slot is not null;

create table if not exists public.verified_action_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action_type text not null,
  idempotency_key text not null,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table public.verified_action_ledger enable row level security;

drop policy if exists "verified_action_ledger_select_own" on public.verified_action_ledger;
create policy "verified_action_ledger_select_own" on public.verified_action_ledger
  for select to authenticated using ((select auth.uid()) = user_id);

create index if not exists verified_action_ledger_user_action_idx on public.verified_action_ledger(user_id, action_type, created_at desc);
