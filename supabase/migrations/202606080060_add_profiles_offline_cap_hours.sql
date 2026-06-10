-- Migration 060: add profiles.offline_cap_hours
--
-- Background:
--   The cc_claim_roaming_rewards RPC (migrations 055, 058, and 059) reads
--   p.offline_cap_hours to cap the offline-catchup tick batch. The column
--   is referenced in the original 055/058 SQL but no migration in this
--   repo ever created the column. The prod profiles table does not have
--   it. Without this column, every roaming-rewards RPC call fails with
--   PostgreSQL error 42703 ("record 'p' has no field 'offline_cap_hours'"),
--   visible in the browser console as
--   `[idleTicker] roaming rewards RPC failed: ... no field "offline_cap_hours"`
--   once per 3s tick.
--
-- Fix:
--   Add the column with a sensible default. The RPC default is 2 hours;
--   we use the same default in the column constraint so new users get
--   2h, the RPC's `coalesce(p.offline_cap_hours, 2)` is now defensive
--   rather than load-bearing.
--
-- Why numeric(5,2):
--   The minimum is 0.25 (15 min) and the value is in hours. A 5,2
--   numeric gives us 0.00–999.99 with two decimal places of precision,
--   which is more than enough for "how many hours of catchup do I get".
--
-- Idempotency:
--   ADD COLUMN IF NOT EXISTS is idempotent. Re-running this migration is
--   a no-op. Existing rows (if any) get the default 2.0.

alter table public.profiles
  add column if not exists offline_cap_hours numeric(5,2) not null default 2.0
  check (offline_cap_hours >= 0.25 and offline_cap_hours <= 168);

comment on column public.profiles.offline_cap_hours is
  'Maximum hours of offline catch-up the player wants the server to settle in a single cc_claim_roaming_rewards call. Default 2h, max 1 week. The client can raise/lower this via a future settings RPC; the server caps it at 168 (1 week) to bound catch-up work.';
