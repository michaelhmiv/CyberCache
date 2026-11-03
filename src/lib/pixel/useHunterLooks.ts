/**
 * useHunterLooks (skins slice, 0053) — fetch other hunters' looks
 * for social surfaces (Standings). One batched read per id set
 * (the endpoint caps at 50); results are cached per id for the
 * session so re-renders and board switches don't refetch. A failed
 * read leaves the map empty — rows render without portraits
 * rather than failing the board.
 */
import { useEffect, useState } from 'react';
import { getHunterLooks } from '@/lib/chef/chefClient';
import type { HunterLookView } from '@/content/skins';

const cache = new Map<string, HunterLookView>();
const inFlight = new Set<string>();

export function useHunterLooks(ids: string[]): Record<string, HunterLookView> {
  const [looks, setLooks] = useState<Record<string, HunterLookView>>(() => {
    const out: Record<string, HunterLookView> = {};
    for (const id of ids) {
      const hit = cache.get(id);
      if (hit) out[id] = hit;
    }
    return out;
  });

  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    if (!key) return;
    const wanted = key.split(',').filter((id) => !cache.has(id) && !inFlight.has(id));
    if (wanted.length === 0) {
      // Everything asked for is already cached — but a surface that
      // mounted before its ids were known (the profile pop-up opens
      // with no profile, then receives one) initialized its state
      // empty and would never sync. Merge the cache hits in.
      setLooks((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const id of key.split(',')) {
          const hit = cache.get(id);
          if (hit && next[id] !== hit) {
            next[id] = hit;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      return;
    }
    for (const id of wanted) inFlight.add(id);
    let cancelled = false;
    getHunterLooks(wanted.slice(0, 50))
      .then((result) => {
        for (const [id, look] of Object.entries(result.looks)) cache.set(id, look);
        if (!cancelled) {
          setLooks((prev) => {
            const next = { ...prev };
            for (const id of key.split(',')) {
              const hit = cache.get(id);
              if (hit) next[id] = hit;
            }
            return next;
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        for (const id of wanted) inFlight.delete(id);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return looks;
}

/** Test seam: drop the session cache between cases. */
export function clearHunterLooksCache(): void {
  cache.clear();
  inFlight.clear();
}
