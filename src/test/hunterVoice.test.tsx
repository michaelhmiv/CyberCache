/**
 * Hunter voice pools — slice (c) checks C7/C8/C9 (brief §2.6).
 *
 * COPY STATUS: the pool text is the owner-approved v2 set
 * (2026-11-15 — see hunterVoice.ts). These tests pin the
 * MECHANISM: fixed pools
 * bound to the closed trigger list, no lines living outside the
 * pools, fires only on the decided server fact, silence at
 * defeat/death, no repeat while an unfired line remains, and one
 * line per moment. When the final copy lands it replaces the
 * pool strings and these tests must still pass unmodified in
 * structure (they read lines FROM the pools, never literals).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  HUNTER_VOICE_POOLS,
  HUNTER_VOICE_TRIGGERS,
  VOICE_MOMENT_WINDOW_MS,
  fireHunterVoiceLine,
  resetHunterVoiceSession,
  type HunterVoiceTrigger,
} from '@/lib/hunters/hunterVoice';
import { HUNTERS, type HunterId } from '@/lib/hunters/hunters';
import { RoamHunterVoice, BossHunterVoice } from '@/components/pixelArt/HunterVoiceChip';
import { useSkillStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useLoginStreakStore } from '@/store/slices/loginStreakSlice';
import { useTickFeedStore, type TickEvent } from '@/store/slices/tickSlice';
import { Rarity } from '@/types/game';
import type { GearItem } from '@/types/items';
import type { FightTimeline } from '@/lib/animation/fightTimeline';

const HUNTER_IDS = HUNTERS.map((h) => h.id) as HunterId[];

// ── C7: fixed, complete pools; no lines outside the pools ──────

describe('C7 — voice pools are fixed and complete', () => {
  it('every hunter carries 3–4 lines, each bound to exactly one closed trigger', () => {
    const seen = new Set<string>();
    for (const hunterId of HUNTER_IDS) {
      const pools = HUNTER_VOICE_POOLS[hunterId];
      expect(pools, `pools exist for ${hunterId}`).toBeDefined();
      // The trigger keys are exactly the closed list — no
      // per-tick staple, no common drop, no ordinary kill.
      expect(Object.keys(pools).sort()).toEqual([...HUNTER_VOICE_TRIGGERS].sort());
      let total = 0;
      for (const trigger of HUNTER_VOICE_TRIGGERS) {
        const lines = pools[trigger];
        expect(lines.length).toBeGreaterThanOrEqual(1);
        total += lines.length;
        for (const line of lines) {
          expect(line.trim().length).toBeGreaterThan(0);
          // A line lives in exactly one pool (one trigger, one hunter).
          expect(seen.has(line), `line bound twice: ${line}`).toBe(false);
          seen.add(line);
        }
      }
      expect(total).toBeGreaterThanOrEqual(3);
      expect(total).toBeLessThanOrEqual(4);
    }
  });

  it('no pool line appears anywhere else in src (no hardcoded lines at call sites)', () => {
    const srcRoot = path.resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          if (full.endsWith('hunterVoice.ts')) continue;
          if (full.endsWith('hunterVoice.test.tsx')) continue;
          const text = fs.readFileSync(full, 'utf8');
          for (const hunterId of HUNTER_IDS) {
            for (const trigger of HUNTER_VOICE_TRIGGERS) {
              for (const line of HUNTER_VOICE_POOLS[hunterId][trigger]) {
                if (text.includes(line)) offenders.push(`${full}: ${line}`);
              }
            }
          }
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});

// ── C9 (unit): rotation + one line per moment ───────────────────

describe('C9 — rotation and moment rules', () => {
  beforeEach(() => resetHunterVoiceSession());

  it('no line repeats while an unfired line for that hunter + trigger remains', () => {
    let now = 1_000_000;
    for (const hunterId of HUNTER_IDS) {
      for (const trigger of HUNTER_VOICE_TRIGGERS) {
        const pool = HUNTER_VOICE_POOLS[hunterId][trigger];
        const seenThisCycle = new Set<string>();
        for (let fire = 0; fire < pool.length * 2; fire++) {
          now += VOICE_MOMENT_WINDOW_MS + 1000;
          const line = fireHunterVoiceLine(hunterId, trigger, `m-${hunterId}-${trigger}-${fire}`, now);
          expect(line).not.toBeNull();
          expect(pool).toContain(line);
          if (seenThisCycle.size >= pool.length) seenThisCycle.clear();
          expect(seenThisCycle.has(line!), `repeat before exhaustion: ${hunterId}/${trigger} "${line}"`).toBe(false);
          seenThisCycle.add(line!);
        }
      }
    }
  });

  it('a fired moment key never fires again, for any trigger', () => {
    const first = fireHunterVoiceLine('vesper', 'legendaryDrop', 'moment-1', 5000);
    expect(first).not.toBeNull();
    expect(fireHunterVoiceLine('vesper', 'bossKill', 'moment-1', 5000 + VOICE_MOMENT_WINDOW_MS + 1)).toBeNull();
    expect(fireHunterVoiceLine('silas', 'legendaryDrop', 'moment-1', 5000 + VOICE_MOMENT_WINDOW_MS + 1)).toBeNull();
  });

  it('a second trigger inside the moment window stays silent; after the window it fires', () => {
    expect(fireHunterVoiceLine('doc', 'bossKill', 'moment-a', 10000)).not.toBeNull();
    expect(fireHunterVoiceLine('doc', 'streakComplete', 'moment-b', 10000 + VOICE_MOMENT_WINDOW_MS - 1)).toBeNull();
    expect(fireHunterVoiceLine('doc', 'streakComplete', 'moment-c', 10000 + VOICE_MOMENT_WINDOW_MS + 1)).not.toBeNull();
  });
});

// ── C8: watchers fire only on their decided fact ────────────────

const gearEvent = (id: string, rarity: Rarity): TickEvent => ({
  id,
  at: 1000,
  tone: 'loot',
  label: 'drop',
  detail: '',
  gear: { id: `gear-${id}`, rarity } as unknown as GearItem,
});
const plainEvent = (id: string, tone: TickEvent['tone']): TickEvent => ({ id, at: 1000, tone, label: 'tick', detail: '' });

const timeline = (finishedAt: number | null, victory: boolean | null): FightTimeline =>
  ({
    startedAt: 1000,
    finishedAt,
    outcome: victory === null ? null : { result: { victory } },
    beats: [],
    durationMs: 5000,
  }) as unknown as FightTimeline;

describe('C8 — stage watchers fire only on the server fact', () => {
  beforeEach(() => {
    resetHunterVoiceSession();
    useSkillStore.setState({ activeHunterId: 'vesper' });
    useSurvivalStore.setState({ isDead: false, adrenalineActive: false, currentHp: 500 });
    useLoginStreakStore.setState({ lastClaimedGrantKey: null });
    useTickFeedStore.setState({ events: [] });
  });
  afterEach(() => cleanup());

  it('ordinary ticks, kills, and common drops fire nothing', () => {
    const { rerender } = render(<RoamHunterVoice event={plainEvent('e0', 'standing')} xPct={12} topPct={10} />);
    rerender(<RoamHunterVoice event={plainEvent('e1', 'kill')} xPct={12} topPct={10} />);
    rerender(<RoamHunterVoice event={gearEvent('e2', Rarity.Common)} xPct={12} topPct={10} />);
    rerender(<RoamHunterVoice event={gearEvent('e3', Rarity.Epic)} xPct={12} topPct={10} />);
    expect(screen.queryByTestId('hunter-voice-chip')).toBeNull();
  });

  it('a legendary drop landing after mount fires the active hunter’s legendary line', () => {
    const { rerender } = render(<RoamHunterVoice event={plainEvent('e0', 'standing')} xPct={12} topPct={10} />);
    rerender(<RoamHunterVoice event={gearEvent('e1', Rarity.Legendary)} xPct={12} topPct={10} />);
    const chip = screen.getByTestId('hunter-voice-chip');
    expect(HUNTER_VOICE_POOLS.vesper.legendaryDrop).toContain(chip.textContent);
  });

  it('a legendary already standing at mount is history and stays silent', () => {
    render(<RoamHunterVoice event={gearEvent('e0', Rarity.Legendary)} xPct={12} topPct={10} />);
    expect(screen.queryByTestId('hunter-voice-chip')).toBeNull();
  });

  it('death silences the roam triggers', () => {
    const { rerender } = render(<RoamHunterVoice event={plainEvent('e0', 'standing')} xPct={12} topPct={10} />);
    act(() => useSurvivalStore.setState({ isDead: true }));
    rerender(<RoamHunterVoice event={gearEvent('e1', Rarity.Legendary)} xPct={12} topPct={10} />);
    expect(screen.queryByTestId('hunter-voice-chip')).toBeNull();
  });

  it('a near-death save (adrenaline flips on, hunter alive) fires; the killing flip stays silent', () => {
    render(<RoamHunterVoice event={plainEvent('e0', 'standing')} xPct={12} topPct={10} />);
    act(() => useSurvivalStore.setState({ adrenalineActive: true, currentHp: 42 }));
    const chip = screen.getByTestId('hunter-voice-chip');
    expect(HUNTER_VOICE_POOLS.vesper.nearDeathSave).toContain(chip.textContent);
    cleanup();

    resetHunterVoiceSession();
    useSurvivalStore.setState({ isDead: false, adrenalineActive: false, currentHp: 500 });
    render(<RoamHunterVoice event={plainEvent('e9', 'standing')} xPct={12} topPct={10} />);
    act(() => useSurvivalStore.setState({ adrenalineActive: true, isDead: true, currentHp: 0 }));
    expect(screen.queryByTestId('hunter-voice-chip')).toBeNull();
  });

  it('a streak claim landing after mount fires the streak line', () => {
    render(<RoamHunterVoice event={plainEvent('e0', 'standing')} xPct={12} topPct={10} />);
    act(() => useLoginStreakStore.setState({ lastClaimedGrantKey: 'grant-day-3' }));
    const chip = screen.getByTestId('hunter-voice-chip');
    expect(HUNTER_VOICE_POOLS.vesper.streakComplete).toContain(chip.textContent);
  });

  it('one moment never carries two lines: a legendary and a save in the same beat show one chip', () => {
    const { rerender } = render(<RoamHunterVoice event={plainEvent('e0', 'standing')} xPct={12} topPct={10} />);
    act(() => {
      useSurvivalStore.setState({ adrenalineActive: true, currentHp: 42 });
    });
    rerender(<RoamHunterVoice event={gearEvent('e1', Rarity.Legendary)} xPct={12} topPct={10} />);
    expect(screen.getAllByTestId('hunter-voice-chip')).toHaveLength(1);
  });

  it('a boss victory finish fires the boss-kill line; a defeat finish stays silent', () => {
    const { rerender } = render(<BossHunterVoice timeline={timeline(null, null)} bossId="boss-harrow" xPct={20} topPct={10} />);
    rerender(<BossHunterVoice timeline={timeline(9000, true)} bossId="boss-harrow" xPct={20} topPct={10} />);
    const chip = screen.getByTestId('hunter-voice-chip');
    expect(HUNTER_VOICE_POOLS.vesper.bossKill).toContain(chip.textContent);
    cleanup();

    resetHunterVoiceSession();
    const defeat = render(<BossHunterVoice timeline={timeline(null, null)} bossId="boss-harrow" xPct={20} topPct={10} />);
    defeat.rerender(<BossHunterVoice timeline={timeline(9000, false)} bossId="boss-harrow" xPct={20} topPct={10} />);
    expect(screen.queryByTestId('hunter-voice-chip')).toBeNull();
  });

  it('the line spoken is the ACTIVE hunter’s — switching hunters switches voices', () => {
    useSkillStore.setState({ activeHunterId: 'josie' });
    const { rerender } = render(<RoamHunterVoice event={plainEvent('e0', 'standing')} xPct={12} topPct={10} />);
    rerender(<RoamHunterVoice event={gearEvent('e1', Rarity.Legendary)} xPct={12} topPct={10} />);
    const chip = screen.getByTestId('hunter-voice-chip');
    expect(HUNTER_VOICE_POOLS.josie.legendaryDrop).toContain(chip.textContent);
    const trigger: HunterVoiceTrigger = 'legendaryDrop';
    expect(HUNTER_VOICE_POOLS.josie[trigger]).toBeDefined();
  });
});
