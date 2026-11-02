/**
 * Hunter v2 (redesign Wave B) — the Hunter tab arrangement:
 * - The Trophy Shelf COLLECTIONS tile is a door: tapping it opens
 *   the Hunter → Collections stop, whose progress and found-state
 *   render from the real GET /api/collections/me payload (the
 *   CollectionsPayload wire shape), never from local invention.
 * - The Standings door's badge derives ONLY from the real weekly
 *   races payload (WeeklyLeaderboards wire shape): settled
 *   previous-week rewards the caller earned are the claimable
 *   count, the current week's ends_at drives the ends-soon pill,
 *   and with nothing waiting the door renders unbadged.
 * - The door opens the Standings stop with the leaderboards board
 *   mounted behind it (the retired Rank tab's content).
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
  fetchProfileLifetime: vi.fn(),
  fetchCollections: vi.fn(),
}));

vi.mock('@/lib/api/leaderboardService', () => ({
  getLeaderboard: vi.fn(async () => []),
  getWeeklyLeaderboards: vi.fn(),
}));

vi.mock('@/lib/api/publicProfileService', () => ({ getPublicProfile: vi.fn(async () => null) }));

vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getCacheRankState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getResearchState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

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

vi.mock('@/lib/api/masteryService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/masteryService')>()),
  getMyMasterySummary: vi.fn(async () => []),
}));

import { ProfileScreen } from '@/screens/ProfileScreen';
import { StandingsDoor } from '@/components/profile/StandingsDoor';
import { deriveStandingsBadge, EMPTY_STANDINGS_BADGE } from '@/components/profile/standingsBadge';
import { fetchCollections, fetchProfileLifetime, type ProfileLifetimePayload } from '@/lib/api/verifiedOps';
import { getWeeklyLeaderboards, type WeeklyLeaderboards, type WeeklyRaceBoard } from '@/lib/api/leaderboardService';
import { collectionEntriesForFamily, COLLECTION_TOTAL } from '@/content/collections';
import { useActivityStore, useInventoryStore, usePlayerStore } from '@/store';
import { IDLE_ACTIVITY } from '@/types/activity';
import type { AccountState } from '@/auth/accountState';

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

const race = (id: string, myReward: WeeklyRaceBoard['my_reward']): WeeklyRaceBoard => ({
  id,
  label: id,
  unit: 'kills',
  blurb: '',
  min_qualifying_value: 1,
  entries: [],
  participant_count: 3,
  me: null,
  my_reward: myReward,
});

const REWARD = { rank: 1, cache_keys: 2, buff_bonus: 0.1, buff_hours: 24, buff_expires_at: null };

function weeklyPayload(overrides: Partial<WeeklyLeaderboards> = {}): WeeklyLeaderboards {
  return {
    week: { key: '2026-10-26', start: '2026-10-26T00:00:00.000Z', ends_at: '2026-11-02T00:00:00.000Z' },
    races: [],
    previous_week: {
      key: '2026-10-19',
      start: '2026-10-19T00:00:00.000Z',
      ends_at: '2026-10-26T00:00:00.000Z',
      settled: true,
      settled_at: '2026-10-27T00:00:00.000Z',
      races: [],
    },
    my_drop_buff: null,
    ...overrides,
  };
}

function lifetimePayload(collectionsDiscovered: number): ProfileLifetimePayload {
  return {
    kills: { roaming: 0, by_area: {}, by_weapon_type: {}, elites: 0, named_elites_downed: 0 },
    bosses: { attempts: 0, victories: 0, by_boss: {}, downed: 0 },
    endless: { runs: 0, best_depth: 0, deaths: 0, banked: 0, abandoned: 0 },
    legendaries: { salvaged: 0, cores_minted: 0, cores_spent: 0, cores_balance: 0, discoveries_by_source: {} },
    caches: { opened: 0, rewarded_keys: 0 },
    crafting: { total_units: 0, units_by_kind: {} },
    consumables: { used_total: 0, top_used: [] },
    repair: { board_points_restored: 0, board_jobs_completed: 0, board_credits_earned: 0, self_points_restored: 0, self_jobs: 0 },
    dispatch: { completed: 0, foot: 0, courier: 0, credits_earned: 0 },
    extraction: { passes: 0, xp_awarded: 0 },
    market: { sales: 0, sales_volume: 0, fees_paid: 0, purchases: 0, purchases_volume: 0 },
    salvage: { items: 0, scrap_earned: 0 },
    reforges: 0,
    resurrections: 0,
    collections: { discovered: collectionsDiscovered, by_family: {} },
    showcase: {
      top_weapons: [],
      best_endless_depth: 0,
      cache_rank_tokens: 0,
      cache_rank_total_ranks: 0,
      collections_discovered: collectionsDiscovered,
    },
  };
}

function seedStores() {
  usePlayerStore.setState({
    id: 'test',
    name: 'tester',
    level: 5,
    xp: 0,
    credits: 0,
    scrap: 0,
    cacheKeys: 0,
    cacheKeyFragments: 0,
    legendaryCores: 0,
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
  useInventoryStore.setState({ items: [] });
  useActivityStore.setState({ current: IDLE_ACTIVITY, hydrated: true, pending: false, error: null });
  hoisted.auth.account = verifiedAccount;
}

beforeEach(() => {
  seedStores();
  vi.mocked(fetchProfileLifetime).mockReset();
  vi.mocked(fetchCollections).mockReset();
  vi.mocked(getWeeklyLeaderboards).mockReset();
  // Default: an uneventful week — no rewards, closes in six days.
  vi.mocked(getWeeklyLeaderboards).mockResolvedValue(weeklyPayload());
  vi.mocked(fetchProfileLifetime).mockRejectedValue(new Error('no chef in screen tests'));
  vi.mocked(fetchCollections).mockRejectedValue(new Error('no chef in screen tests'));
});

describe('deriveStandingsBadge — badge truth from the real weekly payload', () => {
  const NOW = Date.parse('2026-11-01T12:00:00.000Z');

  it('counts only SETTLED previous-week races the caller earned a reward in', () => {
    const data = weeklyPayload({
      previous_week: {
        ...weeklyPayload().previous_week,
        races: [race('kills', REWARD), race('bosses', REWARD), race('loot', null)],
      },
    });
    expect(deriveStandingsBadge(data, NOW).claimableCount).toBe(2);
  });

  it('counts nothing while last week is unsettled, even with rewards recorded', () => {
    const data = weeklyPayload({
      previous_week: {
        ...weeklyPayload().previous_week,
        settled: false,
        settled_at: null,
        races: [race('kills', REWARD)],
      },
    });
    expect(deriveStandingsBadge(data, NOW).claimableCount).toBe(0);
  });

  it('ends-soon fires inside the final 24h, not before, and not after the close', () => {
    const soon = weeklyPayload({
      week: { key: 'k', start: '2026-10-26T00:00:00.000Z', ends_at: '2026-11-02T00:00:00.000Z' },
    });
    expect(deriveStandingsBadge(soon, Date.parse('2026-11-01T12:00:00.000Z')).endsSoon).toBe(true);
    expect(deriveStandingsBadge(soon, Date.parse('2026-10-30T12:00:00.000Z')).endsSoon).toBe(false);
    expect(deriveStandingsBadge(soon, Date.parse('2026-11-02T12:00:00.000Z')).endsSoon).toBe(false);
  });

  it('null payload and buff passthrough', () => {
    expect(deriveStandingsBadge(null, NOW)).toEqual(EMPTY_STANDINGS_BADGE);
    const buffed = weeklyPayload({ my_drop_buff: { bonus: 0.15, expires_at: '2026-11-03T00:00:00.000Z' } });
    expect(deriveStandingsBadge(buffed, NOW).buff).toEqual({ bonus: 0.15, expiresAt: '2026-11-03T00:00:00.000Z' });
  });
});

describe('StandingsDoor — pills render only with real badge data', () => {
  it('unbadged door: no pills when nothing is waiting', () => {
    render(<StandingsDoor badge={EMPTY_STANDINGS_BADGE} onOpen={() => {}} />);
    expect(screen.getByTestId('standings-door')).toBeTruthy();
    expect(screen.queryByTestId('standings-claimable-pill')).toBeNull();
    expect(screen.queryByTestId('standings-ends-soon-pill')).toBeNull();
    expect(screen.queryByTestId('standings-buff-pill')).toBeNull();
  });

  it('badged door: claimable + ends-soon pills print, click opens', () => {
    const onOpen = vi.fn();
    render(
      <StandingsDoor
        badge={{ claimableCount: 2, endsAt: '2026-11-02T00:00:00.000Z', endsSoon: true, buff: null }}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByTestId('standings-claimable-pill').textContent).toContain('2 rewards waiting');
    expect(screen.getByTestId('standings-ends-soon-pill')).toBeTruthy();
    fireEvent.click(screen.getByTestId('standings-door'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('Hunter arrangement — Trophy tile door + Collections stop', () => {
  it('the Trophy Shelf collections tile opens Collections; progress matches the payload', async () => {
    const bossEntries = collectionEntriesForFamily('boss');
    const foundBoss = bossEntries[0];
    const missingBoss = bossEntries[1];
    vi.mocked(fetchProfileLifetime).mockResolvedValue(lifetimePayload(2));
    vi.mocked(fetchCollections).mockResolvedValue({
      legendary_cores: 7,
      discoveries: [
        { family: 'boss', entry_key: foundBoss.key, source: 'boss victory', discovered_at: '2026-10-30T00:00:00.000Z' },
        { family: 'named_elite', entry_key: 'dustwaste_frontier', source: 'roam elite', discovered_at: '2026-10-30T00:00:00.000Z' },
      ],
    });

    render(<ProfileScreen onNavigate={() => {}} />);

    // The tile exists on the Trophy Shelf and carries the server count.
    const tile = await screen.findByTestId('trophy-collections-tile');
    expect(tile.textContent).toContain(`2 / ${COLLECTION_TOTAL}`);

    // Collections content is NOT mounted before the door is used.
    expect(screen.queryByTestId(`collection-entry-boss-${foundBoss.key}`)).toBeNull();

    fireEvent.click(tile);

    // Found state comes from the payload, entry by entry.
    const foundCard = await screen.findByTestId(`collection-entry-boss-${foundBoss.key}`);
    expect(foundCard.getAttribute('data-found')).toBe('true');
    const missingCard = screen.getByTestId(`collection-entry-boss-${missingBoss.key}`);
    expect(missingCard.getAttribute('data-found')).toBe('false');

    // Header prints the payload's core balance; shelf progress is 2/81.
    const collectionsSection = screen.getByTestId('hunter-section-collections');
    expect(collectionsSection.textContent).toContain('7');
    expect(collectionsSection.textContent).toContain(`2 / ${COLLECTION_TOTAL}`);
  });

  it('guests reach Collections too — viewing is never locked', async () => {
    vi.mocked(fetchProfileLifetime).mockResolvedValue(lifetimePayload(0));
    vi.mocked(fetchCollections).mockResolvedValue({ legendary_cores: 0, discoveries: [] });
    render(<ProfileScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('hunter-stop-collections'));
    const entry = await screen.findByTestId(`collection-entry-boss-${collectionEntriesForFamily('boss')[0].key}`);
    expect(entry.getAttribute('data-found')).toBe('false');
  });
});

describe('Hunter arrangement — Standings door badge + stop', () => {
  it('door badge reflects the live payload; the door opens the boards', async () => {
    const endsSoon = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    vi.mocked(getWeeklyLeaderboards).mockResolvedValue(
      weeklyPayload({
        week: { key: 'k', start: '2026-10-26T00:00:00.000Z', ends_at: endsSoon },
        previous_week: {
          ...weeklyPayload().previous_week,
          races: [race('kills', REWARD), race('bosses', REWARD), race('loot', null)],
        },
      }),
    );

    render(<ProfileScreen onNavigate={() => {}} />);

    const pill = await screen.findByTestId('standings-claimable-pill');
    expect(pill.textContent).toContain('2 rewards waiting');
    expect(screen.getByTestId('standings-ends-soon-pill')).toBeTruthy();
    expect(screen.getByTestId('hunter-standings-count').textContent).toBe('2');

    fireEvent.click(screen.getByTestId('standings-door'));
    // The leaderboards board mounts behind the door (weekly races panel).
    expect(await screen.findByText('Weekly Races')).toBeTruthy();
    await waitFor(() => expect(getWeeklyLeaderboards).toHaveBeenCalled());
  });

  it('quiet week: the door renders with NO badge pills and no rail count', async () => {
    render(<ProfileScreen onNavigate={() => {}} />);
    expect(await screen.findByTestId('standings-door')).toBeTruthy();
    // Let the badge fetch settle.
    await waitFor(() => expect(getWeeklyLeaderboards).toHaveBeenCalled());
    expect(screen.queryByTestId('standings-claimable-pill')).toBeNull();
    expect(screen.queryByTestId('standings-ends-soon-pill')).toBeNull();
    expect(screen.queryByTestId('hunter-standings-count')).toBeNull();
  });
});
