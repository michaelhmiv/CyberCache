/**
 * Combat damage contract — the pure math layer for "hunter vs monster"
 * and "monster vs hunter" damage rolls. No state, no React, no Zustand.
 * Everything in this module is referentially transparent and unit-testable.
 *
 * Where the math lives vs where it's used:
 *   - Helpers in this file are called by:
 *     (a) the 3s idle ticker in `src/store/slices/idleTickerSlice.ts` to
 *         apply per-tick monster damage to the hunter (PR 2),
 *     (b) the action stage renderer in
 *         `src/lib/activity/actionAnimationRenderer.ts` to display the
 *         per-tick damage number on the enemy HP bar (PR 4),
 *     (c) the boss fight animation in
 *         `src/lib/animation/fightTimeline.ts` after PR 6 turns it into
 *         a real tick loop.
 *
 * Hard rules for this file:
 *   - No imports from `@/store`, `@/components`, or `@/lib/api`.
 *   - No `Math.random` for damage values. The caller passes a seeded
 *     `rng` so the test suite can pin outcomes.
 *   - No persistence. The caller persists the result.
 */
import type { Element } from '../../types/game';
import { ConsumableType } from '../../types/game';
import type { MonsterDef } from '../../constants/monsters';

/** Minimal weapon shape the contract needs to compute damage. */
export interface WeaponDamageSource {
  /** Effective DPS, already through the modifier chain. See `dpsChain.ts`. */
  effectiveDps: number;
  /** Optional element for elemental damage bonuses. */
  element?: Element;
}

export interface HunterSurvivalStats {
  /** Current max HP. Mirror of `computePlayerMaxHp` in `fightTimeline.ts`. */
  maxHp: number;
  /** Optional shield HP that absorbs damage before HP. */
  shieldHp: number;
  /** 0-1 dodge chance. Default 0. */
  dodgeChance?: number;
  /** 0-1 elemental resistance. Default 0. */
  elementalResist?: number;
  /** 0-1 damage mitigation from equipped shield (reduces all incoming damage). */
  mitigation?: number;
  /** Shield element — provides extra resistance when matching monster element. */
  shieldElement?: Element;
}

/**
 * Damage roll from the hunter to a single monster. The result is
 * `max(1, floor(effectiveDps * TICK_SECONDS / monster.defense * variance))`.
 * The minimum of 1 keeps the kill-feel: even a fully-overmatched hit
 * connects, which matches the "hunter always progresses" loop.
 *
 * `effectiveDps` is per-second damage. The 3s tick window means we
 * apply 3 seconds of DPS per tick (multiply, not divide — Phase 1c).
 */
export function computePlayerDamageVsMonster(
  weapon: WeaponDamageSource,
  monster: MonsterDef,
  rng: () => number = Math.random
): number {
  if (weapon.effectiveDps <= 0) return 0;
  const TICK_SECONDS = 3;
  const variance = 0.85 + rng() * 0.3; // 0.85x to 1.15x
  // Defense scales mitigation more aggressively: def 6 ≈ 13% reduction,
  // def 50 ≈ 55%, def 200 ≈ 75% (capped).
  const defenseMitigation = 1 - Math.min(0.75, monster.defense / (monster.defense + 40));
  const base = weapon.effectiveDps * TICK_SECONDS * variance * defenseMitigation;
  return Math.max(1, Math.floor(base));
}

/**
 * Damage roll from a single monster to the hunter. Shield absorbs first.
 * Returns the *post-mitigation* hit value; the caller splits shield vs HP.
 */
export interface MonsterHitResult {
  /** Damage absorbed by shield (capped at current shieldHp). */
  shieldAbsorbed: number;
  /** Damage applied to HP (after shield is exhausted). */
  hpDamage: number;
  /** True if the monster's attack missed (dodged). */
  missed: boolean;
  /** True if the hit was fully absorbed by shield (hpDamage === 0). */
  fullyBlocked: boolean;
}

export function computeMonsterDamageVsHunter(
  monster: MonsterDef,
  hunter: HunterSurvivalStats,
  rng: () => number = Math.random
): MonsterHitResult {
  const accuracy = monster.accuracy ?? 0.85;
  const dodgeChance = hunter.dodgeChance ?? 0;
  if (rng() > accuracy - dodgeChance) {
    return { shieldAbsorbed: 0, hpDamage: 0, missed: true, fullyBlocked: false };
  }
  const variance = 0.85 + rng() * 0.3; // 0.85x to 1.15x

  // Elemental resistance: base resist + shield-element match bonus.
  let elementalResist = hunter.elementalResist ?? 0;
  if (hunter.shieldElement && monster.element === hunter.shieldElement) {
    elementalResist += 0.15; // matching shield element grants +15% resist
  }
  const elementMult = monster.element ? Math.max(0.1, 1 - elementalResist) : 1;

  // Shield mitigation: flat % damage reduction (capped at 80%).
  const mitigation = Math.min(0.8, hunter.mitigation ?? 0);
  const mitigationMult = 1 - mitigation;

  const raw = Math.floor(monster.attackPower * variance * elementMult * mitigationMult);
  const shieldAbsorbed = Math.min(hunter.shieldHp, raw);
  const hpDamage = Math.max(0, raw - shieldAbsorbed);
  return {
    shieldAbsorbed,
    hpDamage,
    missed: false,
    fullyBlocked: shieldAbsorbed > 0 && hpDamage === 0,
  };
}

/**
 * Auto-eat threshold resolution. When the hunter's HP falls below the
 * threshold, the next medkit (or shield cell, or nano swarm — in that
 * priority order) is consumed. This function does NOT mutate state; it
 * returns the consumable id to eat, or `null` if no action is needed.
 *
 * The threshold defaults to 0.7 (eat at 70% of max HP). It's exposed as
 * a parameter so the action tab can show a "auto-eat at 60% / 70% / 80%"
 * setting in a future PR.
 */
export interface ConsumableInventory {
  [id: string]: number;
}

export interface AutoEatDecision {
  /** The consumable to consume next, or null if nothing to do. */
  eatConsumable: string | null;
  /** HP threshold that triggered the decision, or null if not triggered. */
  reason: 'below_threshold' | 'no_consumables' | 'no_action_needed';
}

const AUTO_EAT_PRIORITY: ConsumableType[] = [
  // Shield Cell still uses reactive auto-eat for shield restore.
  // Med Kit is now a proactive buffer (set on roaming start, not reactive).
  // Nano Swarm is now per-tick regen (started on roaming start).
  // Adrenaline Shot is a reactive DPS burst (triggered on low HP).
  ConsumableType.ShieldCell,
  ConsumableType.AdrenalineShot,
];

export function decideAutoEat(
  currentHp: number,
  maxHp: number,
  consumables: ConsumableInventory,
  threshold: number = 0.7
): AutoEatDecision {
  if (currentHp >= maxHp * threshold) {
    return { eatConsumable: null, reason: 'no_action_needed' };
  }
  for (const id of AUTO_EAT_PRIORITY) {
    if ((consumables[id] ?? 0) > 0) {
      return { eatConsumable: id, reason: 'below_threshold' };
    }
  }
  return { eatConsumable: null, reason: 'no_consumables' };
}

/**
 * Medkit heal amount. Mirror of the value used in
 * `bossSimulator.ts:medkitHealing = medkits * 150`. Centralizing it here
 * so PR 6 (boss fight medkit attrition) and PR 2 (idle auto-eat) read
 * the same constant.
 */
export const MEDKIT_HEAL_AMOUNT = 150;
export const SHIELD_CELL_AMOUNT = 100;

export function computeHealAmount(consumableId: string): number {
  switch (consumableId) {
    case ConsumableType.MedKitRefined:
      return 260; // legacy — still used by boss sim
    case ConsumableType.MedKit:
      return 0; // Med Kit is now a proactive buffer, not a reactive heal
    case ConsumableType.ShieldCell:
      return SHIELD_CELL_AMOUNT;
    case ConsumableType.NanoSwarm:
      return 0; // Nano Swarm is now per-tick regen, handled by survivalSlice
    case ConsumableType.AdrenalineShot:
      return 0; // Adrenaline is a DPS burst, not a heal
    default:
      return 0;
  }
}

/**
 * Med Kit HP buffer amount. The buffer is set proactively when roaming
 * starts and absorbs damage after shield but before HP.
 */
export const MEDKIT_BUFFER_AMOUNT = 150;

export function computeMedKitBuffer(consumableId: string): number {
  switch (consumableId) {
    case ConsumableType.MedKit:
      return MEDKIT_BUFFER_AMOUNT;
    case ConsumableType.MedKitRefined:
      return 260; // legacy
    default:
      return 0;
  }
}

/**
 * Compute the hunter's max HP. Mirrors `computePlayerMaxHp` in
 * `fightTimeline.ts:9-10`. The formula is identical and must stay in
 * lockstep — `test/damageContract.test.ts` asserts the parity.
 *
 *   maxHp = 500 + level*40 + shieldHp + 200 + level*20
 *         = 700 + level*60 + shieldHp
 */
export function computeHunterMaxHp(playerLevel: number, shieldHp: number): number {
  return 700 + playerLevel * 60 + shieldHp;
}
