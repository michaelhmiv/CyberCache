/**
 * Bulk scrap queue — the store-level runner behind dismiss-on-confirm
 * bulk salvage (owner ruling, 2026-11-05).
 *
 * The threshold sheet used to sit open in a busy state until the
 * batch settled: one `cc_recycle_batch` call settles the whole
 * eligible set server-side, and with a big inventory that call can
 * take a while. The player now confirms and is done — the sheet
 * closes on the same tap, the items leave the visible inventory
 * optimistically, and this queue settles the batch in the
 * background. It lives in a store (not component state) so tab
 * navigation or sheet unmounts can never cancel a settlement.
 *
 * Honesty rules baked in:
 *   - ONE batch call per confirmed ceiling, processed in confirm
 *     order. The server resolves the eligible set itself; this
 *     queue's snapshot is only the optimistic display set.
 *   - Awards land from the server response only: `op()`'s
 *     syncVerifiedResult applies the response's profile snapshot
 *     and consumed rows, and the ONE feed summary is built from
 *     the response aggregates. Nothing is ever predicted locally.
 *   - Failure restores. The batch op is a single server
 *     transaction — a failure scrapped NOTHING — so on rejection
 *     every optimistically-removed row goes back into the
 *     inventory and a 'batchFailed' feed event says so. No item
 *     can silently vanish, and a retry starts from restored state
 *     (no double-count path: the batch nonce is per-call and the
 *     server replays a consumed nonce without re-paying).
 *   - In-flight items are unreachable: they are out of the
 *     inventory store, and the store's full-replace syncs filter
 *     pending ids, so no surface (inspect, equip, market, saved
 *     builds' client pickers) can target them mid-flight. A saved
 *     build APPLY is a server op over stored ids: it resolves
 *     against server records under the same per-player advisory
 *     lock the batch takes, and reports per-slot outcomes for
 *     anything the batch settled first (SB-1 contract). After a
 *     successful settle the queue runs a full runtime resync so
 *     the client converges to server truth whatever happened
 *     mid-flight.
 */
import { create } from 'zustand';
import { verifiedOps, type VerifiedResult } from '@/lib/api/verifiedOps';
import { formatRpcError } from '@/lib/api/rpcError';
import { syncRuntimeItemsForUser } from '@/lib/api/runtimeStateService';
import { useInventoryStore } from './inventorySlice';
import { useSalvageFeedStore } from './salvageFeedSlice';
import type { GearItem } from '@/types/items';

export interface BulkScrapJob {
  ceiling: string;
  /** The optimistic display set: rows removed at confirm time. */
  items: GearItem[];
}

interface BulkScrapState {
  queue: BulkScrapJob[];
  running: boolean;
  /**
   * Confirm entry point (called by SalvageThresholdSheet on the
   * confirm tap). Removes the items optimistically and kicks the
   * background drain. Synchronous — the caller closes immediately.
   */
  enqueueBulkScrap: (ceiling: string, candidateItems: GearItem[]) => void;
}

async function settleJob(job: BulkScrapJob): Promise<void> {
  const ids = job.items.map((item) => item.id);
  let result: VerifiedResult;
  try {
    result = await verifiedOps.recycleBatch(job.ceiling);
  } catch (err) {
    // The batch is atomic server-side: nothing was scrapped.
    // Restore every row that is still missing, then say so.
    for (const item of job.items) {
      if (!useInventoryStore.getState().getById(item.id)) {
        useInventoryStore.getState().upsertItem(item);
      }
    }
    useInventoryStore.getState().endPendingScrap(ids);
    useSalvageFeedStore.getState().pushBatchFailure({
      ceiling: job.ceiling,
      totalItems: job.items.length,
      message: formatRpcError(err),
    });
    return;
  }

  // Exactly ONE feed event for the whole settlement, built from
  // the server's aggregates (the profile + consumed rows were
  // already synced by op()'s syncVerifiedResult).
  useSalvageFeedStore.getState().pushBatch({
    maxRarity: typeof result.max_rarity === 'string' ? result.max_rarity : job.ceiling,
    totalItems: Number(result.scrapped_count ?? 0),
    countsByRarity: (result.counts_by_rarity as Record<string, number> | undefined) ?? {},
    scrap: Number(result.scrap_award ?? 0),
    cores: Number(result.cores_award ?? 0),
    bonusMaterials: (result.bonus_materials as Record<string, number> | undefined) ?? {},
  });
  useInventoryStore.getState().endPendingScrap(ids);
  // Converge to server truth: the server resolved its own eligible
  // set, and other server systems may have touched these items
  // while the batch was in flight.
  await syncRuntimeItemsForUser('');
}

export const useBulkScrapStore = create<BulkScrapState>()((set, get) => {
  const drain = async (): Promise<void> => {
    if (get().running) return;
    set({ running: true });
    try {
      for (;;) {
        const job = get().queue[0];
        if (!job) break;
        await settleJob(job);
        set((s) => ({ queue: s.queue.slice(1) }));
      }
    } finally {
      set({ running: false });
    }
  };

  return {
    queue: [],
    running: false,

    enqueueBulkScrap: (ceiling, candidateItems) => {
      // Honest snapshot: only rows the inventory store still holds
      // and that are not already inside an earlier batch. The
      // sheet's list can lag the store; the store is the truth.
      const inv = useInventoryStore.getState();
      const items = candidateItems.filter(
        (item) => inv.getById(item.id) !== undefined && !inv.pendingScrapIds.includes(item.id),
      );
      if (items.length === 0) return;

      const ids = items.map((item) => item.id);
      inv.beginPendingScrap(ids);
      useInventoryStore.setState((s) => ({
        items: s.items.filter((item) => !ids.includes(item.id)),
      }));

      set((s) => ({ queue: [...s.queue, { ceiling, items }] }));
      void drain();
    },
  };
});
