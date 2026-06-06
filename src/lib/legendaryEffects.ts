import { Weapon } from '../types/items';
import { LEGENDARY_EFFECTS } from '../constants/legendaryEffects';

/**
 * Tier 1: Simple stat modifiers
 */
export function applyLegendaryEffects(
  weapon: Weapon | null,
  pityCount: number = 0
): { damageMult: number; survivalMult: number; shieldBreakMult: number; armorBreakMult: number } {
  if (!weapon?.legendaryEffectId) {
    return { damageMult: 1, survivalMult: 1, shieldBreakMult: 1, armorBreakMult: 1 };
  }

  const effect = LEGENDARY_EFFECTS.find(e => e.id === weapon.legendaryEffectId);
  if (!effect) {
    return { damageMult: 1, survivalMult: 1, shieldBreakMult: 1, armorBreakMult: 1 };
  }

  let damageMult = 1;
  let survivalMult = 1;
  let shieldBreakMult = 1;
  let armorBreakMult = 1;

  switch (effect.id) {
    case 'glass_sun':
      // +50% Fire damage, -30% shield effectiveness
      if (weapon.element === 'Fire') {
        damageMult = 1.5;
      }
      survivalMult = 0.7;
      break;

    case 'ricochet_gospel':
      // 40% bounce damage on crit (average: +16% DPS assuming 40% crit)
      damageMult = 1 + (weapon.critChance * 0.4);
      break;

    case 'warranty_void':
      // +2% damage per pity count, cap +20%
      damageMult = 1 + Math.min(0.20, pityCount * 0.02);
      break;

    case 'debt_collector':
      // Already handled in pity system (win chance bonus)
      break;

    case 'armor_eater':
      // +20% armor break on Corrosive weapons
      if (weapon.element === 'Corrosive') {
        armorBreakMult = 1.2;
      }
      break;

    case 'kickback':
      // Every 7th hit = 300% damage (average: +28.6% DPS)
      damageMult = 1 + (1/7) * 2.0;
      break;

    case 'overclocked':
      // +25% attack speed, -10% crit chance (net ~+15% DPS)
      damageMult = 1.15;
      break;

    case 'echo_chamber':
      // 30% chance to re-apply status (average: +30% status damage)
      damageMult = 1.3;
      break;

    case 'bad_decision':
      // Hidden win chance (handled in BossPrepModal), +25% credit reward
      // Credit bonus handled in executeBossAttempt
      break;

    default:
      // Tier 2+ effects not yet implemented
      break;
  }

  return { damageMult, survivalMult, shieldBreakMult, armorBreakMult };
}

/**
 * Check if weapon has Bad Decision (hides win chance)
 */
export function hasBadDecision(weapon: Weapon | null): boolean {
  return weapon?.legendaryEffectId === 'bad_decision';
}

/**
 * Apply Bad Decision credit bonus (+25% on win)
 */
export function applyBadDecisionBonus(creditsDelta: number, weapon: Weapon | null): number {
  if (weapon?.legendaryEffectId === 'bad_decision' && creditsDelta > 0) {
    return Math.floor(creditsDelta * 1.25);
  }
  return creditsDelta;
}
