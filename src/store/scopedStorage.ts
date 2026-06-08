import { createJSONStorage, type StateStorage } from 'zustand/middleware';

let activeStorageScope = 'guest';
const inMemoryValues = new Map<string, string>();

export function toStorageScope(userId: string | null | undefined): string {
  return userId ? `user:${userId}` : 'guest';
}

export function setUserStorageScope(userId: string | null | undefined): boolean {
  const nextScope = toStorageScope(userId);
  if (nextScope === activeStorageScope) return false;
  activeStorageScope = nextScope;
  return true;
}

export function getUserStorageScope(): string {
  return activeStorageScope;
}

export function getUserScopedStorageKey(storeName: string, scope = activeStorageScope): string {
  return `${storeName}:${scope}`;
}

export function createUserScopedStorage(): StateStorage {
  return {
    getItem: (name) => inMemoryValues.get(getUserScopedStorageKey(name)) ?? null,
    setItem: (name, value) => {
      inMemoryValues.set(getUserScopedStorageKey(name), value);
    },
    removeItem: (name) => {
      inMemoryValues.delete(getUserScopedStorageKey(name));
    },
  };
}

export function createUserScopedJSONStorage() {
  return createJSONStorage(() => createUserScopedStorage());
}
