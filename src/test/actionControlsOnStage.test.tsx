/**
 * Owner ruling 2026-11-02 — the action controls float ON the stage.
 * Owner ruling 2026-11-03 — the controls are ICON-ONLY.
 * Owner ruling 2026-11-04 — the arrows come off the stage; Stop
 * moves left into their place.
 *
 * The Switch Action / Stop buttons used to occupy a dedicated row
 * under the Home mode rail; the owner killed the row from his
 * device ("that row is pure overhead") and chose the scene-float
 * placement over the activity-line placement. In the 2026-11-03
 * consolidation the owner made them icon-only ("way larger than
 * they need to be because of the text"): 44px squares carrying
 * the §7 swap / stop pixel glyphs, no visible text, the words in
 * their aria-labels.
 *
 * The 2026-11-04 rework: the "arrows" the owner pointed at on his
 * Pixel were the Switch chip's swap glyph (two opposing arrows).
 * He ordered them removed and Stop shifted left into the vacated
 * place. The stage now carries Stop ALONE, leftmost, while an
 * action runs — and nothing at standby. The Switch sheet did not
 * die with its stage chip: it is still the door to Salvage, which
 * has no rail stop, so its opener moved into the standby and
 * roaming workspace panels (same aria-label, same sheet, same
 * 44px square). No capability was removed; the door moved.
 *
 * Pins:
 *  - No standalone controls row exists anymore (source + render).
 *  - The stageControls slot carries Stop and ONLY Stop (source).
 *  - While an action runs, Stop sits inside the stage's controls
 *    overlay — first and only child — icon-only at 44px, and it
 *    still fires (stops the action). No Switch chip on the stage.
 *  - The Switch Action door renders in the workspace panel
 *    (standby AND roaming), exactly one per state, and opens the
 *    sheet with Salvage in it.
 *  - At standby the stage has no controls overlay at all.
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
  it('the screen no longer renders a controls row; the chip rides the stage slot', () => {
    const source = readSource('src/screens/ActionScreenContextual.tsx');
    expect(source).not.toContain('Controls row');
    expect(source).not.toContain('justify-end gap-3');
    expect(source).toContain('stageControls={stageControls}');
  });

  it('the diorama places the controls top-left (the vacated plate corner), above the sprite layers', () => {
    const diorama = readSource('src/components/dashboard/LiveTurfDiorama.tsx');
    expect(diorama).toContain('data-testid="diorama-stage-controls"');
    expect(diorama).toContain('left-2 top-2 z-30');
    expect(diorama).not.toContain('bottom-11 right-2 z-30');
    expect(diorama).not.toContain('bottom-16');
    // The status ribbon is retired (consolidation 2026-11-03):
    // no ribbon, no stats band slot — the hero rundown attaches
    // to the stage's foot in the SCREEN's flow instead.
    expect(diorama).not.toContain('statsBand');
    expect(diorama).not.toContain('diorama-status-ribbon');
    const screen = readSource('src/screens/ActionScreenContextual.tsx');
    expect(screen).not.toContain('StageStatsBand');
    expect(screen).toContain('HeroRundown');
  });

  it('the stageControls slot carries Stop and ONLY Stop — the swap arrows are off the stage (source)', () => {
    const screen = readSource('src/screens/ActionScreenContextual.tsx');
    const slotStart = screen.indexOf('const stageControls');
    const slotEnd = screen.indexOf('return (', slotStart);
    const slot = screen.slice(slotStart, slotEnd);
    expect(slot).toContain('aria-label="Stop"');
    expect(slot).toContain('<PxIcon name="stop"');
    expect(slot).not.toContain('Switch Action');
    expect(slot).not.toContain('name="swap"');
    // The Switch door still exists — in the workspace panels.
    expect(screen).toContain('aria-label="Switch Action"');
    expect(screen).toContain('<PxIcon name="swap"');
    // No visible text rides any of the buttons.
    expect(screen).not.toContain('>Switch Action</button>');
    expect(screen).not.toContain('>Stop</button>');
  });
});

describe('action controls on stage — while an action runs', () => {
  it('Stop renders ALONE inside the stage overlay, icon-only at 44px, at the left edge', { timeout: 20_000 }, () => {
    seedRoaming();
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);

    const overlay = screen.getByTestId('diorama-stage-controls');
    const buttons = within(overlay).getAllByRole('button');
    // Stop took the arrows' place: it is the overlay's first
    // and ONLY button — the leftmost thing on the stage.
    expect(buttons).toHaveLength(1);
    const stopButton = buttons[0];
    expect(stopButton.getAttribute('aria-label')).toBe('Stop');
    // Icon-only (owner ruling 2026-11-03): no visible text; the
    // glyph is the content; the tap target stays 44px square.
    expect(stopButton.textContent?.trim()).toBe('');
    expect(stopButton.className).toContain('h-11');
    expect(stopButton.className).toContain('w-11');
    expect(stopButton.querySelector('svg, canvas, img, [data-icon]')).toBeTruthy();
    // No Switch chip on the stage — and exactly one Stop and
    // one Switch door in the whole document (the door lives in
    // the roaming workspace panel now).
    expect(within(overlay).queryByRole('button', { name: 'Switch Action' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Switch Action' })).toHaveLength(1);
  });

  it('Stop still stops: the chip fires the same clear, then leaves the stage', async () => {
    seedRoaming();
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(useActivityStore.getState().current.kind).toBe(IDLE_ACTIVITY.kind));
    // Back at standby: Stop is gone, the stage overlay is gone
    // with it, and the Switch door remains — in the standby panel.
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.queryByTestId('diorama-stage-controls')).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch Action' })).toBeTruthy();
  });
});

describe('the Switch door — relocated to the workspace panels', () => {
  it('at standby the stage has NO overlay; the standby panel door opens the sheet with Salvage in it', async () => {
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);

    expect(screen.queryByTestId('diorama-stage-controls')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    const door = screen.getByRole('button', { name: 'Switch Action' });
    expect(door.className).toContain('h-11');
    expect(door.className).toContain('w-11');

    fireEvent.click(door);
    // The sheet's own detail line — the sheet is open.
    expect(await screen.findByText(/Broad action changes live in this drawer/)).toBeTruthy();
    // …and Salvage, the path the door protects, is in it.
    const salvageRow = (await screen.findAllByRole('button')).find(
      (b) => b.textContent?.includes('Salvage') && b.textContent?.includes('items'),
    );
    expect(salvageRow).toBeDefined();
  });

  it('while roaming the door rides the roaming panel (not the stage) and opens the same sheet', async () => {
    seedRoaming();
    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);

    const door = screen.getByRole('button', { name: 'Switch Action' });
    const overlay = screen.getByTestId('diorama-stage-controls');
    expect(overlay.contains(door)).toBe(false);

    fireEvent.click(door);
    expect(await screen.findByText(/Broad action changes live in this drawer/)).toBeTruthy();
  });
});
