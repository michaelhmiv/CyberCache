import { describe, expect, it } from 'vitest';
import { generateShield } from '@/server/lib/generators/shieldGenerator';

describe('shieldGenerator — affixes baked into stats', () => {
  it('generates a shield with hp > 0', () => {
    const shield = generateShield(1);
    expect(shield.hp).toBeGreaterThan(0);
  });

  it('generates a shield with mitigation between 0 and 1', () => {
    const shield = generateShield(1);
    expect(shield.mitigation).toBeGreaterThan(0);
    expect(shield.mitigation).toBeLessThan(1);
  });

  it('generates a shield with rechargeRate > 0', () => {
    const shield = generateShield(1);
    expect(shield.rechargeRate).toBeGreaterThan(0);
  });

  it('affixes with hp increase shield hp', () => {
    // Generate many shields and find one with an hp affix.
    for (let i = 0; i < 100; i++) {
      const shield = generateShield(1);
      const hpAffixes = shield.affixes.filter((a) => a.stat === 'hp');
      if (hpAffixes.length > 0) {
        const affixMult = hpAffixes.reduce((sum, a) => sum + a.value, 0);
        // hp should be boosted beyond the base minimum.
        // Base hp at level 1 is ~180-220; with an hp affix it's higher.
        const baseMin = 150 * 1 * 0.9; // baseHp * rarityMult * min roll
        expect(shield.hp).toBeGreaterThan(baseMin);
        // The affix multiplier should be visible.
        expect(shield.hp).toBeGreaterThanOrEqual(Math.round(baseMin * (1 + affixMult)));
        return;
      }
    }
  });

  it('affixes with mitigation increase shield mitigation', () => {
    for (let i = 0; i < 100; i++) {
      const shield = generateShield(1);
      const mitAffixes = shield.affixes.filter((a) => a.stat === 'mitigation');
      if (mitAffixes.length > 0) {
        const affixSum = mitAffixes.reduce((sum, a) => sum + a.value, 0);
        // mitigation starts at ~0.05 + rarity bias; affix adds to it.
        expect(shield.mitigation).toBeGreaterThanOrEqual(0.05 + affixSum - Number.EPSILON);
        return;
      }
    }
  });

  it('affixes with rechargeRate increase shield rechargeRate', () => {
    for (let i = 0; i < 100; i++) {
      const shield = generateShield(1);
      const rechAffixes = shield.affixes.filter((a) => a.stat === 'rechargeRate');
      if (rechAffixes.length > 0) {
        const affixMult = rechAffixes.reduce((sum, a) => sum + a.value, 0);
        // rechargeRate base at level 1 is ~11.5; affix multiplies it.
        const baseMin = 10; // minimum before level scaling
        expect(shield.rechargeRate).toBeGreaterThanOrEqual(baseMin * (1 + affixMult));
        return;
      }
    }
  });

  it('all generated shields have valid stat ranges', () => {
    // Smoke test: generate shields at various levels, verify no NaN or negative.
    for (let level = 1; level <= 50; level += 10) {
      const shield = generateShield(level);
      expect(Number.isFinite(shield.hp)).toBe(true);
      expect(Number.isFinite(shield.rechargeRate)).toBe(true);
      expect(Number.isFinite(shield.mitigation)).toBe(true);
      expect(shield.hp).toBeGreaterThan(0);
      expect(shield.rechargeRate).toBeGreaterThan(0);
      expect(shield.mitigation).toBeGreaterThanOrEqual(0);
      expect(shield.mitigation).toBeLessThanOrEqual(1);
    }
  });
});
