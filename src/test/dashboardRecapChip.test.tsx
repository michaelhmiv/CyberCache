/**
 * Device regression (2026-11-01, PR #249) — settlement-shape
 * discrimination, adapted to the dashboard-top redesign.
 *
 * The original bug: the Dashboard crashed on render — "Cannot read
 * properties of undefined (reading 'creditsAwarded')" — for any
 * player whose last offline settlement was a CRAFTING or EXTRACTION
 * one, because the Dashboard's "While You Were Away" reopen chip
 * read `.rewards.creditsAwarded` / `.items` unconditionally while
 * only the roaming shape carries those. PR #249 fixed the chip to
 * discriminate the three shapes.
 *
 * The dashboard-top redesign removed the chip entirely: the
 * recap's re-entry became the level pop-up, whose OfflineRecapCard
 * discriminates the shapes exactly as it always did. Wave C moved
 * the recap once more — it now presents as the Return Sheet
 * (DESIGN.md §10); the two-buttons package (2026-11-05) moved its
 * door once more, to the top bar's OFFLINE button, which opens
 * the sheet whenever a settlement exists (and claims the held
 * settlement on the same tap while one waits — nothing is held
 * in these harnesses, so the button is the sheet's quiet door);
 * the card inside is the same discriminating component. The
 * crash class is therefore guarded HERE now: these tests seed
 * each shape as a dismissed recap and render the real Dashboard
 * — no crash, no chip — then open the Return Sheet through the
 * OFFLINE button and read the variant's own truth from the card.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'user-1' } as { id: string } | null,
    account: null as import('@/auth/accountState').AccountState | null,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false as boolean,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    makeItem: vi.fn(),
    equipItem: vi.fn(async () => ({})),
    unequipSlot: vi.fn(async () => ({})),
    recycleItem: vi.fn(async () => ({ scrap_award: 10 })),
    itemLock: vi.fn(async () => ({})),
    trainSkill: vi.fn(async () => ({})),
    retrain: vi.fn(async () => ({})),
    claimCraftedConsumable: vi.fn(async () => ({})),
  },
  fetchProfileLifetime: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchCollections: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchRepairBoard: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchWorkshopState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/api/cacheLaneService', () => ({
  fetchCacheLane: vi.fn(async () => ({
    day: '2026-11-01', cap: 10, freePerDay: 1, openedToday: 0, remaining: 10,
    freeAvailable: true, keys: 3, byPayment: { free: 0, ad: 0, key: 0 },
    resetsAt: Date.now() + 3_600_000, rule: '',
  })),
}));

vi.mock('@/lib/ads/rewardedCacheAd', () => ({
  canUseRewardedCacheAds: () => false,
  showRewardedCacheAd: vi.fn(async () => { throw new Error('ads unavailable in tests'); }),
}));

vi.mock('@/components/pixelArt/LootMoment', async () => {
  const React = await import('react');
  return {
    LootMoment: ({ onDone }: { onDone: () => void }) =>
      React.createElement('button', { 'data-testid': 'loot-moment-stub', onClick: onDone }, 'moment'),
  };
});

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: IntersectionObserverCallback) {
  return {
    observe: (target: Element) => callback([{ isIntersecting: false, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: () => undefined,
    disconnect: () => undefined,
  };
}) as unknown as typeof IntersectionObserver;

import { HomeScreen } from '@/screens/HomeScreen';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import type { SettlementRecap } from '@/lib/activity/activitySettlement';

const roaming = {
  settled: true,
  areaId: 'dustwaste',
  areaName: 'Dustwaste Frontier',
  timeAway: '2h 5m',
  elapsedMs: 7_500_000,
  cappedMs: 7_500_000,
  capReached: false,
  capHours: 8,
  ticksSettled: 100,
  startTick: 0,
  endTick: 100,
  profile: {},
  rewards: {
    creditsAwarded: 1250,
    scrapAwarded: 40,
    xpAwarded: 300,
    cacheFragmentsAwarded: 1,
    materials: {},
    essences: {},
    killsRecorded: 12,
    ticks: 100,
  },
  items: [],
  feedEvents: [],
  idempotent: false,
} as unknown as SettlementRecap;

const crafting = {
  settled: true,
  crafting: {
    advancedMs: 7_500_000,
    xpAwarded: 175,
    jobsCompleted: 2,
    completions: [],
    capHours: 8,
  },
} as unknown as SettlementRecap;

const extraction = {
  settled: true,
  extraction: {
    advancedMs: 7_500_000,
    xpAwarded: 90,
    passesCompleted: 1,
    passes: [],
    materials: {},
    essences: {},
    capHours: 8,
  },
} as unknown as SettlementRecap;

describe('Dashboard recap — settlement-shape discrimination (Return Sheet)', () => {
  beforeEach(() => {
    useOfflineRecapStore.setState({ lastSettlement: null, dismissed: false });
  });
  afterEach(() => {
    cleanup();
    useOfflineRecapStore.setState({ lastSettlement: null, dismissed: false });
  });

  it('roaming settlement: no crash, no chip; the Return Sheet card shows the roaming recap', async () => {
    useOfflineRecapStore.setState({ lastSettlement: roaming, dismissed: true });
    render(<HomeScreen onNavigate={vi.fn()} />);
    expect(await screen.findByTestId('dashboard-top-bar')).toBeTruthy();
    expect(screen.queryByTestId('offline-recap-reopen')).toBeNull();
    fireEvent.click(screen.getByTestId('top-offline-button'));
    expect(await screen.findByText('While You Were Away')).toBeTruthy();
    // Scoped to the recap card: merged Home carries other "Credits"
    // labels now (the Strip chip, Hunter Totals rows).
    const card = screen.getByText('While You Were Away').closest('.bl-card') as HTMLElement;
    // Wave C Return Sheet form: "Credits" prints twice inside the
    // card BY DESIGN — once in the totals row (the headline) and
    // once in the itemized reward rows below it.
    expect(within(card).getByTestId('return-totals-row')).toBeTruthy();
    expect(within(card).getAllByText('Credits').length).toBeGreaterThanOrEqual(2);
    expect(within(card).getByText(/Away for/)).toBeTruthy();
  }, 30_000);

  it('crafting settlement: no crash; the Return Sheet card shows the crafting truth', async () => {
    useOfflineRecapStore.setState({ lastSettlement: crafting, dismissed: true });
    render(<HomeScreen onNavigate={vi.fn()} />);
    expect(await screen.findByTestId('dashboard-top-bar')).toBeTruthy();
    fireEvent.click(screen.getByTestId('top-offline-button'));
    expect(await screen.findByText('While You Were Away')).toBeTruthy();
    expect(screen.getByText('The benches kept working')).toBeTruthy();
    expect(screen.getByText(/2 jobs finished/)).toBeTruthy();
  }, 30_000);

  it('extraction settlement: no crash; the Return Sheet card shows the extraction truth', async () => {
    useOfflineRecapStore.setState({ lastSettlement: extraction, dismissed: true });
    render(<HomeScreen onNavigate={vi.fn()} />);
    expect(await screen.findByTestId('dashboard-top-bar')).toBeTruthy();
    fireEvent.click(screen.getByTestId('top-offline-button'));
    expect(await screen.findByText('While You Were Away')).toBeTruthy();
    expect(screen.getByText('The site kept producing')).toBeTruthy();
    expect(screen.getByText(/1 pass completed/)).toBeTruthy();
  }, 30_000);
});
