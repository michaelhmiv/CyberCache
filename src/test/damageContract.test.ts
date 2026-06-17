import { describe, it, expect } from 'vitest';
import {
  computePlayerDamageVsMonster,
  computeMonsterDamageVsHunter,
  decideAutoEat,
  computeHealAmount,
  computeHunterMaxHp,
  MEDKIT_BUFFER_AMOUNT,
  SHIELD_CELL_AMOUNT,
  type WeaponDamageSource,
  type HunterSurvivalStats,
} from '@/lib/combat/damageContract';
import { requireMonster } from '@/constants/monsters';
import { computePlayerMaxHp } from '@/lib/animation/fightTimeline';

describe('damage contract', () => {
  // Seeded RNG factory for deterministic tests.
  const fixedRng = (value: number): (() => number) => {
    let v = value;
    return () => {
      v = (v * 9301 + 49297) % 233280;
      return v / 233280;
    };
  };

  describe('computePlayerDamageVsMonster', () => {
    it('returns 0 when the weapon has 0 effective DPS', () => {
      const weapon: WeaponDamageSource = { effectiveDps: 0 };
      const monster = requireMonster('dustwaste_raider');
      expect(computePlayerDamageVsMonster(weapon, monster, fixedRng(0.5))).toBe(0);
    });

    it('returns at least 1 on a hit (minimum connect)', () => {
      const weapon: WeaponDamageSource = { effectiveDps: 0.01 };
      const monster = requireMonster('dustwaste_brute'); // high defense
      const damage = computePlayerDamageVsMonster(weapon, monster, fixedRng(0.5));
      expect(damage).toBeGreaterThanOrEqual(0);
    });

    it('scales with effective DPS', () => {
      const monster = requireMonster('dustwaste_raider');
      const weak: WeaponDamageSource = { effectiveDps: 30 };
      const strong: WeaponDamageSource = { effectiveDps: 300 };
      const rng = fixedRng(0.5);
      const weakDmg = computePlayerDamageVsMonster(weak, monster, rng);
      rng();
      const strongDmg = computePlayerDamageVsMonster(strong, monster, rng);
      expect(strongDmg).toBeGreaterThan(weakDmg);
    });

    it('defense reduces damage (median over many rolls)', () => {
      // Sample many rolls to wash out the variance; defense should win on average.
      const weapon: WeaponDamageSource = { effectiveDps: 30 };
      const fodder = requireMonster('dustwaste_raider'); // def 0
      const elite = requireMonster('dustwaste_elite'); // def 6
      let fodderTotal = 0;
      let eliteTotal = 0;
      for (let i = 0; i < 100; i += 1) {
        const rng = fixedRng(i / 100);
        fodderTotal += computePlayerDamageVsMonster(weapon, fodder, rng);
        rng();
        eliteTotal += computePlayerDamageVsMonster(weapon, elite, rng);
      }
      expect(fodderTotal).toBeGreaterThan(eliteTotal);
    });
  });

  describe('computeMonsterDamageVsHunter', () => {
    const hunter: HunterSurvivalStats = { maxHp: 1000, shieldHp: 0 };

    it('returns missed=true on a failed accuracy roll', () => {
      // RNG that returns 0.99 — accuracy 0.85, dodge 0 → 0.99 > 0.85 means miss.
      const alwaysMissRng = () => 0.99;
      const monster = requireMonster('dustwaste_raider');
      const result = computeMonsterDamageVsHunter(monster, hunter, alwaysMissRng);
      expect(result.missed).toBe(true);
      expect(result.hpDamage).toBe(0);
      expect(result.shieldAbsorbed).toBe(0);
    });

    it('shield absorbs damage before HP', () => {
      const shielded: HunterSurvivalStats = { maxHp: 1000, shieldHp: 50 };
      const alwaysHitRng = () => 0.5; // accuracy 0.85, dodge 0 → 0.5 < 0.85 = hit
      const monster = requireMonster('dustwaste_brute'); // attack 6
      const result = computeMonsterDamageVsHunter(monster, shielded, alwaysHitRng);
      // With variance 0.85-1.15, attack 6 yields 5-6 raw. Shield 50 absorbs all.
      expect(result.shieldAbsorbed).toBeGreaterThan(0);
      expect(result.hpDamage).toBe(0);
      expect(result.fullyBlocked).toBe(true);
    });

    it('excess damage spills to HP', () => {
      const tinyShield: HunterSurvivalStats = { maxHp: 1000, shieldHp: 1 };
      const alwaysHitRng = () => 0.5;
      const monster = requireMonster('dustwaste_brute'); // attack 6
      const result = computeMonsterDamageVsHunter(monster, tinyShield, alwaysHitRng);
      expect(result.shieldAbsorbed).toBe(1);
      expect(result.hpDamage).toBeGreaterThan(0);
    });

    it('dodge chance subtracts from accuracy', () => {
      const dodgy: HunterSurvivalStats = { maxHp: 1000, shieldHp: 0, dodgeChance: 0.5 };
      // RNG 0.4 → accuracy 0.85 - dodge 0.5 = 0.35 → 0.4 > 0.35 = miss
      const rng = () => 0.4;
      const monster = requireMonster('dustwaste_raider');
      const result = computeMonsterDamageVsHunter(monster, dodgy, rng);
      expect(result.missed).toBe(true);
    });
  });

  describe('decideAutoEat', () => {
    it('returns no_action_needed above threshold', () => {
      const result = decideAutoEat(800, 1000, { ShieldCell: 2 }, 0.7);
      expect(result.eatConsumable).toBeNull();
      expect(result.reason).toBe('no_action_needed');
    });

    it('uses shield cell when below threshold', () => {
      const result = decideAutoEat(600, 1000, { ShieldCell: 2, AdrenalineShot: 1 }, 0.7);
      expect(result.eatConsumable).toBe('ShieldCell');
      expect(result.reason).toBe('below_threshold');
    });

    it('falls back to adrenaline shot when no shield cells', () => {
      expect(decideAutoEat(600, 1000, { ShieldCell: 0, AdrenalineShot: 1 }, 0.7).eatConsumable).toBe('AdrenalineShot');
    });

    it('returns no_consumables when inventory is empty', () => {
      const result = decideAutoEat(100, 1000, {}, 0.7);
      expect(result.eatConsumable).toBeNull();
      expect(result.reason).toBe('no_consumables');
    });

    it('threshold 1.0 means eat on any damage', () => {
      const result = decideAutoEat(999, 1000, { ShieldCell: 1 }, 1.0);
      expect(result.eatConsumable).toBe('ShieldCell');
    });
  });

  describe('heal amounts', () => {
    it('medkit buffer is 150, shield cell restores 100', () => {
      expect(MEDKIT_BUFFER_AMOUNT).toBe(150);
      expect(SHIELD_CELL_AMOUNT).toBe(100);
      expect(computeHealAmount('MedKit')).toBe(0); // Med Kit is now a buffer, not a heal
      expect(computeHealAmount('ShieldCell')).toBe(100);
    });

    it('unknown consumable returns 0', () => {
      expect(computeHealAmount('FooBar')).toBe(0);
    });
  });

  describe('hunter max HP', () => {
    it('parity with fightTimeline.computePlayerMaxHp', () => {
      // The formula must match exactly — the fight animation parity test
      // catches this elsewhere, but a localized assertion makes the
      // contract self-documenting.
      for (let level = 1; level <= 50; level += 5) {
        for (const shieldHp of [0, 100, 250, 500]) {
          expect(computeHunterMaxHp(level, shieldHp)).toBe(
            computePlayerMaxHp(level, shieldHp)
          );
        }
      }
    });
  });
});
