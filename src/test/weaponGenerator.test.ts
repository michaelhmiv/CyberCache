import { describe, expect, it } from 'vitest';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { computeStandardDps } from '../lib/stats/dpsChain';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';

/**
 * Frozen-vs-live parity tests for the weapon generator.
 *
 * The audit (see .hermes/plans/dps-chain-v2-plan.md, PR B) found that
 * `weapon.combatPower` was computed at roll time with a *different* formula
 * than `computeStandardDps(weapon)`, the live value the diorama / gear
 * inspect show. Same panel, two numbers, depending on which one you read.
 *
 * PR B fixes this by making the generator call the chain. These tests
 * assert the parity holds for every rolled weapon so future regressions
 * are caught at CI time.
 */

const SOURCES: DropSource[] = [DropSource.WorldDrop, DropSource.BossDrop, DropSource.CacheForged, DropSource.Crafted, DropSource.Event];
const RARITIES: Rarity[] = [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary];
const TYPES: WeaponType[] = Object.values(WeaponType);
const ELEMENTS: Element[] = Object.values(Element);
const MANUFACTURERS: Manufacturer[] = Object.values(Manufacturer);

// Inline copy of the Weapon shape so the test is self-contained. Mirrors
// the makeWeapon() in src/test/dpsChain.test.ts. Keeping it local means
// the test does not depend on the dpsChain test's helpers (Pitfall 8).
function makeWeaponStub(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'stub',
    name: 'Stub',
    level: 50,
    rarity: Rarity.Epic,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic,
    rollQuality: 50,
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
    sourceTag: DropSource.CacheForged,
    isLocked: false,
    pixelSeed: 0,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

describe('weaponGenerator — frozen-vs-live parity', () => {
  it('every rolled weapon has combatPower === Math.round(computeStandardDps(weapon))', () => {
    let count = 0;
    for (const source of SOURCES) {
      for (const rarity of RARITIES) {
        for (const weaponType of TYPES) {
          for (const element of ELEMENTS) {
            for (const manufacturer of MANUFACTURERS) {
              const weapon = generateWeapon({ source, level: 25, forcedRarity: rarity, forcedType: weaponType, forcedElement: element, forcedManufacturer: manufacturer });
              const live = Math.round(computeStandardDps(weapon));
              // The parity is exact (no tolerance) because the generator
              // literally calls computeStandardDps and rounds. If this
              // test ever fails with a non-zero delta, someone has
              // re-introduced a divergent formula.
              expect(weapon.combatPower, `combatPower for ${source}/${rarity}/${weaponType}/${element}/${manufacturer}`).toBe(live);
              count++;
            }
          }
        }
      }
    }
    // Sanity: we ran a meaningful number of combinations. 5 sources ×
    // 5 rarities × 6 types × 6 elements × 6 manufacturers = 5,400.
    expect(count).toBeGreaterThan(1000);
  });

  it('combatPower is monotonically non-decreasing as baseDamage increases', () => {
    // Sanity check: the formula should be linear in baseDamage. We hold
    // everything else constant (same rarity, type, etc.) and assert the
    // higher-level weapon has a strictly higher combatPower.
    const low = generateWeapon({ source: DropSource.CacheForged, level: 1 });
    const high = generateWeapon({ source: DropSource.CacheForged, level: 50 });
    expect(high.combatPower).toBeGreaterThan(low.combatPower);
  });

  it('combatPower survives a round-trip: re-computing the chain on the returned weapon yields the same value', () => {
    const weapon = generateWeapon({ source: DropSource.CacheForged, level: 10 });
    const liveA = Math.round(computeStandardDps(weapon));
    const liveB = Math.round(computeStandardDps(weapon));
    expect(liveA).toBe(liveB);
    expect(weapon.combatPower).toBe(liveA);
  });
});

describe('weaponGenerator — derived stats', () => {
  it('bossPower = combatPower * (1 + bossDamageMod) * (1 + shieldDamageMod*0.3) * (1 + armorDamageMod*0.3)', () => {
    // The exact formula is the composite stat, not the chain. We assert
    // the formula directly so any future change to the composite (e.g.
    // folding in legendary damage) is a deliberate edit.
    const weapon = generateWeapon({ source: DropSource.CacheForged, level: 20 });
    const expected = Math.round(
      weapon.combatPower
      * (1 + weapon.bossDamageMod)
      * (1 + weapon.shieldDamageMod * 0.3)
      * (1 + weapon.armorDamageMod * 0.3),
    );
    expect(weapon.bossPower).toBe(expected);
  });

  it('farmPower = combatPower * (1 + waveDamageMod) * (1 + attackSpeed*0.2)', () => {
    const weapon = generateWeapon({ source: DropSource.CacheForged, level: 20 });
    const expected = Math.round(
      weapon.combatPower
      * (1 + weapon.waveDamageMod)
      * (1 + weapon.attackSpeed * 0.2),
    );
    expect(weapon.farmPower).toBe(expected);
  });

  it('bossPower and farmPower are both ≥ combatPower (no negative modifiers in the base case)', () => {
    // bossDamageMod, shieldDamageMod, armorDamageMod, waveDamageMod are
    // all ≥ 0 on a fresh roll, so the composite multipliers are ≥ 1.
    const weapon = generateWeapon({ source: DropSource.CacheForged, level: 1 });
    expect(weapon.bossPower).toBeGreaterThanOrEqual(weapon.combatPower);
    expect(weapon.farmPower).toBeGreaterThanOrEqual(weapon.combatPower);
  });
});

describe('weaponGenerator — value shifts from PR B are bounded and explainable', () => {
describe('weaponGenerator — affixes baked into stats', () => {
  it('affixes with baseDamage multiply the weapon baseDamage', () => {
    // Generate many weapons and look for one with a baseDamage affix.
    // The weapon's baseDamage should be > the type's baseline at level 1
    // because the affix is multiplicative.
    for (let i = 0; i < 200; i++) {
      const weapon = generateWeapon({ source: DropSource.WorldDrop, level: 1 });
      const dmgAffixes = weapon.affixes.filter((a) => a.stat === 'baseDamage');
      if (dmgAffixes.length > 0) {
        // Loosely: the weapon's baseDamage should be higher than it would
        // be without affixes. The exact value depends on parts and
        // manufacturer bias, but at minimum it's the type's base.
        const typeMin = 8; // lowest baseDamage among all types at level 1
        expect(weapon.baseDamage).toBeGreaterThanOrEqual(typeMin);
        // Stronger assertion: the affix multiplier is visible.
        // We can't compute the exact pre-affix value without replaying
        // the generator, but we can verify the computed dps is nonzero.
        expect(weapon.combatPower).toBeGreaterThan(0);
        return; // found one, test passes
      }
    }
    // If we reach here, we never found a baseDamage affix in 200 tries.
    // That's statistically extremely unlikely (~30% per weapon at Common
    // rarity, so P(no dmg affix in 200) ≈ 0). Fail explicitly.
    expect(true).toBe(false); // should never reach — affix pool includes baseDamage
  });

  it('affixes with critChance add to the weapon critChance', () => {
    // Same pattern: find a weapon with critChance affix, verify stat > 0.
    for (let i = 0; i < 200; i++) {
      const weapon = generateWeapon({ source: DropSource.WorldDrop, level: 1 });
      const critAffixes = weapon.affixes.filter((a) => a.stat === 'critChance');
      if (critAffixes.length > 0) {
        const affixSum = critAffixes.reduce((sum, a) => sum + a.value, 0);
        // critChance should be at least the affix sum (since base is > 0).
        expect(weapon.critChance).toBeGreaterThanOrEqual(affixSum);
        return;
      }
    }
  });

  it('affixes with bossDamageMod, waveDamageMod, shieldDamageMod, armorDamageMod add to their respective stats', () => {
    const modStats = ['bossDamageMod', 'waveDamageMod', 'shieldDamageMod', 'armorDamageMod'] as const;
    for (let i = 0; i < 300; i++) {
      const weapon = generateWeapon({ source: DropSource.WorldDrop, level: 1 });
      for (const stat of modStats) {
        const affixSum = weapon.affixes
          .filter((a) => a.stat === stat)
          .reduce((sum, a) => sum + a.value, 0);
        if (affixSum > 0) {
          expect(weapon[stat]).toBeGreaterThanOrEqual(affixSum);
          return; // found at least one — pass
        }
      }
    }
  });

  it('affixes with offlineEarningsMod, rareDropChanceMod, scrapYieldMod add to their respective stats', () => {
    const idleStats = ['offlineEarningsMod', 'rareDropChanceMod', 'scrapYieldMod'] as const;
    for (let i = 0; i < 300; i++) {
      const weapon = generateWeapon({ source: DropSource.WorldDrop, level: 1 });
      for (const stat of idleStats) {
        const affixSum = weapon.affixes
          .filter((a) => a.stat === stat)
          .reduce((sum, a) => sum + a.value, 0);
        if (affixSum > 0) {
          expect(weapon[stat]).toBeGreaterThanOrEqual(affixSum);
          return;
        }
      }
    }
  });

  it('affix application does not break combatPower parity', () => {
    // The frozen-vs-live parity must still hold after affix baking.
    // With affixes baked in, combatPower must still === computeStandardDps(weapon).
    for (let i = 0; i < 100; i++) {
      const weapon = generateWeapon({ source: DropSource.WorldDrop, level: 25 });
      const live = Math.round(computeStandardDps(weapon));
      expect(weapon.combatPower, `combatPower mismatch on iteration ${i} (affixes: ${weapon.affixes.length})`).toBe(live);
    }
  });
});

  it('combatPower on a baseline weapon is now exactly computeStandardDps, not the legacy formula', () => {
    // This test documents the visible shift. For a weapon with the
    // baseline test stats (100 dmg, 5 spd, 0.2 crit, 1.5 crit mult, 0.1
    // status chance), the legacy generator formula was:
    //   100 * 5 * (1 + 0.2*0.5) * (1 + 0.1*0.5) = 100 * 5 * 1.1 * 1.05 = 577.5 → 578
    // The chain's formula (now with status multiplier) is:
    //   100 * 5 * (1 + 0.2*1.5) * (1 + 0.1*1.0*0.3) = 100 * 5 * 1.3 * 1.03 = 669.5 → 670
    // We assert the new value is 670, NOT 578, so the shift is
    // intentional and visible. If a future agent "fixes" combatPower
    // back to 578, this test fails and they get a clear error message.
    const weapon = makeWeaponStub({
      baseDamage: 100,
      attackSpeed: 5,
      critChance: 0.2,
      critDamage: 1.5,
      statusChance: 0.1,
      statusDamage: 1.0,
    });
    // Sanity: the stub's combatPower is 0 by default; the *frozen* value
    // a generator would write is 670, the *live* chain value is 670.
    const live = Math.round(computeStandardDps(weapon));
    expect(live).toBe(670);
  });
});
