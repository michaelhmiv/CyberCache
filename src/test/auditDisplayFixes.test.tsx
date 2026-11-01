/**
 * UX audit fix batch D — "interaction & display honesty" (2026-11-01).
 *
 * Behavioral tests against the shipped contracts, mirroring the
 * repo's established harnesses (phase1UxBehavior / flowScreens /
 * fixerSkillTreeScreen): real stores, a mocked verifiedOps transport
 * whose equip/unequip mocks mirror the server result into the
 * loadout store exactly like the real sync does.
 *
 *  - UX-01: the cache reveal's Equip button equips via the verified
 *    op (it used to only navigate) and offers the SwapUndoToast UNDO.
 *  - UX-02: GearHub's inspect sheet offers Unequip for an equipped
 *    item (its reforge copy said "unequip it first" with no way to).
 *  - UX-03: stopping roaming keeps the session's tick-feed record and
 *    adds an ACTION STOPPED divider instead of wiping to the
 *    placeholder.
 *  - UX-07: the Skill Trees board explains where points come from.
 *  - COPY-03: a single-node tier (every keystone tier) renders its
 *    node exactly once.
 *  - SET-01: the Dashboard carries a Settings action routing to the
 *    same 'settings' destination as HUNTER → ACCOUNT TOOLS.
 *  - A11Y-01 / DISP-02: source pins for the muted-token value and
 *    the diorama's removed mid-word truncation.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    makeItem: vi.fn(),
    // Simulate the server round-trip: the real ops sync the returned
    // loadout snapshot into the loadout store; the mocks do the same
    // so assertions read the store the claim/boss paths read.
    equipItem: vi.fn(async (itemId: string, slot: string) => {
      useLoadoutStore.setState((s) => ({
        slots: { ...s.slots, [slot]: itemId } as typeof s.slots,
      }));
      return {};
    }),
    unequipSlot: vi.fn(async (slot: string) => {
      useLoadoutStore.setState((s) => ({
        slots: { ...s.slots, [slot]: null } as typeof s.slots,
      }));
      return {};
    }),
    recycleItem: vi.fn(async () => ({ scrap_award: 10 })),
    itemLock: vi.fn(async () => ({})),
    trainSkill: vi.fn(async () => ({})),
    retrain: vi.fn(async () => ({})),
    claimCraftedConsumable: vi.fn(async () => ({})),
  },
  // No Chef exists behind these screen tests; the fetchers reject so
  // the panels that use them take their designed unreachable-Chef
  // path (hidden), leaving the rest of each screen exactly as shipped.
  fetchProfileLifetime: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchCollections: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchRepairBoard: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchWorkshopState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/api/cacheLaneService', () => ({
  fetchCacheLane: vi.fn(async () => ({
    day: '2026-11-01', cap: 10, freePerDay: 1, openedToday: 0, remaining: 10,
    freeAvailable: true, keys: 3, byPayment: { free: 0, ad: 0, key: 0 },
    resetsAt: Date.now() + 3_600_000, rule: '',
  })),
}));

vi.mock('@/lib/ads/rewardedCacheAd', () => ({
  canUseRewardedCacheAds: () => false,
  showRewardedCacheAd: vi.fn(async () => { throw new Error('ads unavailable in tests'); }),
}));

// The loot moment is a purely visual celebration; the stub completes
// it on demand so the reveal cards (the surface under test) mount.
vi.mock('@/components/pixelArt/LootMoment', async () => {
  const React = await import('react');
  return {
    LootMoment: ({ onDone }: { onDone: () => void }) =>
      React.createElement('button', { 'data-testid': 'loot-moment-stub', onClick: onDone }, 'moment'),
  };
});

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

// jsdom has no IntersectionObserver; ChipRail (inside the Slot
// Picker) needs one. Same stub shape as phase1UxBehavior.test.tsx.
globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: IntersectionObserverCallback) {
  return {
    observe: (target: Element) => callback([{ isIntersecting: false, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: () => undefined,
    disconnect: () => undefined,
  };
}) as unknown as typeof IntersectionObserver;

import { ActionScreenContextual } from '@/screens/ActionScreenContextual';
import { ChestScreen } from '@/screens/ChestScreen';
import { DashboardScreen } from '@/screens/DashboardScreen';
import { InventoryScreen } from '@/screens/InventoryScreen';
import { SkillTreeScreen } from '@/screens/SkillTreeScreen';
import { verifiedOps } from '@/lib/api/verifiedOps';
import {
  useActivityStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSkillStore,
  useTickFeedStore,
} from '@/store';
import { IDLE_ACTIVITY } from '@/types/activity';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const mockMakeItem = vi.mocked(verifiedOps.makeItem);
const mockEquipItem = vi.mocked(verifiedOps.equipItem);
const mockUnequipSlot = vi.mocked(verifiedOps.unequipSlot);

function makeWeapon(id: string, name: string): Weapon {
  return {
    id,
    name,
    level: 5,
    rarity: Rarity.Rare,
    weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.Ironwood,
    element: Element.Kinetic,
    rollQuality: 50,
    baseDamage: 25,
    attackSpeed: 2,
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
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 7,
    combatPower: 50,
    bossPower: 50,
    farmPower: 50,
    economyScore: 0,
  };
}

const EMPTY_SLOTS = {
  primary: null, secondary: null, heavy: null, ordnance: null,
  shield: null, classMod: null, relic: null, vehicle: null,
};

function seedStores() {
  useInventoryStore.setState({ items: [] });
  useLoadoutStore.setState({
    slots: { ...EMPTY_SLOTS },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({
    level: 30, credits: 100_000, scrap: 500, cacheKeys: 3, cacheKeyFragments: 0,
    legendaryCores: 0, profileLoaded: true,
  });
  useSkillStore.setState({ spent: {}, classModBoosts: { nodeBoosts: {} } });
  useTickFeedStore.setState({ events: [] });
  useActivityStore.setState({ current: IDLE_ACTIVITY, hydrated: true, pending: false, error: null });
  hoisted.auth.account = {
    userId: 'user-1', accountType: 'verified', username: 'hunter', hasUsername: true,
    email: 'hunter@example.com', emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    verificationGraceExpiresAt: null, verificationReminderLastSeenAt: null, isAnonymous: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seedStores();
});

afterEach(() => {
  cleanup();
});

/** Drive a free cache open through the reveal to the item card.
 *  (The card button's accessible name is "⚔ Equip" — the glyph span
 *  is part of the name, so queries anchor on the /Equip$/ suffix.) */
async function openCacheToCard() {
  render(<ChestScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'OPEN FREE CACHE' }));
  fireEvent.click(await screen.findByTestId('loot-moment-stub'));
  return screen.findByRole('button', { name: /Equip$/ });
}

function armMakeItem() {
  mockMakeItem.mockResolvedValue({
    item: { id: 'cache-w1', is_locked: false, payload: { ...makeWeapon('cache-w1', 'Cache Reaver') } },
    cache_lane: { day: '2026-11-01', by_payment: { free: 1, ad: 0, key: 0 } },
    profile: { cache_tokens: 3 },
  } as never);
}

describe('audit UX-01 — cache reveal Equip actually equips', () => {
  it('equips into the first empty weapon slot and UNDO clears it', async () => {
    armMakeItem();
    const equipButton = await openCacheToCard();
    fireEvent.click(equipButton);

    await waitFor(() => expect(mockEquipItem).toHaveBeenCalledWith('cache-w1', 'primary'));
    expect(useLoadoutStore.getState().slots.primary).toBe('cache-w1');

    // The confirmation toast names the item and offers the undo.
    const toast = await screen.findByTestId('swap-undo-toast');
    expect(toast.textContent).toContain('Cache Reaver');
    expect(toast.textContent).toContain('Slot was empty');
    expect((await screen.findByRole('button', { name: /Equipped$/ }))).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: /UNDO/ }));
    await waitFor(() => expect(mockUnequipSlot).toHaveBeenCalledWith('primary'));
    expect(useLoadoutStore.getState().slots.primary).toBeNull();
    expect(await screen.findByRole('button', { name: /Equip$/ })).toBeTruthy();
  }, 30_000);

  it('a full weapon row swaps into primary and UNDO restores the displaced weapon', async () => {
    armMakeItem();
    const oldPrimary = makeWeapon('w-old-1', 'Old Primary');
    useInventoryStore.setState({
      items: [oldPrimary, makeWeapon('w-old-2', 'Old Secondary'), makeWeapon('w-old-3', 'Old Heavy')],
    });
    useLoadoutStore.setState({
      slots: { ...EMPTY_SLOTS, primary: 'w-old-1', secondary: 'w-old-2', heavy: 'w-old-3' },
    });

    const equipButton = await openCacheToCard();
    fireEvent.click(equipButton);

    await waitFor(() => expect(mockEquipItem).toHaveBeenCalledWith('cache-w1', 'primary'));
    const toast = await screen.findByTestId('swap-undo-toast');
    expect(toast.textContent).toContain('Was Old Primary');

    fireEvent.click(screen.getByRole('button', { name: /UNDO/ }));
    await waitFor(() => expect(mockEquipItem).toHaveBeenCalledWith('w-old-1', 'primary'));
    expect(useLoadoutStore.getState().slots.primary).toBe('w-old-1');
  }, 30_000);
});

describe('audit UX-02 — inspect sheet Unequip for equipped items', () => {
  it('offers Unequip (not Equip) for an equipped item and runs the unequip op', async () => {
    const weapon = makeWeapon('w-eq', 'Equipped Pistol');
    useInventoryStore.setState({ items: [weapon] });
    useLoadoutStore.setState({ slots: { ...EMPTY_SLOTS, primary: 'w-eq' } });

    render(<InventoryScreen onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByText('Equipped Pistol'));
    const unequipButton = await screen.findByRole('button', { name: /Unequip/ });
    expect(screen.queryByRole('button', { name: /Equip$/ })).toBeNull();

    fireEvent.click(unequipButton);
    await waitFor(() => expect(mockUnequipSlot).toHaveBeenCalledWith('primary'));
    expect(useLoadoutStore.getState().slots.primary).toBeNull();

    // The sheet stays open on the live row and flips back to Equip —
    // the "unequip it first, then reforge" flow now completes in place.
    expect(await screen.findByRole('button', { name: /Equip$/ })).toBeTruthy();
  }, 30_000);
});

describe('audit UX-03 — stopping roaming keeps the session record', () => {
  it('the tick record stays visible across stop, under an ACTION STOPPED divider', async () => {
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
    useTickFeedStore.setState({
      events: [{
        id: 'tick-1', at: Date.now(), tone: 'credits',
        label: '+150 credits', detail: 'Roaming tick — Dustwaste Frontier',
        areaId: 'dustwaste_frontier',
      } as never],
    });

    render(<ActionScreenContextual onNavigate={() => {}} onOpenBossSelect={() => {}} />);
    expect(await screen.findByText('+150 credits')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('ACTION STOPPED')).toBeTruthy();
    // The earnings record survives the stop — it is NOT reset to the
    // empty placeholder (the pre-fix behavior this test guards).
    expect(screen.getByText('+150 credits')).toBeTruthy();
    expect(screen.queryByText('ACTION READY')).toBeNull();
  }, 30_000);
});

describe('audit UX-07 + COPY-03 — Skill Trees board', () => {
  it('explains where points come from and lists the keystone exactly once', async () => {
    render(<SkillTreeScreen embedded />);

    // UX-07: 1 point per level (level − 1 total — 29 at level 30),
    // tap-to-spend at the listed cost, respec refunds at 100cr/point.
    expect(screen.getByText(/Skill points come from levels/)).toBeTruthy();
    expect(screen.getByText(/29 earned at level 30/)).toBeTruthy();
    expect(screen.getByText(/Respec refunds every spent point for 100cr per point/)).toBeTruthy();

    // COPY-03: the Gunslinger keystone tier is a single index-1 node;
    // it renders once, not once per matched grid slot.
    expect(screen.getByText('Gunslinger Board')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Death by a Thousand Cuts/ })).toHaveLength(1);
  }, 30_000);
});

describe('audit SET-01 — Dashboard Settings entry', () => {
  it('routes to the settings screen, same destination as ACCOUNT TOOLS', async () => {
    const onNavigate = vi.fn();
    render(<DashboardScreen onNavigate={onNavigate} />);

    const settings = await screen.findByRole('button', { name: /Settings/ });
    expect(settings.textContent).toContain('Preferences, display, and local save controls.');
    fireEvent.click(settings);
    expect(onNavigate).toHaveBeenCalledWith('settings');
  }, 30_000);
});

describe('audit A11Y-01 + DISP-02 — source pins', () => {
  it('the muted text token clears WCAG AA on the app backgrounds', () => {
    const css = read('src/index.css');
    expect(css).toContain('--color-text-muted: #8A847C');
    expect(css).not.toContain('#7B756D');
    // The same muted gray was hard-coded as an accent in the loadout
    // panel; it moves with the token.
    expect(read('src/components/action/ActionLoadout.tsx')).not.toContain('#7B756D');
  });

  it('the hero diorama no longer truncates its overlay copy mid-word', () => {
    const diorama = read('src/components/dashboard/LiveTurfDiorama.tsx');
    expect(diorama).not.toContain('truncate bl-title');
    expect(diorama).not.toContain('block truncate text-text-muted');
    expect(diorama).not.toContain('truncate text-[9px] font-black uppercase tracking-wide text-text-primary');
  });
});
