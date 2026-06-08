-- CyberCache account state and verification gates
-- Supports guest onboarding, registered unverified accounts, and verified accounts.

alter table public.profiles
  add column if not exists account_type text not null default 'guest',
  add column if not exists email text,
  add column if not exists email_verified_at timestamptz,
  add column if not exists verification_grace_expires_at timestamptz,
  add column if not exists verification_reminder_last_seen_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_account_type_check;

alter table public.profiles
  add constraint profiles_account_type_check
  check (account_type in ('guest', 'registered_unverified', 'verified'));

update public.profiles
set verification_grace_expires_at = coalesce(verification_grace_expires_at, created_at + interval '7 days')
where verification_grace_expires_at is null;

create or replace function public.is_verified_player(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = user_id
      and p.account_type = 'verified'
      and p.email_verified_at is not null
  );
$$;

create or replace function public.is_guest_player(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = user_id
      and p.account_type = 'guest'
  );
$$;

create or replace function public.can_use_player_economy(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_verified_player(user_id);
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists item_instances_touch_updated_at on public.item_instances;
create trigger item_instances_touch_updated_at
before update on public.item_instances
for each row execute function public.touch_updated_at();

drop trigger if exists active_actions_touch_updated_at on public.active_actions;
create trigger active_actions_touch_updated_at
before update on public.active_actions
for each row execute function public.touch_updated_at();

-- Inter-user economy writes require verified accounts.
-- Guests and unverified users may still own solo-progress item instances.
drop policy if exists "market_insert_own" on public.market_listings;
create policy "market_insert_verified" on public.market_listings
for insert with check (
  auth.uid() = seller_user_id
  and public.can_use_player_economy(auth.uid())
);

drop policy if exists "market_update_own" on public.market_listings;
create policy "market_update_verified_owner" on public.market_listings
for update using (
  auth.uid() = seller_user_id
  and public.can_use_player_economy(auth.uid())
) with check (
  auth.uid() = seller_user_id
  and public.can_use_player_economy(auth.uid())
);

drop policy if exists "escrow_insert_payer" on public.escrow_records;
create policy "escrow_insert_verified_payer" on public.escrow_records
for insert with check (
  auth.uid() = payer_user_id
  and public.can_use_player_economy(auth.uid())
);

drop policy if exists "escrow_update_party" on public.escrow_records;
create policy "escrow_update_verified_party" on public.escrow_records
for update using (
  (auth.uid() = payer_user_id or auth.uid() = payee_user_id)
  and public.can_use_player_economy(auth.uid())
) with check (
  (auth.uid() = payer_user_id or auth.uid() = payee_user_id)
  and public.can_use_player_economy(auth.uid())
);

drop policy if exists "service_jobs_insert_owner" on public.service_jobs;
create policy "service_jobs_insert_verified_owner" on public.service_jobs
for insert with check (
  auth.uid() = owner_user_id
  and public.can_use_player_economy(auth.uid())
);

drop policy if exists "service_jobs_update_party" on public.service_jobs;
create policy "service_jobs_update_verified_party" on public.service_jobs
for update using (
  (auth.uid() = owner_user_id or auth.uid() = provider_user_id)
  and public.can_use_player_economy(auth.uid())
) with check (
  (auth.uid() = owner_user_id or auth.uid() = provider_user_id)
  and public.can_use_player_economy(auth.uid())
);

comment on column public.profiles.account_type is 'guest, registered_unverified, or verified. Market/service/social features require verified.';
comment on column public.profiles.verification_grace_expires_at is 'Soft reminder deadline for email verification; solo play should not be fully blocked by this date.';
comment on function public.can_use_player_economy(uuid) is 'True only for verified players. Used by RLS policies for inter-user economy writes.';
