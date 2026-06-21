import { beforeEach, describe, expect, it } from 'vitest';
import { applyRuntimeDisplaySnapshot, buildRuntimeDisplaySnapshot } from '@/store/runtimeSupabaseSync';
import { useBossStore } from '@/store/slices/bossSlice';
import { useIdleStore } from '@/store/slices/idleSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useMarketStore } from '@/store/slices/marketSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSkillStore } from '@/store/slices/skillSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';
import { useWorkshopStore } from '@/store/slices/workshopSlice';
import { RiskSetting, DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { GearItem, Weapon } from '@/types/items';

function weapon(id: string): Weapon {
  return {
    id,
    name: id,
    level: 1,
    rarity: Rarity.Common,
    weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic,
    rollQuality: 50,
    baseDamage: 10,
    attackSpeed: 1,
    critChance: 0,
    critDamage: 1,
    statusChance: 0,
    statusDamage: 0,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 0,
    armorDamageMod: 0,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 1,
    combatPower: 10,
    bossPower: 10,
    farmPower: 10,
    economyScore: 0,
  };
}

describe('runtime display snapshots are not economy authority', () => {
  beforeEach(() => {
    usePlayerStore.setState(usePlayerStore.getInitialState(), true);
    useInventoryStore.setState(useInventoryStore.getInitialState(), true);
    useLoadoutStore.setState(useLoadoutStore.getInitialState(), true);
    useBossStore.setState(useBossStore.getInitialState(), true);
    useIdleStore.setState(useIdleStore.getInitialState(), true);
    useMarketStore.setState(useMarketStore.getInitialState(), true);
    useSkillStore.setState(useSkillStore.getInitialState(), true);
    useWorkshopStore.setState(useWorkshopStore.getInitialState(), true);
    useSurvivalStore.setState(useSurvivalStore.getInitialState(), true);
    useKillCycleStore.setState(useKillCycleStore.getInitialState(), true);
  });

  it('does not restore economy, inventory, boss wins, skills, workshop, or market listings from stale snapshots', () => {
    const serverItem = weapon('server-item');
    const snapshotItem = weapon('snapshot-item');

    usePlayerStore.setState({
      level: 7,
      xp: 123,
      credits: 456,
      scrap: 78,
      cacheKeys: 2,
      cacheKeyFragments: 1,
      consumables: { MedKit: 1 },
      materials: { ScrapAlloy: 3 },
      essences: { VoidEssence: 4 },
    });
    useInventoryStore.setState({ items: [serverItem] });
    useBossStore.setState({
      unlockedBossIds: ['dune_tyrant'],
      defeatedBossIds: ['server_boss'],
      pityCounters: { dune_tyrant: 2 },
      attemptHistory: [{ bossId: 'server_boss', victory: true } as never],
    });
    useSkillStore.setState({ spent: { server_skill: 1 } });
    useWorkshopStore.setState({ unlockedBenchCount: 1, activeQueues: [] });
    useMarketStore.setState({
      listings: [{ id: 'server-listing', itemSnapshot: serverItem } as never],
      history: [{ id: 'server-history' } as never],
      activeTab: 'buy',
      filters: { sortBy: 'newest', sortDir: 'desc' },
      watchlist: [],
    });

    applyRuntimeDisplaySnapshot({
      player: {
        level: 99,
        xp: 999,
        credits: 999,
        scrap: 999,
        cacheKeys: 99,
        cacheKeyFragments: 99,
        consumables: { MedKit: 99 },
        materials: { ScrapAlloy: 99 },
        essences: { VoidEssence: 99 },
      },
      inventory: { items: [snapshotItem] as GearItem[] },
      loadout: {
        slots: { primary: 'snapshot-item' },
        consumables: { PreFight: 'BossScanner', MidFight: null, Emergency: null },
      },
      boss: {
        currentBossId: 'snapshot-selection',
        unlockedBossIds: ['cheat_boss'],
        defeatedBossIds: ['cheat_boss'],
        pityCounters: { cheat_boss: 99 },
        attemptHistory: [{ bossId: 'cheat_boss', victory: true }],
        preparedConsumables: { BossScanner: 1 },
        selectedRisk: RiskSetting.AllIn,
      },
      idle: {
        isFarming: true,
        farmTickCount: 999,
        autoSalvageRarity: 'Rare',
        autoSalvageQuality: 70,
        autoSalvageToMaterials: true,
        selectedRoamingAreaId: 'redline_circuit',
      },
      market: {
        activeTab: 'sell',
        listings: [{ id: 'snapshot-listing', itemSnapshot: snapshotItem }],
        history: [{ id: 'snapshot-history' }],
        filters: { sortBy: 'price', sortDir: 'asc' },
        watchlist: ['snapshot-watch'],
        seeded: true,
      },
      skills: { spent: { cheat_skill: 99 } },
      workshop: { unlockedBenchCount: 3, activeQueues: [{ id: 'cheat-queue' }] },
      survival: { currentHp: 321, maxHp: 777, shieldHp: 44, isDead: false, deathLog: [], resurrectionStartedAt: null, resurrectionReadyAt: null, autoEatThreshold: 0.6 },
      killCycle: { currentTargetId: 'target', currentTargetHp: 12, currentTargetHpMax: 30, monstersKilledCount: 2, totalKills: 9, lastKilledMonsterId: 'last' },
    });

    expect(usePlayerStore.getState()).toMatchObject({
      level: 7,
      xp: 123,
      credits: 456,
      scrap: 78,
      cacheKeys: 2,
      cacheKeyFragments: 1,
      consumables: { MedKit: 1 },
      materials: { ScrapAlloy: 3 },
      essences: { VoidEssence: 4 },
    });
    expect(useInventoryStore.getState().items.map((item) => item.id)).toEqual(['server-item']);
    expect(useLoadoutStore.getState().slots.primary).toBeNull();
    expect(useBossStore.getState().unlockedBossIds).toEqual(['dune_tyrant']);
    expect(useBossStore.getState().defeatedBossIds).toEqual(['server_boss']);
    expect(useBossStore.getState().pityCounters).toEqual({ dune_tyrant: 2 });
    expect(useBossStore.getState().attemptHistory).toHaveLength(1);
    expect(useSkillStore.getState().spent).toEqual({ server_skill: 1 });
    expect(useWorkshopStore.getState().unlockedBenchCount).toBe(1);
    expect(useMarketStore.getState().listings.map((listing) => listing.id)).toEqual(['server-listing']);
    expect(useMarketStore.getState().history.map((entry) => entry.id)).toEqual(['server-history']);

    expect(useBossStore.getState()).toMatchObject({
      currentBossId: 'snapshot-selection',
      selectedRisk: RiskSetting.AllIn,
      preparedConsumables: { BossScanner: 1 },
    });
    expect(useIdleStore.getState()).toMatchObject({
      autoSalvageRarity: 'Rare',
      autoSalvageQuality: 70,
      autoSalvageToMaterials: true,
      selectedRoamingAreaId: 'redline_circuit',
    });
    expect(useIdleStore.getState().farmTickCount).toBe(0);
    expect(useMarketStore.getState()).toMatchObject({
      activeTab: 'sell',
      filters: { sortBy: 'price', sortDir: 'asc' },
      watchlist: ['snapshot-watch'],
    });
    expect(useSurvivalStore.getState()).toMatchObject({ currentHp: 321, maxHp: 777, shieldHp: 44 });
    expect(useKillCycleStore.getState()).toMatchObject({ currentTargetId: 'target', totalKills: 9 });
  });

  it('writes only display hydration fields in new snapshots', () => {
    const snapshot = buildRuntimeDisplaySnapshot();

    expect(snapshot.authority).toBe('display_hydration_only');
    expect(snapshot).not.toHaveProperty('player');
    expect(snapshot).not.toHaveProperty('inventory');
    expect(snapshot).not.toHaveProperty('skills');
    expect(snapshot).not.toHaveProperty('workshop');
    expect(snapshot.market).not.toHaveProperty('listings');
    expect(snapshot.market).not.toHaveProperty('history');
    expect(snapshot.boss).not.toHaveProperty('defeatedBossIds');
    expect(snapshot.boss).not.toHaveProperty('unlockedBossIds');
    // attemptHistory is display-only and included in the snapshot for
    // UI persistence (like deathLog). It is NOT authoritative game state.
  });
});
