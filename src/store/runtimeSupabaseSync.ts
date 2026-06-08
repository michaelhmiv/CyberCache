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
import { useWorkshopStore } from './slices/workshopSlice';

const SAVE_DEBOUNCE_MS = 500;

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

type FullRuntimeSnapshot = {
  player: PlayerProfile;
  inventory: { items: GearItem[] };
  loadout: { slots: Record<LoadoutSlot, string | null>; consumables: LoadoutConsumables };
  boss: BossSnapshot;
  idle: IdleSnapshot;
  market: MarketSnapshot;
  skills: { spent: Record<string, number> };
  workshop: { unlockedBenchCount: number; activeQueues: WorkshopQueue[] };
};

function objectValue<T extends object>(value: unknown): Partial<T> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<T>) : null;
}

function arrayValue<T>(value: unknown): T[] | null {
  return Array.isArray(value) ? (value as T[]) : null;
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
      workshopQueues: player.workshopQueues,
      lastWorkshopTick: player.lastWorkshopTick,
    },
    inventory: { items: inventory.items },
    loadout: { slots: loadout.slots, consumables: loadout.consumables },
    boss: {
      currentBossId: boss.currentBossId,
      unlockedBossIds: boss.unlockedBossIds,
      defeatedBossIds: boss.defeatedBossIds,
      pityCounters: boss.pityCounters,
      attemptHistory: boss.attemptHistory,
      preparedConsumables: boss.preparedConsumables,
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
      listings: market.listings,
      history: market.history,
      filters: market.filters,
      watchlist: market.watchlist,
      seeded: market.seeded,
    },
    skills: { spent: skills.spent },
    workshop: {
      unlockedBenchCount: workshop.unlockedBenchCount,
      activeQueues: workshop.activeQueues,
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
  } finally {
    isApplyingSnapshot = false;
  }
}

function applyRuntimeStoreSnapshot(snapshot: RuntimeStoreSnapshot): void {
  isApplyingSnapshot = true;
  try {
    const player = objectValue<PlayerProfile>(snapshot.player);
    if (player) usePlayerStore.setState(player);

    const inventory = objectValue<{ items: GearItem[] }>(snapshot.inventory);
    const items = arrayValue<GearItem>(inventory?.items);
    if (items) useInventoryStore.setState({ items });

    const loadout = objectValue<{ slots: Record<LoadoutSlot, string | null>; consumables: LoadoutConsumables }>(snapshot.loadout);
    if (loadout) {
      useLoadoutStore.setState((state) => ({
        slots: { ...emptySlots, ...(objectValue<Record<LoadoutSlot, string | null>>(loadout.slots) ?? {}) },
        consumables: { ...state.consumables, ...(objectValue<LoadoutConsumables>(loadout.consumables) ?? {}) },
      }));
    }

    const boss = objectValue<BossSnapshot>(snapshot.boss);
    if (boss) useBossStore.setState(boss);

    const idle = objectValue<IdleSnapshot>(snapshot.idle);
    if (idle) useIdleStore.setState(idle);

    const market = objectValue<MarketSnapshot>(snapshot.market);
    if (market) useMarketStore.setState(market);

    const skills = objectValue<{ spent: Record<string, number> }>(snapshot.skills);
    const spent = objectValue<Record<string, number>>(skills?.spent);
    if (spent) useSkillStore.setState({ spent });

    const workshop = objectValue<{ unlockedBenchCount: number; activeQueues: WorkshopQueue[] }>(snapshot.workshop);
    if (workshop) {
      useWorkshopStore.setState({
        ...(typeof workshop.unlockedBenchCount === 'number' ? { unlockedBenchCount: workshop.unlockedBenchCount } : {}),
        ...(arrayValue<WorkshopQueue>(workshop.activeQueues) ? { activeQueues: workshop.activeQueues as WorkshopQueue[] } : {}),
      });
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
