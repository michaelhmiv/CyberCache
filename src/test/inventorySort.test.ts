/**
 * Inventory sort (owner ask 2026-11-05): the grouped taxonomy, the
 * real-stat keys, and the SCOPING state machine that replaced the
 * sink rule.
 *
 * Pins:
 *  - General group first and kind-free; every kind key reports its
 *    group kind (the source of scoping truth).
 *  - Weapon "DPS" is the real chain number (computeStandardDps),
 *    not the combatPower proxy.
 *  - Per-key ordering in both directions; equipped pin first in
 *    both; ties keep incoming order; 'recent' reads incoming order.
 *  - Scope transitions: a kind pick scopes via the kind filter; a
 *    General pick clears a SORT-DRIVEN scope but never the player's
 *    own kind filter; a kind-rail pick takes ownership of the
 *    filter and retires a foreign kind sort to Best Overall.
 *  - Persistence derivation: a restored kind key reopens scoped.
 */
import { describe, expect, it } from 'vitest';
import { computeStandardDps } from '@/lib/stats/dpsChain';
import { projectSalvageYield } from '@/lib/gear/salvageAward';
import {
  SORT_GROUPS,
  applyKindPick,
  applySortPick,
  itemComparable,
  naturalDir,
  sortGroupKind,
  sortItems,
  sortStateFromPersisted,
  toggleSortDir,
  weaponDps,
  type SortUiState,
} from '@/lib/gear/inventorySort';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';

const CTX = { bonuses: {} as Record<string, number> };
const NO_EQUIP = new Set<string>();

function weapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'w-1',
    name: 'Test Gun',
    level: 10,
    rarity: Rarity.Rare,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.BlastForge,
    element: Element.Kinetic,
    rollQuality: 50,
    baseDamage: 40,
    attackSpeed: 1,
    critChance: 0.1,
    critDamage: 1.5,
    statusChance: 0.05,
    statusDamage: 10,
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
    pixelSeed: 1,
    combatPower: 100,
    bossPower: 10,
    farmPower: 10,
    economyScore: 10,
    ...overrides,
  };
}

function shield(overrides: Partial<Shield> = {}): Shield {
  return {
    id: 's-1',
    name: 'Test Shield',
    level: 10,
    rarity: Rarity.Rare,
    hp: 200,
    rechargeRate: 12,
    mitigation: 0.1,
    element: Element.Kinetic,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 1,
    ...overrides,
  };
}

function ordnance(overrides: Partial<Ordnance> = {}): Ordnance {
  return {
    id: 'o-1',
    name: 'Test Ordnance',
    level: 10,
    rarity: Rarity.Rare,
    damage: 300,
    shieldDamage: 100,
    armorDamage: 50,
    element: Element.Kinetic,
    effect: 'Boom',
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 1,
    ...overrides,
  };
}

function classMod(overrides: Partial<ClassMod> = {}): ClassMod {
  return {
    id: 'c-1',
    name: 'Test Mod',
    level: 10,
    rarity: Rarity.Rare,
    treeBonus: 'Gunslinger',
    nodeBoosts: { a: 2, b: 1 },
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    ...overrides,
  };
}

function relic(overrides: Partial<Relic> = {}): Relic {
  return {
    id: 'r-1',
    name: 'Test Relic',
    level: 10,
    rarity: Rarity.Rare,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    ...overrides,
  };
}

const ids = (items: GearItem[]) => items.map((item) => item.id);

describe('taxonomy', () => {
  it('leads with the General group, which scopes to nothing', () => {
    expect(SORT_GROUPS[0].id).toBe('general');
    expect(SORT_GROUPS[0].kind).toBeNull();
    expect(SORT_GROUPS[0].options[0].key).toBe('combatPower');
  });

  it('maps every kind key to its own group kind', () => {
    expect(sortGroupKind('dps')).toBe('weapon');
    expect(sortGroupKind('critChance')).toBe('weapon');
    expect(sortGroupKind('shieldHp')).toBe('shield');
    expect(sortGroupKind('mitigation')).toBe('shield');
    expect(sortGroupKind('payload')).toBe('ordnance');
    expect(sortGroupKind('skillBoost')).toBe('classMod');
    expect(sortGroupKind('idleValue')).toBe('relic');
    expect(sortGroupKind('rarity')).toBeNull();
    expect(sortGroupKind('salvageScrap')).toBeNull();
  });

  it('has no duplicate keys across groups', () => {
    const keys = SORT_GROUPS.flatMap((g) => g.options.map((o) => o.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('real-stat keys', () => {
  it('weapon DPS is the chain number, not combatPower', () => {
    // Low combatPower, high real DPS (fast, hard-hitting) — the two
    // orderings must disagree, and the dps key must follow the chain.
    const bruiser = weapon({ id: 'bruiser', baseDamage: 90, attackSpeed: 2, combatPower: 10 });
    const parade = weapon({ id: 'parade', baseDamage: 20, attackSpeed: 0.5, combatPower: 999 });
    expect(computeStandardDps(bruiser)).toBeGreaterThan(computeStandardDps(parade));
    expect(weaponDps(bruiser)).toBe(computeStandardDps(bruiser));
    expect(itemComparable(bruiser, 'dps', CTX)).toBe(computeStandardDps(bruiser));
    expect(ids(sortItems([parade, bruiser], 'dps', 'desc', NO_EQUIP, CTX))).toEqual(['bruiser', 'parade']);
    expect(ids(sortItems([parade, bruiser], 'combatPower', 'desc', NO_EQUIP, CTX))).toEqual(['parade', 'bruiser']);
  });

  it('sorts weapons by damage, crit chance, and status chance from the real fields', () => {
    const a = weapon({ id: 'a', baseDamage: 10, critChance: 0.3, statusChance: 0.01 });
    const b = weapon({ id: 'b', baseDamage: 80, critChance: 0.05, statusChance: 0.4 });
    expect(ids(sortItems([a, b], 'damage', 'desc', NO_EQUIP, CTX))).toEqual(['b', 'a']);
    expect(ids(sortItems([a, b], 'critChance', 'desc', NO_EQUIP, CTX))).toEqual(['a', 'b']);
    expect(ids(sortItems([a, b], 'statusChance', 'desc', NO_EQUIP, CTX))).toEqual(['b', 'a']);
    expect(ids(sortItems([a, b], 'damage', 'asc', NO_EQUIP, CTX))).toEqual(['a', 'b']);
  });

  it('sorts shields by HP / mitigation / recharge and ordnance by payload', () => {
    const s1 = shield({ id: 's1', hp: 100, mitigation: 0.3, rechargeRate: 5 });
    const s2 = shield({ id: 's2', hp: 450, mitigation: 0.05, rechargeRate: 22 });
    expect(ids(sortItems([s1, s2], 'shieldHp', 'desc', NO_EQUIP, CTX))).toEqual(['s2', 's1']);
    expect(ids(sortItems([s1, s2], 'mitigation', 'desc', NO_EQUIP, CTX))).toEqual(['s1', 's2']);
    expect(ids(sortItems([s1, s2], 'recharge', 'desc', NO_EQUIP, CTX))).toEqual(['s2', 's1']);
    const o1 = ordnance({ id: 'o1', damage: 100 });
    const o2 = ordnance({ id: 'o2', damage: 800 });
    expect(ids(sortItems([o1, o2], 'payload', 'desc', NO_EQUIP, CTX))).toEqual(['o2', 'o1']);
  });

  it('salvage value is the projected award in the player’s hands', () => {
    const item = weapon({ id: 'sv', rarity: Rarity.Epic, level: 22 });
    expect(itemComparable(item, 'salvageScrap', CTX)).toBe(projectSalvageYield(item, {}).scrapValue);
    const rich = weapon({ id: 'rich', rarity: Rarity.Legendary, level: 40 });
    const poor = weapon({ id: 'poor', rarity: Rarity.Common, level: 1 });
    expect(ids(sortItems([poor, rich], 'salvageScrap', 'desc', NO_EQUIP, CTX))).toEqual(['rich', 'poor']);
  });

  it('non-holders read 0 for a kind stat (the list is scoped before this matters)', () => {
    expect(itemComparable(shield(), 'dps', CTX)).toBe(0);
    expect(itemComparable(weapon(), 'shieldHp', CTX)).toBe(0);
    expect(itemComparable(relic(), 'payload', CTX)).toBe(0);
    expect(itemComparable(classMod(), 'nodeCount', CTX)).toBe(2);
  });
});

describe('ordering rules', () => {
  it('pins equipped items first in BOTH directions', () => {
    const weak = weapon({ id: 'weak', baseDamage: 1 });
    const strong = weapon({ id: 'strong', baseDamage: 500 });
    const equipped = new Set(['weak']);
    expect(ids(sortItems([strong, weak], 'damage', 'desc', equipped, CTX))).toEqual(['weak', 'strong']);
    expect(ids(sortItems([strong, weak], 'damage', 'asc', equipped, CTX))).toEqual(['weak', 'strong']);
  });

  it('keeps incoming order on ties', () => {
    const a = weapon({ id: 'a', baseDamage: 50 });
    const b = weapon({ id: 'b', baseDamage: 50 });
    expect(ids(sortItems([a, b], 'damage', 'desc', NO_EQUIP, CTX))).toEqual(['a', 'b']);
    expect(ids(sortItems([b, a], 'damage', 'desc', NO_EQUIP, CTX))).toEqual(['b', 'a']);
  });

  it('rarity descends the ladder; name reads A–Z asc and Z–A desc', () => {
    const common = relic({ id: 'common', rarity: Rarity.Common, name: 'Beta' });
    const legendary = relic({ id: 'legendary', rarity: Rarity.Legendary, name: 'Alpha' });
    expect(ids(sortItems([common, legendary], 'rarity', 'desc', NO_EQUIP, CTX))).toEqual(['legendary', 'common']);
    expect(ids(sortItems([common, legendary], 'name', 'asc', NO_EQUIP, CTX))).toEqual(['legendary', 'common']);
    expect(ids(sortItems([common, legendary], 'name', 'desc', NO_EQUIP, CTX))).toEqual(['common', 'legendary']);
  });

  it('recent reads the incoming order (store hands it newest-first)', () => {
    const a = weapon({ id: 'a' });
    const b = weapon({ id: 'b' });
    expect(ids(sortItems([a, b], 'recent', 'desc', NO_EQUIP, CTX))).toEqual(['a', 'b']);
    expect(ids(sortItems([a, b], 'recent', 'asc', NO_EQUIP, CTX))).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [weapon({ id: 'a', baseDamage: 1 }), weapon({ id: 'b', baseDamage: 9 })];
    sortItems(input, 'damage', 'desc', NO_EQUIP, CTX);
    expect(ids(input)).toEqual(['a', 'b']);
  });
});

describe('scoping state machine', () => {
  const ALL: SortUiState = { sort: 'combatPower', dir: 'desc', activeKind: 'all', sortScope: null };

  it('picking a kind-group key scopes the list to that kind', () => {
    const next = applySortPick(ALL, 'shieldHp');
    expect(next).toEqual({ sort: 'shieldHp', dir: 'desc', activeKind: 'shield', sortScope: 'shield' });
  });

  it('picking a General key clears a SORT-DRIVEN scope back to All', () => {
    const scoped = applySortPick(ALL, 'shieldHp');
    const next = applySortPick(scoped, 'rarity');
    expect(next.activeKind).toBe('all');
    expect(next.sortScope).toBeNull();
    expect(next.sort).toBe('rarity');
  });

  it('picking a General key keeps an INDEPENDENT kind filter', () => {
    const filtered = applyKindPick(ALL, 'weapon');
    const next = applySortPick(filtered, 'rarity');
    expect(next.activeKind).toBe('weapon');
    expect(next.sortScope).toBeNull();
  });

  it('picking a second kind key moves the scope to the new kind', () => {
    const scoped = applySortPick(ALL, 'shieldHp');
    const next = applySortPick(scoped, 'dps');
    expect(next.activeKind).toBe('weapon');
    expect(next.sortScope).toBe('weapon');
  });

  it('a kind-rail pick takes ownership: scope clears and a foreign kind sort falls back', () => {
    const scoped = applySortPick(ALL, 'shieldHp');
    const backToAll = applyKindPick(scoped, 'all');
    expect(backToAll).toEqual({ sort: 'combatPower', dir: 'desc', activeKind: 'all', sortScope: null });
    const toWeapons = applyKindPick(scoped, 'weapon');
    expect(toWeapons.sort).toBe('combatPower');
    expect(toWeapons.sortScope).toBeNull();
    const sameKind = applyKindPick(scoped, 'shield');
    expect(sameKind.sort).toBe('shieldHp');
    expect(sameKind.sortScope).toBeNull();
  });

  it('a kind-rail pick keeps a General sort untouched', () => {
    const general: SortUiState = { sort: 'rarity', dir: 'desc', activeKind: 'all', sortScope: null };
    const next = applyKindPick(general, 'relic');
    expect(next.sort).toBe('rarity');
    expect(next.activeKind).toBe('relic');
  });

  it('direction: natural defaults per key, toggle flips', () => {
    expect(naturalDir('name')).toBe('asc');
    expect(naturalDir('dps')).toBe('desc');
    expect(applySortPick(ALL, 'name').dir).toBe('asc');
    expect(toggleSortDir(ALL).dir).toBe('asc');
    expect(toggleSortDir(toggleSortDir(ALL)).dir).toBe('desc');
  });

  it('a persisted kind key reopens scoped; a persisted General key reopens on All', () => {
    expect(sortStateFromPersisted('shieldHp', 'desc')).toEqual({
      sort: 'shieldHp', dir: 'desc', activeKind: 'shield', sortScope: 'shield',
    });
    expect(sortStateFromPersisted('rarity', 'asc')).toEqual({
      sort: 'rarity', dir: 'asc', activeKind: 'all', sortScope: null,
    });
  });
});
