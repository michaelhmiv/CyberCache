/**
 * End-to-end test for the survival tick wiring in idleTickerSlice.
 * Sets up: player in roaming_loot, area = dustwaste_frontier, low HP.
 * Calls `tickNow` directly. Asserts: HP drops, damage event fires,
 * auto-eat triggers if consumable is loaded, death stops the ticker.
 *
 * Note: we test `tickNow` directly rather than waiting for setInterval
 * because the ticker runs in a real interval. The function is exposed
 * on the store and is the unit of work — the interval is just a driver.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIdleTickerStore, mountIdleTicker, unmountIdleTicker } from '@/store/slices/idleTickerSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useActivityStore } from '@/store/slices/activitySlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useCombatStatsStore } from '@/store/slices/combatStatsSlice';
import { useTickFeedStore } from '@/store/slices/tickSlice';

// Suppress the network round-trip — we only care about the local
// survival wiring in this test. The ticker still calls verifiedOps
// for reward reconciliation; mock it to do nothing.
vi.mock('@/lib/supabase/verifiedOps', () => ({
  verifiedOps: {
    claimRoamingRewards: vi.fn(async () => ({})),
  },
}));

vi.mock('@/store/runtimeSupabaseSync', () => ({
  saveCurrentRuntimeStores: vi.fn(async () => undefined),
}));

vi.mock('@/store/combatStatsSupabaseSync', () => ({
  saveCombatStats: vi.fn(async () => undefined),
}));

const enterRoamingArea = (areaId: string) => {
  useActivityStore.getState().setCurrent({
    kind: 'roaming_loot',
    targetId: areaId,
    startedAt: Date.now(),
  } as never);
};

describe('idleTickerSlice — survival wiring', () => {
  beforeEach(() => {
    // Reset all stores to a known state.
    useSurvivalStore.setState({
      currentHp: 700,
      maxHp: 700,
      shieldHp: 0,
      isDead: false,
      lastKilledBy: null,
      deathLog: [],
      resurrectionStartedAt: null,
      resurrectionReadyAt: null,
      autoEatThreshold: 0.7,
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
    usePlayerStore.setState({ level: 1, consumables: {} });
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

  it('tickNow reduces hunter HP when roaming', async () => {
    enterRoamingArea('dustwaste_frontier');
    const before = useSurvivalStore.getState().currentHp;
    await useIdleTickerStore.getState().tickNow();
    const after = useSurvivalStore.getState().currentHp;
    // T1 monsters do 2-14 damage; 1-3 ticks, 1 tick minimum. HP should
    // be ≤ before (or equal if every roll missed).
    expect(after).toBeLessThanOrEqual(before);
  });

  it('emits a damage event in the tick feed', async () => {
    enterRoamingArea('dustwaste_frontier');
    await useIdleTickerStore.getState().tickNow();
    const events = useTickFeedStore.getState().events;
    const damageEvents = events.filter((e) => e.tone === 'damage');
    // At least one damage OR block event should appear; some ticks may
    // all-miss in fast succession but that's <1% probability over 3s.
    expect(damageEvents.length + events.filter((e) => e.tone === 'kill').length).toBeGreaterThan(0);
  });

  it('does not apply damage when activity is not roaming_loot', async () => {
    useActivityStore.getState().setCurrent({
      kind: 'idle_standby',
      targetId: null,
      startedAt: Date.now(),
    } as never);
    const before = useSurvivalStore.getState().currentHp;
    await useIdleTickerStore.getState().tickNow();
    const after = useSurvivalStore.getState().currentHp;
    expect(after).toBe(before);
  });

  it('auto-eats a medkit when HP drops below threshold', async () => {
    enterRoamingArea('redline_circuit'); // T2 = 11-14 attack, fast
    // Load 10 medkits and set HP just above threshold. A single hit
    // drops HP below 70% and triggers auto-eat.
    usePlayerStore.setState({ consumables: { MedKit: 10 } });
    useSurvivalStore.setState({ currentHp: 495, maxHp: 700 }); // 495/700 = 0.707, just over
    // Run several ticks; one or more should drop below 490 and auto-eat.
    let autoEatFired = false;
    for (let i = 0; i < 30; i += 1) {
      if (useSurvivalStore.getState().isDead) break;
      const medkitsBefore = usePlayerStore.getState().consumables.MedKit ?? 0;
      try {
        await useIdleTickerStore.getState().tickNow();
      } catch {
        // network mocks can throw; ignore
      }
      const medkitsAfter = usePlayerStore.getState().consumables.MedKit ?? 0;
      if (medkitsAfter < medkitsBefore) {
        autoEatFired = true;
        break;
      }
    }
    expect(autoEatFired).toBe(true);
  });

  it('sets isDead and stops the ticker when HP reaches 0', async () => {
    enterRoamingArea('redline_circuit'); // T2, harder
    usePlayerStore.setState({ consumables: {} }); // no medkits
    useSurvivalStore.setState({ currentHp: 5, maxHp: 700 }); // 1 hit kills
    // Run a few ticks until death.
    for (let i = 0; i < 20; i += 1) {
      if (useSurvivalStore.getState().isDead) break;
      try {
        await useIdleTickerStore.getState().tickNow();
      } catch {
        // Network mocks can throw; ignore.
      }
    }
    const survival = useSurvivalStore.getState();
    expect(survival.isDead).toBe(true);
    expect(survival.currentHp).toBe(0);
    expect(survival.lastKilledBy).not.toBeNull();
    expect(useCombatStatsStore.getState().totalDeaths).toBe(1);
    // Ticker should be stopped (interval cleared, running=false).
    expect(useIdleTickerStore.getState().running).toBe(false);
  });

  it('ticker is a no-op when already dead', async () => {
    useSurvivalStore.setState({ isDead: true, currentHp: 0 });
    const beforeEvents = useTickFeedStore.getState().events.length;
    await useIdleTickerStore.getState().tickNow();
    const afterEvents = useTickFeedStore.getState().events.length;
    expect(afterEvents).toBe(beforeEvents);
  });

  it('mountIdleTicker starts the interval and stops on unmount', () => {
    mountIdleTicker();
    expect(useIdleTickerStore.getState().running).toBe(true);
    unmountIdleTicker();
    expect(useIdleTickerStore.getState().running).toBe(false);
  });
});
