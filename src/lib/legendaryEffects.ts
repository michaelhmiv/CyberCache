import { Weapon } from '../types/items';
import { LEGENDARY_EFFECTS } from '../constants/legendaryEffects';

/**
 * Legendary effect wiring — the honest map (see MECHANICS.md §1).
 *
 * Three tiers of implementation exist, and the comments below say which
 * tier each effect is in:
 *
 *   WIRED    — the multiplier returned here is consumed by the boss
 *              simulator / Chef boss path and changes real outcomes.
 *   SIM PROXY — the case here returns a flat multiplier that approximates
 *              the described mechanic inside the boss simulator ONLY.
 *              The described mechanic itself (charge refunds, DoT stacks,
 *              chains, staggers…) does not exist anywhere. Each proxy case
 *              is labelled "SIM PROXY" so nobody mistakes it for the real
 *              mechanic.
 *   ELSEWHERE — the effect is fully implemented, but not through this
 *              function's return value: it lives in the Chef claim/boss
 *              engine or in a Postgres applier, and the case here is a
 *              deliberate no-op with a pointer (debt_collector and
 *              hot_swapper set this pattern in June; the Legendary
 *              Honesty slice extended it to second_opinion,
 *              salvage_rights, market_crash and jackpot).
 *
 * This function used to also return `scrapMult`, `extraLootChance` and
 * `consumableRefundChance`. No caller ever read them — the fields were
 * decorative, and two of the four "dead" effects hid behind them. They
 * were removed in the Legendary Honesty slice; effects that need an
 * economy hook now expose a named helper below instead (the pattern
 * getInsuranceFraudRefundChance / getHotSwapperSecondaryMult set).
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
  creditMult: number;
} {
  const defaults = {
    damageMult: 1,
    survivalMult: 1,
    shieldBreakMult: 1,
    armorBreakMult: 1,
    creditMult: 1,
  };

  if (!weapon?.legendaryEffectId) return defaults;

  const effect = LEGENDARY_EFFECTS.find((e) => e.id === weapon.legendaryEffectId);
  if (!effect) return defaults;

  let damageMult = 1;
  let survivalMult = 1;
  let shieldBreakMult = 1;
  let armorBreakMult = 1;
  let creditMult = 1;

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
      // ELSEWHERE: no-op here by design — the pity system itself applies
      // +3% win chance per loss (cap +30%) in bossSimulator / bossSlice.
      break;

    case 'armor_eater':
      // WIRED for the armor-break half (+20% for Corrosive). The
      // description's "-50% boss healing" half has no counterpart: the
      // boss engine has no healing mechanic to reduce.
      if (weapon.element === 'Corrosive') armorBreakMult = 1.2;
      break;

    case 'kickback':
      damageMult = 1 + (1 / 7) * 2.0; // avg +28.6%
      break;

    case 'overclocked':
      // SIM PROXY (labelled as such since June): the attack-speed ramp /
      // crit decay is modelled as a flat 1.15x damage multiplier.
      damageMult = 1.15;
      break;

    case 'echo_chamber':
      damageMult = 1.3;
      break;

    case 'bad_decision':
      // Win chance hiding + credit bonus handled via hasBadDecision() /
      // applyBadDecisionBonus(); the creditMult here is the wired half.
      creditMult = 1.25;
      break;

    case 'the_accountant':
      // SIM PROXY: the described mechanic (+1 rarity tier on the next
      // drop per 100 kills) does not exist in any drop path. The sim
      // approximates the long-term benefit as a small DPS bonus scaled
      // by kill count, capped at +15%.
      if (enemyKillCount > 0) {
        const tiers = Math.floor(enemyKillCount / 100);
        damageMult = 1 + Math.min(0.15, tiers * 0.03); // cap +15%
      }
      break;

    case 'thunder_receipt':
      // SIM PROXY: no Ordnance / Action Skill charge refund exists.
      // Approximated as +25% shield break for Shock weapons in the sim.
      if (weapon.element === 'Shock') shieldBreakMult = 1.25;
      break;

    // ── TIER 2 (Boss Tier 4+) ──

    case 'second_opinion':
      // ELSEWHERE: implemented in the Chef boss path
      // (processBossAttempt in src/server/chef.ts) — on victory the
      // guaranteed loot roll happens twice, the higher-combatPower
      // weapon is kept and the other is auto-scrapped for real scrap.
      // Detected there via hasSecondOpinion(); no sim output here.
      break;

    case 'salvage_rights':
      // ELSEWHERE: implemented in the Chef roaming claim
      // (processRoamingClaim in src/server/chef.ts) via
      // getSalvageRightsScrapMult() — claim scrap is multiplied by 1.5
      // while this weapon is the primary. No boss-sim output: boss
      // attempts award no scrap.
      break;

    case 'borrowed_time':
      // SIM PROXY: no MedKit is consumed and no survival-fail rescue
      // happens. Approximated as a flat 1.25x survival multiplier.
      survivalMult = 1.25; // effective survival boost
      break;

    case 'vampiric_ledger':
      // SIM PROXY: the described mechanic converts 5% of damage dealt
      // into credits. What is wired (here and in the Chef boss path,
      // which consumes this creditMult) is a flat +5% victory-credit
      // multiplier, independent of damage dealt.
      creditMult = 1 + 0.05; // small bonus
      break;

    case 'insurance_fraud_weapon':
      // ELSEWHERE (wired): the 50% consumable refund on defeat is
      // applied via getInsuranceFraudRefundChance() in the Chef boss
      // path and executeBossAttempt(). No sim multiplier here.
      break;

    case 'market_crash':
      // ELSEWHERE: implemented in cc_recycle_item
      // (db/migrations/0008_legendary_honesty.sql) and its TS mirrors —
      // recycling this weapon awards 4x the standard scrap. There is no
      // market fee anywhere in the market path (listing is free and the
      // seller receives the full price), so the effect is the scrap
      // multiplier only. No sim output here.
      break;

    case 'stable_loop':
      // SIM PROXY: there is no Action Skill charge system to accelerate.
      // Approximated as +10% DPS ("more frequent abilities") in the sim.
      damageMult = 1.1;
      break;

    case 'phase_shifter':
      // SIM PROXY: no per-phase first-hit layer-ignore exists.
      // Approximated as a flat +15% shield/armor break in the sim.
      shieldBreakMult = 1.15;
      armorBreakMult = 1.15;
      break;

    case 'hot_swapper':
      // ELSEWHERE (wired): secondary contributes 60% instead of 30%,
      // applied in bossSimulator via getHotSwapperSecondaryMult().
      damageMult = 1.0; // actual multiplier applied in bossSimulator
      break;

    // ── TIER 3 (Boss Tier 7+) ──

    case 'chain_lightning':
      // SIM PROXY: boss fights are single-target; no proc chains to
      // additional targets exist. Approximated as +20% Shock damage and
      // +15% shield break in the sim.
      if (weapon.element === 'Shock') damageMult = 1.2;
      shieldBreakMult = 1.15;
      break;

    case 'molten_core':
      // SIM PROXY: no Fire DoT stacking exists, and the boss engine has
      // no healing for stacks to reduce. Approximated as +25% Fire
      // damage and +15% armor break in the sim.
      if (weapon.element === 'Fire') {
        damageMult = 1.25; // 5 stacks of burn
        armorBreakMult = 1.15; // anti-heal reduces effective armor
      }
      break;

    case 'cryo_stasis':
      // SIM PROXY: no mini-stagger rolls exist. Approximated as +10%
      // Cryo damage in the sim.
      if (weapon.element === 'Cryo') {
        damageMult = 1.1;
      }
      break;

    case 'void_bargain':
      // PART WIRED / PART PROXY: the +40% Void damage is exact. The
      // drawback (5% chance per hit to damage your own shield) is
      // approximated as a flat 0.85x survival multiplier — no per-hit
      // self-shield damage is simulated.
      if (weapon.element === 'Void') {
        damageMult = 1.4;
        survivalMult = 0.85; // proxy for 5% self-shield damage per hit
      }
      break;

    case 'jackpot':
      // ELSEWHERE: implemented in the Chef roaming claim
      // (processRoamingClaim in src/server/chef.ts) — every 150th
      // kill-cycle kill while this weapon is the primary awards a real
      // Cache Key fragment. Detected there via hasJackpot(). No combat
      // effect, correctly: no sim output here.
      break;

    default:
      break;
  }

  return {
    damageMult,
    survivalMult,
    shieldBreakMult,
    armorBreakMult,
    creditMult,
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

/**
 * Salvage Rights — scrap multiplier for Chef roaming claims while this
 * weapon is the primary (kills with it yield +50% scrap). Consumed by
 * processRoamingClaim in src/server/chef.ts, in the same multiplier
 * stack as gear/skill/activity scrap modifiers.
 */
export function getSalvageRightsScrapMult(weapon: Weapon | null): number {
  return weapon?.legendaryEffectId === 'salvage_rights' ? 1.5 : 1;
}

/**
 * Second Opinion — on boss victory the guaranteed loot roll happens
 * twice; the stronger weapon is kept, the other auto-scrapped.
 * Consumed by processBossAttempt in src/server/chef.ts.
 */
export function hasSecondOpinion(weapon: Weapon | null): boolean {
  return weapon?.legendaryEffectId === 'second_opinion';
}

/**
 * Jackpot — every 150th enemy killed while this weapon is the primary
 * drops a Cache Key fragment. Consumed by processRoamingClaim in
 * src/server/chef.ts (kill-cycle kills).
 */
export function hasJackpot(weapon: Weapon | null): boolean {
  return weapon?.legendaryEffectId === 'jackpot';
}
