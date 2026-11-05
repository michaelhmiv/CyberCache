/**
 * Streak TRUE CLAIM — the client state machine (migration 0079,
 * owner decision 2026-11-04; server half pinned in
 * loginStreak.test.ts).
 *
 * The states the player walks, on the shipped surfaces (the
 * Strip's streak chip + the streak sheet), with real stores and
 * a mocked Chef transport:
 *
 *  - CLAIMABLE: today's day is recorded, the reward HELD —
 *    the chip carries the CLAIM badge, the sheet shows the
 *    reward face-up tagged TODAY (never Banked — nothing has
 *    landed), the amber CLAIM button is the sheet's one
 *    primary action, and the expiry rule is printed where
 *    the decision is made. The wallet does NOT tick: a held
 *    reward never animates money it hasn't reached.
 *  - POSTING: the claim is in flight — the button reads
 *    "Claiming…" and is disabled.
 *  - JUST CLAIMED: the landing — rows stamp Banked, the
 *    plate reads "Claimed just now"; acknowledging retires
 *    the celebration to the quiet banked sheet.
 *  - FAILED CLAIM: the reward stays claimable, the button
 *    stays live, the failure names its remedy.
 *  - EXPIRED: a claimable left over the 00:00 UTC rollover
 *    is simply gone — the next read returns the NEW day
 *    (streak continued on recorded days), its own reward
 *    claimable; yesterday's amounts are never payable.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  claimLoginStreakDay: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getContractsState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getStandingState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getCacheRankState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  claimContract: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  rerollContract: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/notifications/pushNotifications', () => ({
  checkPushPermission: vi.fn(async () => 'prompt'),
  requestPushNotifications: vi.fn(async () => true),
  syncPushRegistration: vi.fn(async () => {}),
}));

import { DashboardTopBar } from '@/components/dashboard/DashboardTopBar';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { claimLoginStreakDay, getLoginStreakState } from '@/lib/chef/chefClient';
import { usePlayerStore } from '@/store';
import { loginStreakClaimable, useLoginStreakStore } from '@/store/slices/loginStreakSlice';
import { useContractsStore } from '@/store/slices/contractsSlice';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { usePushPrimerStore } from '@/store/slices/pushPrimerSlice';

const mockStreak = vi.mocked(getLoginStreakState);
const mockClaim = vi.mocked(claimLoginStreakDay);

function Harness() {
  return (
    <div>
      <ResourceBar />
      <DashboardTopBar />
    </div>
  );
}

const LADDER = [
  { cycleDay: 1, credits: 100, fragments: 0, cacheKeys: 0, state: 'earned' },
  { cycleDay: 2, credits: 150, fragments: 0, cacheKeys: 0, state: 'earned' },
  { cycleDay: 3, credits: 200, fragments: 1, cacheKeys: 0, state: 'today' },
  { cycleDay: 4, credits: 250, fragments: 1, cacheKeys: 0, state: 'upcoming' },
  { cycleDay: 5, credits: 300, fragments: 2, cacheKeys: 0, state: 'upcoming' },
  { cycleDay: 6, credits: 400, fragments: 2, cacheKeys: 0, state: 'upcoming' },
  { cycleDay: 7, credits: 500, fragments: 3, cacheKeys: 1, state: 'upcoming' },
];

const MISS_RULE = 'Miss a day and the streak restarts at Day 1 — your longest streak is kept on your profile.';

/** Day 3 recorded, reward HELD (0079): 200 credits + 1 fragment wait on the claim. */
function claimableDay3() {
  return {
    verified: true,
    loginStreak: {
      currentStreak: 3,
      longestStreak: 5,
      tier: 1,
      cycleDay: 3,
      todayState: 'earned',
      todayClaimable: true,
      todayReward: { credits: 200, fragments: 1, cacheKeys: 0 },
      nextReward: { credits: 250, fragments: 1, cacheKeys: 0 },
      nextStreakLength: 4,
      ladder: LADDER,
      missRule: MISS_RULE,
    },
    granted: {
      alreadyClaimed: true, // the record exists (this is a re-read); it is the paid stamp that matters
      claimable: true,
      streakLength: 3,
      cycleDay: 3,
      tier: 1,
      creditsAwarded: 200,
      fragmentsAwarded: 1,
      cacheKeysAwarded: 0,
    },
    profile: null,
  } as never;
}

/** Day 3 after the claim landed: same amounts, no longer claimable. */
function claimedDay3() {
  return {
    verified: true,
    loginStreak: {
      currentStreak: 3,
      longestStreak: 5,
      tier: 1,
      cycleDay: 3,
      todayState: 'earned',
      todayClaimable: false,
      todayReward: { credits: 200, fragments: 1, cacheKeys: 0 },
      nextReward: { credits: 250, fragments: 1, cacheKeys: 0 },
      nextStreakLength: 4,
      ladder: LADDER,
      missRule: MISS_RULE,
    },
    granted: {
      alreadyClaimed: false,
      claimable: false,
      streakLength: 3,
      cycleDay: 3,
      tier: 1,
      creditsAwarded: 200,
      fragmentsAwarded: 1,
      cacheKeysAwarded: 0,
    },
    profile: null,
  } as never;
}

/** The next UTC day: day 3's reward expired unclaimed; the streak
 *  continued on the recorded day and day 4's reward is claimable. */
function claimableDay4() {
  return {
    verified: true,
    loginStreak: {
      currentStreak: 4,
      longestStreak: 5,
      tier: 1,
      cycleDay: 4,
      todayState: 'earned',
      todayClaimable: true,
      todayReward: { credits: 250, fragments: 1, cacheKeys: 0 },
      nextReward: { credits: 300, fragments: 2, cacheKeys: 0 },
      nextStreakLength: 5,
      ladder: LADDER.map((d) => ({
        ...d,
        state: d.cycleDay < 4 ? 'earned' : d.cycleDay === 4 ? 'today' : 'upcoming',
      })),
      missRule: MISS_RULE,
    },
    granted: {
      alreadyClaimed: false,
      claimable: true,
      streakLength: 4,
      cycleDay: 4,
      tier: 1,
      creditsAwarded: 250,
      fragmentsAwarded: 1,
      cacheKeysAwarded: 0,
    },
    profile: null,
  } as never;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  mockStreak.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
  mockClaim.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
  useLoginStreakStore.getState().reset();
  useContractsStore.getState().reset();
  useOfflineRecapStore.getState().reset();
  usePushPrimerStore.getState().reset();
  usePlayerStore.setState({ level: 5, xp: 0, credits: 5600, profileLoaded: true });
});

afterEach(() => {
  cleanup();
});

async function openStreakSheet() {
  fireEvent.click(screen.getByTestId('top-streak-button'));
  expect(await screen.findByTestId('picker-sheet-overlay')).toBeTruthy();
  return screen.findByTestId('streak-panel');
}

describe('Streak true claim — claimable', () => {
  it('chip carries CLAIM, sheet shows the reward face-up with the CLAIM button and the expiry rule', async () => {
    mockStreak.mockResolvedValue(claimableDay3());
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));

    // The Home chip is a real claimable now: pulse + CLAIM badge.
    expect(screen.getByTestId('streak-claim-pulse')).toBeTruthy();
    expect(screen.getByTestId('top-streak-button').textContent).toContain('CLAIM');
    expect(loginStreakClaimable(useLoginStreakStore.getState().result)).toBe(true);

    const panel = await openStreakSheet();
    expect(panel.textContent).toContain('Day 3');
    expect(screen.getByText('Ready to claim')).toBeTruthy();
    // Face-up rows: the amounts, tagged TODAY — never Banked.
    const rows = screen.getByTestId('streak-claim-rows');
    expect(rows.textContent).toContain('+200');
    expect(rows.textContent).toContain('Credits');
    expect(rows.textContent).toContain('+1');
    expect(rows.textContent).not.toContain('Banked');
    // The one primary action, and the honest expiry terms.
    expect(screen.getByTestId('streak-claim-button').textContent).toContain('Claim Day 3 reward');
    expect(screen.getByTestId('streak-later-button')).toBeTruthy();
    expect(panel.textContent).toContain('Unclaimed rewards expire when the new streak day starts at 00:00 UTC.');
    // The acknowledgement CTA of the auto-grant era is absent:
    // there is an act to take, not just news to acknowledge.
    expect(screen.queryByTestId('streak-done-button')).toBeNull();
  });

  it('a held reward never ticks the wallet', async () => {
    mockStreak.mockResolvedValue(claimableDay3());
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));
    // Give any (mis)fired tick ample time to land, then check the
    // Strip still shows the untouched balance and no grant key
    // was ever marked ticked.
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); });
    expect(useLoginStreakStore.getState().tickedGrantKey).toBeNull();
    expect(usePlayerStore.getState().credits).toBe(5600);
  });
});

describe('Streak true claim — posting → landing → banked', () => {
  it('claim posts, lands with the celebration, and acknowledge retires it to the quiet sheet', async () => {
    mockStreak.mockResolvedValue(claimableDay3());
    let resolveClaim: (v: never) => void = () => {};
    mockClaim.mockImplementation(() => new Promise<never>((res) => { resolveClaim = res; }));
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));
    await openStreakSheet();

    fireEvent.click(screen.getByTestId('streak-claim-button'));
    // POSTING: the button names the in-flight act and locks.
    await waitFor(() => expect(screen.getByTestId('streak-claim-button').textContent).toContain('Claiming…'));
    expect((screen.getByTestId('streak-claim-button') as HTMLButtonElement).disabled).toBe(true);
    expect(mockClaim).toHaveBeenCalledTimes(1);

    await act(async () => { resolveClaim(claimedDay3()); });
    // LANDING: the celebration plays at the moment it describes.
    await waitFor(() => expect(screen.getByText('Claimed just now')).toBeTruthy());
    const rows = screen.getByTestId('streak-reward-rows');
    expect(rows.textContent).toContain('+200');
    expect(screen.getAllByText('Banked').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('streak-claim-button')).toBeNull();
    // The chip's claimable signal dies with the payment — and
    // the legacy NEW announcement does not re-fire for money
    // the player just took by hand (the prototype's claimed
    // frame wears a plain chip); the sheet's subtitle speaks
    // of the claim, never of an arrival.
    expect(screen.queryByTestId('streak-claim-pulse')).toBeNull();
    expect(screen.getByTestId('top-streak-button').textContent).not.toContain('NEW');
    expect(screen.getByText(/Daily check-in · Day 3 claimed just now/)).toBeTruthy();

    // Acknowledge → reopen → the quiet banked sheet.
    fireEvent.click(screen.getByTestId('streak-done-button'));
    await openStreakSheet();
    await waitFor(() => expect(screen.queryByText('Claimed just now')).toBeNull());
    expect(screen.queryByTestId('streak-claim-button')).toBeNull();
  });

  it('a failed claim keeps the reward claimable, the button live, and names the remedy', async () => {
    mockStreak.mockResolvedValue(claimableDay3());
    mockClaim.mockRejectedValue(new Error('chef unreachable'));
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));
    await openStreakSheet();

    fireEvent.click(screen.getByTestId('streak-claim-button'));
    await waitFor(() => expect(screen.getByText(/didn't go through/)).toBeTruthy());
    const button = screen.getByTestId('streak-claim-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(useLoginStreakStore.getState().claimError).toBe(true);
    expect(loginStreakClaimable(useLoginStreakStore.getState().result)).toBe(true);
  });

  it('claim() is a no-op when nothing is claimable', async () => {
    mockStreak.mockResolvedValue(claimedDay3());
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));
    await act(async () => { await useLoginStreakStore.getState().claim(); });
    expect(mockClaim).not.toHaveBeenCalled();
  });
});

describe('Streak true claim — expiry across the rollover', () => {
  it('yesterday’s unclaimed reward is gone; the streak continued and today’s reward is the claimable one', async () => {
    mockStreak.mockResolvedValue(claimableDay3());
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));
    await openStreakSheet();
    expect(screen.getByTestId('streak-claim-button').textContent).toContain('Claim Day 3 reward');

    // The day rolls: revalidation (D3) only refetches when the
    // held result's day is behind the client day, so age the
    // held result — then the store's re-read returns day 4.
    // Day 3's 200 credits are nowhere in it, and the recorded
    // day still counted (streak 4, not a restart).
    mockStreak.mockResolvedValue(claimableDay4());
    useLoginStreakStore.setState({ resultDay: '2020-01-01' });
    await act(async () => { await useLoginStreakStore.getState().revalidate(); });
    const state = useLoginStreakStore.getState();
    expect(state.result?.loginStreak.currentStreak).toBe(4);
    expect(state.result?.granted.creditsAwarded).toBe(250);
    expect(loginStreakClaimable(state.result)).toBe(true);

    // Claiming now pays DAY 4's reward — the expired day-3
    // amounts can never be what lands.
    mockClaim.mockResolvedValue({
      ...(claimableDay4() as unknown as Record<string, unknown>),
      granted: {
        alreadyClaimed: false, claimable: false, streakLength: 4, cycleDay: 4, tier: 1,
        creditsAwarded: 250, fragmentsAwarded: 1, cacheKeysAwarded: 0,
      },
    } as never);
    await act(async () => { await useLoginStreakStore.getState().claim(); });
    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(useLoginStreakStore.getState().result?.granted.creditsAwarded).toBe(250);
    expect(loginStreakClaimable(useLoginStreakStore.getState().result)).toBe(false);
  });
});
