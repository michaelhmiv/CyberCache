/**
 * First-screen lifts (owner-approved audit program, 2026-11-17) —
 * render-order pins for the SMALL LIFTS batch. Each pin names its
 * census item (~/workspace/cybercache-prep/cache-hunters/
 * first-screen-audit/CENSUS.md). The batch moves existing blocks
 * inside their screens' existing grammar; these tests pin the NEW
 * seats so a future reorder cannot silently bury the datum again.
 *
 *  1 (census 7)  Standings: MY READING directly under the datum.
 *  2 (census 7)  Profiles: View Full Profile in the sticky foot;
 *                Net Worth on the full sheet's meta line.
 *  3 (census 9)  Vendor: staples search/sort above the rotation.
 *  4 (census 8)  Repair + Shield Tech: workbench leads when full.
 *  5 (census 12) Cache Rank: Bonus Channels above Milestone Tape.
 *  6 (census 13) Wardrobe: Whole Skins list above the showcase.
 *  7 (census 11) Roam rundown: TARGET HP cell, not Shield Break.
 *  8 (census 10) Dispatch: the offer face prints the payload pay.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'guest-1' } as { id: string } | null,
    account: null as import('@/auth/accountState').AccountState | null,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false as boolean,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
  opNames: [
    'acceptListing', 'acceptRepairJob', 'acceptShieldTechJob', 'battleResult',
    'cancelCraftJob', 'cancelRepairJob', 'cancelShieldTechJob', 'claimCraftedConsumable',
    'consumeConsumable', 'disablePushDevice', 'enqueueCraftJob', 'enqueueRepairJob',
    'enqueueShieldTechJob', 'equipItem', 'finishRepairJob', 'finishShieldTechJob',
    'fitWorkshopTool', 'idleClaim', 'initialBundle', 'itemLock', 'makeItem',
    'marketCancel', 'marketCreate', 'marketCreateConsumable', 'marketCreateCore',
    'marketCreateEssence', 'marketCreateFragment', 'marketCreateMaterial',
    'postRepairJob', 'postShieldTechJob', 'reclaimRepairJob', 'reclaimShieldTechJob',
    'recycleItem', 'reforgeItem', 'refuelVehicle', 'registerPushDevice', 'resetProgress',
    'retrain', 'trainSkill', 'unequipSlot', 'unlockCraftBench', 'vendorBuy',
    'vendorSellConsumable', 'vendorSellGear', 'vendorSellMaterial',
  ],
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: Object.fromEntries(hoisted.opNames.map((name) => [name, vi.fn(async () => ({}))])),
  fetchWorkshopState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchRepairBoard: vi.fn(),
  fetchShieldTechBoard: vi.fn(),
  fetchCollections: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchProfileLifetime: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/chef/chefClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/chef/chefClient')>();
  return { ...original, getCacheRankState: vi.fn(), getDispatchState: vi.fn() };
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

import { BoardConsole } from '@/components/leaderboard/StandingsConsole';
import { PublicProfilePanel } from '@/components/profile/PublicProfilePanel';
import { PlayerProfileSheet } from '@/components/profile/PlayerProfileSheet';
import { VendorScreen } from '@/screens/VendorScreen';
import { RepairBoard } from '@/components/market/RepairBoard';
import { ShieldTechBoard } from '@/components/market/ShieldTechBoard';
import { CacheRankPanel } from '@/components/profile/CacheRankPanel';
import { WardrobePanel } from '@/components/profile/WardrobePanel';
import { HeroRundown } from '@/components/dashboard/HeroRundown';
import { DispatchPanel } from '@/components/dispatch/DispatchPanel';
import { fetchRepairBoard, fetchShieldTechBoard } from '@/lib/api/verifiedOps';
import { getCacheRankState, getDispatchState, type ChefDispatchState } from '@/lib/chef/chefClient';
import { cacheRankStateView } from '@/content/cacheRank';
import {
  useActivityStore,
  useInventoryStore,
  useKillCycleStore,
  usePlayerStore,
} from '@/store';
import { IDLE_ACTIVITY } from '@/types/activity';
import type { LeaderboardEntry, MyLeaderboardRank } from '@/lib/api/leaderboardService';
import type { PlayerPublicProfile } from '@/lib/api/publicProfileService';

afterEach(() => cleanup());

/** True when `a` comes before `b` in document order. */
const precedes = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

// ─── 1. Standings (census 7) ──────────────────────────────────────

const entry = (n: number): LeaderboardEntry => ({
  rank: n,
  player_id: `p-${n}`,
  username: `Hunter ${n}`,
  value: 1000 - n * 10,
  previous_value: null,
  trend: 0,
});

describe('first-screen lift 1 — standings MY READING seat', () => {
  it('pins MY READING directly under the column datum, ahead of the rows and the expand control', () => {
    const rows = Array.from({ length: 15 }, (_, i) => entry(i + 1));
    const myRank = {
      rank: 42, value: 500, previous_value: 480, trend: 1, total_players: 100,
    } as unknown as MyLeaderboardRank;
    render(
      <BoardConsole
        metric="level"
        period="all_time"
        onMetricChange={vi.fn()}
        onPeriodChange={vi.fn()}
        entries={rows}
        loading={false}
        myPlayerId="me"
        myRank={myRank}
        myRanks={{}}
        looks={{}}
        totalPlayers={100}
      />,
    );
    const reading = screen.getByTestId('standings-board-my-reading');
    const firstRow = screen.getAllByTestId(/^standings-row-p-/)[0];
    expect(precedes(reading, firstRow)).toBe(true);
    expect(precedes(reading, screen.getByTestId('standings-board-expand'))).toBe(true);
    expect(reading.textContent).toContain('RK 42');
  });
});

// ─── 2. Profiles (census 7) ───────────────────────────────────────

const publicProfile = {
  player_id: '22222222-2222-4222-8222-222222222222',
  username: 'bravo',
  display_name: null,
  level: 34,
  xp: 90210,
  net_worth: 123456,
  total_kills: 500,
  total_deaths: 25,
  kill_death_ratio: 20,
  highest_boss_tier: 6,
  total_mastery_xp: 4200,
  highest_mastery_level: 5,
  legendary_items: 2,
  total_items: 57,
  weapons_owned: 21,
  highest_item_level: 60,
  joined_at: '2026-08-14T00:00:00.000Z',
  last_active_at: '2026-11-02T00:00:00.000Z',
  showcase: null,
} as unknown as PlayerPublicProfile;

describe('first-screen lift 2 — profile door + meta line', () => {
  it('View Full Profile lives in the sticky foot, outside the scrolling body', () => {
    render(<PublicProfilePanel open onClose={() => {}} profile={publicProfile} onViewFull={() => {}} />);
    const button = screen.getByTestId('public-profile-view-full');
    // The foot is the button's direct parent: a shrink-0 band with
    // a top border — not an element of the overflow body.
    expect(button.parentElement?.className).toContain('shrink-0');
    expect(button.parentElement?.className).toContain('border-t');
    expect(button.closest('.overflow-y-auto')).toBeNull();
  });

  it('PlayerProfileSheet meta line carries Net Worth from the payload', () => {
    render(<PlayerProfileSheet open profile={publicProfile} onClose={() => {}} />);
    expect(screen.getByText(/Net worth 123,456 cr/)).toBeTruthy();
  });
});

// ─── 3. Vendor (census 9) ─────────────────────────────────────────

describe('first-screen lift 3 — vendor staples controls lead', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      credits: 100_000, consumables: {}, consumableBatches: [], materials: {}, essences: {},
    } as never);
    useInventoryStore.setState({ items: [] } as never);
  });

  it('the staples search input renders above Today\'s Rotation and still drives the staples list', () => {
    render(<VendorScreen />);
    const search = screen.getByPlaceholderText('Search vendor…');
    expect(precedes(search, screen.getByText("Today's Rotation"))).toBe(true);
    // Same useFilterSort state, not a fork: typing filters the list.
    fireEvent.change(search, { target: { value: 'zzzz-no-match' } });
    expect(screen.getByText('No vendor items match your search or filter.')).toBeTruthy();
  });
});

// ─── 4. Service boards (census 8) ────────────────────────────────

const repairJob = {
  id: 'job-1',
  ownerUserId: 'owner-9',
  providerUserId: null as string | null,
  status: 'listed',
  outcome: null,
  vehicle: {
    itemId: 'veh-1', classId: 'dune_buggy', className: 'Dune Buggy', rarity: 'Rare',
    conditionCurrent: 20, conditionMax: 50,
  },
  targetPoints: 30,
  pointsRestored: 0,
  progress: 0,
  kitProgress: 0,
  priceCredits: 600,
  creditsPerPoint: 20,
  kitType: null,
  kitsConsumed: [],
  paidCredits: null,
  feeCredits: null,
  xpAwarded: null,
  createdAtMs: Date.now(),
  acceptedAtMs: null as number | null,
  completedAtMs: null,
  expiresAtMs: Date.now() + 48 * 3600_000,
  reclaimable: false,
  queuePosition: null,
};

const repairBoard = (work: unknown[]) => ({
  open: [repairJob],
  mine: [],
  work,
  stats: { medianCreditsPerPoint: 20, medianSampleSize: 3, myMasteryLevel: 1, myJobsCompleted: 0, myJobsAbandoned: 0 },
  levers: { serviceXpPerPoint: 2, repairAbandonWindowHours: 24, repairListingExpiryDays: 3, marketFeeRate: 0.05 },
});

const shieldJob = {
  id: 'stjob-1',
  ownerUserId: 'owner-9',
  ownerName: null,
  providerUserId: null as string | null,
  providerName: null,
  status: 'listed',
  outcome: null,
  shield: { itemId: 'shield-1', rarity: 'Rare', capacity: 1500, behavior: 'standard' as const, behaviorName: 'Standard' },
  fromBehavior: 'standard' as const,
  fromBehaviorName: 'Standard',
  fromBehaviorDescription: null,
  toBehavior: 'nova' as const,
  toBehaviorName: 'Nova',
  toBehaviorDescription: null,
  flipApplied: null,
  targetPoints: 1500,
  pointsCalibrated: 0,
  progress: 0,
  coreProgress: 0,
  priceCredits: 900,
  creditsPerPoint: 0.6,
  estimatedCoresForReader: null,
  kitsConsumed: [],
  paidCredits: null,
  feeCredits: null,
  xpAwarded: null,
  createdAtMs: Date.now(),
  acceptedAtMs: null as number | null,
  completedAtMs: null,
  expiresAtMs: Date.now() + 48 * 3600_000,
  lastProgressAtMs: null,
  reclaimable: false,
  queuePosition: null,
};

const shieldBoard = (work: unknown[]) => ({
  open: [shieldJob],
  mine: [],
  work,
  medianPerThousandByRarity: {},
  stats: { medianSampleSize: 0, myMasteryLevel: 1, myMasteryXp: 0, myJobsCompleted: 0, myJobsAbandoned: 0 },
  levers: { shieldTechXpPerPoint: 2, shieldTechAbandonWindowHours: 24, shieldTechListingExpiryDays: 3, marketFeeRate: 0.05 },
});

describe('first-screen lift 4 — My workbench leads when non-empty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({ credits: 100_000, consumables: {}, materials: {} } as never);
    useInventoryStore.setState({ items: [] } as never);
  });

  it('repair: workbench precedes Post a job and Open postings; empty workbench keeps shipped order', async () => {
    const workJob = { ...repairJob, id: 'work-1', status: 'in_progress', providerUserId: 'guest-1', acceptedAtMs: Date.now() - 60_000 };
    vi.mocked(fetchRepairBoard).mockResolvedValue(repairBoard([workJob]) as never);
    const { unmount } = render(<RepairBoard />);
    const bench = await screen.findByText('My workbench');
    expect(precedes(bench, screen.getByText('Post a repair job'))).toBe(true);
    expect(precedes(bench, screen.getByText('Open postings'))).toBe(true);
    unmount();

    vi.mocked(fetchRepairBoard).mockResolvedValue(repairBoard([]) as never);
    render(<RepairBoard />);
    expect(await screen.findByText('Post a repair job')).toBeTruthy();
    expect(screen.queryByText('My workbench')).toBeNull();
    expect(precedes(screen.getByText('Post a repair job'), screen.getByText('Open postings'))).toBe(true);
  });

  it('shield tech: workbench precedes Post a recalibration and Open postings; empty keeps shipped order', async () => {
    const workJob = { ...shieldJob, id: 'stwork-1', status: 'in_progress', providerUserId: 'guest-1', acceptedAtMs: Date.now() - 60_000 };
    vi.mocked(fetchShieldTechBoard).mockResolvedValue(shieldBoard([workJob]) as never);
    const { unmount } = render(<ShieldTechBoard />);
    const bench = await screen.findByText('My workbench');
    expect(precedes(bench, screen.getByText('Post a recalibration'))).toBe(true);
    expect(precedes(bench, screen.getByText('Open postings'))).toBe(true);
    unmount();

    vi.mocked(fetchShieldTechBoard).mockResolvedValue(shieldBoard([]) as never);
    render(<ShieldTechBoard />);
    expect(await screen.findByText('Post a recalibration')).toBeTruthy();
    expect(screen.queryByText('My workbench')).toBeNull();
  });
});

// ─── 5. Cache Rank (census 12) ────────────────────────────────────

describe('first-screen lift 5 — Bonus Channels above the Milestone Tape', () => {
  it('channels render ahead of the milestone markers', async () => {
    const view = cacheRankStateView({ level: 10, playerXp: 40, tokens: 14, grantLevel: 10, spends: { credits: 2 } });
    vi.mocked(getCacheRankState).mockResolvedValue({ cacheRank: view } as never);
    render(<CacheRankPanel />);
    const channels = await screen.findByText('Bonus channels');
    expect(precedes(channels, screen.getByText('Milestone markers'))).toBe(true);
  });
});

// ─── 6. Wardrobe (census 13) ──────────────────────────────────────

describe('first-screen lift 6 — Whole Skins list above the showcase', () => {
  it('the skins panel precedes the showcase panel', () => {
    render(<WardrobePanel />);
    expect(precedes(screen.getByTestId('wardrobe-skins'), screen.getByTestId('wardrobe-rig'))).toBe(true);
  });
});

// ─── 7. Roam rundown (census 11) ──────────────────────────────────

describe('first-screen lift 7 — roam rundown TARGET HP cell', () => {
  beforeEach(() => {
    useActivityStore.setState({
      current: { ...IDLE_ACTIVITY, kind: 'roaming_loot', targetType: 'roaming_area', targetId: 'dustwaste_frontier' },
    } as never);
    useKillCycleStore.setState({
      currentTargetId: 'dustwaste_raider', currentTargetHp: 6000, currentTargetHpMax: 12000,
    } as never);
  });

  it('roam: TARGET HP takes the fourth cell with the kill cycle\'s numbers; Shield Break is gone', () => {
    render(<HeroRundown />);
    const cell = screen.getByTestId('hero-stat-targetHp');
    expect(cell.textContent).toContain('Target HP');
    expect(cell.textContent).toContain('6,000/12,000');
    expect(screen.queryByTestId('hero-stat-shieldBreak')).toBeNull();
  });

  it('roam between spawns: the cell holds its seat on an em dash', () => {
    useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 } as never);
    render(<HeroRundown />);
    expect(screen.getByTestId('hero-stat-targetHp').textContent).toContain('—');
    expect(screen.queryByTestId('hero-stat-shieldBreak')).toBeNull();
  });

  it('other modes: Shield Break keeps the cell; TARGET HP never renders', () => {
    useActivityStore.setState({
      current: { ...IDLE_ACTIVITY, kind: 'boss_fight', targetType: 'boss' },
    } as never);
    render(<HeroRundown />);
    expect(screen.queryByTestId('hero-stat-targetHp')).toBeNull();
    expect(screen.getByTestId('hero-stat-shieldBreak')).toBeTruthy();
  });
});

// ─── 8. Dispatch face (census 10) ─────────────────────────────────

describe('first-screen lift 8 — dispatch offer face prints the payload pay', () => {
  it('an offer with a payout prints Pays on its face; a null payout prints none', async () => {
    const state: ChefDispatchState = {
      slots: 2,
      slotsUsed: 0,
      playerLevel: 50,
      vehicleFuel: 0,
      credits: 5000,
      boardIndex: 0,
      boardDay: '2026-11-03',
      rerollsUsed: 0,
      rerollsRemaining: 3,
      rerollPrice: 250,
      departedOfferIds: [],
      offers: [
        {
          id: 'offer-foot-1', family: 'foot', areaId: 'dustwaste', durationHours: 2,
          areaName: 'Dustwaste Frontier', dangerRating: 'Low',
          payout: { credits: 120, scrap: 45, materialId: 'scrap_metal', materialUnits: 3 },
        },
        {
          id: 'offer-courier-1', family: 'courier', areaId: 'dustwaste', durationHours: 4,
          areaName: 'Dustwaste Frontier', dangerRating: 'High',
          payout: null,
        },
      ],
      missions: [],
      candidates: [],
    };
    vi.mocked(getDispatchState).mockResolvedValue({ verified: true, dispatch: state } as never);
    render(<DispatchPanel />);
    const pays = await screen.findByText('Pays: 120 cr · 45 scrap · 3 scrap_metal');
    const footButton = pays.closest('button');
    expect(footButton?.textContent).toContain('Dustwaste Frontier');
    const courierButton = screen.getByText('High danger').closest('button');
    expect(courierButton).not.toBeNull();
    expect(within(courierButton as HTMLElement).queryByText(/Pays:/)).toBeNull();
  });
});
