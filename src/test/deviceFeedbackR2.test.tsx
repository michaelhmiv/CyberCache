/**
 * Device feedback round 2 — Part 1 regression tests.
 *
 * Michael's device report (2026-10-31): "adding gear to load out
 * does not work." The flow audit (cybercache-prep/flow-audit-2026-10-31.md)
 * pinned it: the mutation chain itself is sound (SlotGearPicker →
 * verifiedOps.equipItem → cc_equip_item → loadout snapshot sync);
 * the failure is REACHING the surface and seeing it:
 *
 *  F2 — every loadout door landed on Inventory's Gear tab; no nav
 *       path carried a tab intent. Fixed by threading a tab intent
 *       (App → InventoryScreen) and pointing the Dashboard "Loadout
 *       Bench" + Fight "Manage" doors at onNavigate('loadout').
 *  F3 — the Loadout panel's collapsed state persisted in
 *       localStorage, so the gear home could mount showing only a
 *       header + preset switcher — no slots at all. Fixed: manage
 *       mode always mounts expanded; persistence is display-only.
 *  F4 — GearHub's Equip silently closed the inspect sheet when slot
 *       resolution returned null. Fixed: sheet stays open + notice.
 *  F8 — GearHub's Lock was a bare local flag the next server sync
 *       overwrote. Fixed: verifiedOps.itemLock (ChestScreen pattern).
 *  F17 — fixed-position sheets mounted inside the loadout panel's
 *       clip-path + overflow:hidden section were trapped in the
 *       panel's box on device. Fixed: PickerSheet + SwapUndoToast
 *       portal to document.body.
 *
 * These tests drive the real component tree exactly as a player
 * would, with verifiedOps mocked at the transport boundary (the
 * repo's client-test convention): the mock applies the same store
 * sync the real op's server snapshot produces.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import { useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';
import { useLoadoutPresetsStore } from '@/store/slices/loadoutPresetsSlice';
import { useVehicleStore } from '@/store/slices/vehicleSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { ActionLoadout } from '@/components/action/ActionLoadout';
import { GaragePanel } from '@/components/gear/GaragePanel';
import { InventoryScreen } from '@/screens/InventoryScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    // The real ops sync the returned server state into the stores;
    // the mocks apply the same end state so assertions read the
    // stores the claim/boss paths read.
    equipItem: vi.fn(async (itemId: string, slot: string) => {
      useLoadoutStore.setState((s) => ({
        slots: { ...s.slots, [slot]: itemId } as typeof s.slots,
      }));
    }),
    unequipSlot: vi.fn(async (slot: string) => {
      useLoadoutStore.setState((s) => ({
        slots: { ...s.slots, [slot]: null } as typeof s.slots,
      }));
    }),
    itemLock: vi.fn(async (itemId: string, locked: boolean) => {
      useInventoryStore.setState((s) => ({
        items: s.items.map((i) => (i.id === itemId ? { ...i, isLocked: locked } : i)),
      }));
    }),
    recycleItem: vi.fn(async () => ({ scrap_award: 10 })),
    claimCraftedConsumable: vi.fn(async () => ({})),
  },
  fetchWorkshopState: vi.fn(async () => ({
    benches: 1,
    tools: {},
    jobs: [],
    masteries: {},
    activeActionKind: null,
    recentCompletions: [],
  })),
  // 0034: Profile's trophy-shelf / lifetime panels fetch on mount.
  // No Chef exists behind these screen tests, so the fetch rejects
  // and the panels stay hidden — their designed unreachable-Chef
  // behavior — leaving the rest of Profile exactly as shipped.
  fetchProfileLifetime: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'hunter@example.com' },
    account: { userId: 'u-1', email: 'hunter@example.com', isAnonymous: true, hasUsername: false },
    signOut: vi.fn(),
    actionLoading: false,
  }),
}));

vi.mock('@/lib/api/statsService', () => ({ getMyStatsSummary: async () => null }));
vi.mock('@/lib/api/usernameService', () => ({ getMyProfileSummary: async () => null }));
vi.mock('@/lib/api/progressionService', () => ({
  getMyProgressionSnapshots: async () => [],
  extractMetricSeries: () => [],
}));
vi.mock('@/lib/api/masteryService', () => ({
  getMyMasterySummary: async () => [],
  masteryLevelProgress: () => ({ level: 1, current: 0, next: 100, pct: 0 }),
}));
vi.mock('@/lib/chef/chefClient', () => ({
  getCacheRankState: async () => null,
  newCacheRankNonce: () => 'nonce',
  spendCacheRankBonus: async () => null,
  getActionSkillState: async () => null,
  newActionSkillNonce: () => 'nonce',
  selectActionSkill: async () => null,
  getResearchState: async () => null,
  newResearchEnrollNonce: () => 'nonce',
  newResearchCancelNonce: () => 'nonce',
  enrollResearch: async () => null,
  cancelResearch: async () => null,
  getStandingState: async () => null,
  newStandingTurnInNonce: () => 'nonce',
  newStandingRankUpNonce: () => 'nonce',
  newStandingBuyNonce: () => 'nonce',
  newStandingOrderNonce: () => 'nonce',
  turnInItem: async () => null,
  rankUpManufacturer: async () => null,
  standingBuy: async () => null,
  standingOrder: async () => null,
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

// jsdom has no IntersectionObserver; ChipRail (inside the Slot
// Picker) needs one. Same stub shape as phase1UxBehavior.test.tsx.
globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: IntersectionObserverCallback) {
  return {
    observe: (target: Element) => callback([{ isIntersecting: false, target } as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: () => undefined,
    disconnect: () => undefined,
  };
}) as unknown as typeof IntersectionObserver;

const mockEquipItem = vi.mocked(verifiedOps.equipItem);
const mockItemLock = vi.mocked(verifiedOps.itemLock);

// ── Item factories ──────────────────────────────────────────────────

function makeWeapon(id: string, name: string): Weapon {
  return {
    id, name, level: 5, rarity: Rarity.Rare,
    weaponType: WeaponType.Pistol, manufacturer: Manufacturer.Ironwood,
    element: Element.Kinetic, rollQuality: 50, baseDamage: 25, attackSpeed: 2,
    critChance: 0.1, critDamage: 1.5, statusChance: 0, statusDamage: 0,
    bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0, armorDamageMod: 0,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [], affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: 7, combatPower: 50, bossPower: 50, farmPower: 50, economyScore: 0,
  };
}

function makeShield(id: string, name: string): Shield {
  return {
    id, name, level: 4, rarity: Rarity.Rare, hp: 220, rechargeRate: 12,
    mitigation: 0.2, element: Element.Kinetic, affixes: [],
    sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 3,
  };
}

function makeClassMod(id: string, name: string): ClassMod {
  return {
    id, name, level: 4, rarity: Rarity.Rare, treeBonus: 'Gunslinger',
    nodeBoosts: { gs_1: 1 }, affixes: [], sourceTag: DropSource.WorldDrop,
    isLocked: false,
  };
}

function makeRelic(id: string, name: string): Relic {
  return {
    id, name, level: 4, rarity: Rarity.Rare, affixes: [],
    sourceTag: DropSource.WorldDrop, isLocked: false,
  };
}

function makeOrdnance(id: string, name: string): Ordnance {
  return {
    id, name, level: 4, rarity: Rarity.Rare, damage: 120, shieldDamage: 30,
    armorDamage: 20, element: Element.Kinetic, effect: 'Detonates on impact',
    affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 1,
  };
}

/**
 * An item shape NO slot guard accepts: it carries `damage` (so the
 * relic guard rejects it) but no `effect` (so the ordnance guard
 * rejects it too), and none of the weapon/shield/class-mod markers.
 * This is the F4 silent-no-op shape.
 */
function makeUnresolvableItem(id: string, name: string): GearItem {
  return {
    id, name, level: 3, rarity: Rarity.Rare, damage: 40, affixes: [],
    sourceTag: DropSource.WorldDrop, isLocked: false,
  } as unknown as GearItem;
}

const EMPTY_SLOTS = {
  primary: null, secondary: null, heavy: null,
  ordnance: null, shield: null, classMod: null, relic: null, vehicle: null,
} as const;

function seedStores() {
  useInventoryStore.setState({ items: [] });
  useLoadoutStore.setState({
    slots: { ...EMPTY_SLOTS },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({ level: 30, consumables: {}, vehicleFuel: 0 });
  useLoadoutPresetsStore.setState({ presets: [], activePresetId: null });
  useVehicleStore.setState({ vehicles: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seedStores();
});

/** The slot chip button for a label (chips render label text in a span). */
function slotChip(label: string): HTMLElement {
  const el = screen.getByText(label, { exact: true });
  const btn = el.closest('button');
  if (!btn) throw new Error(`no chip button for label ${label}`);
  return btn;
}

/** Click the picker's candidate row for an item and await the equip. */
async function equipFromPicker(itemId: string, itemName: string, slot: string) {
  const row = await screen.findByRole('button', { name: new RegExp(itemName) });
  fireEvent.click(row);
  await waitFor(() => {
    expect(useLoadoutStore.getState().slots[slot as keyof typeof EMPTY_SLOTS]).toBe(itemId);
  });
  expect(mockEquipItem).toHaveBeenCalledWith(itemId, slot);
}

// ── F2 — doors land on the Loadout tab ─────────────────────────────

describe('device r2 — F2: loadout doors arrive at the equip surface', () => {
  it('a loadout tab intent opens the gear home ON the Loadout tab, slots visible, equip works end to end', async () => {
    const weapon = makeWeapon('w-door', 'Door Pistol');
    useInventoryStore.setState({ items: [weapon] });

    render(<InventoryScreen onNavigate={vi.fn()} tabIntent={{ tab: 'loadout', seq: 1 }} />);

    // The Loadout tab mounted (not the Gear list).
    await screen.findByText(/Your seven gear slots/);
    expect(screen.queryByText('Cache Inventory')).toBeNull();

    // Slots are visible and tappable on arrival; the picker opens.
    fireEvent.click(slotChip('Primary'));
    const overlay = await screen.findByTestId('picker-sheet-overlay');
    expect(screen.getByText('Primary Weapon', { selector: '.bl-title' })).toBeTruthy();

    // F17: the sheet is NOT trapped inside the clipped loadout panel.
    const panel = screen.getByTestId('action-loadout');
    expect(panel.contains(overlay)).toBe(false);
    expect(document.body.contains(overlay)).toBe(true);

    await equipFromPicker('w-door', 'Door Pistol', 'primary');

    // The success toast also lives at the root, not inside the panel.
    const toast = await screen.findByTestId('swap-undo-toast');
    expect(panel.contains(toast)).toBe(false);
  });

  it('without an intent the gear home still opens on the Gear tab', async () => {
    useInventoryStore.setState({ items: [makeWeapon('w-gear', 'Gear Pistol')] });
    render(<InventoryScreen onNavigate={vi.fn()} />);
    await screen.findByText('Cache Inventory');
    expect(screen.queryByText(/Your seven gear slots/)).toBeNull();
  });

  it('the doors themselves carry the loadout intent (wiring)', () => {
    const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
    // The deck's "Loadout Bench" (Wave B: the Board's Action Board
    // rides Home's deck) and the stage's Manage door both fire the
    // 'loadout' target, and App turns it into a tab intent.
    expect(read('src/components/dashboard/DashboardDeck.tsx')).toContain("label: 'Loadout Bench'");
    expect(read('src/components/dashboard/DashboardDeck.tsx')).toContain("onClick: () => onNavigate('loadout')");
    expect(read('src/screens/ActionScreenContextual.tsx')).toContain("onManageLoadout={() => onNavigate?.('loadout')}");
    expect(read('src/App.tsx')).toContain("setInventoryTabIntent({ tab: 'loadout'");
    expect(read('src/screens/InventoryScreen.tsx')).toContain('tabIntent');
  });
});

// ── F3 — the gear home mounts expanded ─────────────────────────────

describe('device r2 — F3: the equip grid is reachable on arrival', () => {
  it('manage mode mounts expanded even when a collapse was persisted', async () => {
    localStorage.setItem('cybercache_action_loadout_collapsed', '1');
    const weapon = makeWeapon('w-eq', 'Equipped Pistol');
    useInventoryStore.setState({ items: [weapon] });
    useLoadoutStore.setState((s) => ({ slots: { ...s.slots, primary: 'w-eq' } }));

    render(<ActionLoadout />);

    // The slot chips are on screen immediately — no hidden grid.
    expect(screen.getByText('Primary', { exact: true })).toBeTruthy();
    expect(screen.getByText('Secondary', { exact: true })).toBeTruthy();
    // And the picker still opens from here.
    fireEvent.click(slotChip('Shield'));
    expect(await screen.findByText('Shield', { selector: '.bl-title' })).toBeTruthy();
  });

  it('read-only display still honors the persisted collapse', () => {
    localStorage.setItem('cybercache_action_loadout_collapsed', '1');
    const weapon = makeWeapon('w-ro', 'Display Pistol');
    useInventoryStore.setState({ items: [weapon] });
    useLoadoutStore.setState((s) => ({ slots: { ...s.slots, primary: 'w-ro' } }));

    render(<ActionLoadout readOnly onManageLoadout={vi.fn()} />);

    expect(screen.queryByText('Primary', { exact: true })).toBeNull();
    expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy();
  });
});

// ── The equip surface, every slot kind ─────────────────────────────

describe('device r2 — equipping through the Slot Picker, every slot kind', () => {
  const cases: Array<{ label: string; slot: string; item: () => GearItem }> = [
    { label: 'Primary', slot: 'primary', item: () => makeWeapon('it-primary', 'Case Pistol') },
    { label: 'Secondary', slot: 'secondary', item: () => makeWeapon('it-secondary', 'Case Sidearm') },
    { label: 'Heavy', slot: 'heavy', item: () => makeWeapon('it-heavy', 'Case Cannon') },
    { label: 'Shield', slot: 'shield', item: () => makeShield('it-shield', 'Case Aegis') },
    { label: 'Mod', slot: 'classMod', item: () => makeClassMod('it-mod', 'Case Mod') },
    { label: 'Relic', slot: 'relic', item: () => makeRelic('it-relic', 'Case Relic') },
    { label: 'Ordnance', slot: 'ordnance', item: () => makeOrdnance('it-ord', 'Case Ordnance') },
  ];

  for (const { label, slot, item } of cases) {
    it(`equips a ${slot} item from its slot chip`, async () => {
      const gear = item();
      useInventoryStore.setState({ items: [gear] });
      render(<ActionLoadout />);
      fireEvent.click(slotChip(label));
      await equipFromPicker(gear.id, gear.name, slot);
    });
  }

  it('unequips from the picker and the store follows', async () => {
    const shield = makeShield('sh-un', 'Undo Aegis');
    useInventoryStore.setState({ items: [shield] });
    useLoadoutStore.setState((s) => ({ slots: { ...s.slots, shield: 'sh-un' } }));
    render(<ActionLoadout />);
    fireEvent.click(slotChip('Shield'));
    const unequip = await screen.findByRole('button', { name: /Unequip/ });
    fireEvent.click(unequip);
    await waitFor(() => {
      expect(useLoadoutStore.getState().slots.shield).toBeNull();
    });
    expect(vi.mocked(verifiedOps.unequipSlot)).toHaveBeenCalledWith('shield');
  });

  it('a failed equip surfaces the error and keeps the picker open', async () => {
    const weapon = makeWeapon('w-fail', 'Fail Pistol');
    useInventoryStore.setState({ items: [weapon] });
    mockEquipItem.mockRejectedValueOnce(new Error('Item state invalid'));
    render(<ActionLoadout />);
    fireEvent.click(slotChip('Primary'));
    const row = await screen.findByRole('button', { name: /Fail Pistol/ });
    fireEvent.click(row);
    // The server refusal is visible and the picker does not vanish.
    expect(await screen.findAllByText(/Item state invalid/)).not.toHaveLength(0);
    expect(screen.getByText('Primary Weapon', { selector: '.bl-title' })).toBeTruthy();
    expect(useLoadoutStore.getState().slots.primary).toBeNull();
  });

  it('GearHub’s Equip door lands in the picker for a relic too', async () => {
    const relic = makeRelic('r-door', 'Door Relic');
    useInventoryStore.setState({ items: [relic] });
    render(<InventoryScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText('Door Relic'));
    const equipAction = await screen.findByRole('button', { name: /Equip/ });
    fireEvent.click(equipAction);
    await screen.findByText(/Your seven gear slots/);
    expect(await screen.findByText('Relic', { selector: '.bl-title' })).toBeTruthy();
    await equipFromPicker('r-door', 'Door Relic', 'relic');
  });

  it('the vehicle slot equips from the Garage through the same verified op', async () => {
    useVehicleStore.setState({
      vehicles: [{
        id: 'veh-1', name: 'Scrap Bike', vehicleClassId: 'scrap_bike', level: 1,
        rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
        isLocked: false, pixelSeed: 1, conditionCurrent: 100, conditionMax: 100,
      }],
    });
    render(<GaragePanel />);
    const equipBtn = await screen.findByRole('button', { name: 'Equip' });
    fireEvent.click(equipBtn);
    await waitFor(() => {
      expect(useLoadoutStore.getState().slots.vehicle).toBe('veh-1');
    });
    expect(mockEquipItem).toHaveBeenCalledWith('veh-1', 'vehicle');
  });
});

// ── F4 — GearHub equip never silently no-ops ───────────────────────

describe('device r2 — F4: unresolved equip keeps the sheet open with a notice', () => {
  it('an item with no resolvable slot says so instead of closing silently', async () => {
    const odd = makeUnresolvableItem('odd-1', 'Odd Relic');
    useInventoryStore.setState({ items: [odd] });
    const onEquipRequest = vi.fn();
    const { GearHub } = await import('@/components/gear/GearHub');
    render(<GearHub onNavigate={vi.fn()} onEquipRequest={onEquipRequest} />);

    fireEvent.click(screen.getByText('Odd Relic'));
    const equipAction = await screen.findByRole('button', { name: /Equip/ });
    fireEvent.click(equipAction);

    // Notice naming the problem; the sheet is still open; no handoff.
    expect(await screen.findByText(/can't be equipped/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Equip/ })).toBeTruthy();
    expect(onEquipRequest).not.toHaveBeenCalled();
  });
});

// ── F8 — GearHub lock goes through the verified op ─────────────────

describe('device r2 — F8: item lock is server-verified in the Gear home', () => {
  it('inspect Lock calls verifiedOps.itemLock and the flag follows the server result', async () => {
    const shield = makeShield('sh-lock', 'Lock Aegis');
    useInventoryStore.setState({ items: [shield] });
    const { GearHub } = await import('@/components/gear/GearHub');
    render(<GearHub onNavigate={vi.fn()} onEquipRequest={vi.fn()} />);

    fireEvent.click(screen.getByText('Lock Aegis'));
    const lockBtn = await screen.findByRole('button', { name: /^Lock$/ });
    fireEvent.click(lockBtn);
    await waitFor(() => {
      expect(mockItemLock).toHaveBeenCalledWith('sh-lock', true);
    });
    await waitFor(() => {
      expect(useInventoryStore.getState().items[0].isLocked).toBe(true);
    });

    const unlockBtn = await screen.findByRole('button', { name: /^Unlock$/ });
    fireEvent.click(unlockBtn);
    await waitFor(() => {
      expect(mockItemLock).toHaveBeenCalledWith('sh-lock', false);
    });
    await waitFor(() => {
      expect(useInventoryStore.getState().items[0].isLocked).toBe(false);
    });
  });

  it('a refused lock does NOT flip the local flag and says why', async () => {
    const shield = makeShield('sh-refused', 'Refused Aegis');
    useInventoryStore.setState({ items: [shield] });
    mockItemLock.mockRejectedValueOnce(new Error('Item state invalid'));
    const { GearHub } = await import('@/components/gear/GearHub');
    render(<GearHub onNavigate={vi.fn()} onEquipRequest={vi.fn()} />);

    fireEvent.click(screen.getByText('Refused Aegis'));
    const lockBtn = await screen.findByRole('button', { name: /^Lock$/ });
    fireEvent.click(lockBtn);
    expect(await screen.findByText(/Couldn't lock/)).toBeTruthy();
    expect(useInventoryStore.getState().items[0].isLocked).toBe(false);
  });

  it('bulk lock routes every selected item through the verified op', async () => {
    const a = makeWeapon('w-bulk-a', 'Bulk Alpha');
    const b = makeWeapon('w-bulk-b', 'Bulk Beta');
    useInventoryStore.setState({ items: [a, b] });
    const { GearHub } = await import('@/components/gear/GearHub');
    render(<GearHub onNavigate={vi.fn()} onEquipRequest={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByText('Bulk Alpha'));
    fireEvent.click(screen.getByText('Bulk Beta'));
    expect(await screen.findByText('2 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lock selected' }));
    await waitFor(() => {
      expect(mockItemLock).toHaveBeenCalledWith('w-bulk-a', true);
      expect(mockItemLock).toHaveBeenCalledWith('w-bulk-b', true);
    });
    await waitFor(() => {
      expect(useInventoryStore.getState().items.every((i) => i.isLocked)).toBe(true);
    });
  });
});

// ── Skill Trees door arrives at the tree (F12 half) ────────────────

describe('device r2 — Dashboard Skill Trees door arrives at the embedded tree', () => {
  it('Profile with a skills focus scrolls the Skill Trees card into view', async () => {
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;
    render(<ProfileScreen focusSection="skills" />);
    expect(await screen.findByTestId('profile-skill-trees')).toBeTruthy();
    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled();
    });
  });

  it('Profile without a focus does not scroll', async () => {
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;
    render(<ProfileScreen />);
    expect(await screen.findByTestId('profile-skill-trees')).toBeTruthy();
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
