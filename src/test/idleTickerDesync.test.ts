/**
 * Idle tick desync after an offline settle — regression coverage for
 * the 2026-11-03 owner report: "equipped, enemy in front of me, and
 * nothing happens" across many 3-second ticks after a return.
 *
 * Root cause (idle-cap-investigation-2026-11-03 §2.1): the offline
 * settler advances the server's last_claimed_tick by the settled
 * ticks (+2,400 for a full-cap 2h settle), but the ticker's private
 * counter only re-seeded from that watermark when it was exactly 0.
 * Every foreground claim after a return was refused by the tick
 * guard (409 'tick_count already claimed') — and the ticker scored
 * the 409 as a healthy landed claim, so the failure counters the
 * stall banner reads never moved while the stage painted the stale
 * encounter. The freeze lasted roughly the settled duration.
 *
 * Contracts pinned here:
 *  - F1: the counter adopts the player store's lastClaimedTick as
 *    its floor EVERY cycle. Settle-then-tick: the very next claim
 *    after a full-cap settle is accepted — ticks fire within one
 *    cycle of the return.
 *  - F2: a guard 409 whose returned watermark is AHEAD of the sent
 *    tickCount is a desync, not a landed batch: it counts as a
 *    failed cycle (stall machinery), the watermark is adopted from
 *    the 409 body, and the next cycle claims past it. A 409 whose
 *    watermark EQUALS the sent tickCount is still the idempotent
 *    same-batch replay and counts as landed, exactly as before.
 *  - Fresh-load control: a counter at 0 with no server watermark
 *    still seeds at tick 1.
 *
 * The ticker's counter is module state that accumulates across the
 * tests in this file (declaration order), mirroring a live session;
 * scenarios chain off the tickCounts observed on the wire.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIdleTickerStore, unmountIdleTicker } from '@/store/slices/idleTickerSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useActivityStore } from '@/store/slices/activitySlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useTickFeedStore } from '@/store/slices/tickSlice';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';

const { mockSubmitClaim, mockSyncVerifiedResult, mockSyncRuntimeItems } = vi.hoisted(() => ({
  mockSubmitClaim: vi.fn(),
  mockSyncVerifiedResult: vi.fn(),
  mockSyncRuntimeItems: vi.fn(async () => undefined),
}));

vi.mock('@/lib/chef/chefClient', () => ({ submitClaim: mockSubmitClaim }));

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

/** The tick guard's rejection as submitClaim surfaces it: status +
 * server error string + the 409 body's watermark attached. */
const guardError = (lastClaimedTick: number) => {
  const error = new Error('Chef claim failed (409): Conflict') as Error & {
    status?: number;
    chefError?: string;
    lastClaimedTick?: number;
  };
  error.status = 409;
  error.chefError = 'tick_count already claimed';
  error.lastClaimedTick = lastClaimedTick;
  return error;
};

/** Ticks a full-cap 2h offline settle advances the watermark. */
const FULL_CAP_SETTLE_TICKS = 2400;

describe('idleTickerSlice — tick desync after an offline settle', () => {
  beforeEach(() => {
    mockSubmitClaim.mockReset();
    mockSyncVerifiedResult.mockClear();
    mockSyncRuntimeItems.mockClear();
    useSurvivalStore.setState({
      currentHp: 700,
      maxHp: 700,
      shieldHp: 0,
      isDead: false,
    });
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, vehicle: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    usePlayerStore.setState({ id: 'player_1', level: 10, lastClaimedTick: 0, credits: 500 });
    useTickFeedStore.setState({ events: [] });
    useKillCycleStore.setState({
      currentTargetId: null,
      currentTargetHp: 0,
      currentTargetHpMax: 0,
      monstersKilledCount: 0,
      totalKills: 0,
      lastKilledMonsterId: null,
    });
    unmountIdleTicker();
    useIdleTickerStore.setState({ consecutiveClaimFailures: 0, syncStalled: false });
  });

  afterEach(() => {
    unmountIdleTicker();
  });

  it('fresh-load control: counter at 0 with no server watermark still seeds at tick 1 and lands', async () => {
    // Brand-new session, nothing settled: the adoption floor is 0,
    // so the first claim is tick 1 — the pre-fix seed behavior for
    // a fresh counter is preserved.
    usePlayerStore.setState({ lastClaimedTick: 0 });
    mockSubmitClaim.mockResolvedValue(landedClaimResult());
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();

    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
    expect(mockSubmitClaim.mock.calls[0][0].tickCount).toBe(1);
    expect(mockSyncVerifiedResult).toHaveBeenCalledTimes(1);
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(0);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);
  });

  it('settle-then-tick: after a full-cap settle (+2,400 ticks) the very next foreground claim is accepted', async () => {
    // The reported scenario. The session claimed tick 1 (previous
    // test), the player left, and the offline settle advanced the
    // server watermark by the full-cap 2,400 ticks. The player
    // store carries the post-settle truth (syncVerifiedResult) and
    // an enemy stands in front of the hunter on the stage.
    usePlayerStore.setState({ lastClaimedTick: 1 + FULL_CAP_SETTLE_TICKS });
    useKillCycleStore.setState({
      currentTargetId: 'highway_brawler',
      currentTargetHp: 120,
      currentTargetHpMax: 120,
    });
    mockSubmitClaim.mockResolvedValue(landedClaimResult());
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();

    // ONE claim, sent past the watermark, accepted: no 409 cycle,
    // no creep — ticks resolve within one cycle of the return.
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
    expect(mockSubmitClaim.mock.calls[0][0].tickCount).toBe(1 + FULL_CAP_SETTLE_TICKS + 1);
    expect(mockSyncVerifiedResult).toHaveBeenCalledTimes(1);
    expect(mockSyncRuntimeItems).not.toHaveBeenCalled();
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(0);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);
  });

  it('ahead-of-you 409 is NOT scored as landed: the cycle fails, the watermark is adopted from the body, the next cycle lands', async () => {
    // Race variant: a settle landed server-side but the player
    // store has NOT synced it (still shows the last claim's
    // watermark), so the per-cycle adoption cannot save this claim —
    // only the 409 body knows the truth.
    usePlayerStore.setState({ lastClaimedTick: 1 + FULL_CAP_SETTLE_TICKS + 1 });
    enterRoamingArea('dustwaste_frontier');

    let aheadWatermark = 0;
    mockSubmitClaim.mockImplementationOnce(async (req: { tickCount: number }) => {
      aheadWatermark = req.tickCount + FULL_CAP_SETTLE_TICKS;
      throw guardError(aheadWatermark);
    });

    await useIdleTickerStore.getState().tickNow();

    // The unlandable batch is not retried, not converged from the
    // item ledger, and NOT scored healthy: it counts as a failed
    // cycle toward the stall threshold.
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
    expect(aheadWatermark).toBeGreaterThan(0);
    expect(mockSyncRuntimeItems).not.toHaveBeenCalled();
    expect(mockSyncVerifiedResult).not.toHaveBeenCalled();
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(1);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);

    // Next cycle: the counter was adopted from the 409 body (the
    // player store still lags), so the claim goes out PAST the
    // watermark and lands — the freeze lasts one cycle, not 2,400.
    mockSubmitClaim.mockResolvedValue(landedClaimResult());
    await useIdleTickerStore.getState().tickNow();

    expect(mockSubmitClaim).toHaveBeenCalledTimes(2);
    expect(mockSubmitClaim.mock.calls[1][0].tickCount).toBe(aheadWatermark + 1);
    expect(mockSyncVerifiedResult).toHaveBeenCalledTimes(1);
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(0);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);
  });

  it('same-batch replay 409 (watermark equals the sent tickCount) still counts as landed', async () => {
    // The idempotent-replay contract, undisturbed: the first
    // attempt's response is lost in transport; the same-batch retry
    // meets the guard, whose watermark names THIS batch's tick —
    // proof it landed. The cycle converges from the item ledger,
    // applies no payload, and counts no failure.
    usePlayerStore.setState({ lastClaimedTick: 0 });
    enterRoamingArea('dustwaste_frontier');

    mockSubmitClaim
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce(async (req: { tickCount: number }) => {
        throw guardError(req.tickCount);
      });

    await useIdleTickerStore.getState().tickNow();

    expect(mockSubmitClaim).toHaveBeenCalledTimes(2);
    // The retry submitted the identical batch.
    expect(mockSubmitClaim.mock.calls[1][0]).toBe(mockSubmitClaim.mock.calls[0][0]);
    expect(mockSyncRuntimeItems).toHaveBeenCalledTimes(1);
    expect(mockSyncRuntimeItems).toHaveBeenCalledWith('player_1');
    expect(mockSyncVerifiedResult).not.toHaveBeenCalled();
    expect(useIdleTickerStore.getState().consecutiveClaimFailures).toBe(0);
    expect(useIdleTickerStore.getState().syncStalled).toBe(false);
  });
});
