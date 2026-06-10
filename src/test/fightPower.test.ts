/**
 * Tests for the pure `computeFightPower` helper. The regression that
 * triggered PR #1 was "I have a weapon equipped and it says 0 DPS":
 * the boss prep / fight panel was reading `weapon.bossPower` directly,
 * which can be 0 for some weapon configurations. The fix delegates to
 * the unified modifier chain, which never returns 0 when a weapon is
 * in hand.
 */
import { describe, it, expect } from 'vitest';
import type { Weapon } from '@/types/items';
import { DropSource, Element, WeaponType, Rarity, Manufacturer } from '@/types/game';
import type { BossDef } from '@/types/boss';
import { computeFightPower } from '@/lib/stats/fightPower';

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'w1',
    name: 'Test Weapon',
    level: 1,
    rarity: Rarity.Common,
    weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic,
    rollQuality: 0.5,
    baseDamage: 100,
    attackSpeed: 5,
    critChance: 0.2,
    critDamage: 1.5,
    statusChance: 0,
    statusDamage: 0,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 0,
    armorDamageMod: 0,
    rareDropChanceMod: 0,
    offlineEarningsMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    legendaryEffectId: undefined,
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 0,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

function makeBoss(weaknesses: Element[], resistances: Element[] = []): BossDef {
  return {
    id: 'b1',
    name: 'Test Boss',
    tier: 1,
    level: 1,
    health: 1000,
    shield: 0,
    armor: 0,
    dps: 50,
    weaknesses,
    resistances,
    mechanic: { id: 'm1', name: 'None', description: '', checkType: 'survival' },
    tags: [],
    phases: [],
    recommendedPower: 100,
    entryCost: 0,
    rematchCost: 0,
    dropTable: [],
    dedicatedDrops: [],
  };
}

describe('computeFightPower — boss prep / fight panel', () => {
  it('returns a positive number when a weapon is equipped (regression: "0 DPS with a weapon")', () => {
    // This is the exact bug the user reported: equipped weapon, panel
    // shows 0. With the chain delegation, the panel must show a
    // positive number whenever any weapon is in the loadout.
    const weapon = makeWeapon({ id: 'w1', element: Element.Kinetic });
    const result = computeFightPower([weapon], undefined, null);
    expect(result).toBeGreaterThan(0);
  });

  it('returns 0 only when no weapons are equipped AND no inventory weapon is available', () => {
    // True zero is reserved for the "no weapon anywhere" case.
    const result = computeFightPower([], undefined, null);
    expect(result).toBe(0);
  });

  it('falls back to the best inventory weapon when no loadout slots are filled', () => {
    // Old behavior: 0. New behavior: standard-target DPS of the
    // best inventory weapon.
    const weapon = makeWeapon({ id: 'w1' });
    const expected = Math.round(weapon.baseDamage * weapon.attackSpeed * (1 + weapon.critChance * weapon.critDamage));
    const result = computeFightPower([], weapon, null);
    expect(result).toBe(expected);
  });

  it('uses boss-relative DPS when a boss is supplied and weapons are equipped', () => {
    // When a boss is selected, the number must reflect element matchup.
    // A fire weapon against a fire-weak boss should be 1.3× the kinetic
    // version against the same boss.
    const fireWeapon = makeWeapon({ id: 'w1', element: Element.Fire });
    const kineticWeapon = makeWeapon({ id: 'w2', element: Element.Kinetic });
    const boss = makeBoss([Element.Fire]);
    const fireResult = computeFightPower([fireWeapon], undefined, boss);
    const kineticResult = computeFightPower([kineticWeapon], undefined, boss);
    expect(fireResult / kineticResult).toBeCloseTo(1.3, 2);
  });

  it('applies boss resistance penalty when the player element matches a resistance', () => {
    // Boss with fire resistance: fire weapons take 0.7× DPS. This is
    // the 3-state counter table from dpsChain.ts.
    const fireWeapon = makeWeapon({ id: 'w1', element: Element.Fire });
    const boss = makeBoss([], [Element.Fire]);
    const resistedResult = computeFightPower([fireWeapon], undefined, boss);
    const noBossResult = computeFightPower([fireWeapon], undefined, null);
    expect(resistedResult / noBossResult).toBeCloseTo(0.7, 2);
  });

  it('ignores the inventory fallback when at least one loadout slot is filled', () => {
    // The fallback is only used when the loadout is empty. If the
    // player has a worse equipped weapon and a better inventory
    // weapon, the equipped weapon wins.
    const equipped = makeWeapon({ id: 'w1', baseDamage: 10, attackSpeed: 1 });
    const inventory = makeWeapon({ id: 'w2', baseDamage: 1000, attackSpeed: 5 });
    const equippedOnly = computeFightPower([equipped], undefined, null);
    const withInventoryFallback = computeFightPower([equipped], inventory, null);
    expect(equippedOnly).toBe(withInventoryFallback);
  });

  it('sums multiple equipped weapons into a single boss-relative number', () => {
    // The "primary + secondary" loadout should be the sum of the
    // individual weapon DPS values, not the max. Two starter pistols
    // should roughly equal one double-damage pistol.
    const a = makeWeapon({ id: 'a', baseDamage: 100, attackSpeed: 2, critChance: 0, critDamage: 1.5 });
    const b = makeWeapon({ id: 'b', baseDamage: 100, attackSpeed: 2, critChance: 0, critDamage: 1.5 });
    const single = makeWeapon({ id: 'c', baseDamage: 100, attackSpeed: 4, critChance: 0, critDamage: 1.5 });
    const pair = computeFightPower([a, b], undefined, null);
    const one = computeFightPower([single], undefined, null);
    expect(pair).toBe(one);
  });

  it('treats `undefined` boss the same as `null` (no boss context = standard target)', () => {
    // Defensive: callers might pass undefined when the boss is not
    // selected. The helper must produce the same output as null.
    const weapon = makeWeapon({ id: 'w1' });
    const withNull = computeFightPower([weapon], undefined, null);
    const withUndefined = computeFightPower([weapon], undefined, undefined);
    expect(withNull).toBe(withUndefined);
  });
});
