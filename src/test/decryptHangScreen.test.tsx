/**
 * Decrypt hang — the screen-level recovery pin (2026-11-11).
 *
 * When the cache-open op fails — including the transport timeout
 * that replaced the old never-settling fetch — ChestScreen must
 * leave the DECRYPTING overlay, show the error in its banner, and
 * return the OPEN WITH KEY button to a tappable state so the player
 * can retry. The stuck-forever shake (overlay up, no error, button
 * dead) is the defect this file exists to keep dead.
 *
 * Harness mirrors cacheRevealOnePage.test.tsx: real stores, mocked
 * verifiedOps transport, LootMoment stubbed.
 */
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
import { ApiError } from '@/lib/api/http';
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
  hoisted.auth.account = {
    userId: 'user-1', accountType: 'verified', username: 'hunter', hasUsername: true,
    email: 'hunter@example.com', emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    verificationGraceExpiresAt: null, verificationReminderLastSeenAt: null, isAnonymous: false,
  };
}

function makeWeapon(id: string, name: string): Weapon {
  return {
    id, name, level: 5, rarity: Rarity.Rare, weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.Ironwood, element: Element.Kinetic, rollQuality: 50,
    baseDamage: 25, attackSpeed: 2, critChance: 0.1, critDamage: 1.5,
    statusChance: 0, statusDamage: 0, bossDamageMod: 0, waveDamageMod: 0,
    shieldDamageMod: 0, armorDamageMod: 0, offlineEarningsMod: 0, rareDropChanceMod: 0,
    scrapYieldMod: 0, parts: [], affixes: [], sourceTag: DropSource.WorldDrop,
    isLocked: false, pixelSeed: 7, combatPower: 50, bossPower: 50, farmPower: 50,
    economyScore: 0,
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

describe('cache decrypt — failure is visible and recoverable, never a stuck shake', () => {
  it('a timed-out open drops the DECRYPTING overlay, shows the error, and re-arms the key button for a successful retry', async () => {
    mockMakeItem.mockRejectedValueOnce(
      new ApiError(0, 'timeout', 'The server took too long to respond. Try again.'),
    );
    render(<ChestScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'OPEN WITH KEY (3)' }));

    // The error surfaces in the screen's banner…
    expect(await screen.findByText('The server took too long to respond. Try again.')).toBeTruthy();
    // …the shaking overlay is gone (not stuck on screen)…
    await waitFor(() => {
      expect(screen.queryByText('DECRYPTING CACHE...')).toBeNull();
    });
    // …and the open button is tappable again.
    const retryButton = await screen.findByRole('button', { name: 'OPEN WITH KEY (3)' });
    expect((retryButton as HTMLButtonElement).disabled).toBe(false);

    // The retry actually works: a granted item reaches the reveal.
    const weapon = makeWeapon('cache-retry-1', 'Cache Reaver');
    mockMakeItem.mockResolvedValue({
      item: { id: weapon.id, is_locked: false, payload: { ...weapon } },
      cache_lane: { keys: 2, rule: '' },
      profile: { cache_tokens: 3 },
    } as never);
    fireEvent.click(retryButton);
    expect(await screen.findByTestId('loot-moment-stub')).toBeTruthy();
    expect(mockMakeItem).toHaveBeenCalledTimes(2);
  }, 30_000);
});
