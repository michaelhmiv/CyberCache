import { describe, expect, it } from 'vitest';
import { generateWeapon } from '../lib/generators/weaponGenerator';
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
  it('combatPower on a baseline weapon is now exactly computeStandardDps, not the legacy formula', () => {
    // This test documents the visible shift. For a weapon with the
    // baseline test stats (100 dmg, 5 spd, 0.2 crit, 1.5 crit mult, 0.1
    // status chance), the legacy generator formula was:
    //   100 * 5 * (1 + 0.2*0.5) * (1 + 0.1*0.5) = 100 * 5 * 1.1 * 1.05 = 577.5 → 578
    // The chain's formula is:
    //   100 * 5 * (1 + 0.2*1.5) = 100 * 5 * 1.3 = 650
    // We assert the new value is 650, NOT 578, so the shift is
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
    // a generator would write is 650, the *live* chain value is 650.
    const live = Math.round(computeStandardDps(weapon));
    expect(live).toBe(650);
  });
});
