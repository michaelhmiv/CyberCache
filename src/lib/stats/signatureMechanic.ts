/**
 * Signature mechanic — per-weapon DPS modifier.
 *
 * Each weapon type has a "signature" — a per-weapon pattern that
 * affects how it deals damage over a fight window (overheat cycles,
 * precision windows, ramp-sustain beams, etc.). The signature
 * is a property of the weapon, not the loadout, so it lives in
 * the chain (not in the sim).
 *
 * The signature is consumed as a single multiplicative `dpsMult`
 * in the chain's step 2. The other fields returned by
 * `applySignatureMechanic` (statusMult, armorBreakMult,
 * staggerAttempts) are exposed for non-DPS consumers — the sim
 * uses them for shield/armor break math and stagger attempts.
 *
 * The signature `mechanic` field on a weapon is a string identifier.
 * Each case in the switch is the canonical implementation. New
 * weapon types should add a new case here (not inline at the call
 * site).
 */

import type { Weapon } from '@/types/items';
import { getDpsConsumableEffectMap } from '@/constants/consumables';

export interface SignatureMechanicResult {
  /** Multiplicative DPS modifier (1.0 = neutral). */
  dpsMult: number;
  /** Multiplicative status-effect modifier (1.0 = neutral). */
  statusMult: number;
  /** Multiplicative armor-break modifier (1.0 = neutral). */
  armorBreakMult: number;
  /** Number of stagger attempts in the fight window. */
  staggerAttempts: number;
}

const NEUTRAL: SignatureMechanicResult = { dpsMult: 1, statusMult: 1, armorBreakMult: 1, staggerAttempts: 0 };

/**
 * Apply the weapon's signature mechanic to a fight window.
 *
 * @param weapon The weapon (may be null — caller decides what to do)
 * @param fullDuration Seconds the weapon is actively firing (output of `calculateAmmoWindows`)
 * @param reloadDuration Seconds the weapon is in reload (output of `calculateAmmoWindows`)
 * @param fightDuration Total fight window in seconds (default 30s for boss fights)
 */
export function applySignatureMechanic(
  weapon: Weapon | null,
  fullDuration: number,
  reloadDuration: number,
  fightDuration: number,
): SignatureMechanicResult {
  if (!weapon) return NEUTRAL;

  const mechanic = (weapon as unknown as { signatureMechanic?: string }).signatureMechanic || '';

  switch (mechanic) {
    case 'sidearm_recovery':
      // Pistol: minimal reload penalty
      return { dpsMult: 1, statusMult: 1, armorBreakMult: 1, staggerAttempts: 0 };

    case 'overheat': {
      // SMG: 8s active at 1.5x, 3s cooldown at 0.1x
      const cycle = 11; // 8 + 3
      const cycles = fightDuration / cycle;
      const activeRatio = (cycles * 8) / fightDuration;
      const cooldownRatio = (cycles * 3) / fightDuration;
      const avgMult = activeRatio * 1.5 + cooldownRatio * 0.1;
      return { dpsMult: avgMult, statusMult: 1.2, armorBreakMult: 1, staggerAttempts: 0 };
    }

    case 'multi_proc': {
      // Shotgun: 8 pseudo-pellets, higher effective status
      return { dpsMult: 1, statusMult: 2.2, armorBreakMult: 1.25, staggerAttempts: 0 };
    }

    case 'precision_window': {
      // Sniper: first 3s of each phase +40%
      const phases = 3; // shield, armor, health (approx)
      const bonusTime = Math.min(phases * 3, fightDuration);
      const avgMult = 1 + (bonusTime / fightDuration) * 0.4;
      return { dpsMult: avgMult, statusMult: 1, armorBreakMult: 1, staggerAttempts: 0 };
    }

    case 'reload_lock_stagger': {
      // Launcher: each shot is a stagger attempt, low sustained DPS
      const shots = Math.floor(fightDuration / 6); // 2s mag + 4s reload
      return { dpsMult: 0.85, statusMult: 1.2, armorBreakMult: 1.3, staggerAttempts: shots };
    }

    case 'ramp_sustain': {
      // Beam: ramps from 0.3 to 1.5 over 10s, avg ~0.9 over long fights
      const avgMult = fightDuration > 20 ? 1.1 : 0.85;
      return { dpsMult: avgMult, statusMult: 1.15, armorBreakMult: 1, staggerAttempts: 0 };
    }

    default:
      return NEUTRAL;
  }
}

/**
 * DPS-affecting consumable map, derived from `src/constants/consumables.ts`.
 * The consumable definition table is the source of truth for new DPS items;
 * do not add a second hardcoded DPS item list here.
 */
export const DPS_CONSUMABLE_EFFECTS: Record<string, number> = getDpsConsumableEffectMap();
