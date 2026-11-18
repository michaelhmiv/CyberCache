/**
 * Bench rundown — craft-info V1 (owner ruling 2026-11-17).
 *
 * While Crafting holds the Home slot, the black zone under the
 * stage answers for the bench instead of printing the combat
 * rundown: the WORKING row (head job, its state word, units, the
 * bench progress bar), the fact cells (PER UNIT — the head job's
 * STORED unit duration, its enqueue-time snapshot rate; THIS
 * UNIT — accrued share; LEFT — the job's remaining time), the
 * NEXT row (the queue, named, with its combined remaining time),
 * and one slim vitals line (HP + Shield; HP never leaves the
 * first screen). Every other mode keeps the combat rundown.
 *
 * Pins:
 *  - the mode gate: Crafting renders the bench zone and NOT the
 *    combat rundown; Roaming renders the combat rundown and NOT
 *    the bench zone;
 *  - the running read, seeded as the owner's device state (Ammo
 *    Pack 0/407 at a stored 10m/unit, unit 1 at 40%, 67h 46m
 *    left; Med Kit ×25 and Shield Cell ×40 queued behind it);
 *  - the paused head reads PAUSED with the same stored facts;
 *  - service-lane jobs (repair / shield-tech) never head the
 *    bench zone — the HomeCraftBench filter, shared;
 *  - the empty bench keeps the shape: BENCH IDLE + vitals, no
 *    fact cells with nothing to measure;
 *  - the shared duration formatters print the Workshop's words.
 *
 * The render harness mirrors actionControlsOnStage.test.tsx
 * (same mocks, same store seeding) — this screen's established
 * test habitat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// The Workshop panel under the zone mounts ChipRail, which needs
// an IntersectionObserver jsdom does not ship — the same local
// stub ChipRail.test.tsx installs for itself.
let originalIntersectionObserver: typeof globalThis.IntersectionObserver | undefined;
beforeEach(() => {
  originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = vi.fn(function (callback: IntersectionObserverCallback) {
    return {
      observe: vi.fn(() => {
        callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
      }),
      disconnect: vi.fn(),
    };
  }) as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  if (originalIntersectionObserver) globalThis.IntersectionObserver = originalIntersectionObserver;
});

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
  getContractsState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getStandingState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  standingBuy: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  standingOrder: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getEndlessMe: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getExtractionState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getResearchState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getActionSkillState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
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
vi.mock('@/lib/notifications/pushNotifications', () => ({
  checkPushPermission: vi.fn(async () => 'prompt'),
  requestPushNotifications: vi.fn(async () => true),
  syncPushRegistration: vi.fn(async () => {}),
}));

import { ActionScreenContextual } from '@/screens/ActionScreenContextual';
import { BenchRundown } from '@/components/dashboard/BenchRundown';
import { formatDuration, formatDurationShort } from '@/lib/workshop/durationFormat';
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
import { IDLE_ACTIVITY } from '@/types/activity';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
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

const baseJob = {
  bench: 1,
  unitsTotal: 3,
  unitsCompleted: 0,
  unitDurationMs: 60_000,
  accruedMs: 0,
  remainingMs: 180_000,
  xpAwarded: 0,
  gearRarity: null,
  catalystMaterialId: null,
  outputs: [] as Record<string, unknown>[],
  createdAtMs: 0,
  completedAtMs: null,
  repairItemId: null,
  repairKitType: null,
  repairPointsRestored: 0,
} as const;

/** The owner's device state, 2026-11-17: Ammo Pack running
 *  0/407 at a stored 10m/unit, unit 1 at 40%, 67h 46m left. */
const ammoJob: WorkshopJobView = {
  ...baseJob,
  id: 'job-ammo-1',
  kind: 'consumable',
  recipeId: 'recipe_ammo_pack',
  name: 'Ammo Pack',
  state: 'running',
  unitsTotal: 407,
  unitsCompleted: 0,
  unitDurationMs: 600_000,
  accruedMs: 240_000,
  remainingMs: 243_960_000,
};

const medkitJob: WorkshopJobView = {
  ...baseJob,
  id: 'job-medkit-1',
  kind: 'consumable',
  recipeId: 'recipe_medkit',
  name: 'Med Kit',
  state: 'queued',
  unitsTotal: 25,
  unitDurationMs: 720_000,
  remainingMs: 18_000_000,
};

const shieldJob: WorkshopJobView = {
  ...baseJob,
  id: 'job-shield-1',
  kind: 'consumable',
  recipeId: 'recipe_shieldcell',
  name: 'Shield Cell',
  state: 'queued',
  unitsTotal: 40,
  unitDurationMs: 900_000,
  remainingMs: 36_000_000,
};

const repairJob: WorkshopJobView = {
  ...baseJob,
  id: 'job-repair-1',
  kind: 'repair',
  recipeId: 'repair',
  name: 'Vehicle repair — PatchKit',
  state: 'paused',
  unitsCompleted: 1,
  repairItemId: 'veh-1',
  repairKitType: 'PatchKit',
  repairPointsRestored: 30,
};

function seedStores(jobs: WorkshopJobView[], kind: string) {
  useLoadoutStore.setState({
    slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, vehicle: null },
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
  });
  useInventoryStore.setState({ items: [weapon] });
  useBossStore.setState({ currentBossId: null, defeatedBossIds: [], preparedConsumables: {} });
  useTickFeedStore.setState({ events: [] });
  useSurvivalStore.setState({ currentHp: 100, maxHp: 999, shieldHp: 0, isDead: false });
  useWorkshopStore.setState({
    server: {
      benches: 1,
      tools: { owned: {}, fitted: {}, charges: {} },
      jobs,
      masteries: {},
      activeActionKind: kind,
      recentCompletions: [],
    },
    error: null,
    loading: false,
    refresh: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => true),
    cancel: vi.fn(async () => true),
  });
  useActivityStore.setState({
    current: { ...IDLE_ACTIVITY, kind: kind as never },
    hydrated: true,
    pending: false,
    error: null,
  });
  hoisted.auth.account = verifiedAccount;
}

describe('bench rundown — the mode gate', { timeout: 60_000 }, () => {
  beforeEach(() => {
    seedStores([ammoJob, medkitJob, shieldJob], 'crafting');
  });

  it('Crafting renders the bench zone — working job, stored rate, queue, vitals — and not the combat rundown', async () => {
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);
    const zone = await screen.findByTestId('bench-rundown');
    expect(screen.queryByTestId('hero-rundown')).toBeNull();

    const working = within(zone).getByTestId('bench-rundown-working');
    expect(working.textContent).toContain('Working');
    expect(working.textContent).toContain('Running');
    expect(working.textContent).toContain('Ammo Pack');
    expect(working.textContent).toContain('0/407');

    // Fact cells: the head job's STORED per-unit duration (its
    // snapshot rate), the accrued share of the current unit, and
    // the job's remaining time — the Workshop's own words.
    expect(zone.textContent).toContain('Per unit');
    expect(zone.textContent).toContain('10m');
    expect(zone.textContent).toContain('This unit');
    expect(zone.textContent).toContain('40%');
    expect(zone.textContent).toContain('Left');
    expect(zone.textContent).toContain('67h 46m');

    const next = within(zone).getByTestId('bench-rundown-next');
    expect(next.textContent).toContain('Med Kit ×25');
    expect(next.textContent).toContain('Shield Cell ×40');
    expect(next.textContent).toContain('2 queued · 15h');

    // Slim vitals: HP and Shield stay; the combat cells leave.
    const vitals = within(zone).getByTestId('bench-rundown-vitals');
    expect(vitals.textContent).toContain('HP');
    expect(vitals.textContent).toContain('Shield');
    expect(zone.textContent).not.toContain('Shield Break');
    expect(zone.textContent).not.toContain('DPS');
  });

  it('Roaming keeps the combat rundown and never shows the bench zone', async () => {
    seedStores([ammoJob, medkitJob, shieldJob], 'roaming_loot');
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);
    expect(await screen.findByTestId('hero-rundown')).toBeTruthy();
    expect(screen.queryByTestId('bench-rundown')).toBeNull();
  });
});

describe('bench rundown — states', { timeout: 60_000 }, () => {
  it('a paused head reads PAUSED with its stored facts intact', () => {
    seedStores([{ ...ammoJob, state: 'paused' }, medkitJob], 'crafting');
    render(<BenchRundown />);
    const zone = screen.getByTestId('bench-rundown');
    const working = within(zone).getByTestId('bench-rundown-working');
    expect(working.textContent).toContain('Paused');
    expect(working.textContent).toContain('Ammo Pack');
    expect(zone.textContent).toContain('10m');
    expect(zone.textContent).toContain('67h 46m');
  });

  it('service-lane jobs never head the zone', () => {
    seedStores([repairJob, medkitJob], 'crafting');
    render(<BenchRundown />);
    const working = screen.getByTestId('bench-rundown-working');
    expect(working.textContent).toContain('Med Kit');
    expect(working.textContent).not.toContain('Vehicle repair');
  });

  it('an empty bench keeps the shape: BENCH IDLE over the vitals line, no fact cells', () => {
    seedStores([], 'crafting');
    render(<BenchRundown />);
    const zone = screen.getByTestId('bench-rundown');
    const idle = within(zone).getByTestId('bench-rundown-idle');
    expect(idle.textContent).toContain('Bench');
    expect(idle.textContent).toContain('Idle');
    expect(idle.textContent).toContain('No jobs queued');
    expect(screen.queryByTestId('bench-rundown-working')).toBeNull();
    expect(zone.textContent).not.toContain('Per unit');
    expect(within(zone).getByTestId('bench-rundown-vitals').textContent).toContain('HP');
  });
});

describe('bench duration formatters — the Workshop\u2019s words', () => {
  it('formatDuration prints hours/minutes and minutes/seconds as the Workshop does', () => {
    expect(formatDuration(243_960_000)).toBe('67h 46m');
    expect(formatDuration(600_000)).toBe('10m 00s');
    expect(formatDuration(45_000)).toBe('45s');
  });

  it('formatDurationShort prints the compact hand', () => {
    expect(formatDurationShort(600_000)).toBe('10m');
    expect(formatDurationShort(54_000_000)).toBe('15h');
    expect(formatDurationShort(5_400_000)).toBe('1h30');
    expect(formatDurationShort(18_000_000)).toBe('5h');
  });
});
