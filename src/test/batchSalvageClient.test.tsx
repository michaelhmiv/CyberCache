/**
 * Batch salvage, client side (0055 + dismiss-on-confirm, 2026-11-05).
 *
 * Pins the owner-facing contract:
 *   - Choosing a ceiling makes exactly ONE recycleBatch call for
 *     the whole settlement — fired by the background queue
 *     (bulkScrapSlice), never one call per item.
 *   - Confirming CLOSES the sheet on the same tap (owner ruling):
 *     the items leave the inventory store optimistically and the
 *     player is back to scrolling while the call is still pending.
 *   - The salvage feed gains exactly ONE 'batch' event when the
 *     server answers, with the SERVER's totals — never before, and
 *     never one event per item.
 *   - A failed settlement restores the items (the batch is atomic:
 *     nothing was scrapped) and surfaces ONE 'batchFailed' event.
 *   - The Epic ceiling demands a confirmation that names the epic
 *     count; an empty ceiling is disabled with its reason printed.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalvageThresholdSheet } from '@/components/gear/SalvageThresholdSheet';
import { SalvageToastContainer } from '@/components/action/SalvageToast';
import { useSalvageFeedStore } from '@/store/slices/salvageFeedSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useBulkScrapStore } from '@/store/slices/bulkScrapSlice';
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

const gear = (id: string, rarity: string): GearItem =>
  ({ id, name: `Item ${id}`, rarity }) as unknown as GearItem;

const INVENTORY: GearItem[] = [
  gear('i1', 'Common'),
  gear('i2', 'Common'),
  gear('i3', 'Uncommon'),
  gear('i4', 'Rare'),
  gear('i5', 'Epic'),
];

const batchResult = {
  action_type: 'cc_recycle_batch',
  max_rarity: 'Rare',
  scrapped_count: 4,
  counts_by_rarity: { Common: 2, Uncommon: 1, Rare: 1 },
  scrap_award: 321,
  cores_award: 0,
  bonus_materials: { BallisticParts: 1 },
  items: [],
  profile: {},
  loadout: {},
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const inventoryIds = () => useInventoryStore.getState().items.map((i) => i.id);

beforeEach(() => {
  vi.mocked(verifiedOps.recycleBatch).mockReset();
  vi.mocked(syncRuntimeItemsForUser).mockClear();
  useSalvageFeedStore.setState({ events: [] });
  useBulkScrapStore.setState({ queue: [], running: false });
  useInventoryStore.setState({ items: [...INVENTORY], pendingScrapIds: [] });
});

describe('SalvageThresholdSheet — dismiss on confirm', () => {
  it('shows live cumulative counts per ceiling and the legendary rule', () => {
    render(<SalvageThresholdSheet eligibleItems={INVENTORY} onClose={() => {}} onSettled={() => {}} />);
    expect(screen.getByText('Commons only')).toBeInTheDocument();
    expect(screen.getByText('2 items')).toBeInTheDocument();
    expect(screen.getByText('3 items')).toBeInTheDocument();
    expect(screen.getByText('4 items')).toBeInTheDocument();
    expect(screen.getByText('5 items')).toBeInTheDocument();
    expect(screen.getByText(/Includes 1 Epic/)).toBeInTheDocument();
    expect(screen.getByText(/Legendaries are never bulk-scrapped/)).toBeInTheDocument();
  });

  it('confirm closes the sheet on the same tap, items leave at once, ONE feed event lands when the server answers', async () => {
    const d = deferred<typeof batchResult>();
    vi.mocked(verifiedOps.recycleBatch).mockReturnValue(d.promise as never);
    const onSettled = vi.fn();
    const onClose = vi.fn();
    render(<SalvageThresholdSheet eligibleItems={INVENTORY} onClose={onClose} onSettled={onSettled} />);

    fireEvent.click(screen.getByText('Rare & under'));

    // Same tap: sheet closed, selection cleared, the ONE batch call
    // is in flight, and the chosen items are already gone from the
    // inventory store — while the Epic (above the ceiling) stays.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(verifiedOps.recycleBatch).toHaveBeenCalledTimes(1);
    expect(verifiedOps.recycleBatch).toHaveBeenCalledWith('Rare');
    expect(inventoryIds()).toEqual(['i5']);
    expect(useInventoryStore.getState().pendingScrapIds).toEqual(['i1', 'i2', 'i3', 'i4']);
    // No summary before the server answers — awards are never predicted.
    expect(useSalvageFeedStore.getState().events).toHaveLength(0);

    d.resolve(batchResult);

    await waitFor(() => expect(useSalvageFeedStore.getState().events).toHaveLength(1));
    const events = useSalvageFeedStore.getState().events;
    expect(events[0].kind).toBe('batch');
    if (events[0].kind === 'batch') {
      expect(events[0].summary.totalItems).toBe(4);
      expect(events[0].summary.scrap).toBe(321);
      expect(events[0].summary.countsByRarity).toEqual({ Common: 2, Uncommon: 1, Rare: 1 });
      expect(events[0].summary.bonusMaterials).toEqual({ BallisticParts: 1 });
    }
    // Settlement converged through the full runtime resync and the
    // in-flight markers cleared.
    expect(syncRuntimeItemsForUser).toHaveBeenCalled();
    expect(useInventoryStore.getState().pendingScrapIds).toEqual([]);
    expect(useBulkScrapStore.getState().queue).toHaveLength(0);
  });

  it('a failed settlement restores the items and reports through the feed — nothing was scrapped', async () => {
    const d = deferred<never>();
    vi.mocked(verifiedOps.recycleBatch).mockReturnValue(d.promise as never);
    const onClose = vi.fn();
    render(<SalvageThresholdSheet eligibleItems={INVENTORY} onClose={onClose} onSettled={() => {}} />);

    fireEvent.click(screen.getByText('Commons only'));

    // The sheet still closed on the tap — the failure arrives later.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(inventoryIds()).toEqual(['i3', 'i4', 'i5']);

    d.reject(new Error('Invalid salvage ceiling'));

    await waitFor(() => expect(inventoryIds()).toHaveLength(5));
    expect(inventoryIds().sort()).toEqual(['i1', 'i2', 'i3', 'i4', 'i5']);
    expect(useInventoryStore.getState().pendingScrapIds).toEqual([]);
    const events = useSalvageFeedStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('batchFailed');
    if (events[0].kind === 'batchFailed') {
      expect(events[0].ceiling).toBe('Common');
      expect(events[0].totalItems).toBe(2);
    }
    // A failure never triggers the convergence resync.
    expect(syncRuntimeItemsForUser).not.toHaveBeenCalled();
  });

  it('Epic ceiling asks first, naming the epic count, and confirm fires + closes immediately', async () => {
    const d = deferred<typeof batchResult>();
    vi.mocked(verifiedOps.recycleBatch).mockReturnValue(d.promise as never);
    const onClose = vi.fn();
    render(<SalvageThresholdSheet eligibleItems={INVENTORY} onClose={onClose} onSettled={() => {}} />);

    fireEvent.click(screen.getByText('Epic & under'));
    expect(await screen.findByTestId('salvage-epic-confirm')).toBeInTheDocument();
    expect(screen.getByText(/including/)).toBeInTheDocument();
    expect(verifiedOps.recycleBatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Scrap all 5'));
    expect(verifiedOps.recycleBatch).toHaveBeenCalledWith('Epic');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(inventoryIds()).toEqual([]);

    d.resolve({ ...batchResult, max_rarity: 'Epic', scrapped_count: 5 });
    await waitFor(() => expect(useSalvageFeedStore.getState().events).toHaveLength(1));
    expect(useSalvageFeedStore.getState().events[0].kind).toBe('batch');
  });

  it('an empty ceiling is disabled with its reason printed', () => {
    render(
      <SalvageThresholdSheet eligibleItems={[gear('x1', 'Epic')]} onClose={() => {}} onSettled={() => {}} />,
    );
    const commonRow = screen.getByText('Commons only').closest('button');
    expect(commonRow).toBeDisabled();
    expect(screen.getAllByText('None in inventory').length).toBeGreaterThan(0);
  });
});

describe('batch summary card', () => {
  it('renders the totals ONCE — counts by rarity and the hero scrap number', () => {
    useSalvageFeedStore.getState().pushBatch({
      maxRarity: 'Rare',
      totalItems: 1234,
      countsByRarity: { Common: 1000, Uncommon: 200, Rare: 34 },
      scrap: 54321,
      cores: 0,
      bonusMaterials: { BallisticParts: 7 },
    });
    render(<SalvageToastContainer />);
    expect(screen.getByTestId('salvage-batch-summary')).toBeInTheDocument();
    expect(screen.getByText(/Salvaged 1234 items/)).toBeInTheDocument();
    expect(screen.getByText('1000 Common')).toBeInTheDocument();
    expect(screen.getByText('34 Rare')).toBeInTheDocument();
    expect(screen.getByText('+54321 Scrap')).toBeInTheDocument();
    expect(screen.getByText('+7 Ballistic Parts')).toBeInTheDocument();
    expect(screen.getAllByTestId('salvage-batch-summary')).toHaveLength(1);
  });

  it('renders the failure card — nothing was scrapped, items are back', () => {
    useSalvageFeedStore.getState().pushBatchFailure({
      ceiling: 'Rare',
      totalItems: 42,
      message: 'Simulated settle failure',
    });
    render(<SalvageToastContainer />);
    expect(screen.getByTestId('salvage-batch-failed')).toBeInTheDocument();
    expect(screen.getByText(/Bulk salvage failed/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was scrapped/)).toBeInTheDocument();
    expect(screen.getByText(/42 items are back/)).toBeInTheDocument();
    expect(screen.getByText(/Simulated settle failure/)).toBeInTheDocument();
  });
});
