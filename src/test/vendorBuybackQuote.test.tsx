/**
 * Audit G-F3 — vendor sell quotes must use the server-composed
 * effective buyback rate, never the client constant.
 *
 * The server settles vendor sells at min(0.9, lever + Appraiser's Eye
 * + Street Economics research). The Vendor screen used to quote with
 * VENDOR_BUYBACK_RATE_DEFAULT (0.40) hardcoded, so a seller at an
 * effective 42% was quoted ~2,992cr on an item the server paid
 * 3,141cr for. The rate now rides the profile read
 * (vendor_buyback_rate, composed by PgReadStore.getProfile with the
 * sell function's own formula), syncs into the player store, and
 * prices every quote on the sell lane.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'guest-1' } as { id: string } | null,
    account: null as import('@/auth/accountState').AccountState | null,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false as boolean,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
  opNames: [
    'acceptListing', 'acceptRepairJob', 'acceptShieldTechJob', 'battleResult',
    'cancelCraftJob', 'cancelRepairJob', 'cancelShieldTechJob', 'claimCraftedConsumable',
    'consumeConsumable', 'disablePushDevice', 'enqueueCraftJob', 'enqueueRepairJob',
    'enqueueShieldTechJob', 'equipItem', 'finishRepairJob', 'finishShieldTechJob',
    'fitWorkshopTool', 'idleClaim', 'initialBundle', 'itemLock', 'makeItem',
    'marketCancel', 'marketCreate', 'marketCreateConsumable', 'marketCreateCore',
    'marketCreateEssence', 'marketCreateFragment', 'marketCreateMaterial',
    'postRepairJob', 'postShieldTechJob', 'reclaimRepairJob', 'reclaimShieldTechJob',
    'recycleItem', 'reforgeItem', 'refuelVehicle', 'registerPushDevice', 'resetProgress',
    'retrain', 'trainSkill', 'unequipSlot', 'unlockCraftBench', 'vendorBuy',
    'vendorSellConsumable', 'vendorSellGear', 'vendorSellMaterial',
  ],
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: Object.fromEntries(hoisted.opNames.map((name) => [name, vi.fn(async () => ({}))])),
  fetchWorkshopState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchRepairBoard: vi.fn(),
  fetchShieldTechBoard: vi.fn(),
  fetchCollections: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchProfileLifetime: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
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

import { VendorScreen } from '@/screens/VendorScreen';
import { syncRuntimeProfile } from '@/lib/api/verifiedStateSync';
import { usePlayerStore } from '@/store';

describe('audit G-F3 — server-composed buyback rate drives vendor quotes', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      vendorBuybackRate: null,
      consumableBatches: [],
      consumables: {},
      materials: {},
      essences: {},
      credits: 0,
    });
  });
  afterEach(() => cleanup());

  it('syncs vendor_buyback_rate from the profile payload and never clears it on a payload without the field', () => {
    syncRuntimeProfile({ vendor_buyback_rate: 0.42 } as never);
    expect(usePlayerStore.getState().vendorBuybackRate).toBe(0.42);
    syncRuntimeProfile({} as never);
    expect(usePlayerStore.getState().vendorBuybackRate).toBe(0.42);
  });

  it('quotes consumable sells at the synced rate (42%), not the 40% constant', () => {
    usePlayerStore.setState({
      vendorBuybackRate: 0.42,
      consumableBatches: [{
        id: 'batch-medkit', consumable_type: 'MedKit', quality_percent: 100,
        quantity: 2, origin: 'crafted',
      }],
    });
    render(<VendorScreen />);
    // The buy-lane row copy carries the live rate too (the percent is
    // a JSX expression, so read the row's full text content).
    const row = screen.getByText('Sell to Vendor — Buyback').closest('button');
    expect(row?.textContent).toContain('at 42% of value');
    fireEvent.click(screen.getByText('Sell to Vendor — Buyback'));
    // MedKit unit vendor value is 250: at 0.42 the quotes are
    // floor(250 × .42) = 105 and floor(500 × .42) = 210. At the old
    // hardcoded 0.40 they read 100 / 200 — the G-F3 defect.
    expect(screen.getByText('Sell 1 • ~105cr')).toBeTruthy();
    expect(screen.getByText('Sell all • ~210cr')).toBeTruthy();
    expect(screen.queryByText('Sell 1 • ~100cr')).toBeNull();
  });
});
