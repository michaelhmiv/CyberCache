/**
 * Audit H-02 — occupation switches are disclosed, not silent.
 *
 * Settle-and-switch is the shipped law (starting an action settles
 * the outgoing one), but the switch itself was invisible: one ROAM
 * rail tap paused a running bench with no word said, and merely
 * selecting a boss ended a roam's claims in silence. The activity
 * slice — the one seam every start flows through — now records a
 * displacement notice naming the displaced action, and Home
 * renders it above the Stage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/activityService', () => ({
  startActiveActivity: vi.fn(async (input: { kind: string; targetId?: string | null }) => ({
    userId: 'user-1',
    kind: input.kind,
    startedAt: '2026-11-02T00:00:00.000Z',
    completesAt: null,
    targetType: null,
    targetId: input.targetId ?? null,
    targetLabel: null,
    sceneKey: null,
    notes: null,
    activityPayload: {},
    publicPayload: {},
    lastHeartbeatAt: null,
    publicVisible: true,
    schemaVersion: 1,
    updatedAt: null,
    bossPhase: 'prep',
  })),
  clearActiveActivity: vi.fn(async () => null),
  getMyActiveActivity: vi.fn(async () => null),
  heartbeatActiveActivity: vi.fn(async () => null),
}));

vi.mock('@/lib/analytics/analytics', () => ({
  trackRoamStart: vi.fn(),
  trackRoamStop: vi.fn(),
}));

import { displacementNoticeFor, useActivityStore } from '@/store/slices/activitySlice';
import type { StartActivityInput } from '@/types/activity';

const start = (kind: StartActivityInput['kind'], targetId?: string) =>
  useActivityStore.getState().start({ kind, targetId } as StartActivityInput);

describe('audit H-02 — displacement notices at the activity/set seam', () => {
  beforeEach(() => {
    useActivityStore.getState().reset();
  });

  it('names the displaced occupation: crafting pauses for a roam, a roam ends for a boss', async () => {
    await start('crafting');
    expect(useActivityStore.getState().displacementNotice).toBeNull();

    await start('roaming_loot', 'dustwaste');
    expect(useActivityStore.getState().displacementNotice)
      .toBe('Crafting paused — Roaming started. Bench jobs resume when Crafting holds the slot again.');

    useActivityStore.getState().clearDisplacementNotice();
    expect(useActivityStore.getState().displacementNotice).toBeNull();

    await start('boss_fight', 'dune_tyrant');
    expect(useActivityStore.getState().displacementNotice)
      .toBe('Roaming ended — Boss fight started.');
  });

  it('no notice for a fresh start from standby or a same-kind restart', async () => {
    await start('roaming_loot', 'dustwaste');
    expect(useActivityStore.getState().displacementNotice).toBeNull();
    // A roam changing areas is a new roam, not a displaced occupation.
    await start('roaming_loot', 'redline_circuit');
    expect(useActivityStore.getState().displacementNotice).toBeNull();
  });

  it('the pure helper prices every direction honestly', () => {
    expect(displacementNoticeFor('crafting', 'boss_fight'))
      .toBe('Crafting paused — Boss fight started. Bench jobs resume when Crafting holds the slot again.');
    expect(displacementNoticeFor('boss_fight', 'crafting')).toBe('Boss fight ended — Crafting started.');
    expect(displacementNoticeFor('idle_standby', 'crafting')).toBeNull();
    expect(displacementNoticeFor('extraction', 'endless_run')).toBe('Extraction ended — Endless run started.');
    expect(displacementNoticeFor('crafting', 'crafting')).toBeNull();
  });
});
