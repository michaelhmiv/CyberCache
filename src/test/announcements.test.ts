/**
 * Announcements store (eye-leading pass, 2026-11-04) — the shared
 * mechanism for orphan earning events: market sale proceeds (the
 * Sold chip) and bench completions (the bench-ready chip).
 *
 * The pins that matter:
 *  - Chip math is the Chef's settlement, not a re-derivation: the
 *    proven proceeds the accept rows stamped (price − fee + any
 *    Silver Tongue uplift) win; the fallback is price − fee, with
 *    the base fee being floor(price × 5%) per migration 0017/0064.
 *  - The first sales read is a silent baseline — opening the app
 *    never replays a backlog of old sales as news.
 *  - Sales aggregate into one chip and never double-count across
 *    re-checks; acknowledging (or opening Sell → History) advances
 *    the watermark so they never re-announce.
 *  - A bench completion announces only when it is news (the job
 *    was seen active this session, or it completed inside the
 *    freshness window) and NEVER while the bench itself is in
 *    view — and an in-view completion is absorbed, not deferred.
 *  - The claim row shows one chip at a time: Sold before bench.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/activityLogService', () => ({
  fetchActivityLog: vi.fn(),
}));

import { fetchActivityLog, type ActivityRecord } from '@/lib/api/activityLogService';
import {
  __resetAnnouncementsForTests,
  soldProceeds,
  useAnnouncementsStore,
  visibleAnnouncement,
  type WorkshopViewObservation,
} from '@/store/slices/announcementsSlice';

const fetchMock = vi.mocked(fetchActivityLog);

const T1 = '2026-11-04T10:00:00.000Z';
const T2 = '2026-11-04T11:00:00.000Z';
const T3 = '2026-11-04T12:00:00.000Z';

function soldRecord(over: {
  id: string;
  at: string;
  name?: string;
  priceCredits: number;
  feeCredits?: number | null;
  proceedsCredits?: number | null;
}): ActivityRecord {
  return {
    id: over.id,
    kind: 'market',
    at: over.at,
    away: false,
    label: 'Sold',
    item: { id: `item-${over.id}`, name: over.name ?? 'Sold Rifle', kind: 'weapon', rarity: 'Rare', level: 18 },
    market: {
      direction: 'sold',
      priceCredits: over.priceCredits,
      feeCredits: over.feeCredits === undefined ? null : over.feeCredits,
      proceedsCredits: over.proceedsCredits === undefined ? null : over.proceedsCredits,
      counterpartyId: null,
      counterpartyName: null,
      listingId: `listing-${over.id}`,
    },
  } as ActivityRecord;
}

function boughtRecord(id: string, at: string): ActivityRecord {
  return {
    id,
    kind: 'market',
    at,
    away: false,
    label: 'Bought',
    market: {
      direction: 'bought',
      priceCredits: 500,
      feeCredits: null,
      counterpartyId: null,
      counterpartyName: null,
      listingId: `listing-${id}`,
    },
  } as ActivityRecord;
}

function page(records: ActivityRecord[]) {
  return { records, nextCursor: null, limit: 25 };
}

function store() {
  return useAnnouncementsStore.getState();
}

beforeEach(() => {
  __resetAnnouncementsForTests();
  useAnnouncementsStore.setState({ sold: null, bench: null, benchInView: false });
  localStorage.clear();
  fetchMock.mockReset();
});

describe('soldProceeds — the chip shows what the Chef credited', () => {
  it('the proven proceeds win, including a Silver Tongue uplift above price − fee', () => {
    // price 7500, fee 375 → price − fee = 7125; the accept rows
    // prove the seller was actually credited 7300 (uplift +175).
    const rec = soldRecord({ id: 'a', at: T1, priceCredits: 7500, feeCredits: 375, proceedsCredits: 7300 });
    expect(soldProceeds(rec)).toBe(7300);
  });

  it('fallback is price − fee, and the base fee is exactly 5% of price (floor)', () => {
    // Migration 0017/0064: fee_credits = floor(price × 0.05 × (1 − reduction)).
    const fee = Math.floor(7500 * 0.05);
    expect(fee).toBe(375);
    const rec = soldRecord({ id: 'a', at: T1, priceCredits: 7500, feeCredits: fee, proceedsCredits: null });
    expect(soldProceeds(rec)).toBe(7125);
  });

  it('a skill-reduced fee still nets price − fee (never recomputed client-side)', () => {
    // 20% fee reduction on 10000: fee = floor(10000 × 0.05 × 0.8) = 400.
    const rec = soldRecord({ id: 'a', at: T1, priceCredits: 10000, feeCredits: 400, proceedsCredits: null });
    expect(soldProceeds(rec)).toBe(9600);
  });

  it('an unproven fee (pre-fee era shape) credits at full price', () => {
    const rec = soldRecord({ id: 'a', at: T1, priceCredits: 2000, feeCredits: null, proceedsCredits: null });
    expect(soldProceeds(rec)).toBe(2000);
  });

  it('a record with no market block contributes nothing', () => {
    const rec = { id: 'x', kind: 'drop', at: T1, away: false, label: '' } as ActivityRecord;
    expect(soldProceeds(rec)).toBe(0);
  });
});

describe('visibleAnnouncement — one chip, owner order', () => {
  it('Sold shows before bench-ready; empty state shows nothing', () => {
    const sold = { count: 1, totalProceeds: 100, itemName: 'Rifle' };
    const bench = { count: 1, latestName: 'Med Kit' };
    expect(visibleAnnouncement({ sold, bench })).toBe('sold');
    expect(visibleAnnouncement({ sold: null, bench })).toBe('bench');
    expect(visibleAnnouncement({ sold: null, bench: null })).toBeNull();
  });
});

describe('checkSales — watermark, baseline, aggregation', () => {
  it('the first read ever is a silent baseline: no backlog replay', async () => {
    fetchMock.mockResolvedValue(page([
      soldRecord({ id: 'old', at: T1, priceCredits: 7500, feeCredits: 375, proceedsCredits: 7125 }),
    ]));
    await store().checkSales();
    expect(store().sold).toBeNull();
    expect(localStorage.getItem('cybercache.salesSeen.v1')).toContain(T1);
  });

  it('a sale newer than the watermark announces with its proven proceeds and name', async () => {
    fetchMock.mockResolvedValue(page([
      soldRecord({ id: 'a', at: T1, priceCredits: 1000, feeCredits: 50, proceedsCredits: 950 }),
    ]));
    await store().checkSales(); // baseline
    fetchMock.mockResolvedValue(page([
      soldRecord({ id: 'b', at: T2, name: 'Ember Pistol', priceCredits: 7500, feeCredits: 375, proceedsCredits: 7125 }),
      soldRecord({ id: 'a', at: T1, priceCredits: 1000, feeCredits: 50, proceedsCredits: 950 }),
    ]));
    await store().checkSales();
    expect(store().sold).toEqual({ count: 1, totalProceeds: 7125, itemName: 'Ember Pistol' });
  });

  it('further sales fold into the pending chip; the single-item name drops when aggregated', async () => {
    fetchMock.mockResolvedValue(page([soldRecord({ id: 'a', at: T1, priceCredits: 100, feeCredits: 5, proceedsCredits: 95 })]));
    await store().checkSales(); // baseline
    fetchMock.mockResolvedValue(page([
      soldRecord({ id: 'b', at: T2, priceCredits: 1000, feeCredits: 50, proceedsCredits: 950 }),
      soldRecord({ id: 'a', at: T1, priceCredits: 100, feeCredits: 5, proceedsCredits: 95 }),
    ]));
    await store().checkSales();
    fetchMock.mockResolvedValue(page([
      soldRecord({ id: 'c', at: T3, priceCredits: 2000, feeCredits: 100, proceedsCredits: 1900 }),
      soldRecord({ id: 'b', at: T2, priceCredits: 1000, feeCredits: 50, proceedsCredits: 950 }),
      soldRecord({ id: 'a', at: T1, priceCredits: 100, feeCredits: 5, proceedsCredits: 95 }),
    ]));
    await store().checkSales();
    expect(store().sold).toEqual({ count: 2, totalProceeds: 2850, itemName: null });
  });

  it('re-checking the same page never double-counts a sale', async () => {
    fetchMock.mockResolvedValue(page([soldRecord({ id: 'a', at: T1, priceCredits: 100, feeCredits: 5, proceedsCredits: 95 })]));
    await store().checkSales(); // baseline
    const p = page([
      soldRecord({ id: 'b', at: T2, priceCredits: 1000, feeCredits: 50, proceedsCredits: 950 }),
      soldRecord({ id: 'a', at: T1, priceCredits: 100, feeCredits: 5, proceedsCredits: 95 }),
    ]);
    fetchMock.mockResolvedValue(p);
    await store().checkSales();
    await store().checkSales();
    expect(store().sold).toEqual({ count: 1, totalProceeds: 950, itemName: 'Sold Rifle' });
  });

  it('bought records never announce as sales', async () => {
    fetchMock.mockResolvedValue(page([boughtRecord('seed', T1)]));
    await store().checkSales(); // baseline (no sales on the page)
    fetchMock.mockResolvedValue(page([boughtRecord('buy1', T2)]));
    await store().checkSales();
    expect(store().sold).toBeNull();
  });

  it('a failed read is silent — no chip, no throw, no watermark damage', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await store().checkSales();
    expect(store().sold).toBeNull();
    expect(localStorage.getItem('cybercache.salesSeen.v1')).toBeNull();
  });

  it('acknowledging clears the chip and the sales never re-announce', async () => {
    fetchMock.mockResolvedValue(page([soldRecord({ id: 'a', at: T1, priceCredits: 100, feeCredits: 5, proceedsCredits: 95 })]));
    await store().checkSales(); // baseline
    const p = page([
      soldRecord({ id: 'b', at: T2, priceCredits: 1000, feeCredits: 50, proceedsCredits: 950 }),
      soldRecord({ id: 'a', at: T1, priceCredits: 100, feeCredits: 5, proceedsCredits: 95 }),
    ]);
    fetchMock.mockResolvedValue(p);
    await store().checkSales();
    expect(store().sold).not.toBeNull();
    store().acknowledgeSold();
    // markSalesSeen re-reads asynchronously; let it settle.
    await vi.waitFor(() => expect(store().sold).toBeNull());
    await store().checkSales();
    expect(store().sold).toBeNull();
  });

  it('markSalesSeen (the player opened Sell → History) clears a pending chip', async () => {
    fetchMock.mockResolvedValue(page([soldRecord({ id: 'a', at: T1, priceCredits: 100, feeCredits: 5, proceedsCredits: 95 })]));
    await store().checkSales(); // baseline
    fetchMock.mockResolvedValue(page([
      soldRecord({ id: 'b', at: T2, priceCredits: 1000, feeCredits: 50, proceedsCredits: 950 }),
      soldRecord({ id: 'a', at: T1, priceCredits: 100, feeCredits: 5, proceedsCredits: 95 }),
    ]));
    await store().checkSales();
    expect(store().sold).not.toBeNull();
    await store().markSalesSeen();
    expect(store().sold).toBeNull();
  });
});

describe('observeWorkshop — bench-ready news and the in-view suppression', () => {
  const NOW = Date.parse('2026-11-04T12:00:00.000Z');

  function view(over: Partial<WorkshopViewObservation>): WorkshopViewObservation {
    return { jobs: [], ...over };
  }

  it('a job seen running that completes announces once, by name', () => {
    store().observeWorkshop(view({ jobs: [{ id: 'j1', name: 'Med Kit', state: 'running', completedAtMs: null }] }), NOW);
    expect(store().bench).toBeNull();
    store().observeWorkshop(view({ jobs: [{ id: 'j1', name: 'Med Kit', state: 'complete', completedAtMs: NOW }] }), NOW);
    expect(store().bench).toEqual({ count: 1, latestName: 'Med Kit' });
    // The same view landing again does not re-announce.
    store().observeWorkshop(view({ jobs: [{ id: 'j1', name: 'Med Kit', state: 'complete', completedAtMs: NOW }] }), NOW);
    expect(store().bench).toEqual({ count: 1, latestName: 'Med Kit' });
  });

  it('SUPPRESSION: a completion landing while the bench is in view never chips — and is absorbed, not deferred', () => {
    store().setBenchInView(true);
    store().observeWorkshop(view({ jobs: [{ id: 'j1', name: 'Med Kit', state: 'running', completedAtMs: null }] }), NOW);
    store().observeWorkshop(view({ jobs: [{ id: 'j1', name: 'Med Kit', state: 'complete', completedAtMs: NOW }] }), NOW);
    expect(store().bench).toBeNull();
    store().setBenchInView(false);
    store().observeWorkshop(view({ jobs: [{ id: 'j1', name: 'Med Kit', state: 'complete', completedAtMs: NOW }] }), NOW);
    expect(store().bench).toBeNull();
  });

  it('a stale completion never seen active is history, not news', () => {
    store().observeWorkshop(
      view({ jobs: [{ id: 'j1', name: 'Old Job', state: 'complete', completedAtMs: NOW - 11 * 60 * 1000 }] }),
      NOW,
    );
    expect(store().bench).toBeNull();
  });

  it('a fresh completion (inside the 10-minute window) announces even if never seen active', () => {
    store().observeWorkshop(
      view({ jobs: [{ id: 'j1', name: 'Quick Job', state: 'complete', completedAtMs: NOW - 60 * 1000 }] }),
      NOW,
    );
    expect(store().bench).toEqual({ count: 1, latestName: 'Quick Job' });
  });

  it('recentCompletions announce only for jobs seen active this session', () => {
    store().observeWorkshop(view({ jobs: [{ id: 'j1', name: 'Med Kit', state: 'running', completedAtMs: null }] }), NOW);
    store().observeWorkshop(view({ jobs: [], recentCompletions: [{ jobId: 'j1', name: 'Med Kit' }] }), NOW);
    expect(store().bench).toEqual({ count: 1, latestName: 'Med Kit' });
    store().acknowledgeBench();
    // An unseen job's recent completion is not news.
    store().observeWorkshop(view({ jobs: [], recentCompletions: [{ jobId: 'jX', name: 'Ghost' }] }), NOW);
    expect(store().bench).toBeNull();
  });

  it('multiple completions aggregate; acknowledging clears the chip', () => {
    store().observeWorkshop(view({
      jobs: [
        { id: 'j1', name: 'Med Kit', state: 'running', completedAtMs: null },
        { id: 'j2', name: 'Ammo Pack', state: 'queued', completedAtMs: null },
      ],
    }), NOW);
    store().observeWorkshop(view({
      jobs: [
        { id: 'j1', name: 'Med Kit', state: 'complete', completedAtMs: NOW },
        { id: 'j2', name: 'Ammo Pack', state: 'complete', completedAtMs: NOW },
      ],
    }), NOW);
    expect(store().bench).toEqual({ count: 2, latestName: 'Ammo Pack' });
    store().acknowledgeBench();
    expect(store().bench).toBeNull();
  });
});
