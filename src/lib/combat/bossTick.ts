/**
 * bossTick — pure per-tick model for the live boss fight.
 *
 * PR 6 turns the boss fight from a one-shot sim (`executeBossAttempt`
 * in `bossSimulator.ts`) into a real, multi-tick encounter driven by
 * the 3-second idle ticker. The ticker calls this function once per
 * tick to advance the fight by 3 seconds of game time.
 *
 * The model is intentionally simple — it does NOT model phases,
 * mechanics, scoring, or pity. The one-shot sim already does all of
 * that for the Chef-resolved attempt (see BossEncounterPanel). What
 * it does model is the *attrition loop* the
 * user actually feels: medkits drain as auto-eat fires, the boss HP
 * bar ticks down, the player HP bar ticks down, and the fight ends
 * in either victory (boss HP ≤ 0) or death (player HP ≤ 0).
 *
 * Per-tick math:
 *   bossHpDelta = playerDps * TICK_MS / 1000
 *   playerHpDelta = bossDps * TICK_MS / 1000
 *   shield absorbs up to its remaining value
 *   if playerHp < maxHp * autoEatThreshold AND medkits > 0:
 *     consume one medkit, heal `medkitHeal` (default 40% maxHp)
 *
 * Pure function. No store reads, no Date.now(), no Math.random().
 * The caller (idle ticker) handles all side effects.
 */
import type { BossDef } from '@/types/boss';

export const BOSS_TICK_MS = 3000;
export const DEFAULT_MEDKIT_HEAL_PCT = 0.4;

export type BossTickStatus = 'ongoing' | 'victory' | 'defeat';

export interface BossTickInput {
  /** The boss being fought. */
  boss: BossDef;
  /** Current boss HP (≤ boss.health). */
  currentBossHp: number;
  /** Current player HP (≤ maxHp). */
  currentPlayerHp: number;
  /** Current player shield HP (≤ some shield cap; usually 100). */
  currentPlayerShield: number;
  /** Player's effective DPS (from loadout). Must be ≥ 0. */
  playerDps: number;
  /** Boss's per-second damage output (boss.dps). Must be ≥ 0. */
  bossDps: number;
  /** Maximum player HP. */
  maxPlayerHp: number;
  /** Auto-eat threshold fraction (0-1). When playerHp/maxPlayerHp
   *  drops below this, consume a medkit. */
  autoEatThreshold: number;
  /** Number of medkits the player has available to auto-eat. */
  medkitsAvailable: number;
  /** Per-medkit heal amount (HP). Default = 40% maxPlayerHp. */
  medkitHeal?: number;
  /** Tick length in ms. Default 3000. */
  tickMs?: number;
}

export interface BossTickResult {
  bossHp: number;
  playerHp: number;
  playerShield: number;
  /** Medkits consumed this tick. */
  medkitsConsumed: number;
  /** Total damage dealt to the boss this tick. */
  damageDealt: number;
  /** Total damage dealt to the player this tick (post-shield). */
  damageTaken: number;
  status: BossTickStatus;
}

/**
 * Advance the live boss fight by one tick.
 *
 * @param input - fight state + per-tick deltas
 * @returns new fight state
 */
export function bossTick(input: BossTickInput): BossTickResult {
  // `boss` is part of the input contract (it carries the boss's
  // static stats) but the per-tick math only needs the already-
  // extracted `bossDps` and `currentBossHp` fields, so we destructure
  // only what we use.
  const {
    currentBossHp,
    currentPlayerHp,
    currentPlayerShield,
    playerDps,
    bossDps,
    maxPlayerHp,
    autoEatThreshold,
    medkitsAvailable,
    medkitHeal,
    tickMs,
  } = input;

  const tick = tickMs ?? BOSS_TICK_MS;
  const seconds = tick / 1000;
  const healAmount = medkitHeal ?? Math.round(maxPlayerHp * DEFAULT_MEDKIT_HEAL_PCT);

  // 1. Player damage to the boss.
  const rawDamageDealt = Math.max(0, playerDps) * seconds;
  const bossHp = Math.max(0, currentBossHp - rawDamageDealt);

  // 2. Boss damage to the player, with shield absorption.
  const rawDamageTaken = Math.max(0, bossDps) * seconds;
  let playerShield = currentPlayerShield;
  let damageAfterShield = rawDamageTaken;
  if (playerShield > 0) {
    const absorbed = Math.min(playerShield, damageAfterShield);
    playerShield -= absorbed;
    damageAfterShield -= absorbed;
  }
  const playerHp = Math.max(0, currentPlayerHp - damageAfterShield);

  // 3. Auto-eat: if player is below threshold and has medkits, heal.
  let medkitsConsumed = 0;
  let healedHp = playerHp;
  if (
    medkitsAvailable > 0 &&
    maxPlayerHp > 0 &&
    healedHp / maxPlayerHp < autoEatThreshold
  ) {
    medkitsConsumed = 1;
    healedHp = Math.min(maxPlayerHp, healedHp + healAmount);
  }

  // 4. Status: victory if boss HP ≤ 0, defeat if player HP ≤ 0,
  //    else ongoing. Victory takes precedence — a killing blow to
  //    the boss the same tick the player would die is still a win.
  let status: BossTickStatus = 'ongoing';
  if (bossHp <= 0) {
    status = 'victory';
  } else if (healedHp <= 0) {
    status = 'defeat';
  }

  return {
    bossHp,
    playerHp: healedHp,
    playerShield,
    medkitsConsumed,
    damageDealt: rawDamageDealt,
    damageTaken: damageAfterShield,
    status,
  };
}

/**
 * Build a fresh boss fight state from a BossDef.
 */
export function initialBossFightState(boss: BossDef): {
  bossHp: number;
} {
  return { bossHp: boss.health };
}

/**
 * Pure helper: compute the boss's effective DPS against the player,
 * accounting for the boss's damage stat directly. Just a typed
 * accessor so callers don't have to remember the field name.
 */
export function bossDamagePerSecond(boss: BossDef): number {
  return Math.max(0, boss.dps);
}
