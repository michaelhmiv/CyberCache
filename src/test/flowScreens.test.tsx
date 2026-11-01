/**
 * Flow-fix mounted regressions:
 * - F5: Action-tab salvage EXECUTES the verified recycle op instead of
 *   staging an activity nothing consumes; the action slot is untouched.
 * - F11: a dropped item in the loot feed opens an inspect sheet with
 *   working Equip / Salvage actions (previously Close only).
 * - F7: Dashboard start failures stay on the Dashboard with the error
 *   visible (the old finally-block navigated away from the error).
 * - F16: Dashboard "Choose Boss" opens the boss picker callback
 *   instead of landing on a boss-less Fight tab.
 * - F6: Leaderboards enforces the account gate for guests (no fetch,
 *   lock + sign-in shown) and surfaces fetch failures with Retry
 *   instead of an eternal spinner.
 * - F9: a guest's Profile carries a "Link Google" row that runs the
 *   existing in-place upgrade; verified accounts don't see it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
    recycleItem: vi.fn(),
    equipItem: vi.fn(),
  },
  // 0034: Profile's trophy-shelf / lifetime panels fetch on mount.
  // No Chef exists behind these screen tests, so the fetch rejects
  // and the panels stay hidden — their designed unreachable-Chef
  // behavior — leaving the rest of Profile exactly as shipped.
  fetchProfileLifetime: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/api/leaderboardService', () => ({
  getLeaderboard: vi.fn(),
  // Weekly races (0035): resolves an empty slate so the F6 tests
  // exercise the all-time board's gate/error flow undisturbed.
  getWeeklyLeaderboards: vi.fn(() => Promise.resolve({
    week: { key: '2026-10-26', start: '2026-10-26T00:00:00.000Z', ends_at: '2026-11-02T00:00:00.000Z' },
    races: [],
    previous_week: {
      key: '2026-10-19', start: '2026-10-19T00:00:00.000Z', ends_at: '2026-10-26T00:00:00.000Z',
      settled: false, settled_at: null, races: [],
    },
    my_drop_buff: null,
  })),
}));
vi.mock('@/lib/api/publicProfileService', () => ({ getPublicProfile: vi.fn(async () => null) }));
// Chef state reads: default to an unreachable Chef (the panels'
// designed hidden state, like fetchProfileLifetime above); the
// GUEST-01 test resolves real-shaped state views to prove the
// guest previews render from them.
vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getCacheRankState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));
// Spread the real modules: child components import pure helpers from
// these services (e.g. extractMetricSeries) that must stay real.
vi.mock('@/lib/api/statsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/statsService')>()),
  getMyStatsSummary: vi.fn(async () => null),
}));
vi.mock('@/lib/api/usernameService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/usernameService')>()),
  getMyProfileSummary: vi.fn(async () => null),
}));
vi.mock('@/lib/api/progressionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/progressionService')>()),
  getMyProgressionSnapshots: vi.fn(async () => []),
}));

import { ActionScreenContextual } from '@/screens/ActionScreenContextual';
import { DashboardScreen } from '@/screens/DashboardScreen';
import { LeaderboardsScreen } from '@/screens/LeaderboardsScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { getLeaderboard } from '@/lib/api/leaderboardService';
import { getCacheRankState, getLoginStreakState } from '@/lib/chef/chefClient';
import {
  useActivityStore,
  useBossStore,
  useIdleStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useTickFeedStore,
} from '@/store';
import { IDLE_ACTIVITY } from '@/types/activity';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { AccountState } from '@/auth/accountState';

const weapon: Weapon = {
  id: 'weapon-1',
  name: 'Test Weapon',
  level: 1,
  rarity: Rarity.Common,
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Redline,
  element: Element.Kinetic,
  rollQuality: 50,
  baseDamage: 10,
  attackSpeed: 1,
  critChance: 0.1,
  critDamage: 1.5,
  statusChance: 0,
  statusDamage: 0,
  bossDamageMod: 0,
  waveDamageMod: 0,
  shieldDamageMod: 0,
  armorDamageMod: 0,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  parts: [],
  affixes: [],
  legendaryEffectId: undefined,
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 0,
  combatPower: 0,
  bossPower: 0,
  farmPower: 0,
  economyScore: 0,
};

const guestAccount: AccountState = {
  userId: 'user-1',
  accountType: 'guest',
  username: null,
  hasUsername: false,
  email: null,
  emailVerifiedAt: null,
  verificationGraceExpiresAt: null,
  verificationReminderLastSeenAt: null,
  isAnonymous: true,
};

const verifiedAccount: AccountState = {
  userId: 'user-1',
  accountType: 'verified',
  username: 'hunter',
  hasUsername: true,
  email: 'hunter@example.com',
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  verificationGraceExpiresAt: null,
  verificationReminderLastSeenAt: null,
  isAnonymous: false,
};

function seedStores() {
  useLoadoutStore.setState({
    slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({
    id: 'test',
    name: 'tester',
    level: 5,
    xp: 0,
    credits: 0,
    scrap: 0,
    cacheKeys: 0,
    cacheKeyFragments: 0,
    currentZoneId: 'dustwaste_1',
    highestZoneId: 'dustwaste_1',
    offlineCapHours: 2,
    lastClaimTime: 0,
    deathFeeInsurance: false,
    consumables: {},
    consumableBatches: [],
    materials: {},
    essences: {},
    workshopQueues: [],
    lastWorkshopTick: 0,
    lastClaimedTick: 0,
  });
  useInventoryStore.setState({ items: [weapon] });
  useActivityStore.setState({ current: IDLE_ACTIVITY, hydrated: true, pending: false, error: null });
  useBossStore.setState({ currentBossId: null, defeatedBossIds: [], preparedConsumables: {} });
  useTickFeedStore.setState({ events: [] });
  hoisted.auth.account = verifiedAccount;
  hoisted.auth.signInWithGoogle.mockClear();
}

beforeEach(() => {
  vi.mocked(verifiedOps.recycleItem).mockReset();
  vi.mocked(verifiedOps.equipItem).mockReset();
  vi.mocked(getLeaderboard).mockReset();
  // Back to the unreachable-Chef default (a bare mockReset would
  // resolve undefined and break the panels' result handling).
  vi.mocked(getLoginStreakState).mockImplementation(async () => { throw new Error('no chef in screen tests'); });
  vi.mocked(getCacheRankState).mockImplementation(async () => { throw new Error('no chef in screen tests'); });
  seedStores();
});

describe('F5 — Action-tab salvage executes through the verified op', () => {
  it('recycles the picked item immediately and never stages an activity', async () => {
    vi.mocked(verifiedOps.recycleItem).mockResolvedValue({
      scrap_award: 42,
      cores_award: 0,
      bonus_material: null,
    } as never);
    render(<ActionScreenContextual onNavigate={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch Action' }));
    // The switch drawer's Salvage row (label + "N items" detail).
    const salvageRow = (await screen.findAllByRole('button')).find(
      (b) => b.textContent?.includes('Salvage') && b.textContent?.includes('items'),
    );
    expect(salvageRow).toBeDefined();
    fireEvent.click(salvageRow!);
    // The item picker offers the owned weapon with its base estimate.
    const row = await screen.findByText('Test Weapon');
    fireEvent.click(row.closest('button') ?? row);

    await waitFor(() => expect(verifiedOps.recycleItem).toHaveBeenCalledWith('weapon-1'));
    expect(await screen.findByText(/SALVAGED/)).toBeInTheDocument();
    expect(screen.getByText(/\+42 scrap/)).toBeInTheDocument();
    // The personal action slot was never occupied by a phantom activity.
    expect(useActivityStore.getState().current.kind).toBe(IDLE_ACTIVITY.kind);
  });

  it('surfaces a recycle failure in the feed instead of swallowing it', async () => {
    vi.mocked(verifiedOps.recycleItem).mockRejectedValue(new Error('Item is equipped'));
    render(<ActionScreenContextual onNavigate={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch Action' }));
    const salvageRow = (await screen.findAllByRole('button')).find(
      (b) => b.textContent?.includes('Salvage') && b.textContent?.includes('items'),
    );
    expect(salvageRow).toBeDefined();
    fireEvent.click(salvageRow!);
    const row = await screen.findByText('Test Weapon');
    fireEvent.click(row.closest('button') ?? row);

    expect(await screen.findByText(/SALVAGE FAILED/)).toBeInTheDocument();
    expect(screen.getByText(/Item is equipped/)).toBeInTheDocument();
  });
});

describe('F11 — dropped items are actionable from the loot feed', () => {
  it('the feed inspect sheet equips the drop through the verified op', async () => {
    vi.mocked(verifiedOps.equipItem).mockResolvedValue({} as never);
    const areaId = useIdleStore.getState().selectedRoamingAreaId;
    useActivityStore.setState({
      current: { ...IDLE_ACTIVITY, kind: 'roaming_loot', targetType: 'roaming_area', targetId: areaId },
    });
    useTickFeedStore.setState({
      events: [{ id: 'tick-1', at: Date.now(), tone: 'loot', label: 'Test Weapon', detail: 'world drop', gear: weapon }],
    });
    render(<ActionScreenContextual onNavigate={() => {}} />);

    const affordance = await screen.findByText(/Tap to inspect/);
    fireEvent.click(affordance.closest('button') ?? affordance);
    const equipButton = await screen.findByRole('button', { name: 'Equip' });
    fireEvent.click(equipButton);

    await waitFor(() => expect(verifiedOps.equipItem).toHaveBeenCalledWith('weapon-1', 'primary'));
    await waitFor(() => expect(screen.queryByText('Loot Log Inspect')).toBeNull());
  });
});

describe('F7/F16 — Dashboard errors stay put; Choose Boss opens the picker', () => {
  it('a failed roaming start shows the error and does NOT navigate', async () => {
    const onNavigate = vi.fn();
    useActivityStore.setState({
      start: vi.fn(async () => {
        throw new Error('Activity service unavailable');
      }) as never,
    });
    render(<DashboardScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Start Roam'));
    expect(await screen.findByText('Activity service unavailable')).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalledWith('fight');
  });

  it('a successful roaming start navigates to the Fight tab', async () => {
    const onNavigate = vi.fn();
    useActivityStore.setState({
      start: vi.fn(async () => IDLE_ACTIVITY) as never,
    });
    render(<DashboardScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Start Roam'));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('fight'));
  });

  it('NAV-01: the Action Board Roaming row is navigation only — it never starts the run', async () => {
    const onNavigate = vi.fn();
    const start = vi.fn(async () => IDLE_ACTIVITY);
    useActivityStore.setState({ start: start as never });
    render(<DashboardScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Roaming'));
    expect(onNavigate).toHaveBeenCalledWith('fight');
    expect(start).not.toHaveBeenCalled();
  });

  it('Choose Boss (no current boss) fires the picker callback, not a navigation', async () => {
    const onNavigate = vi.fn();
    const onOpenBossSelect = vi.fn();
    render(<DashboardScreen onNavigate={onNavigate} onOpenBossSelect={onOpenBossSelect} />);
    fireEvent.click(screen.getByText('Choose Boss'));
    expect(onOpenBossSelect).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalledWith('fight');
  });
});

describe('F6 — Leaderboards gate + error state', () => {
  it('guests see the lock and sign-in path; no leaderboard fetch fires', async () => {
    hoisted.auth.account = guestAccount;
    render(<LeaderboardsScreen />);
    expect(await screen.findByText('Sign in with Google to unlock leaderboards.')).toBeInTheDocument();
    expect(screen.getByText('Sign in with Google — keep your progress')).toBeInTheDocument();
    expect(getLeaderboard).not.toHaveBeenCalled();
  });

  it('GUEST-01: guests get read-only streak + cache-rank previews above the lock', async () => {
    hoisted.auth.account = guestAccount;
    // State views in the exact shapes the Chef returns
    // (ChefLoginStreakResult / ChefCacheRankStateResult).
    vi.mocked(getLoginStreakState).mockResolvedValue({
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
        ],
        missRule: 'Miss a day and the streak restarts at Day 1 — your longest streak is kept on your profile.',
      },
      granted: {
        alreadyClaimed: true,
        streakLength: 3,
        cycleDay: 3,
        tier: 1,
        creditsAwarded: 0,
        fragmentsAwarded: 0,
        cacheKeysAwarded: 0,
      },
      profile: null,
    } as never);
    vi.mocked(getCacheRankState).mockResolvedValue({
      verified: true,
      cacheRank: {
        tokens: 2,
        tokensEarned: 2,
        level: 3,
        xpIntoLevel: 10,
        xpForLevel: 100,
        nextTokenLevel: 4,
        milestones: [{ level: 10, bundle: 5, claimed: false }],
        tracks: [
          {
            id: 'greed', name: 'Greed', summary: '+ credits earned', glyph: '⬢', color: '#F2C063',
            ranks: 0, maxRanks: 10, effect: 0, perRank: 0.01, nextCost: 1, maxed: false,
          },
        ],
        bonuses: {},
      },
    } as never);
    render(<LeaderboardsScreen />);

    // The guest's own progress renders…
    expect(await screen.findByText('Login Streak')).toBeInTheDocument();
    expect(await screen.findByText('Cache Rank')).toBeInTheDocument();
    // …read-only: the preview carries the spend pointer, never a spend button.
    expect(screen.getByText(/Spend tokens from the Cache Rank panel on your Hunter profile/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /⬢ 1/ })).toBeNull();
    // …and the leaderboard tables stay locked, unfetched.
    expect(screen.getByText('Sign in with Google to unlock leaderboards.')).toBeInTheDocument();
    expect(getLeaderboard).not.toHaveBeenCalled();
  });

  it('a failed fetch shows an error panel with Retry (no eternal spinner)', async () => {
    vi.mocked(getLeaderboard).mockRejectedValue(new Error('boom 500'));
    render(<LeaderboardsScreen />);
    expect(await screen.findByText('Leaderboards unavailable')).toBeInTheDocument();
    expect(screen.getByText(/boom 500/)).toBeInTheDocument();
    vi.mocked(getLeaderboard).mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(getLeaderboard).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No leaderboard data yet.')).toBeInTheDocument();
  });
});

describe('F9 — Profile carries the guest Google link row', () => {
  it('guests see Link Google and tapping it starts the in-place upgrade', async () => {
    hoisted.auth.account = guestAccount;
    render(<ProfileScreen onNavigate={() => {}} />);
    const row = await screen.findByText('Link Google');
    fireEvent.click(row.closest('button') ?? row);
    expect(hoisted.auth.signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('verified accounts do not see the link row', async () => {
    render(<ProfileScreen onNavigate={() => {}} />);
    // Let the screen settle, then assert absence.
    await screen.findByText('Sign Out');
    expect(screen.queryByText('Link Google')).toBeNull();
  });
});
