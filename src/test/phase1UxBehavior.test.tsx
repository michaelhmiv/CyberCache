/**
 * Phase 1 UX restructure — behavior tests.
 *
 * Drives the shipped components with the real stores and a mocked
 * verifiedOps transport (the boundary the repo's client tests use):
 *  - Equipping happens ONLY from the gear home: the Fight tab's
 *    loadout is a read-only display whose taps route to Manage, and
 *    GearHub's Equip action lands in the home's Slot Picker, whose
 *    equip changes the loadout the claim/boss paths read.
 *  - The last offline summary can be re-opened after dismissal with
 *    identical numbers, and survives in on-device storage.
 *  - Loadout presets are fully manageable from visible controls
 *    (list / apply / rename / delete), not only the long-press.
 *  - Material "Used in" reads the single recipe source of truth.
 *  - The current-area chip shows the selected area and opens the
 *    picker; the shared area list enforces unlock levels.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Shield, Weapon } from '@/types/items';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { getRecipesUsingMaterial } from '@/constants/craftingRecipes';
import type { SettlementRecap } from '@/lib/activity/activitySettlement';
import { useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';
import { useIdleStore } from '@/store/slices/idleSlice';
import { useLoadoutPresetsStore } from '@/store/slices/loadoutPresetsSlice';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { ActionLoadout } from '@/components/action/ActionLoadout';
import { PresetSwitcher } from '@/components/action/PresetSwitcher';
import { AreaPickerList, CurrentAreaChip } from '@/components/common/AreaPicker';
import { InventoryScreen } from '@/screens/InventoryScreen';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    // Simulate the server round-trip: the real ops sync the returned
    // loadout state into the loadout store; the mock does the same so
    // assertions read the store the claim/boss paths read.
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
    recycleItem: vi.fn(async () => ({ scrap_award: 10 })),
    claimCraftedConsumable: vi.fn(async () => ({})),
  },
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

// jsdom has no IntersectionObserver; ChipRail (inside the Slot Picker)
// needs one. Same stub shape as ChipRail.test.tsx.
globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: IntersectionObserverCallback) {
  return {
    observe: (target: Element) => callback([{ isIntersecting: false, target } as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: () => undefined,
    disconnect: () => undefined,
  };
}) as unknown as typeof IntersectionObserver;

const mockEquipItem = vi.mocked(verifiedOps.equipItem);

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

function makeShield(id: string, name: string): Shield {
  return {
    id,
    name,
    level: 4,
    rarity: Rarity.Rare,
    hp: 220,
    rechargeRate: 12,
    mitigation: 0.2,
    element: Element.Kinetic,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 3,
  };
}

const EMPTY_SLOTS = {
  primary: null, secondary: null, heavy: null,
  ordnance: null, shield: null, classMod: null, relic: null,
} as const;

function seedStores() {
  useInventoryStore.setState({ items: [] });
  useLoadoutStore.setState({
    slots: { ...EMPTY_SLOTS },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({ level: 30 });
  useLoadoutPresetsStore.setState({ presets: [], activePresetId: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seedStores();
  useOfflineRecapStore.getState().reset();
});

describe('Phase 1 — one gear home', () => {
  it('equipping from the gear home (Slot Picker) changes the loadout stores read', async () => {
    const weapon = makeWeapon('w-home', 'Home Pistol');
    useInventoryStore.setState({ items: [weapon] });

    render(<ActionLoadout />);

    // Open the Primary slot's picker and equip the weapon through it.
    fireEvent.click(screen.getByRole('button', { name: /Primary/ }));
    const equipButtons = await screen.findAllByRole('button', { name: /Equip/ });
    fireEvent.click(equipButtons[0]);

    await waitFor(() => {
      expect(useLoadoutStore.getState().slots.primary).toBe('w-home');
    });
    expect(mockEquipItem).toHaveBeenCalledWith('w-home', 'primary');
  });

  it('read-only loadout (Fight tab) shows no equip surface; taps route to Manage', () => {
    const weapon = makeWeapon('w-ro', 'Display Pistol');
    useInventoryStore.setState({ items: [weapon] });
    const onManage = vi.fn();

    render(<ActionLoadout readOnly onManageLoadout={onManage} />);

    // No picker, no preset management on the display surface.
    expect(screen.queryByText('Primary Weapon')).toBeNull();
    expect(screen.queryByText('Save Loadout')).toBeNull();

    // The one door: the Manage button.
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    expect(onManage).toHaveBeenCalledTimes(1);

    // Slot taps take the same door — they never open a picker.
    fireEvent.click(screen.getByRole('button', { name: /Primary/ }));
    expect(onManage).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Primary Weapon')).toBeNull();
    expect(mockEquipItem).not.toHaveBeenCalled();
  });

  it("GearHub's Equip lands in the home's Loadout tab with the Slot Picker open on the item's slot", async () => {
    const shield = makeShield('sh-1', 'Aegis Plate');
    useInventoryStore.setState({ items: [shield] });

    render(<InventoryScreen onNavigate={vi.fn()} />);

    // Open the shield's inspect sheet from the Gear tab.
    fireEvent.click(screen.getByText('Aegis Plate'));
    const equipAction = await screen.findByRole('button', { name: /Equip/ });
    fireEvent.click(equipAction);

    // The home switched to Loadout and the Slot Picker is open on Shield.
    await screen.findByText(/Your seven gear slots/);
    expect(await screen.findByText('Shield', { selector: '.bl-title' })).toBeTruthy();

    // Equipping through the picker performs the one equip path. (The
    // Gear tab has unmounted by now, so the only Aegis Plate button is
    // the picker's candidate row.)
    const pickerEquip = await screen.findByRole('button', { name: /Aegis Plate/ });
    fireEvent.click(pickerEquip);
    await waitFor(() => {
      expect(useLoadoutStore.getState().slots.shield).toBe('sh-1');
    });
    expect(mockEquipItem).toHaveBeenCalledWith('sh-1', 'shield');
  });
});

describe('Phase 1 — replayable offline summary', () => {
  const recap = {
    settled: true,
    areaId: 'dustwaste',
    areaName: 'Dustwaste',
    timeAway: '2h 5m',
    elapsedMs: 7_500_000,
    cappedMs: 7_500_000,
    capReached: false,
    capHours: 4,
    ticksSettled: 120,
    startTick: 0,
    endTick: 120,
    profile: {},
    rewards: {
      creditsAwarded: 4321,
      scrapAwarded: 87,
      xpAwarded: 640,
      cacheFragmentsAwarded: 2,
      materials: { ScrapAlloy: 5 },
      essences: {},
    },
    items: [],
  } as unknown as SettlementRecap;

  it('re-opens after dismissal with identical numbers and persists on-device', () => {
    const store = useOfflineRecapStore.getState();
    store.setSettlement(recap);
    expect(useOfflineRecapStore.getState().dismissed).toBe(false);

    useOfflineRecapStore.getState().dismiss();
    expect(useOfflineRecapStore.getState().dismissed).toBe(true);
    // Dismissal never loses the summary.
    expect(useOfflineRecapStore.getState().lastSettlement?.rewards.creditsAwarded).toBe(4321);

    useOfflineRecapStore.getState().reopen();
    const reopened = useOfflineRecapStore.getState();
    expect(reopened.dismissed).toBe(false);
    expect(reopened.lastSettlement?.rewards.creditsAwarded).toBe(4321);
    expect(reopened.lastSettlement?.rewards.xpAwarded).toBe(640);
    expect(reopened.lastSettlement?.ticksSettled).toBe(120);

    // Persisted copy matches, so a later session can re-open it too.
    const raw = localStorage.getItem('cybercache.offlineRecap.v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as { recap: SettlementRecap; dismissed: boolean };
    expect(parsed.recap.rewards.creditsAwarded).toBe(4321);
    expect(parsed.dismissed).toBe(false);
  });
});

describe('Phase 1 — visible preset management', () => {
  it('lists, renames, and deletes presets from the visible Manage sheet', async () => {
    const weapon = makeWeapon('w-preset', 'Preset Pistol');
    useInventoryStore.setState({ items: [weapon] });
    useLoadoutStore.setState({
      slots: { ...EMPTY_SLOTS, primary: 'w-preset' },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    const savedId = useLoadoutPresetsStore.getState().savePreset('Alpha');
    expect(savedId).toBeTruthy();

    render(<PresetSwitcher />);

    // The visible door (not a long-press).
    fireEvent.click(screen.getByTestId('preset-manage-button'));
    expect(await screen.findByText('Loadout Presets')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeTruthy();

    // Rename from the visible controls.
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = await screen.findByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: 'Bravo' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => {
      expect(useLoadoutPresetsStore.getState().presets[0]?.name).toBe('Bravo');
    });

    // Delete from the visible controls.
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await waitFor(() => {
      expect(useLoadoutPresetsStore.getState().presets).toHaveLength(0);
    });
  });
});

describe('Phase 1 — material "Used in" + area picker', () => {
  it('resolves consuming recipes from the single recipe source', () => {
    expect(getRecipesUsingMaterial('IgnitionFluid').map((r) => r.id)).toEqual(['recipe_fire_ammo']);
    expect(getRecipesUsingMaterial('ScrapAlloy').map((r) => r.id)).toContain('recipe_medkit');
    expect(getRecipesUsingMaterial('VoidEssence').map((r) => r.id)).toEqual(['recipe_void_ammo']);
    expect(getRecipesUsingMaterial('NoSuchMaterial')).toEqual([]);
  });

  it('chip shows the current area and fires the picker opener', () => {
    useIdleStore.setState({ selectedRoamingAreaId: ROAMING_AREAS[0].id });
    const onClick = vi.fn();
    render(<CurrentAreaChip onClick={onClick} />);
    const chip = screen.getByTestId('current-area-chip');
    expect(chip.textContent).toContain(ROAMING_AREAS[0].name);
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shared area list locks level-gated areas and selects unlocked ones', () => {
    usePlayerStore.setState({ level: 1 });
    useIdleStore.setState({ selectedRoamingAreaId: ROAMING_AREAS[0].id });
    const onSelect = vi.fn();
    render(<AreaPickerList onSelect={onSelect} />);

    const lastArea = ROAMING_AREAS[ROAMING_AREAS.length - 1];
    const lockedButton = screen.getByRole('button', { name: `Select ${lastArea.name}` });
    expect((lockedButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: `Select ${ROAMING_AREAS[1].name}` }));
    // Level 1 cannot select the Lv.4 area either — the click is disabled;
    // select the starting area instead to prove the callback wiring.
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: `Select ${ROAMING_AREAS[0].name}` }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: ROAMING_AREAS[0].id }));
  });
});
