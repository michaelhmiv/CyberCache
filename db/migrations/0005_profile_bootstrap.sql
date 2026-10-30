-- Route B, slice B4: profile bootstrap for Chef-owned accounts.
--
-- In the Supabase stack, an `on_auth_user_created` trigger
-- (public.handle_new_user) created the profiles row the moment an auth
-- user existed, and a later revision kept the profile's account fields
-- in sync when the auth user changed. B1–B3 ported the account and the
-- game surface but nothing created the profile row, so a brand-new Chef
-- account (guest / register / Google) had no profile and
-- GET /api/profile/me could only 404. B4's client cutover makes the
-- Chef the only identity provider, so the bootstrap lands here,
-- mirroring handle_new_user's final semantics against auth_accounts:
--
-- * AFTER INSERT: create the profiles row. Guests get the deterministic
--   generated handle (cc_generate_guest_username); other accounts start
--   with a null username (the Chef register/Google flows carry no
--   chosen-username metadata — the client sets one afterwards through
--   cc_set_username, exactly like the in-app username flow).
-- * account_type mirrors public.resolve_account_type(is_anonymous,
--   email_confirmed_at): guest -> 'guest', verified email -> 'verified',
--   otherwise 'registered_unverified'.
-- * verification_grace_expires_at starts at created_at + 7 days.
-- * AFTER UPDATE of the identity columns: keep the profile's
--   account_type / email / email_verified_at in sync (guest -> email
--   upgrade and guest -> Google link both mutate the account row in
--   place; the profile must follow or the verification gate reads stale
--   state). Mirrors handle_new_user's on-conflict update assignments.
--
-- Creating the profile also fires 0004's trg_seed_starter_weapon, so a
-- new account's starter weapon is seeded server-side at creation —
-- the same coverage the client's old cc_ensure_starter_weapon safety
-- net provided.
--
-- Idempotent: functions are create-or-replace, triggers are dropped
-- and recreated, and the insert is on-conflict-do-nothing.

create or replace function public.cc_generate_guest_username(_user_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select 'guest_' || upper(substring(md5(_user_id::text) from 1 for 8));
$$;

create or replace function public.chef_bootstrap_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    username,
    account_type,
    email,
    email_verified_at,
    verification_grace_expires_at
  ) values (
    new.id,
    case when new.is_guest then public.cc_generate_guest_username(new.id) else null end,
    case
      when new.is_guest then 'guest'
      when new.email_verified_at is not null then 'verified'
      else 'registered_unverified'
    end,
    new.email,
    new.email_verified_at,
    new.created_at + interval '7 days'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_chef_bootstrap_profile on auth_accounts;
create trigger trg_chef_bootstrap_profile
  after insert on auth_accounts
  for each row execute function public.chef_bootstrap_profile();

create or replace function public.chef_sync_profile_account()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.profiles p
  set
    account_type = case
      when new.is_guest then 'guest'
      when new.email_verified_at is not null then 'verified'
      else 'registered_unverified'
    end,
    email = new.email,
    email_verified_at = new.email_verified_at,
    verification_grace_expires_at = coalesce(
      p.verification_grace_expires_at,
      p.created_at + interval '7 days'
    )
  where p.id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_chef_sync_profile_account on auth_accounts;
create trigger trg_chef_sync_profile_account
  after update of email, is_guest, email_verified_at on auth_accounts
  for each row
  when (
    old.email is distinct from new.email
    or old.is_guest is distinct from new.is_guest
    or old.email_verified_at is distinct from new.email_verified_at
  )
  execute function public.chef_sync_profile_account();

-- Backfill: any auth account created before this migration (B1–B3 era)
-- that never got a profile row receives one now, with the same rules.
insert into public.profiles (
  id,
  username,
  account_type,
  email,
  email_verified_at,
  verification_grace_expires_at,
  created_at,
  updated_at
)
select
  a.id,
  case when a.is_guest then public.cc_generate_guest_username(a.id) else null end,
  case
    when a.is_guest then 'guest'
    when a.email_verified_at is not null then 'verified'
    else 'registered_unverified'
  end,
  a.email,
  a.email_verified_at,
  a.created_at + interval '7 days',
  a.created_at,
  a.updated_at
from auth_accounts a
on conflict (id) do nothing;
