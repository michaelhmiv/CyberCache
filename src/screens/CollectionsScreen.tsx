import React, { useEffect, useState } from 'react';
import { usePlayerStore } from '@/store';
import { fetchCollections, type CollectionsPayload } from '@/lib/api/verifiedOps';
import { CollectionsPanel } from '@/components/profile/CollectionsPanel';

/**
 * Collections — the hunter's proof log (migration 0026).
 *
 * The body renders through CollectionsPanel, the instrument-cluster
 * register (owner pick B, 2026-11-05): the 81 proofs presented as
 * measurement — a master dial, per-family channel meters, and a
 * telemetry row per entry. The data contract is unchanged — a pure
 * consumer of GET /api/collections/me plus the content catalog;
 * found state comes from server discovery records only, and
 * undiscovered entries stay masked at the display layer (QC A11).
 *
 * Legendary cores (salvaged from Legendary gear) ride in the panel
 * header as a counter readout: they are the sink-loop currency for
 * core-catalyzed crafting today and high-end rerolls next.
 *
 * Doors (redesign v2): the Hunter → Collections rail stop renders
 * this screen embedded, and the Profile Trophy Shelf tile opens that
 * stop. The App-level sub-screen mount remains as a secondary door.
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

  const cores = payload?.legendary_cores ?? playerCores;

  return (
    <div className={embedded ? '' : 'bl-page p-4 pb-20'}>
      <CollectionsPanel
        payload={payload}
        cores={cores}
        error={error}
        onRetry={() => {
          setError(null);
          setReloadKey((k) => k + 1);
        }}
      />
    </div>
  );
};
