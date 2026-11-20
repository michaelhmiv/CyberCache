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
 * ── PIN REVISED, 2026-11-19 (owner ruling: hold at settled) ──
 * The owner then hit the opposite edge on device: the moment's
 * Sample B durations leave the in-moment deck's last lines
 * readable for only ~120–250 ms before unmount, so the reveal
 * "left too quickly to read the stats". The ruling: the cache
 * reveal now HOLDS at its settled state — when the ladder reaches
 * the completed stack, the moment parks there (risen item + full
 * in-moment deck stay on the full-height stage), the Collect /
 * Open Another row presents below the stage, and only Collect
 * releases the moment into the settled flow above.
 *
 * The pin therefore changed its MECHANISM, not its demand. The
 * 2026-11-12 demand stands verbatim: the item, its stats, and its
 * actions must be PRESENTED — never vanished, never stranded.
 * It is now pinned at both layers:
 *  1. THE HOLD: at natural completion the moment does NOT unmount
 *     and the stage does NOT collapse — the item + its full
 *     in-moment deck are presented in the stage itself, with the
 *     Collect / Open Another actions presented below it. The hold
 *     does not expire on the skip linger (or any timer).
 *  2. THE RELEASE: Collect ends the hold through the moment's
 *     ordinary done path — the stage yields its full-viewport
 *     height and the settled deck (full stat deck + Equip / Lock /
 *     Salvage + Open Another / Collect) presents in the first
 *     viewport under CACHE DECRYPTED, exactly as the 2026-11-12
 *     pin demanded; the deck's Collect then closes the reveal
 *     through the existing close flow.
 *
 * ── PIN REVISED AGAIN, 2026-11-20 (owner ruling: one screen,
 * no scrolling) ──
 * The owner reviewed the hold's captures and superseded its
 * scroll: reaching the actions took a scroll of the overlay, and
 * he ruled the reveal is ONE screen — no scrolling on it, ever.
 * The mechanism changed again; the demand did not. The overlay is
 * now a non-scrolling single-viewport flex column: the stage is
 * its flexing region (the h-dvh stage + scrolled page are gone),
 * the action row's height is reserved from the first frame so the
 * stage never resizes when the hold engages, and the held row
 * presents THREE actions in the one viewport — Details, Open
 * Another, Collect. Details opens the canonical GearInspectSheet
 * for the revealed item over the reveal; closing it returns to
 * the held reveal exactly as it was (the moment is never
 * unmounted or released by the sheet). The pin's structural proxy
 * moves with the layout: overlay overflow-hidden + flex column,
 * stage flex-1 while held and h-[120px] only after Collect. The
 * release layer (2) is untouched.
 *
 * Unlike cacheRevealOnePage.test.tsx (which stubs the moment),
 * this harness plays the REAL LootMoment state machine to natural
 * completion on real timers.
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

function mockOpen(weapon: Weapon) {
  mockMakeItem.mockResolvedValue({
    item: { id: weapon.id, is_locked: false, payload: { ...weapon } },
    cache_lane: { keys: 2, rule: '' },
    profile: { cache_tokens: 3 },
  } as never);
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
  it('the reveal HOLDS at its settled state (item + deck + actions presented, no timer expiry), and Collect releases it into the settled deck presentation', async () => {
    const weapon = makeWeapon('cache-w1', 'Cache Reaver');
    mockOpen(weapon);

    render(<ChestScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'OPEN WITH KEY (3)' }));

    // The real moment is playing on the stage; nothing settled yet.
    expect(await screen.findByTestId('cache-loot-moment')).toBeTruthy();
    expect(screen.getByTestId('loot-risen-item')).toBeTruthy();
    expect(screen.queryByTestId('cache-reveal-deck')).toBeNull();
    expect(screen.queryByTestId('cache-reveal-hold-actions')).toBeNull();

    // Natural completion: the Rare step's timer (Sample B, 1100 ms)
    // ends the ANIMATION — and the moment now PARKS on its completed
    // stack instead of unmounting (the 2026-11-19 hold). The hold
    // actions present below the stage.
    const holdActions = await screen.findByTestId('cache-reveal-hold-actions', {}, { timeout: 10_000 });

    // THE HOLD PRESENTS: the moment is still up on the stage, its
    // own deck carrying the item and its stats; the settled deck
    // has NOT taken over yet. ONE SCREEN (2026-11-20): the overlay
    // is a non-scrolling single-viewport column and the stage is
    // its flexing region — no h-dvh stage over a scrolled page.
    expect(screen.getByTestId('cache-loot-moment')).toBeTruthy();
    const stage = screen.getByTestId('cache-reveal-stage');
    const overlay = screen.getByTestId('cache-reveal-overlay');
    expect(overlay.className).toContain('overflow-hidden');
    expect(overlay.className).toContain('flex-col');
    expect(overlay.className).not.toContain('overflow-y-auto');
    expect(stage.className).toContain('flex-1');
    expect(stage.className).not.toContain('h-[120px]');
    expect(screen.queryByTestId('cache-reveal-deck')).toBeNull();
    expect(screen.getByTestId('loot-card-hero').textContent).toContain('Cache Reaver');
    const holdQueries = within(holdActions);
    expect(holdQueries.getByRole('button', { name: 'Details' })).toBeTruthy();
    expect(holdQueries.getByRole('button', { name: 'Collect' })).toBeTruthy();
    expect(holdQueries.getByRole('button', { name: 'Open Another' })).toBeTruthy();

    // The hold does not expire: well past the 650 ms skip linger,
    // everything is still presented exactly as it was.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(screen.getByTestId('cache-loot-moment')).toBeTruthy();
    expect(screen.getByTestId('cache-reveal-stage').className).toContain('flex-1');
    expect(screen.queryByTestId('cache-reveal-deck')).toBeNull();

    // Collect releases the hold through the moment's ordinary done
    // path — the settled presentation the 2026-11-12 pin demands:
    // the moment unmounts, the stage yields its full-viewport
    // height, and the deck presents in the first viewport under
    // CACHE DECRYPTED with the item, its full stats, and its
    // actions.
    fireEvent.click(holdQueries.getByRole('button', { name: 'Collect' }));
    const deck = await screen.findByTestId('cache-reveal-deck', {}, { timeout: 10_000 });
    expect(screen.queryByTestId('cache-loot-moment')).toBeNull();
    expect(screen.queryByTestId('cache-reveal-hold-actions')).toBeNull();
    expect(screen.getByTestId('cache-reveal-stage').className).toContain('h-[120px]');
    expect(screen.getByTestId('cache-reveal-stage').className).not.toContain('flex-1');
    expect(screen.getAllByText('CACHE DECRYPTED')).toHaveLength(1);

    const deckQueries = within(deck);
    expect(deckQueries.getByText('Cache Reaver')).toBeTruthy();
    expect(deckQueries.getByText('DPS (vs standard)')).toBeTruthy();
    expect(deckQueries.getByText('+5% Crit Chance')).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: /Equip$/ })).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: /Lock/ })).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: /Salvage/ })).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: 'Open Another' })).toBeTruthy();
    expect(deckQueries.getByRole('button', { name: 'Collect' })).toBeTruthy();

    // The deck's Collect runs the existing close flow: the whole
    // reveal page closes (the overlay's exit animation gets its
    // beat — same waitFor pattern as the one-page suite).
    fireEvent.click(deckQueries.getByRole('button', { name: 'Collect' }));
    await waitFor(() => {
      expect(screen.queryByTestId('cache-reveal-stage')).toBeNull();
      expect(screen.queryByTestId('cache-reveal-deck')).toBeNull();
    });
    expect(await screen.findByRole('button', { name: 'OPEN WITH KEY (3)' })).toBeTruthy();
  }, 30_000);

  it('Open Another from the hold chains a fresh open, which holds again', async () => {
    const first = makeWeapon('cache-w1', 'Cache Reaver');
    const second = makeWeapon('cache-w2', 'Second Saint', { rarity: Rarity.Epic });
    mockMakeItem
      .mockResolvedValueOnce({
        item: { id: first.id, is_locked: false, payload: { ...first } },
        cache_lane: { keys: 2, rule: '' },
        profile: { cache_tokens: 3 },
      } as never)
      .mockResolvedValue({
        item: { id: second.id, is_locked: false, payload: { ...second } },
        cache_lane: { keys: 1, rule: '' },
        profile: { cache_tokens: 3 },
      } as never);

    render(<ChestScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'OPEN WITH KEY (3)' }));

    const holdActions = await screen.findByTestId('cache-reveal-hold-actions', {}, { timeout: 10_000 });
    expect(mockMakeItem).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('loot-card-hero').textContent).toContain('Cache Reaver');

    fireEvent.click(within(holdActions).getByRole('button', { name: 'Open Another' }));

    // A fresh open runs (second makeItem call) and its moment
    // mounts and holds in turn, presenting the new item.
    await waitFor(() => expect(mockMakeItem).toHaveBeenCalledTimes(2));
    await waitFor(
      () => expect(screen.getByTestId('loot-card-hero').textContent).toContain('Second Saint'),
      { timeout: 10_000 },
    );
    const holdActions2 = await screen.findByTestId('cache-reveal-hold-actions', {}, { timeout: 10_000 });
    expect(screen.getByTestId('cache-loot-moment')).toBeTruthy();
    expect(within(holdActions2).getByRole('button', { name: 'Collect' })).toBeTruthy();
  }, 30_000);

  it('Details opens the inspect sheet over the held reveal, and closing it returns to the intact hold', async () => {
    const weapon = makeWeapon('cache-w1', 'Cache Reaver');
    mockOpen(weapon);

    render(<ChestScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'OPEN WITH KEY (3)' }));

    const holdActions = await screen.findByTestId('cache-reveal-hold-actions', {}, { timeout: 10_000 });
    fireEvent.click(within(holdActions).getByRole('button', { name: 'Details' }));

    // The canonical inspect sheet opens FOR THE REVEALED ITEM,
    // over the reveal: its context label and its Stat Poster tape
    // (the sheet's own furniture, not the moment deck's).
    expect(await screen.findByText('Cache Reveal')).toBeTruthy();
    expect(screen.getByText('Stat Poster')).toBeTruthy();
    // The hold is untouched underneath: the moment is still
    // mounted and held, its actions still presented, and the
    // settled deck has NOT taken over.
    expect(screen.getByTestId('cache-loot-moment')).toBeTruthy();
    expect(screen.getByTestId('cache-reveal-hold-actions')).toBeTruthy();
    expect(screen.queryByTestId('cache-reveal-deck')).toBeNull();

    // Close through the sheet's own backdrop dismissal: the
    // player is back on the held reveal exactly as it was.
    const backdrop = screen.getByText('Cache Reveal').closest('.fixed');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop as Element);
    await waitFor(() => expect(screen.queryByText('Cache Reveal')).toBeNull());
    expect(screen.getByTestId('cache-loot-moment')).toBeTruthy();
    expect(screen.getByTestId('cache-reveal-stage').className).toContain('flex-1');
    expect(screen.queryByTestId('cache-reveal-deck')).toBeNull();

    // Collect still releases the hold after a Details round-trip.
    const holdActions2 = screen.getByTestId('cache-reveal-hold-actions');
    fireEvent.click(within(holdActions2).getByRole('button', { name: 'Collect' }));
    expect(await screen.findByTestId('cache-reveal-deck', {}, { timeout: 10_000 })).toBeTruthy();
  }, 30_000);
});
