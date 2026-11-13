/**
 * Cache reveal — the SETTLED end state must PRESENT (owner device
 * report, 2026-11-12, Pixel playtest).
 *
 * The defect: the reveal itself played better than ever, the gun
 * rose — and then EVERYTHING disappeared, leaving only the
 * "CACHE DECRYPTED" header over an empty stage with the Crack Cache
 * screen ghosting through. The item, its stats, and the
 * equip/collect actions never presented.
 *
 * The mechanism, in shipped code: the LootMoment's reducer goes
 * straight from 'playing' to 'done' when the last step's timer
 * fires (lootMoment.ts `advance`), and at 'done' the component
 * renders null — risen item, beam, and the in-moment stat deck all
 * unmount in the same frame. The host's settled deck (the
 * GearItemCard with the full stat deck + Equip / Lock / Salvage +
 * Open Another / Collect) DOES mount at that instant — but in
 * document order BELOW a stage container that holds a full
 * viewport height (`h-dvh`) inside a top-anchored scrollable
 * overlay. The deck sat exactly one full screen below the visible
 * area, with no scroll cue: mounted, but never presented.
 * (jsdom has no layout, so "presented in the first viewport" is
 * pinned by its structural proxy: once the moment completes, the
 * stage must yield its full-viewport height so the deck flows
 * into the first screen under the header.)
 *
 * Unlike cacheRevealOnePage.test.tsx (which stubs the moment),
 * this harness plays the REAL LootMoment state machine to natural
 * completion on real timers.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  fetchCacheLane: vi.fn(async () => ({ keys: 3, rule: '' })),
}));

vi.mock('@/lib/ads/rewardedCacheAd', () => ({
  canUseRewardedCacheAds: () => false,
  showRewardedCacheAd: vi.fn(async () => { throw new Error('ads unavailable in tests'); }),
}));

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

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
    affixes: [
      { id: 'af-1', category: 'combat', stat: 'critChance', value: 0.05, displayText: '+5% Crit Chance' },
    ],
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
    level: 30, credits: 100_000, scrap: 500, cacheKeys: 3,
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

describe('cache reveal — settled end state presents', () => {
  it('after the real moment completes, the item + full stats + actions are presented in the first viewport (stage yields its full-viewport height)', async () => {
    const weapon = makeWeapon('cache-w1', 'Cache Reaver');
    mockMakeItem.mockResolvedValue({
      item: { id: weapon.id, is_locked: false, payload: { ...weapon } },
      cache_lane: { keys: 2, rule: '' },
      profile: { cache_tokens: 3 },
    } as never);

    render(<ChestScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'OPEN WITH KEY (3)' }));

    // The real moment is playing on the stage; no settled deck yet.
    expect(await screen.findByTestId('cache-loot-moment')).toBeTruthy();
    expect(screen.getByTestId('loot-risen-item')).toBeTruthy();
    expect(screen.queryByTestId('cache-reveal-deck')).toBeNull();

    // Natural completion: the Rare step's timer (Sample B, 1100 ms)
    // ends the moment. The moment unmounts (its 'done' contract) —
    // what must NOT happen is the player being left on an empty
    // full-viewport stage.
    const deck = await screen.findByTestId('cache-reveal-deck', {}, { timeout: 10_000 });
    expect(screen.queryByTestId('cache-loot-moment')).toBeNull();

    // THE SETTLED PRESENTATION: the stage yields its full-viewport
    // height once the moment is done, so the deck sits in the first
    // viewport under the CACHE DECRYPTED header — not stranded a
    // full screen below the fold.
    const stage = screen.getByTestId('cache-reveal-stage');
    expect(stage.className).not.toContain('h-dvh');
    expect(screen.getAllByText('CACHE DECRYPTED')).toHaveLength(1);

    // The settled deck carries the actual revealed item, its full
    // stat deck, and the player's actions.
    const deckQueries = within(deck);
    expect(deckQueries.getByText('Cache Reaver')).toBeTruthy();
    expect(deckQueries.getByText('DPS (vs standard)')).toBeTruthy();
    expect(deckQueries.getByText('+5% Crit Chance')).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: /Equip$/ })).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: /Lock/ })).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: /Salvage/ })).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: 'Open Another' })).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: 'Collect' })).toBeTruthy();
  }, 30_000);
});
