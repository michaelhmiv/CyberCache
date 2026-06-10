import type { BossAttemptResult } from '@/types/boss';
import type { RiskSetting } from '@/types/game';
import type { GearItem } from '@/types/items';
import type { Listing, MarketFilter, MarketHistory } from '@/types/market';
import type { PlayerProfile } from '@/types/player';
import type { WorkshopQueue } from '@/types/workshop';
import {
  clearRuntimeStoreSnapshot,
  getRuntimeStoreSnapshot,
  saveRuntimeStoreSnapshot,
  type RuntimeStoreSnapshot,
} from '@/lib/supabase/runtimeStoreService';
import { useBossStore } from './slices/bossSlice';
import { useIdleStore } from './slices/idleSlice';
import { useInventoryStore } from './slices/inventorySlice';
import { emptySlots, type LoadoutConsumables, type LoadoutSlot, useLoadoutStore } from './slices/loadoutSlice';
import { useMarketStore } from './slices/marketSlice';
import { usePlayerStore } from './slices/playerSlice';
import { useSkillStore } from './slices/skillSlice';
import { useSurvivalStore } from './slices/survivalSlice';
import { useKillCycleStore } from './slices/killCycleSlice';
import { useWorkshopStore } from './slices/workshopSlice';

const SAVE_DEBOUNCE_MS = 500;
const riskSettings = ['Conservative', 'Balanced', 'Greedy', 'AllIn'];

let activeUserId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let isApplyingSnapshot = false;
let isSaving = false;
let saveQueued = false;
let unsubscribers: Array<() => void> = [];

type BossSnapshot = {
  currentBossId: string | null;
  unlockedBossIds: string[];
  defeatedBossIds: string[];
  pityCounters: Record<string, number>;
  attemptHistory: BossAttemptResult[];
  preparedConsumables: Record<string, number>;
  selectedRisk: RiskSetting;
};

type IdleSnapshot = {
  isFarming: boolean;
  farmTickCount: number;
  autoSalvageRarity: string;
  autoSalvageQuality: number;
  autoSalvageToMaterials: boolean;
  selectedRoamingAreaId: string;
};

type MarketSnapshot = {
  activeTab: 'buy' | 'sell' | 'mylistings' | 'history';
  listings: Listing[];
  history: MarketHistory[];
  filters: MarketFilter;
  watchlist: string[];
  seeded: boolean;
};

type SurvivalSnapshot = {
  currentHp: number;
  maxHp: number;
  shieldHp: number;
  isDead: boolean;
  deathLog: Array<{ monsterId: string; monsterName: string; areaId: string; at: number }>;
  resurrectionStartedAt: number | null;
  resurrectionReadyAt: number | null;
  autoEatThreshold: number;
};

type KillCycleSnapshot = {
  currentTargetId: string | null;
  currentTargetHp: number;
  currentTargetHpMax: number;
  monstersKilledCount: number;
  totalKills: number;
  lastKilledMonsterId: string | null;
};

type FullRuntimeSnapshot = {
  player: PlayerProfile;
  inventory: { items: GearItem[] };
  loadout: { slots: Record<LoadoutSlot, string | null>; consumables: LoadoutConsumables };
  boss: BossSnapshot;
  idle: IdleSnapshot;
  market: MarketSnapshot;
  skills: { spent: Record<string, number> };
  workshop: { unlockedBenchCount: number; activeQueues: WorkshopQueue[] };
  survival: SurvivalSnapshot;
  killCycle: KillCycleSnapshot;
};

function objectValue<T extends object>(value: unknown): Partial<T> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<T>) : null;
}

function arrayValue<T>(value: unknown): T[] | null {
  return Array.isArray(value) ? (value as T[]) : null;
}

function numberRecordValue(value: unknown): Record<string, number> | null {
  const source = objectValue<Record<string, unknown>>(value);
  if (!source) return null;

  return Object.fromEntries(
    Object.entries(source).map(([key, rawValue]) => {
      const parsed = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      return [key, Number.isFinite(parsed) ? parsed : 0];
    }),
  );
}

function isRiskSetting(value: unknown): value is RiskSetting {
  return typeof value === 'string' && riskSettings.includes(value);
}

function buildRuntimeStoreSnapshot(): FullRuntimeSnapshot {
  const player = usePlayerStore.getState();
  const inventory = useInventoryStore.getState();
  const loadout = useLoadoutStore.getState();
  const boss = useBossStore.getState();
  const idle = useIdleStore.getState();
  const market = useMarketStore.getState();
  const skills = useSkillStore.getState();
  const workshop = useWorkshopStore.getState();
  const survival = useSurvivalStore.getState();
  const killCycle = useKillCycleStore.getState();

  return {
  player: {
      id: player.id,
      name: player.name,
      level: player.level,
      xp: player.xp,
      credits: player.credits,
      scrap: player.scrap,
      cacheKeys: player.cacheKeys,
      cacheKeyFragments: player.cacheKeyFragments,
      currentZoneId: player.currentZoneId,
      highestZoneId: player.highestZoneId,
      offlineCapHours: player.offlineCapHours,
      lastClaimTime: player.lastClaimTime,
      deathFeeInsurance: player.deathFeeInsurance,
      consumables: player.consumables,
      materials: player.materials,
      essences: player.essences,
      workshopQueues: arrayValue<WorkshopQueue>(player.workshopQueues) ?? [],
      lastWorkshopTick: player.lastWorkshopTick,
    },
    inventory: { items: arrayValue<GearItem>(inventory.items) ?? [] },
    loadout: { slots: loadout.slots, consumables: loadout.consumables },
    boss: {
      currentBossId: typeof boss.currentBossId === 'string' ? boss.currentBossId : null,
      unlockedBossIds: arrayValue<string>(boss.unlockedBossIds) ?? [],
      defeatedBossIds: arrayValue<string>(boss.defeatedBossIds) ?? [],
      pityCounters: numberRecordValue(boss.pityCounters) ?? {},
      attemptHistory: arrayValue<BossAttemptResult>(boss.attemptHistory) ?? [],
      preparedConsumables: numberRecordValue(boss.preparedConsumables) ?? {},
      selectedRisk: boss.selectedRisk,
    },
    idle: {
      isFarming: idle.isFarming,
      farmTickCount: idle.farmTickCount,
      autoSalvageRarity: idle.autoSalvageRarity,
      autoSalvageQuality: idle.autoSalvageQuality,
      autoSalvageToMaterials: idle.autoSalvageToMaterials,
      selectedRoamingAreaId: idle.selectedRoamingAreaId,
    },
    market: {
      activeTab: market.activeTab,
      listings: arrayValue<Listing>(market.listings) ?? [],
      history: arrayValue<MarketHistory>(market.history) ?? [],
      filters: market.filters,
      watchlist: arrayValue<string>(market.watchlist) ?? [],
      seeded: market.seeded,
    },
    skills: { spent: numberRecordValue(skills.spent) ?? {} },
    workshop: {
      unlockedBenchCount: workshop.unlockedBenchCount,
      activeQueues: arrayValue<WorkshopQueue>(workshop.activeQueues) ?? [],
    },
    survival: {
      currentHp: survival.currentHp,
      maxHp: survival.maxHp,
      shieldHp: survival.shieldHp,
      isDead: survival.isDead,
      deathLog: arrayValue<SurvivalSnapshot['deathLog'][number]>(survival.deathLog) ?? [],
      resurrectionStartedAt: survival.resurrectionStartedAt,
      resurrectionReadyAt: survival.resurrectionReadyAt,
      autoEatThreshold: survival.autoEatThreshold,
    },
    killCycle: {
      currentTargetId: killCycle.currentTargetId,
      currentTargetHp: killCycle.currentTargetHp,
      currentTargetHpMax: killCycle.currentTargetHpMax,
      monstersKilledCount: killCycle.monstersKilledCount,
      totalKills: killCycle.totalKills,
      lastKilledMonsterId: killCycle.lastKilledMonsterId,
    },
  };
}

export function resetRuntimeStoresToInitialState(): void {
  isApplyingSnapshot = true;
  try {
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
  } finally {
    isApplyingSnapshot = false;
  }
}

function applyRuntimeStoreSnapshot(snapshot: RuntimeStoreSnapshot): void {
  isApplyingSnapshot = true;
  try {
    const player = objectValue<PlayerProfile>(snapshot.player);
    if (player) {
      const currentPlayer = usePlayerStore.getState();
      usePlayerStore.setState({
        name: typeof player.name === 'string' ? player.name : currentPlayer.name,
        level: typeof player.level === 'number' ? player.level : currentPlayer.level,
        xp: typeof player.xp === 'number' ? player.xp : currentPlayer.xp,
        credits: typeof player.credits === 'number' ? player.credits : currentPlayer.credits,
        scrap: typeof player.scrap === 'number' ? player.scrap : currentPlayer.scrap,
        // Cache keys/fragments are checked by cc_make_item against profiles.cache_tokens.
        // Do not restore snapshot values here or the UI can show phantom keys that the server rejects.
        lastClaimTime: typeof player.lastClaimTime === 'number' ? player.lastClaimTime : currentPlayer.lastClaimTime,
        consumables: player.consumables && typeof player.consumables === 'object' && !Array.isArray(player.consumables)
          ? player.consumables as Record<string, number>
          : currentPlayer.consumables,
        materials: player.materials && typeof player.materials === 'object' && !Array.isArray(player.materials)
          ? player.materials as Record<string, number>
          : currentPlayer.materials,
        essences: player.essences && typeof player.essences === 'object' && !Array.isArray(player.essences)
          ? player.essences as Record<string, number>
          : currentPlayer.essences,
        currentZoneId: typeof player.currentZoneId === 'string' ? player.currentZoneId : currentPlayer.currentZoneId,
        highestZoneId: typeof player.highestZoneId === 'string' ? player.highestZoneId : currentPlayer.highestZoneId,
        offlineCapHours: typeof player.offlineCapHours === 'number' ? player.offlineCapHours : currentPlayer.offlineCapHours,
        deathFeeInsurance: typeof player.deathFeeInsurance === 'boolean' ? player.deathFeeInsurance : currentPlayer.deathFeeInsurance,
        workshopQueues: arrayValue<WorkshopQueue>(player.workshopQueues) ?? currentPlayer.workshopQueues,
        lastWorkshopTick: typeof player.lastWorkshopTick === 'number' ? player.lastWorkshopTick : currentPlayer.lastWorkshopTick,
      });
    }

    const inventory = objectValue<{ items: GearItem[] }>(snapshot.inventory);
    const items = arrayValue<GearItem>(inventory?.items);
    if (items) {
      const currentItems = arrayValue<GearItem>(useInventoryStore.getState().items) ?? [];
      const currentIds = new Set(currentItems.map((item) => item.id));
      const snapshotOnlyItems = items.filter((item) => item?.id && !currentIds.has(item.id));
      useInventoryStore.setState({ items: [...currentItems, ...snapshotOnlyItems] });
    }

    const loadout = objectValue<{ slots: Record<LoadoutSlot, string | null>; consumables: LoadoutConsumables }>(snapshot.loadout);
    if (loadout) {
      useLoadoutStore.setState((state) => ({
        slots: { ...emptySlots, ...state.slots, ...(objectValue<Record<LoadoutSlot, string | null>>(loadout.slots) ?? {}) },
        consumables: { ...state.consumables, ...(objectValue<LoadoutConsumables>(loadout.consumables) ?? {}) },
      }));
    }

    const boss = objectValue<BossSnapshot>(snapshot.boss);
    if (boss) {
      const currentBoss = useBossStore.getState();
      useBossStore.setState({
        currentBossId: typeof boss.currentBossId === 'string' || boss.currentBossId === null ? boss.currentBossId : currentBoss.currentBossId,
        unlockedBossIds: arrayValue<string>(boss.unlockedBossIds) ?? currentBoss.unlockedBossIds,
        defeatedBossIds: arrayValue<string>(boss.defeatedBossIds) ?? currentBoss.defeatedBossIds,
        pityCounters: numberRecordValue(boss.pityCounters) ?? currentBoss.pityCounters,
        attemptHistory: arrayValue<BossAttemptResult>(boss.attemptHistory) ?? currentBoss.attemptHistory,
        preparedConsumables: numberRecordValue(boss.preparedConsumables) ?? currentBoss.preparedConsumables,
        selectedRisk: isRiskSetting(boss.selectedRisk) ? boss.selectedRisk : currentBoss.selectedRisk,
      });
    }

    const idle = objectValue<IdleSnapshot>(snapshot.idle);
    if (idle) useIdleStore.setState(idle);

    const market = objectValue<MarketSnapshot>(snapshot.market);
    if (market) useMarketStore.setState(market);

    const skills = objectValue<{ spent: Record<string, number> }>(snapshot.skills);
    const spent = numberRecordValue(skills?.spent);
    if (spent) useSkillStore.setState({ spent });

    const workshop = objectValue<{ unlockedBenchCount: number; activeQueues: WorkshopQueue[] }>(snapshot.workshop);
    if (workshop) {
      useWorkshopStore.setState({
        ...(typeof workshop.unlockedBenchCount === 'number' ? { unlockedBenchCount: workshop.unlockedBenchCount } : {}),
        ...(arrayValue<WorkshopQueue>(workshop.activeQueues) ? { activeQueues: workshop.activeQueues as WorkshopQueue[] } : {}),
      });
    }

    const survival = objectValue<SurvivalSnapshot>(snapshot.survival);
    if (survival) {
      useSurvivalStore.setState((state) => ({
        currentHp: typeof survival.currentHp === 'number' ? survival.currentHp : state.currentHp,
        maxHp: typeof survival.maxHp === 'number' ? survival.maxHp : state.maxHp,
        shieldHp: typeof survival.shieldHp === 'number' ? survival.shieldHp : state.shieldHp,
        isDead: typeof survival.isDead === 'boolean' ? survival.isDead : state.isDead,
        deathLog: arrayValue<SurvivalSnapshot['deathLog'][number]>(survival.deathLog) ?? state.deathLog,
        resurrectionStartedAt: typeof survival.resurrectionStartedAt === 'number' || survival.resurrectionStartedAt === null
          ? survival.resurrectionStartedAt : state.resurrectionStartedAt,
        resurrectionReadyAt: typeof survival.resurrectionReadyAt === 'number' || survival.resurrectionReadyAt === null
          ? survival.resurrectionReadyAt : state.resurrectionReadyAt,
        autoEatThreshold: typeof survival.autoEatThreshold === 'number' ? survival.autoEatThreshold : state.autoEatThreshold,
      }));
    }

    const killCycle = objectValue<KillCycleSnapshot>(snapshot.killCycle);
    if (killCycle) {
      useKillCycleStore.setState((state) => ({
        currentTargetId: typeof killCycle.currentTargetId === 'string' || killCycle.currentTargetId === null
          ? killCycle.currentTargetId : state.currentTargetId,
        currentTargetHp: typeof killCycle.currentTargetHp === 'number' ? killCycle.currentTargetHp : state.currentTargetHp,
        currentTargetHpMax: typeof killCycle.currentTargetHpMax === 'number' ? killCycle.currentTargetHpMax : state.currentTargetHpMax,
        monstersKilledCount: typeof killCycle.monstersKilledCount === 'number' ? killCycle.monstersKilledCount : state.monstersKilledCount,
        totalKills: typeof killCycle.totalKills === 'number' ? killCycle.totalKills : state.totalKills,
        lastKilledMonsterId: typeof killCycle.lastKilledMonsterId === 'string' || killCycle.lastKilledMonsterId === null
          ? killCycle.lastKilledMonsterId : state.lastKilledMonsterId,
      }));
    }
  } finally {
    isApplyingSnapshot = false;
  }
}

export async function restoreRuntimeStoresFromSupabase(userId: string): Promise<boolean> {
  const snapshot = await getRuntimeStoreSnapshot(userId);
  if (!snapshot) return false;
  applyRuntimeStoreSnapshot(snapshot);
  return true;
}

export async function saveCurrentRuntimeStores(userId = activeUserId): Promise<void> {
  if (!userId || isApplyingSnapshot) return;
  if (isSaving) {
    saveQueued = true;
    return;
  }

  isSaving = true;
  try {
    await saveRuntimeStoreSnapshot(userId, buildRuntimeStoreSnapshot());
  } catch (error) {
    console.warn('Runtime Supabase snapshot save skipped:', error instanceof Error ? error.message : error);
  } finally {
    isSaving = false;
    if (saveQueued) {
      saveQueued = false;
      await saveCurrentRuntimeStores(userId);
    }
  }
}

function scheduleRuntimeStoreSave(): void {
  if (!activeUserId || isApplyingSnapshot) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveCurrentRuntimeStores();
  }, SAVE_DEBOUNCE_MS);
}

export function startRuntimeStorePersistence(userId: string): void {
  stopRuntimeStorePersistence();
  activeUserId = userId;
  const listener = () => scheduleRuntimeStoreSave();
  unsubscribers = [
    usePlayerStore.subscribe(listener),
    useInventoryStore.subscribe(listener),
    useLoadoutStore.subscribe(listener),
    useBossStore.subscribe(listener),
    useIdleStore.subscribe(listener),
    useMarketStore.subscribe(listener),
    useSkillStore.subscribe(listener),
    useWorkshopStore.subscribe(listener),
    useSurvivalStore.subscribe(listener),
    useKillCycleStore.subscribe(listener),
  ];
}

export function stopRuntimeStorePersistence(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
  activeUserId = null;
}

export async function clearSupabaseRuntimeState(userId = activeUserId): Promise<void> {
  if (!userId) return;
  stopRuntimeStorePersistence();
  await clearRuntimeStoreSnapshot(userId);
}
