import type { PhaseAnalysis } from '../../types/boss';
import type { BossSimulationInput } from '../simulation/bossSimulator';
import type { Weapon } from '../../types/items';
import { computeHunterMaxHp } from '../combat/damageContract';
import { MOVEMENT, FIGHT_TOTAL_BUDGET_MS } from '../pixel/movement';

// Mirror the formula in src/lib/simulation/bossSimulator.ts:364-365.
// Kept client-side so the fight card can render the bar without re-running
// the sim. If the sim formula changes, this MUST change in lockstep — the
// bossFightAnimation.test.ts parity test guards this.
export const computePlayerMaxHp = (playerLevel: number, shieldHp: number): number =>
  computeHunterMaxHp(playerLevel, shieldHp);

// Animation tuning — Sample B pacing (pixel movement system, P2): phases
// breathe at ~1.15 s so each phase can stage its exchange (shot → hit
// reaction → telegraphed lunge → dodge), replacing the old ≤800 ms blur
// Michael called stiff. The values live in src/lib/pixel/movement.ts with
// every other choreography timing; these re-exports keep the historical
// import surface. With reduced-motion, the animation is skipped and the
// fight card flashes briefly to the result. This paces the *presentation*
// of an already-decided outcome only — the sim/Chef result never changes.
export const FIGHT_PHASE_MS = MOVEMENT.PHASE_INTERVAL_MS;
export const FIGHT_FINAL_PAUSE_MS = MOVEMENT.FIGHT_SETTLE_MS;
// Hard upper bound for the animation (8 phases at Sample B pace + settle).
// The runtime budget guard logs a warning if the total computed time
// exceeds this; the test asserts the cap against the movement constants.
export { FIGHT_TOTAL_BUDGET_MS };

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
 * The HP animation reflects the *narrative* of the fight, walked phase by
 * phase by runFightAnimation (P2 staging depends on both combatants
 * actually trading damage — fights are two-way, never target practice):
 *  - Both combatants start at 100%.
 *  - On victory, the boss walks down to 0 and the player ends at 30% of
 *    max (survived with scraps) — so the player takes real damage en
 *    route and the boss's counters are staged.
 *  - On defeat, the player walks down to 0 and the boss ends at
 *    bossHpRemaining% — the damage it took before the player died.
 *
 * (Pre-P2 this initializer pre-loaded the *end* states — player at 0 on
 * defeat, boss at its remaining % — which left the interpolator nothing
 * to walk: defeat fights rendered as static bars with an empty damage
 * log, and victory fights never showed the player being hit.)
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
    playerHp: playerHpMax,
    playerHpMax,
    bossHp: bossHealth,
    bossHpMax: bossHealth,
    damageLog: [],
  };
};

/** The narrative end state a fight walks to (see buildInitialTimeline). */
export const fightEndState = (
  outcome: FightOutcome,
  bossHpMax: number,
  playerHpMax: number
): { playerHp: number; bossHp: number } => ({
  playerHp: outcome.result.victory ? Math.max(1, Math.round(playerHpMax * 0.3)) : 0,
  bossHp: outcome.result.victory ? 0 : Math.round(bossHpMax * (outcome.result.bossHpRemaining ?? 50) / 100),
});

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
  onPhase: (snapshot: FightTimeline) => void,
  timing?: { phaseMs?: number; finalPauseMs?: number }
): Promise<FightTimeline> {
  const outcome = initial.outcome;
  if (!outcome) return initial;
  const phaseMs = timing?.phaseMs ?? FIGHT_PHASE_MS;
  const finalPauseMs = timing?.finalPauseMs ?? FIGHT_FINAL_PAUSE_MS;

  // Reduced-motion or no phases: jump to the narrative end state.
  if (skipAnimation || phaseAnalyses.length === 0) {
    const end = fightEndState(outcome, initial.bossHpMax, initial.playerHpMax);
    return {
      ...initial,
      currentPhaseIndex: phaseAnalyses.length,
      playerHp: end.playerHp,
      bossHp: end.bossHp,
      finishedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    };
  }

  // Interpolate HP from start to end across the phase boundary count.
  // Each phase is one tick on the timeline. Player HP and boss HP each
  // travel from their initial value to their narrative end value (see
  // fightEndState) in N steps. Damage entries are the PER-PHASE deltas
  // (pre-P2 they were measured from the fight's start, so popup values
  // grew cumulatively instead of naming the phase's own hit).
  const startPlayerHp = initial.playerHp;
  const startBossHp = initial.bossHp;
  const { playerHp: endPlayerHp, bossHp: endBossHp } = fightEndState(outcome, initial.bossHpMax, initial.playerHpMax);
  const damageLog: DamageLog[] = [];
  const phaseCount = phaseAnalyses.length;
  let prevPlayerHp = startPlayerHp;
  let prevBossHp = startBossHp;

  for (let i = 0; i < phaseCount; i++) {
    if (cancel.cancelled) return initial;
    const t = (i + 1) / phaseCount;
    const playerHp = Math.round(startPlayerHp + (endPlayerHp - startPlayerHp) * t);
    const bossHp = Math.round(startBossHp + (endBossHp - startBossHp) * t);
    const phase = phaseAnalyses[i];
    const playerDmg = Math.max(0, Math.round((prevPlayerHp - playerHp) * 0.5));
    const bossDmg = Math.max(0, Math.round((prevBossHp - bossHp) * 0.5));
    prevPlayerHp = playerHp;
    prevBossHp = bossHp;
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
    await new Promise<void>((resolve) => setTimeout(resolve, phaseMs));
  }

  if (cancel.cancelled) return initial;
  // Final pause so the last phase visually settles before the result
  // card slides in.
  await new Promise<void>((resolve) => setTimeout(resolve, finalPauseMs));
  if (cancel.cancelled) return initial;

  // Belt-and-braces budget guard. The total animation time is
  // (phaseCount * phaseMs) + finalPauseMs at Sample B pacing. We assert
  // here so a future tweak doesn't accidentally blow past the movement
  // system's hard cap. This is a runtime check, not a static gate.
  const expectedTotal = phaseCount * phaseMs + finalPauseMs;
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
