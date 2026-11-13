-- 0096 — The roaming consumable engine's state lives on the profile.
--
-- Coverage consumables (Ammo Pack and kin) are charged when their
-- coverage window ENDS: one Q100 Ammo Pack covers 600 s (200 ticks) of
-- roaming, charged at expiry and auto-renewed while stock lasts. The
-- window state (slots + expiry ticks) used to exist only in the claim
-- request/response round-trip — the server kept no copy, and the
-- shipped client kept it only in page memory. Every app restart reset
-- every open window for free, so in real play patterns (sessions
-- shorter than one window) packs were never charged at all while the
-- coverage bonus applied throughout (verified live on staging,
-- 2026-11-13: 240 state-less ticks consumed 0 packs; the same span
-- with a continuous state consumed exactly 1, at the boundary).
--
-- The Chef now persists the state it returns on the profile and both
-- engine callers (POST /api/claim, POST /api/settle-offline) resume
-- from the stored copy; a stored state whose tick base no longer
-- matches the claim watermark is discarded rather than re-charged.
-- Existing rows keep null — the first claim under the new code adopts
-- the client's carried state once, then the server copy owns it.

alter table public.profiles
  add column if not exists roaming_consumable_state jsonb;
