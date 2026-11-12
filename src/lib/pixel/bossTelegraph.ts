import { MOVEMENT } from './movement';
import { REGION_1_BOSSES } from '@/constants/bosses';
import type { BossCadence } from '@/types/boss';

/**
 * Boss special telegraphs (boss cadence slice C3, follow-up to the
 * C1 cadence program — boss-cadence BRIEF §f, slice C3).
 *
 * C1 gave every authored boss an attack pattern: regular hits on a
 * short interval and a named SPECIAL on a slower cycle, preceded by
 * `windupSeconds` of telegraph (see `BossCadence` in types/boss.ts
 * and `bossCadenceTimeline` in the boss sim). Prep prints that
 * pattern as intel. This module is the in-fight counterpart: it
 * decides WHICH presented phases of a fight carry a special, so the
 * boss stages can stage a clear wind-up warning ahead of the big
 * attack — and only ahead of the big attack. Regular hits never get
 * one; a warning that fires for every jab teaches the player to
 * ignore it.
 *
 * Timing honesty (the slice's hard law): a telegraph must never lie
 * about when the attack lands. Two schedules compose here, and both
 * are the schedules the game already runs on:
 *
 *  1. WHICH attack is a special comes from the boss's authored
 *     cadence, enumerated exactly the way the sim's
 *     `bossCadenceTimeline` enumerates it: specials land at
 *     specialEverySeconds, 2×specialEverySeconds, … inside the
 *     sim's flat 30-second exposure window
 *     (BOSS_FIGHT_WINDOW_SECONDS). No new schedule is invented.
 *  2. WHEN the warning shows and ends comes from the fight
 *     presentation's own choreography — the same source the stages
 *     animate the attack from. The decided fight plays back phase
 *     by phase at MOVEMENT.PHASE_INTERVAL_MS; the presentation maps
 *     the 30-second sim window onto those phases in equal slices,
 *     so a special landing at sim-time t is presented in the phase
 *     whose slice contains t. Inside that phase, the counter-attack
 *     the stage animates is the special: `derivePhaseBeats` starts
 *     its telegraph beat at MOVEMENT.BEAT_COUNTER_AT_MS and lands
 *     its lunge beat at MOVEMENT.BEAT_LUNGE_AT_MS. The special
 *     telegraph occupies exactly that window — it starts when the
 *     choreographed wind-up starts and ends the moment the lunge
 *     lands. It is a stronger rendering of the wind-up that is
 *     already scheduled, never a second, divergent one.
 *
 * Presentation only, like everything in the pixel layer: this
 * module reads authored cadence data and movement constants and
 * decides nothing about outcomes, damage, or timing of the fight
 * itself. Cadence-less bosses (generated Endless encounters carry
 * no cadence by owner ruling D3) produce no telegraphs.
 */

/**
 * The sim's exposure window, in seconds — the window
 * `bossCadenceTimeline` enumerates cadence events over
 * (BOSS_FIGHT_WINDOW_SECONDS in bossSimulator.ts). Mirrored here so
 * the pixel layer does not import the sim; a test pins the two
 * together.
 */
export const TELEGRAPH_WINDOW_SECONDS = 30;

export interface BossSpecialTelegraph {
  /** Player-facing name of the special, from the cadence data. */
  specialName: string;
  /** Index of the presented phase the special lands in. */
  phaseIndex: number;
  /** Sim-time (seconds into the 30s window) of the special this
   *  telegraph presents — the first special scheduled inside the
   *  phase's slice when a phase carries more than one. */
  simTimeSeconds: number;
  /** Ms from the phase's start when the wind-up telegraph begins —
   *  the choreography's counter beat (derivePhaseBeats' telegraph). */
  startMs: number;
  /** Ms the wind-up lasts: startMs + durationMs is the exact moment
   *  the stage's lunge beat lands. */
  durationMs: number;
  /** Ms from the phase's start when the special lands (the lunge). */
  landsAtMs: number;
}

/**
 * The special landing times (seconds) a cadence schedules inside
 * the fight window — the same enumeration `bossCadenceTimeline`
 * performs for the budget split, so the stage and the sim can never
 * disagree about how many specials a fight contains or when they
 * fall.
 */
export function bossSpecialTimes(cadence: BossCadence): number[] {
  const times: number[] = [];
  if (cadence.specialEverySeconds > 0 && cadence.specialShare > 0) {
    for (let t = cadence.specialEverySeconds; t <= TELEGRAPH_WINDOW_SECONDS; t += cadence.specialEverySeconds) {
      times.push(t);
    }
  }
  return times;
}

/**
 * Every special telegraph a fight presentation carries: one per
 * presented phase that a scheduled special lands in, in phase
 * order. When several specials fall inside one phase's slice (a
 * short presentation of a fast-cycling boss), the phase still gets
 * exactly one telegraph — the stage animates one counter per phase,
 * so one warning per phase is the honest count.
 */
export function bossSpecialTelegraphs(
  cadence: BossCadence | undefined,
  phaseCount: number,
): BossSpecialTelegraph[] {
  if (!cadence || phaseCount <= 0) return [];
  const startMs = MOVEMENT.BEAT_COUNTER_AT_MS;
  const landsAtMs = MOVEMENT.BEAT_LUNGE_AT_MS;
  const byPhase = new Map<number, BossSpecialTelegraph>();
  for (const t of bossSpecialTimes(cadence)) {
    const phaseIndex = Math.min(phaseCount - 1, Math.floor((t / TELEGRAPH_WINDOW_SECONDS) * phaseCount));
    if (!byPhase.has(phaseIndex)) {
      byPhase.set(phaseIndex, {
        specialName: cadence.specialName,
        phaseIndex,
        simTimeSeconds: t,
        startMs,
        durationMs: landsAtMs - startMs,
        landsAtMs,
      });
    }
  }
  return [...byPhase.values()].sort((a, b) => a.phaseIndex - b.phaseIndex);
}

/** The telegraph scheduled for one presented phase, or null when
 *  that phase's counter is a regular hit (or there is none). */
export function specialTelegraphForPhase(
  cadence: BossCadence | undefined,
  phaseCount: number,
  phaseIndex: number,
): BossSpecialTelegraph | null {
  return bossSpecialTelegraphs(cadence, phaseCount).find((t) => t.phaseIndex === phaseIndex) ?? null;
}

/**
 * The authored cadence for a ladder boss id, or undefined for any
 * id that carries none (Endless pack ids, generated encounters,
 * unknown ids). The stages resolve cadence through here so the
 * lookup lives in exactly one place.
 */
export function cadenceForBossId(bossId: string | undefined): BossCadence | undefined {
  if (!bossId) return undefined;
  return REGION_1_BOSSES.find((b) => b.id === bossId)?.cadence;
}

/** Convenience for the stages: the telegraph for `bossId`'s
 *  presented phase, resolved from the authored defs. */
export function specialTelegraphForBossPhase(
  bossId: string | undefined,
  phaseCount: number,
  phaseIndex: number,
): BossSpecialTelegraph | null {
  return specialTelegraphForPhase(cadenceForBossId(bossId), phaseCount, phaseIndex);
}
