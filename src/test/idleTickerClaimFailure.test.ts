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
 *  - The batch is retried ONCE, immediately, with the identical
 *    payload (same ticks, same tickCount). The server's tick guard
 *    makes that safe: a duplicate tickCount is refused with 409
 *    'tick_count already claimed' before any payment, so the retry
 *    can never double-pay.
 *  - A 409 from the guard means the batch DID land and only its
 *    response was lost: the cycle counts as landed, nothing is
 *    applied from a payload we never received, and the inventory
 *    re-syncs from the server's item ledger instead.
 *  - A batch whose retry also fails is skipped; consecutive failed
 *    cycles are counted, and after 2 the ticker exposes syncStalled
 *    so the Action screen can show the stall instead of letting the
 *    roaming scene animate over a silently broken sync.
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

const { mockSubmitClaim, mockClaimRoamingRewards, mockSyncVerifiedResult, mockSyncRuntimeItems } = vi.hoisted(() => ({
  mockSubmitClaim: vi.fn(),
  mockClaimRoamingRewards: vi.fn(async () => ({})),
  mockSyncVerifiedResult: vi.fn(),
  mockSyncRuntimeItems: vi.fn(async () => undefined),
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

vi.mock('@/lib/api/runtimeStateService', () => ({
  syncRuntimeItemsForUser: mockSyncRuntimeItems,
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

const landedClaimResult = () => ({
  profile: { id: 'player_1', credits: 900 },
  rewards: { killsRecorded: 0 },
  feedEvents: [],
  items: [],
});

/** The tick guard's rejection as submitClaim surfaces it (status +
 * server error string attached to the thrown error). */
const guardErrorWithProps = () => {
  const error = new Error('Chef claim failed (409): Conflict') as Error & {
    status?: number;
    chefError?: string;
  };
  error.status = 409;
  error.chefError = 'tick_count already claimed';
  return error;
};

describe('idleTickerSlice — Chef claim failure pays nothing (no fallback engine)', () => {
  beforeEach(() => {
    mockSubmitClaim.mockReset();
    mockClaimRoamingRewards.mockClear();
    mockSyncVerifiedResult.mockClear();
    mockSyncRuntimeItems.mockClear();
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
    useIdleTickerStore.setState({ consecutiveClaimFailures: 0, syncStalled: false });
  });

  afterEach(() => {
    unmountIdleTicker();
  });

  it('applies no rewards and never calls the retired fallback when the Chef claim rejects (initial attempt + same-batch retry)', async () => {
    mockSubmitClaim.mockRejectedValue(new Error('Chef claim failed (500): boom'));
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();

    // One cycle = the initial attempt plus the single same-batch retry.
    expect(mockSubmitClaim).toHaveBeenCalledTimes(2);
    // The wrong-rate fallback engine is never invoked…
    expect(mockClaimRoamingRewards).not.toHaveBeenCalled();
    // …and nothing from any path is applied to the player's stores.
    expect(mockSyncVerifiedResult).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().credits).toBe(500);
    // One failed cycle is counted, but the stall is not yet visible.
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(1);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);
  });

  it('keeps cycling after failures — each cycle submits its batch and its one retry', async () => {
    mockSubmitClaim.mockRejectedValue(new Error('Chef claim failed (503): down'));
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();
    await useIdleTickerStore.getState().tickNow();

    // Two cycles × (attempt + retry).
    expect(mockSubmitClaim).toHaveBeenCalledTimes(4);
    expect(mockClaimRoamingRewards).not.toHaveBeenCalled();
    expect(mockSyncVerifiedResult).not.toHaveBeenCalled();
  });

  it('retries the identical batch once and applies its rewards exactly once when the retry lands', async () => {
    mockSubmitClaim
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(landedClaimResult());
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();

    expect(mockSubmitClaim).toHaveBeenCalledTimes(2);
    // The retry submits the IDENTICAL claim — same object, same
    // tickCount, same ticks; nothing is recomputed between attempts.
    const [firstPayload, secondPayload] = [
      mockSubmitClaim.mock.calls[0][0],
      mockSubmitClaim.mock.calls[1][0],
    ];
    expect(secondPayload).toBe(firstPayload);
    expect(secondPayload.tickCount).toBe(firstPayload.tickCount);
    expect(secondPayload.ticks).toBe(firstPayload.ticks);
    // The landed batch's rewards are applied exactly once.
    expect(mockSyncVerifiedResult).toHaveBeenCalledTimes(1);
    expect(mockSyncVerifiedResult).toHaveBeenCalledWith(landedClaimResult());
    expect(mockClaimRoamingRewards).not.toHaveBeenCalled();
    // A landed claim leaves no failure state behind.
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(0);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);
  });

  it('sets syncStalled after 2 consecutive failed cycles and clears it on the next landed claim', async () => {
    mockSubmitClaim.mockRejectedValue(new Error('Chef claim failed (503): down'));
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(1);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);

    await useIdleTickerStore.getState().tickNow();
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(2);
    expect(useIdleTickerStore.getState().syncStalled).toBe(true);

    mockSubmitClaim.mockResolvedValue(landedClaimResult());
    await useIdleTickerStore.getState().tickNow();
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(0);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);
    expect(mockSyncVerifiedResult).toHaveBeenCalledTimes(1);
  });

  it('treats a guard 409 on the retry as landed: re-syncs items, applies no payload, counts no failure', async () => {
    // First attempt dies in transport (response lost — the claim may
    // or may not have committed); the retry meets the tick guard,
    // which proves the batch landed server-side.
    mockSubmitClaim
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(guardErrorWithProps());
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();

    expect(mockSubmitClaim).toHaveBeenCalledTimes(2);
    // Convergence comes from the server's item ledger…
    expect(mockSyncRuntimeItems).toHaveBeenCalledTimes(1);
    expect(mockSyncRuntimeItems).toHaveBeenCalledWith('player_1');
    // …never from a payload we did not receive (no double-apply).
    expect(mockSyncVerifiedResult).not.toHaveBeenCalled();
    expect(mockClaimRoamingRewards).not.toHaveBeenCalled();
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(0);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);

    // Proof it counted as landed, not as a failure: a single fully
    // failed cycle afterwards is failure #1 — the stall stays hidden.
    mockSubmitClaim.mockRejectedValue(new Error('Chef claim failed (500): boom'));
    await useIdleTickerStore.getState().tickNow();
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(1);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);
  });

  it('treats a guard 409 on the first attempt as landed without retrying', async () => {
    // Message-only error shape (no attached props) — the ticker also
    // recognizes the guard's rejection from the thrown message.
    mockSubmitClaim.mockRejectedValue(new Error('Chef claim failed (409): Conflict'));
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();

    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
    expect(mockSyncRuntimeItems).toHaveBeenCalledTimes(1);
    expect(mockSyncRuntimeItems).toHaveBeenCalledWith('player_1');
    expect(mockSyncVerifiedResult).not.toHaveBeenCalled();
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(0);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);
  });

  it('the shipped ticker source carries no fallback claim path', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/store/slices/idleTickerSlice.ts'), 'utf8');
    // No verifiedOps import at all: the ticker cannot reach the ops
    // fallback (or any other ops shortcut) around the Chef claim.
    expect(source).not.toContain('verifiedOps');
    expect(source).not.toContain('claimRoamingRewards(');
  });
});
