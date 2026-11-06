/**
 * Bulk scrap queue (bulkScrapSlice) — the background settlement
 * runner behind dismiss-on-confirm bulk salvage.
 *
 * Pins:
 *   - Enqueue removes the items from the inventory store in the
 *     same synchronous step and marks them pending; candidates the
 *     store no longer holds (or that are already in flight) are
 *     skipped, so a double confirm can never double-fire.
 *   - Jobs settle strictly in confirm order — the second batch
 *     call does not start until the first one resolves.
 *   - The feed summary is built from the SERVER response only
 *     (counts and awards the client could not have predicted,
 *     including a server-resolved count that differs from the
 *     optimistic snapshot size).
 *   - A rejection restores the exact rows (the batch is atomic —
 *     nothing was scrapped), clears the pending markers, pushes
 *     ONE 'batchFailed' event, and leaves the items retryable.
 *   - While a batch is in flight, full-replace inventory syncs
 *     (setItems / receiveServerItems) cannot resurrect its items;
 *     after settlement the filter is lifted.
 *   - A successful settle runs the full runtime resync exactly
 *     once per job (convergence to server truth); a failed one
 *     never does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBulkScrapStore } from '@/store/slices/bulkScrapSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useSalvageFeedStore } from '@/store/slices/salvageFeedSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { syncRuntimeItemsForUser } from '@/lib/api/runtimeStateService';
import type { GearItem } from '@/types/items';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    recycleItem: vi.fn(),
    recycleBatch: vi.fn(),
  },
}));

vi.mock('@/lib/api/runtimeStateService', () => ({
  syncRuntimeItemsForUser: vi.fn(async () => {}),
}));

const gear = (id: string, rarity = 'Common'): GearItem =>
  ({ id, name: `Item ${id}`, rarity }) as unknown as GearItem;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const resultFor = (overrides: Record<string, unknown> = {}) => ({
  action_type: 'cc_recycle_batch',
  max_rarity: 'Common',
  scrapped_count: 2,
  counts_by_rarity: { Common: 2 },
  scrap_award: 55,
  cores_award: 0,
  bonus_materials: {},
  items: [],
  profile: {},
  loadout: {},
  ...overrides,
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const ids = () => useInventoryStore.getState().items.map((i) => i.id);
const events = () => useSalvageFeedStore.getState().events;

beforeEach(() => {
  vi.mocked(verifiedOps.recycleBatch).mockReset();
  vi.mocked(syncRuntimeItemsForUser).mockClear();
  useSalvageFeedStore.setState({ events: [] });
  useBulkScrapStore.setState({ queue: [], running: false });
  useInventoryStore.setState({ items: [], pendingScrapIds: [] });
});

describe('bulkScrap queue', () => {
  it('removes items optimistically on enqueue and settles from the server response only', async () => {
    const a = gear('a');
    const b = gear('b');
    const keep = gear('keep', 'Epic');
    useInventoryStore.setState({ items: [a, b, keep] });
    const d = deferred<ReturnType<typeof resultFor>>();
    vi.mocked(verifiedOps.recycleBatch).mockReturnValue(d.promise as never);

    useBulkScrapStore.getState().enqueueBulkScrap('Common', [a, b]);

    // Synchronous: items gone, pending marked, ONE call in flight,
    // and NO feed event yet (nothing is awarded before the answer).
    expect(ids()).toEqual(['keep']);
    expect(useInventoryStore.getState().pendingScrapIds).toEqual(['a', 'b']);
    expect(verifiedOps.recycleBatch).toHaveBeenCalledTimes(1);
    expect(verifiedOps.recycleBatch).toHaveBeenCalledWith('Common');
    expect(events()).toHaveLength(0);

    // The server's numbers deliberately match NOTHING the client
    // could project from the two snapshot items: it resolved a
    // different count and a different award. The response wins.
    d.resolve(resultFor({ scrapped_count: 3, counts_by_rarity: { Common: 3 }, scrap_award: 999 }));
    await flush();
    await flush();

    expect(events()).toHaveLength(1);
    const [first] = events();
    expect(first.kind).toBe('batch');
    if (first.kind === 'batch') {
      expect(first.summary.totalItems).toBe(3);
      expect(first.summary.scrap).toBe(999);
    }
    expect(useInventoryStore.getState().pendingScrapIds).toEqual([]);
    expect(useBulkScrapStore.getState().queue).toHaveLength(0);
    expect(useBulkScrapStore.getState().running).toBe(false);
    expect(syncRuntimeItemsForUser).toHaveBeenCalledTimes(1);
  });

  it('settles jobs strictly in confirm order', async () => {
    const a = gear('a');
    const b = gear('b', 'Rare');
    useInventoryStore.setState({ items: [a, b] });
    const d1 = deferred<ReturnType<typeof resultFor>>();
    const d2 = deferred<ReturnType<typeof resultFor>>();
    vi.mocked(verifiedOps.recycleBatch)
      .mockReturnValueOnce(d1.promise as never)
      .mockReturnValueOnce(d2.promise as never);

    useBulkScrapStore.getState().enqueueBulkScrap('Common', [a]);
    useBulkScrapStore.getState().enqueueBulkScrap('Rare', [b]);

    // Both snapshots are out of the grid, but only the first
    // batch call has started.
    expect(ids()).toEqual([]);
    expect(verifiedOps.recycleBatch).toHaveBeenCalledTimes(1);
    expect(verifiedOps.recycleBatch).toHaveBeenNthCalledWith(1, 'Common');

    d1.resolve(resultFor({ scrapped_count: 1, counts_by_rarity: { Common: 1 } }));
    await flush();
    await flush();

    expect(verifiedOps.recycleBatch).toHaveBeenCalledTimes(2);
    expect(verifiedOps.recycleBatch).toHaveBeenNthCalledWith(2, 'Rare');

    d2.resolve(resultFor({ max_rarity: 'Rare', scrapped_count: 1, counts_by_rarity: { Rare: 1 } }));
    await flush();
    await flush();

    expect(events().map((e) => e.kind)).toEqual(['batch', 'batch']);
    expect(useBulkScrapStore.getState().running).toBe(false);
    expect(syncRuntimeItemsForUser).toHaveBeenCalledTimes(2);
  });

  it('skips candidates the store no longer holds and never double-fires an in-flight item', async () => {
    const a = gear('a');
    useInventoryStore.setState({ items: [a] });
    const d = deferred<ReturnType<typeof resultFor>>();
    vi.mocked(verifiedOps.recycleBatch).mockReturnValue(d.promise as never);

    useBulkScrapStore.getState().enqueueBulkScrap('Common', [a, gear('ghost')]);
    useBulkScrapStore.getState().enqueueBulkScrap('Common', [a]);

    expect(verifiedOps.recycleBatch).toHaveBeenCalledTimes(1);
    expect(useBulkScrapStore.getState().queue).toHaveLength(1);
    expect(useBulkScrapStore.getState().queue[0].items.map((i) => i.id)).toEqual(['a']);

    d.resolve(resultFor({ scrapped_count: 1, counts_by_rarity: { Common: 1 } }));
    await flush();
    await flush();
    expect(useBulkScrapStore.getState().queue).toHaveLength(0);
  });

  it('a rejection restores the exact rows, clears pending, reports once, and the items stay retryable', async () => {
    const a = gear('a');
    const b = gear('b');
    useInventoryStore.setState({ items: [a, b] });
    const d = deferred<never>();
    vi.mocked(verifiedOps.recycleBatch).mockReturnValue(d.promise as never);

    useBulkScrapStore.getState().enqueueBulkScrap('Common', [a, b]);
    expect(ids()).toEqual([]);

    d.reject(new Error('boom'));
    await flush();
    await flush();

    expect(ids().sort()).toEqual(['a', 'b']);
    expect(useInventoryStore.getState().getById('a')).toBe(a);
    expect(useInventoryStore.getState().pendingScrapIds).toEqual([]);
    expect(events()).toHaveLength(1);
    const [failure] = events();
    expect(failure.kind).toBe('batchFailed');
    if (failure.kind === 'batchFailed') {
      expect(failure.totalItems).toBe(2);
      expect(failure.message).toContain('boom');
    }
    expect(syncRuntimeItemsForUser).not.toHaveBeenCalled();

    // Retry: the restored items can be enqueued again — a fresh
    // call fires (the server-side nonce makes a true replay safe).
    const d2 = deferred<ReturnType<typeof resultFor>>();
    vi.mocked(verifiedOps.recycleBatch).mockReturnValue(d2.promise as never);
    useBulkScrapStore.getState().enqueueBulkScrap('Common', [a, b]);
    expect(verifiedOps.recycleBatch).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual([]);
    d2.resolve(resultFor({}));
    await flush();
    await flush();
    expect(events().map((e) => e.kind)).toEqual(['batch', 'batchFailed']);
  });

  it('full-replace syncs cannot resurrect in-flight items, and the filter lifts after settlement', async () => {
    const a = gear('a');
    const other = gear('other', 'Rare');
    useInventoryStore.setState({ items: [a, other] });
    const d = deferred<ReturnType<typeof resultFor>>();
    vi.mocked(verifiedOps.recycleBatch).mockReturnValue(d.promise as never);

    useBulkScrapStore.getState().enqueueBulkScrap('Common', [a]);

    // A hydration/recovery sync mid-flight still holds the item
    // server-side — it must not flash back into the grid.
    useInventoryStore.getState().receiveServerItems([a, other]);
    expect(ids()).toEqual(['other']);
    useInventoryStore.getState().setItems([a, other]);
    expect(ids()).toEqual(['other']);

    d.resolve(resultFor({ scrapped_count: 1, counts_by_rarity: { Common: 1 } }));
    await flush();
    await flush();

    // Settled: pending lifted, full-replace syncs behave normally.
    expect(useInventoryStore.getState().pendingScrapIds).toEqual([]);
    useInventoryStore.getState().receiveServerItems([other]);
    expect(ids()).toEqual(['other']);
  });
});
