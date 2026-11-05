/**
 * Cache reveal = ONE page (owner device feedback, 2026-11-04).
 *
 * The reveal used to swap phases the instant the LootMoment
 * reported done: the moment unmounted and a separate card phase
 * (star pop, second header, nested-scroll card stack) replaced it —
 * the owner experienced it as a second pop-up arriving too fast.
 * The fix keeps the moment's stage mounted and renders the stat
 * deck + Open Another / Collect BELOW it on the same page.
 *
 * These pins hold that structure:
 *  - after `onDone`, the stage (and the LootMoment itself) is NOT
 *    unmounted; the deck coexists in the same surface, BELOW the
 *    stage in document order, under a single "CACHE DECRYPTED"
 *    header;
 *  - the deck is the FULL inspect-grade stat deck (shared
 *    itemStatDeck rendering): DPS row, every affix by display
 *    text (never a bare count), legendary effect name AND
 *    description;
 *  - Collect still closes the page and Open Another still starts
 *    a fresh reveal.
 *
 * Harness mirrors auditDisplayFixes.test.tsx: real stores, mocked
 * verifiedOps transport, LootMoment stubbed to complete on click.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    equipItem: vi.fn(async () => ({})),
    unequipSlot: vi.fn(async () => ({})),
    recycleItem: vi.fn(async () => ({ scrap_award: 10 })),
    itemLock: vi.fn(async () => ({})),
    trainSkill: vi.fn(async () => ({})),
    retrain: vi.fn(async () => ({})),
    claimCraftedConsumable: vi.fn(async () => ({})),
  },
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
// it on demand. Because the stub is a plain button, "the moment
// stays mounted after done" is directly observable: the old phase
// swap unmounted it, the one-page reveal must not.
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

globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: IntersectionObserverCallback) {
  return {
    observe: (target: Element) => callback([{ isIntersecting: false, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: () => undefined,
    disconnect: () => undefined,
  };
}) as unknown as typeof IntersectionObserver;

import { ChestScreen } from '@/screens/ChestScreen';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { useInventoryStore, useLoadoutStore, usePlayerStore, useSkillStore } from '@/store';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

const mockMakeItem = vi.mocked(verifiedOps.makeItem);

function makeWeapon(id: string, name: string, overrides: Partial<Weapon> = {}): Weapon {
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
    ...overrides,
  };
}

function seedStores() {
  useInventoryStore.setState({ items: [] });
  useLoadoutStore.setState({
    slots: {
      primary: null, secondary: null, heavy: null, ordnance: null,
      shield: null, classMod: null, relic: null, vehicle: null,
    },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({
    level: 30, credits: 100_000, scrap: 500, cacheKeys: 3, cacheKeyFragments: 0,
    legendaryCores: 0, profileLoaded: true,
  });
  useSkillStore.setState({ spent: {}, classModBoosts: { nodeBoosts: {} } });
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

function armMakeItem(weapon: Weapon) {
  // The lane snapshot after one free open: no free box left, 9 of
  // the day's 10 remaining, keys in hand — so Open Another (key
  // path) is genuinely on offer, as on device.
  mockMakeItem.mockResolvedValue({
    item: { id: weapon.id, is_locked: false, payload: { ...weapon } },
    cache_lane: {
      day: '2026-11-01', remaining: 9, opened_today: 1, free_available: false,
      by_payment: { free: 1, ad: 0, key: 0 },
    },
    profile: { cache_tokens: 3 },
  } as never);
}

/** Open a free cache and complete the (stubbed) loot moment. */
async function openCacheToDeck() {
  render(<ChestScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'OPEN FREE CACHE' }));
  fireEvent.click(await screen.findByTestId('loot-moment-stub'));
  return screen.findByTestId('cache-reveal-deck');
}

describe('cache reveal — one page, no phase swap', () => {
  it('after the moment completes, the stage stays mounted and the full deck renders BELOW it on the same page', async () => {
    armMakeItem(makeWeapon('cache-w1', 'Cache Reaver', {
      parts: [{ slot: 'Barrel', modifier: { baseDamage: 1.15 } }],
      affixes: [
        { id: 'af-1', category: 'combat', stat: 'critChance', value: 0.05, displayText: '+5% Crit Chance' },
        { id: 'af-2', category: 'boss', stat: 'bossDamageMod', value: 0.12, displayText: '+12% Boss Damage' },
      ],
    }));
    render(<ChestScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'OPEN FREE CACHE' }));

    // During the moment: stage present, no deck yet.
    expect(await screen.findByTestId('loot-moment-stub')).toBeTruthy();
    expect(screen.queryByTestId('cache-reveal-deck')).toBeNull();

    fireEvent.click(screen.getByTestId('loot-moment-stub'));
    const deck = await screen.findByTestId('cache-reveal-deck');
    const stage = screen.getByTestId('cache-reveal-stage');

    // No phase swap: the moment itself was NOT unmounted, and the
    // stage and the deck coexist in the same surface.
    expect(screen.getByTestId('loot-moment-stub')).toBeTruthy();
    expect(stage.contains(screen.getByTestId('loot-moment-stub'))).toBe(true);
    // The deck sits BELOW the stage in document order.
    expect(stage.compareDocumentPosition(deck) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One header only — the old phase 2 printed a second one.
    expect(screen.getAllByText('CACHE DECRYPTED')).toHaveLength(1);

    // The FULL deck (shared inspect rendering), not the old
    // four-number summary: DPS through the unified chain, roll /
    // maker / element, the part lines, and EVERY affix by its
    // display text — never a bare "2 affixes" count.
    const deckQueries = within(deck);
    expect(deckQueries.getByText('Cache Reaver')).toBeTruthy();
    expect(deckQueries.getByText('DPS (vs standard)')).toBeTruthy();
    expect(deckQueries.getByText('Crit Damage')).toBeTruthy();
    expect(deckQueries.getByText('Boss Damage Mod')).toBeTruthy();
    expect(deckQueries.getByText('Maker')).toBeTruthy();
    expect(deckQueries.getByText('Ironwood')).toBeTruthy();
    expect(deckQueries.getByText('Barrel')).toBeTruthy();
    expect(deckQueries.getByText('+5% Crit Chance')).toBeTruthy();
    expect(deckQueries.getByText('+12% Boss Damage')).toBeTruthy();
    expect(deckQueries.queryByText('2 affixes')).toBeNull();

    // Actions live on the same page, below the stage.
    expect(deckQueries.getByRole('button', { name: /Equip$/ })).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: 'Open Another' })).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: 'Collect' })).toBeTruthy();
  }, 30_000);

  it('a legendary reveal prints the effect name AND its description', async () => {
    armMakeItem(makeWeapon('cache-leg', 'Debt Collector Prime', {
      rarity: Rarity.Legendary,
      legendaryEffectId: 'debt_collector',
    }));
    const deck = await openCacheToDeck();
    const deckQueries = within(deck);
    expect(deckQueries.getByText('Debt Collector')).toBeTruthy();
    expect(
      deckQueries.getByText(/Each failed attempt vs\. the same boss grants \+3% win chance/),
    ).toBeTruthy();
  }, 30_000);

  it('Collect closes the whole page (stage and deck together)', async () => {
    armMakeItem(makeWeapon('cache-w1', 'Cache Reaver'));
    const deck = await openCacheToDeck();
    fireEvent.click(within(deck).getByRole('button', { name: 'Collect' }));
    await waitFor(() => {
      expect(screen.queryByTestId('cache-reveal-deck')).toBeNull();
      expect(screen.queryByTestId('cache-reveal-stage')).toBeNull();
      expect(screen.queryByTestId('loot-moment-stub')).toBeNull();
    });
  }, 30_000);

  it('Open Another starts a fresh reveal: deck leaves, a new moment plays, deck returns below the stage', async () => {
    armMakeItem(makeWeapon('cache-w1', 'Cache Reaver'));
    const deck = await openCacheToDeck();
    fireEvent.click(within(deck).getByRole('button', { name: 'Open Another' }));

    // A second server grant happened and the page went back to a
    // playing moment with no deck.
    await waitFor(() => expect(mockMakeItem).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('loot-moment-stub')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('cache-reveal-deck')).toBeNull());

    fireEvent.click(screen.getByTestId('loot-moment-stub'));
    const deck2 = await screen.findByTestId('cache-reveal-deck');
    const stage = screen.getByTestId('cache-reveal-stage');
    expect(stage.compareDocumentPosition(deck2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(deck2).getByText('Cache Reaver')).toBeTruthy();
  }, 30_000);
});
