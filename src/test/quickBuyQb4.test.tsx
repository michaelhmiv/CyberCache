/**
 * QuickBuy QB-4 — the render rule on the two new surfaces.
 *
 *  - Tint panel (Workshop): the + lives on the Chromaweave line,
 *    exactly when the selected palette charges Chromaweave and the
 *    shelf is short. Free starter palettes never show it, a covered
 *    shelf never shows it, and a Scrap-only shortfall never shows
 *    it (Scrap is a profile number — it gets no + anywhere).
 *    Clicking it opens the sheet at the exact shortfall.
 *  - Reforge bench (gear inspect): the + lives on the legendary
 *    core cost line of the confirm block, exactly when the core
 *    cost exceeds the cores on hand. Covered costs and
 *    non-Legendary items (no core line at all) never show it.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountState } from '@/auth/accountState';
import type { QuickBuyQuote } from '@/lib/market/quickBuy';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'player-1' } as { id: string } | null,
    account: null as AccountState | null,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
  quickbuyQuote: vi.fn(),
  quickbuyFill: vi.fn(),
  opNames: [
    'acceptRepairJob', 'cancelRepairJob', 'reclaimRepairJob', 'postRepairJob',
    'acceptShieldTechJob', 'cancelShieldTechJob', 'reclaimShieldTechJob',
    'postShieldTechJob', 'enqueueShieldTechJob', 'finishShieldTechJob',
    'equipItem', 'unequipSlot', 'refuelVehicle', 'enqueueRepairJob',
    'enqueueTintJob', 'reforgeItem',
  ],
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    ...Object.fromEntries(hoisted.opNames.map((name) => [name, vi.fn(async () => ({}))])),
    quickbuyQuote: (...args: unknown[]) => hoisted.quickbuyQuote(...args),
    quickbuyFill: (...args: unknown[]) => hoisted.quickbuyFill(...args),
  },
  fetchWorkshopState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/chef/chefClient', () => ({
  getDispatchState: vi.fn(async () => { throw new Error('not in QB-4 tests'); }),
  previewDispatch: vi.fn(async () => { throw new Error('not in QB-4 tests'); }),
  startDispatch: vi.fn(async () => { throw new Error('not in QB-4 tests'); }),
  recallDispatch: vi.fn(async () => { throw new Error('not in QB-4 tests'); }),
  newDispatchNonce: (kind: string) => `dispatch-${kind}-test-nonce`,
  verifyBossFight: vi.fn(async () => { throw new Error('not in QB-4 tests'); }),
  getActionSkillState: vi.fn(async () => ({
    verified: true,
    actionSkill: {
      charge: 0, chargeMax: 100, charged: false, selection: null,
      selected: null, qualified: [], signatures: [], noKeystoneNote: 'No action skill yet.',
    },
  })),
  getEndlessMe: vi.fn(async () => { throw new Error('not in QB-4 tests'); }),
  advanceEndlessEncounter: vi.fn(async () => { throw new Error('not in QB-4 tests'); }),
  bankEndlessRun: vi.fn(async () => { throw new Error('not in QB-4 tests'); }),
  startEndlessRun: vi.fn(async () => { throw new Error('not in QB-4 tests'); }),
  newEndlessNonce: (kind: string) => `endless-${kind}-test-nonce`,
  getCosmeticsState: vi.fn(async () => { throw new Error('not in QB-4 tests'); }),
  equipCosmetic: vi.fn(async () => ({})),
  unequipCosmetic: vi.fn(async () => ({})),
  setCosmeticHeadVariant: vi.fn(async () => ({})),
  newCosmeticEquipNonce: () => 'cosmetic-equip-test-nonce',
  newCosmeticUnequipNonce: () => 'cosmetic-unequip-test-nonce',
  newCosmeticHeadVariantNonce: () => 'cosmetic-head-test-nonce',
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

import { TintPanel } from '@/components/workshop/TintPanel';
import { ReforgePanel } from '@/components/gear/ReforgePanel';
import { usePlayerStore } from '@/store';
import { useCosmeticsStore } from '@/store/slices/cosmeticsSlice';
import type { CosmeticsStateView } from '@/content/skins';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { createRNG } from '@/lib/utils/rng';
import { DropSource, Rarity } from '@/types/game';
import type { Weapon } from '@/types/items';

const verifiedAccount: AccountState = {
  userId: 'player-1',
  accountType: 'verified',
  username: 'hunter',
  hasUsername: true,
  email: 'hunter@example.com',
  emailVerifiedAt: '2026-06-14T00:00:00.000Z',
  verificationGraceExpiresAt: null,
  verificationReminderLastSeenAt: null,
  isAnonymous: false,
};

function quoteFor(kind: string, id: string, qty: number): QuickBuyQuote {
  return {
    action_type: 'cc_quickbuy_quote',
    good: { kind: kind as QuickBuyQuote['good']['kind'], id },
    requested_qty: qty,
    balance: 100_000,
    market: { listings: [], fills: [], total: 0, fillableQty: 0, supplyQty: 0, partial: true, worstUnitPrice: null },
    vendor: null, // neither QB-4 good has a vendor leg
  };
}

const CW_PLUS = 'quickbuy-plus-material-Chromaweave';
const CORE_PLUS = 'quickbuy-plus-core-legendary';

const cosmeticsView: CosmeticsStateView = {
  selection: { equipped: {}, headVariant: 'standard' },
  selectionExists: true,
  parts: [{
    id: 'part-1', partId: 'rustbucket_chest', slot: 'chest', setId: 'rustbucket',
    tier: 'crafted', name: 'Rustbucket Chestplate', quality: 72,
    tintPaletteId: null, runtimeState: 'available',
  } as unknown as CosmeticsStateView['parts'][number]],
  wearableVariantIds: [],
};

function seedTint(over: { chromaweave?: number; scrap?: number }) {
  usePlayerStore.setState({
    materials: { Chromaweave: over.chromaweave ?? 0 },
    scrap: over.scrap ?? 1_000,
    credits: 100_000,
  });
  useCosmeticsStore.setState({ view: cosmeticsView, loadState: 'ready' });
}

function legendaryWeapon(): Weapon {
  const generated = generateWeapon(
    { source: DropSource.WorldDrop, level: 50, forcedRarity: Rarity.Legendary },
    createRNG(9001),
  ) as Weapon;
  return { ...generated, rarity: Rarity.Legendary, level: 50 };
}

function epicWeapon(): Weapon {
  const generated = generateWeapon(
    { source: DropSource.WorldDrop, level: 40, forcedRarity: Rarity.Epic },
    createRNG(4242),
  ) as Weapon;
  return { ...generated, rarity: Rarity.Epic, level: 40 };
}

beforeEach(() => {
  hoisted.auth.user = { id: 'player-1' };
  hoisted.auth.account = verifiedAccount;
  hoisted.quickbuyQuote.mockReset();
  hoisted.quickbuyFill.mockReset();
  hoisted.quickbuyQuote.mockImplementation(async (kind: string, id: string, qty: number) => quoteFor(kind, id, qty));
});

afterEach(() => {
  cleanup();
  useCosmeticsStore.setState({ view: null, loadState: 'idle' });
});

describe('QB-4 tint mount — the plus rule on the Chromaweave line', () => {
  it('free starter palette: no plus even with an empty shelf', () => {
    seedTint({ chromaweave: 0 });
    render(<TintPanel />);
    // Arctic is the default selection and costs 0 Chromaweave.
    expect(screen.queryByTestId(CW_PLUS)).toBeNull();
  });

  it('paid palette + empty shelf: the plus shows and opens the sheet at the exact shortfall', async () => {
    seedTint({ chromaweave: 0 });
    render(<TintPanel />);
    fireEvent.click(screen.getByTestId('tint-palette-crimson')); // costs 1
    const plus = await screen.findByTestId(CW_PLUS);
    fireEvent.click(plus);
    await waitFor(() => expect(hoisted.quickbuyQuote).toHaveBeenCalled());
    expect(hoisted.quickbuyQuote).toHaveBeenCalledWith('material', 'Chromaweave', 1);
  }, 30_000);

  it('covered shelf: no plus on a paid palette', () => {
    seedTint({ chromaweave: 1 });
    render(<TintPanel />);
    fireEvent.click(screen.getByTestId('tint-palette-crimson'));
    expect(screen.queryByTestId(CW_PLUS)).toBeNull();
  });

  it('scrap-only shortfall: no plus anywhere (Scrap never gets one)', () => {
    seedTint({ chromaweave: 5, scrap: 0 });
    render(<TintPanel />);
    fireEvent.click(screen.getByTestId('tint-palette-crimson'));
    expect(screen.queryByTestId(CW_PLUS)).toBeNull();
    expect((screen.getByTestId('tint-queue-button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('QB-4 reforge mount — the plus rule on the core line', () => {
  function seedBench(over: { cores?: number; scrap?: number }) {
    usePlayerStore.setState({
      scrap: over.scrap ?? 100_000,
      legendaryCores: over.cores ?? 0,
      credits: 100_000,
    });
  }

  async function openConfirm(item: Weapon) {
    render(<ReforgePanel item={item} equipped={false} onReforged={vi.fn()} />);
    const rows = await screen.findAllByRole('button', { name: /Reforge ·/ });
    fireEvent.click(rows[0]!);
  }

  it('short on cores: the plus shows on the core line and opens the sheet at the gap', async () => {
    seedBench({ cores: 0 });
    await openConfirm(legendaryWeapon());
    const plus = await screen.findByTestId(CORE_PLUS);
    fireEvent.click(plus);
    await waitFor(() => expect(hoisted.quickbuyQuote).toHaveBeenCalled());
    expect(hoisted.quickbuyQuote).toHaveBeenCalledWith('core', 'legendary', 2);
  }, 30_000);

  it('cores covered: no plus', async () => {
    seedBench({ cores: 2 });
    await openConfirm(legendaryWeapon());
    await screen.findByText(/legendary cores/);
    expect(screen.queryByTestId(CORE_PLUS)).toBeNull();
  });

  it('non-Legendary item: no core line, no plus', async () => {
    seedBench({ cores: 0 });
    await openConfirm(epicWeapon());
    expect(screen.queryByText(/legendary cores/)).toBeNull();
    expect(screen.queryByTestId(CORE_PLUS)).toBeNull();
  });
});
