import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BossFightStage } from '@/components/pixelArt/BossFightStage';
import { detectWebGL, resetWebGLCacheForTests } from '@/components/pixelArt/pixi/detectWebGL';
import { derivePhaseBeats, MOVEMENT } from '@/lib/pixel/movement';
import {
  FIXTURE_PHASES,
  fixtureSnapshots,
  playFixture,
  type FixtureLogEntry,
} from '@/harness/fightFixture';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('Pixi pilot — WebGL fallback (brief §7.5 mechanics)', () => {
  it('jsdom has no WebGL context, so detection reports unavailable', () => {
    resetWebGLCacheForTests();
    expect(detectWebGL()).toBe(false);
  });

  it('the wrapper renders the DOM stage (no canvas) when WebGL is unavailable', () => {
    const timeline = fixtureSnapshots()[0];
    const { container } = render(
      <BossFightStage timeline={timeline} phases={FIXTURE_PHASES} bossId="dune_tyrant" />,
    );
    expect(screen.getByTestId('boss-fight-stage')).toBeTruthy();
    expect(screen.getByTestId('boss-fight-pixel-stage')).toBeTruthy();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('neither renderer mutates the decided timeline (deep-frozen fixture renders clean)', () => {
    const timeline = deepFreeze(fixtureSnapshots()[2]);
    const phases = deepFreeze(structuredClone(FIXTURE_PHASES));
    expect(() =>
      render(<BossFightStage timeline={timeline} phases={phases} bossId="dune_tyrant" />),
    ).not.toThrow();
    expect(screen.getByTestId('fx-damage-number-crit')).toBeTruthy();
  });
});

describe('Pixi pilot — fixture determinism (brief §7.1, data level)', () => {
  it('the fixture is reproducible: two builds are event-identical', () => {
    const a = fixtureSnapshots();
    const b = fixtureSnapshots();
    expect(a).toEqual(b);
  });

  it('the fixture fight contains every required beat', () => {
    const snapshots = fixtureSnapshots();
    const kindsPerPhase = snapshots.slice(0, FIXTURE_PHASES.length).map((snapshot, i) => {
      const phase = FIXTURE_PHASES[i];
      const entries = snapshot.damageLog.filter((e) => e.phaseName === phase.phaseName);
      const bossDamage = entries.filter((e) => e.target === 'boss').reduce((m, e) => Math.max(m, e.value), 0);
      const playerDamage = entries.filter((e) => e.target === 'player').reduce((m, e) => Math.max(m, e.value), 0);
      return derivePhaseBeats({
        bossDamage,
        playerDamage,
        bossMaxHp: snapshot.bossHpMax,
        bossDies: i === FIXTURE_PHASES.length - 1,
        playerDies: false,
      }).map((beat) => beat.kind);
    });
    // Phase 1: normal hit + telegraph + dodge.
    expect(kindsPerPhase[0]).toContain('shot');
    expect(kindsPerPhase[0]).toContain('telegraph');
    expect(kindsPerPhase[0]).toContain('dodge');
    // Phase 2: a plain normal hit, no counter.
    expect(kindsPerPhase[1]).toContain('shot');
    expect(kindsPerPhase[1]).not.toContain('telegraph');
    // Phase 3: a crit.
    expect(kindsPerPhase[2]).toContain('crit');
    // Phase 5: the kill — the killing blow is itself a crit
    // (290/1000 ≥ the 18% fraction) + the death beat.
    expect(kindsPerPhase[4]).toContain('crit');
    expect(kindsPerPhase[4]).toContain('death');
    // Arithmetic closes: the boss dies exactly on the last phase.
    expect(snapshots[FIXTURE_PHASES.length - 1].bossHp).toBe(0);
    expect(snapshots[FIXTURE_PHASES.length].finishedAt).toBeNull(); // driver stamps it
    expect(snapshots[FIXTURE_PHASES.length].outcome?.result.victory).toBe(true);
  });

  it('the fixture player walks every snapshot at the law interval and settles once', () => {
    vi.useFakeTimers();
    let nowVal = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowVal);
    try {
      const seen: number[] = [];
      const log: FixtureLogEntry[] = [];
      let done = false;
      const stop = playFixture(
        (_snapshot, index) => seen.push(index),
        () => {
          done = true;
        },
        log,
      );
      vi.advanceTimersByTime(0); // snapshot 0 lands immediately
      for (let i = 0; i < FIXTURE_PHASES.length; i += 1) {
        nowVal += MOVEMENT.PHASE_INTERVAL_MS;
        vi.advanceTimersByTime(MOVEMENT.PHASE_INTERVAL_MS);
      }
      nowVal += MOVEMENT.FIGHT_SETTLE_MS;
      vi.advanceTimersByTime(MOVEMENT.FIGHT_SETTLE_MS);
      stop();
      expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
      expect(done).toBe(true);
      expect(log.map((e) => e.bossHp)).toEqual([880, 790, 530, 290, 0, 0]);
      expect(log[5].finished).toBe(true);
      const intervals = log.slice(1).map((e, i) => e.atMs - log[i].atMs);
      for (const interval of intervals) {
        expect(interval).toBe(MOVEMENT.PHASE_INTERVAL_MS);
      }
    } finally {
      nowSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
