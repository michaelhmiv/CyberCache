import type { RiskSetting } from '@/types/game';
import type { MarketFilter } from '@/types/market';
import {
  clearRuntimeStoreSnapshot,
  getRuntimeStoreSnapshot,
  saveRuntimeStoreSnapshot,
  type RuntimeStoreSnapshot,
} from '@/lib/supabase/runtimeStoreService';
import { useBossStore } from './slices/bossSlice';
import { useIdleStore } from './slices/idleSlice';
import { useInventoryStore } from './slices/inventorySlice';
import { type LoadoutConsumables, type LoadoutSlot, useLoadoutStore } from './slices/loadoutSlice';
import { useMarketStore } from './slices/marketSlice';
import { usePlayerStore } from './slices/playerSlice';
import { useSkillStore } from './slices/skillSlice';
import { useSurvivalStore } from './slices/survivalSlice';
import { useKillCycleStore } from './slices/killCycleSlice';
import { useLoadoutPresetsStore } from './slices/loadoutPresetsSlice';
import { useWorkshopStore } from './slices/workshopSlice';
import { useActiveBuffsStore } from './slices/activeBuffsSlice';

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
  preparedConsumables: Record<string, number>;
  selectedRisk: RiskSetting;
};

type IdleSnapshot = {
  autoSalvageRarity: string;
  autoSalvageQuality: number;
  autoSalvageToMaterials: boolean;
  selectedRoamingAreaId: string;
};

type MarketSnapshot = {
  activeTab: string;
  filters: MarketFilter;
  watchlist: string[];
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

type LoadoutPresetsSnapshot = {
  presets: Array<{
    id: string;
    name: string;
    slots: Record<LoadoutSlot, string | null>;
    consumables: LoadoutConsumables;
    createdAt: number;
    updatedAt: number;
  }>;
  activePresetId: string | null;
};

type RuntimeDisplaySnapshot = {
  schemaVersion: 2;
  authority: 'display_hydration_only';
  loadout: { consumables: LoadoutConsumables };
  boss: BossSnapshot;
  idle: IdleSnapshot;
  market: MarketSnapshot;
  survival: SurvivalSnapshot;
  killCycle: KillCycleSnapshot;
  loadoutPresets: LoadoutPresetsSnapshot;
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

export function buildRuntimeDisplaySnapshot(): RuntimeDisplaySnapshot {
  const loadout = useLoadoutStore.getState();
  const boss = useBossStore.getState();
  const idle = useIdleStore.getState();
  const market = useMarketStore.getState();
  const survival = useSurvivalStore.getState();
  const killCycle = useKillCycleStore.getState();
  const loadoutPresets = useLoadoutPresetsStore.getState();

  return {
    schemaVersion: 2,
    authority: 'display_hydration_only',
    loadout: { consumables: loadout.consumables },
    boss: {
      currentBossId: typeof boss.currentBossId === 'string' ? boss.currentBossId : null,
      preparedConsumables: numberRecordValue(boss.preparedConsumables) ?? {},
      selectedRisk: boss.selectedRisk,
    },
    idle: {
      autoSalvageRarity: idle.autoSalvageRarity,
      autoSalvageQuality: idle.autoSalvageQuality,
      autoSalvageToMaterials: idle.autoSalvageToMaterials,
      selectedRoamingAreaId: idle.selectedRoamingAreaId,
    },
    market: {
      activeTab: market.activeTab,
      filters: market.filters,
      watchlist: arrayValue<string>(market.watchlist) ?? [],
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
    loadoutPresets: {
      presets: loadoutPresets.presets,
      activePresetId: loadoutPresets.activePresetId,
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
    useLoadoutPresetsStore.setState(useLoadoutPresetsStore.getInitialState(), true);
    useActiveBuffsStore.setState(useActiveBuffsStore.getInitialState(), true);
  } finally {
    isApplyingSnapshot = false;
  }
}

export function applyRuntimeDisplaySnapshot(snapshot: RuntimeStoreSnapshot): void {
  isApplyingSnapshot = true;
  try {
    // Runtime snapshots are stale display hydration only. Authoritative
    // economy state is already loaded from profiles/item_instances/RPCs before
    // this function runs, so never restore player resources, item ownership,
    // boss progression, skill spends, workshop outputs, or market listings
    // from `player_runtime_snapshots`.
    const loadout = objectValue<{ consumables: LoadoutConsumables }>(snapshot.loadout);
    if (loadout) {
      const incoming = objectValue<LoadoutConsumables>(loadout.consumables);
      // Sanitize: deduplicate any incoming consumable assignments before
      // merging into state. Stale snapshots may contain duplicates from
      // before the dedup guard was added.
      if (incoming) {
        const sanitized: LoadoutConsumables = { PreFight: null, MidFight: null, Emergency: null };
        for (const slot of ['PreFight', 'MidFight', 'Emergency'] as const) {
          const val = incoming[slot];
          if (val && !Object.values(sanitized).includes(val)) {
            sanitized[slot] = val;
          }
        }
        useLoadoutStore.setState((state) => ({
          consumables: { ...state.consumables, ...sanitized },
        }));
      }
    }

    const boss = objectValue<BossSnapshot>(snapshot.boss);
    if (boss) {
      const currentBoss = useBossStore.getState();
      useBossStore.setState({
        currentBossId: typeof boss.currentBossId === 'string' || boss.currentBossId === null ? boss.currentBossId : currentBoss.currentBossId,
        preparedConsumables: numberRecordValue(boss.preparedConsumables) ?? currentBoss.preparedConsumables,
        selectedRisk: isRiskSetting(boss.selectedRisk) ? boss.selectedRisk : currentBoss.selectedRisk,
      });
    }

    const idle = objectValue<IdleSnapshot>(snapshot.idle);
    if (idle) {
      useIdleStore.setState((state) => ({
        autoSalvageRarity: typeof idle.autoSalvageRarity === 'string' ? idle.autoSalvageRarity : state.autoSalvageRarity,
        autoSalvageQuality: typeof idle.autoSalvageQuality === 'number' ? idle.autoSalvageQuality : state.autoSalvageQuality,
        autoSalvageToMaterials: typeof idle.autoSalvageToMaterials === 'boolean' ? idle.autoSalvageToMaterials : state.autoSalvageToMaterials,
        selectedRoamingAreaId: typeof idle.selectedRoamingAreaId === 'string' ? idle.selectedRoamingAreaId : state.selectedRoamingAreaId,
      }));
    }

    const market = objectValue<MarketSnapshot>(snapshot.market);
    if (market) {
      useMarketStore.setState((state) => ({
        activeTab: typeof market.activeTab === 'string' ? market.activeTab : state.activeTab,
        filters: objectValue<MarketFilter>(market.filters) ? { ...state.filters, ...market.filters } : state.filters,
        watchlist: arrayValue<string>(market.watchlist) ?? state.watchlist,
      }));
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

    const loadoutPresets = objectValue<LoadoutPresetsSnapshot>(snapshot.loadoutPresets);
    if (loadoutPresets) {
      useLoadoutPresetsStore.setState({
        presets: Array.isArray(loadoutPresets.presets) ? loadoutPresets.presets : [],
        activePresetId: typeof loadoutPresets.activePresetId === 'string' ? loadoutPresets.activePresetId : null,
      });
    }
  } finally {
    isApplyingSnapshot = false;
  }
}

export async function restoreRuntimeStoresFromSupabase(userId: string): Promise<boolean> {
  const snapshot = await getRuntimeStoreSnapshot(userId);
  if (!snapshot) return false;
  applyRuntimeDisplaySnapshot(snapshot);
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
    await saveRuntimeStoreSnapshot(userId, buildRuntimeDisplaySnapshot());
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
    useLoadoutStore.subscribe(listener),
    useBossStore.subscribe(listener),
    useIdleStore.subscribe(listener),
    useMarketStore.subscribe(listener),
    useSurvivalStore.subscribe(listener),
    useKillCycleStore.subscribe(listener),
    useLoadoutPresetsStore.subscribe(listener),
  ];

  // Flush pending debounced saves on tab close / page hide so display
  // state (consumables, boss settings, presets) is not lost.
  if (typeof window !== 'undefined') {
    const flushHandler = () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        void saveCurrentRuntimeStores();
      }
    };
    window.addEventListener('beforeunload', flushHandler);
    window.addEventListener('pagehide', flushHandler);
    // Store the cleanup so stopRuntimeStorePersistence can remove it.
    unsubscribers.push(() => {
      window.removeEventListener('beforeunload', flushHandler);
      window.removeEventListener('pagehide', flushHandler);
    });
  }
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
