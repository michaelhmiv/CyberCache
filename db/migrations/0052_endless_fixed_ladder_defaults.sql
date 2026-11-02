-- 0052: Endless fixed ladder — the growth-lever defaults move.
--
-- The Chaos Chamber's ladder is now FIXED (owner law, 2026-11-02):
-- encounter combat stats derive from parBossForLevel(depth), never
-- from the runner's level, and the two compounding levers are
-- retuned for the depth anchor (design record:
-- design-briefs/endless-tuning-SPEC.md):
--
--   endlessHpGrowth   1.12 -> 1.04
--   endlessDpsGrowth  1.10 -> 1.03
--
-- The TS defaults move in the same slice (src/content/endless.ts
-- ENDLESS_HP_GROWTH_DEFAULT / ENDLESS_DPS_GROWTH_DEFAULT and
-- ECONOMY_CONFIG_DEFAULTS in src/server/economy/config.ts, parity-
-- pinned by src/test/endless.test.ts). This migration carries the
-- STORED rows: an economy_config row that still holds the OLD
-- shipped default is moved to the new default through
-- cc_set_economy_config (0018), so the change lands in
-- economy_config_history like any admin write. A row an operator
-- deliberately tuned to any other value is NOT the shipped default
-- and is left exactly as it stands; a missing row needs nothing
-- (the TS default governs). No schema change.

do $$
begin
  if exists (
    select 1 from public.economy_config
    where key = 'endlessHpGrowth' and value = '1.12'::jsonb
  ) then
    perform public.cc_set_economy_config('endlessHpGrowth', '1.04'::jsonb, 'migration-0052');
  end if;

  if exists (
    select 1 from public.economy_config
    where key = 'endlessDpsGrowth' and value = '1.1'::jsonb
  ) then
    perform public.cc_set_economy_config('endlessDpsGrowth', '1.03'::jsonb, 'migration-0052');
  end if;
end $$;
