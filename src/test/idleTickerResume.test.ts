/**
 * Foreground resume — the idle ticker's half of the fix for the
 * owner's 2026-11-02 report ("whenever I go back to the game the
 * roaming stalls out and the characters are just sitting there").
 *
 * Contract:
 *  - Mounting the ticker claims IMMEDIATELY (one tick) instead of
 *    leaving a cold-started stage idle until the first interval
 *    boundary up to 3s later.
 *  - A return from a BRIEF hidden span (< the shared 15s
 *    settlement threshold) claims at once — not at the next
 *    interval phase — and the catch-up batch's routine feed events
 *    are stamped `folded` (they join the record, the gain-toast
 *    lane skips them: no pop-up burst). Gear drops are never
 *    folded; a one-tick batch is never folded.
 *  - If the resume tick is busy-skipped because a pre-hide claim
 *    is still in flight, ONE deferred re-check fires the catch-up
 *    tick after it settles — and never doubles a claim that was
 *    already attempted since the return.
 *  - A return from a REAL absence (>= 15s) fires no immediate
 *    claim and folds nothing: the resume settlement hook owns
 *    that return (settle-offline + recap), and the plain interval
 *    cadence converges from server truth.
 *
 * Fake timers throughout; hidden spans are driven with
 * vi.setSystemTime so the interval cannot fire mid-span (a real
 * backgrounded WebView pauses timers the same way).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useIdleTickerStore,
  mountIdleTicker,
  unmountIdleTicker,
} from '@/store/slices/idleTickerSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useActivityStore } from '@/store/slices/activitySlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useTickFeedStore, type TickEvent } from '@/store/slices/tickSlice';

const { mockSubmitClaim, mockSyncVerifiedResult } = vi.hoisted(() => ({
  mockSubmitClaim: vi.fn(),
  mockSyncVerifiedResult: vi.fn(),
}));

vi.mock('@/lib/chef/chefClient', () => ({ submitClaim: mockSubmitClaim }));
vi.mock('@/lib/api/verifiedStateSync', () => ({ syncVerifiedResult: mockSyncVerifiedResult }));
vi.mock('@/lib/api/runtimeStateService', () => ({ syncRuntimeItemsForUser: vi.fn(async () => undefined) }));
vi.mock('@/store/runtimeSupabaseSync', () => ({ saveCurrentRuntimeStores: vi.fn(async () => undefined) }));
vi.mock('@/store/combatStatsSupabaseSync', () => ({ saveCombatStats: vi.fn(async () => undefined) }));

let hidden = false;

const setHidden = (next: boolean) => {
  hidden = next;
  document.dispatchEvent(new Event('visibilitychange'));
};

const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

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

const landedWithEvents = () => ({
  profile: { id: 'player_1', credits: 900 },
  rewards: { killsRecorded: 0 },
  feedEvents: [
    { id: 'ev-cash', at: 1, tone: 'cash', label: '+30cr', detail: 'field sweep' },
    { id: 'ev-xp', at: 2, tone: 'xp', label: '+16 XP', detail: '' },
    { id: 'ev-drop', at: 3, tone: 'loot', label: 'Dust SMG', detail: '', gear: { id: 'gear_1' } },
  ] as unknown as TickEvent[],
  items: [],
});

const feedById = () => new Map(useTickFeedStore.getState().events.map((e) => [e.id, e]));

describe('idleTickerSlice — foreground resume', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    mockSubmitClaim.mockReset();
    mockSyncVerifiedResult.mockClear();
    mockSubmitClaim.mockResolvedValue(landedWithEvents());
    useSurvivalStore.setState({ currentHp: 700, maxHp: 700, shieldHp: 0, isDead: false });
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, vehicle: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    usePlayerStore.setState({ id: 'player_1', level: 10, lastClaimedTick: 0, credits: 500 });
    useTickFeedStore.setState({ events: [] });
    unmountIdleTicker();
    useIdleTickerStore.setState({ consecutiveClaimFailures: 0, syncStalled: false });
    enterRoamingArea('dustwaste_frontier');
  });

  afterEach(() => {
    unmountIdleTicker();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('claims one tick immediately on mount — a cold start never waits for the interval', async () => {
    mountIdleTicker();
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
    expect(mockSubmitClaim.mock.calls[0][0].ticks).toBe(1);
    // The mount batch is ordinary flow: nothing is folded.
    expect(feedById().get('ev-cash')?.folded).toBeUndefined();
  });

  it('a brief app switch claims at once on return and folds the catch-up batch (drops exempt)', async () => {
    mountIdleTicker();
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);

    setHidden(true);
    vi.setSystemTime(Date.now() + 9000);
    setHidden(false);
    await flush();

    // The resume claim fired from the visibility return itself —
    // no timer advance was needed — and it claims the whole span.
    expect(mockSubmitClaim).toHaveBeenCalledTimes(2);
    expect(mockSubmitClaim.mock.calls[1][0].ticks).toBe(3);
    const feed = feedById();
    expect(feed.get('ev-cash')?.folded).toBe(true);
    expect(feed.get('ev-xp')?.folded).toBe(true);
    // Loot keeps its moment even in a folded batch.
    expect(feed.get('ev-drop')?.folded).toBeUndefined();

    // The deferred re-check does not double the resume claim.
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(2);
  });

  it('a pre-hide claim still in flight defers the catch-up to the one re-check, which folds it', async () => {
    let release: ((value: unknown) => void) | undefined;
    mockSubmitClaim.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    mountIdleTicker();
    await flush();
    // The mount claim is hanging (a frozen WebView's in-flight fetch).
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);

    setHidden(true);
    vi.setSystemTime(Date.now() + 9000);
    setHidden(false);
    await flush();
    // Busy-skipped: no second claim while the first is in flight.
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);

    release?.(landedWithEvents());
    await flush();
    // The pre-hide batch lands unfolded — it was claimed live.
    expect(feedById().get('ev-cash')?.folded).toBeUndefined();

    // The re-check fires the catch-up tick for the hidden span.
    await vi.advanceTimersByTimeAsync(1500);
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(2);
    expect(mockSubmitClaim.mock.calls[1][0].ticks).toBeGreaterThanOrEqual(2);
    expect(feedById().get('ev-cash')?.folded).toBe(true);
  });

  it('an in-flight claim that outlasts the first re-check still gets its catch-up at the next one', async () => {
    let release: ((value: unknown) => void) | undefined;
    mockSubmitClaim.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    mountIdleTicker();
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);

    setHidden(true);
    vi.setSystemTime(Date.now() + 9000);
    setHidden(false);
    await flush();

    // First re-check at +1.5s: the pre-hide claim is STILL in
    // flight, so nothing fires yet — and nothing is lost.
    await vi.advanceTimersByTimeAsync(1500);
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);

    release?.(landedWithEvents());
    await flush();

    // Second re-check: the way is clear and no claim was attempted
    // since the return, so the catch-up tick fires, folded.
    await vi.advanceTimersByTimeAsync(1500);
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(2);
    expect(feedById().get('ev-cash')?.folded).toBe(true);
  });

  it('a real absence (>= 15s) gets no immediate claim and no fold — the settlement lane owns it', async () => {
    mountIdleTicker();
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);

    setHidden(true);
    vi.setSystemTime(Date.now() + 20000);
    setHidden(false);
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);

    // The plain interval cadence still converges on its own, and
    // its batch is presented normally (the recap is the summary for
    // the absence, not a folded feed).
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(2);
    expect(feedById().get('ev-cash')?.folded).toBeUndefined();
  });

  it('stops resuming after unmount', async () => {
    mountIdleTicker();
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
    unmountIdleTicker();

    setHidden(true);
    vi.setSystemTime(Date.now() + 9000);
    setHidden(false);
    await flush();
    await vi.advanceTimersByTimeAsync(6000);
    await flush();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
  });
});
