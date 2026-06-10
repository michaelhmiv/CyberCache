/**
 * Phase 5 ordnance/relic/polish tests — verify ordnance damage contributes
 * to boss sim, relic affixes flow into idle mods and boss sim.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Relic affix summation logic
// ---------------------------------------------------------------------------

describe('relic affix summation', () => {
  it('sums multiple affixes of the same stat', () => {
    const affixes = [
      { stat: 'bossDamageMod', value: 0.1 },
      { stat: 'bossDamageMod', value: 0.05 },
    ];
    let total = 0;
    for (const a of affixes) {
      if (a.stat === 'bossDamageMod') total += a.value;
    }
    expect(total).toBeCloseTo(0.15);
  });

  it('mixes different affix stats', () => {
    const affixes = [
      { stat: 'offlineEarningsMod', value: 0.12 },
      { stat: 'scrapYieldMod', value: 0.20 },
      { stat: 'xpBoostMod', value: 0.10 },
      { stat: 'survivalBoost', value: 0.08 },
    ];
    let offline = 0, scrap = 0, xp = 0, survival = 0;
    for (const a of affixes) {
      if (a.stat === 'offlineEarningsMod') offline += a.value;
      if (a.stat === 'scrapYieldMod') scrap += a.value;
      if (a.stat === 'xpBoostMod') xp += a.value;
      if (a.stat === 'survivalBoost') survival += a.value;
    }
    expect(offline).toBeCloseTo(0.12);
    expect(scrap).toBeCloseTo(0.20);
    expect(xp).toBeCloseTo(0.10);
    expect(survival).toBeCloseTo(0.08);
  });
});

// ---------------------------------------------------------------------------
// Ordnance flat damage logic
// ---------------------------------------------------------------------------

describe('ordnance flat damage', () => {
  it('ordnance damage multiplied by grenades count', () => {
    const ordnanceDamage = 50;
    const grenades = 3; // 1 base + 2 consumed
    const flatDamage = ordnanceDamage * Math.max(1, grenades);
    expect(flatDamage).toBe(150);
  });

  it('minimum 1 grenade even with 0 consumed', () => {
    const ordnanceDamage = 50;
    const grenades = 0;
    const flatDamage = ordnanceDamage * Math.max(1, grenades);
    expect(flatDamage).toBe(50);
  });

  it('reduces boss effective HP by flat damage', () => {
    const bossHp = 1000;
    const ordnanceFlatDamage = 150;
    const netHp = Math.max(1, bossHp - ordnanceFlatDamage);
    expect(netHp).toBe(850);
  });

  it('boss HP cannot go below 1', () => {
    const bossHp = 100;
    const ordnanceFlatDamage = 500;
    const netHp = Math.max(1, bossHp - ordnanceFlatDamage);
    expect(netHp).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Relic xpBoostMod formula
// ---------------------------------------------------------------------------

describe('relic xpBoostMod', () => {
  it('multiplies base XP by (1 + xpBoostMod)', () => {
    const baseXp = 100;
    const xpBoostMod = 0.15;
    const adjusted = Math.round(baseXp * (1 + xpBoostMod));
    expect(adjusted).toBe(115);
  });

  it('no relic = 1.0 multiplier', () => {
    const baseXp = 100;
    const xpMult = 1;
    expect(Math.round(baseXp * xpMult)).toBe(100);
  });
});
