/**
 * The merged Gear page (Exec C, "the Split" — owner layout,
 * 2026-11-03): the Gear tab's Loadout page is ONE page — the Split
 * doll zone (figure stage + gun rows + accessories band), the
 * Garage, § Inventory, § Belt & Stacks, and the Workshop status
 * strip at the foot (the Workshop stop retired to Home's Craft
 * workspace in the 2026-11-04 crafting consolidation; the strip
 * is its glance + door).
 *
 * These tests pin the new structure the older suites don't reach:
 * the stage (Wardrobe door on it, DPS/HP plate at its foot, no
 * header readouts, no collapse toggle), the build-identity header,
 * the perk lines (owner ruling 2026-11-03: rarity/element by color,
 * never by word), and the Workshop status strip's bench state.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { useInventoryStore, useLoadoutStore, usePlayerStore, useSkillStore, useWorkshopStore } from '@/store';
import { useLoadoutPresetsStore } from '@/store/slices/loadoutPresetsSlice';
import { ActionLoadout } from '@/components/action/ActionLoadout';
import { InventoryScreen } from '@/screens/InventoryScreen';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
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
    itemLock: vi.fn(async () => undefined),
    recycleItem: vi.fn(async () => ({ scrap_award: 10 })),
    claimCraftedConsumable: vi.fn(async () => ({})),
  },
  // No Chef behind these screen tests: the fetch rejects (the
  // gearV2 convention), so the workshop store keeps whatever the
  // test seeded instead of being replaced by a sparse mock view.
  fetchWorkshopState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
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

const EMPTY_SLOTS = {
  primary: null, secondary: null, heavy: null,
  ordnance: null, shield: null, classMod: null, relic: null, vehicle: null,
} as const;

function makeWeapon(id: string, name: string): Weapon {
  return {
    id, name, level: 12, rarity: Rarity.Epic,
    weaponType: WeaponType.SMG, manufacturer: Manufacturer.Redline,
    element: Element.Shock, rollQuality: 80, baseDamage: 60, attackSpeed: 4,
    critChance: 0.18, critDamage: 1.6, statusChance: 0.12, statusDamage: 0.4,
    bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0, armorDamageMod: 0,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [], affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: 7, combatPower: 486, bossPower: 300, farmPower: 200, economyScore: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useInventoryStore.setState({ items: [] });
  useLoadoutStore.setState({
    slots: { ...EMPTY_SLOTS },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({ level: 30, consumables: {}, vehicleFuel: 0 });
  useSkillStore.setState({ spent: {} });
  useLoadoutPresetsStore.setState({ presets: [], activePresetId: null });
  useWorkshopStore.setState({ server: null });
});

describe('the Split — figure stage, gun rows, accessories band', () => {
  it('renders the stage with its hero plate, three gun blocks, and four accessory cards', () => {
    const weapon = makeWeapon('w-split', 'Volt Carbine');
    useInventoryStore.setState({ items: [weapon] });
    useLoadoutStore.setState((s) => ({ slots: { ...s.slots, primary: 'w-split' } }));

    render(<ActionLoadout onOpenWardrobe={vi.fn()} />);

    // The stage: the hunter, the Wardrobe door ON the stage, and
    // the DPS/HP hero plate at its foot.
    const stage = screen.getByTestId('loadout-figure');
    expect(within(stage).getByTestId('loadout-hunter')).toBeTruthy();
    expect(within(stage).getByTestId('loadout-wardrobe-door')).toBeTruthy();
    const plate = within(stage).getByTestId('loadout-stage-plate');
    expect(plate.textContent).toContain('DPS');
    expect(plate.textContent).toContain('HP');

    // The guns down the right column; the poster block carries the
    // perk line from the item's real stats (owner ruling: no
    // rarity/element words — perks only).
    for (const slot of ['primary', 'secondary', 'heavy']) {
      expect(screen.getByTestId(`slot-block-${slot}`)).toBeTruthy();
    }
    const poster = screen.getByTestId('slot-block-primary');
    expect(poster.textContent).toContain('Volt Carbine');
    expect(poster.textContent).toContain('DPS 486 · Status 12% · Crit 18%');
    expect(poster.textContent).not.toMatch(/Epic|Shock/);
    expect(screen.getByTestId('slot-weapon-primary')).toBeTruthy();

    // The accessories band beneath.
    for (const slot of ['shield', 'classMod', 'relic', 'ordnance']) {
      expect(screen.getByTestId(`slot-block-${slot}`)).toBeTruthy();
    }

    // Manage mode has NO collapse toggle (INVENTORY L4) and the
    // header prints no DPS/HP readouts — they live on the plate.
    expect(screen.queryByRole('button', { name: /Collapse loadout|Expand loadout/ })).toBeNull();
  });

  it('the stage Wardrobe door fires its navigation callback', () => {
    const onOpenWardrobe = vi.fn();
    render(<ActionLoadout onOpenWardrobe={onOpenWardrobe} />);
    fireEvent.click(screen.getByTestId('loadout-wardrobe-door'));
    expect(onOpenWardrobe).toHaveBeenCalledTimes(1);
  });

  it('the header prints the build identity — dominant tree · active build', () => {
    useSkillStore.setState({ spent: { gs_dmg_1: 3, gs_crit_1: 2 } });
    useLoadoutPresetsStore.setState({
      presets: [{
        id: 'p1', name: 'Boss Kit', icon: 'skull',
        slots: { ...EMPTY_SLOTS },
        consumables: { PreFight: null, MidFight: null, Emergency: null },
        createdAt: 0, updatedAt: 0,
      }],
      activePresetId: 'p1',
    });
    render(<ActionLoadout />);
    expect(screen.getByText('Gunslinger · Boss Kit')).toBeTruthy();
    expect(screen.getByText('Build')).toBeTruthy();
  });

  it('a fresh account prints no build identity clauses', () => {
    render(<ActionLoadout />);
    expect(screen.queryByText('Build')).toBeNull();
  });
});

describe('the merged page — sections and the Workshop strip', () => {
  it('the stage Wardrobe door routes to the wardrobe navigation target', async () => {
    const onNavigate = vi.fn();
    render(<InventoryScreen onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByTestId('loadout-wardrobe-door'));
    expect(onNavigate).toHaveBeenCalledWith('wardrobe');
  });

  it('the Workshop status strip prints the bench counts and doors to Home’s bench', async () => {
    useWorkshopStore.setState({
      server: {
        benches: 2,
        tools: { fitted: {}, owned: {}, charges: {} } as never,
        masteries: {},
        activeActionKind: null,
        recentCompletions: [],
        jobs: [{
          id: 'job-1', bench: 1, kind: 'consumable', recipeId: 'medkit', name: 'MedKit',
          state: 'running', unitsTotal: 3, unitsCompleted: 1, unitDurationMs: 60_000,
          accruedMs: 1_000, remainingMs: 59_000, xpAwarded: 0, gearRarity: null,
          catalystMaterialId: null, outputs: [], createdAtMs: 0, completedAtMs: null,
          repairItemId: null, repairKitType: null, repairPointsRestored: 0,
        } as never],
      },
    });
    const onNavigate = vi.fn();
    render(<InventoryScreen onNavigate={onNavigate} />);
    const strip = await screen.findByTestId('gear-workshop-strip');
    expect(strip.textContent).toContain('Workshop');
    expect(screen.getByTestId('gear-workshop-strip-counts').textContent).toContain('1 running · 0 queued · 0 ready');
    // A job is on the bench while Craft doesn't hold the slot.
    expect(screen.getByTestId('gear-workshop-strip-state').textContent).toBe('Bench paused');

    fireEvent.click(strip);
    // The alias route: App lands this on Home with the bench open.
    expect(onNavigate).toHaveBeenCalledWith('workshop');
  }, 30_000);
});
