import type { Weapon } from '@/types/items';
import { Element } from '@/types/game';
import { applySignatureMechanic, DPS_CONSUMABLE_EFFECTS } from './signatureMechanic';

export type DpsContext = {
  weapon: Weapon;
  /** Boss weaknesses, in priority order. First matching element gets the full counter bonus. */
  bossWeaknesses?: Element[];
  /**
   * Boss resistances (defensive elements that reduce incoming damage).
   * Multiplicative, default empty (= no resistance penalty).
   */
  bossResistances?: Element[];
  /**
   * Pre-fight consumable counts, in `Record<string, number>` shape.
   * The chain only consumes the keys listed in `DPS_CONSUMABLE_EFFECTS`
   * (TargetPainter, OverchargeStim, IncendiaryAmmo, VoidAmmo). Other
   * consumables affect survival/break/loot and stay in the sim.
   */
  consumables?: Record<string, number>;
  /**
   * Manufacturer-specific legendary damage multiplier (default 1.0).
   */
  legendaryDamageMult?: number;
  /**
   * Ammo-window efficiency for this weapon in the active fight.
   * 1.0 = no reload loss, 0.0 = full reload (no firing time).
   * Computed by the sim via `calculateAmmoWindows` and passed in.
   * Default 1.0 (= every fight, the weapon is always firing).
   */
  ammoEfficiency?: number;
  /**
   * Per-weapon boss damage modifier (additive, from weapon affixes).
   * Added as step 7 in the chain.
   */
  bossDamageMod?: number;
};

/**
 * Real counter-element table.
 *
 * 3-state lookup: weakness = 1.3×, resistance = 0.7×, otherwise = 1.0×.
 * The "vs standard" baseline is the otherwise branch (1.0× for every
 * element) — there is no flesh fallback. The chain no longer imports
 * `getElementMatchup`; it only consumes Element arrays.
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
 * Compute the consumable multiplier step. Only the keys listed in
 * `DPS_CONSUMABLE_EFFECTS` contribute; everything else is silently
 * ignored. The shape is `Record<string, number>` so callers can pass
 * the full consumables table without filtering.
 */
function consumableMultiplier(consumables: Record<string, number> | undefined): number {
  if (!consumables) return 1;
  let mult = 1;
  for (const [key, count] of Object.entries(consumables)) {
    const effect = DPS_CONSUMABLE_EFFECTS[key];
    if (effect !== undefined && count > 0) {
      mult *= 1 + effect * count;
    }
  }
  return mult;
}

/**
 * The unified DPS modifier chain. This is the single source of truth for
 * "damage per second" in CyberCache. Every UI surface that shows DPS
 * (gear inspect, loadout screen, dashboard chips, boss prep, LiveTurfDiorama)
 * MUST go through this function — do not compute DPS inline.
 *
 * Chain order (each step is multiplicative, applied to the previous result):
 *   1. Raw DPS       = baseDamage * attackSpeed * (1 + critChance * critDamage)
 *   2. Signature DPS modifier (charges, bursts, etc. — see signatureMechanic)
 *   3. Manufacturer legendary damage multiplier
 *   4. Element matchup vs boss weakness / resistance (3-state counter table)
 *   5. Ammo-window efficiency (caller-provided, default 1.0)
 *   6. Pre-fight consumables (DPS-relevant subset, see DPS_CONSUMABLE_EFFECTS)
 *   7. Per-weapon boss damage modifier (from weapon affixes)
 *
 * The chain knows nothing about per-slot contribution (secondary × 0.3,
 * heavy × 0.5) or risk/skill bonuses — those are loadout-decision and
 * player-level concerns that the sim multiplies on top of the chain.
 */
export function computeWeaponDps(ctx: DpsContext): number {
  const {
    weapon,
    bossWeaknesses = [],
    bossResistances = [],
    consumables = {},
    legendaryDamageMult = 1,
    ammoEfficiency = 1,
    bossDamageMod = 0,
  } = ctx;
  // Step 1: Raw DPS from base stats.
  const rawDps = weapon.baseDamage * weapon.attackSpeed * (1 + weapon.critChance * weapon.critDamage);
  // Step 1.5: Status effect contribution — flat DPS multiplier.
  // A full per-tick DoT system is a follow-up feature. For now, status
  // chance and damage contribute as (1 + chance * damage * 0.3).
  const statusMult = 1 + weapon.statusChance * weapon.statusDamage * 0.3;
  // Step 2: Signature mechanic. The chain now consumes the signature
  // directly via signatureMechanic.ts. The `fullDuration` and
  // `reloadDuration` are 0 in the no-ammo-window default (the chain
  // doesn't model ammo windows itself; that's a caller concern in
  // step 5). For weapons with no signature, this returns 1.0×.
  const sig = applySignatureMechanic(weapon, 0, 0, 30);
  const signatureDps = rawDps * statusMult * sig.dpsMult;
  // Step 3: Manufacturer legendary damage multiplier.
  const legendaryDps = signatureDps * legendaryDamageMult;
  // Step 4: Element matchup. 3-state counter table.
  const elemMatch = counterElementMultiplier(weapon.element, bossWeaknesses, bossResistances);
  const elementalDps = legendaryDps * elemMatch;
  // Step 5: Ammo-window efficiency. Caller pre-computes this from
  // `calculateAmmoWindows`; the chain just multiplies it in.
  const ammoDps = elementalDps * ammoEfficiency;
  // Step 6: Pre-fight consumables. Only the keys in
  // DPS_CONSUMABLE_EFFECTS contribute; everything else is a no-op.
  const consumableDps = ammoDps * consumableMultiplier(consumables);
  // Step 7: Per-weapon boss damage modifier (from weapon affixes).
  return consumableDps * (1 + bossDamageMod);
}

/**
 * "Standard target" DPS: vs a target with no weakness, no resistance, no
 * consumables, no legendary bonus, infinite ammo, no signature loss.
 * Used by the gear inspect and loadout screen so the player sees the
 * raw weapon contribution without target context.
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
  consumables?: Record<string, number>,
): number {
  const bossContext = Boolean(bossWeaknesses?.length || bossResistances?.length);
  return weapons.reduce(
    (sum, weapon) => sum + computeWeaponDps({
      weapon,
      bossWeaknesses,
      bossResistances,
      consumables,
      bossDamageMod: bossContext ? weapon.bossDamageMod : 0,
    }),
    0,
  );
}

/** Explicit boss-relative loadout DPS, including per-weapon bossDamageMod. */
export function computeBossRelativeDps(
  weapons: Weapon[],
  bossWeaknesses: Element[] = [],
  bossResistances: Element[] = [],
  consumables?: Record<string, number>,
): number {
  return weapons.reduce(
    (sum, weapon) => sum + computeWeaponDps({
      weapon,
      bossWeaknesses,
      bossResistances,
      consumables,
      bossDamageMod: weapon.bossDamageMod,
    }),
    0,
  );
}

/** A short human label for the active DPS context (for UI display). */
export function describeDpsContext(
  weapon: Weapon,
  context: { bossWeaknesses?: Element[]; bossResistances?: Element[]; consumables?: Record<string, number> },
): string {
  const parts: string[] = [];
  if (context.bossWeaknesses?.length) parts.push(`vs ${context.bossWeaknesses[0]}-weak`);
  else if (context.bossResistances?.length) parts.push(`vs ${context.bossResistances[0]}-resist`);
  else parts.push('vs standard target');
  if (context.consumables) {
    for (const key of Object.keys(DPS_CONSUMABLE_EFFECTS)) {
      if (context.consumables[key]) parts.push(`+${key}`);
    }
  }
  parts.push(String(weapon.manufacturer));
  return parts.join(' · ');
}
