/**
 * Claim-row icon-only regression (2026-11-05, owner ruling).
 *
 * History: PR #400's claim row crushed CACHE/OFFLINE to ~46px
 * in the fresh-guest state (badge reservations on the streak /
 * contracts pills starved the pair; labels clipped, the key
 * bubble fell outside its button). PR #402 fixed the fit with
 * flex-wrap + width floors — and the owner rejected the second
 * line outright ("that second line looks so bad") and ruled
 * the row ICON-ONLY: "just make those logos then without text
 * — people will learn what the logos mean."
 *
 * This suite pins the structure that makes icon-only fit on
 * ONE line at 412px in every state (jsdom has no layout; the
 * 412×915 captures + geometry probe are the pixel proof):
 *
 *  - the row never wraps and the pair group is gone — the five
 *    keys are direct children of the row;
 *  - no word labels paint: CACHE / OFFLINE / ORDERS / WEEKLY
 *    text is absent from the keys; the full words survive in
 *    the aria-labels and on the destinations;
 *  - DATA stays: the key bubble, the pending figure, the
 *    streak day numeral, the CLAIM / GUEST / count badges;
 *  - the old badge-corner padding reservations are gone, and
 *    each key's content stage anchors to its bottom (mt-auto in
 *    a flex-col key) while the badge keeps the top corner —
 *    badge and content can never share a band at any width;
 *  - per-key min-width floors are sized from icon + data.
 *
 * On the #402 component every assertion below fails (wrap,
 * painted labels, reservations, pair span, no bottom anchor).
 *
 * DESIGN FIX (2026-11-05, later the same day): the owner
 * rejected #403's LOOK — the fit was right and the design was
 * wrong (15px glyphs rattling in wide label-era plates,
 * floor-hugging, no rhythm). An impeccable layout + polish
 * pass redesigned the row as one instrument rail, and the
 * pins below moved ONLY where that composition legitimately
 * changed, as recorded here:
 *  - every key now takes an EQUAL flex share (the two-slab /
 *    two-stub rhythm is gone), so the compact keys' floors
 *    dropped to their cluster sizes (streak/contracts/weekly
 *    60/56/56 → 52) and OFFLINE pending's floor is sized from
 *    its new cluster (116 → 108);
 *  - the content stage is a FIXED 33px band and the cluster
 *    CENTERS in it on both axes (items-center +
 *    justify-center pins added) — the mt-auto zone separation
 *    from the badge band is unchanged;
 *  - the icons stand at 26px (§7's door/row size) — a new pin
 *    reads the rendered svg width so the glyphs can never
 *    silently shrink back to label-era 15px.
 *
 * R2 AMENDMENT (owner feedback on the presented design-fix
 * captures, 2026-11-05: "They don't need to be so tall and
 * reduce the spacing"): the rail compacts and the pins move
 * with it — key height 56 → 48px (tap floor 44), content
 * stage 33 → 26px, icons 26 → 24px, row gap 8 → 6px, key
 * padding 6 → 4px, cluster gap 6 → 4px. 24px is the minimum
 * icon reduction the 48px key honestly allows (badge band +
 * clear stage cap the stage at 26px); the svg-width pin
 * moves to 24 so the glyphs still can never silently shrink
 * back toward label-era sizes. Everything else — icon-only,
 * one line, equal shares, data + badges, zone separation —
 * is unchanged.
 *
 * R3 AMENDMENT (owner feedback on the presented r2 captures,
 * 2026-11-05: "cut the button size in half, still too big" +
 * the section-gap ruling): the rail of plates is replaced by
 * content-sized CHIPS, and the pins move with the composition:
 *  - the BUTTON is now a transparent 44px hit box (h-11,
 *    min-w-[44px]) — no flex-1, no flex-col, no plate classes;
 *    the painted chip inside it stands 28px tall (half the
 *    r2 plate's footprint) with the icon + readout inline;
 *  - the glyph-size pin moves 24 → 20 — the largest glyph the
 *    28px chip honestly holds with the corner tab clear; the
 *    pin's purpose is unchanged (never back toward 15px);
 *  - equal flex shares are gone by design: chips size to
 *    their content and dock left on the row's 8px beat
 *    (gap-3 = --cc-gap-md under .bl-page);
 *  - the badge is a compact corner tab on the HIT BOX
 *    (top-0/right-0 — see qcPapercuts' re-pinned Papercut 2);
 *    no badge band is reserved anywhere, and OFFLINE pending
 *    no longer carries a width floor: its chip widens with
 *    its figure, the figure still at full size;
 *  - the row's mb-3 is gone (Home's stack owns the section
 *    boundary — the 8px section-gap law, probed in the
 *    claim-row-look-captures spacing probe).
 *
 * R4 AMENDMENT (owner feedback on the presented r3 captures,
 * 2026-11-05: "Space the cache etc buttons horizontal to
 * fill that whole space"): the left dock is superseded — the
 * row spreads its keys across the full column width
 * (justify-between over the gap-3 floor): first key flush
 * left, last key flush right, the leftover width landing as
 * equal gaps between the keys in the four-key and five-key
 * states alike. The hit boxes are flex items, so the
 * distribution can never overlap them; the pixel proof (gap
 * values per state, asserted equal within a state) is the
 * claim-row-look geometry probe. The pins below move only
 * here: the row carries justify-between in both states.
 * Icon-only, one line, all data + badges, behavior/testids/
 * destinations — unchanged, and pinned below as before.
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

function chipOf(button: HTMLElement) {
  // The painted chip — the button's data-chip span (the hit
  // box's only painted child; badges render after it, at the
  // button's own corner).
  return button.querySelector(':scope > span[data-chip]') as HTMLElement;
}

function expectIconKey(button: HTMLElement) {
  // The button is the transparent HIT BOX (r3): 44px tall,
  // at least 44px wide, no plate of its own — no flex-1 (the
  // equal-share rail is gone), no flex-col (no badge band /
  // content stage stack), never a wrap.
  expect(button.className).toContain('h-11');
  expect(button.className).toContain('min-h-[44px]');
  expect(button.className).toContain('min-w-[44px]');
  expect(button.className).not.toContain('flex-1');
  expect(button.className).not.toContain('flex-col');
  expect(button.className).not.toContain('flex-wrap');
  // The label-era badge reservations stay reclaimed.
  for (const reservation of ['pr-16', 'pr-12', 'pr-9']) {
    expect(button.className).not.toContain(reservation);
  }
  // The painted chip: 28px tall — half the r2 plate — with
  // the icon + readout composed inline and centered (§6
  // alignment law). The icon stands at 20px, the largest
  // the chip honestly holds; the pin stands so the glyphs
  // can never silently shrink back toward label-era sizes.
  const chip = chipOf(button);
  expect(chip).toBeTruthy();
  expect(chip.className).toContain('h-[28px]');
  expect(chip.className).toContain('items-center');
  expect(chip.className).toContain('justify-center');
  // The glyph stands at 20px in the chip (SVG stencil or, since
  // INT-10, a painting <img> for glyphs that have one); the pin's
  // purpose is unchanged — never back toward label-era sizes.
  // (INT-10 note: in the fresh-guest state every chip glyph —
  // key, clock, calendar, orders — is stencil-residue by the
  // INT-10 census, so the svg read is the live one here.)
  const glyphEl = button.querySelector('svg') ?? button.querySelector('img');
  expect(glyphEl?.getAttribute('width')).toBe('20');
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

describe('Claim row — icon-only, one line, every state (owner ruling 2026-11-05)', () => {
  it('fresh-guest state (streak CLAIM + contracts GUEST): icons + data, no labels, no wrap', { timeout: 20_000 }, async () => {
    mockStreak.mockResolvedValue(streakClaimableResult());
    mockContracts.mockResolvedValue(boardResult(false, [contractView('c-1', true)]));
    render(<HomeScreen onNavigate={() => {}} />);

    const row = await screen.findByTestId('dashboard-top-bar');
    await waitFor(() => {
      expect(screen.getByTestId('top-streak-button').textContent).toContain('CLAIM');
    });
    expect(screen.getByTestId('top-contracts-button').textContent).toContain('GUEST');

    // One line: no wrap, and no pair group — the keys are the
    // row's direct children. Spread to fill (r4): the row
    // distributes the keys across the full column width.
    expect(row.className).not.toContain('flex-wrap');
    expect(row.className).toContain('justify-between');
    const cacheButton = screen.getByTestId('top-cache-button');
    const offlineButton = screen.getByTestId('top-offline-button');
    const streakButton = screen.getByTestId('top-streak-button');
    const contractsButton = screen.getByTestId('top-contracts-button');
    expect(cacheButton.parentElement).toBe(row);

    // No word labels paint anywhere in the row…
    expect(row.textContent).not.toContain('Cache');
    expect(row.textContent).not.toContain('Offline');
    expect(row.textContent).not.toContain('Orders');
    // …while the words survive in the accessibility tree.
    expect(cacheButton.getAttribute('aria-label')).toBe('Cache — 3 cache keys held. Opens the cache chest.');
    expect(offlineButton.getAttribute('aria-label')).toContain('nothing waiting');
    expect(streakButton.getAttribute('aria-label')).toContain('Daily streak — day 1');
    expect(contractsButton.getAttribute('aria-label')).toContain('sign in with Google');

    // DATA stays: the bubble is the CACHE key's only text —
    // the true count, a real child of the button.
    expect(cacheButton.textContent?.trim()).toBe('3');
    expect(cacheButton.contains(screen.getByTestId('top-cache-key-count'))).toBe(true);
    // The streak key paints its badge + the day numeral (data),
    // never the word "Day".
    expect(streakButton.textContent).toContain('CLAIM');
    expect(streakButton.textContent).toContain('1');
    expect(streakButton.textContent).not.toContain('Day');
    // The quiet OFFLINE key is a bare icon.
    expect(offlineButton.textContent?.trim()).toBe('');

    expectIconKey(cacheButton);
    expectIconKey(offlineButton);
    expectIconKey(streakButton);
    expectIconKey(contractsButton);
  });

  it('both badges + the weekly pill: five icon keys, one line', { timeout: 20_000 }, async () => {
    mockStreak.mockResolvedValue(streakClaimableResult());
    mockContracts.mockResolvedValue(boardResult(false, [contractView('c-1', true)]));
    mockStanding.mockResolvedValue(standingWithWeeklyClaimable());
    render(<HomeScreen onNavigate={() => {}} />);

    const weekly = await screen.findByTestId('top-weekly-button');
    // The weekly key paints its count badge, never its name.
    expect(weekly.textContent).toContain('1');
    expect(weekly.textContent).not.toContain('Weekly');
    expect(weekly.getAttribute('aria-label')).toContain('Weekly claimables');
    expectIconKey(weekly);
    const row = screen.getByTestId('dashboard-top-bar');
    expect(row.className).not.toContain('flex-wrap');
    // Spread to fill holds in the five-key state too (r4).
    expect(row.className).toContain('justify-between');
    for (const id of ['top-cache-button', 'top-offline-button', 'top-streak-button', 'top-contracts-button']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('no badges (paid streak, idle contracts): bare icons + the day numeral', { timeout: 20_000 }, async () => {
    mockStreak.mockResolvedValue(streakPaidResult());
    mockContracts.mockResolvedValue(boardResult(true, [contractView('c-1', false)]));
    render(<HomeScreen onNavigate={() => {}} />);

    await screen.findByTestId('dashboard-top-bar');
    await waitFor(() => {
      expect(screen.getByTestId('top-streak-button').textContent).toContain('3');
    });
    const row = screen.getByTestId('dashboard-top-bar');
    expect(row.textContent).not.toContain('CLAIM');
    expect(row.textContent).not.toContain('GUEST');
    // The streak key is icon + numeral and nothing else.
    expect(screen.getByTestId('top-streak-button').textContent?.trim()).toBe('3');
    expect(screen.getByTestId('top-contracts-button').textContent?.trim()).toBe('');
    expect(screen.getByTestId('top-offline-button').textContent?.trim()).toBe('');
    expect(row.className).not.toContain('flex-wrap');
    expect(screen.queryByTestId('top-weekly-button')).toBeNull();
  });

  it('a pending hold: OFFLINE carries its CLAIM badge + the true figure, still one line', { timeout: 20_000 }, async () => {
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
    expect(offlineButton.textContent).not.toContain('Offline');
    expect(screen.getByTestId('top-offline-pending').textContent).toContain('4,321');
    // The pending chip widens for its figure (icon + the
    // credits leg, composed inline in the chip); the tab
    // rides the hit box's top corner — no reservation, no
    // width floor, no wrap (r3).
    expectIconKey(offlineButton);
    expect(chipOf(offlineButton).contains(screen.getByTestId('top-offline-pending'))).toBe(true);
    expect(screen.getByTestId('dashboard-top-bar').className).not.toContain('flex-wrap');
    expect(screen.getByTestId('top-cache-button').className).toContain('min-w-[44px]');
  });
});
