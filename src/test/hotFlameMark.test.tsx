/**
 * Hot-area flame mark (owner steer 2026-11-13).
 *
 * The pennant label treatments were rejected ("the hot pennant looks
 * bad"); the owner directed a flame animation instead, then moved its
 * seat the same day: "just show the flame next to the active area name
 * below the animation." The mark rides the Active Area panel's name
 * row, trailing the name, and nowhere else — the Stop-button seat was
 * presented, QC-passed, and then explicitly killed by the owner ("I
 * don't want to see stop button version anymore").
 *
 * Pins:
 *  - 'flameFlick' is the 'flame' glyph's flicker twin: the outer
 *    teardrop rects are identical; only the highlight core moves.
 *  - With motion allowed the mark alternates glyphs on its 350 ms
 *    timer (data-frame a -> b -> a, and the drawn glyph changes).
 *  - Under reduced motion no interval is ever armed and the shipped
 *    glyph renders static — the second glyph never appears.
 *  - On the Action screen the mark renders only while roaming the
 *    day's hot area (the game's own hotArea day hash, clock pinned),
 *    and is absent for a non-hot area and for non-roaming activities.
 *
 * The screen render harness mirrors actionControlsOnStage.test.tsx
 * (same mocks, same store seeding) — this screen's established habitat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';

import { PX_ICONS } from '@/lib/pixel/icons';
import { HotFlameMark } from '@/components/dashboard/HotFlameMark';
import { hotAreaIdForDate } from '@/content/hotArea';
import { ROAMING_AREAS } from '@/constants/roamingAreas';

describe("flameFlick glyph — the flame's flicker twin", () => {
  it('keeps the outer teardrop rect-for-rect identical; only the highlight core moves', () => {
    const flame = PX_ICONS.flame;
    const flick = PX_ICONS.flameFlick;
    expect(flick, 'flameFlick glyph registered').toBeDefined();
    const outer = (rects: readonly (readonly unknown[])[]) => rects.filter((r) => r[4] !== 'h');
    const core = (rects: readonly (readonly unknown[])[]) => rects.filter((r) => r[4] === 'h');
    expect(outer(flick)).toEqual(outer(flame));
    expect(core(flick)).not.toEqual(core(flame));
    expect(core(flick).length).toBeGreaterThan(0);
  });
});

describe('HotFlameMark — cadence and reduced motion', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('alternates glyphs on the 350 ms timer when motion is allowed', () => {
    vi.useFakeTimers();
    const { container } = render(<HotFlameMark reduced={false} />);
    const mark = screen.getByTestId('hot-flame-mark');
    expect(mark.getAttribute('data-frame')).toBe('a');
    const frameA = container.querySelector('svg')?.innerHTML;
    expect(frameA).toBeTruthy();

    act(() => { vi.advanceTimersByTime(350); });
    expect(mark.getAttribute('data-frame')).toBe('b');
    const frameB = container.querySelector('svg')?.innerHTML;
    expect(frameB, 'the drawn glyph changes with the frame').not.toBe(frameA);

    act(() => { vi.advanceTimersByTime(350); });
    expect(mark.getAttribute('data-frame')).toBe('a');
    expect(container.querySelector('svg')?.innerHTML).toBe(frameA);
  });

  it('reduced motion: no interval is armed and the static glyph never swaps', () => {
    vi.useFakeTimers();
    const intervalSpy = vi.spyOn(window, 'setInterval');
    const { container } = render(<HotFlameMark reduced />);
    const mark = screen.getByTestId('hot-flame-mark');
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(mark.getAttribute('data-frame')).toBe('a');
    const still = container.querySelector('svg')?.innerHTML;

    act(() => { vi.advanceTimersByTime(5_000); });
    expect(mark.getAttribute('data-frame')).toBe('a');
    expect(container.querySelector('svg')?.innerHTML).toBe(still);
  });

  it('wears the hot-area red at the approved 20px size', () => {
    const { container } = render(<HotFlameMark reduced />);
    const mark = screen.getByTestId('hot-flame-mark');
    expect(mark.className).toContain('text-[#E2483D]');
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
  });
});

/* ------------------------------------------------------------------ */
/* Screen gate — the mark on the Active Area panel, and only there.    */
/* ------------------------------------------------------------------ */

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
  useActivityStore.setState({ current: IDLE_ACTIVITY, hydrated: true, pending: false, error: null });
  useBossStore.setState({ currentBossId: null, defeatedBossIds: [], preparedConsumables: {} });
  useTickFeedStore.setState({ events: [] });
  hoisted.auth.account = verifiedAccount;
  hoisted.auth.signInWithGoogle.mockClear();
}

function seedRoaming(areaId: string, areaName: string) {
  useIdleStore.setState({ selectedRoamingAreaId: areaId });
  useActivityStore.setState({
    current: {
      ...IDLE_ACTIVITY, kind: 'roaming_loot', targetType: 'roaming_area',
      targetId: areaId, targetLabel: areaName,
    },
    clear: (async () => {
      useActivityStore.setState({ current: IDLE_ACTIVITY });
      return IDLE_ACTIVITY;
    }) as never,
  });
}

// A fixed midday UTC instant: the hot area for it is whatever the game's
// own hash names — the test derives both sides from hotAreaIdForDate so
// it can never drift against the rotation.
const FIXED_NOW = new Date('2026-11-13T12:00:00.000Z');
const HOT_ID = hotAreaIdForDate(FIXED_NOW);
const COLD = ROAMING_AREAS.find((a) => a.id !== HOT_ID)!;
const HOT = ROAMING_AREAS.find((a) => a.id === HOT_ID)!;

describe('hot-area flame mark — the Active Area panel gate', () => {
  beforeEach(() => {
    // Pin ONLY the clock: the gate reads new Date() through the game's
    // own hash, so time is the one input the test must hold still.
    // Intervals stay real (the mark's own flicker is not under test here).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    vi.mocked(verifiedOps.recycleItem).mockReset();
    vi.mocked(verifiedOps.equipItem).mockReset();
    vi.mocked(getLeaderboard).mockReset();
    vi.mocked(getLoginStreakState).mockImplementation(async () => { throw new Error('no chef in screen tests'); });
    vi.mocked(getCacheRankState).mockImplementation(async () => { throw new Error('no chef in screen tests'); });
    seedStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders beside the area name while roaming the hot area', () => {
    seedRoaming(HOT.id, HOT.name);
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);

    const mark = screen.getByTestId('hot-flame-mark');
    expect(mark).toBeTruthy();
    // It trails the name on the name's own row in the Active Area panel.
    const nameRow = mark.parentElement;
    expect(nameRow?.textContent).toContain(HOT.name);
    expect(screen.getByText('Active Area')).toBeTruthy();
  });

  it('is absent while roaming a non-hot area', () => {
    seedRoaming(COLD.id, COLD.name);
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);

    expect(screen.getByText('Active Area')).toBeTruthy();
    expect(screen.queryByTestId('hot-flame-mark')).toBeNull();
  });

  it('is absent when not roaming, even with the hot area selected', () => {
    useIdleStore.setState({ selectedRoamingAreaId: HOT.id });
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);

    expect(screen.queryByTestId('hot-flame-mark')).toBeNull();
  });
});
