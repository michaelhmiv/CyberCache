import { describe, expect, it } from 'vitest';
import { computeLoadoutDps, computeStandardDps, computeWeaponDps, describeDpsContext } from '../lib/stats/dpsChain';
import { DPS_CONSUMABLE_EFFECTS, applySignatureMechanic } from '../lib/stats/signatureMechanic';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'test-weapon',
    name: 'Test Gun',
    level: 50,
    rarity: Rarity.Epic,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Fire,
    rollQuality: 75,
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
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: 'cacheKey' as DropSource,
    isLocked: false,
    pixelSeed: 12345,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

describe('DPS modifier chain', () => {
  describe('computeStandardDps (vs standard target, no modifiers)', () => {
    it('returns rawDps (1.0x) for any element under "vs standard" (PR D: no flesh fallback)', () => {
      // Under PR D, "vs standard" means no element multiplier for any
      // element. The legacy getElementMatchup(element, 'flesh') fallback
      // is gone.
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      for (const element of [Element.Shock, Element.Fire, Element.Cryo, Element.Kinetic, Element.Corrosive, Element.Void]) {
        const weapon = makeWeapon({ element });
        expect(computeStandardDps(weapon)).toBeCloseTo(rawDps, 5);
      }
    });

    it('returns 0 for a weapon with zero damage', () => {
      const weapon = makeWeapon({ baseDamage: 0, element: Element.Shock });
      expect(computeStandardDps(weapon)).toBe(0);
    });

    it('includes the canonical status contribution in standard DPS', () => {
      const weapon = makeWeapon({ statusChance: 0.5, statusDamage: 2 });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      expect(computeStandardDps(weapon)).toBeCloseTo(rawDps * (1 + 0.5 * 2 * 0.3), 4);
    });
  });

  describe('computeWeaponDps (full chain)', () => {
    it('applies the counter-element 1.3x bonus when player element matches boss weakness', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, bossWeaknesses: [Element.Shock] });
      expect(result).toBeCloseTo(rawDps * 1.3, 4);
    });

    it('applies the counter-element 0.7x penalty when player element matches boss resistance (PR D)', () => {
      const weapon = makeWeapon({ element: Element.Fire });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, bossResistances: [Element.Fire] });
      expect(result).toBeCloseTo(rawDps * 0.7, 4);
    });

    it('returns 1.0x when player element matches neither weakness nor resistance', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({
        weapon,
        bossWeaknesses: [Element.Fire],
        bossResistances: [Element.Cryo],
      });
      expect(result).toBeCloseTo(rawDps * 1.0, 4);
    });

    it('weakness takes priority over resistance when arrays overlap on the player element', () => {
      const weapon = makeWeapon({ element: Element.Fire });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({
        weapon,
        bossWeaknesses: [Element.Fire],
        bossResistances: [Element.Fire],
      });
      expect(result).toBeCloseTo(rawDps * 1.3, 4);
    });

    it('applies legendary damage multiplier', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, legendaryDamageMult: 1.4 });
      expect(result).toBeCloseTo(rawDps * 1.4, 4);
    });

    it('multiplies all chain steps together (full stack)', () => {
      // Neutral element, matching weakness, non-matching resistance,
      // 1.2× legendary, TargetPainter. Demonstrates the full chain
      // including the new consumables step.
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({
        weapon,
        bossWeaknesses: [Element.Shock],
        bossResistances: [Element.Cryo], // non-matching → 1.0× for Shock
        legendaryDamageMult: 1.2,
        consumables: { TargetPainter: 1 },
      });
      // raw * 1.3 (counter) * 1.0 (resistance) * 1.2 (legendary) * 1.15 (TargetPainter)
      const expected = rawDps * 1.3 * 1.0 * 1.2 * 1.15;
      expect(result).toBeCloseTo(expected, 4);
    });
  });

  describe('signature mechanic (PR E: moved from bossSimulator)', () => {
    it('default signature (no mechanic) returns 1.0x dpsMult', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const result = applySignatureMechanic(weapon, 26, 4, 30);
      expect(result.dpsMult).toBeCloseTo(1, 5);
      expect(result.statusMult).toBeCloseTo(1, 5);
      expect(result.armorBreakMult).toBeCloseTo(1, 5);
      expect(result.staggerAttempts).toBe(0);
    });

    it('sidearm_recovery (Pistol) returns 1.0x dpsMult (minimal reload penalty)', () => {
      const weapon = makeWeapon({ element: Element.Shock, signatureMechanic: 'sidearm_recovery' } as Partial<Weapon>);
      const result = applySignatureMechanic(weapon as Weapon, 26, 4, 30);
      expect(result.dpsMult).toBeCloseTo(1, 5);
    });

    it('overheat (SMG) returns 1.13x dpsMult (8s/1.5x + 3s/0.1x averaged over 30s)', () => {
      // cycles = 30/11 = 2.727...
      // activeRatio = 2.727 * 8 / 30 = 0.727
      // cooldownRatio = 2.727 * 3 / 30 = 0.273
      // avgMult = 0.727 * 1.5 + 0.273 * 0.1 = 1.091 + 0.027 = 1.118
      const weapon = makeWeapon({ element: Element.Shock, signatureMechanic: 'overheat' } as Partial<Weapon>);
      const result = applySignatureMechanic(weapon as Weapon, 0, 0, 30);
      // 30/11 = 2.7272... (8/11 + 3/11) * 2.7272 = 2.7272 → wait
      // active = (30/11 * 8) / 30 = 8/11
      // cooldown = (30/11 * 3) / 30 = 3/11
      // avgMult = 8/11 * 1.5 + 3/11 * 0.1 = 12/11 + 0.3/11 = 12.3/11 = 1.1182
      expect(result.dpsMult).toBeCloseTo(12.3 / 11, 4);
      expect(result.statusMult).toBeCloseTo(1.2, 5);
    });

    it('multi_proc (Shotgun) returns 1.0x dpsMult but 2.2x statusMult and 1.25x armorBreakMult', () => {
      const weapon = makeWeapon({ element: Element.Shock, signatureMechanic: 'multi_proc' } as Partial<Weapon>);
      const result = applySignatureMechanic(weapon as Weapon, 0, 0, 30);
      expect(result.dpsMult).toBeCloseTo(1, 5);
      expect(result.statusMult).toBeCloseTo(2.2, 5);
      expect(result.armorBreakMult).toBeCloseTo(1.25, 5);
    });

    it('precision_window (Sniper) returns 1.4x for short fights and avgMult=1+0.4*9/30=1.12 for 30s', () => {
      const weapon = makeWeapon({ element: Element.Shock, signatureMechanic: 'precision_window' } as Partial<Weapon>);
      const result = applySignatureMechanic(weapon as Weapon, 0, 0, 30);
      // bonusTime = min(3*3, 30) = 9s
      // avgMult = 1 + (9/30) * 0.4 = 1 + 0.12 = 1.12
      expect(result.dpsMult).toBeCloseTo(1.12, 4);
    });

    it('reload_lock_stagger (Launcher) returns 0.85x dpsMult and 5 staggerAttempts for 30s', () => {
      const weapon = makeWeapon({ element: Element.Shock, signatureMechanic: 'reload_lock_stagger' } as Partial<Weapon>);
      const result = applySignatureMechanic(weapon as Weapon, 0, 0, 30);
      expect(result.dpsMult).toBeCloseTo(0.85, 5);
      // shots = floor(30/6) = 5
      expect(result.staggerAttempts).toBe(5);
      expect(result.armorBreakMult).toBeCloseTo(1.3, 5);
    });

    it('ramp_sustain (Beam) returns 1.1x for long fights (>20s) and 0.85x for short fights', () => {
      const weapon = makeWeapon({ element: Element.Shock, signatureMechanic: 'ramp_sustain' } as Partial<Weapon>);
      const longFight = applySignatureMechanic(weapon as Weapon, 0, 0, 30);
      expect(longFight.dpsMult).toBeCloseTo(1.1, 5);
      const shortFight = applySignatureMechanic(weapon as Weapon, 0, 0, 15);
      expect(shortFight.dpsMult).toBeCloseTo(0.85, 5);
    });

    it('chain folds the signature dpsMult into step 2 (PR E: signature is no longer a 1.0 pass-through)', () => {
      // The chain used to do `signatureDps = rawDps` (no-op 1.0x). PR E
      // changed this to `signatureDps = rawDps * sig.dpsMult`. This test
      // proves the SMG's overheat signature now actually shows up in
      // the chain's output.
      const smg = makeWeapon({ element: Element.Shock, weaponType: WeaponType.SMG, signatureMechanic: 'overheat' } as Partial<Weapon>);
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon: smg });
      // expected = rawDps * 1.1182 (overheat avgMult) * 1.0 (no consumables)
      expect(result).toBeCloseTo(rawDps * (12.3 / 11), 3);
    });
  });

  describe('consumables (PR E: expanded to Record<string, number>, chain owns the DPS effect table)', () => {
    it('returns 1.0x for empty consumables', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const result = computeWeaponDps({ weapon, consumables: {} });
      expect(result).toBeCloseTo(computeWeaponDps({ weapon }), 5);
    });

    it('applies TargetPainter (+15% per stack)', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, consumables: { TargetPainter: 1 } });
      expect(result).toBeCloseTo(rawDps * 1.15, 4);
    });

    it('applies OverchargeStim (+12% per stack)', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, consumables: { OverchargeStim: 1 } });
      expect(result).toBeCloseTo(rawDps * 1.12, 4);
    });

    it('applies IncendiaryAmmo (+8% per stack)', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, consumables: { IncendiaryAmmo: 1 } });
      expect(result).toBeCloseTo(rawDps * 1.08, 4);
    });

    it('applies VoidAmmo (+22% per stack)', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, consumables: { VoidAmmo: 1 } });
      expect(result).toBeCloseTo(rawDps * 1.22, 4);
    });

    it('stacks multiple consumable types multiplicatively', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({
        weapon,
        consumables: { TargetPainter: 1, OverchargeStim: 1, IncendiaryAmmo: 1, VoidAmmo: 1 },
      });
      // 1.15 * 1.12 * 1.08 * 1.22 = 1.6970688
      expect(result).toBeCloseTo(rawDps * 1.6970688, 3);
    });

    it('stacks multiple of the same consumable type linearly then percentified', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      // 2x TargetPainter = 1 + 0.15 * 2 = 1.30
      const result = computeWeaponDps({ weapon, consumables: { TargetPainter: 2 } });
      expect(result).toBeCloseTo(rawDps * 1.30, 4);
    });

    it('ignores non-DPS consumables (MedKit, ShieldCell, etc.) silently', () => {
      // The chain only consumes the keys in DPS_CONSUMABLE_EFFECTS.
      // Other consumables are not the chain's concern; the sim handles
      // them.
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({
        weapon,
        consumables: { MedKit: 5, ShieldCell: 2, NanoSwarm: 1, TargetPainter: 1 },
      });
      // Only TargetPainter contributes. MedKit/ShieldCell/NanoSwarm
      // are survival concerns (not DPS) and are silently ignored.
      expect(result).toBeCloseTo(rawDps * 1.15, 4);
    });

    it('DPS_CONSUMABLE_EFFECTS is the source of truth (auditable table)', () => {
      // This test enforces that the table is the canonical list. If
      // someone adds a new DPS-affecting consumable, they should also
      // add it here (and a test above).
      expect(Object.keys(DPS_CONSUMABLE_EFFECTS).sort()).toEqual(
        [
          'AdrenalineShot',
          'AmmoPack',
          'HeartwoodSightOil',
          'HighCapacityAmmoPack',
          'IncendiaryAmmo',
          'OverchargeStim',
          'RedlineTonic',
          'TargetPainter',
          'VoidAmmo',
        ],
      );
    });
  });

  describe('ammoEfficiency (PR E: caller-provided per-weapon input)', () => {
    it('default ammoEfficiency is 1.0 (no ammo window loss)', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const result = computeWeaponDps({ weapon });
      // Should match the no-ammo-window baseline.
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      expect(result).toBeCloseTo(rawDps, 5);
    });

    it('applies caller-provided ammoEfficiency multiplicatively', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, ammoEfficiency: 0.5 });
      expect(result).toBeCloseTo(rawDps * 0.5, 4);
    });

    it('ammoEfficiency combines with consumables and signature multiplicatively', () => {
      const smg = makeWeapon({ element: Element.Shock, weaponType: WeaponType.SMG, signatureMechanic: 'overheat' } as Partial<Weapon>);
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({
        weapon: smg,
        ammoEfficiency: 0.9,
        consumables: { TargetPainter: 1 },
      });
      // rawDps * 1.1182 (overheat) * 0.9 (ammo) * 1.15 (TargetPainter)
      const expected = rawDps * (12.3 / 11) * 0.9 * 1.15;
      expect(result).toBeCloseTo(expected, 3);
    });
  });

  describe('computeLoadoutDps (boss-relative when context provided)', () => {
    it('sums DPS across multiple weapons', () => {
      const w1 = makeWeapon({ id: 'w1' });
      const w2 = makeWeapon({ id: 'w2', baseDamage: 200 });
      const total = computeLoadoutDps([w1, w2]);
      const expected = computeStandardDps(w1) + computeStandardDps(w2);
      expect(total).toBeCloseTo(expected, 4);
    });

    it('returns 0 for an empty loadout', () => {
      expect(computeLoadoutDps([])).toBe(0);
    });

    it('applies bossResistances to the whole loadout', () => {
      const w1 = makeWeapon({ id: 'w1', element: Element.Fire });
      const w2 = makeWeapon({ id: 'w2', element: Element.Kinetic });
      const totalNoResist = computeLoadoutDps([w1, w2]);
      const totalResist = computeLoadoutDps([w1, w2], [], [Element.Fire]);
      // w1 takes 0.7x, w2 stays at 1.0x → total drops.
      const w1No = computeWeaponDps({ weapon: w1 });
      const w1Resist = computeWeaponDps({ weapon: w1, bossResistances: [Element.Fire] });
      expect(totalResist).toBeCloseTo(w1Resist + (totalNoResist - w1No), 4);
    });
  });

  describe('describeDpsContext', () => {
    it('labels a standard target context', () => {
      const weapon = makeWeapon({ manufacturer: Manufacturer.Redline });
      expect(describeDpsContext(weapon, {})).toBe('vs standard target · Redline');
    });

    it('labels a boss context with weakness and consumables', () => {
      const weapon = makeWeapon({ manufacturer: Manufacturer.Ironwood });
      const label = describeDpsContext(weapon, {
        bossWeaknesses: [Element.Fire],
        consumables: { TargetPainter: 1 },
      });
      expect(label).toContain('vs Fire-weak');
      expect(label).toContain('+TargetPainter');
      expect(label).toContain('Ironwood');
    });

    it('labels a resistance context (PR D)', () => {
      const weapon = makeWeapon({ manufacturer: Manufacturer.Redline });
      const label = describeDpsContext(weapon, {
        bossResistances: [Element.Cryo],
      });
      expect(label).toContain('vs Cryo-resist');
      expect(label).toContain('Redline');
    });
  });
});
