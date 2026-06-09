import type { Weapon } from '@/types/items';
import { Element } from '@/types/game';

export type DpsContext = {
  weapon: Weapon;
  /** Boss weaknesses, in priority order. First matching element gets the full counter bonus. */
  bossWeaknesses?: Element[];
  /**
   * Boss resistances (defensive elements that reduce incoming damage).
   * Multiplicative, default empty (= no resistance penalty).
   * Replaces the legacy single-number `bossResistance` parameter.
   */
  bossResistances?: Element[];
  /** Pre-fight consumables applied as a final multiplier. */
  consumables?: { TargetPainter?: number; OptimalAmmo?: number };
  /** Manufacturer-specific legendary damage multiplier (default 1.0). */
  legendaryDamageMult?: number;
};

/**
 * Real counter-element table.
 *
 * The element-vs-element matchup is now a 3-state lookup, not the
 * 2-state "match → 1.3, else 1.0" used in PR A-C. A player element that
 * matches a boss resistance pays a 0.7× penalty; a non-matching element
 * is neutral (1.0×). When both `bossWeaknesses` and `bossResistances`
 * are empty, the chain returns 1.0× regardless of element (this is
 * the "vs standard target" semantics locked by decision D1).
 *
 * The boss-weakness check takes priority over the resistance check
 * (a player should never see "this element is both your counter AND
 * the boss's resistance" — those arrays are disjoint by data design).
 *
 * The "vs standard" / 1.0×-for-everything branch replaces the legacy
 * `getElementMatchup(element, 'flesh')` fallback. The chain no longer
 * cares about target-type strings; it only consumes Element arrays.
 */
const counterElementMultiplier = (
  playerElement: Element,
  bossWeaknesses: Element[],
  bossResistances: Element[],
): number => {
  if (bossWeaknesses.includes(playerElement)) return 1.3;
  if (bossResistances.includes(playerElement)) return 0.7;
  return 1.0;
};

/**
 * The unified DPS modifier chain. This is the single source of truth for
 * "damage per second" in CyberCache. Every UI surface that shows DPS
 * (gear inspect, loadout screen, dashboard chips, boss prep, LiveTurfDiorama)
 * MUST go through this function — do not compute DPS inline.
 *
 * Chain order (each step is multiplicative, applied to the previous result):
 *   1. Raw DPS  = baseDamage * attackSpeed * (1 + critChance * critDamage)
 *   2. Signature DPS modifier (charges, bursts, etc.)
 *   3. Manufacturer legendary damage multiplier
 *   4. Element matchup vs boss weakness / resistance
 *   5. Pre-fight consumables (TargetPainter, OptimalAmmo)
 *
 * Note: boss resistance is no longer a single multiplicative number in
 * the chain's signature — it is consumed as a `Element[]` array that
 * combines with `bossWeaknesses` to form the 3-state counter table.
 * Callers that previously passed `bossResistance: 0.5` (a flat damage
 * penalty) need to model their effect as a synthetic resistance element
 * or add a new chain step. None of the in-tree callers did this; the
 * sim passed `bossResistance: 1` (no penalty) and the dashboard passed
 * nothing.
 */
export function computeWeaponDps(ctx: DpsContext): number {
  const {
    weapon,
    bossWeaknesses = [],
    bossResistances = [],
    consumables = {},
    legendaryDamageMult = 1,
  } = ctx;
  // Step 1: Raw DPS from base stats.
  const rawDps = weapon.baseDamage * weapon.attackSpeed * (1 + weapon.critChance * weapon.critDamage);
  // Step 2: Signature mechanic. We pass through a 1.0 multiplier here;
  // the full signature-reload calculation lives in bossSimulator. When the
  // signature is extracted into its own module (PR E), this becomes a
  // direct call. For now the chain correctly accounts for everything except
  // ammo-windows — that loss is acceptable for non-boss DPS displays.
  const signatureDps = rawDps;
  // Step 3: Manufacturer legendary damage multiplier.
  const legendaryDps = signatureDps * legendaryDamageMult;
  // Step 4: Element matchup. 3-state counter table: weakness = 1.3×,
  // resistance = 0.7×, otherwise = 1.0×. The "vs standard" baseline
  // is the otherwise branch (1.0× for every element).
  const elemMatch = counterElementMultiplier(weapon.element, bossWeaknesses, bossResistances);
  const elementalDps = legendaryDps * elemMatch;
  // Step 5: Pre-fight consumables. TargetPainter is +15% DPS (covers the
  // +20% crit), OptimalAmmo is +8% DPS (slight attack-speed bump).
  const consumableMult = (1 + (consumables.TargetPainter ?? 0) * 0.15) * (1 + (consumables.OptimalAmmo ?? 0) * 0.08);
  return elementalDps * consumableMult;
}

/**
 * "Standard target" DPS: vs a target with no weakness, no resistance, no
 * consumables, no legendary bonus. Used by the gear inspect and loadout
 * screen so the player sees the raw weapon contribution without target
 * context.
 *
 * Under PR D, "vs standard" means: no element multiplier at all (1.0×
 * for every element). This replaces the legacy flesh-fallback semantics
 * where Fire-vs-flesh returned 1.3×.
 */
export function computeStandardDps(weapon: Weapon, legendaryDamageMult = 1): number {
  return computeWeaponDps({ weapon, legendaryDamageMult });
}

/**
 * Sum DPS across a weapon set, used by the dashboard chips and the boss
 * preparation screen. Boss-relative when boss context is provided.
 */
export function computeLoadoutDps(
  weapons: Weapon[],
  bossWeaknesses?: Element[],
  bossResistances?: Element[],
  consumables?: DpsContext['consumables'],
): number {
  return weapons.reduce(
    (sum, weapon) => sum + computeWeaponDps({ weapon, bossWeaknesses, bossResistances, consumables }),
    0,
  );
}

/** A short human label for the active DPS context (for UI display). */
export function describeDpsContext(
  weapon: Weapon,
  context: { bossWeaknesses?: Element[]; bossResistances?: Element[]; consumables?: DpsContext['consumables'] },
): string {
  const parts: string[] = [];
  if (context.bossWeaknesses?.length) parts.push(`vs ${context.bossWeaknesses[0]}-weak`);
  else if (context.bossResistances?.length) parts.push(`vs ${context.bossResistances[0]}-resist`);
  else parts.push('vs standard target');
  if (context.consumables?.TargetPainter) parts.push('+TargetPainter');
  if (context.consumables?.OptimalAmmo) parts.push('+OptimalAmmo');
  parts.push(String(weapon.manufacturer));
  return parts.join(' · ');
}
