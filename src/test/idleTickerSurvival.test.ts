/**
 * idleTickerSlice — survival wiring (server-authoritative).
 *
 * CONTRACT:
 *   The idle ticker performs NO local survival simulation. It sends the
 *   hunter's current HP/shield to the Chef in the claim request and applies
 *   whatever survival state the server returns via `applyServerRewards`
 *   → `useSurvivalStore.syncFromServer`.
 *
 *   - When the server response omits `survival`, the store is unchanged.
 *   - When the server response includes `survival`, HP/shield/isDead are
 *     replaced with the server's authoritative values.
 *   - Death is recorded in combat stats ONLY when the Chef confirms
 *     `isDead: true` — never from local "HP reached 0" detection.
 *   - Feed events are server-authored (pushed verbatim from the claim
 *     response), never generated locally by a preview/roll function.
 *   - The ticker is a no-op when the hunter is already dead.
 *   - The client never auto-eats medkits; the Chef owns consumption.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIdleTickerStore, mountIdleTicker, unmountIdleTicker } from '@/store/slices/idleTickerSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useActivityStore } from '@/store/slices/activitySlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useCombatStatsStore } from '@/store/slices/combatStatsSlice';
import { useTickFeedStore } from '@/store/slices/tickSlice';
import type { ChefClaimResult } from '@/lib/chef/chefClient';

const { mockSubmitClaim } = vi.hoisted(() => ({ mockSubmitClaim: vi.fn() }));

vi.mock('@/lib/chef/chefClient', () => ({ submitClaim: mockSubmitClaim }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    claimRoamingRewards: vi.fn(async () => ({})),
  },
}));

vi.mock('@/lib/api/verifiedStateSync', () => ({
  syncVerifiedResult: vi.fn(),
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

/** A minimal Chef claim result with no survival or killCycle payload. */
const emptyClaimResult = (): ChefClaimResult => ({
  actionType: 'roaming_claim',
  profile: {},
  rewards: {
    ticks: 1,
    creditsAwarded: 0,
    scrapAwarded: 0,
    xpAwarded: 0,
    cacheFragmentsAwarded: 0,
    materials: {},
    essences: {},
    killsRecorded: 0,
  },
  items: [],
  feedEvents: [],
});

describe('idleTickerSlice — survival wiring (server-authoritative)', () => {
  beforeEach(() => {
    mockSubmitClaim.mockReset();
    useSurvivalStore.setState({
      currentHp: 700,
      maxHp: 700,
      shieldHp: 0,
      medKitBuffer: 0,
      nanoSwarmTicksRemaining: 0,
      adrenalineActive: false,
      adrenalineExpiresAt: 0,
      isDead: false,
      lastKilledBy: null,
      deathLog: [],
      resurrectionStartedAt: null,
      resurrectionReadyAt: null,
      autoEatThreshold: 0.7,
    });
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    usePlayerStore.setState({ id: 'player_1', level: 1, consumables: {} });
    useCombatStatsStore.setState({
      totalKills: 0,
      totalDeaths: 0,
      longestKillStreak: 0,
      currentKillStreak: 0,
      lastKillAt: null,
      runStartedAt: null,
      killsByArea: {},
      killsByWeaponType: {},
      killsByBoss: {},
      killsByElement: {},
      highestBossTier: 0,
      activePlaySeconds: 0,
      idlePlaySeconds: 0,
    });
    useTickFeedStore.setState({ events: [] });
    // Stop any ticker from a previous test.
    unmountIdleTicker();
  });

  afterEach(() => {
    unmountIdleTicker();
  });

  it('does not locally reduce HP — survival unchanged when the server omits survival', async () => {
    mockSubmitClaim.mockResolvedValue(emptyClaimResult());
    enterRoamingArea('dustwaste_frontier');
    const before = useSurvivalStore.getState().currentHp;
    await useIdleTickerStore.getState().tickNow();
    // No local damage math: HP only moves when the server reports it.
    expect(useSurvivalStore.getState().currentHp).toBe(before);
    expect(useSurvivalStore.getState().isDead).toBe(false);
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
  });

  it('syncs survival HP from the server response when the survival field is present', async () => {
    mockSubmitClaim.mockResolvedValue({
      ...emptyClaimResult(),
      survival: { currentHp: 400, shieldHp: 50, isDead: false },
    });
    enterRoamingArea('dustwaste_frontier');
    await useIdleTickerStore.getState().tickNow();
    const s = useSurvivalStore.getState();
    expect(s.currentHp).toBe(400);
    expect(s.shieldHp).toBe(50);
    expect(s.isDead).toBe(false);
  });

  it('records death only when the Chef confirms isDead=true (no local death sim)', async () => {
    mockSubmitClaim.mockResolvedValue({
      ...emptyClaimResult(),
      survival: { currentHp: 0, shieldHp: 0, isDead: true },
    });
    enterRoamingArea('redline_circuit');
    // Hunter is alive before the tick...
    expect(useSurvivalStore.getState().isDead).toBe(false);
    await useIdleTickerStore.getState().tickNow();
    // ...and is marked dead by the server's authoritative response, not by
    // local HP math.
    expect(useSurvivalStore.getState().isDead).toBe(true);
    expect(useSurvivalStore.getState().currentHp).toBe(0);
    // Death is recorded in combat stats ONLY from the server confirmation.
    expect(useCombatStatsStore.getState().totalDeaths).toBe(1);
    expect(useCombatStatsStore.getState().totalKills).toBe(0);
  });

  it('is a no-op when the hunter is already dead', async () => {
    mockSubmitClaim.mockResolvedValue(emptyClaimResult());
    useSurvivalStore.setState({ isDead: true, currentHp: 0 });
    enterRoamingArea('dustwaste_frontier');
    const beforeEvents = useTickFeedStore.getState().events.length;
    await useIdleTickerStore.getState().tickNow();
    // Ticker bails immediately when dead — no claim sent, no feed events.
    expect(mockSubmitClaim).not.toHaveBeenCalled();
    expect(useTickFeedStore.getState().events.length).toBe(beforeEvents);
  });

  it('pushes server-authored feed events to the tick feed (no local preview events)', async () => {
    mockSubmitClaim.mockResolvedValue({
      ...emptyClaimResult(),
      feedEvents: [
        { at: 1, tone: 'damage', label: '-30 HP', detail: 'raider patrol', areaId: 'dustwaste_frontier', value: 30 },
        { at: 2, tone: 'kill', label: 'Killed: raider', detail: 'patrol cleared', areaId: 'dustwaste_frontier' },
      ],
    });
    enterRoamingArea('dustwaste_frontier');
    await useIdleTickerStore.getState().tickNow();
    const events = useTickFeedStore.getState().events;
    // Events come verbatim from the server's simulation, pushed by the ticker.
    expect(events.filter((e) => e.tone === 'damage')).toHaveLength(1);
    expect(events.filter((e) => e.tone === 'kill')).toHaveLength(1);
  });

  it('does NOT auto-eat medkits client-side (the Chef owns consumption)', async () => {
    mockSubmitClaim.mockResolvedValue({
      ...emptyClaimResult(),
      survival: { currentHp: 100, shieldHp: 0, isDead: false },
    });
    usePlayerStore.setState({ consumables: { MedKit: 10 } });
    useSurvivalStore.setState({ currentHp: 100, maxHp: 700 }); // well below threshold
    enterRoamingArea('dustwaste_frontier');
    const medkitsBefore = usePlayerStore.getState().getConsumableCount('MedKit');
    await useIdleTickerStore.getState().tickNow();
    // The client never consumes medkits — consumption is server-authoritative.
    expect(usePlayerStore.getState().getConsumableCount('MedKit')).toBe(medkitsBefore);
  });

  it('does not apply survival changes when activity is not roaming_loot', async () => {
    mockSubmitClaim.mockResolvedValue(emptyClaimResult());
    useActivityStore.setState({
      current: {
        kind: 'idle_standby',
        bossPhase: 'prep',
        targetType: 'none',
        targetId: null,
        targetLabel: null,
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
    const before = useSurvivalStore.getState().currentHp;
    await useIdleTickerStore.getState().tickNow();
    // The ticker only runs for roaming_loot; other activities are no-ops.
    expect(useSurvivalStore.getState().currentHp).toBe(before);
    expect(mockSubmitClaim).not.toHaveBeenCalled();
  });

  it('mountIdleTicker starts the interval and stops on unmount', () => {
    mountIdleTicker();
    expect(useIdleTickerStore.getState().running).toBe(true);
    unmountIdleTicker();
    expect(useIdleTickerStore.getState().running).toBe(false);
  });
});
