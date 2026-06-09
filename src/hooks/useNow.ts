import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  const id = setInterval(callback, 1000);
  return () => clearInterval(id);
}

function getSnapshot() {
  return Date.now();
}

/**
 * Returns the current timestamp (Date.now()) as a reactive value,
 * updated every second. Use this to safely access the current time
 * in render-phase computations (useMemo, etc.) without triggering
 * React Compiler's impure-function-in-render lint.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
