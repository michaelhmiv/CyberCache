import type { PhaseAnalysis } from '../../types/boss';
import type { BossSimulationInput } from '../simulation/bossSimulator';
import type { Weapon } from '../../types/items';
import { computeHunterMaxHp } from '../combat/damageContract';

// Mirror the formula in src/lib/simulation/bossSimulator.ts:364-365.
// Kept client-side so the fight card can render the bar without re-running
// the sim. If the sim formula changes, this MUST change in lockstep — the
// bossFightAnimation.test.ts parity test guards this.
export const computePlayerMaxHp = (playerLevel: number, shieldHp: number): number =>
  computeHunterMaxHp(playerLevel, shieldHp);

// Animation tuning. Total duration is well under the 1.2s the old fake
// setTimeout used. With reduced-motion, the animation is skipped and the
// fight card flashes briefly to the result.
export const FIGHT_PHASE_MS = 60;
export const FIGHT_FINAL_PAUSE_MS = 180;
// Hard upper bound for the animation. The runtime budget guard logs a
// warning if the total computed time exceeds this. The test asserts the
// hard cap so a future tweak can't regress past 1.2s.
export const FIGHT_TOTAL_BUDGET_MS = 800;

export type DamageLog = { id: string; target: 'player' | 'boss'; value: number; phaseName: string };

/**
 * Mirrors the return type of executeBossAttempt in bossSimulator.ts. We
 * don't import that exact type because the timeline module is meant to
 * be importable without pulling in the full sim (which has its own
 * dependency graph). The fields used here are stable.
 */
export type FightOutcome = {
  result: { victory: boolean; winChance: number; bossHpRemaining?: number; phaseFailed?: string };
  creditsDelta: number;
  bonusLootRolls: number;
  consumedConsumables: Record<string, number>;
  loot: Weapon[];
  extraLoot: boolean;
};

export type FightTimeline = {
  outcome: FightOutcome | null;
  startedAt: number;
  finishedAt: number | null;
  currentPhaseIndex: number;
  playerHp: number;
  playerHpMax: number;
  bossHp: number;
  bossHpMax: number;
  damageLog: DamageLog[];
};

/**
 * Build the initial FightTimeline for a given sim outcome.
 *
 * The boss HP animation reflects the *narrative* of the fight:
 *  - On victory, the boss starts at 100% and we walk it down to 0 as the
 *    phases resolve. The animation interpolates between these.
 *  - On defeat, the boss is still standing at the moment you died. It
 *    starts at bossHpRemaining% and the animation leaves it there.
 *  - The player HP is 30% of max on victory (you survived with scraps) or
 *    0 on defeat (just the loss state).
 */
export const buildInitialTimeline = (
  outcome: FightOutcome,
  bossHealth: number,
  playerLevel: number,
  shieldHp: number
): FightTimeline => {
  const playerHpMax = computePlayerMaxHp(playerLevel, shieldHp);
  return {
    outcome,
    startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    finishedAt: null,
    currentPhaseIndex: 0,
    playerHp: outcome.result.victory ? Math.max(1, Math.round(playerHpMax * 0.3)) : 0,
    playerHpMax,
    bossHp: outcome.result.victory
      ? bossHealth // start the boss at full; the animation walks it down
      : Math.round(bossHealth * (outcome.result.bossHpRemaining ?? 50) / 100),
    bossHpMax: bossHealth,
    damageLog: [],
  };
};

/**
 * Walk through the fight phases and animate HP bars + damage popups.
 * Returns the final FightTimeline; the caller is responsible for setting
 * state and showing the result card. With prefers-reduced-motion, the
 * animation is skipped and the function returns the final timeline
 * immediately (zero delay).
 *
 * The math here is honest presentation: the player HP and boss HP each
 * travel from their initial value to their final value across the
 * phase count. Damage values are derived from the per-tick HP deltas.
 *
 * The cancel ref lets a new fight abort a running animation. The onPhase
 * callback receives a per-phase snapshot so the caller can update React
 * state to drive the HP bar spring animation.
 */
export async function runFightAnimation(
  initial: FightTimeline,
  phaseAnalyses: PhaseAnalysis[],
  skipAnimation: boolean,
  cancel: { cancelled: boolean },
  onPhase: (snapshot: FightTimeline) => void
): Promise<FightTimeline> {
  const outcome = initial.outcome;
  if (!outcome) return initial;

  // Reduced-motion or no phases: jump to the end.
  if (skipAnimation || phaseAnalyses.length === 0) {
    return { ...initial, currentPhaseIndex: phaseAnalyses.length, finishedAt: typeof performance !== 'undefined' ? performance.now() : Date.now() };
  }

  // Interpolate HP from start to end across the phase boundary count.
  // Each phase is one tick on the timeline. Player HP and boss HP each
  // travel from their initial value to their final value in N steps.
  const startPlayerHp = initial.playerHp;
  const endPlayerHp = outcome.result.victory ? startPlayerHp : 0;
  const startBossHp = initial.bossHp;
  const endBossHp = outcome.result.victory ? 0 : startBossHp;
  const damageLog: DamageLog[] = [];
  const phaseCount = phaseAnalyses.length;

  for (let i = 0; i < phaseCount; i++) {
    if (cancel.cancelled) return initial;
    const t = (i + 1) / phaseCount;
    const playerHp = Math.round(startPlayerHp + (endPlayerHp - startPlayerHp) * t);
    const bossHp = Math.round(startBossHp + (endBossHp - startBossHp) * t);
    const phase = phaseAnalyses[i];
    const playerDmg = Math.max(0, Math.round((startPlayerHp - playerHp) * 0.5));
    const bossDmg = Math.max(0, Math.round((startBossHp - bossHp) * 0.5));
    if (playerDmg > 0) {
      damageLog.push({ id: `p-${i}-${Date.now()}`, target: 'player', value: playerDmg, phaseName: phase.phaseName });
    }
    if (bossDmg > 0) {
      damageLog.push({ id: `b-${i}-${Date.now()}`, target: 'boss', value: bossDmg, phaseName: phase.phaseName });
    }
    onPhase({
      ...initial,
      currentPhaseIndex: i,
      playerHp,
      bossHp,
      damageLog: damageLog.slice(-6),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, FIGHT_PHASE_MS));
  }

  if (cancel.cancelled) return initial;
  // Final pause so the last phase visually settles before the result
  // card slides in.
  await new Promise<void>((resolve) => setTimeout(resolve, FIGHT_FINAL_PAUSE_MS));
  if (cancel.cancelled) return initial;

  // Belt-and-braces budget guard. The total animation time is
  // (phaseCount * FIGHT_PHASE_MS) + FIGHT_FINAL_PAUSE_MS. We assert here
  // so a future tweak doesn't accidentally regress past the 1.2s the old
  // fake delay used. This is a runtime check, not a static gate.
  const expectedTotal = phaseCount * FIGHT_PHASE_MS + FIGHT_FINAL_PAUSE_MS;
  if (expectedTotal > FIGHT_TOTAL_BUDGET_MS) {
    console.warn(`[fightTimeline] fight animation ${expectedTotal}ms exceeds ${FIGHT_TOTAL_BUDGET_MS}ms budget for ${phaseCount} phases`);
  }

  return {
    ...initial,
    currentPhaseIndex: phaseCount,
    playerHp: endPlayerHp,
    bossHp: endBossHp,
    damageLog: damageLog.slice(-6),
    finishedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  };
}

// Re-export types for downstream consumers.
export type { BossSimulationInput };
