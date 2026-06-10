/**
 * idleTickerSlice — boss fight wiring (PR 6).
 *
 * The contract: when the active activity is `boss_fight` with a boss
 * target, calling `tickNow` calls `applyBossFightTick()`, which:
 *   - Drains boss HP by playerDps * 3s
 *   - Drains player HP by bossDps * 3s (after shield)
 *   - Auto-eats a medkit when below threshold
 *   - Decrements the player's MedKit count
 *   - Updates the boss store's live-fight state
 *   - Ends the fight on victory (boss HP 0) or defeat (player HP 0)
 *
 * This test exercises the wiring: real boss store, real player
 * store, real survival store, real loadout store, real ticker.
 *
 * Why no weapon setup: loadoutEffectiveDps() reads from the real
 * loadout which requires a real weapon in inventory. We avoid that
 * complexity by stubbing `loadoutEffectiveDps` for the assertion
 * cases that need non-zero DPS, and by relying on the pure
 * bossTick.test.ts for the math.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIdleTickerStore } from '@/store/slices/idleTickerSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useActivityStore } from '@/store/slices/activitySlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useBossStore } from '@/store/slices/bossSlice';
import { useTickFeedStore } from '@/store/slices/tickSlice';

// Same mocks as the survival test — suppress network calls.
vi.mock('@/lib/supabase/verifiedOps', () => ({
  verifiedOps: {
    claimRoamingRewards: vi.fn(async () => ({})),
  },
}));

vi.mock('@/store/runtimeSupabaseSync', () => ({
  saveCurrentRuntimeStores: vi.fn(async () => undefined),
  syncVerifiedResult: vi.fn(),
}));

function setBossFightActivity(bossId: string) {
  useActivityStore.setState({
    current: {
      kind: 'boss_fight',
      targetType: 'boss',
      targetId: bossId,
      targetLabel: 'Test Boss',
      startedAt: Date.now(),
    } as never,
  });
}

function setRoamingArea() {
  useActivityStore.setState({
    current: {
      kind: 'roaming_loot',
      targetType: 'roaming_area',
      targetId: 'dustwaste_frontier',
      targetLabel: 'Dustwaste',
      startedAt: Date.now(),
    } as never,
  });
}

describe('idleTickerSlice — boss fight wiring (PR 6)', () => {
  beforeEach(() => {
    useSurvivalStore.setState({
      currentHp: 500,
      maxHp: 500,
      shieldHp: 0,
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
    usePlayerStore.setState({
      level: 1,
      credits: 0,
      consumables: { MedKit: 5, ShieldCell: 0, ReviveToken: 0 },
    });
    useBossStore.setState({
      activeBossId: null,
      activeBossHp: 0,
      activeBossMaxHp: 0,
      activeStatus: 'idle',
      activeMedkitsConsumed: 0,
      activeDamageDealt: 0,
      activeTickCount: 0,
      activeStartedAt: 0,
      defeatedBossIds: [],
      pityCounters: {},
    });
    useTickFeedStore.setState({ events: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('bails when activity is roaming_loot (not boss_fight)', async () => {
    useBossStore.getState().startLiveFight('dune_tyrant', 1000);
    setRoamingArea();
    await useIdleTickerStore.getState().tickNow();
    // Boss state untouched — roaming tick doesn't touch boss store
    expect(useBossStore.getState().activeBossHp).toBe(1000);
    expect(useBossStore.getState().activeTickCount).toBe(0);
  });

  it('bails when activity is idle', async () => {
    useBossStore.getState().startLiveFight('dune_tyrant', 1000);
    useActivityStore.setState({
      current: { kind: 'idle', targetType: 'none', targetId: null, targetLabel: '', startedAt: Date.now() } as never,
    });
    await useIdleTickerStore.getState().tickNow();
    expect(useBossStore.getState().activeBossHp).toBe(1000);
    expect(useBossStore.getState().activeTickCount).toBe(0);
  });

  it('does nothing if the boss store has no active fight', async () => {
    setBossFightActivity('dune_tyrant');
    await useIdleTickerStore.getState().tickNow();
    expect(useBossStore.getState().activeStatus).toBe('idle');
    expect(useBossStore.getState().activeTickCount).toBe(0);
  });

  it('does nothing if the boss ID does not match the active fight', async () => {
    useBossStore.getState().startLiveFight('dune_tyrant', 1000);
    setBossFightActivity('silt_warlord');
    await useIdleTickerStore.getState().tickNow();
    expect(useBossStore.getState().activeTickCount).toBe(0);
    expect(useBossStore.getState().activeBossHp).toBe(1000);
  });

  it('runs the fight tick when activity is boss_fight with a matching boss', async () => {
    useBossStore.getState().startLiveFight('dune_tyrant', 1000);
    setBossFightActivity('dune_tyrant');
    await useIdleTickerStore.getState().tickNow();
    // Tick ran (activeTickCount incremented), but bossHp may not have
    // dropped because the empty loadout gives playerDps=0. The point
    // of this test is that the wiring is correct.
    expect(useBossStore.getState().activeTickCount).toBe(1);
  });

  it('consumes a medkit when player HP drops below threshold (with stubbed DPS)', async () => {
    // Stub loadoutEffectiveDps to return 1000 DPS so we can verify
    // the medkit-drain path without setting up a real weapon.
    const loadoutSurvival = await import('@/lib/combat/loadoutSurvival');
    const dpsSpy = vi.spyOn(loadoutSurvival, 'loadoutEffectiveDps').mockReturnValue(1000);

    try {
      useSurvivalStore.setState({ currentHp: 50, maxHp: 500, autoEatThreshold: 0.4 });
      usePlayerStore.setState({ consumables: { MedKit: 5, ShieldCell: 0, ReviveToken: 0 } });
      useBossStore.getState().startLiveFight('dune_tyrant', 1000);
      setBossFightActivity('dune_tyrant');

      await useIdleTickerStore.getState().tickNow();

      // Medkit should have been auto-consumed from the player store.
      // (activeMedkitsConsumed is reset by clearLiveFight() so we don't
      // assert on it here — the player-store decrement is the real
      // evidence of medkit attrition.)
      expect(usePlayerStore.getState().getConsumableCount('MedKit')).toBeLessThan(5);
    } finally {
      dpsSpy.mockRestore();
    }
  });

  it('marks the hunter dead and increments pity when player HP hits 0', async () => {
    // With playerDps=0 and a real bossDps, the player will die.
    // Force currentHp=1 so the first tick kills them.
    useSurvivalStore.setState({ currentHp: 1, maxHp: 500, autoEatThreshold: 0.0 });
    usePlayerStore.setState({ consumables: { MedKit: 0, ShieldCell: 0, ReviveToken: 0 } });
    useBossStore.getState().startLiveFight('dune_tyrant', 1000);
    setBossFightActivity('dune_tyrant');

    await useIdleTickerStore.getState().tickNow();

    // PR 5 death overlay contract: survival.isDead=true, death log has entry
    expect(useSurvivalStore.getState().isDead).toBe(true);
    const log = useSurvivalStore.getState().deathLog;
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].monsterId).toBe('dune_tyrant');
    // Pity counter persists across the clearLiveFight() microtask
    expect(useBossStore.getState().pityCounters.dune_tyrant).toBe(1);
  });

  it('ends the fight as victory and records defeatBoss when boss HP hits 0', async () => {
    const loadoutSurvival = await import('@/lib/combat/loadoutSurvival');
    const dpsSpy = vi.spyOn(loadoutSurvival, 'loadoutEffectiveDps').mockReturnValue(10000);

    try {
      // Boss has 1 HP; huge DPS one-shots it.
      useBossStore.getState().startLiveFight('dune_tyrant', 1);
      setBossFightActivity('dune_tyrant');
      await useIdleTickerStore.getState().tickNow();
      // defeatedBossIds persists across the clearLiveFight() microtask
      expect(useBossStore.getState().defeatedBossIds).toContain('dune_tyrant');
    } finally {
      dpsSpy.mockRestore();
    }
  });
});
