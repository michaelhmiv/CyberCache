/**
 * useHunterLooks (skins slice, 0053) — fetch other hunters' looks
 * for social surfaces (Standings). One batched read per id set
 * (the endpoint caps at 50); results are cached per id for the
 * session so re-renders and board switches don't refetch. A failed
 * read leaves the map empty — rows render without portraits
 * rather than failing the board.
 *
 * The returned map is derived from the session cache at render
 * time: a surface that mounts before its ids are known (the
 * profile pop-up opens empty, then receives a profile) picks up
 * already-cached looks on its next render instead of missing them
 * forever — the fetch effect only ever fetches, and its completion
 * bumps a tick that re-renders subscribers.
 */
import { useEffect, useState } from 'react';
import { getHunterLooks } from '@/lib/chef/chefClient';
import type { HunterLookView } from '@/content/skins';

const cache = new Map<string, HunterLookView>();
const inFlight = new Set<string>();

export function useHunterLooks(ids: string[]): Record<string, HunterLookView> {
  const [, setFetchTick] = useState(0);

  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    if (!key) return;
    const wanted = key.split(',').filter((id) => !cache.has(id) && !inFlight.has(id));
    if (wanted.length === 0) return;
    for (const id of wanted) inFlight.add(id);
    let cancelled = false;
    getHunterLooks(wanted.slice(0, 50))
      .then((result) => {
        for (const [id, look] of Object.entries(result.looks)) cache.set(id, look);
        if (!cancelled) setFetchTick((tick) => tick + 1);
      })
      .catch(() => undefined)
      .finally(() => {
        for (const id of wanted) inFlight.delete(id);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const looks: Record<string, HunterLookView> = {};
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit) looks[id] = hit;
  }
  return looks;
}

/** Test seam: drop the session cache between cases. */
export function clearHunterLooksCache(): void {
  cache.clear();
  inFlight.clear();
}
