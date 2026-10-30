/**
 * idleTickerSlice — kill cycle wiring (server-authoritative).
 *
 * CONTRACT:
 *   The idle ticker performs NO local kill-cycle simulation. It sends the
 *   current kill cycle state to the Chef in the claim request and applies
 *   whatever kill cycle state the server returns via `applyServerRewards`
 *   → `useKillCycleStore.syncFromServer`.
 *
 *   - When the server response omits `killCycle`, the store is unchanged.
 *   - When the server response includes `killCycle`, the store is replaced
 *     wholesale with the server's values (no local deltas merged, no local
 *     spawn/damage math).
 *   - Kills are attributed from `rewards.killsRecorded` (the server's
 *     tally), never from local "target reached 0 HP" detection.
 *   - `applyKillCycleTick` no longer exists.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIdleTickerStore, unmountIdleTicker } from '@/store/slices/idleTickerSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';
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

/** A minimal Chef claim result with no killCycle or survival payload. */
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

const resetStores = () => {
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
  useKillCycleStore.setState({
    currentTargetId: null,
    currentTargetHp: 0,
    currentTargetHpMax: 0,
    monstersKilledCount: 0,
    totalKills: 0,
    lastKilledMonsterId: null,
    targetSpawnedAt: null,
  });
  useLoadoutStore.setState({
    slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({ id: 'player_1', level: 1, consumables: {}, xp: 0 });
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
};

describe('idleTickerSlice — kill cycle wiring (server-authoritative)', () => {
  beforeEach(() => {
    mockSubmitClaim.mockReset();
    resetStores();
    unmountIdleTicker();
  });

  afterEach(() => unmountIdleTicker());

  it('does not locally spawn or damage a target — store stays empty when the server omits killCycle', async () => {
    mockSubmitClaim.mockResolvedValue(emptyClaimResult());
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();

    // No killCycle field in the response → the store is untouched by
    // applyServerRewards. The ticker never spawned a target locally.
    const kc = useKillCycleStore.getState();
    expect(kc.currentTargetId).toBeNull();
    expect(kc.currentTargetHp).toBe(0);
    expect(kc.currentTargetHpMax).toBe(0);
    expect(kc.monstersKilledCount).toBe(0);
    expect(kc.totalKills).toBe(0);
    expect(kc.lastKilledMonsterId).toBeNull();
    expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
  });

  it('syncs kill cycle state from the server response when the killCycle field is present', async () => {
    mockSubmitClaim.mockResolvedValue({
      ...emptyClaimResult(),
      killCycle: {
        currentTargetId: 'dustwaste_raider',
        currentTargetHp: 42,
        currentTargetHpMax: 100,
        monstersKilledCount: 3,
        totalKills: 7,
        lastKilledMonsterId: 'dustwaste_raider',
      },
    });
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();

    // The store is replaced wholesale with the server's authoritative
    // values via syncFromServer — no local spawn/damage math involved.
    const kc = useKillCycleStore.getState();
    expect(kc.currentTargetId).toBe('dustwaste_raider');
    expect(kc.currentTargetHp).toBe(42);
    expect(kc.currentTargetHpMax).toBe(100);
    expect(kc.monstersKilledCount).toBe(3);
    expect(kc.totalKills).toBe(7);
    expect(kc.lastKilledMonsterId).toBe('dustwaste_raider');
  });

  it('attributes kills from server rewards.killsRecorded, with no local kill detection', async () => {
    mockSubmitClaim.mockResolvedValue({
      ...emptyClaimResult(),
      rewards: {
        ...emptyClaimResult().rewards,
        killsRecorded: 3,
      },
    });
    enterRoamingArea('dustwaste_frontier');

    await useIdleTickerStore.getState().tickNow();

    // Kills come exclusively from the server's tally, not from a local
    // "target HP hit 0" detection.
    expect(useCombatStatsStore.getState().totalKills).toBe(3);
    expect(useCombatStatsStore.getState().killsByArea['dustwaste_frontier']).toBe(3);
    // With no killCycle field in the response, the kill cycle store's own
    // totalKills is unchanged — proving kills aren't double-attributed.
    expect(useKillCycleStore.getState().totalKills).toBe(0);
  });
});
