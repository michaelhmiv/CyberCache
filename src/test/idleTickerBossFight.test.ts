/**
 * idleTickerSlice — boss fight wiring (server-authoritative).
 *
 * CONTRACT:
 *   Boss fights are resolved by the cc_battle_result / verify-boss RPC at
 *   fight start — NOT by the per-tick idle ticker. When the active
 *   activity is `boss_fight`, `tickNow` is a complete no-op: it does not
 *   send a roaming claim to the Chef, does not drain boss HP, does not
 *   touch survival/killCycle/player stores, and pushes no feed events.
 *
 * The local `applyBossFightTick` simulation was removed. During a boss
 * fight the ticker simply does nothing; combat animation data comes from
 * the boss-attempt RPC response, not from the roaming ticker.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIdleTickerStore } from '@/store/slices/idleTickerSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useActivityStore } from '@/store/slices/activitySlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useBossStore } from '@/store/slices/bossSlice';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';
import { useTickFeedStore } from '@/store/slices/tickSlice';

// submitClaim is the Chef roaming-claim entry point. We mock it so we can
// assert it is NEVER invoked while the activity is boss_fight.
const { mockSubmitClaim } = vi.hoisted(() => ({ mockSubmitClaim: vi.fn() }));

vi.mock('@/lib/chef/chefClient', () => ({ submitClaim: mockSubmitClaim }));

// Suppress all network / RPC side effects for these isolated wiring tests.
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

function setBossFightActivity(bossId: string) {
  useActivityStore.setState({
    current: {
      kind: 'boss_fight',
      bossPhase: 'fight',
      targetType: 'boss',
      targetId: bossId,
      targetLabel: 'Test Boss',
      startedAt: null,
      completesAt: null,
      sceneKey: null,
      notes: null,
      activityPayload: {},
      publicPayload: {},
      lastHeartbeatAt: null,
      publicVisible: false,
      schemaVersion: 1,
      updatedAt: null,
    } as never,
  });
}

describe('idleTickerSlice — boss fight wiring (server-authoritative)', () => {
  beforeEach(() => {
    mockSubmitClaim.mockReset();
    useSurvivalStore.setState({
      currentHp: 500,
      maxHp: 500,
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
      autoEatThreshold: 0.4,
    });
    useLoadoutStore.setState({
      slots: {
        primary: null,
        secondary: null,
        heavy: null,
        ordnance: null,
        shield: null,
        classMod: null,
        relic: null,
      },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    usePlayerStore.setState({ level: 1, credits: 0, consumables: { MedKit: 5 } });
    useBossStore.setState({
      activeBossId: null,
      activeBossHp: 0,
      activeBossMaxHp: 0,
      activeStatus: 'idle',
      activeMedkitsConsumed: 0,
      activeDamageDealt: 0,
      activeTickCount: 0,
      activeStartedAt: 0,
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
    useTickFeedStore.setState({ events: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op during boss_fight activity — does not call the Chef at all', async () => {
    setBossFightActivity('dune_tyrant');
    await useIdleTickerStore.getState().tickNow();
    expect(mockSubmitClaim).not.toHaveBeenCalled();
  });

  it('does not mutate the boss store during boss_fight activity', async () => {
    // Start a live fight directly so the boss store has real values to protect.
    useBossStore.getState().startLiveFight('dune_tyrant', 1000);
    setBossFightActivity('dune_tyrant');
    await useIdleTickerStore.getState().tickNow();
    // The ticker never touches the boss store — boss fights are resolved by
    // the cc_battle_result RPC, never by per-tick simulation.
    expect(useBossStore.getState().activeBossHp).toBe(1000);
    expect(useBossStore.getState().activeBossMaxHp).toBe(1000);
    expect(useBossStore.getState().activeTickCount).toBe(0);
    expect(useBossStore.getState().activeStatus).toBe('active');
    expect(useBossStore.getState().activeMedkitsConsumed).toBe(0);
    expect(useBossStore.getState().activeDamageDealt).toBe(0);
  });

  it('does not drain survival HP or auto-eat medkits during boss_fight activity', async () => {
    useSurvivalStore.setState({ currentHp: 50, maxHp: 500, autoEatThreshold: 0.4 });
    usePlayerStore.setState({ consumables: { MedKit: 5 } });
    setBossFightActivity('silt_warlord');
    await useIdleTickerStore.getState().tickNow();
    // No local survival simulation runs during boss fights.
    expect(useSurvivalStore.getState().currentHp).toBe(50);
    expect(useSurvivalStore.getState().isDead).toBe(false);
    expect(usePlayerStore.getState().getConsumableCount('MedKit')).toBe(5);
  });

  it('pushes no feed events during boss_fight activity', async () => {
    useTickFeedStore.setState({ events: [] });
    setBossFightActivity('dune_tyrant');
    await useIdleTickerStore.getState().tickNow();
    // The ticker pushes server-authored feed events for roaming claims only.
    // During a boss fight it produces nothing — animation data comes from
    // the boss-attempt RPC response.
    expect(useTickFeedStore.getState().events).toHaveLength(0);
  });
});
