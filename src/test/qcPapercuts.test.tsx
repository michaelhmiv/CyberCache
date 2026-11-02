/**
 * Post-QC papercuts — the small, high-visibility cosmetic defects
 * the phone-width re-verification found on the live build after
 * the QC fix wave (captures in redesign-2026-11/web-capture-postqc/):
 *
 *  1. Market Buy search placeholder named the wrong noun
 *     ("Search caches…" on an items market — flagged by QC twice).
 *  2. Home claim-row corner badges (streak NEW, contracts count /
 *     lock) were sliced off at the buttons' top edge: the badge
 *     protruded (-top-1.5 -right-1.5) while every host button
 *     clips at its own box (overflow-hidden + .bl-panel's
 *     clip-path). The badge now sits fully inside the corner.
 *  3. Collections family header: the title and its blurb shared
 *     one inline run (the blurb collided with the title) and the
 *     "0 / 25" counter wrapped at the right edge. Title, blurb,
 *     and counter now own separate lines/edges.
 *  4. Diorama title plate: the stage title ellipsized
 *     ("NO TARGET SELE…") and the mode word printed twice — the
 *     plate's subtitle AND an in-scene tag (pixel chip / vector
 *     label) hanging off the plate's edge. The title wraps whole;
 *     the mode prints once, on the plate.
 *  5. Dev-flavored copy: the boss picker's changelog-speak
 *     subtitle and the World Pulse feed's implementation note
 *     are now player copy.
 *  6. Truncation family: the gain-toast detail line and the
 *     Trophy Shelf fact chips ellipsized values ("WRAITH
 *     SCAVENG…", "0 ranks · 0 t…"). They wrap, per the
 *     device-done rule that values print whole.
 *
 * jsdom has no layout engine, so geometry items are pinned as
 * DOM/source contracts in the repo's established style (see
 * qcLayoutFixes.test.tsx); the 412×915 geometry proof is the
 * Playwright probe recorded in the slice PR.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
}));

vi.mock('@/lib/notifications/pushNotifications', () => ({
  checkPushPermission: vi.fn(async () => 'prompt'),
  requestPushNotifications: vi.fn(async () => true),
  syncPushRegistration: vi.fn(async () => {}),
}));

import { HomeScreen } from '@/screens/HomeScreen';
import { getContractsState, getLoginStreakState } from '@/lib/chef/chefClient';
import { usePlayerStore } from '@/store';
import { useLoginStreakStore } from '@/store/slices/loginStreakSlice';
import { useContractsStore } from '@/store/slices/contractsSlice';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { usePushPrimerStore } from '@/store/slices/pushPrimerSlice';

const readSource = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const mockStreak = vi.mocked(getLoginStreakState);
const mockContracts = vi.mocked(getContractsState);

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
    progressLine: complete ? 'Salvages 6 / 6 — pays 220 cr + 1 fragment' : 'Salvages 2 / 6 — pays 220 cr + 1 fragment',
    claimByLabel: 'claim by 00:00 UTC',
  };
}

function boardResult(canClaim: boolean, dailyContracts: unknown[]) {
  const setView = (contracts: unknown[], periodKind: string) => ({
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
  });
  return {
    verified: true,
    contracts: {
      canClaim,
      daily: setView(dailyContracts, 'daily'),
      weekly: setView([], 'weekly'),
    },
    profile: null,
  } as never;
}

/** The corner badge inside a top-bar button: the small span that
 *  carries the badge text/icon at the corner (the PulseGlow
 *  underlay is also absolute, but it is inset-0, not cornered). */
function cornerBadgeIn(button: HTMLElement): HTMLElement {
  const badge = Array.from(button.querySelectorAll('span')).find((span) =>
    span.className.includes('right-1') || span.className.includes('-right-'),
  );
  if (!badge) throw new Error('no corner badge rendered in button');
  return badge as HTMLElement;
}

describe('Papercut 2 — claim-row corner badges render fully inside their buttons', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    mockStreak.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
    mockContracts.mockReset().mockRejectedValue(new Error('no chef in screen tests'));
    useLoginStreakStore.getState().reset();
    useContractsStore.getState().reset();
    useOfflineRecapStore.getState().reset();
    usePushPrimerStore.getState().reset();
    usePlayerStore.setState({ level: 5, xp: 10, profileLoaded: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('the streak NEW badge is inset — no negative offsets for the host to clip', async () => {
    mockStreak.mockResolvedValue(streakResult(false));
    render(<HomeScreen onNavigate={() => {}} />);

    const button = await screen.findByTestId('top-streak-button');
    await waitFor(() => expect(button.textContent).toContain('NEW'));
    const badge = cornerBadgeIn(button);
    expect(badge.textContent).toBe('NEW');
    expect(badge.className).toContain('top-1');
    expect(badge.className).toContain('right-1');
    expect(badge.className).not.toContain('-top');
    expect(badge.className).not.toContain('-right');
  });

  it('the contracts claim-count badge is inset the same way', async () => {
    mockContracts.mockResolvedValue(boardResult(true, [contractView('c1', true)]));
    render(<HomeScreen onNavigate={() => {}} />);

    const button = await screen.findByTestId('top-contracts-button');
    await waitFor(() => expect(button.textContent).toContain('1'));
    const badge = cornerBadgeIn(button);
    expect(badge.textContent).toBe('1');
    expect(badge.className).toContain('top-1');
    expect(badge.className).toContain('right-1');
    expect(badge.className).not.toContain('-top');
    expect(badge.className).not.toContain('-right');
  });

  it('source: CornerBadge never positions outside the host box', () => {
    const topBar = readSource('src/components/dashboard/DashboardTopBar.tsx');
    expect(topBar).toContain('absolute right-1 top-1 z-10');
    expect(topBar).not.toContain('absolute -top-1.5 -right-1.5');
  });
});

describe('Papercut 1 — Market Buy search names the right noun', () => {
  it('the Buy search placeholder is "Search items…", never "Search caches…"', () => {
    const market = readSource('src/screens/MarketScreen.tsx');
    expect(market).toContain('placeholder="Search items…"');
    expect(market).not.toContain('Search caches');
  });
});

describe('Papercut 3 — Collections family header owns its lines', () => {
  const collections = readSource('src/screens/CollectionsScreen.tsx');

  it('title and blurb are stacked blocks, not one inline run', () => {
    expect(collections).toContain('mt-1 text-[11px] leading-snug text-text-muted">{FAMILY_BLURBS[family]}');
    expect(collections).not.toContain('ml-2 text-[11px] text-text-muted">{FAMILY_BLURBS[family]}');
  });

  it('the family counter can never wrap', () => {
    expect(collections).toContain('shrink-0 whitespace-nowrap text-xs font-black text-text-secondary');
  });
});

describe('Papercut 4 — diorama title prints whole; the mode prints once', () => {
  const diorama = readSource('src/components/dashboard/LiveTurfDiorama.tsx');

  it('the stage title wraps instead of ellipsizing', () => {
    expect(diorama).toContain('bl-title break-words text-2xl');
    expect(diorama).not.toContain('bl-title truncate');
  });

  it('no in-scene mode tag remains in either scene path', () => {
    // Pixel path: the chip that hung at top-[58px] under the plate.
    expect(diorama).not.toContain('top-[58px]');
    expect(diorama).not.toContain('{modeLabel}');
    // Vector path: the SVG label tag with the uppercased mode word.
    expect(diorama).not.toContain('copy.label.toUpperCase()');
  });
});

describe('Papercut 5 — player copy, not dev copy', () => {
  it('the boss picker subtitle speaks to the player', () => {
    const action = readSource('src/screens/ActionScreenContextual.tsx');
    expect(action).not.toContain('no longer consumes the default action screen');
    expect(action).toContain('Pick your mark');
  });

  it('the World Pulse footer is player copy', () => {
    const feed = readSource('src/components/profile/WorldPulseFeed.tsx');
    expect(feed).not.toContain('derived from current stores');
    expect(feed).not.toContain('does not mint rewards');
    expect(feed).toContain('The latest from your hunts, finds, and feats');
  });
});

describe('Papercut 6 — values wrap whole (toast detail, Trophy Shelf chips)', () => {
  it('the gain-toast detail line wraps — no truncate', () => {
    const deck = readSource('src/components/dashboard/DashboardDeck.tsx');
    expect(deck).toContain('mt-0.5 text-[11px] font-black uppercase leading-snug tracking-[0.14em] text-text-muted');
    expect(deck).not.toContain('mt-0.5 truncate text-[11px] font-black uppercase');
  });

  it('Trophy Shelf fact chips print their values whole', () => {
    const shelf = readSource('src/components/profile/TrophyShelfPanel.tsx');
    expect(shelf).not.toContain('truncate text-sm font-black');
    expect(shelf).toContain('text-sm font-black leading-tight text-text-primary');
  });
});
