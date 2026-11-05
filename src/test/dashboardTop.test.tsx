/**
 * Dashboard top redesign (owner's device feedback, 2026-11-01).
 *
 * The home screen's top row — level progress button + streak /
 * contracts icon pop-ups — walked the way the device suites walk
 * shipped screens (real stores, mocked Chef transport):
 *
 *  - first paint: the level button (with its XP progress bar) and
 *    both icons sit directly under the ResourceBar, before every
 *    scroll surface; the streak/contracts panels are NOT in the
 *    scroll anymore.
 *  - HARD INVARIANT: mounting the Dashboard records the streak
 *    day (the state read IS the check-in) and reads the contracts
 *    board WITHOUT any pop-up being opened.
 *  - tapping each door opens the shipped bottom sheet with the
 *    REAL panel inside (working claim buttons included).
 *  - claimable state is visible without scrolling: pulse + badge
 *    + an aria-label that carries the signal in words; guests get
 *    the lock, never the pulse.
 *  - the offline recap (primer row included, PERM-01) renders
 *    as the RETURN SHEET (DESIGN.md §10) after a settlement: the
 *    level chip is its door while a settlement exists, the level
 *    pop-up holds level specifics only — and the recap is
 *    nowhere in the Dashboard scroll or App root anymore.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// The primer row may only appear when the OS permission is still
// askable — pin it askable so the recap's primer is exercised.
vi.mock('@/lib/notifications/pushNotifications', () => ({
  checkPushPermission: vi.fn(async () => 'prompt'),
  requestPushNotifications: vi.fn(async () => true),
  syncPushRegistration: vi.fn(async () => {}),
}));

import { HomeScreen } from '@/screens/HomeScreen';
import {
  claimContract,
  getContractsState,
  getLoginStreakState,
} from '@/lib/chef/chefClient';
import { usePlayerStore } from '@/store';
import { useLoginStreakStore } from '@/store/slices/loginStreakSlice';
import { useContractsStore } from '@/store/slices/contractsSlice';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { usePushPrimerStore } from '@/store/slices/pushPrimerSlice';
import { xpToNextLevel } from '@/content/simulation';
import type { SettlementRecap } from '@/lib/activity/activitySettlement';

const mockStreak = vi.mocked(getLoginStreakState);
const mockContracts = vi.mocked(getContractsState);
const mockClaim = vi.mocked(claimContract);

function streakResult(alreadyClaimed: boolean) {
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
      ladder: [
        { cycleDay: 1, credits: 100, fragments: 0, cacheKeys: 0, state: 'earned' },
        { cycleDay: 2, credits: 150, fragments: 0, cacheKeys: 0, state: 'earned' },
        { cycleDay: 3, credits: 200, fragments: 1, cacheKeys: 0, state: 'today' },
        { cycleDay: 4, credits: 250, fragments: 1, cacheKeys: 0, state: 'upcoming' },
        { cycleDay: 5, credits: 300, fragments: 2, cacheKeys: 0, state: 'upcoming' },
        { cycleDay: 6, credits: 400, fragments: 2, cacheKeys: 0, state: 'upcoming' },
        { cycleDay: 7, credits: 500, fragments: 3, cacheKeys: 1, state: 'upcoming' },
      ],
      missRule: 'Miss a day and the streak restarts at Day 1 — your longest streak is kept on your profile.',
    },
    granted: {
      alreadyClaimed,
      streakLength: alreadyClaimed ? null : 3,
      cycleDay: 3,
      tier: 1,
      creditsAwarded: alreadyClaimed ? 0 : 200,
      fragmentsAwarded: alreadyClaimed ? 0 : 1,
      cacheKeysAwarded: 0,
    },
    profile: null,
  } as never;
}

function contractView(id: string, complete: boolean, status = 'active') {
  return {
    id,
    slot: 0,
    templateId: 'salvage_run',
    title: 'Breakdown: salvage 6 items',
    family: 'breakdown',
    target: 6,
    progress: complete ? 6 : 2,
    complete,
    status,
    reward: { credits: 220, fragments: 1, parts: [] },
    progressLine: complete ? 'Salvages 6 / 6 — pays 220 cr + 1 fragment' : 'Salvages 2 / 6 — pays 220 cr + 1 fragment',
    claimByLabel: 'claim by 00:00 UTC',
  };
}

function setView(contracts: unknown[], periodKind: string) {
  return {
    periodKind,
    periodKey: periodKind === 'daily' ? '2026-11-01' : '2026-10-26',
    band: 'rookie',
    contracts,
    claimedCount: 0,
    setSize: contracts.length,
    setBonus: { credits: 300, fragments: 2, cacheKeys: 1, earned: false },
    setBonusLine: 'Full set: +300 cr + 2 fragments + 1 key',
    freeRerollAvailable: true,
    rerollCostScrap: 25,
  };
}

function boardResult(canClaim: boolean, dailyContracts: unknown[], weeklyContracts: unknown[] = []) {
  return {
    verified: true,
    contracts: {
      canClaim,
      daily: setView(dailyContracts, 'daily'),
      weekly: setView(weeklyContracts, 'weekly'),
    },
    profile: null,
  } as never;
}

const recap = {
  settled: true,
  areaId: 'dustwaste',
  areaName: 'Dustwaste',
  timeAway: '2h 5m',
  elapsedMs: 7_500_000,
  cappedMs: 7_500_000,
  capReached: false,
  capHours: 4,
  ticksSettled: 120,
  startTick: 0,
  endTick: 120,
  profile: {},
  rewards: {
    creditsAwarded: 4321,
    scrapAwarded: 87,
    xpAwarded: 640,
    cacheFragmentsAwarded: 2,
    materials: { Scrap: 5 },
    essences: {},
  },
  items: [],
} as unknown as SettlementRecap;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  mockStreak.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
  mockContracts.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
  mockClaim.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
  useLoginStreakStore.getState().reset();
  useContractsStore.getState().reset();
  useOfflineRecapStore.getState().reset();
  usePushPrimerStore.getState().reset();
  // Level 5, exactly half-way through the level's XP curve.
  const needed = xpToNextLevel(5);
  usePlayerStore.setState({ level: 5, xp: Math.floor(needed / 2), profileLoaded: true });
});

afterEach(() => {
  cleanup();
});

describe('Dashboard top — first paint', () => {
  it('shows the level progress button and both icons under the ResourceBar, before the scroll surfaces', async () => {
    render(<HomeScreen onNavigate={() => {}} />);

    const topBar = await screen.findByTestId('dashboard-top-bar');
    const levelButton = screen.getByTestId('top-level-button');
    expect(screen.getByTestId('top-streak-button')).toBeTruthy();
    expect(screen.getByTestId('top-contracts-button')).toBeTruthy();

    // The level button carries the progress bar + the same numbers
    // the old Level Strip showed (player store × xpToNextLevel).
    const needed = xpToNextLevel(5);
    const xp = Math.floor(needed / 2);
    expect(levelButton.getAttribute('aria-label')).toContain(`${xp} of ${needed} XP`);
    expect(levelButton.textContent).toContain(`${xp} / ${needed} XP`);
    // Drift-fix F1: the claim row compressed from 52px stacked
    // panels to one thin row of pills (DESIGN.md §4 step 2) — the
    // level door is a 40px pill now, same sheet behind it.
    expect(levelButton.className).toContain('min-h-[40px]');

    // Document order: ResourceBar chips → top bar → the deck's
    // first panel (Launchers — Hunter Totals left the deck in
    // the 2026-11-03 consolidation). Nothing above the top bar
    // needs a scroll to reach it, at phone height or ~740dp.
    const levelChip = screen.getByTestId('resource-chip-level');
    expect(levelChip.compareDocumentPosition(topBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const launchers = await screen.findByText('Launchers');
    expect(topBar.compareDocumentPosition(launchers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The panels are NOT in the scroll anymore.
    expect(screen.queryByText('Login Streak')).toBeNull();
    expect(screen.queryByText('Weekly contracts')).toBeNull();
    expect(screen.queryByText('Level Strip')).toBeNull();
  });
});

describe('Dashboard top — the check-in is not behind the tap', () => {
  it('records the streak day and reads the board on Dashboard mount, no pop-up opened', async () => {
    mockStreak.mockResolvedValue(streakResult(true));
    mockContracts.mockResolvedValue(boardResult(true, [contractView('c-1', false)]));

    render(<HomeScreen onNavigate={() => {}} />);

    // Both reads fired from the mount alone…
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockContracts).toHaveBeenCalledTimes(1));
    // …no sheet was opened to make them happen…
    expect(screen.queryByTestId('picker-sheet-overlay')).toBeNull();
    expect(screen.queryByText('Login Streak')).toBeNull();
    // …and the icon already reflects the recorded day.
    await waitFor(() => {
      expect(screen.getByTestId('top-streak-button').textContent).toContain('Day 3');
    });
    expect(screen.getByTestId('top-streak-button').getAttribute('aria-label'))
      .toBe('Daily streak — day 3, today checked in');
  });

  it('a fresh grant announces on the streak icon with a NEW badge and a spoken label', async () => {
    mockStreak.mockResolvedValue(streakResult(false));
    render(<HomeScreen onNavigate={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('streak-announce-pulse')).toBeTruthy());
    const button = screen.getByTestId('top-streak-button');
    expect(button.textContent).toContain('NEW');
    expect(button.getAttribute('aria-label')).toBe('Daily streak — day 3, new grant banked for day 3');
  });
});

describe('Dashboard top — pop-ups hold the real panels', () => {
  it('the streak icon opens the sheet with the working LoginStreakPanel', async () => {
    mockStreak.mockResolvedValue(streakResult(true));
    render(<HomeScreen onNavigate={() => {}} />);
    await waitFor(() => expect(mockStreak).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('top-streak-button'));
    expect(await screen.findByTestId('picker-sheet-overlay')).toBeTruthy();
    // The real panel: the sheet title, the poster plate, the
    // claimed state's Banked fact lines and the seven-day ladder
    // all render inside. (The audit's broken status string —
    // "Day 3 of claimed today" — is gone with the rebuild; the
    // copy scan in streakCelebration.test.tsx pins its absence.)
    expect((await screen.findAllByText('Login Streak')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('streak-panel')).toBeTruthy();
    expect(screen.getByText('Banked today')).toBeTruthy();
    const panelText = screen.getByTestId('streak-panel').textContent ?? '';
    expect(panelText).toContain('Banked +200 credits');
    expect(panelText).toContain('Day 4 — +250 credits');
    // Fact-line amounts print in the gain green (the mock's
    // language), not the fact white.
    expect(screen.getByText('+200').className).toContain('text-green');
    expect(screen.getByLabelText('Seven day streak ladder')).toBeTruthy();
    // Opening the pop-up did NOT re-fire the check-in read.
    expect(mockStreak).toHaveBeenCalledTimes(1);
  });

  it('the contracts icon opens the sheet; claiming pays through the Chef op and clears the badge', { timeout: 20_000 }, async () => {
    mockContracts.mockResolvedValue(boardResult(true, [contractView('c-1', true)]));
    mockClaim.mockResolvedValue({
      verified: true,
      contracts: boardResult(true, [contractView('c-1', true, 'claimed')]).contracts,
      profile: null,
      claimed: { instanceId: 'c-1', templateId: 'salvage_run', creditsAwarded: 220, fragmentsAwarded: 1, setBonus: null },
    } as never);

    render(<HomeScreen onNavigate={() => {}} />);

    // Claimable without scrolling: pulse + count badge + label.
    await waitFor(() => expect(screen.getByTestId('contracts-claim-pulse')).toBeTruthy());
    const icon = screen.getByTestId('top-contracts-button');
    expect(icon.textContent).toContain('1');
    expect(icon.getAttribute('aria-label')).toBe('Contracts — 1 ready to claim');

    fireEvent.click(icon);
    expect(await screen.findByTestId('picker-sheet-overlay')).toBeTruthy();
    // The claimable contract ALSO waits as the Next Move card
    // (its Claim opens this same sheet) — the panel's own Claim
    // is the one this flow pays through.
    const claimButton = await within(screen.getByTestId('picker-sheet-body')).findByRole('button', { name: 'Claim' });
    fireEvent.click(claimButton);
    await waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Claimed: \+220 cr/)).toBeTruthy();

    // The store-driven badge clears the moment the claim lands.
    await waitFor(() => {
      expect(screen.getByTestId('top-contracts-button').getAttribute('aria-label'))
        .toBe('Contracts — none ready to claim');
    });
    expect(screen.queryByTestId('contracts-claim-pulse')).toBeNull();
  });

  it('guests get the lock badge (no pulse, no count) and the panel lock inside', async () => {
    mockContracts.mockResolvedValue(boardResult(false, [contractView('c-1', true)]));
    render(<HomeScreen onNavigate={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('top-contracts-button').getAttribute('aria-label'))
        .toBe('Contracts — sign in with Google to claim rewards');
    });
    const icon = screen.getByTestId('top-contracts-button');
    // Assumption-gaps G10: the guest badge prints its why as a
    // word — GUEST — in the row's badge language (AWAY / NEW /
    // counts), instead of a bare lock glyph that never said why
    // the pill was locked. The button now carries one SVG (the
    // orders icon) plus the badge text.
    expect(icon.querySelectorAll('svg')).toHaveLength(1);
    expect(icon.textContent).toContain('GUEST');
    expect(icon.textContent).not.toContain('🔒');
    expect(screen.queryByTestId('contracts-claim-pulse')).toBeNull();

    fireEvent.click(icon);
    expect(await screen.findByText('Sign in with Google to claim')).toBeTruthy();
  });
});

describe('Short-absence suppression — under 5 minutes never auto-presents (owner\'s rule)', () => {
  const shortRoaming = { ...recap, elapsedMs: 120_000, timeAway: '2m' } as unknown as SettlementRecap;
  const craftingRecap = (advancedMs: number) => ({
    settled: true,
    crafting: { advancedMs, xpAwarded: 40, jobsCompleted: 1, completions: [], capHours: 4 },
  }) as unknown as SettlementRecap;
  const extractionRecap = (advancedMs: number) => ({
    settled: true,
    extraction: { advancedMs, xpAwarded: 25, passesCompleted: 0, passes: [], materials: {}, essences: {}, capHours: 4 },
  }) as unknown as SettlementRecap;

  it('stores short absences already-dismissed, per variant, at the entry seam', () => {
    const store = useOfflineRecapStore.getState();

    store.setSettlement(shortRoaming);
    expect(useOfflineRecapStore.getState().dismissed).toBe(true);
    // Tucked, not dropped: the summary itself is stored whole.
    expect(useOfflineRecapStore.getState().lastSettlement?.rewards.creditsAwarded).toBe(4321);

    store.setSettlement(craftingRecap(60_000));
    expect(useOfflineRecapStore.getState().dismissed).toBe(true);

    store.setSettlement(extractionRecap(299_999));
    expect(useOfflineRecapStore.getState().dismissed).toBe(true);
  });

  it('keeps today\'s presentation at and above 5 minutes, per variant', () => {
    const store = useOfflineRecapStore.getState();

    store.setSettlement({ ...recap, elapsedMs: 300_000 } as unknown as SettlementRecap);
    expect(useOfflineRecapStore.getState().dismissed).toBe(false);

    store.setSettlement(craftingRecap(3_600_000));
    expect(useOfflineRecapStore.getState().dismissed).toBe(false);

    store.setSettlement(extractionRecap(300_000));
    expect(useOfflineRecapStore.getState().dismissed).toBe(false);
  });

  it('a short absence shows NO beacon on Dashboard mount, and the summary stays reachable through the level chip (the Return Sheet)', async () => {
    useOfflineRecapStore.getState().setSettlement(shortRoaming);
    render(<HomeScreen onNavigate={() => {}} />);

    // First paint settles with no auto-presentation of any kind.
    await screen.findByTestId('dashboard-top-bar');
    expect(screen.queryByTestId('level-away-pulse')).toBeNull();
    expect(screen.getByTestId('top-level-button').textContent).not.toContain('AWAY');
    expect(screen.getByTestId('top-level-button').getAttribute('aria-label'))
      .not.toContain('While you were away');

    // On demand it is all there, numbers unchanged.
    fireEvent.click(screen.getByTestId('top-level-button'));
    expect(await screen.findByText('While You Were Away')).toBeTruthy();
    expect(screen.getByText('Away for')).toBeTruthy();
  });
});

describe('Dashboard top — level chip doors: specifics pop-up + the Return Sheet', () => {
  it('opens level specifics from the same store numbers', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId('top-level-button'));
    expect(await screen.findByTestId('picker-sheet-overlay')).toBeTruthy();
    const needed = xpToNextLevel(5);
    const xp = Math.floor(needed / 2);
    expect(screen.getByText('XP into this level')).toBeTruthy();
    expect(screen.getByText('XP to next level')).toBeTruthy();
    expect(screen.getByText(`${needed - xp}`)).toBeTruthy();
    // No settlement yet: no recap in the pop-up.
    expect(screen.queryByText('While You Were Away')).toBeNull();
  });

  it('an unacknowledged settlement beacons the level button and renders the recap (primer included) as the Return Sheet', async () => {
    useOfflineRecapStore.getState().setSettlement(recap);
    render(<HomeScreen onNavigate={() => {}} />);

    // Beacon on first paint: pulse + AWAY badge + label — and the
    // recap is NOT in the Dashboard scroll.
    await waitFor(() => expect(screen.getByTestId('level-away-pulse')).toBeTruthy());
    const levelButton = screen.getByTestId('top-level-button');
    expect(levelButton.textContent).toContain('AWAY');
    expect(levelButton.getAttribute('aria-label')).toContain('While you were away rewards are waiting');
    expect(screen.queryByText('While You Were Away')).toBeNull();
    expect(screen.queryByTestId('offline-recap-reopen')).toBeNull();

    fireEvent.click(levelButton);
    expect(await screen.findByText('While You Were Away')).toBeTruthy();
    expect(screen.getByText('Away for')).toBeTruthy();
    // PERM-01: the primer row rides inside the recap, in the sheet.
    expect(await screen.findByTestId('push-primer')).toBeTruthy();
    // Return Sheet form (§10): the totals row prints the absence's
    // headline numbers (this settlement carries credits).
    expect(screen.getByTestId('return-totals-row')).toBeTruthy();

    // "Collect" acknowledges: sheet closes, beacon stops, the recap
    // store keeps the settlement (re-readable next open). Scoped
    // to the sheet — the settlement also waits as the Next Move
    // card, whose Collect opens this same sheet.
    fireEvent.click(within(screen.getByTestId('picker-sheet-body')).getByRole('button', { name: 'Collect' }));
    await waitFor(() => expect(screen.queryByTestId('picker-sheet-overlay')).toBeNull());
    expect(useOfflineRecapStore.getState().dismissed).toBe(true);
    expect(useOfflineRecapStore.getState().lastSettlement?.rewards.creditsAwarded).toBe(4321);
    expect(screen.queryByTestId('level-away-pulse')).toBeNull();

    // Re-opening through the level chip re-reads the same recap
    // (the Return Sheet is the recap's only home now).
    fireEvent.click(screen.getByTestId('top-level-button'));
    expect(await screen.findByText('While You Were Away')).toBeTruthy();
  });
});
