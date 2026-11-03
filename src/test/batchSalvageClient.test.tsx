/**
 * Batch salvage, client side (0054) — the threshold sheet and the
 * ONE summary event.
 *
 * Pins the owner-facing contract that replaces the 1,000-pop-up
 * freeze: picking a ceiling makes exactly ONE recycleBatch call;
 * the salvage feed gains exactly ONE 'batch' event (never one event
 * per item); the Epic ceiling demands a confirmation that names the
 * epic count; a failed settlement says plainly that nothing was
 * scrapped and pushes NO event; an empty ceiling is disabled with
 * its reason printed.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalvageThresholdSheet } from '@/components/gear/SalvageThresholdSheet';
import { SalvageToastContainer } from '@/components/action/SalvageToast';
import { useSalvageFeedStore } from '@/store/slices/salvageFeedSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';
import type { GearItem } from '@/types/items';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    recycleItem: vi.fn(),
    recycleBatch: vi.fn(),
  },
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

beforeEach(() => {
  vi.mocked(verifiedOps.recycleBatch).mockReset();
  useSalvageFeedStore.setState({ events: [] });
});

describe('SalvageThresholdSheet', () => {
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

  it('one ceiling tap = one batch call = exactly ONE feed event', async () => {
    vi.mocked(verifiedOps.recycleBatch).mockResolvedValue(batchResult as never);
    const onSettled = vi.fn();
    const onClose = vi.fn();
    render(<SalvageThresholdSheet eligibleItems={INVENTORY} onClose={onClose} onSettled={onSettled} />);

    fireEvent.click(screen.getByText('Rare & under'));

    await waitFor(() => expect(verifiedOps.recycleBatch).toHaveBeenCalledTimes(1));
    expect(verifiedOps.recycleBatch).toHaveBeenCalledWith('Rare');
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);

    const events = useSalvageFeedStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('batch');
    if (events[0].kind === 'batch') {
      expect(events[0].summary.totalItems).toBe(4);
      expect(events[0].summary.scrap).toBe(321);
      expect(events[0].summary.countsByRarity).toEqual({ Common: 2, Uncommon: 1, Rare: 1 });
      expect(events[0].summary.bonusMaterials).toEqual({ BallisticParts: 1 });
    }
  });

  it('Epic ceiling asks first, naming the epic count, and settles only on confirm', async () => {
    vi.mocked(verifiedOps.recycleBatch).mockResolvedValue({ ...batchResult, max_rarity: 'Epic', scrapped_count: 5 } as never);
    render(<SalvageThresholdSheet eligibleItems={INVENTORY} onClose={() => {}} onSettled={() => {}} />);

    fireEvent.click(screen.getByText('Epic & under'));
    expect(await screen.findByTestId('salvage-epic-confirm')).toBeInTheDocument();
    expect(screen.getByText(/including/)).toBeInTheDocument();
    expect(verifiedOps.recycleBatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Scrap all 5'));
    await waitFor(() => expect(verifiedOps.recycleBatch).toHaveBeenCalledWith('Epic'));
    expect(useSalvageFeedStore.getState().events).toHaveLength(1);
  });

  it('a failed settlement says nothing was scrapped and pushes no event', async () => {
    vi.mocked(verifiedOps.recycleBatch).mockRejectedValue(new Error('Invalid salvage ceiling'));
    const onClose = vi.fn();
    render(<SalvageThresholdSheet eligibleItems={INVENTORY} onClose={onClose} onSettled={() => {}} />);

    fireEvent.click(screen.getByText('Commons only'));
    expect(await screen.findByText(/nothing was scrapped/)).toBeInTheDocument();
    expect(useSalvageFeedStore.getState().events).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
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
});
