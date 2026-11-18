/**
 * First-screen fix program, track B1 — the Gear batch
 * (owner-approved 2026-11-17; audit: first-screen-audit/gear.md).
 *
 * Three pins, one per item:
 *  1. Jump chips (§2/§3): the merged Gear page carries a chip row
 *     under the ResourceBar — Loadout · Inventory · Belt —
 *     and each chip scrolls its section into view through the
 *     page's existing scrollToAnchor machinery, so the inventory
 *     (which starts ~700px down) and the belt section (under the
 *     whole windowed inventory) are one tap away on arrival.
 *  2. Compare strip for non-weapons (§6): the hub's Compare Gear
 *     sheet used to print NO stats for shield / mod / ordnance /
 *     relic pairs (the stat blocks were weapon-guarded). A
 *     same-kind non-weapon pair now renders the shared all-kind
 *     GearCompare strip in the second card; weapon pairs keep
 *     their PWR / DMG / Crit block.
 *  3. Slot picker windowing (§5 scale flag): above the hub's
 *     72-item threshold the SlotGearPicker mounts only the
 *     windowed slice of candidates (jsdom keeps the deterministic
 *     initial window, like gearListWindow), the deep tail is not
 *     in the DOM, and equipping from the window still fires with
 *     the right item id. Below the threshold every candidate
 *     renders, exactly as before.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { useInventoryStore, useLoadoutStore, usePlayerStore, useSkillStore, useWorkshopStore } from '@/store';
import { useLoadoutPresetsStore } from '@/store/slices/loadoutPresetsSlice';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Ordnance, Shield, Weapon } from '@/types/items';

import { InventoryScreen } from '@/screens/InventoryScreen';
import { GearHub } from '@/components/gear/GearHub';
import { SlotGearPicker } from '@/components/action/SlotGearPicker';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    equipItem: vi.fn(async () => undefined),
    unequipSlot: vi.fn(async () => undefined),
    itemLock: vi.fn(async () => undefined),
    recycleItem: vi.fn(async () => ({ scrap_award: 10 })),
    claimCraftedConsumable: vi.fn(async () => ({})),
  },
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
  primary: null, secondary: null, heavy: null, ordnance: null,
  shield: null, classMod: null, relic: null, vehicle: null,
};

function makeWeapon(over: Partial<Weapon> = {}): Weapon {
  return {
    id: 'w-1', name: 'Ember Sidearm', level: 12, rarity: Rarity.Epic,
    weaponType: WeaponType.Pistol, manufacturer: Manufacturer.Ironwood,
    element: Element.Fire, rollQuality: 50, baseDamage: 25, attackSpeed: 2,
    critChance: 0.1, critDamage: 1.5, statusChance: 0, statusDamage: 0,
    bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0, armorDamageMod: 0,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [], affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: 7, combatPower: 50, bossPower: 40, farmPower: 30, economyScore: 0,
    ...over,
  };
}

function makeShield(over: Partial<Shield> = {}): Shield {
  return {
    id: 's-1', name: 'Frost Aegis', level: 9, rarity: Rarity.Rare, hp: 220,
    rechargeRate: 12, mitigation: 0.2, element: Element.Cryo, affixes: [],
    sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 3,
    ...over,
  };
}

function makeOrdnance(over: Partial<Ordnance> = {}): Ordnance {
  return {
    id: 'o-1', name: 'Fire Grenade', level: 10, rarity: Rarity.Rare,
    damage: 240, shieldDamage: 180, armorDamage: 200, element: Element.Fire,
    effect: 'Fragmentation: +15% area damage', affixes: [],
    sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 777,
    ...over,
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

describe('jump chips — one tap to Inventory and Belt & Stacks', () => {
  it('renders the three chips under the strip and each chip scrolls its section into view', async () => {
    render(<InventoryScreen onNavigate={vi.fn()} />);
    const chips = await screen.findByTestId('gear-jump-chips');
    expect(chips).toBeTruthy();

    // jsdom has no scrollIntoView; the page's helper guards on
    // its presence, so install a spy per section and prove the
    // chip lands on ITS section (not just any scroll).
    const spies = new Map<string, ReturnType<typeof vi.fn>>();
    for (const id of ['gear-loadout-section', 'gear-inventory-section', 'gear-belt-section']) {
      const el = document.getElementById(id);
      expect(el, `section ${id} exists`).toBeTruthy();
      const spy = vi.fn();
      Object.assign(el as HTMLElement, { scrollIntoView: spy });
      spies.set(id, spy);
    }

    fireEvent.click(screen.getByTestId('gear-jump-chip-gear-inventory-section'));
    expect(spies.get('gear-inventory-section')).toHaveBeenCalledTimes(1);
    expect(spies.get('gear-inventory-section')).toHaveBeenCalledWith({ block: 'start' });
    expect(spies.get('gear-belt-section')).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('gear-jump-chip-gear-belt-section'));
    expect(spies.get('gear-belt-section')).toHaveBeenCalledTimes(1);
    expect(spies.get('gear-belt-section')).toHaveBeenCalledWith({ block: 'start' });

    fireEvent.click(screen.getByTestId('gear-jump-chip-gear-loadout-section'));
    expect(spies.get('gear-loadout-section')).toHaveBeenCalledTimes(1);
  }, 30_000);
});

describe('compare sheet — non-weapon pairs get the all-kind strip', () => {
  function renderHub(items: unknown[]) {
    useInventoryStore.setState({ items: items as never });
    return render(<GearHub onNavigate={vi.fn()} onEquipRequest={vi.fn()} />);
  }

  it('a shield pair prints HP deltas, not two bare pictures', () => {
    renderHub([
      makeShield(),
      makeShield({ id: 's-2', name: 'Ember Aegis', hp: 260, mitigation: 0.25 }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Compare Frost Aegis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare Ember Aegis' }));
    expect(screen.getByText('Compare Gear')).not.toBeNull();
    // The strip's shield deltas: HP 220 -> 260 prints "+40";
    // nothing else on the hub face prints that string.
    expect(screen.getByText('+40')).not.toBeNull();
    expect(screen.getByText('Mit')).not.toBeNull();
  });

  it('an ordnance pair prints Payload deltas', () => {
    renderHub([
      makeOrdnance(),
      makeOrdnance({ id: 'o-2', name: 'Heavy Grenade', damage: 300 }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Compare Fire Grenade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare Heavy Grenade' }));
    expect(screen.getByText('Compare Gear')).not.toBeNull();
    expect(screen.getByText('Payload')).not.toBeNull();
    expect(screen.getByText('+60')).not.toBeNull();
  });

  it('a weapon pair keeps its PWR / DMG / Crit block', () => {
    renderHub([
      makeWeapon(),
      makeWeapon({ id: 'w-2', name: 'Frost Sidearm', element: Element.Cryo }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Compare Ember Sidearm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare Frost Sidearm' }));
    expect(screen.getByText('Compare Gear')).not.toBeNull();
    // Card A prints the plain block ("PWR: 50"); card B prints it
    // with the signed diff appended — the exact string pins A's.
    expect(screen.getByText('PWR: 50')).not.toBeNull();
    expect(screen.getByText('DMG: 25')).not.toBeNull();
  });
});

describe('slot picker windowing — bounded mounts at scale', () => {
  function makePistol(i: number): Weapon {
    return makeWeapon({ id: `p-${i}`, name: `Picker Pistol ${i}`, pixelSeed: i + 1 });
  }

  function renderPicker(count: number, onEquip = vi.fn(async () => undefined)) {
    useInventoryStore.setState({
      items: Array.from({ length: count }, (_, i) => makePistol(i)) as never,
    });
    render(
      <SlotGearPicker
        slot="primary"
        currentItemId={null}
        onClose={vi.fn()}
        onEquip={onEquip}
        onUnequip={vi.fn(async () => undefined)}
      />,
    );
    return onEquip;
  }

  function candidateRows(): HTMLElement[] {
    return screen
      .getAllByRole('button')
      .filter((b) => /Picker Pistol \d+/.test(b.textContent ?? ''));
  }

  it('mounts only the window above the threshold; the deep tail stays out of the DOM', () => {
    renderPicker(150);
    const rows = candidateRows();
    // 150 candidates un-windowed would mount 150 rows; the window
    // mounts its initial slice (48 in jsdom) — never the cap (96).
    expect(rows.length).toBeLessThanOrEqual(96);
    expect(rows.length).toBeGreaterThanOrEqual(24);
    expect(screen.getByText('Picker Pistol 0')).not.toBeNull();
    expect(screen.queryByText('Picker Pistol 149')).toBeNull();
    // The sheet body carries the windowed marker on the list.
    expect(document.querySelector('[data-windowed="true"]')).not.toBeNull();
    // The subtitle still reports the full candidate count.
    expect(screen.getByText('150 of 150 items')).not.toBeNull();
  });

  it('equipping from the window fires with the tapped item id', async () => {
    const onEquip = renderPicker(150);
    const first = candidateRows()[0];
    expect(first.textContent).toContain('Picker Pistol 0');
    fireEvent.click(first);
    expect(onEquip).toHaveBeenCalledWith('p-0');
  });

  it('below the threshold every candidate renders (windowing stays out of the way)', () => {
    renderPicker(12);
    expect(candidateRows()).toHaveLength(12);
    expect(document.querySelector('[data-windowed="true"]')).toBeNull();
  });
});
