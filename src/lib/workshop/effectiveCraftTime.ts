/**
 * The player's EFFECTIVE craft rate — the per-unit duration a new
 * job will actually store for the player's current state
 * (skill-routing fix F4, migration 0102).
 *
 * The composition is the enqueue's own, restated for display:
 * base × skill × tool × scalar, where the skill term composes the
 * consumableEfficiency multiplier × the Fixer craft-speed multiplier
 * under the combined 0.60× floor — the exact formula
 * src/server/writes/craftEngine.ts applies at enqueue (and
 * cc_enqueue_craft_job mirrors in SQL). The inputs are the player's
 * own gated derivation (the fielded hunter's skill totals, Doc
 * Sutter's base perk included when he is fielded), the equipped
 * relic's composed duration multiplier, and the server's resolved
 * craftTimeScalar shipped on the Workshop state — so the number the
 * card quotes is the number the server stores. A rush ticket is the
 * one term the quote never carries: its reduction prices from the
 * ticket the enqueue burns, so the quote is the honest no-ticket
 * rate. Parity with the stored duration is pinned by
 * src/test/skillRoutingFix.test.ts.
 */
import {
  consumableEfficiencyDurationMultiplier,
  fixerCraftSpeedDurationMultiplier,
} from '../../content/crafting';

export interface CraftRateQuote {
  /** computeHunterSkillBonuses total for consumableEfficiency (gated). */
  consumableEfficiency: number;
  /** computeHunterSkillBonuses total for craftSpeedBonus (gated, perk included). */
  craftSpeedBonus: number;
  /** The equipped craft relic's composed duration multiplier (1 when none). */
  toolDurationMultiplier: number;
  /** The server's resolved craftTimeScalar lever. */
  craftTimeScalar: number;
}

/** The unit duration (ms) a new enqueue stores for `baseDurationMs`
 *  under the quoted player state — rush tickets excluded by design. */
export function effectiveCraftUnitDurationMs(baseDurationMs: number, quote: CraftRateQuote): number {
  const skillMultiplier = Math.max(
    0.6,
    consumableEfficiencyDurationMultiplier(quote.consumableEfficiency) *
      fixerCraftSpeedDurationMultiplier(quote.craftSpeedBonus),
  );
  return Math.max(
    1,
    Math.round(baseDurationMs * skillMultiplier * quote.toolDurationMultiplier * quote.craftTimeScalar),
  );
}
