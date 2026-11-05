/**
 * Drift-fix F4 — Hunter composition (FIDELITY-AUDIT Hunter finding).
 *
 * The shipped Hunter Profile stop drifted from the approved
 * proposal (mock m36): the Trophy Shelf read as three stat boxes
 * with ellipsized values and no trophy in sight at a glance, the
 * identity was a full card with its own XP bar (duplicating the
 * Strip), and activity/world-pulse/death-record were three stacked
 * cards. F4 is composition ONLY — same stores, same payloads, same
 * doors:
 *
 *  - Identity + Trophy Shelf share ONE panel: a compact identity
 *    line (52px level tile, wrapping name, handle · Level, XP
 *    numbers — the bar itself stays in the Strip), then the shelf
 *    section rendering the server's top weapons as the REAL item
 *    instances through the compositor, names and fact values
 *    printing whole.
 *  - The Standings door is unchanged: same badged door, same live
 *    badge behavior (pinned by hunterV2).
 *  - Current Activity + World Pulse + Killed By merge into the
 *    single "Now" panel: feed one-liners (Status is the activity
 *    lead; Target and Scene ride its detail), the death record as
 *    the feed's final section, entries wrapping at the 11px floor.
 *
 * These tests pin the new composition: a rendered journey (the
 * trophy is the actual standout item, whole; the Now panel carries
 * every datum the three retired cards carried) and source pins for
 * the retired chrome.
 *
 * Register B rebuild (owner pick from the Hunter sub-page review
 * PDF, 2026-11-05): the Profile stop's identity + record + shelf
 * were recomposed as Service Telemetry — identity is its own unit
 * panel, the record one telemetry bank, the shelf a Pinned Units
 * spec sheet. The F4 facts survive (the trophy is the real
 * instance, printed whole; values never truncate; the Now panel
 * merge stands); the identity/shelf arrangement pins below are
 * the B composition's.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
  getWeeklyLeaderboards: vi.fn(async () => ({
    week: { key: '2026-10-26', start: '2026-10-26T00:00:00.000Z', ends_at: '2026-11-08T00:00:00.000Z' },
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
  })),
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
import { fetchProfileLifetime, type ProfileLifetimePayload } from '@/lib/api/verifiedOps';
import { useActivityStore, useInventoryStore, usePlayerStore, useSurvivalStore } from '@/store';
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

const TROPHY_NAME = 'Wraithsong Partitioner of the Ninth Reckoning';

function lifetimePayload(): ProfileLifetimePayload {
  return {
    kills: { roaming: 0, by_area: {}, by_weapon_type: {}, by_element: {}, elites: 0, named_elites_downed: 0 },
    deaths: 1,
    credits: { earned: 0, spent: 0, since: null },
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
    collections: { discovered: 2, by_family: {} },
    showcase: {
      top_weapons: [
        {
          id: 'w-trophy',
          item_level: 12,
          rarity: 'Legendary',
          is_locked: false,
          runtime_state: 'inventory',
          equipped_slot: 'primary',
          created_at: '2026-10-30T00:00:00.000Z',
          payload: {
            name: TROPHY_NAME,
            weaponType: 'Pistol',
            manufacturer: 'HelixWorks',
            element: 'Shock',
            rarity: 'Legendary',
            level: 12,
            pixelSeed: 42,
            rollQuality: 0.9,
          },
        },
      ],
      best_endless_depth: 7,
      cache_rank_tokens: 3,
      cache_rank_total_ranks: 2,
      collections_discovered: 2,
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
  useSurvivalStore.setState({
    deathLog: [
      { monsterId: 'm-1', monsterName: 'Overclocked Wraith Matriarch', areaId: 'dustwaste_frontier', at: Date.parse('2026-10-30T00:00:00.000Z') },
    ],
  });
  hoisted.auth.account = verifiedAccount;
}

beforeEach(() => {
  seedStores();
  vi.mocked(fetchProfileLifetime).mockReset();
  vi.mocked(fetchProfileLifetime).mockResolvedValue(lifetimePayload());
});

describe('Hunter composition — the Profile stop in Register B (Service Telemetry)', () => {
  it('the trophy is the real standout item, printed whole, on the Pinned Units spec sheet', async () => {
    render(<ProfileScreen onNavigate={() => {}} />);

    const row = await screen.findByTestId('trophy-weapon');
    // The rendered trophy IS the payload's instance: full name and
    // the spec line read straight off its fields (level · type ·
    // manufacturer · rarity · equipped, then the roll quality),
    // never a generic stand-in and never ellipsized.
    expect(row.textContent).toContain(TROPHY_NAME);
    expect(row.textContent).toContain('LV 12 · PISTOL · HELIXWORKS · LEGENDARY · EQUIPPED');
    expect(row.textContent).toContain('ROLL Q90');

    // Register B (owner pick, 2026-11-05) supersedes the F4
    // one-panel arrangement: the shelf is its own rack panel, and
    // the Cache Rank balance rides its foot as one readout row.
    const shelf = screen.getByTestId('trophy-shelf');
    expect(shelf.textContent).toContain('Pinned Units');
    expect(shelf.textContent).toContain('2 ranks · 3 tokens');

    // Identity is the unit panel now: name + handle print there,
    // and the level rides its LCD well (the bar stays in the Strip).
    const unit = screen.getByTestId('profile-unit-panel');
    expect(unit.textContent).toContain('tester');
    expect(unit.textContent).toContain('@hunter');
    expect(unit.querySelector('button[aria-label="Level: 5. Open the breakdown."]')).toBeTruthy();

    // The endless best depth prints exactly once — in the career
    // bank, never re-printed on the shelf.
    await screen.findByTestId('profile-career-panel');
    const stop = screen.getByTestId('hunter-section-profile');
    expect(stop.textContent).toContain('Endless Best Depth');
    expect(shelf.textContent).not.toContain('Best Depth');
  });
});

describe('Hunter composition — the Now panel', () => {
  it('one feed carries activity, milestones, and the death record', async () => {
    render(<ProfileScreen onNavigate={() => {}} />);

    // The panel and its mock-mandated strapline.
    expect(await screen.findByText('Now')).toBeTruthy();
    expect(screen.getByText('One feed — activity, milestones, records')).toBeTruthy();

    // Feed one-liners: boss progress and the best-weapon line
    // (empty inventory truthfully reports no weapon recorded).
    expect(screen.getByText(/No boss defeats yet/)).toBeTruthy();
    expect(screen.getByText(/Region 1 bosses defeated/)).toBeTruthy();
    expect(screen.getByText(/No weapon recorded/)).toBeTruthy();

    // The death record is the feed's final section, entries whole.
    expect(screen.getByText('Killed By')).toBeTruthy();
    expect(screen.getByText('1 recorded')).toBeTruthy();
    const entry = screen.getByTestId('death-log-entry');
    expect(entry.textContent).toContain('Overclocked Wraith Matriarch');

    // The three retired card titles are gone as surfaces.
    expect(screen.queryByText('Current Activity')).toBeNull();
    expect(screen.queryByText('World Pulse')).toBeNull();
  });
});

describe('Hunter composition — source pins for the retired chrome', () => {
  const readSource = (rel: string) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', rel), 'utf8');

  it('no value on the Hunter lead surfaces truncates', () => {
    const shelf = readSource('src/components/profile/TrophyShelfPanel.tsx');
    expect(shelf).not.toContain('truncate');
    const profile = readSource('src/screens/ProfileScreen.tsx');
    // The retired card's rendered title (comments may still name
    // the card they replaced; the surface itself must not exist).
    expect(profile).not.toContain('>Current Activity<');
    expect(profile).toContain('One feed — activity, milestones, records');
    // The identity XP bar is not re-printed under the identity
    // line — the Strip owns the bar (F1); the panel keeps numbers.
    expect(profile).not.toContain('xpProgress)}%` }}');
  });

  it('the feed form holds the 11px floor — no 10px text remains in the feed', () => {
    const feed = readSource('src/components/profile/WorldPulseFeed.tsx');
    expect(feed).not.toContain('text-[10px]');
  });
});
