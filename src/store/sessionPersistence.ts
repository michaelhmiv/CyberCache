import { useBossStore } from './slices/bossSlice';
import { useIdleStore } from './slices/idleSlice';
import { useInventoryStore } from './slices/inventorySlice';
import { useLoadoutStore } from './slices/loadoutSlice';
import { useMarketStore } from './slices/marketSlice';
import { usePlayerStore } from './slices/playerSlice';
import { useSkillStore } from './slices/skillSlice';
import { useWorkshopStore } from './slices/workshopSlice';
import { setUserStorageScope } from './scopedStorage';

type PersistedStore = {
  setState: (state: unknown, replace?: true) => void;
  getInitialState: () => unknown;
  persist: {
    clearStorage: () => void | Promise<void>;
    rehydrate: () => void | Promise<void>;
  };
};

const persistedStores: PersistedStore[] = [
  usePlayerStore,
  useInventoryStore,
  useLoadoutStore,
  useBossStore,
  useIdleStore,
  useMarketStore,
  useSkillStore,
  useWorkshopStore,
] as unknown as PersistedStore[];

function resetInMemoryStoresToInitialState() {
  for (const store of persistedStores) {
    store.setState(store.getInitialState(), true);
  }
}

export async function switchAccountStorageScope(userId: string | null | undefined): Promise<void> {
  setUserStorageScope(userId);
  resetInMemoryStoresToInitialState();
  await Promise.all(persistedStores.map((store) => store.persist.rehydrate()));
}

export async function clearCurrentAccountStorage(): Promise<void> {
  await Promise.all(persistedStores.map((store) => store.persist.clearStorage()));
  resetInMemoryStoresToInitialState();
}
