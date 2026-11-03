import { describe, expect, it } from 'vitest';
import {
  ACCESSORY_SLOTS,
  GUN_SLOTS,
  SLOT_BLOCK_LABELS,
  slotBlockSummary,
} from '@/lib/loadout/slotBlockSummary';
import type { ClassMod, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'w1',
    name: 'Volt Carbine',
    level: 26,
    rarity: Rarity.Epic,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Shock,
    rollQuality: 92,
    baseDamage: 100,
    attackSpeed: 5,
    critChance: 0.18,
    critDamage: 1.5,
    statusChance: 0.1,
    statusDamage: 1.0,
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
    pixelSeed: 0,
    combatPower: 486,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

const shield: Shield = {
  id: 's1', name: 'Bulwark Aegis', level: 26, rarity: Rarity.Epic,
  hp: 640, rechargeRate: 12, mitigation: 0.2, element: Element.Kinetic,
  affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 0,
};

const classMod: ClassMod = {
  id: 'm1', name: "Gunslinger's Sigil", level: 26, rarity: Rarity.Rare,
  treeBonus: 'Gunslinger',
  nodeBoosts: { gs_dmg_1: 2, gs_crit_1: 1, gs_speed_1: 1, gs_boss_1: 1 },
  affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
};

const relic: Relic = {
  id: 'r1', name: "Prospector's Charm", level: 26, rarity: Rarity.Uncommon,
  affixes: [{
    id: 'a1', stat: 'rareDropChanceMod', value: 0.06, tier: 1,
    displayText: '+6% rare drop', category: 'drop',
  } as Relic['affixes'][number]],
  sourceTag: DropSource.WorldDrop, isLocked: false,
};

const ordnance: Ordnance = {
  id: 'o1', name: 'Magnetized Payload', level: 26, rarity: Rarity.Rare,
  damage: 310, shieldDamage: 40, armorDamage: 20, element: Element.Shock,
  effect: 'magnetize:40', affixes: [], sourceTag: DropSource.WorldDrop,
  isLocked: false, pixelSeed: 0,
};

describe('slotBlockSummary — the merged Gear page block content', () => {
  it('gun slots carry the four-term stat line from the real item', () => {
    const block = slotBlockSummary('primary', makeWeapon());
    expect(block.kind).toBe('gun');
    expect(block.filled).toBe(true);
    expect(block.name).toBe('Volt Carbine');
    expect(block.statLine).toBe('Primary · Epic · Shock · DPS 486');
    expect(block.headline).toBeNull();
  });

  it('secondary and heavy are guns too, with their own slot labels', () => {
    expect(slotBlockSummary('secondary', makeWeapon()).statLine).toContain('Secondary ·');
    expect(slotBlockSummary('heavy', makeWeapon()).statLine).toContain('Heavy ·');
    expect(GUN_SLOTS).toEqual(['primary', 'secondary', 'heavy']);
  });

  it('accessories carry the headline stat alone', () => {
    expect(slotBlockSummary('shield', shield).headline).toBe('HP 640');
    expect(slotBlockSummary('classMod', classMod).headline).toBe('4 nodes');
    expect(slotBlockSummary('relic', relic).headline).toBe('+6% rare drop');
    expect(slotBlockSummary('ordnance', ordnance).headline).toBe('Payload 310');
    expect(ACCESSORY_SLOTS).toEqual(['shield', 'classMod', 'relic', 'ordnance']);
    for (const slot of ACCESSORY_SLOTS) {
      expect(slotBlockSummary(slot, null).kind).toBe('accessory');
      expect(slotBlockSummary(slot, null).statLine).toBeNull();
    }
  });

  it('a one-node class mod singularizes', () => {
    const oneNode = { ...classMod, nodeBoosts: { gs_dmg_1: 2 } };
    expect(slotBlockSummary('classMod', oneNode).headline).toBe('1 node');
  });

  it('empty slots print the fill prompt, primary as "No weapon"', () => {
    const primary = slotBlockSummary('primary', null);
    expect(primary.filled).toBe(false);
    expect(primary.name).toBe('No weapon');
    expect(primary.statLine).toBe('Tap to fill');
    const relicBlock = slotBlockSummary('relic', null);
    expect(relicBlock.name).toBe('Open');
    expect(relicBlock.headline).toBe('Tap to fill');
  });

  it('every loadout slot has a block label', () => {
    expect(Object.keys(SLOT_BLOCK_LABELS).sort()).toEqual(
      ['classMod', 'heavy', 'ordnance', 'primary', 'relic', 'secondary', 'shield'].sort(),
    );
  });
});
