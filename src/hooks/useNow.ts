import { useSyncExternalStore } from 'react';
import { usePresentationActive } from '@/hooks/usePresentationActive';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(callback: () => void) {
  listeners.add(callback);
  timer ??= setInterval(() => listeners.forEach((listener) => listener()), 1000);
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const subscribePaused = () => () => {};

let cachedSnapshot = Math.floor(Date.now() / 1000) * 1000;

function getSnapshot(): number {
  // Round to whole seconds so that consecutive calls within the same
  // render phase return the same value — useSyncExternalStore requires
  // getSnapshot to be stable when the underlying store hasn't changed.
  // Raw Date.now() returns ms precision and can differ between two
  // calls in the same sync render, causing infinite update loops.
  const now = Math.floor(Date.now() / 1000) * 1000;
  if (now !== cachedSnapshot) {
    cachedSnapshot = now;
  }
  return cachedSnapshot;
}

/**
 * Returns the current timestamp (Date.now()) as a reactive value,
 * rounded to whole seconds and updated every second. Use this to
 * safely access the current time in render-phase computations
 * (useMemo, etc.) without triggering React Compiler's
 * impure-function-in-render lint.
 */
export function useNow(enabled = true): number {
  const active = usePresentationActive();
  return useSyncExternalStore(active && enabled ? subscribe : subscribePaused, getSnapshot);
}
