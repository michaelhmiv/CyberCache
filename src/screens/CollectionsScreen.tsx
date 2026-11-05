import React, { useEffect, useState } from 'react';
import { usePlayerStore } from '@/store';
import { fetchCollections, type CollectionsPayload } from '@/lib/api/verifiedOps';
import { CollectionsWall } from '@/components/profile/CollectionsWall';

/**
 * Collections — the trophy shelf (migration 0026).
 *
 * The log of what this hunter has actually found and done: legendary
 * effects, bosses downed, legendary weapon frames, and the named
 * elites of every area. Every entry shown as FOUND was proven by a
 * server-side record (collection_discoveries, written by the Chef at
 * the moment the fact settled) — this screen is a pure consumer of
 * GET /api/collections/me plus the content catalog. Missing entries
 * read as silhouettes with their names hidden: a short family note
 * says how such an entry is earned, but the name itself — and, for
 * bosses, the hint's dedicated-drop names — stays secret until the
 * entry is logged (QC A11). The catalog itself is client content, so
 * the masking lives at the display layer (CollectionsWall); the
 * server payload only ever carries discovery records and the core
 * count.
 *
 * Legendary cores (salvaged from Legendary gear) headline the shelf:
 * they are the sink-loop currency for core-catalyzed crafting today
 * and high-end rerolls next.
 *
 * Doors (redesign v2): the Hunter → Collections rail stop renders
 * this screen embedded, and the Profile Trophy Shelf tile opens that
 * stop — the tile was a dead readout before the redesign (audit B3).
 * The App-level sub-screen mount remains as a secondary door.
 *
 * DESIGN PASS (prototype branch design/hunter-subpages-collections):
 * the presentation moved to CollectionsWall — the collector's-wall
 * composition in the Arena Plates family. This wrapper keeps the
 * fetch/error/retry behavior and the payload contract untouched.
 */
export const CollectionsScreen: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const playerCores = usePlayerStore((s) => s.legendaryCores);
  const [payload, setPayload] = useState<CollectionsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchCollections()
      .then((data) => {
        if (!cancelled) {
          setPayload(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load collections');
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div className={embedded ? undefined : 'bl-page'}>
      <CollectionsWall
        payload={payload}
        coresFallback={playerCores}
        error={error}
        embedded={embedded}
        onRetry={() => {
          setError(null);
          setReloadKey((k) => k + 1);
        }}
      />
    </div>
  );
};
