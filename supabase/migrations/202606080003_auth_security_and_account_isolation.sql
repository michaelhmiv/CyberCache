-- CyberCache auth profile reliability and RLS hardening
-- Guarantees profile creation, backfills missing profiles, removes public anon policy scope,
-- and fixes advisor warnings for security-definer/helper functions.

create or replace function public.resolve_account_type(is_anonymous boolean, confirmed_at timestamptz)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(is_anonymous, false) then 'guest'
    when confirmed_at is not null then 'verified'
    else 'registered_unverified'
  end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (
    id,
    username,
    display_name,
    account_type,
    email,
    email_verified_at,
    verification_grace_expires_at
  ) values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    public.resolve_account_type(new.is_anonymous, new.email_confirmed_at),
    new.email,
    new.email_confirmed_at,
    now() + interval '7 days'
  )
  on conflict (id) do update set
    username = coalesce(public.profiles.username, excluded.username),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    account_type = excluded.account_type,
    email = excluded.email,
    email_verified_at = excluded.email_verified_at,
    verification_grace_expires_at = coalesce(public.profiles.verification_grace_expires_at, public.profiles.created_at + interval '7 days');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (
  id,
  username,
  display_name,
  account_type,
  email,
  email_verified_at,
  verification_grace_expires_at
)
select
  u.id,
  nullif(u.raw_user_meta_data ->> 'username', ''),
  nullif(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'), ''),
  public.resolve_account_type(u.is_anonymous, u.email_confirmed_at),
  u.email,
  u.email_confirmed_at,
  now() + interval '7 days'
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;

create or replace function public.is_verified_player(user_id uuid)
returns boolean
language sql
stable
security invoker
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
security invoker
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
security invoker
set search_path = public
as $$
  select public.is_verified_player(user_id);
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.resolve_account_type(boolean, timestamptz) from public, anon;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.is_verified_player(uuid) to authenticated, service_role;
grant execute on function public.is_guest_player(uuid) to authenticated, service_role;
grant execute on function public.can_use_player_economy(uuid) to authenticated, service_role;

create index if not exists escrow_records_payer_user_id_idx on public.escrow_records(payer_user_id);
create index if not exists escrow_records_payee_user_id_idx on public.escrow_records(payee_user_id);
create index if not exists item_instances_creator_user_id_idx on public.item_instances(creator_user_id);
create index if not exists market_listings_seller_user_id_idx on public.market_listings(seller_user_id);
create index if not exists market_listings_item_instance_id_idx on public.market_listings(item_instance_id);
create index if not exists service_jobs_escrow_id_idx on public.service_jobs(escrow_id);
create index if not exists service_jobs_target_item_instance_id_idx on public.service_jobs(target_item_instance_id);

-- Replace broad public policies with authenticated-only policies and initplan-friendly auth.uid calls.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "items_select_own_or_market" on public.item_instances;
drop policy if exists "items_insert_own" on public.item_instances;
drop policy if exists "items_update_own_unlisted" on public.item_instances;
create policy "items_select_own_or_market" on public.item_instances for select to authenticated using (
  (select auth.uid()) = owner_user_id
  or exists (
    select 1 from public.market_listings ml
    where ml.item_instance_id = item_instances.id and ml.status = 'active'
  )
);
create policy "items_insert_own" on public.item_instances for insert to authenticated with check ((select auth.uid()) = owner_user_id);
create policy "items_update_own_unlisted" on public.item_instances for update to authenticated using (
  (select auth.uid()) = owner_user_id
  and not exists (
    select 1 from public.market_listings ml
    where ml.item_instance_id = item_instances.id and ml.status = 'active'
  )
) with check ((select auth.uid()) = owner_user_id);

drop policy if exists "professions_select_own" on public.player_professions;
drop policy if exists "professions_insert_own" on public.player_professions;
drop policy if exists "professions_update_own" on public.player_professions;
create policy "professions_select_own" on public.player_professions for select to authenticated using ((select auth.uid()) = user_id);
create policy "professions_insert_own" on public.player_professions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "professions_update_own" on public.player_professions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "actions_select_own" on public.active_actions;
drop policy if exists "actions_insert_own" on public.active_actions;
drop policy if exists "actions_update_own" on public.active_actions;
create policy "actions_select_own" on public.active_actions for select to authenticated using ((select auth.uid()) = user_id);
create policy "actions_insert_own" on public.active_actions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "actions_update_own" on public.active_actions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "market_select_active_or_own" on public.market_listings;
drop policy if exists "market_insert_verified" on public.market_listings;
drop policy if exists "market_update_verified_owner" on public.market_listings;
create policy "market_select_active_or_own" on public.market_listings for select to authenticated using (
  status = 'active' or (select auth.uid()) = seller_user_id
);
create policy "market_insert_verified" on public.market_listings for insert to authenticated with check (
  (select auth.uid()) = seller_user_id
  and public.can_use_player_economy((select auth.uid()))
);
create policy "market_update_verified_owner" on public.market_listings for update to authenticated using (
  (select auth.uid()) = seller_user_id
  and public.can_use_player_economy((select auth.uid()))
) with check (
  (select auth.uid()) = seller_user_id
  and public.can_use_player_economy((select auth.uid()))
);

drop policy if exists "escrow_select_party" on public.escrow_records;
drop policy if exists "escrow_insert_verified_payer" on public.escrow_records;
drop policy if exists "escrow_update_verified_party" on public.escrow_records;
create policy "escrow_select_party" on public.escrow_records for select to authenticated using (
  (select auth.uid()) = payer_user_id or (select auth.uid()) = payee_user_id
);
create policy "escrow_insert_verified_payer" on public.escrow_records for insert to authenticated with check (
  (select auth.uid()) = payer_user_id
  and public.can_use_player_economy((select auth.uid()))
);
create policy "escrow_update_verified_party" on public.escrow_records for update to authenticated using (
  ((select auth.uid()) = payer_user_id or (select auth.uid()) = payee_user_id)
  and public.can_use_player_economy((select auth.uid()))
) with check (
  ((select auth.uid()) = payer_user_id or (select auth.uid()) = payee_user_id)
  and public.can_use_player_economy((select auth.uid()))
);

drop policy if exists "service_jobs_select_party" on public.service_jobs;
drop policy if exists "service_jobs_insert_verified_owner" on public.service_jobs;
drop policy if exists "service_jobs_update_verified_party" on public.service_jobs;
create policy "service_jobs_select_party" on public.service_jobs for select to authenticated using (
  (select auth.uid()) = owner_user_id or (select auth.uid()) = provider_user_id
);
create policy "service_jobs_insert_verified_owner" on public.service_jobs for insert to authenticated with check (
  (select auth.uid()) = owner_user_id
  and public.can_use_player_economy((select auth.uid()))
);
create policy "service_jobs_update_verified_party" on public.service_jobs for update to authenticated using (
  ((select auth.uid()) = owner_user_id or (select auth.uid()) = provider_user_id)
  and public.can_use_player_economy((select auth.uid()))
) with check (
  ((select auth.uid()) = owner_user_id or (select auth.uid()) = provider_user_id)
  and public.can_use_player_economy((select auth.uid()))
);
