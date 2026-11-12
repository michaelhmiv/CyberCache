/**
 * Gear list windowing at owner scale (latency audit fix, 2026-11-12).
 *
 * The bug this guards: GearHub used to mount the WHOLE filtered
 * inventory in one commit. The owner's real inventory is 2,366
 * items — ~70k DOM nodes of rows, each with a deferred-art observer
 * and a canvas — so the Gear tab's entry cost scaled with inventory
 * size instead of screen size, and row paintings trickled in behind
 * a 2,366-deep activation queue.
 *
 * These tests pin the fix's two contracts:
 *  1. With a 2,366-item inventory, the mounted row count stays
 *     bounded (initial window only) while the header still reports
 *     the full filtered count and the first rows render normally.
 *  2. List-row weapon art requests THUMB density (60x22), not the
 *     stage density whose 360x132 backing store was ~61x the row's
 *     displayed pixels.
 * A third leg pins that search still narrows THROUGH the window:
 * filtering is array-level, so a match at index 2,000 renders as
 * soon as the filter leaves it in a small result set.
 *
 * jsdom has no layout (all rects are 0), so the windowing hook keeps
 * its deterministic initial window here — exactly the bounded mount
 * the contract needs. Scroll-driven range movement is exercised by
 * the seeded browser harness (fix-evidence/gear), not jsdom.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

import { GearHub } from '@/components/gear/GearHub';

function makeWeapon(i: number): Weapon {
  return {
    id: `w-${i}`, name: `Scale Pistol ${i}`, level: 12, rarity: Rarity.Epic,
    weaponType: WeaponType.Pistol, manufacturer: Manufacturer.Ironwood,
    element: Element.Fire, rollQuality: 50, baseDamage: 25, attackSpeed: 2,
    critChance: 0.1, critDamage: 1.5, statusChance: 0, statusDamage: 0,
    bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0, armorDamageMod: 0,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [], affixes: [],
    sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: i + 1, combatPower: 50, bossPower: 40, farmPower: 30, economyScore: 0,
  };
}

const EMPTY_SLOTS = {
  primary: null, secondary: null, heavy: null, ordnance: null,
  shield: null, classMod: null, relic: null, vehicle: null,
};

const OWNER_SCALE = 2366;

beforeEach(() => {
  useInventoryStore.setState({ items: [] });
  useLoadoutStore.setState({ slots: { ...EMPTY_SLOTS } });
});

function renderHub(items: unknown[]) {
  useInventoryStore.setState({ items: items as never });
  return render(<GearHub onNavigate={vi.fn()} onEquipRequest={vi.fn()} />);
}

describe('gear list windowing — owner scale (2,366 items)', () => {
  it('mounts a bounded window of rows, not the whole inventory', () => {
    renderHub(Array.from({ length: OWNER_SCALE }, (_, i) => makeWeapon(i)));
    const rows = screen.getAllByTestId('gear-list-row');
    // The whole inventory would be 2,366 rows; the window mounts
    // only its initial slice (48) — never more than the hard cap.
    expect(rows.length).toBeLessThanOrEqual(96);
    expect(rows.length).toBeGreaterThanOrEqual(24);
    // The first rows render normally...
    expect(screen.getByText('Scale Pistol 0')).not.toBeNull();
    // ...and deep items are NOT in the DOM until scrolled to.
    expect(screen.queryByText('Scale Pistol 2000')).toBeNull();
    // The header still reports the full filtered count.
    expect(screen.getByText(`${OWNER_SCALE}/${OWNER_SCALE}`)).not.toBeNull();
  });

  it('list rows request thumb-density weapon art at scale', () => {
    renderHub(Array.from({ length: OWNER_SCALE }, (_, i) => makeWeapon(i)));
    const row = screen.getByText('Scale Pistol 0').closest('[data-testid="gear-list-row"]')!;
    expect(row.querySelector('[data-density="thumb"]')).not.toBeNull();
    expect(row.querySelector('[data-density="stage"]')).toBeNull();
    expect(row.querySelector('[data-density="card"]')).toBeNull();
  });

  it('search narrows through the window to a deep match', () => {
    renderHub(Array.from({ length: OWNER_SCALE }, (_, i) => makeWeapon(i)));
    expect(screen.queryByText('Scale Pistol 2000')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search name, stat, effect, source...'), {
      target: { value: 'Scale Pistol 2000' },
    });
    // The filtered set is small again, so the match mounts.
    expect(screen.getByText('Scale Pistol 2000')).not.toBeNull();
    expect(screen.getAllByTestId('gear-list-row').length).toBe(1);
  });

  it('small inventories render every row (windowing stays out of the way)', () => {
    renderHub(Array.from({ length: 12 }, (_, i) => makeWeapon(i)));
    expect(screen.getAllByTestId('gear-list-row')).toHaveLength(12);
  });
});
