/**
 * Gear LIST row — the true-list pins (owner ruling 2026-11-04,
 * DESIGN.md §3).
 *
 * The old list row was a card standing upright: thumb tile, meta
 * line, six stat pills, badge line, two affix lines — ~3 rows per
 * phone screen. The list is now ONE line per item:
 *
 *   [thumb + element corner badge] Lv · rarity-colored name ·
 *   [equipped chip] [lock] — ONE headline stat per kind
 *
 * Pins:
 *  1. Anatomy per kind: level, name in the rarity color, the
 *     kind's headline stat (weapon DPS · shield HP · ordnance DMG ·
 *     class-mod Boost · relic top affix) from gearRowHeadline.
 *  2. The element rides a corner badge on the thumb (element-color
 *     field + data-element-badge), never the element word; kinds
 *     without an element (class mod, relic) carry no badge.
 *  3. What left the face stays off it: no affix lines, no maker /
 *     type meta, no secondary stat pills in list rows.
 *  4. Equipped slot chip + lock glyph render on the one line.
 *  5. Render cost (freeze investigation 2026-11-04): list rows
 *     compose weapons at STAGE density (a quarter of the card
 *     texels); grid keeps CARD density. And a per-row DOM-node
 *     ceiling, so the row cannot quietly grow back into a card.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { ClassMod, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import { RARITIES } from '@/constants/rarities';
import { ELEMENTS } from '@/constants/elements';
import { gearRowHeadline } from '@/lib/gear/gearCardSummary';

import { GearHub } from '@/components/gear/GearHub';

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function makeWeapon(over: Partial<Weapon> = {}): Weapon {
  return {
    id: 'w-1', name: 'Ember Sidearm', level: 12, rarity: Rarity.Epic,
    weaponType: WeaponType.Pistol, manufacturer: Manufacturer.Ironwood,
    element: Element.Fire, rollQuality: 50, baseDamage: 25, attackSpeed: 2,
    critChance: 0.1, critDamage: 1.5, statusChance: 0, statusDamage: 0,
    bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0, armorDamageMod: 0,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [], affixes: [
      { id: 'a1', category: 'combat', stat: 'weaponDamage', value: 0.12, displayText: '+12% Weapon Damage' },
    ],
    sourceTag: DropSource.WorldDrop, isLocked: false,
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

function makeClassMod(over: Partial<ClassMod> = {}): ClassMod {
  return {
    id: 'cm-1', name: 'Elite Gunslinger Class Mod', level: 10, rarity: Rarity.Epic,
    treeBonus: 'Gunslinger' as ClassMod['treeBonus'],
    nodeBoosts: { gs_crit_1: 2, gs_dmg_2: 1 }, affixes: [],
    sourceTag: DropSource.WorldDrop, isLocked: false,
    ...over,
  };
}

function makeRelic(over: Partial<Relic> = {}): Relic {
  return {
    id: 'r-1', name: 'Echo Stone', level: 5, rarity: Rarity.Rare,
    affixes: [
      { id: 'ra1', category: 'economy', stat: 'xpBoostMod', value: 0.2, displayText: '+20% XP Gain' },
    ],
    sourceTag: DropSource.WorldDrop, isLocked: false,
    ...over,
  };
}

const EMPTY_SLOTS = {
  primary: null, secondary: null, heavy: null, ordnance: null,
  shield: null, classMod: null, relic: null, vehicle: null,
};

beforeEach(() => {
  useInventoryStore.setState({ items: [] });
  useLoadoutStore.setState({ slots: { ...EMPTY_SLOTS } });
});

function renderHub(items: unknown[]) {
  useInventoryStore.setState({ items: items as never });
  return render(<GearHub onNavigate={vi.fn()} onEquipRequest={vi.fn()} />);
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('[data-testid="gear-list-row"]');
  if (!row) throw new Error(`no list row for ${name}`);
  return row as HTMLElement;
}

describe('gear list row — one-line anatomy', () => {
  it('weapon: rarity-colored name, level, DPS headline, element badge — and nothing else', () => {
    renderHub([makeWeapon()]);
    const row = rowOf('Ember Sidearm');

    const name = screen.getByText('Ember Sidearm');
    expect(name.className).toContain('truncate');
    expect(name.style.color).toBe(hexToRgb(RARITIES[Rarity.Epic].color));

    expect(row.textContent).toContain('Lv 12');
    expect(row.textContent).toContain('DPS');
    expect(row.textContent).toContain('50');

    const badge = row.querySelector('[data-element-badge]');
    expect(badge?.getAttribute('data-element-badge')).toBe('Fire');
    expect((badge as HTMLElement).style.backgroundColor).toBe(hexToRgb(ELEMENTS[Element.Fire].color));
    expect(badge?.querySelector('svg')).not.toBeNull();

    // What left the face stays off it: no affix lines, no maker or
    // type meta, no secondary stat pills, no rarity/element words.
    expect(row.textContent).not.toContain('+12% Weapon Damage');
    expect(row.textContent).not.toContain('Ironwood');
    expect(row.textContent).not.toContain('Pistol');
    expect(row.textContent).not.toContain('Boss');
    expect(row.textContent).not.toContain('Farm');
    expect(row.textContent).not.toContain('Epic');
    expect(row.textContent).not.toContain('Fire');
  });

  it('equipped + locked markers ride the same line', () => {
    useLoadoutStore.setState({ slots: { ...EMPTY_SLOTS, primary: 'w-1' } });
    renderHub([makeWeapon({ isLocked: true })]);
    const row = rowOf('Ember Sidearm');
    expect(row.textContent).toContain('Primary');
    expect(row.querySelector('.lucide-lock')).not.toBeNull();
  });

  it('shield: HP headline, Cryo badge', () => {
    renderHub([makeShield()]);
    const row = rowOf('Frost Aegis');
    expect(row.textContent).toContain('HP');
    expect(row.textContent).toContain('220');
    expect(row.querySelector('[data-element-badge="Cryo"]')).not.toBeNull();
  });

  it('ordnance: DMG headline', () => {
    renderHub([makeOrdnance()]);
    const row = rowOf('Fire Grenade');
    expect(row.textContent).toContain('DMG');
    expect(row.textContent).toContain('240');
  });

  it('class mod: Boost headline, no element badge (class mods have no element)', () => {
    renderHub([makeClassMod()]);
    const row = rowOf('Elite Gunslinger Class Mod');
    expect(row.textContent).toContain('Boost');
    expect(row.textContent).toContain('+3');
    expect(row.querySelector('[data-element-badge]')).toBeNull();
  });

  it('relic: the top affix line is the headline, no element badge', () => {
    renderHub([makeRelic()]);
    const row = rowOf('Echo Stone');
    expect(row.textContent).toContain('+20% XP Gain');
    expect(row.querySelector('[data-element-badge]')).toBeNull();
  });

  it('equipped relic with a long activity headline keeps name, chip, and headline on the line', () => {
    useLoadoutStore.setState({ slots: { ...EMPTY_SLOTS, relic: 'r-1' } });
    renderHub([makeRelic({
      level: 29,
      affixes: [{
        id: 'act1', category: 'activity', stat: 'salvagingModule', value: 0.96,
        displayText: 'Salvage Module [90%] · +16.6% Salvage Yield · +6.5% Rare Material',
        subStats: { salvageYield: 0.211, rareMaterialChance: 0.081 },
      }],
    })]);
    const row = rowOf('Echo Stone');
    expect(row.textContent).toContain('Relic'); // the equipped slot chip
    expect(row.textContent).toContain('Salvage: +16.6% Salvage Yield'); // the headline
    // Regression (first capture, 2026-11-04): the chip lived inside
    // the name's flex block and the uncapped headline took the
    // leftover — the name span rendered at 0 width and the headline
    // painted over the chip. The chip is now a row-level sibling…
    const nameEl = screen.getByText('Echo Stone');
    expect(nameEl.parentElement?.textContent).not.toContain('Relic');
    // …and the stat block is width-capped, so a long headline
    // truncates instead of evicting the name.
    const statBlock = [...row.querySelectorAll('div')].find((d) => d.textContent?.startsWith('Salvage:'));
    expect(statBlock?.className).toContain('max-w-[38%]');
    expect(nameEl.parentElement?.className).toContain('min-w-16');
  });

  it('a row stays a row: per-row DOM nodes stay under the card-era ceiling', () => {
    renderHub([makeWeapon(), makeShield(), makeOrdnance(), makeClassMod(), makeRelic()]);
    for (const name of ['Ember Sidearm', 'Frost Aegis', 'Fire Grenade', 'Elite Gunslinger Class Mod', 'Echo Stone']) {
      const nodes = rowOf(name).querySelectorAll('*').length;
      // The card-era list row ran ~50 nodes (tile + 6 pills + badge +
      // affix block). The one-line row must stay lean — measured
      // ~30 with the badge's icon rects; ceiling leaves headroom
      // for small chrome changes, not for a second line of content.
      expect(nodes, `${name} row node count`).toBeLessThanOrEqual(40);
    }
  });
});

describe('gear list row — render cost (freeze investigation guard)', () => {
  it('list composes weapons at stage density; grid keeps card density', () => {
    renderHub([makeWeapon()]);
    const row = rowOf('Ember Sidearm');
    expect(row.querySelector('[data-density="stage"]')).not.toBeNull();
    expect(row.querySelector('[data-density="card"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle inventory layout' }));
    expect(document.querySelector('[data-density="card"]')).not.toBeNull();
  });
});

describe('gearRowHeadline — the one stat per kind', () => {
  it('weapon → DPS (combatPower), shield → HP, ordnance → DMG', () => {
    expect(gearRowHeadline(makeWeapon())).toMatchObject({ label: 'DPS', value: '50' });
    expect(gearRowHeadline(makeShield())).toMatchObject({ label: 'HP', value: '220' });
    expect(gearRowHeadline(makeOrdnance())).toMatchObject({ label: 'DMG', value: '240' });
  });

  it('class mod → Boost (summed node boosts)', () => {
    expect(gearRowHeadline(makeClassMod())).toMatchObject({ label: 'Boost', value: '+3' });
  });

  it('relic → top affix line; affix-less relic falls back to the affix count', () => {
    expect(gearRowHeadline(makeRelic()).value).toBe('+20% XP Gain');
    expect(gearRowHeadline(makeRelic({ affixes: [] }))).toMatchObject({ label: 'Affix', value: '0' });
  });
});
