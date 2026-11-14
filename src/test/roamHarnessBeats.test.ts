import { describe, expect, it } from 'vitest';
import { classifyTickBeat } from '@/lib/pixel/movement';
import type { TickEvent } from '@/store/slices/tickSlice';

/**
 * The anim-replay harness seams (__seedBeat in RoamHarnessPage.tsx)
 * seed feed events in exactly these shapes. The stage's beat clock
 * keys on the event id, and classifyTickBeat reads tone/label/value
 * — these pins keep the seam shapes honest against the real
 * classifier (a seam that seeds a shape the classifier ignores
 * would make the whole replay loop measure nothing).
 */
const beat = (partial: Partial<TickEvent>): TickEvent =>
  ({ id: 'harness-beat-test', at: 1, detail: 'harness', ...partial }) as TickEvent;

describe('roam harness beat seam shapes', () => {
  it('a shot seed (production hit shape: tone hit, -N HP label) classifies as a shot beat', () => {
    expect(classifyTickBeat(beat({ tone: 'hit', label: '-10 HP', value: 10 }), 100)?.kind).toBe('shot');
  });

  it('a heavy hit seed at/above the crit fraction classifies as a crit', () => {
    expect(classifyTickBeat(beat({ tone: 'hit', label: '-20 HP', value: 20 }), 100)?.kind).toBe('crit');
  });

  it('a nova-shaped hit seed (label without a leading minus) still classifies as a hit beat carrying its value', () => {
    const nova = classifyTickBeat(beat({ tone: 'hit', label: 'Nova burst — 30 damage', value: 30 }), 100);
    expect(nova?.kind).toBe('crit'); // 30/100 = 0.30 ≥ 0.18 — the label never gates the match
    expect(nova?.value).toBe(30);
  });

  it('a player-hit seed (damage tone) classifies as playerHit', () => {
    expect(classifyTickBeat(beat({ tone: 'damage', label: '-7', value: 7 }), 100)?.kind).toBe('playerHit');
  });

  it('a kill seed classifies as kill', () => {
    expect(classifyTickBeat(beat({ tone: 'kill', label: 'kill', value: 10 }), 100)?.kind).toBe('kill');
  });

  it('a material-drop seed classifies as NO combat beat (beam only, no reaction)', () => {
    expect(classifyTickBeat(beat({ tone: 'material', label: '+1 TechFragments', value: 1 }), 100)).toBeNull();
  });
});
