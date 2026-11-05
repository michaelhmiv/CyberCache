/**
 * Home consolidation (owner steers 2026-11-03) — the pins for the
 * consolidated Home:
 *
 *  - ONE hero rundown at the stage's foot, two rows of four:
 *    DPS · Dmg/tick · Crit % · Crit × over HP · Shield · Mit ·
 *    Shield Break, each exactly once; the "ROAMING" mode word
 *    prints nowhere; tapping a hero opens the breakdown sheet
 *    FOCUSED on that stat.
 *  - The Loadout block is off Home (source pin) — Gear → Loadout
 *    is the canonical surface.
 *  - The Next Move card is REMOVED (owner device review): it
 *    never renders, even under live waits — each wait keeps
 *    its own door (Workshop, Return Sheet, top-bar sheets,
 *    the Chest, Hunter → Research).
 *  - The vehicle chip rides the belt row: quiet fuel readout
 *    while fueled; a remedy door when out of fuel — Garage with
 *    a cell carried, Vendor without.
 *  - Hunter → Profile's Totals & Sources door opens the full
 *    (unfocused) source breakdown — the deck panel's rehoused job.
 *
 * The render harness mirrors actionControlsOnStage.test.tsx
 * (same mocks, same store seeding) — this screen's habitat.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  fetchProfileLifetime: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/api/leaderboardService', () => ({
  getLeaderboard: vi.fn(),
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
vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getCacheRankState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getResearchState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getStandingState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getContractsState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
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

import { ActionScreenContextual } from '@/screens/ActionScreenContextual';
import { ProfileScreen } from '@/screens/ProfileScreen';
import {
  useActivityStore,
  useBossStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSurvivalStore,
  useTickFeedStore,
  useWorkshopStore,
} from '@/store';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { IDLE_ACTIVITY } from '@/types/activity';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { SettlementRecap } from '@/lib/activity/activitySettlement';
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

const bike: VehicleDisplay = {
  id: 'veh-1',
  name: 'Scrap Bike',
  vehicleClassId: 'scrap_bike',
  level: 1,
  rarity: Rarity.Common,
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 7,
  conditionCurrent: 90,
  conditionMax: 100,
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
    slots: { primary: 'weapon-1', secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, vehicle: null },
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
    vehicleFuel: 0,
  });
  useInventoryStore.setState({ items: [weapon] });
  useActivityStore.setState({ current: IDLE_ACTIVITY, hydrated: true, pending: false, error: null });
  useBossStore.setState({ currentBossId: null, defeatedBossIds: [], preparedConsumables: {} });
  useTickFeedStore.setState({ events: [] });
  useSurvivalStore.setState({ currentHp: 800, shieldHp: 0, isDead: false, medKitBuffer: 0 });
  useVehicleStore.setState({ vehicles: [], lastClaimStatus: null });
  useWorkshopStore.setState({ server: null, loading: false, error: null });
  useOfflineRecapStore.getState().reset();
  hoisted.auth.account = verifiedAccount;
  hoisted.auth.signInWithGoogle.mockClear();
}

beforeEach(() => {
  localStorage.clear();
  seedStores();
});

const readSource = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('hero rundown — one printing of each hero stat', () => {
  it('renders the eight heroes exactly once across two rows, HP as current/max, and no ROAMING word anywhere', async () => {
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);
    const rundown = await screen.findByTestId('hero-rundown');
    expect(screen.getAllByTestId('hero-stat-dps')).toHaveLength(1);
    expect(screen.getAllByTestId('hero-stat-dmgTick')).toHaveLength(1);
    expect(screen.getAllByTestId('hero-stat-critChance')).toHaveLength(1);
    expect(screen.getAllByTestId('hero-stat-critDamage')).toHaveLength(1);
    expect(screen.getAllByTestId('hero-stat-hp')).toHaveLength(1);
    expect(screen.getAllByTestId('hero-stat-shield')).toHaveLength(1);
    expect(screen.getAllByTestId('hero-stat-mitigation')).toHaveLength(1);
    expect(screen.getAllByTestId('hero-stat-shieldBreak')).toHaveLength(1);
    expect(within(rundown).getByTestId('hero-stat-hp').textContent).toMatch(/\d[\d,]*\/\d[\d,]*/);
    expect(within(rundown).getByTestId('hero-stat-critChance').textContent).toContain('%');
    // The mode word is dead on the whole screen.
    expect(document.body.textContent).not.toContain('ROAMING');
    // The retired duplicates stay retired.
    expect(screen.queryByText('Hunter Totals')).toBeNull();
    expect(screen.queryByTestId('vehicle-status')).toBeNull();
  });

  it('tapping the DPS hero opens the breakdown sheet focused on DPS', async () => {
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);
    fireEvent.click(await screen.findByTestId('hero-stat-dps'));
    const focus = await screen.findByTestId('breakdown-focus');
    expect(screen.getByText('Source Breakdown')).toBeTruthy();
    expect(focus.textContent).toContain('DPS');
  });

  it('the Loadout block is off Home (source): the screen mounts no ActionLoadout', () => {
    const source = readSource('src/screens/ActionScreenContextual.tsx');
    expect(source).not.toContain('ActionLoadout');
    expect(source).not.toContain('StageStatsBand');
    expect(source).not.toContain('ActivityModifierPanel');
    expect(source).not.toContain('ResearchChip');
  });
});

describe('Next Move — removed (owner device review, 2026-11-03)', () => {
  // The card shipped in the consolidation and the owner rejected
  // the surface on device: it is gone entirely, not hidden. These
  // pins keep it gone UNDER LIVE WAITS — the states that used to
  // summon it — and pin the source so the mount cannot creep
  // back. Every wait keeps its own door: the finished craft reads
  // on the Workshop's benches, the away settlement behind the
  // level chip's Return Sheet, contracts and weekly earnings in
  // the top bar's sheets, the free cache at the Chest.
  it('no card when nothing waits', async () => {
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);
    await screen.findByTestId('hero-rundown');
    await waitFor(() => expect(screen.queryByTestId('next-move-card')).toBeNull());
    expect(screen.queryByTestId('next-move-card')).toBeNull();
  });

  it('no card while a finished craft waits in the Workshop', async () => {
    useWorkshopStore.setState({
      server: {
        benches: 1,
        tools: { owned: {}, fitted: {}, charges: {} },
        jobs: [],
        masteries: {},
        activeActionKind: null,
        recentCompletions: [{ jobId: 'job-1', recipeId: 'dmg-tonic', name: 'Damage Tonic' }],
      },
    });
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);
    await screen.findByTestId('hero-rundown');
    await waitFor(() => expect(screen.queryByTestId('next-move-card')).toBeNull());
    expect(screen.queryByTestId('next-move-card')).toBeNull();
  });

  it('no card while an unreviewed away settlement stands', async () => {
    useOfflineRecapStore.getState().setSettlement({
      settled: true,
      areaId: 'dustwaste',
      areaName: 'Dustwaste',
      timeAway: '1h 2m',
      elapsedMs: 3_720_000,
      cappedMs: 3_720_000,
      capReached: false,
      capHours: 4,
      ticksSettled: 10,
      startTick: 0,
      endTick: 10,
      profile: {},
      rewards: {
        creditsAwarded: 500, scrapAwarded: 12, xpAwarded: 40, cacheFragmentsAwarded: 0,
        materials: {}, essences: {}, killsRecorded: 3, ticks: 10,
      },
      items: [],
      feedEvents: [],
      idempotent: false,
    } as unknown as SettlementRecap);
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);
    await screen.findByTestId('hero-rundown');
    await waitFor(() => expect(screen.queryByTestId('next-move-card')).toBeNull());
    expect(screen.queryByTestId('next-move-card')).toBeNull();
  });

  it('the mount is out of the screen source', () => {
    const source = readSource('src/screens/ActionScreenContextual.tsx');
    expect(source).not.toContain('NextMoveCard');
    expect(source).not.toContain('next-move');
  });
});

describe('vehicle chip — in the belt row, both fuel states', () => {
  function seedBike(fuel: number, consumables: Record<string, number> = {}) {
    useLoadoutStore.setState({
      slots: { primary: 'weapon-1', secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, vehicle: 'veh-1' },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    useVehicleStore.setState({ vehicles: [bike], lastClaimStatus: null });
    usePlayerStore.setState({ vehicleFuel: fuel, consumables });
  }

  it('fueled: the chip sits in the belt as a quiet readout, not a door', async () => {
    seedBike(12);
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);
    const belt = await screen.findByTestId('consumable-belt');
    const chip = within(belt).getByTestId('vehicle-belt-chip');
    expect(chip.getAttribute('data-state')).toBe('ok');
    expect(chip.textContent).toContain('Scrap Bike');
    expect(chip.textContent).toContain('12u');
    expect(chip.tagName).not.toBe('BUTTON');
  });

  it('out of fuel with a cell carried: the chip is the Garage door', async () => {
    const onNavigate = vi.fn();
    seedBike(0, { GenericFuelCell: 2 });
    render(<ActionScreenContextual onNavigate={onNavigate} onOpenBossSelect={() => {}} />);
    const chip = await screen.findByTestId('vehicle-belt-chip');
    expect(chip.getAttribute('data-state')).toBe('out-of-fuel');
    expect(chip.textContent).toContain('Out of fuel');
    expect(chip.textContent).toContain('Refuel');
    fireEvent.click(chip);
    expect(onNavigate).toHaveBeenCalledWith('garage');
  });

  it('out of fuel with no cells: the chip doors to the Vendor', async () => {
    const onNavigate = vi.fn();
    seedBike(0, {});
    render(<ActionScreenContextual onNavigate={onNavigate} onOpenBossSelect={() => {}} />);
    const chip = await screen.findByTestId('vehicle-belt-chip');
    fireEvent.click(chip);
    expect(onNavigate).toHaveBeenCalledWith('market:vendor');
  });

  it('no vehicle equipped: no chip', async () => {
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);
    await screen.findByTestId('consumable-belt');
    expect(screen.queryByTestId('vehicle-belt-chip')).toBeNull();
  });
});

describe('Hunter → Profile — Totals & Sources door', () => {
  it('the door opens the full source breakdown, unfocused', { timeout: 20_000 }, async () => {
    render(<ProfileScreen onNavigate={() => {}} />);
    const door = await screen.findByTestId('profile-totals-sources-door');
    fireEvent.click(door);
    expect(await screen.findByText('Source Breakdown')).toBeTruthy();
    expect(screen.queryByTestId('breakdown-focus')).toBeNull();
  });
});
