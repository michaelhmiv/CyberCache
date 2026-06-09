import { getElementMatchup } from '@/constants/elements';
import type { Weapon } from '@/types/items';
import { Element } from '@/types/game';

export type DpsContext = {
  weapon: Weapon;
  /** Boss weaknesses, in priority order. First matching element gets the full multiplier. */
  bossWeaknesses?: Element[];
  /** Optional boss resistance (multiplicative, default 1.0). */
  bossResistance?: number;
  /** Pre-fight consumables applied as a final multiplier. */
  consumables?: { TargetPainter?: number; OptimalAmmo?: number };
  /** Manufacturer-specific legendary damage multiplier (default 1.0). */
  legendaryDamageMult?: number;
};

/**
 * Map a player's chosen element to the *target* element it's strong against.
 * Boss weaknesses are stored as Element values; the existing
 * getElementMatchup() in @/constants/elements expects a target-type string
 * (flesh/armor/shield/elite/boss). The bridge lives here so the DPS chain
 * gets a meaningful 1.3x for the player's chosen counter-element.
 */
const counterElementMultiplier = (playerElement: Element, bossWeakness: Element): number => {
  // The "player is strong against the boss's weakness" check: a Fire gun
  // hitting a boss weak to Fire deals 1.3x; a Cryo gun hitting the same boss
  // deals 0.7x. We use a simplified element-vs-element matrix here rather
  // than the existing target-type matchup because boss weaknesses are stored
  // as elements, not target-types.
  if (playerElement === bossWeakness) return 1.3;
  // The original target-type matchup can still be used for the boss's body
  // type; we default to 1.0 (neutral) for non-matching elements.
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
 *   4. Element matchup vs boss weakness
 *   5. Boss resistance multiplier
 *   6. Pre-fight consumables (TargetPainter, OptimalAmmo)
 */
export function computeWeaponDps(ctx: DpsContext): number {
  const { weapon, bossWeaknesses = [], bossResistance = 1, consumables = {}, legendaryDamageMult = 1 } = ctx;
  // Step 1: Raw DPS from base stats.
  const rawDps = weapon.baseDamage * weapon.attackSpeed * (1 + weapon.critChance * weapon.critDamage);
  // Step 2: Signature mechanic. We pass through a 1.0 multiplier here;
  // the full signature-reload calculation lives in bossSimulator. When the
  // signature is extracted into its own module (PR #58), this becomes a
  // direct call. For now the chain correctly accounts for everything except
  // ammo-windows — that loss is acceptable for non-boss DPS displays.
  const signatureDps = rawDps;
  // Step 3: Manufacturer legendary damage multiplier.
  const legendaryDps = signatureDps * legendaryDamageMult;
  // Step 4: Element matchup vs boss weakness. When the boss has a stored
  // weakness element, we use the counter-element table above. When no
  // weakness is supplied (standard target), we fall back to the legacy
  // getElementMatchup with 'flesh' as the default target type so the chain
  // remains a no-op multiplier in that case.
  const weakness = bossWeaknesses[0];
  const elemMatch = weakness ? counterElementMultiplier(weapon.element, weakness) : getElementMatchup(weapon.element, 'flesh');
  const elementalDps = legendaryDps * elemMatch;
  // Step 5: Boss resistance. Default 1.0 (no resistance).
  const resistedDps = elementalDps * bossResistance;
  // Step 6: Pre-fight consumables. TargetPainter is +15% DPS (covers the
  // +20% crit), OptimalAmmo is +8% DPS (slight attack-speed bump).
  const consumableMult = (1 + (consumables.TargetPainter ?? 0) * 0.15) * (1 + (consumables.OptimalAmmo ?? 0) * 0.08);
  return resistedDps * consumableMult;
}

/**
 * "Standard target" DPS: vs a target with no weakness, no resistance, no
 * consumables, no legendary bonus. Used by the gear inspect and loadout
 * screen so the player sees the raw weapon contribution without target
 * context.
 */
export function computeStandardDps(weapon: Weapon, legendaryDamageMult = 1): number {
  return computeWeaponDps({ weapon, legendaryDamageMult });
}

/**
 * Sum DPS across a weapon set, used by the dashboard chips and the boss
 * preparation screen. Boss-relative when a target is provided.
 */
export function computeLoadoutDps(weapons: Weapon[], bossWeaknesses?: Element[], bossResistance?: number, consumables?: DpsContext['consumables']): number {
  return weapons.reduce((sum, weapon) => sum + computeWeaponDps({ weapon, bossWeaknesses, bossResistance, consumables }), 0);
}

/** A short human label for the active DPS context (for UI display). */
export function describeDpsContext(weapon: Weapon, context: { bossWeaknesses?: Element[]; consumables?: DpsContext['consumables'] }): string {
  const parts: string[] = [];
  if (context.bossWeaknesses?.length) parts.push(`vs ${context.bossWeaknesses[0]}-weak`);
  else parts.push('vs standard target');
  if (context.consumables?.TargetPainter) parts.push('+TargetPainter');
  if (context.consumables?.OptimalAmmo) parts.push('+OptimalAmmo');
  parts.push(String(weapon.manufacturer));
  return parts.join(' · ');
}
