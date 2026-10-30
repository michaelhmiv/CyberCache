/**
 * Phase 0 Slice 3 — a failed Chef claim pays NOTHING.
 *
 * The mechanics audit (stats-and-areas.md §2.1) found the ticker's
 * error path silently fell back to cc_claim_roaming_rewards, whose
 * seed rates (flat 1 credit/tick, 0 scrap, every area, no mods,
 * skills, or consumables) differ from the Chef's settlement in every
 * area — a player on a flaky connection earned off-design rates with
 * no indication anything was wrong.
 *
 * Contract now:
 *  - submitClaim rejects → no rewards are applied from anywhere
 *    (syncVerifiedResult is never called), and specifically the old
 *    fallback op is never invoked.
 *  - The failure is not terminal: the next tick cycle retries the
 *    Chef claim.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIdleTickerStore, unmountIdleTicker } from '@/store/slices/idleTickerSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useActivityStore } from '@/store/slices/activitySlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useTickFeedStore } from '@/store/slices/tickSlice';

const { mockSubmitClaim, mockClaimRoamingRewards, mockSyncVerifiedResult } = vi.hoisted(() => ({
  mockSubmitClaim: vi.fn(),
  mockClaimRoamingRewards: vi.fn(async () => ({})),
  mockSyncVerifiedResult: vi.fn(),
}));

vi.mock('@/lib/chef/chefClient', () => ({ submitClaim: mockSubmitClaim }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    claimRoamingRewards: mockClaimRoamingRewards,
  },
}));

vi.mock('@/lib/api/verifiedStateSync', () => ({
  syncVerifiedResult: mockSyncVerifiedResult,
}));

vi.mock('@/store/runtimeSupabaseSync', () => ({
  saveCurrentRuntimeStores: vi.fn(async () => undefined),
}));

vi.mock('@/store/combatStatsSupabaseSync', () => ({
  saveCombatStats: vi.fn(async () => undefined),
}));

const enterRoamingArea = (areaId: string) => {
  useActivityStore.setState({
    current: {
      kind: 'roaming_loot',
      bossPhase: 'prep',
      targetType: 'roaming_area',
      targetId: areaId,
      targetLabel: areaId,
      startedAt: null,
      completesAt: null,
      sceneKey: null,
      notes: null,
      activityPayload: {},
      publicPayload: {},
      lastHeartbeatAt: null,
      publicVisible: true,
      schemaVersion: 1,
      updatedAt: null,
    } as never,
  });
};

describe('idleTickerSlice — Chef claim failure pays nothing (no fallback engine)', () => {
  beforeEach(() => {
    mockSubmitClaim.mockReset();
    mockClaimRoamingRewards.mockClear();
    mockSyncVerifiedResult.mockClear();
    useSurvivalStore.setState({
      currentHp: 700,
      maxHp: 700,
      shieldHp: 0,
      isDead: false,
    });
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    usePlayerStore.setState({ id: 'player_1', level: 10, lastClaimedTick: 0, credits: 500 });
    useTickFeedStore.setState({ events: [] });
    unmountIdleTicker();
  });

  afterEach(() => {
    unmountIdleTicker();
  });

  it('applies no rewards and never calls the retired fallback when the Chef claim rejects', async () => {
    mockSubmitClaim.mockRejectedValue(new Error('Chef claim failed (500): boom'));
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();

    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
    // The wrong-rate fallback engine is never invoked…
    expect(mockClaimRoamingRewards).not.toHaveBeenCalled();
    // …and nothing from any path is applied to the player's stores.
    expect(mockSyncVerifiedResult).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().credits).toBe(500);
  });

  it('retries the Chef claim on the next cycle after a failure', async () => {
    mockSubmitClaim.mockRejectedValue(new Error('Chef claim failed (503): down'));
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();
    await useIdleTickerStore.getState().tickNow();

    expect(mockSubmitClaim).toHaveBeenCalledTimes(2);
    expect(mockClaimRoamingRewards).not.toHaveBeenCalled();
    expect(mockSyncVerifiedResult).not.toHaveBeenCalled();
  });

  it('the shipped ticker source carries no fallback claim path', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/store/slices/idleTickerSlice.ts'), 'utf8');
    // No verifiedOps import at all: the ticker cannot reach the ops
    // fallback (or any other ops shortcut) around the Chef claim.
    expect(source).not.toContain('verifiedOps');
    expect(source).not.toContain('claimRoamingRewards(');
  });
});
