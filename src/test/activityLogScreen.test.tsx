/**
 * AL-3 — the Activity Log screen, against API-shaped fixtures.
 *
 * Fixtures mirror AL-2's wire contract field for field (labels are
 * the server's own compositions, including 'Drop — predates item
 * records' for receipt: null). Covered: every record kind renders;
 * the honesty rules hold on the face (engaged ≠ dropped-by, the
 * pre-stamp line, the receipts divider, the while-away divider);
 * chip + search wiring calls the API with the right params; cursor
 * pagination appends; both doors route to the screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ActivityLogScreen } from '@/screens/ActivityLogScreen';
import { ActionFeed } from '@/components/action/ActionWorkspace';
import { ActivityLogDoor } from '@/components/profile/ActivityLogDoor';
import {
  fetchActivityLog,
  type ActivityLogPage, type ActivityRecord,
} from '@/lib/api/activityLogService';

vi.mock('@/lib/api/activityLogService', () => ({ fetchActivityLog: vi.fn() }));
const mockFetch = vi.mocked(fetchActivityLog);

const page = (records: ActivityRecord[], nextCursor: string | null = null): ActivityLogPage => ({
  records, nextCursor, limit: 50,
});

const stampedDrop: ActivityRecord = {
  id: 'item:drop-1',
  kind: 'drop',
  at: '2026-11-03T19:02:00.000Z',
  away: false,
  label: 'Dustwaste Frontier — while fighting Rust Vulture',
  item: { id: 'drop-1', name: 'Rustline Longshot', kind: 'weapon', rarity: 'Rare', level: 24 },
  receipt: {
    foundVia: 'roam',
    foundContext: 'dustwaste_frontier',
    foundEnemy: { id: 'rust_vulture', name: 'Rust Vulture', relation: 'engaged' },
    dropOdds: {
      gearChance: 0.3,
      kind: 'weapon',
      rarityWeights: { Common: 62, Uncommon: 25, Rare: 10, Epic: 2.6, Legendary: 0.4 },
      luck: 1.1,
    },
    sourceId: null,
  },
  areaId: 'dustwaste_frontier',
  areaName: 'Dustwaste Frontier',
};

const killedDrop: ActivityRecord = {
  id: 'item:drop-2',
  kind: 'drop',
  at: '2026-11-03T18:40:00.000Z',
  away: false,
  label: 'Rustbelt Ruins — dropped by Scrap Hound Alpha',
  item: { id: 'drop-2', name: 'Houndstooth Carbine', kind: 'weapon', rarity: 'Epic', level: 25 },
  receipt: {
    foundVia: 'roam',
    foundContext: 'rustbelt_ruins',
    foundEnemy: { id: 'scrap_hound_alpha', name: 'Scrap Hound Alpha', relation: 'killed' },
    dropOdds: {
      kind: 'weapon',
      rarityWeights: { Common: 40, Uncommon: 30, Rare: 20, Epic: 8, Legendary: 2 },
    },
    sourceId: null,
  },
  areaId: 'rustbelt_ruins',
  areaName: 'Rustbelt Ruins',
};

const preStampDrop: ActivityRecord = {
  id: 'item:drop-0',
  kind: 'drop',
  at: '2026-10-30T21:14:00.000Z',
  away: false,
  label: 'Drop — predates item records',
  item: { id: 'drop-0', name: 'Scrap Revolver', kind: 'weapon', rarity: 'Common', level: 2 },
  receipt: null,
};

const bossRecord: ActivityRecord = {
  id: 'ledger:boss-1',
  kind: 'boss',
  at: '2026-11-03T18:12:00.000Z',
  away: false,
  label: 'Dune Tyrant — victory',
  boss: {
    bossId: 'dune_tyrant', bossName: 'Dune Tyrant', victory: true, winChance: 0.64,
    dedicatedChance: 0.08, dedicatedDropAwarded: false, dropLuckBonus: 3,
    creditsGained: 850, creditsLost: 0,
    loot: [{ id: 'loot-1', name: 'Tyrant Plate', kind: 'shield', rarity: 'Epic', level: 26 }],
  },
};

const marketSale: ActivityRecord = {
  id: 'listing:sale-1',
  kind: 'market',
  at: '2026-11-03T17:44:00.000Z',
  away: false,
  label: 'Sold Dust Devil SMG to Vex',
  item: { id: 'sale-1', name: 'Dust Devil SMG', kind: 'weapon', rarity: 'Rare', level: 21 },
  market: {
    direction: 'sold', priceCredits: 2400, feeCredits: 120,
    counterpartyId: 'hunter-2', counterpartyName: 'Vex', listingId: 'sale-1',
  },
};

const cacheRecord: ActivityRecord = {
  id: 'ledger:cache-1',
  kind: 'cache',
  at: '2026-11-03T17:02:00.000Z',
  away: false,
  label: 'Cache — Aurum Casket',
  item: { id: 'cache-1', name: 'Aurum Casket', kind: 'relic', rarity: 'Epic', level: 22 },
  cache: {
    tableId: 'cache_primary', outcome: 'Epic', roll: 7213, totalWeight: 10000,
    oddsTableVersion: 1, cacheQuality: 0.5, payment: 'free',
  },
};

const craftRecord: ActivityRecord = {
  id: 'craft:craft-1',
  kind: 'craft',
  at: '2026-11-03T16:20:00.000Z',
  away: false,
  label: 'Patch Kit — crafted',
  craft: {
    recipeId: 'patch_kit', recipeName: 'Patch Kit', jobKind: 'craft', bench: 1,
    unitsCompleted: 1, unitsTotal: 1, xpAwarded: 45,
    outputs: [{ name: 'Patch Kit', count: 1 }],
  },
};

const earningsRecord: ActivityRecord = {
  id: 'ledger:earn-1',
  kind: 'earnings',
  at: '2026-11-03T19:04:00.000Z',
  away: false,
  label: 'Roaming claim — +412 cr · +38 scrap · +96 XP',
  earnings: { credits: 412, scrap: 38, xp: 96 },
};

const killsRecord: ActivityRecord = {
  id: 'ledger:kills-1',
  kind: 'kills',
  at: '2026-11-03T19:03:00.000Z',
  away: false,
  label: '96 kills — Dustwaste Frontier',
  kills: { count: 96 },
  areaId: 'dustwaste_frontier',
  areaName: 'Dustwaste Frontier',
};

const settlementRecord: ActivityRecord = {
  id: 'ledger:settle-1',
  kind: 'settlement',
  at: '2026-11-03T08:15:00.000Z',
  away: true,
  label: 'While you were away — Dustwaste Frontier',
  settlement: { elapsedMs: 6 * 3_600_000 + 12 * 60_000, capHours: 24, capReached: false, ticks: 372 },
  areaId: 'dustwaste_frontier',
  areaName: 'Dustwaste Frontier',
};

const awayDrop: ActivityRecord = {
  id: 'item:drop-away',
  kind: 'drop',
  at: '2026-11-03T05:30:00.000Z',
  away: true,
  label: 'Dustwaste Frontier — while fighting Rust Vulture',
  item: { id: 'drop-away', name: 'Dust Devil SMG', kind: 'weapon', rarity: 'Uncommon', level: 19 },
  receipt: {
    foundVia: 'offline',
    foundContext: 'dustwaste_frontier',
    foundEnemy: { id: 'rust_vulture', name: 'Rust Vulture', relation: 'engaged' },
    dropOdds: {
      gearChance: 0.3, kind: 'weapon',
      rarityWeights: { Common: 62, Uncommon: 25, Rare: 10, Epic: 2.6, Legendary: 0.4 },
    },
    sourceId: null,
  },
  areaId: 'dustwaste_frontier',
  areaName: 'Dustwaste Frontier',
};

const salvageRecord: ActivityRecord = {
  id: 'ledger:salv-1',
  kind: 'salvage',
  at: '2026-11-03T15:10:00.000Z',
  away: false,
  label: 'Salvaged Worn Carbine',
  item: { id: 'salv-1', name: 'Worn Carbine', kind: 'weapon', rarity: 'Common', level: 9 },
  salvage: { scrapAward: 140, coresAward: 0 },
};

const dispatchRecord: ActivityRecord = {
  id: 'dispatch:disp-1',
  kind: 'dispatch',
  at: '2026-11-03T14:00:00.000Z',
  away: false,
  label: 'Dispatch — Supply Run returned',
  dispatch: { family: 'supply_run', payoutCredits: 300, payoutFraction: 1 },
};

const endlessRecord: ActivityRecord = {
  id: 'endless:end-1',
  kind: 'endless',
  at: '2026-11-03T13:00:00.000Z',
  away: false,
  label: 'Endless — depth 14',
  endless: { status: 'ended', depthReached: 14 },
};

const systemRecord: ActivityRecord = {
  id: 'ledger:sys-1',
  kind: 'system',
  at: '2026-11-03T12:00:00.000Z',
  away: false,
  label: 'Resurrected',
  system: { subtype: 'resurrect' },
};

// AL-4 trace fixtures — mirror the projection's own compositions.
const bulkSalvageRecord: ActivityRecord = {
  id: 'ledger:batch-1',
  kind: 'salvage',
  at: '2026-11-03T19:30:00.000Z',
  away: false,
  label: 'Bulk salvage — 37 items (Rare and under)',
  salvage: {
    scrapAward: 4120, coresAward: 0, batch: true, scrappedCount: 37,
    maxRarity: 'Rare', countsByRarity: { Common: 30, Rare: 7 }, bonusMaterials: { Scrap: 12 },
  },
};

const extractionRecord: ActivityRecord = {
  id: 'ledger:ext-1',
  kind: 'extraction',
  at: '2026-11-03T19:10:00.000Z',
  away: false,
  label: 'Extraction — 2 passes — 2 areas',
  extraction: {
    passesCompleted: 2, xpAwarded: 480,
    passes: [
      { areaId: 'dustwaste_frontier', areaName: 'Dustwaste Frontier', method: 'surface', deepDegraded: false, xp: 240, signatureUnits: 0 },
      { areaId: 'helixworks_labyrinth', areaName: 'HelixWorks Labyrinth', method: 'surface', deepDegraded: true, xp: 240, signatureUnits: 3 },
    ],
    materials: { MycoSteelFiber: 6, Scrap: 12 }, essences: { Fire: 2 },
  },
};

const serviceRecord: ActivityRecord = {
  id: 'ledger:svc-1',
  kind: 'service',
  at: '2026-11-03T19:20:00.000Z',
  away: false,
  label: 'Repair posted — Dune Buggy',
  item: { id: 'veh-1', name: 'Dune Buggy', kind: 'vehicle', rarity: 'Rare', level: 20 },
  service: {
    board: 'repair', step: 'posted', role: 'poster', jobId: 'job-1', jobStatus: 'open',
    outcome: null, priceCredits: 300, paidCredits: 0, feeCredits: 0, xpAwarded: 0,
    pointsRestored: 0, targetPoints: 40, kitType: null,
  },
};

const dispatchDepartRecord: ActivityRecord = {
  id: 'ledger:dep-1',
  kind: 'dispatch',
  at: '2026-11-03T19:25:00.000Z',
  away: false,
  label: 'Dispatch departed — courier to HelixWorks Labyrinth',
  dispatch: {
    family: 'courier', payoutCredits: 900, payoutFraction: null,
    step: 'departed', areaId: 'helixworks_labyrinth', areaName: 'HelixWorks Labyrinth', durationHours: 6,
  },
};

const ALL_KINDS = [
  earningsRecord, killsRecord, stampedDrop, killedDrop, bossRecord, marketSale,
  cacheRecord, craftRecord, salvageRecord, dispatchRecord, endlessRecord, systemRecord,
  bulkSalvageRecord, extractionRecord, serviceRecord, dispatchDepartRecord,
];

beforeEach(() => {
  mockFetch.mockReset();
});

describe('ActivityLogScreen', () => {
  it('renders every record kind from API-shaped fixtures', async () => {
    mockFetch.mockResolvedValue(page(ALL_KINDS));
    render(<ActivityLogScreen />);
    await screen.findByText('Rustline Longshot');
    const cards = screen.getAllByTestId('activity-record');
    const kinds = cards.map((c) => c.getAttribute('data-kind'));
    for (const kind of ['drop', 'kills', 'boss', 'cache', 'craft', 'market', 'earnings', 'salvage', 'dispatch', 'endless', 'system', 'extraction', 'service']) {
      expect(kinds).toContain(kind);
    }
    // AL-4 faces: the bulk-salvage summary in the spec's own words,
    // the service post with its quote, the departure with its terms.
    expect(screen.getByText('Bulk salvage — 37 items (Rare and under)')).toBeTruthy();
    expect(screen.getByText('+4,120 scrap')).toBeTruthy();
    expect(screen.getByText('Extraction — 2 passes — 2 areas')).toBeTruthy();
    expect(screen.getByText('+480 XP · +6 MycoSteelFiber · +12 Scrap · +2 Fire')).toBeTruthy();
    expect(screen.getByText('Repair posted — Dune Buggy')).toBeTruthy();
    expect(screen.getByText('300 cr quoted')).toBeTruthy();
    expect(screen.getByText('Dispatch departed — courier to HelixWorks Labyrinth')).toBeTruthy();
    expect(screen.getByText('pays 900 cr · to HelixWorks Labyrinth · 6h')).toBeTruthy();
    expect(screen.getByText('96 kills — Dustwaste Frontier')).toBeTruthy();
    expect(screen.getByText('Dune Tyrant — victory')).toBeTruthy();
    expect(screen.getByText('Sold Dust Devil SMG')).toBeTruthy();
    expect(screen.getByText('2,400 cr · to Vex · fee 120 cr')).toBeTruthy();
    expect(screen.getByText('Roaming claim')).toBeTruthy();
    expect(screen.getByText('+412 cr · +38 scrap · +96 XP')).toBeTruthy();
  });

  it('keeps drop provenance honest: engaged is "while fighting", never "dropped by"', async () => {
    mockFetch.mockResolvedValue(page([stampedDrop, killedDrop]));
    render(<ActivityLogScreen />);
    await screen.findByText('Rustline Longshot');
    expect(screen.getByText('Dustwaste Frontier — while fighting Rust Vulture')).toBeTruthy();
    expect(screen.queryByText(/dropped by Rust Vulture/)).toBeNull();
    expect(screen.getByText('Rustbelt Ruins — dropped by Scrap Hound Alpha')).toBeTruthy();
    // Headline odds: gearChance 0.3 × Rare share 10/100 = 3.0%.
    expect(screen.getByText('3.0% · 1 in ~33')).toBeTruthy();
  });

  it('opens the drop sheet with the receipt and the odds it rolled', async () => {
    mockFetch.mockResolvedValue(page([stampedDrop]));
    render(<ActivityLogScreen />);
    fireEvent.click(await screen.findByText('Rustline Longshot'));
    const sheet = await screen.findByTestId('activity-record-sheet');
    expect(within(sheet).getByText('Where It Came From')).toBeTruthy();
    expect(within(sheet).getByText('Rust Vulture')).toBeTruthy();
    expect(within(sheet).getByText('Rolled while fighting it — not off the body')).toBeTruthy();
    expect(within(sheet).getByText('The Odds It Rolled')).toBeTruthy();
    expect(within(sheet).getByText('3.0%')).toBeTruthy();
    expect(within(sheet).getByText(/Recorded on the item at the moment it dropped/)).toBeTruthy();
  });

  it('prints pre-stamp drops plainly and marks where receipts begin', async () => {
    mockFetch.mockResolvedValue(page([stampedDrop, preStampDrop]));
    render(<ActivityLogScreen />);
    await screen.findByText('Scrap Revolver');
    expect(screen.getByText('Source not recorded')).toBeTruthy();
    expect(screen.getByText('Receipts begin here')).toBeTruthy();
    fireEvent.click(screen.getByText('Scrap Revolver'));
    const sheet = await screen.findByTestId('activity-record-sheet');
    expect(within(sheet).getByText(/predates item records/)).toBeTruthy();
    expect(within(sheet).queryByText('The Odds It Rolled')).toBeNull();
  });

  it('groups a while-away stretch under its divider, in the same stream', async () => {
    mockFetch.mockResolvedValue(page([stampedDrop, settlementRecord, awayDrop]));
    render(<ActivityLogScreen />);
    await screen.findByText('While you were away — Dustwaste Frontier');
    expect(screen.getByText('While you were away', { selector: 'div' })).toBeTruthy();
    expect(screen.getByText('6h 12m away · 372 ticks settled')).toBeTruthy();
    // The away drop keeps its away tag on the card face.
    const awayCard = screen.getAllByTestId('activity-record').find((c) => c.textContent?.includes('Dust Devil SMG'));
    expect(awayCard?.textContent).toContain('While away');
  });

  it('wires kind chips to the API kind filter', async () => {
    mockFetch.mockResolvedValue(page(ALL_KINDS));
    render(<ActivityLogScreen />);
    await screen.findByText('Rustline Longshot');
    fireEvent.click(screen.getByTestId('activity-chip-boss'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['boss'] }));
    });
    fireEvent.click(screen.getByTestId('activity-chip-system'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['settlement', 'system'] }));
    });
    fireEvent.click(screen.getByTestId('activity-chip-extraction'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['extraction'] }));
    });
    fireEvent.click(screen.getByTestId('activity-chip-service'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['service'] }));
    });
    fireEvent.click(screen.getByTestId('activity-chip-away'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['away'] }));
    });
    fireEvent.click(screen.getByTestId('activity-chip-all'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ kinds: undefined }));
    });
  });

  it('wires the one search box to the API q param', async () => {
    mockFetch.mockResolvedValue(page(ALL_KINDS));
    render(<ActivityLogScreen />);
    await screen.findByText('Rustline Longshot');
    fireEvent.change(screen.getByTestId('activity-search'), { target: { value: 'Vulture' } });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ q: 'Vulture' }));
    }, { timeout: 2000 });
  });

  it('paginates by cursor and appends older facts', async () => {
    mockFetch
      .mockResolvedValueOnce(page([stampedDrop], 'cursor-2'))
      .mockResolvedValueOnce(page([preStampDrop], null));
    render(<ActivityLogScreen />);
    await screen.findByText('Rustline Longshot');
    fireEvent.click(screen.getByTestId('activity-load-more'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-2' }));
    });
    await screen.findByText('Scrap Revolver');
    expect(screen.getByText(/End of the record/)).toBeTruthy();
    expect(screen.getByTestId('activity-count').textContent).toContain('2 facts');
  });

  it('shows the empty-record line for a new account', async () => {
    mockFetch.mockResolvedValue(page([]));
    render(<ActivityLogScreen />);
    await screen.findByText(/Nothing recorded yet/);
  });

  it('shows a no-match state with a clear-search remedy', async () => {
    mockFetch.mockResolvedValue(page([]));
    render(<ActivityLogScreen />);
    fireEvent.change(screen.getByTestId('activity-search'), { target: { value: 'Zebra' } });
    await screen.findByText(/Nothing in the record matches "Zebra"/, undefined, { timeout: 2000 });
    expect(screen.getByText('Clear search')).toBeTruthy();
  });
});

describe('doors', () => {
  it('Home feed foot door renders only with its handler and routes on click', () => {
    const onOpenFullLog = vi.fn();
    const { rerender } = render(<ActionFeed entries={[]} onOpenFullLog={onOpenFullLog} />);
    fireEvent.click(screen.getByTestId('action-feed-full-log'));
    expect(onOpenFullLog).toHaveBeenCalledTimes(1);
    rerender(<ActionFeed entries={[]} />);
    expect(screen.queryByTestId('action-feed-full-log')).toBeNull();
  });

  it('Profile door renders and routes on click', () => {
    const onOpen = vi.fn();
    render(<ActivityLogDoor onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('activity-log-door'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Activity Log')).toBeTruthy();
  });
});
