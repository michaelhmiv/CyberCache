/**
 * Boss special telegraphs — slice C3 (boss-cadence program, BRIEF §f).
 *
 * The in-fight counterpart of C1's attack-pattern intel: when a boss
 * winds up its cadence SPECIAL (the big attack), the boss stage
 * stages a clear wind-up telegraph; regular hits never get one.
 * These tests pin the derivation in lib/pixel/bossTelegraph.ts:
 *
 *  (i)  a telegraph is produced for each big-attack pattern in the
 *       data (every authored boss's special, at its real scheduled
 *       sim-times) and for NO light attack — phases a special is not
 *       scheduled in resolve to null, at every phase count;
 *  (ii) telegraph start/duration align with the scheduled wind-up
 *       window — the very window derivePhaseBeats (the choreography
 *       source both stages animate from) schedules between its
 *       telegraph and lunge beats;
 *  (iii) the enumeration the stage uses is the sim's own: the
 *       window constant matches BOSS_FIGHT_WINDOW_SECONDS and, at a
 *       phase count fine enough to separate them, the telegraph
 *       count equals bossCadenceTimeline's specialCount per boss.
 */
import { describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { BOSS_FIGHT_WINDOW_SECONDS, bossCadenceTimeline } from '@/lib/simulation/bossSimulator';
import { MOVEMENT, derivePhaseBeats } from '@/lib/pixel/movement';
import {
  TELEGRAPH_WINDOW_SECONDS,
  bossSpecialTelegraphs,
  bossSpecialTimes,
  cadenceForBossId,
  specialTelegraphForBossPhase,
  specialTelegraphForPhase,
} from '@/lib/pixel/bossTelegraph';
import { endlessEncounterForDepth } from '@/content/endless';

describe('boss telegraph — the schedule source', () => {
  it('the stage window is the sim window', () => {
    expect(TELEGRAPH_WINDOW_SECONDS).toBe(BOSS_FIGHT_WINDOW_SECONDS);
  });

  it('special times enumerate exactly as the sim timeline does', () => {
    for (const boss of REGION_1_BOSSES) {
      const tl = bossCadenceTimeline(boss.cadence!, boss.dps * 30);
      expect(bossSpecialTimes(boss.cadence!), boss.id).toHaveLength(tl.specialCount);
      // The special is the BIG attack by the data's own split: one
      // special carries strictly more damage than one regular hit,
      // for every boss on the roster.
      expect(tl.perSpecialDamage, boss.id).toBeGreaterThan(tl.perHitDamage);
    }
  });
});

describe('boss telegraph — (i) every big attack, no light attack', () => {
  it('every authored boss produces a telegraph for its special at its real phase count', () => {
    for (const boss of REGION_1_BOSSES) {
      const telegraphs = bossSpecialTelegraphs(boss.cadence, boss.phases.length);
      expect(telegraphs.length, boss.id).toBeGreaterThanOrEqual(1);
      for (const t of telegraphs) {
        expect(t.specialName, boss.id).toBe(boss.cadence!.specialName);
        expect(t.phaseIndex, boss.id).toBeGreaterThanOrEqual(0);
        expect(t.phaseIndex, boss.id).toBeLessThan(boss.phases.length);
        // The telegraph presents a scheduled special — its sim-time
        // is one of the cadence's own special landing times.
        expect(bossSpecialTimes(boss.cadence!), boss.id).toContain(t.simTimeSeconds);
      }
      // One warning per phase at most (the stage animates one
      // counter per phase), in phase order.
      const indices = telegraphs.map((t) => t.phaseIndex);
      expect(indices, boss.id).toEqual([...new Set(indices)].sort((a, b) => a - b));
    }
  });

  it('at a fine phase count, telegraph count equals the sim special count per boss', () => {
    for (const boss of REGION_1_BOSSES) {
      const tl = bossCadenceTimeline(boss.cadence!, boss.dps * 30);
      expect(bossSpecialTelegraphs(boss.cadence, 8).length, boss.id).toBe(tl.specialCount);
    }
  });

  it('no light attack is ever telegraphed, at any phase count', () => {
    for (const boss of REGION_1_BOSSES) {
      for (const phaseCount of [1, 2, 3, 5, 8]) {
        const telegraphs = bossSpecialTelegraphs(boss.cadence, phaseCount);
        const specialPhases = new Set(telegraphs.map((t) => t.phaseIndex));
        // Never more warnings than scheduled specials.
        expect(telegraphs.length, `${boss.id} @${phaseCount}`).toBeLessThanOrEqual(
          bossSpecialTimes(boss.cadence!).length,
        );
        for (let phaseIndex = 0; phaseIndex < phaseCount; phaseIndex++) {
          const found = specialTelegraphForPhase(boss.cadence, phaseCount, phaseIndex);
          if (specialPhases.has(phaseIndex)) {
            expect(found, `${boss.id} @${phaseCount} phase ${phaseIndex}`).not.toBeNull();
          } else {
            // A phase whose slice holds no special is a regular
            // counter (or none) — no big telegraph, ever.
            expect(found, `${boss.id} @${phaseCount} phase ${phaseIndex}`).toBeNull();
          }
        }
      }
    }
  });

  it('cadence-less fights produce no telegraphs (Endless ruling D3)', () => {
    expect(bossSpecialTelegraphs(undefined, 5)).toEqual([]);
    expect(specialTelegraphForPhase(undefined, 5, 0)).toBeNull();
    for (const depth of [1, 5, 10]) {
      const enc = endlessEncounterForDepth(depth, 20);
      expect(enc.def.cadence).toBeUndefined();
      expect(bossSpecialTelegraphs(enc.def.cadence, 5)).toEqual([]);
    }
    expect(cadenceForBossId(undefined)).toBeUndefined();
    expect(cadenceForBossId('endless_pack_dustwaste')).toBeUndefined();
    expect(cadenceForBossId('dune_tyrant')?.specialName).toBe('Sand Slam');
  });

  it('fixture pin: the harness fight (Dune Tyrant, 5 phases) specials exactly one phase', () => {
    const telegraphs = bossSpecialTelegraphs(cadenceForBossId('dune_tyrant'), 5);
    expect(telegraphs).toHaveLength(1);
    expect(telegraphs[0].phaseIndex).toBe(3);
    expect(telegraphs[0].specialName).toBe('Sand Slam');
    expect(telegraphs[0].simTimeSeconds).toBe(18);
    expect(specialTelegraphForBossPhase('dune_tyrant', 5, 0)).toBeNull();
    expect(specialTelegraphForBossPhase('dune_tyrant', 5, 3)?.specialName).toBe('Sand Slam');
  });
});

describe('boss telegraph — (ii) timing aligns with the scheduled wind-up window', () => {
  it('start/duration are the choreography window derivePhaseBeats schedules', () => {
    // The same source the stages animate the attack from: a counter
    // phase's telegraph beat opens the wind-up and its lunge beat
    // lands the attack.
    const beats = derivePhaseBeats({
      bossDamage: 100,
      playerDamage: 50,
      bossMaxHp: 1000,
      bossDies: false,
      playerDies: false,
    });
    const telegraphBeat = beats.find((b) => b.kind === 'telegraph')!;
    const lungeBeat = beats.find((b) => b.kind === 'lunge')!;
    expect(telegraphBeat).toBeDefined();
    expect(lungeBeat).toBeDefined();

    for (const boss of REGION_1_BOSSES) {
      for (const t of bossSpecialTelegraphs(boss.cadence, 8)) {
        expect(t.startMs, boss.id).toBe(telegraphBeat.atMs);
        expect(t.startMs, boss.id).toBe(MOVEMENT.BEAT_COUNTER_AT_MS);
        expect(t.landsAtMs, boss.id).toBe(lungeBeat.atMs);
        expect(t.landsAtMs, boss.id).toBe(MOVEMENT.BEAT_LUNGE_AT_MS);
        expect(t.startMs + t.durationMs, boss.id).toBe(t.landsAtMs);
        expect(t.durationMs, boss.id).toBeGreaterThan(0);
        // The whole warning lives inside the phase it warns for.
        expect(t.landsAtMs, boss.id).toBeLessThan(MOVEMENT.PHASE_INTERVAL_MS);
      }
    }
  });
});
