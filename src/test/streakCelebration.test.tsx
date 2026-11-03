/**
 * Streak poster plate (audit D1–D7, owner pick 2026-11-03:
 * direction A + B's wallet-tick beat).
 *
 * The celebration rebuild, walked the way the device suites walk
 * shipped screens (real stores, mocked Chef transport):
 *
 *  - FRESH GRANT: the sheet is the poster plate — DAY headline,
 *    reward rows at hero size tagged Banked (the key row tagged
 *    Cycle prize), the legible ladder, the announcement glow —
 *    and the pill carries the announcement pulse + NEW.
 *  - ACKNOWLEDGE (D1/D2): "Back to the hunt" ends the
 *    celebration AND clears the pill's announcement; reopening
 *    the sheet shows the quiet claimed presentation; the
 *    acknowledgement survives a remount and never re-fires the
 *    check-in read.
 *  - ALREADY CLAIMED: no pulse, no badge, no celebration — the
 *    quiet sheet with its Banked fact lines.
 *  - WALLET TICK (B's beat): a fresh grant counts the Strip's
 *    credits up from the pre-grant balance, once; an
 *    already-claimed replay never ticks.
 *  - DAY BOUNDARY (D3): a held result from a previous UTC day
 *    revalidates on return to the foreground; a same-day result
 *    does not refetch.
 *  - COPY (D4): the broken status string exists nowhere in the
 *    streak sources, and the panel source holds no sub-floor
 *    type (D5).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
import { getLoginStreakState } from '@/lib/chef/chefClient';
import { usePlayerStore } from '@/store';
import { useLoginStreakStore } from '@/store/slices/loginStreakSlice';
import { useContractsStore } from '@/store/slices/contractsSlice';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { usePushPrimerStore } from '@/store/slices/pushPrimerSlice';

const mockStreak = vi.mocked(getLoginStreakState);

/**
 * The shipped surfaces under test — the Strip and the claim row —
 * without the full Home screen around them: the streak beats live
 * entirely in these two components and the shared stores, and the
 * light harness keeps the suite inside the test-timeout family on
 * a loaded machine.
 */
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

/** Day-3 grant: 200 credits + 1 fragment banked on this read. */
function freshDay3() {
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
      ladder: LADDER,
      missRule: 'Miss a day and the streak restarts at Day 1 — your longest streak is kept on your profile.',
    },
    granted: {
      alreadyClaimed: false,
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

/** The same day, replayed: the claim already exists. */
function claimedDay3() {
  const base = freshDay3() as unknown as { granted: Record<string, unknown> };
  return {
    ...(base as object),
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

/** Day-7 grant: the cycle prize — 500 credits, 3 fragments, 1 key. */
function freshDay7() {
  return {
    verified: true,
    loginStreak: {
      currentStreak: 7,
      longestStreak: 7,
      tier: 1,
      cycleDay: 7,
      todayState: 'earned',
      todayReward: { credits: 500, fragments: 3, cacheKeys: 1 },
      nextReward: { credits: 150, fragments: 0, cacheKeys: 0 },
      nextStreakLength: 8,
      ladder: LADDER.map((d) => ({ ...d, state: d.cycleDay < 7 ? 'earned' : 'today' })),
      missRule: 'Miss a day and the streak restarts at Day 1 — your longest streak is kept on your profile.',
    },
    granted: {
      alreadyClaimed: false,
      streakLength: 7,
      cycleDay: 7,
      tier: 1,
      creditsAwarded: 500,
      fragmentsAwarded: 3,
      cacheKeysAwarded: 1,
    },
    profile: null,
  } as never;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  mockStreak.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
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

describe('Streak poster plate — the fresh-grant celebration', () => {
  it('renders the poster plate: DAY headline, Banked reward rows, legible ladder', async () => {
    mockStreak.mockResolvedValue(freshDay3());
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));

    const panel = await openStreakSheet();
    // The plate: the day as headline, the streak as the numeral,
    // the arrival stated in words.
    expect(screen.getByTestId('streak-hero')).toBeTruthy();
    expect(panel.textContent).toContain('Day 3');
    expect(screen.getByText('Granted on arrival')).toBeTruthy();
    expect(screen.getByText('Day streak')).toBeTruthy();
    // Reward rows at hero size, past tense, Banked.
    const rows = screen.getByTestId('streak-reward-rows');
    expect(rows.textContent).toContain('+200');
    expect(rows.textContent).toContain('Credits');
    expect(rows.textContent).toContain('+1');
    expect(rows.textContent).toContain('Cache fragments');
    expect(screen.getAllByText('Banked').length).toBe(2);
    // The announcement glow rides the medal; the CTA is the
    // acknowledgement and claims nothing.
    expect(screen.getByTestId('streak-medal-glow')).toBeTruthy();
    expect(screen.getByTestId('streak-done-button').textContent).toContain('Back to the hunt');
    // The ladder: every day labelled, the cycle prize stacked in
    // short lines at the type floor — nothing collides, nothing
    // shrinks (D5).
    const ladder = screen.getByLabelText('Seven day streak ladder');
    for (const label of ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7']) {
      expect(ladder.textContent).toContain(label);
    }
    expect(screen.getByText('500 cr')).toBeTruthy();
    expect(screen.getByText('3 frag')).toBeTruthy();
    expect(screen.getByText('KEY')).toBeTruthy();
    for (const line of [screen.getByText('500 cr'), screen.getByText('3 frag'), screen.getByText('KEY')]) {
      expect(line.className).toContain('text-[11px]');
    }
    // Next + the rules, in words, boundary stated.
    expect(panel.textContent).toContain('Streak day 4 — 250 credits · 1 fragment');
    expect(panel.textContent).toContain('A new streak day starts at 00:00 UTC.');
  }, 20000);

  it('day 7 carries the cycle prize: key row tagged Cycle prize, plate stamped Cycle complete', async () => {
    mockStreak.mockResolvedValue(freshDay7());
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));

    await openStreakSheet();
    expect(screen.getByText('Cycle complete')).toBeTruthy();
    const rows = screen.getByTestId('streak-reward-rows');
    expect(rows.textContent).toContain('+500');
    expect(rows.textContent).toContain('+3');
    expect(rows.textContent).toContain('+1');
    expect(rows.textContent).toContain('Cache key');
    expect(screen.getByText('Cycle prize')).toBeTruthy();
    // Crossing into tier 2 is named, the tier in the gain colour.
    expect(screen.getByText(/Streak day 8 opens/)).toBeTruthy();
    expect(screen.getByText('Tier 2')).toBeTruthy();
  }, 20000);
});

describe('Streak poster plate — acknowledgement (D1/D2)', () => {
  it('Back to the hunt clears the announcement, persists across remount, and the sheet reopens quiet', async () => {
    mockStreak.mockResolvedValue(freshDay3());
    const first = render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('streak-announce-pulse')).toBeTruthy());
    expect(screen.getByTestId('top-streak-button').textContent).toContain('NEW');

    await openStreakSheet();
    fireEvent.click(screen.getByTestId('streak-done-button'));

    // The sheet closed and the announcement died with the tap.
    await waitFor(() => expect(screen.queryByTestId('picker-sheet-overlay')).toBeNull());
    expect(screen.queryByTestId('streak-announce-pulse')).toBeNull();
    expect(screen.getByTestId('top-streak-button').textContent).not.toContain('NEW');
    expect(screen.getByTestId('top-streak-button').getAttribute('aria-label'))
      .toBe('Daily streak — day 3, today checked in');

    // Reopening shows the quiet claimed presentation — no rows,
    // no glow, the Banked fact lines instead.
    const reopened = await openStreakSheet();
    expect(screen.queryByTestId('streak-reward-rows')).toBeNull();
    expect(screen.queryByTestId('streak-medal-glow')).toBeNull();
    expect(screen.getByText('Banked today')).toBeTruthy();
    expect(reopened.textContent).toContain('Banked +200 credits · +1 fragment');
    expect(reopened.textContent).toContain('Day 4 — +250 credits · +1 fragment');
    fireEvent.click(screen.getByTestId('streak-done-button'));
    await waitFor(() => expect(screen.queryByTestId('picker-sheet-overlay')).toBeNull());

    // A full remount cannot resurrect the announcement, and the
    // check-in read never re-fires.
    first.unmount();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('top-streak-button')).toBeTruthy());
    expect(screen.queryByTestId('streak-announce-pulse')).toBeNull();
    expect(mockStreak).toHaveBeenCalledTimes(1);
  }, 20000);
});

describe('Streak poster plate — already claimed is silent', () => {
  it('no pulse, no badge, no celebration rows — the quiet sheet only', async () => {
    mockStreak.mockResolvedValue(claimedDay3());
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId('top-streak-button').textContent).toContain('Day 3');
    });

    expect(screen.queryByTestId('streak-announce-pulse')).toBeNull();
    expect(screen.getByTestId('top-streak-button').textContent).not.toContain('NEW');

    const panel = await openStreakSheet();
    expect(screen.queryByTestId('streak-reward-rows')).toBeNull();
    expect(screen.queryByTestId('streak-medal-glow')).toBeNull();
    expect(panel.textContent).toContain('Banked +200 credits · +1 fragment');
    expect(screen.getByText('+200').className).toContain('text-green');
    expect(screen.getByText(/Daily check-in · Day 3 claimed today/)).toBeTruthy();
  }, 20000);
});

describe('Streak poster plate — the wallet tick (B beat)', () => {
  it('a fresh grant counts the Strip credits up from the pre-grant balance, once', async () => {
    mockStreak.mockResolvedValue(freshDay7()); // +500 credits
    render(<Harness />);

    // The tick engages (the chip flags it while counting)…
    await waitFor(
      () => expect(screen.getByTestId('resource-chip-credits').getAttribute('data-ticking')).toBe('true'),
      { timeout: 3000 },
    );
    expect(useLoginStreakStore.getState().tickedGrantKey).not.toBeNull();
    // …and settles on the true balance.
    await waitFor(
      () => expect(screen.getByTestId('resource-value-credits').textContent).toBe('5,600'),
      { timeout: 3000 },
    );
    await waitFor(
      () => expect(screen.getByTestId('resource-chip-credits').getAttribute('data-ticking')).toBeNull(),
      { timeout: 3000 },
    );
  }, 20000);

  it('an already-claimed replay never ticks', async () => {
    mockStreak.mockResolvedValue(claimedDay3());
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId('resource-value-credits').textContent).toBe('5,600');
    });
    expect(screen.getByTestId('resource-chip-credits').getAttribute('data-ticking')).toBeNull();
    expect(useLoginStreakStore.getState().tickedGrantKey).toBeNull();
  });

  it('acknowledgement and the tick key on the same grant', async () => {
    // Both beats derive from the one grant key: the key the
    // Strip records as ticked is exactly the key the sheet's
    // acknowledgement records as seen — the two can never drift
    // onto different grants.
    mockStreak.mockResolvedValue(freshDay3());
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useLoginStreakStore.getState().tickedGrantKey).not.toBeNull(),
    );
    act(() => {
      useLoginStreakStore.getState().acknowledge();
    });
    expect(useLoginStreakStore.getState().seenGrantKey)
      .toBe(useLoginStreakStore.getState().tickedGrantKey);
  });
});

describe('Streak poster plate — day-boundary revalidation (D3)', () => {
  it('a same-day held result does not refetch; a stale-day result revalidates on foreground return', async () => {
    mockStreak.mockResolvedValue(claimedDay3());
    render(<Harness />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));

    // Same client day: revalidation is a no-op.
    await act(async () => {
      await useLoginStreakStore.getState().revalidate();
    });
    expect(mockStreak).toHaveBeenCalledTimes(1);

    // The held result now predates today (a session kept alive
    // across 00:00 UTC): returning to the foreground re-reads.
    act(() => {
      useLoginStreakStore.setState({ resultDay: '2000-01-01' });
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(2));
  });
});

describe('Streak poster plate — copy and type-floor scans (D4/D5)', () => {
  const sources = [
    'src/components/dashboard/LoginStreakPanel.tsx',
    'src/components/dashboard/DashboardTopBar.tsx',
    'src/store/slices/loginStreakSlice.ts',
  ].map((rel) => readFileSync(path.join(process.cwd(), rel), 'utf8'));

  it('the broken status string and claim-bait copy exist nowhere in the streak sources', () => {
    for (const src of sources) {
      expect(src).not.toContain('of claimed today');
      expect(src).not.toContain("Today's reward is waiting");
      expect(src).not.toContain('reward claimed');
    }
  });

  it('the panel source holds no type below the 11px floor', () => {
    const panel = sources[0];
    expect(panel).not.toMatch(/text-\[(?:[0-9]|10)px\]/);
    expect(panel).not.toMatch(/text-\[10\.5px\]/);
  });
});
