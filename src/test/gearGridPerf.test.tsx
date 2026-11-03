/**
 * Gear-grid perf regression pins (2026-11-02, owner report: switching
 * the Gear tab inventory to GRID lagged and froze on a Pixel with a
 * veteran inventory).
 *
 * The audit (132 real generated items, 4x CPU throttle, medians of 5)
 * found three compounding causes; these tests pin the structural
 * fixes so they cannot silently regress:
 *
 *  1. Cards are MEMOIZED: hub chrome state (opening the sort menu,
 *     typing in search before it filters, opening sheets) must not
 *     re-render any card's illustration subtree.
 *  2. Cards carry NO framer-motion `layout` prop (source pin — the
 *     layout projection pass over 132 cards was half the freeze and
 *     is invisible in jsdom behavior, so it is pinned at the source).
 *  3. Gear illustrations no longer duplicate the shared SVG filter
 *     defs per item: a rendered grid contains ZERO <defs> copies of
 *     the shared filters (they live in the one document-level
 *     <SharedDefsMount /> at the App root, referenced by ID).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Shield, Weapon } from '@/types/items';

// Count GearIllustration renders without replacing its output: wrap
// the real module and tally calls per item id.
const illustrationRenders = new Map<string, number>();
vi.mock('@/components/gearArt/GearIllustration', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/gearArt/GearIllustration')>();
  const Real = original.GearIllustration;
  const Counting: typeof Real = (props) => {
    illustrationRenders.set(props.item.id, (illustrationRenders.get(props.item.id) ?? 0) + 1);
    return <Real {...props} />;
  };
  return { ...original, GearIllustration: Counting };
});

import { GearHub } from '@/components/gear/GearHub';

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

function seedInventory(count = 12) {
  const items = Array.from({ length: count }, (_, i) =>
    i % 3 === 0 ? makeShield(`it-${i}`, `Aegis ${i}`) : makeWeapon(`it-${i}`, `Pistol ${i}`));
  useInventoryStore.setState({ items });
  return items;
}

beforeEach(() => {
  illustrationRenders.clear();
  useInventoryStore.setState({ items: [] });
  useLoadoutStore.setState({
    slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, vehicle: null },
  });
});

describe('gear grid perf — memoized cards', () => {
  it('hub chrome state changes do not re-render any card illustration', () => {
    seedInventory(12);
    render(<GearHub onNavigate={vi.fn()} onEquipRequest={vi.fn()} />);
    const afterMount = new Map(illustrationRenders);
    expect(afterMount.size).toBe(12);

    // Open + close the sort dropdown: pure hub chrome state.
    const sortButton = screen.getByRole('button', { name: /Best Overall/ });
    fireEvent.click(sortButton);
    fireEvent.click(sortButton);
    // Open + close the Filters sheet trigger state is heavier (sheet
    // mounts); the sort toggle is the minimal chrome churn.
    expect(new Map(illustrationRenders)).toEqual(afterMount);
  });

  it('an unrelated loadout-store field write does not re-render cards', () => {
    seedInventory(12);
    render(<GearHub onNavigate={vi.fn()} onEquipRequest={vi.fn()} />);
    const afterMount = new Map(illustrationRenders);
    // Consumable slots live in the loadout store but are not the gear
    // grid's business: writing one must not touch the cards (narrow
    // slots-only subscription).
    act(() => {
      useLoadoutStore.getState().setConsumableSlot('PreFight', 'stim');
    });
    expect(new Map(illustrationRenders)).toEqual(afterMount);
  });

  it('grid view renders every item as a card', () => {
    seedInventory(12);
    const { container } = render(<GearHub onNavigate={vi.fn()} onEquipRequest={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Toggle inventory layout/ }));
    const grid = container.querySelector('.grid.grid-cols-2');
    expect(grid).toBeTruthy();
    expect(grid?.children.length).toBe(12);
    expect(screen.getByText('Pistol 1')).toBeTruthy();
    expect(screen.getByText('Aegis 0')).toBeTruthy();
  });
});

describe('gear grid perf — shared SVG defs are not duplicated per item', () => {
  it('a grid full of shields contains no per-item shared-defs copies', () => {
    seedInventory(12);
    const { container } = render(<GearHub onNavigate={vi.fn()} onEquipRequest={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Toggle inventory layout/ }));
    // The shared filters (surface-*, bevel-*) exist exactly ONCE in a
    // document — inside the App-root <SharedDefsMount /> — which this
    // isolated render does not mount. Per-item copies would show up
    // here as <filter id="surface-…"> elements inside the cards.
    const sharedFilters = container.querySelectorAll(
      'filter[id^="surface-"], filter[id^="bevel-"], filter#wear-scratches',
    );
    expect(sharedFilters.length).toBe(0);
    // The illustrations themselves still render. Since gear
    // marriage slice 1, shields draw through the pixel plate
    // engine (canvas) like weapons — no SVG item art remains in
    // the grid at all, which is the defs problem gone entirely.
    const grid = container.querySelector('.grid.grid-cols-2');
    expect(grid?.querySelectorAll('canvas').length).toBeGreaterThan(0);
    expect(grid?.querySelectorAll('svg').length).toBe(0);
  });
});

describe('gear grid perf — no framer-motion layout prop on cards (source pin)', () => {
  it('GearHub card elements carry no `layout` prop', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/gear/GearHub.tsx'), 'utf8');
    // The card JSX lives in the GearCard component; motion.button /
    // motion.div there must not opt into layout projection. (Other
    // motion elements — the bulk-action bar, sheets — are few and
    // keep their animations.)
    const cardSection = source.slice(source.indexOf('const GearCard'), source.indexOf('// ── Component'));
    expect(cardSection.length).toBeGreaterThan(0);
    expect(cardSection).not.toMatch(/<motion\.(button|div)\s+layout[\s>]/);
    expect(cardSection).not.toMatch(/\n\s+layout\n/);
  });
});
