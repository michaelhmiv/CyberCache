import { useBossStore } from './slices/bossSlice';
import { useIdleStore } from './slices/idleSlice';
import { useInventoryStore } from './slices/inventorySlice';
import { useLoadoutStore } from './slices/loadoutSlice';
import { useMarketStore } from './slices/marketSlice';
import { usePlayerStore } from './slices/playerSlice';
import { useSkillStore } from './slices/skillSlice';
import { useWorkshopStore } from './slices/workshopSlice';
import { setUserStorageScope, toStorageScope } from './scopedStorage';

type PersistedStore = {
  setState: (state: unknown, replace?: true) => void;
  getInitialState: () => unknown;
  persist: {
    rehydrate: () => void | Promise<void>;
  };
};

const ACTIVE_SCOPE_STORAGE_KEY = 'cc-active-storage-scope';
const PERSISTED_STORE_NAMES = [
  'cc-player',
  'cc-inventory',
  'cc-loadout',
  'cc-boss',
  'cc-idle',
  'cc-market',
  'cc-skills',
  'cc-workshop',
];

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

function scopedKey(storeName: string, scope: string): string {
  return `${storeName}:${scope}`;
}

function persistStaticStoreKeys(scope: string) {
  for (const storeName of PERSISTED_STORE_NAMES) {
    const value = localStorage.getItem(storeName);
    if (value === null) continue;
    localStorage.setItem(scopedKey(storeName, scope), value);
  }
}

function restoreStaticStoreKeys(scope: string) {
  for (const storeName of PERSISTED_STORE_NAMES) {
    const value = localStorage.getItem(scopedKey(storeName, scope));
    if (value === null) {
      localStorage.removeItem(storeName);
    } else {
      localStorage.setItem(storeName, value);
    }
  }
}

function removeStaticAndScopedStoreKeys(scope: string) {
  for (const storeName of PERSISTED_STORE_NAMES) {
    localStorage.removeItem(storeName);
    localStorage.removeItem(scopedKey(storeName, scope));
  }
}

function resetInMemoryStoresToInitialState() {
  for (const store of persistedStores) {
    store.setState(store.getInitialState(), true);
  }
}

async function rehydratePersistedStores() {
  await Promise.all(persistedStores.map((store) => store.persist.rehydrate()));
}

export async function switchAccountStorageScope(userId: string | null | undefined): Promise<void> {
  const nextScope = toStorageScope(userId);
  const previousScope = localStorage.getItem(ACTIVE_SCOPE_STORAGE_KEY);

  if (!previousScope) {
    persistStaticStoreKeys(nextScope);
  } else if (previousScope !== nextScope) {
    persistStaticStoreKeys(previousScope);
  }

  setUserStorageScope(userId);
  restoreStaticStoreKeys(nextScope);
  localStorage.setItem(ACTIVE_SCOPE_STORAGE_KEY, nextScope);
  resetInMemoryStoresToInitialState();
  await rehydratePersistedStores();
}

export async function clearCurrentAccountStorage(): Promise<void> {
  const scope = localStorage.getItem(ACTIVE_SCOPE_STORAGE_KEY) ?? toStorageScope(null);
  removeStaticAndScopedStoreKeys(scope);
  resetInMemoryStoresToInitialState();
  await rehydratePersistedStores();
}
