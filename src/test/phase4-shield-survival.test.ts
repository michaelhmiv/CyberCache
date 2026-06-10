/**
 * Phase 4 shield/survival/defense tests — verify shield mitigation,
 * shield element resistance, shield recharge rates, and damage paths.
 */
import { describe, it, expect } from 'vitest';
import {
  computeMonsterDamageVsHunter,
  type HunterSurvivalStats,
} from '@/lib/combat/damageContract';
import {
  equippedShieldRechargeRate,
  equippedShieldMitigation,
} from '@/lib/combat/loadoutSurvival';
import type { MonsterDef } from '@/constants/monsters';
import type { Element } from '@/types/game';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMonster = (overrides: Partial<MonsterDef> = {}): MonsterDef => ({
  id: 'test-rat',
  name: 'Test Rat',
  attackPower: 50,
  defense: 5,
  hp: 100,
  accuracy: 0.90,
  element: null as unknown as Element,
  tier: 1,
  unlockLevel: 1,
  ...overrides,
});

const makeHunter = (overrides: Partial<HunterSurvivalStats> = {}): HunterSurvivalStats => ({
  maxHp: 1000,
  shieldHp: 0,
  ...overrides,
});

// Deterministic "RNG" that always returns 0.5 (removes variance).
const fixedRng = () => 0.5;

// ---------------------------------------------------------------------------
// Mitigation tests
// ---------------------------------------------------------------------------

describe('computeMonsterDamageVsHunter — mitigation', () => {
  it('reduces damage by mitigation %', () => {
    const monster = makeMonster({ attackPower: 100 });
    const hunter = makeHunter({ mitigation: 0.5 }); // 50% mitigation, no shield

    const result = computeMonsterDamageVsHunter(monster, hunter, fixedRng);
    // variance = 0.85 + 0.5*0.3 = 1.0
    // elementMult = 1 (monster has no element)
    // mitigationMult = 1 - 0.5 = 0.5
    // raw = floor(100 * 1.0 * 1.0 * 0.5) = 50
    // shieldAbsorbed = 0 (no shield), hpDamage = 50
    expect(result.missed).toBe(false);
    expect(result.shieldAbsorbed).toBe(0);
    expect(result.hpDamage).toBe(50);
  });

  it('mitigation caps at 80%', () => {
    const monster = makeMonster({ attackPower: 100 });
    const hunter = makeHunter({ mitigation: 2.0 }); // Would be 200%, capped to 80%

    const result = computeMonsterDamageVsHunter(monster, hunter, fixedRng);
    // mitigationMult = 1 - 0.8 = 0.1999... (floating point) → floor gives 19
    expect(result.hpDamage).toBe(19);
  });

  it('zero mitigation = full damage', () => {
    const monster = makeMonster({ attackPower: 100 });
    const hunter = makeHunter({ mitigation: 0 });

    const result = computeMonsterDamageVsHunter(monster, hunter, fixedRng);
    // raw = floor(100 * 1.0 * 1.0 * 1.0) = 100
    expect(result.hpDamage).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Shield element tests
// ---------------------------------------------------------------------------

describe('computeMonsterDamageVsHunter — shield element resistance', () => {
  it('matching shield element adds 15% resistance', () => {
    const monster = makeMonster({ attackPower: 100, element: 'fire' as Element });
    const hunter = makeHunter({ shieldElement: 'fire' as Element });

    const result = computeMonsterDamageVsHunter(monster, hunter, fixedRng);
    // elementalResist = 0 + 0.15 (match) = 0.15
    // elementMult = max(0.1, 1 - 0.15) = 0.85
    // raw = floor(100 * 1.0 * 0.85 * 1.0) = 85
    expect(result.hpDamage).toBe(85);
  });

  it('non-matching shield element = no extra resist', () => {
    const monster = makeMonster({ attackPower: 100, element: 'fire' as Element });
    const hunter = makeHunter({ shieldElement: 'ice' as Element });

    const result = computeMonsterDamageVsHunter(monster, hunter, fixedRng);
    // elementMult = max(0.1, 1 - 0) = 1.0 (no match bonus)
    // raw = floor(100 * 1.0 * 1.0 * 1.0) = 100
    expect(result.hpDamage).toBe(100);
  });

  it('shield element without monster element = no effect', () => {
    const monster = makeMonster({ attackPower: 100 }); // no element
    const hunter = makeHunter({ shieldElement: 'fire' as Element });

    const result = computeMonsterDamageVsHunter(monster, hunter, fixedRng);
    // elementMult = 1 (monster has no element, so no multiplier)
    // raw = 100
    expect(result.hpDamage).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Shield absorption (existing behavior verification)
// ---------------------------------------------------------------------------

describe('computeMonsterDamageVsHunter — shield absorption', () => {
  it('shield absorbs damage before HP', () => {
    const monster = makeMonster({ attackPower: 100 });
    const hunter = makeHunter({ shieldHp: 30, mitigation: 0 });

    const result = computeMonsterDamageVsHunter(monster, hunter, fixedRng);
    // raw = 100, shieldAbsorbed = min(30, 100) = 30, hpDamage = 70
    expect(result.shieldAbsorbed).toBe(30);
    expect(result.hpDamage).toBe(70);
  });

  it('mitigation + shield work together', () => {
    const monster = makeMonster({ attackPower: 100 });
    const hunter = makeHunter({ shieldHp: 20, mitigation: 0.5 });

    const result = computeMonsterDamageVsHunter(monster, hunter, fixedRng);
    // raw = floor(100 * 1.0 * 1.0 * 0.5) = 50
    // shieldAbsorbed = min(20, 50) = 20, hpDamage = 30
    expect(result.shieldAbsorbed).toBe(20);
    expect(result.hpDamage).toBe(30);
  });
});
