/**
 * Rewarded-ad error surface (owner device hit, 2026-11-18).
 *
 * Tapping "Watch Ad to Open" surfaced AdMob's raw SDK error —
 * "Publisher misconfiguration: Failed to read publisher's
 * account configuration; no form(s) configured for the input
 * app ID … ca-app-pub-…" — in the cache screen's error banner.
 * Two defects fed it:
 *
 *  1. `initializeAdMob()` awaited the UMP consent step
 *     unguarded, so a consent failure (exactly what a publisher
 *     account with no configured form produces) rejected the
 *     whole flow before an ad was ever attempted.
 *  2. `ChestScreen.handleOpenAd` put the rejection's
 *     `err.message` into the banner verbatim.
 *
 * These pins hold the fix:
 *  - the consent step is best-effort in BOTH ad modules: its
 *    failure is logged and the ad attempt still runs;
 *  - an ad-step failure (initialize / prepare / show) still
 *    rejects from the module — the surface, not the module,
 *    owns the player-facing wording;
 *  - the cache surface maps ANY ad-step failure to the game's
 *    own notice, returns to a clean state (no stuck opening,
 *    no open op fired), and the raw SDK text never renders;
 *  - the success path is unchanged: reward → open op with the
 *    shown unit id.
 *
 * Pending-state pin (owner device hit, 2026-11-19): while the
 * ad attempt is in flight the button disables and reads
 * "Showing ad…" — the bench lane's treatment — and re-taps are
 * inert, so a slow cold load no longer reads as a dead button.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The exact string the owner was shown on device.
const SDK_ERROR_MESSAGE =
  "Publisher misconfiguration: Failed to read publisher's account configuration; no form(s) configured for the input app ID. Verify that you have configured one or more forms for this application and try again. Received app ID: ca-app-pub-2708638041809482~7527406300";

const GAME_NOTICE = 'No ad available right now — the cache stays shut. Try again later.';

// ---------------------------------------------------------------------------
// Screen level: the cache surface maps an ad-step failure to the
// game's own notice. Harness mirrors cacheRevealOnePage.test.tsx
// (real stores, mocked verifiedOps transport, stubbed moment),
// with the ads module mocked at the surface boundary.
// ---------------------------------------------------------------------------

const surface = vi.hoisted(() => ({
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
  showRewardedCacheAd: vi.fn(),
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => surface.auth }));

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
  canUseRewardedCacheAds: () => true,
  showRewardedCacheAd: surface.showRewardedCacheAd,
}));

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
  surface.auth.account = {
    userId: 'user-1', accountType: 'verified', username: 'hunter', hasUsername: true,
    email: 'hunter@example.com', emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    verificationGraceExpiresAt: null, verificationReminderLastSeenAt: null, isAnonymous: false,
  };
}

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

describe('cache surface — ad failure shows the game notice, never the SDK text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    seedStores();
  });

  afterEach(() => {
    cleanup();
  });

  it('ad step rejects with the raw SDK error → game notice, clean state, no open op', async () => {
    surface.showRewardedCacheAd.mockRejectedValue(new Error(SDK_ERROR_MESSAGE));
    render(<ChestScreen />);

    const adButton = await screen.findByRole('button', { name: /Watch Ad to Open/i });
    fireEvent.click(adButton);

    // The game's own notice, word for word.
    expect(await screen.findByText(GAME_NOTICE)).toBeTruthy();
    // The raw SDK text never reaches the player.
    expect(document.body.textContent).not.toContain('Publisher misconfiguration');
    expect(document.body.textContent).not.toContain('ca-app-pub-');
    expect(document.body.textContent).not.toContain('no form(s) configured');
    // No open op was fired and the flow is back to its prior
    // state: both open buttons live again (no stuck opening).
    expect(mockMakeItem).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /Watch Ad to Open/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'OPEN WITH KEY (3)' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ad step succeeds → the open op fires with the shown unit id (success path unchanged)', async () => {
    surface.showRewardedCacheAd.mockResolvedValue({ adUnitId: 'ca-app-pub-x/y', rewardAmount: 1, rewardType: 'cache_box' });
    const weapon = makeWeapon('cache-ad-w1', 'Ad Cache Reaver');
    mockMakeItem.mockResolvedValue({
      item: { id: weapon.id, is_locked: false, payload: { ...weapon } },
      cache_lane: { keys: 3, rule: '' },
      profile: { cache_tokens: 3 },
    } as never);
    render(<ChestScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Watch Ad to Open/i }));

    expect(await screen.findByTestId('loot-moment-stub')).toBeTruthy();
    expect(mockMakeItem).toHaveBeenCalledWith({ payment: 'ad', adUnitId: 'ca-app-pub-x/y' });
    expect(document.body.textContent).not.toContain(GAME_NOTICE);
  });

  it('while the ad attempt is in flight, the button disables, reads "Showing ad…", and ignores re-taps', async () => {
    let rejectAd: (err: Error) => void = () => {};
    surface.showRewardedCacheAd.mockImplementation(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectAd = reject;
        }),
    );
    render(<ChestScreen />);

    const adButton = await screen.findByRole('button', { name: /Watch Ad to Open/i });
    fireEvent.click(adButton);

    // The tap lands visibly — the bench lane's pending treatment.
    const pendingButton = await screen.findByRole('button', { name: /Showing ad/i });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);

    // Re-taps while pending are inert: no second ad attempt.
    fireEvent.click(pendingButton);
    expect(surface.showRewardedCacheAd).toHaveBeenCalledTimes(1);

    // When the attempt settles as a failure, the game notice
    // shows and the button returns to its live state.
    rejectAd(new Error('The ad was dismissed before the reward was earned.'));
    expect(await screen.findByText(GAME_NOTICE)).toBeTruthy();
    const restored = await screen.findByRole('button', { name: /Watch Ad to Open/i });
    expect((restored as HTMLButtonElement).disabled).toBe(false);
    expect(mockMakeItem).not.toHaveBeenCalled();
  });
});
