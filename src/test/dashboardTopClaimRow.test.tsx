/**
 * Claim-row fit regression (2026-11-05, PR #400 fallout).
 *
 * The defect, measured on the shipped build at 412px (evidence:
 * cybercache-prep/home-buttons-captures): in the fresh-guest
 * state the streak pill's CLAIM reservation (~129px, shrink-0)
 * and the contracts pill's GUEST reservation (~146px, shrink-0)
 * left ~98px of the 386px row for the CACHE + OFFLINE pair —
 * each button rendered ~46px wide, the labels clipped to
 * "CA"/"O", and the CACHE key bubble (the key count's ONLY
 * print on Home) sat entirely outside its button's box, clipped
 * by its own overflow-hidden. jsdom has no layout engine, so
 * this suite pins the STRUCTURE that guarantees the fit at
 * 412px in every badge combination (DESIGN.md §6: adapt the
 * host, never shrink the type):
 *
 *  - the row wraps (`flex-wrap`) instead of crushing the pair;
 *  - the pair group carries a min-width floor sized from its
 *    own content (202px quiet; 328px while a hold is pending),
 *    so badge reservations push the pills to a second line at
 *    full size rather than starving the pair;
 *  - CACHE/OFFLINE carry per-button floors (104px; 90px quiet /
 *    216px pending for OFFLINE) and never `min-w-0`.
 *
 * On the pre-fix code every one of these assertions fails.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'user-1' } as { id: string } | null,
    account: null as unknown,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false as boolean,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getContractsState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getStandingState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getCacheRankState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  claimContract: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  rerollContract: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  claimOffline: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/notifications/pushNotifications', () => ({
  checkPushPermission: vi.fn(async () => 'prompt'),
  requestPushNotifications: vi.fn(async () => true),
  syncPushRegistration: vi.fn(async () => {}),
}));

import { HomeScreen } from '@/screens/HomeScreen';
import { getContractsState, getLoginStreakState, getStandingState } from '@/lib/chef/chefClient';
import { usePlayerStore } from '@/store';
import { useLoginStreakStore } from '@/store/slices/loginStreakSlice';
import { useContractsStore } from '@/store/slices/contractsSlice';
import { useStandingStore } from '@/store/slices/standingSlice';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { usePushPrimerStore } from '@/store/slices/pushPrimerSlice';
import { buildStandingStateView } from '@/content/manufacturerStanding';
import { Manufacturer } from '@/types/game';
import { xpToNextLevel } from '@/content/simulation';

const mockStreak = vi.mocked(getLoginStreakState);
const mockContracts = vi.mocked(getContractsState);
const mockStanding = vi.mocked(getStandingState);

/** The 0079 true-claim state: today's reward is recorded but
 *  unpaid — the streak pill carries pulse + CLAIM + pr-16. */
function streakClaimableResult() {
  return {
    verified: true,
    loginStreak: {
      currentStreak: 1,
      longestStreak: 1,
      tier: 1,
      cycleDay: 1,
      todayState: 'earned',
      todayReward: { credits: 100, fragments: 0, cacheKeys: 0 },
      nextReward: { credits: 150, fragments: 1, cacheKeys: 0 },
      nextStreakLength: 2,
      ladder: [
        { cycleDay: 1, credits: 100, fragments: 0, cacheKeys: 0, state: 'today' },
        { cycleDay: 2, credits: 150, fragments: 1, cacheKeys: 0, state: 'upcoming' },
      ],
      missRule: 'Miss a day and the streak restarts at Day 1.',
    },
    granted: {
      alreadyClaimed: false,
      claimable: true,
      streakLength: 1,
      cycleDay: 1,
      tier: 1,
      creditsAwarded: 0,
      fragmentsAwarded: 0,
      cacheKeysAwarded: 0,
    },
    profile: null,
  } as never;
}

/** A paid day: no badge, no reservation on the streak pill. */
function streakPaidResult() {
  return {
    verified: true,
    loginStreak: {
      currentStreak: 3,
      longestStreak: 5,
      tier: 1,
      cycleDay: 3,
      todayState: 'earned',
      todayReward: { credits: 200, fragments: 1, cacheKeys: 0 },
      nextReward: { credits: 250, fragments: 1, cacheKeys: 0 },
      nextStreakLength: 4,
      ladder: [],
      missRule: 'Miss a day and the streak restarts at Day 1.',
    },
    granted: {
      alreadyClaimed: true,
      streakLength: null,
      cycleDay: 3,
      tier: 1,
      creditsAwarded: 0,
      fragmentsAwarded: 0,
      cacheKeysAwarded: 0,
    },
    profile: null,
  } as never;
}

function contractView(id: string, complete: boolean) {
  return {
    id,
    slot: 0,
    templateId: 'salvage_run',
    title: 'Breakdown: salvage 6 items',
    family: 'breakdown',
    target: 6,
    progress: complete ? 6 : 2,
    complete,
    status: 'active',
    reward: { credits: 220, fragments: 1, parts: [] },
    progressLine: complete ? 'Salvages 6 / 6' : 'Salvages 2 / 6',
    claimByLabel: 'claim by 00:00 UTC',
  };
}

function boardResult(canClaim: boolean, dailyContracts: unknown[]) {
  const setView = {
    periodKind: 'daily',
    periodKey: '2026-11-05',
    band: 'rookie',
    contracts: dailyContracts,
    claimedCount: 0,
    setSize: dailyContracts.length,
    setBonus: { credits: 300, fragments: 2, cacheKeys: 1, earned: false },
    setBonusLine: 'Full set: +300 cr + 2 fragments + 1 key',
    freeRerollAvailable: true,
    rerollCostScrap: 25,
  };
  return {
    verified: true,
    contracts: {
      canClaim,
      daily: setView,
      weekly: { ...setView, periodKind: 'weekly', periodKey: '2026-11-03', contracts: [] },
    },
    profile: null,
  } as never;
}

/** One weekly Parts Crate claimable at the Rep Desk (a rank-4
 *  maker whose crate is unbought) — the weekly pill renders. */
function standingWithWeeklyClaimable() {
  const view = buildStandingStateView({
    accountType: 'member',
    canUsePlayerEconomy: true,
    credits: 5000,
    playerLevel: 5,
    rows: [{ manufacturer: Manufacturer.Redline, standing: 400, rank: 4 }],
    weeklyPurchases: [],
  });
  return { verified: true, standing: view, profile: null } as never;
}

function pairGroup() {
  return screen.getByTestId('top-cache-button').parentElement as HTMLElement;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  mockStreak.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
  mockContracts.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
  mockStanding.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
  useLoginStreakStore.getState().reset();
  useContractsStore.getState().reset();
  useStandingStore.getState().reset();
  useOfflineRecapStore.getState().reset();
  usePushPrimerStore.getState().reset();
  const needed = xpToNextLevel(5);
  usePlayerStore.setState({ level: 5, xp: Math.floor(needed / 2), profileLoaded: true });
});

afterEach(() => {
  cleanup();
});

describe('Claim row fit — the pair can never be crushed (DESIGN.md §6)', () => {
  it('fresh-guest state (streak CLAIM + contracts GUEST): the row wraps and the pair keeps its floor', { timeout: 20_000 }, async () => {
    mockStreak.mockResolvedValue(streakClaimableResult());
    mockContracts.mockResolvedValue(boardResult(false, [contractView('c-1', true)]));
    render(<HomeScreen onNavigate={() => {}} />);

    const row = await screen.findByTestId('dashboard-top-bar');
    await waitFor(() => {
      expect(screen.getByTestId('top-streak-button').textContent).toContain('CLAIM');
    });
    expect(screen.getByTestId('top-contracts-button').textContent).toContain('GUEST');

    // The host adapts: the row wraps…
    expect(row.className).toContain('flex-wrap');
    // …and the pair group floors at the width its own content
    // needs, so the badge reservations (~275px of the 386px
    // row) push the pills to a second line instead of starving
    // CACHE/OFFLINE to ~46px each.
    expect(pairGroup().className).toContain('min-w-[202px]');
    expect(pairGroup().className).not.toContain('min-w-0');

    // Per-button floors: CACHE fits icon + label + the key
    // bubble inside its own box; OFFLINE fits its quiet label.
    const cacheButton = screen.getByTestId('top-cache-button');
    const offlineButton = screen.getByTestId('top-offline-button');
    expect(cacheButton.className).toContain('min-w-[104px]');
    expect(cacheButton.className).not.toContain('min-w-0');
    expect(offlineButton.className).toContain('min-w-[90px]');
    expect(offlineButton.className).not.toContain('min-w-0');

    // The bubble — the key count's only print on Home — is a
    // real child of the CACHE button with the true count.
    expect(cacheButton.contains(screen.getByTestId('top-cache-key-count'))).toBe(true);
    expect(screen.getByTestId('top-cache-key-count').textContent).toBe('3');
    // Labels print whole in the DOM the layout now protects.
    expect(cacheButton.textContent).toContain('Cache');
    expect(offlineButton.textContent).toContain('Offline');
  });

  it('both badges + the weekly pill: all five controls render, structure unchanged', { timeout: 20_000 }, async () => {
    mockStreak.mockResolvedValue(streakClaimableResult());
    mockContracts.mockResolvedValue(boardResult(false, [contractView('c-1', true)]));
    mockStanding.mockResolvedValue(standingWithWeeklyClaimable());
    render(<HomeScreen onNavigate={() => {}} />);

    const weekly = await screen.findByTestId('top-weekly-button');
    expect(weekly.textContent).toContain('Weekly');
    const row = screen.getByTestId('dashboard-top-bar');
    expect(row.className).toContain('flex-wrap');
    expect(pairGroup().className).toContain('min-w-[202px]');
    for (const id of ['top-cache-button', 'top-offline-button', 'top-streak-button', 'top-contracts-button']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('no badges (paid streak, idle contracts): one-line state keeps the same floors', { timeout: 20_000 }, async () => {
    mockStreak.mockResolvedValue(streakPaidResult());
    mockContracts.mockResolvedValue(boardResult(true, [contractView('c-1', false)]));
    render(<HomeScreen onNavigate={() => {}} />);

    await screen.findByTestId('dashboard-top-bar');
    await waitFor(() => {
      expect(screen.getByTestId('top-streak-button').textContent).toContain('Day 3');
    });
    const row = screen.getByTestId('dashboard-top-bar');
    expect(row.textContent).not.toContain('CLAIM');
    expect(row.textContent).not.toContain('GUEST');
    // The floors are structural, not state-dependent: the quiet
    // state fits on one line BECAUSE the natural widths sum
    // under the row, not because anything shrank.
    expect(row.className).toContain('flex-wrap');
    expect(pairGroup().className).toContain('min-w-[202px]');
    expect(screen.queryByTestId('top-weekly-button')).toBeNull();
  });

  it('a pending hold widens the pair floor: OFFLINE fits its CLAIM badge + figure', { timeout: 20_000 }, async () => {
    mockStreak.mockResolvedValue(streakClaimableResult());
    mockContracts.mockResolvedValue(boardResult(false, [contractView('c-1', true)]));
    usePlayerStore.setState({
      offlineHold: {
        credits: 4321, scrap: 87, xp: 640, cacheKeys: 0, kills: 12, ticks: 120,
        materials: {}, essences: {}, itemCount: 0, elapsedMs: 7_500_000, areaId: 'dustwaste',
      },
    });
    render(<HomeScreen onNavigate={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('offline-pending-pulse')).toBeTruthy());
    const offlineButton = screen.getByTestId('top-offline-button');
    expect(offlineButton.textContent).toContain('CLAIM');
    expect(screen.getByTestId('top-offline-pending').textContent).toContain('4,321');
    // Pending content is wider (badge corner pr-16 + the held
    // figure), so the floors widen with it: the pair can only
    // sit on a line of its own, at full width.
    expect(pairGroup().className).toContain('min-w-[328px]');
    expect(offlineButton.className).toContain('min-w-[216px]');
    expect(offlineButton.className).toContain('pr-16');
    expect(screen.getByTestId('top-cache-button').className).toContain('min-w-[104px]');
  });
});
