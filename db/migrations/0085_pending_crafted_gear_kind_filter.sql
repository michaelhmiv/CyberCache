-- =====================================================================
-- 0085 — cc_pending_crafted_gear learns to keep its hands off
-- cosmetics (fleet-found workshop brick, diagnosed 2026-11-05).
--
-- The function returned EVERY craft-job output with pending='true' —
-- no kind filter. Cosmetic (skin-part) completions are pending
-- outputs too (pending: true, cosmeticPartId: …, quality: …, gear
-- fields NULL), so they were swept into the GEAR projection with
-- slot/rarity/item_level/draws all NULL. Every workshop surface
-- finalizes gear before cosmetics, so the gear finalizer reached
-- the cosmetic rows first: String(null) slot matches no generator,
-- `item.origin = 'crafted'` throws on undefined (craftGear.ts),
-- the request 500s, the cosmetics finalizer never runs, the
-- outputs never drain — and every later workshop touch (state
-- read, enqueue, offline craft settle) 500s the same way. The
-- account's workshop is bricked until this filter lands; affected
-- players self-heal on their next workshop touch after deploy
-- (outputs are intact in craft_jobs.outputs — nothing was lost).
--
-- The fix is the filter the cosmetics twin has carried since 0053
-- (cc_pending_crafted_cosmetics keys on `o ? 'cosmeticPartId'`):
-- the job's kind is authoritative (`j.kind = 'gear'`), with a
-- belt-and-suspenders exclusion of any output carrying a
-- cosmeticPartId. A TS defense rides in the same PR:
-- finalizePendingCraftedGear now skips + logs an output whose slot
-- matches no known kind instead of throwing, so one malformed row
-- can never 500 the whole workshop again.
--
-- FUNCTION PROVENANCE: cc_pending_crafted_gear is restated from its
-- chain head, db/migrations/0073_bench_collapse_relic_merger.sql
-- §11 (grep over all migrations for `create or replace function
-- public.cc_pending_crafted_gear` returns 0024 + 0067 + 0073 only;
-- 0073 is the highest-numbered and the live definition — the
-- 2026-11-05 staging↔production audit verified production carries
-- this same body). The restatement is byte-identical to 0073's
-- except exactly two added WHERE lines (extraction diff: 2 lines):
-- `and j.kind = 'gear'` and `and o ->> 'cosmeticPartId' is null`.
-- Return shape is unchanged, so no caller moves.
--
-- FIELD AUDIT (every column read, against craft_jobs as defined in
-- 0024 — the only later ALTER, 0026, adds escrow_cores, untouched
-- here): j.id (uuid pk), j.owner_user_id (uuid), j.bench (smallint),
-- j.snapshot (jsonb), j.outputs (jsonb), j.kind (text, not null) —
-- all exist. The `o ->> '…'` keys (unit, slot, rarity, item_level,
-- draws, qualityBounds, namedRelic, pending, cosmeticPartId) are
-- output-element keys written by the settlers, runtime by design.
-- =====================================================================

drop function if exists public.cc_pending_crafted_gear(uuid);

create or replace function public.cc_pending_crafted_gear(p_player_id uuid)
returns table(job_id uuid, unit integer, slot text, rarity text, item_level integer, draws integer, bench integer, tool_quality_multiplier numeric, quality_bounds jsonb, named_relic text)
language sql
stable
set search_path = public
as $$
  select j.id,
         (o ->> 'unit')::integer,
         o ->> 'slot',
         o ->> 'rarity',
         (o ->> 'item_level')::integer,
         (o ->> 'draws')::integer,
         j.bench,
         coalesce((j.snapshot ->> 'toolQualityMultiplier')::numeric, 1),
         o -> 'qualityBounds',
         o ->> 'namedRelic'
    from public.craft_jobs j,
         jsonb_array_elements(j.outputs) as o
   where j.owner_user_id = p_player_id
     and o ->> 'pending' = 'true'
     and j.kind = 'gear'
     and o ->> 'cosmeticPartId' is null
$$;
