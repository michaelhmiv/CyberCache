-- Migration 202606120001: add canonical offline settlement tracking to profiles
--
-- Problem:
--   The offline settlement path has no canonical "last settled at" timestamp
--   and no idempotency guard. Client-side Date.now() is used to compute
--   elapsed time, which is not authoritative. Without a settlement nonce,
--   double-calling settlement (common on auth refresh / React re-render)
--   processes rewards twice.
--
-- Fix:
--   Add last_roaming_settled_at (TIMESTAMPTZ) — server-authoritative
--   timestamp of the most recent offline roaming settlement. Used as the
--   "from" timestamp when computing elapsed time server-side.
--
--   Add last_settlement_nonce (TEXT) — client-generated UUID sent with
--   each settlement request. Server stores it; if the same nonce arrives
--   again, the server returns the cached result without re-processing.
--   This makes offline settlement idempotent across page refreshes.
--
--   Both columns are NULL-able so existing profiles (which have never
--   been settled through this path) default to using active_actions.started_at
--   as the fallback timestamp on first settlement.

alter table public.profiles
  add column if not exists last_roaming_settled_at timestamptz;

alter table public.profiles
  add column if not exists last_settlement_nonce text;

comment on column public.profiles.last_roaming_settled_at is
  'Server-authoritative timestamp of the most recent offline roaming settlement. Used to compute elapsed time server-side. NULL until first settlement.';

comment on column public.profiles.last_settlement_nonce is
  'Client-generated idempotency nonce for offline settlement. If the same nonce is received again, the server returns the cached result without re-processing.';

-- Also expose both fields in cc_profile_snapshot so the client can
-- read the last settlement state (useful for UI display and debugging).
create or replace function public.cc_profile_snapshot(profile_row public.profiles)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', profile_row.id,
    'player_level', profile_row.player_level,
    'player_xp', profile_row.player_xp,
    'credits', profile_row.credits,
    'scrap', profile_row.scrap,
    'cache_tokens', profile_row.cache_tokens,
    'cache_token_parts', profile_row.cache_token_parts,
    'materials', profile_row.materials,
    'essences', profile_row.essences,
    'consumables', profile_row.consumables,
    'skill_spends', profile_row.skill_spends,
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at,
    'last_claimed_tick', profile_row.last_claimed_tick,
    'last_roaming_settled_at', profile_row.last_roaming_settled_at,
    'last_settlement_nonce', profile_row.last_settlement_nonce
  );
$$;
