/**
 * Vendor buy-quantity wiring (owner-approved, 2026-11-13).
 *
 * A vendor row's Buy button no longer buys exactly one: it opens
 * the VendorBuySheet quantity picker, and the picked quantity is
 * what reaches verifiedOps.vendorBuy (the op already accepted a
 * quantity; the shipped screen hardcoded 1). The row copy drops
 * the now-untrue "1": "Buy • 150cr".
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
  vendorBuy: vi.fn(async () => ({})),
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
    'retrain', 'trainSkill', 'unequipSlot', 'unlockCraftBench',
    'vendorSellConsumable', 'vendorSellGear', 'vendorSellMaterial',
  ],
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    ...Object.fromEntries(hoisted.opNames.map((name) => [name, vi.fn(async () => ({}))])),
    vendorBuy: hoisted.vendorBuy,
  },
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
import { usePlayerStore } from '@/store';

describe('VendorScreen — buy quantity picker wiring', () => {
  beforeEach(() => {
    hoisted.vendorBuy.mockClear();
    usePlayerStore.setState({
      vendorBuybackRate: null,
      consumableBatches: [],
      consumables: { AmmoPack: 26, GenericFuelCell: 14 },
      materials: {},
      essences: {},
      credits: 175000,
    });
  });
  afterEach(() => cleanup());

  it('row buttons drop the fixed "1" (they open the picker now)', () => {
    render(<VendorScreen />);
    const btn = screen.getByTestId('vendor-buy-AmmoPack');
    expect(btn.textContent).toContain('Buy • 150cr');
    expect(btn.textContent).not.toContain('Buy 1');
  });

  it('tapping Buy opens the sheet instead of buying; confirm sends the picked quantity to vendorBuy', async () => {
    render(<VendorScreen />);
    fireEvent.click(screen.getByTestId('vendor-buy-AmmoPack'));
    // Sheet is open; nothing has been bought yet.
    expect(screen.getByTestId('vendor-qty-value')).toHaveTextContent('1');
    expect(hoisted.vendorBuy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('vendor-qty-chip-1000'));
    expect(screen.getByTestId('vendor-qty-value')).toHaveTextContent('1,000');
    fireEvent.click(screen.getByTestId('vendor-qty-confirm'));

    expect(await screen.findByText('Ammo Pack ×1,000 added to inventory.')).toBeInTheDocument();
    expect(hoisted.vendorBuy).toHaveBeenCalledTimes(1);
    expect(hoisted.vendorBuy).toHaveBeenCalledWith('AmmoPack', 1000);
    // Sheet closed after the buy.
    expect(screen.queryByTestId('vendor-qty-value')).not.toBeInTheDocument();
  });

  it('a quantity of 1 keeps the shipped singular notice', async () => {
    render(<VendorScreen />);
    fireEvent.click(screen.getByTestId('vendor-buy-GenericFuelCell'));
    fireEvent.click(screen.getByTestId('vendor-qty-confirm'));
    expect(await screen.findByText('Generic Fuel Cell added to inventory.')).toBeInTheDocument();
    expect(hoisted.vendorBuy).toHaveBeenCalledWith('GenericFuelCell', 1);
  });
});
