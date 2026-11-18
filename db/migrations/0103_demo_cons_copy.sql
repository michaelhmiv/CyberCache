-- Migration 0103 — Demolition supply-node copy: the concise
-- wording (the V3 copy pass's withheld row, landed).
--
-- The five Demolition supply nodes (demo_cons_1–5) share one
-- description. Migration 0102's F6 block corrected it to the
-- quantized-formula truth — unit time falls in 2% steps across
-- the family, reaching −20% only with all five maxed — and
-- wrote those words into both this table's seed copy and the
-- TS defs (src/constants/skillTrees.ts), with the F6 pin
-- (src/test/skillRoutingFix.test.ts) holding the two to the
-- same words.
--
-- The V3 concise-copy pass (the audited copy table behind the
-- icon-tree build, PR #620) rewrote the wording into player
-- language with the numbers mechanically identical — 2%
-- steps, five nodes, −20%, all five maxed — dropping the
-- implementation-speak "(server-side, snapshotted at
-- enqueue)" for "The rate is set when the job is queued."
-- Thirteen of the pass's eighteen rewrites landed in #620;
-- this row was withheld because the defs cannot move alone
-- without breaking the pin by design. This migration carries
-- the seed copy to the approved words; the same change moves
-- the defs and repoints the pin at this file, so all three
-- stay identical.
--
-- Copy only: no function, cost, prerequisite, or effect
-- changes. Idempotent by construction — the update writes
-- the same value on every apply, scoped to exactly the
-- five ids.
--
-- Guarded like its predecessors: raises unless the
-- definitions table exists.

do $$
begin
  if to_regclass('public.skill_node_definitions') is null then
    raise exception '0103 requires the skill node definitions table (0004)';
  end if;
end $$;

update public.skill_node_definitions
   set description = 'Craft jobs run faster: unit time falls in 2% steps across the five supply nodes — up to −20% with all five maxed. The rate is set when the job is queued.'
 where id in ('demo_cons_1', 'demo_cons_2', 'demo_cons_3', 'demo_cons_4', 'demo_cons_5');
