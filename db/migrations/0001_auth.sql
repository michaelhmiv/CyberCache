-- Route B, slice B1: Chef-owned identity on plain Postgres (Railway).
-- Replaces Supabase Auth for CyberCache. Apply with psql against the
-- Railway Postgres database. This tree (db/migrations) is independent of
-- the historical supabase/migrations tree.
--
-- Design notes:
-- * auth_accounts.id is the player id everywhere else in the system
--   (profiles.id and item_instances.owner_user_id reference this id once
--   the B2 data port lands; ids are plain uuids so existing rows carry over).
-- * One password per account lives on the account row (scrypt hash,
--   format: scrypt$N$r$p$salt$key). External identities (Google) attach
--   via auth_identities so a provider-created account still gets email
--   as a first-class second authenticator, per the account model.
-- * Refresh tokens are stored ONLY as SHA-256 hashes, rotate on every
--   use, and reuse of a revoked token revokes all of the account's
--   sessions (theft detection), enforced by PgAuthStore.

create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists auth_accounts (
  id uuid primary key default gen_random_uuid(),
  email citext unique,
  is_guest boolean not null default false,
  password_hash text,
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_accounts_email_or_guest check (email is not null or is_guest),
  constraint auth_accounts_password_for_non_guest check (is_guest or password_hash is not null or email is null)
);

create table if not exists auth_refresh_tokens (
  token_hash text primary key,
  account_id uuid not null references auth_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by_hash text,
  created_at timestamptz not null default now()
);
create index if not exists auth_refresh_tokens_account_idx
  on auth_refresh_tokens (account_id) where revoked_at is null;

create table if not exists auth_identities (
  provider text not null,
  provider_subject text not null,
  account_id uuid not null references auth_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, provider_subject)
);
