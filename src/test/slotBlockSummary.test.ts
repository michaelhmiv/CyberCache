import { describe, expect, it } from 'vitest';
import {
  ACCESSORY_SLOTS,
  elementTintOf,
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

describe('slotBlockSummary — the merged Gear page perk lines (owner ruling 2026-11-03)', () => {
  it('a gun line is headline DPS, then the real proc/crit perks', () => {
    const block = slotBlockSummary('primary', makeWeapon());
    expect(block.kind).toBe('gun');
    expect(block.filled).toBe(true);
    expect(block.name).toBe('Volt Carbine');
    expect(block.statSegments).toEqual(['DPS 486', 'Status 10%', 'Crit 18%']);
    expect(block.statLine).toBe('DPS 486 · Status 10% · Crit 18%');
  });

  it('rarity and element never print as words — they read by color', () => {
    const blocks = [
      slotBlockSummary('primary', makeWeapon()),
      slotBlockSummary('shield', shield),
      slotBlockSummary('classMod', classMod),
      slotBlockSummary('relic', relic),
      slotBlockSummary('ordnance', ordnance),
    ];
    for (const block of blocks) {
      expect(block.statLine).not.toMatch(/Epic|Rare|Uncommon|Shock|Kinetic/);
    }
    // The element's color is available for the block's icon tint.
    expect(elementTintOf(makeWeapon())).toBe('#3B82F6');
    expect(elementTintOf(shield)).toBe('#9CA3AF');
    expect(elementTintOf(classMod)).toBeNull();
    expect(elementTintOf(null)).toBeNull();
  });

  it('secondary and heavy are guns too; a perkless roll falls back to Roll', () => {
    expect(slotBlockSummary('secondary', makeWeapon()).kind).toBe('gun');
    const plain = makeWeapon({ statusChance: 0, critChance: 0 });
    expect(slotBlockSummary('heavy', plain).statSegments).toEqual(['DPS 486', 'Roll 92']);
    expect(GUN_SLOTS).toEqual(['primary', 'secondary', 'heavy']);
  });

  it('accessories carry headline + next perks', () => {
    expect(slotBlockSummary('shield', shield).statSegments).toEqual(['HP 640', 'Mit 20%', 'Rech 12/s']);
    expect(slotBlockSummary('classMod', classMod).statSegments).toEqual(['4 nodes', 'Boost +5', 'Gunslinger']);
    expect(slotBlockSummary('relic', relic).statSegments).toEqual(['+6% rare drop']);
    expect(slotBlockSummary('ordnance', ordnance).statSegments).toEqual(['Payload 310', 'Shield 40', 'Armor 20']);
    expect(ACCESSORY_SLOTS).toEqual(['shield', 'classMod', 'relic', 'ordnance']);
  });

  it('a one-node class mod singularizes; a second relic affix joins the line', () => {
    const oneNode = { ...classMod, nodeBoosts: { gs_dmg_1: 2 } };
    expect(slotBlockSummary('classMod', oneNode).statSegments[0]).toBe('1 node');
    const twoAffix = {
      ...relic,
      affixes: [
        ...relic.affixes,
        { id: 'a2', stat: 'scrapYieldMod', value: 0.1, tier: 1, displayText: '+10% scrap', category: 'economy' } as Relic['affixes'][number],
      ],
    };
    expect(slotBlockSummary('relic', twoAffix).statSegments).toEqual(['+6% rare drop', '+10% scrap']);
  });

  it('empty slots print the fill prompt, primary as "No weapon"', () => {
    const primary = slotBlockSummary('primary', null);
    expect(primary.filled).toBe(false);
    expect(primary.name).toBe('No weapon');
    expect(primary.statLine).toBe('Tap to fill');
    const relicBlock = slotBlockSummary('relic', null);
    expect(relicBlock.name).toBe('Open');
    expect(relicBlock.statLine).toBe('Tap to fill');
  });

  it('every loadout slot has a block label', () => {
    expect(Object.keys(SLOT_BLOCK_LABELS).sort()).toEqual(
      ['classMod', 'heavy', 'ordnance', 'primary', 'relic', 'secondary', 'shield'].sort(),
    );
  });
});
