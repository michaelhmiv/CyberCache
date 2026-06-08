import { createJSONStorage, type StateStorage } from 'zustand/middleware';

const ANONYMOUS_STORAGE_SCOPE = 'anonymous';
let activeStorageScope = ANONYMOUS_STORAGE_SCOPE;

export function toStorageScope(userId: string | null | undefined): string {
  return userId ? `user:${userId}` : ANONYMOUS_STORAGE_SCOPE;
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
    getItem: (name) => localStorage.getItem(getUserScopedStorageKey(name)),
    setItem: (name, value) => localStorage.setItem(getUserScopedStorageKey(name), value),
    removeItem: (name) => localStorage.removeItem(getUserScopedStorageKey(name)),
  };
}

export function createUserScopedJSONStorage() {
  return createJSONStorage(() => createUserScopedStorage());
}
