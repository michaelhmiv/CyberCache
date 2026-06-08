import { Weapon } from '../types/items';
import { LEGENDARY_EFFECTS } from '../constants/legendaryEffects';

/**
 * Apply legendary effect modifiers to boss simulation.
 * All 25 effects are now wired — see MECHANICS.md for full reference.
 */
export function applyLegendaryEffects(
  weapon: Weapon | null,
  pityCount: number = 0,
  enemyKillCount: number = 0,
  _playerCredits: number = 0,
): {
  damageMult: number;
  survivalMult: number;
  shieldBreakMult: number;
  armorBreakMult: number;
  scrapMult: number;
  creditMult: number;
  extraLootChance: number;
  consumableRefundChance: number;
} {
  const defaults = {
    damageMult: 1,
    survivalMult: 1,
    shieldBreakMult: 1,
    armorBreakMult: 1,
    scrapMult: 1,
    creditMult: 1,
    extraLootChance: 0,
    consumableRefundChance: 0,
  };

  if (!weapon?.legendaryEffectId) return defaults;

  const effect = LEGENDARY_EFFECTS.find((e) => e.id === weapon.legendaryEffectId);
  if (!effect) return defaults;

  let damageMult = 1;
  let survivalMult = 1;
  let shieldBreakMult = 1;
  let armorBreakMult = 1;
  let scrapMult = 1;
  let creditMult = 1;
  let extraLootChance = 0;
  let consumableRefundChance = 0;

  switch (effect.id) {
    // ── TIER 1 (Boss Tier 1+) ──

    case 'glass_sun':
      if (weapon.element === 'Fire') damageMult = 1.5;
      survivalMult = 0.7;
      break;

    case 'ricochet_gospel':
      damageMult = 1 + weapon.critChance * 0.4;
      break;

    case 'warranty_void':
      damageMult = 1 + Math.min(0.2, pityCount * 0.02);
      break;

    case 'debt_collector':
      // Pity win chance bonus handled in pity system
      break;

    case 'armor_eater':
      if (weapon.element === 'Corrosive') armorBreakMult = 1.2;
      break;

    case 'kickback':
      damageMult = 1 + (1 / 7) * 2.0; // avg +28.6%
      break;

    case 'overclocked':
      damageMult = 1.15;
      break;

    case 'echo_chamber':
      damageMult = 1.3;
      break;

    case 'bad_decision':
      // Win chance hidden + credit bonus handled separately
      creditMult = 1.25;
      break;

    case 'the_accountant':
      // Every 100 kills bumps next drop rarity tier
      // For simulation: small DPS bonus from better drops over time
      if (enemyKillCount > 0) {
        const tiers = Math.floor(enemyKillCount / 100);
        damageMult = 1 + Math.min(0.15, tiers * 0.03); // cap +15%
      }
      break;

    case 'thunder_receipt':
      // Shock shield break refunds ordnance — in sim: +25% shield break
      if (weapon.element === 'Shock') shieldBreakMult = 1.25;
      break;

    // ── TIER 2 (Boss Tier 4+) ──

    case 'second_opinion':
      // Double loot roll on victory: +50% effective loot
      extraLootChance = 0.5;
      break;

    case 'salvage_rights':
      scrapMult = 1.5;
      break;

    case 'borrowed_time':
      // Auto-consume 1 MedKit to pass survival check once
      survivalMult = 1.25; // effective survival boost
      break;

    case 'vampiric_ledger':
      // 5% of damage as bonus credits
      creditMult = 1 + 0.05; // small bonus
      break;

    case 'insurance_fraud_weapon':
      // 50% consumable refund on defeat
      consumableRefundChance = 0.5;
      break;

    case 'market_crash':
      // 4x scrap value
      scrapMult = 4.0;
      break;

    case 'stable_loop':
      // 25% faster action skill charge → more ordnance use
      // Sim approximation: +10% DPS from more frequent abilities
      damageMult = 1.1;
      break;

    case 'phase_shifter':
      // First hit per phase ignores 40% of shield/armor
      shieldBreakMult = 1.15;
      armorBreakMult = 1.15;
      break;

    case 'hot_swapper':
      // Secondary weapon contributes 60% instead of 30%
      // Handled in bossSimulator by checking this weapon
      // For sim: boost applied where secondary is checked
      damageMult = 1.0; // actual multiplier applied in bossSimulator
      break;

    // ── TIER 3 (Boss Tier 7+) ──

    case 'chain_lightning':
      // Shock procs chain: +20% effective shock damage
      if (weapon.element === 'Shock') damageMult = 1.2;
      shieldBreakMult = 1.15;
      break;

    case 'molten_core':
      // Fire DoT stacks 5x, each -10% boss healing
      if (weapon.element === 'Fire') {
        damageMult = 1.25; // 5 stacks of burn
        armorBreakMult = 1.15; // anti-heal reduces effective armor
      }
      break;

    case 'cryo_stasis':
      // 20% chance mini-stagger → +5% DPS window
      if (weapon.element === 'Cryo') {
        damageMult = 1.1;
      }
      break;

    case 'void_bargain':
      if (weapon.element === 'Void') {
        damageMult = 1.4;
        survivalMult = 0.85; // 5% self-shield damage per hit
      }
      break;

    case 'jackpot':
      // 1 Cache Key fragment per 150 kills — economy bonus
      // No combat effect, but signals loot economy advantage
      break;

    default:
      break;
  }

  return {
    damageMult,
    survivalMult,
    shieldBreakMult,
    armorBreakMult,
    scrapMult,
    creditMult,
    extraLootChance,
    consumableRefundChance,
  };
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

/**
 * Check if weapon has Hot Swapper — secondary contributes 60% not 30%
 */
export function getHotSwapperSecondaryMult(weapon: Weapon | null): number {
  return weapon?.legendaryEffectId === 'hot_swapper' ? 0.6 : 0.3;
}

/**
 * Check for Insurance Fraud — consumable refund on defeat
 */
export function getInsuranceFraudRefundChance(weapon: Weapon | null): number {
  return weapon?.legendaryEffectId === 'insurance_fraud_weapon' ? 0.5 : 0;
}
