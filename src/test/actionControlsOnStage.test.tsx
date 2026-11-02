/**
 * Owner ruling 2026-11-02 — the action controls float ON the stage.
 *
 * The Switch Action / Stop buttons used to occupy a dedicated row
 * under the Home mode rail; the owner killed the row from his
 * device ("that row is pure overhead") and chose the scene-float
 * placement over the activity-line placement. The controls now
 * render as chips on the stage itself — bottom-right, above the
 * status ribbon, in the plates' overlay language — via the
 * diorama's `stageControls` slot.
 *
 * Pins:
 *  - No standalone controls row exists anymore (source + render).
 *  - While an action runs, BOTH chips sit inside the stage's
 *    controls overlay, exactly one of each in the document, and
 *    both still fire (Switch opens the sheet; Stop stops).
 *  - At standby, Stop leaves the stage (it rendered permanently
 *    disabled in the old row — a no-op), but Switch Action STAYS:
 *    it is the Switch sheet's only door and, through it, the
 *    standby path to Salvage, which has no rail stop. Hiding it
 *    would bury a feature, so the idle stage keeps the one chip.
 *
 * The render harness mirrors flowScreens.test.tsx (same mocks,
 * same store seeding) — this screen's established test habitat.
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

function seedRoaming() {
  useActivityStore.setState({
    current: {
      ...IDLE_ACTIVITY, kind: 'roaming_loot', targetType: 'roaming_area',
      targetId: 'dustwaste_frontier', targetLabel: 'Dustwaste Frontier',
    },
    clear: (async () => {
      useActivityStore.setState({ current: IDLE_ACTIVITY });
      return IDLE_ACTIVITY;
    }) as never,
  });
}

beforeEach(() => {
  vi.mocked(verifiedOps.recycleItem).mockReset();
  vi.mocked(verifiedOps.equipItem).mockReset();
  vi.mocked(getLeaderboard).mockReset();
  vi.mocked(getLoginStreakState).mockImplementation(async () => { throw new Error('no chef in screen tests'); });
  vi.mocked(getCacheRankState).mockImplementation(async () => { throw new Error('no chef in screen tests'); });
  seedStores();
});

const readSource = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('action controls on stage — the dedicated row is gone (source)', () => {
  it('the screen no longer renders a controls row; the chips ride the stage slot', () => {
    const source = readSource('src/screens/ActionScreenContextual.tsx');
    expect(source).not.toContain('Controls row');
    expect(source).not.toContain('justify-end gap-3');
    expect(source).toContain('stageControls={stageControls}');
  });

  it('the diorama places the controls bottom-right above the ribbon, above the sprite layers', () => {
    const diorama = readSource('src/components/dashboard/LiveTurfDiorama.tsx');
    expect(diorama).toContain('data-testid="diorama-stage-controls"');
    expect(diorama).toContain('bottom-11 right-2 z-30');
  });
});

describe('action controls on stage — while an action runs', () => {
  it('both chips render inside the stage overlay, exactly one of each', () => {
    seedRoaming();
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);

    const overlay = screen.getByTestId('diorama-stage-controls');
    expect(within(overlay).getByRole('button', { name: 'Switch Action' })).toBeTruthy();
    expect(within(overlay).getByRole('button', { name: 'Stop' })).toBeTruthy();
    // One door, one name — nowhere else on the screen.
    expect(screen.getAllByRole('button', { name: 'Switch Action' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(1);
  });

  it('Stop still stops: the chip fires the same clear, then leaves the stage', async () => {
    seedRoaming();
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(useActivityStore.getState().current.kind).toBe(IDLE_ACTIVITY.kind));
    // Back at standby: Stop is gone, the Switch door remains.
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch Action' })).toBeTruthy();
  });
});

describe('action controls on stage — at standby', () => {
  it('no Stop chip, but the Switch door stays on the stage and opens the sheet', async () => {
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);

    const overlay = screen.getByTestId('diorama-stage-controls');
    expect(within(overlay).getByRole('button', { name: 'Switch Action' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();

    fireEvent.click(within(overlay).getByRole('button', { name: 'Switch Action' }));
    // The sheet's own detail line — the sheet is open.
    expect(await screen.findByText(/Broad action changes live in this drawer/)).toBeTruthy();
    // …and Salvage, the path the standby door protects, is in it.
    const salvageRow = (await screen.findAllByRole('button')).find(
      (b) => b.textContent?.includes('Salvage') && b.textContent?.includes('items'),
    );
    expect(salvageRow).toBeDefined();
  });
});
