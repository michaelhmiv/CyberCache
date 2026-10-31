/**
 * Shield behaviors (Phase 2c) — shipped-path tests.
 *
 * Behaviors are defined ONCE in src/lib/combat/shieldBehaviors.ts and
 * read by: the shield generator (roll + Turtle stats), the roaming
 * damage seam (computeMonsterDamageVsHunter, driven here directly and
 * through the Chef's processRoamingClaim), and the boss sim
 * (simulateBoss pooled model, driven directly and through the Chef's
 * processBossAttempt). Legacy shields (no `behavior` field) must
 * behave exactly as the pre-behavior game in every engine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  SHIELD_BEHAVIORS,
  SHIELD_BEHAVIOR_TUNING,
  SHIELD_BEHAVIOR_WEIGHTS,
  absorbRestoreFor,
  ampDamageMultiplier,
  applyShieldBehaviorGenerationStats,
  describeShieldBehavior,
  modelShieldBehaviorForBoss,
  novaDamageForCapacity,
  rollShieldBehavior,
  shieldBehaviorOf,
} from '../lib/combat/shieldBehaviors';
import {
  computeMonsterDamageVsHunter,
  type HunterSurvivalStats,
} from '../lib/combat/damageContract';
import { computeEffectiveDpsFromGear } from '../lib/combat/loadoutSurvival';
import { simulateBoss, type BossSimulationInput } from '../lib/simulation/bossSimulator';
import { processBossAttempt, processRoamingClaim, type ClaimRequest } from '../server/chef';
import { generateShield } from '../server/lib/generators/shieldGenerator';
import { gearCardSummary } from '../lib/gear/gearCardSummary';
import { lootStatLine } from '../lib/pixel/lootMoment';
import { createRNG } from '../lib/utils/rng';
import { getMonster, type MonsterDef } from '../constants/monsters';
import { REGION_1_BOSSES } from '../constants/bosses';
import {
  DropSource,
  Element,
  Manufacturer,
  Rarity,
  RiskSetting,
  WeaponType,
} from '../types/game';
import type { Shield, Weapon } from '../types/items';

const PLAYER = '55555555-5555-4555-8555-555555555555';
const T = SHIELD_BEHAVIOR_TUNING;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeShield(overrides: Partial<Shield> = {}): Shield {
  return {
    id: 'shield-1',
    name: 'Test Shield',
    level: 10,
    rarity: Rarity.Rare,
    hp: 100,
    rechargeRate: 10,
    mitigation: 0,
    element: Element.Kinetic,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 1,
    ...overrides,
  };
}

/** A shield payload exactly as a pre-behavior save would carry it. */
function makeLegacyShield(overrides: Partial<Shield> = {}): Shield {
  const shield = makeShield(overrides);
  delete shield.behavior;
  return shield;
}

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'weapon-1',
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

function monster(overrides: Partial<MonsterDef> = {}): MonsterDef {
  return {
    id: 'test_monster',
    name: 'Test Monster',
    archetype: 'fodder',
    hp: 500,
    attackPower: 100,
    defense: 0,
    accuracy: 1,
    xpReward: 0,
    visualKey: 'monster_test',
    flavor: '',
    ...overrides,
  };
}

/** RNG that serves a fixed sequence and throws if over-drawn. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`rng exhausted after ${values.length} draws`);
    return values[i++];
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The behavior module — definitions, tuning, legacy reads
// ---------------------------------------------------------------------------

describe('shieldBehaviors module', () => {
  it('legacy and malformed payloads read as Standard', () => {
    expect(shieldBehaviorOf(null)).toBe('standard');
    expect(shieldBehaviorOf(undefined)).toBe('standard');
    expect(shieldBehaviorOf({})).toBe('standard');
    expect(shieldBehaviorOf({ behavior: 'bogus' })).toBe('standard');
    expect(shieldBehaviorOf({ behavior: 'nova' })).toBe('nova');
    expect(shieldBehaviorOf(makeLegacyShield())).toBe('standard');
  });

  it('tuning constants are the shipped balance knobs', () => {
    expect(T.novaPctOfCapacity).toBe(1.5);
    expect(T.absorbChance).toBe(0.15);
    expect(T.absorbRestore).toBe(0.05);
    expect(T.ampPct).toBe(0.25);
    expect(T.turtleCapacityMult).toBe(1.5);
    expect(T.turtleRechargeMult).toBe(0.5);
    expect(T.novaRearmThreshold).toBe(0.5);
  });

  it('every rarity weight row sums to 100 and Legendary has no Standard', () => {
    for (const rarity of Object.values(Rarity)) {
      const row = SHIELD_BEHAVIOR_WEIGHTS[rarity];
      const sum = Object.values(row).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(100, 6);
    }
    expect(SHIELD_BEHAVIOR_WEIGHTS[Rarity.Legendary].standard).toBe(0);
    expect(SHIELD_BEHAVIOR_WEIGHTS[Rarity.Common].standard).toBe(90);
  });

  it('roll distribution matches the weight table per rarity (seeded)', () => {
    const rolls = 20000;
    for (const rarity of [Rarity.Common, Rarity.Rare, Rarity.Epic]) {
      const rng = createRNG(4242);
      const counts: Record<string, number> = {};
      for (let i = 0; i < rolls; i++) {
        const b = rollShieldBehavior(rarity, rng);
        counts[b] = (counts[b] ?? 0) + 1;
      }
      const weights = SHIELD_BEHAVIOR_WEIGHTS[rarity];
      for (const id of Object.keys(weights) as Array<keyof typeof weights>) {
        expect(Math.abs((counts[id] ?? 0) / rolls - weights[id] / 100)).toBeLessThan(0.02);
      }
    }
    // Legendary: exactly zero Standard in 5000 rolls (weight is 0).
    const rng = createRNG(777);
    for (let i = 0; i < 5000; i++) {
      expect(rollShieldBehavior(Rarity.Legendary, rng)).not.toBe('standard');
    }
  });

  it('Turtle generation transform: capacity ×1.5, recharge ×0.5; others identity', () => {
    expect(applyShieldBehaviorGenerationStats('turtle', { hp: 200, rechargeRate: 21 })).toEqual({
      hp: 300,
      rechargeRate: 10.5,
    });
    for (const b of ['standard', 'nova', 'absorb', 'amp'] as const) {
      expect(applyShieldBehaviorGenerationStats(b, { hp: 200, rechargeRate: 21 })).toEqual({
        hp: 200,
        rechargeRate: 21,
      });
    }
  });

  it('nova damage, absorb restore, and amp multiplier math', () => {
    expect(novaDamageForCapacity(100)).toBe(150);
    expect(novaDamageForCapacity(0)).toBe(0);
    expect(absorbRestoreFor(200, 150)).toBe(10); // 5% of capacity
    expect(absorbRestoreFor(200, 195)).toBe(5); // capped at capacity
    expect(absorbRestoreFor(200, 200)).toBe(0);
    expect(ampDamageMultiplier('amp', 500, 500)).toBe(1.25);
    expect(ampDamageMultiplier('amp', 499, 500)).toBe(1);
    expect(ampDamageMultiplier('amp', 0, 0)).toBe(1);
    expect(ampDamageMultiplier('nova', 500, 500)).toBe(1);
  });

  it('describeShieldBehavior carries the real numbers for the shield', () => {
    expect(describeShieldBehavior('nova', { hp: 200, rechargeRate: 10 })).toContain('300 damage');
    expect(describeShieldBehavior('nova', { hp: 200, rechargeRate: 10 })).toContain('150%');
    expect(describeShieldBehavior('absorb', { hp: 200, rechargeRate: 10 })).toContain('15%');
    expect(describeShieldBehavior('amp', { hp: 200, rechargeRate: 10 })).toContain('25%');
    expect(describeShieldBehavior('standard', { hp: 200, rechargeRate: 10 })).toBe(
      'No special behavior.',
    );
    expect(SHIELD_BEHAVIORS.turtle.name).toBe('Turtle');
  });
});

// ---------------------------------------------------------------------------
// 2. Generator integration
// ---------------------------------------------------------------------------

describe('shield generator behaviors', () => {
  it('every generated shield carries a behavior; Legendary never Standard', () => {
    let legendaries = 0;
    let turtles = 0;
    for (let i = 0; i < 3000; i++) {
      const shield = generateShield(10, createRNG(1000 + i));
      expect(shield.behavior).toBeDefined();
      expect(shieldBehaviorOf(shield)).toBe(shield.behavior);
      if (shield.rarity === Rarity.Legendary) {
        legendaries++;
        expect(shield.behavior).not.toBe('standard');
      }
      if (shield.behavior === 'turtle') turtles++;
    }
    expect(legendaries).toBeGreaterThan(0);
    expect(turtles).toBeGreaterThan(0);
  });

  it('generation stays deterministic per seed, behavior included', () => {
    const a = generateShield(5, createRNG(999));
    const b = generateShield(5, createRNG(999));
    expect(a.behavior).toBe(b.behavior);
    expect(a.hp).toBe(b.hp);
    expect(a.rechargeRate).toBe(b.rechargeRate);
    expect(a.name).toBe(b.name);
  });

  it('source pin: the generator rolls through the shared module', () => {
    const src = readFileSync(
      resolve(__dirname, '../server/lib/generators/shieldGenerator.ts'),
      'utf8',
    );
    expect(src).toContain('pickShieldBehavior');
    expect(src).toContain('applyShieldBehaviorGenerationStats');
  });
});

// ---------------------------------------------------------------------------
// 3. Damage contract — the roaming seam
// ---------------------------------------------------------------------------

describe('computeMonsterDamageVsHunter shield behaviors', () => {
  const hunter = (overrides: Partial<HunterSurvivalStats> = {}): HunterSurvivalStats => ({
    maxHp: 1000,
    shieldHp: 40,
    mitigation: 0,
    ...overrides,
  });

  it('legacy hunter: identical split, exactly two RNG draws, no behavior fields', () => {
    const hit = computeMonsterDamageVsHunter(monster(), hunter(), seqRng([0.5, 0.5]));
    expect(hit).toEqual({ shieldAbsorbed: 40, hpDamage: 60, missed: false, fullyBlocked: false });
  });

  it('absorb proc: hit fully negated, shield restored, no damage split', () => {
    const hit = computeMonsterDamageVsHunter(
      monster(),
      hunter({ shieldBehavior: 'absorb', shieldCapacity: 200 }),
      seqRng([0.5, 0.5, 0.05]), // accuracy, variance, absorb roll < 0.15
    );
    expect(hit.behaviorAbsorbed).toBe(true);
    expect(hit.shieldAbsorbed).toBe(0);
    expect(hit.hpDamage).toBe(0);
    expect(hit.fullyBlocked).toBe(true);
    expect(hit.behaviorShieldRestore).toBe(10); // 5% of 200 capacity
  });

  it('absorb non-proc: normal split after the absorb draw', () => {
    const hit = computeMonsterDamageVsHunter(
      monster(),
      hunter({ shieldBehavior: 'absorb', shieldCapacity: 200 }),
      seqRng([0.5, 0.5, 0.9]),
    );
    expect(hit.behaviorAbsorbed).toBeUndefined();
    expect(hit.shieldAbsorbed).toBe(40);
    expect(hit.hpDamage).toBe(60);
  });

  it('absorb never procs on a broken shield (no third draw)', () => {
    const hit = computeMonsterDamageVsHunter(
      monster(),
      hunter({ shieldBehavior: 'absorb', shieldCapacity: 200, shieldHp: 0 }),
      seqRng([0.5, 0.5]),
    );
    expect(hit.behaviorAbsorbed).toBeUndefined();
    expect(hit.shieldAbsorbed).toBe(0);
    expect(hit.hpDamage).toBe(100);
  });

  it('nova fires on the breaking hit while armed — and only then', () => {
    const breaking = computeMonsterDamageVsHunter(
      monster(),
      hunter({ shieldBehavior: 'nova', shieldCapacity: 100, shieldNovaArmed: true }),
      seqRng([0.5, 0.5]),
    );
    expect(breaking.novaDamage).toBe(150);
    expect(breaking.novaArmed).toBe(false);
    expect(breaking.shieldAbsorbed).toBe(40);
    expect(breaking.hpDamage).toBe(60);

    const exactBreak = computeMonsterDamageVsHunter(
      monster({ attackPower: 40 }),
      hunter({ shieldBehavior: 'nova', shieldCapacity: 100, shieldNovaArmed: true }),
      seqRng([0.5, 0.5]),
    );
    expect(exactBreak.novaDamage).toBe(150);

    const notBreaking = computeMonsterDamageVsHunter(
      monster({ attackPower: 30 }),
      hunter({ shieldBehavior: 'nova', shieldCapacity: 100, shieldNovaArmed: true }),
      seqRng([0.5, 0.5]),
    );
    expect(notBreaking.novaDamage).toBeUndefined();
    expect(notBreaking.novaArmed).toBe(true);
  });

  it('nova stays silent while unarmed, even on a break', () => {
    const hit = computeMonsterDamageVsHunter(
      monster(),
      hunter({ shieldBehavior: 'nova', shieldCapacity: 100, shieldNovaArmed: false }),
      seqRng([0.5, 0.5]),
    );
    expect(hit.novaDamage).toBeUndefined();
    expect(hit.novaArmed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Chef roaming claims — behaviors through the shipped engine
// ---------------------------------------------------------------------------

function claimRequest(overrides: Partial<ClaimRequest> = {}): ClaimRequest {
  return {
    playerId: PLAYER,
    areaId: 'dustwaste_frontier',
    ticks: 20,
    tickCount: 2000,
    playerLevel: 10,
    survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0 },
    ...overrides,
  };
}

type FeedEvent = { tone: string; label: string; detail: string; value?: number };
const feed = (result: ReturnType<typeof processRoamingClaim>): FeedEvent[] =>
  result.feedEvents as FeedEvent[];

describe('Chef roaming claims with behavior shields', () => {
  it('nova: a break produces exactly one burst into the current kill-cycle target', () => {
    // Math.random = 0.05 → attacker is always the Wraith Scavenger
    // (attack 4, raw hit = floor(4 × 0.865) = 3). Shield 10 breaks on
    // tick 4; nova = 150% of capacity 10 = 15.
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const result = processRoamingClaim(
      claimRequest({
        equippedGear: [makeShield({ behavior: 'nova', hp: 10 })],
        survival: { currentHp: 100000, maxHp: 100000, shieldHp: 10, shieldNovaArmed: true },
        killCycle: {
          currentTargetId: 'dustwaste_brute',
          currentTargetHp: 1000,
          currentTargetHpMax: 1000,
          monstersKilledCount: 0,
          totalKills: 0,
          lastKilledMonsterId: null,
        },
      }),
    );
    const novas = feed(result).filter((e) => e.label.startsWith('Nova burst'));
    expect(novas).toHaveLength(1);
    expect(novas[0].label).toBe('Nova burst — 15 damage');
    expect(novas[0].value).toBe(15);
    // Burst landed on the kill-cycle target; no kill, cycle intact.
    expect(result.killCycle.currentTargetId).toBe('dustwaste_brute');
    expect(result.killCycle.currentTargetHp).toBe(985);
    expect(result.killCycle.monstersKilledCount).toBe(0);
    expect(result.survival.shieldHp).toBe(0);
    expect(result.survival.shieldNovaArmed).toBe(false);
    expect(result.survival.isDead).toBe(false);
  });

  it('nova kill: burst kill advances the cycle and counts the kill', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const result = processRoamingClaim(
      claimRequest({
        equippedGear: [makeShield({ behavior: 'nova', hp: 10 })],
        survival: { currentHp: 100000, maxHp: 100000, shieldHp: 10, shieldNovaArmed: true },
        killCycle: {
          currentTargetId: 'dustwaste_brute',
          currentTargetHp: 10, // nova (15) finishes it
          currentTargetHpMax: 80,
          monstersKilledCount: 0,
          totalKills: 0,
          lastKilledMonsterId: null,
        },
      }),
    );
    expect(result.killCycle.monstersKilledCount).toBe(1);
    expect(result.killCycle.totalKills).toBe(1);
    expect(result.killCycle.lastKilledMonsterId).toBe('dustwaste_brute');
    // Rotation walks the roster after the brute → the elite.
    expect(result.killCycle.currentTargetId).toBe('dustwaste_elite');
    expect(result.killCycle.currentTargetHp).toBe(getMonster('dustwaste_elite')!.hp);
    expect(feed(result).some((e) => e.label === 'Killed Salvage Brute')).toBe(true);
  });

  it('nova does not fire while unarmed below the re-arm threshold', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const result = processRoamingClaim(
      claimRequest({
        equippedGear: [makeShield({ behavior: 'nova', hp: 100 })],
        // 4 shield < 50% of capacity 100, explicitly spent.
        survival: { currentHp: 100000, maxHp: 100000, shieldHp: 4, shieldNovaArmed: false },
        killCycle: {
          currentTargetId: 'dustwaste_brute',
          currentTargetHp: 1000,
          currentTargetHpMax: 1000,
          monstersKilledCount: 0,
          totalKills: 0,
          lastKilledMonsterId: null,
        },
      }),
    );
    expect(feed(result).filter((e) => e.label.startsWith('Nova burst'))).toHaveLength(0);
    expect(result.killCycle.currentTargetHp).toBe(1000);
    expect(result.survival.shieldNovaArmed).toBe(false);
  });

  it('nova re-arms once the shield stands above the threshold, then fires on the break', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const result = processRoamingClaim(
      claimRequest({
        equippedGear: [makeShield({ behavior: 'nova', hp: 100 })],
        // Spent flag, but the shield stands at 60 ≥ 50% of capacity:
        // the claim re-arms it. 20 hits × 3 = exactly 60 → break on
        // the final tick, nova = 150.
        survival: { currentHp: 100000, maxHp: 100000, shieldHp: 60, shieldNovaArmed: false },
        killCycle: {
          currentTargetId: 'dustwaste_brute',
          currentTargetHp: 1000,
          currentTargetHpMax: 1000,
          monstersKilledCount: 0,
          totalKills: 0,
          lastKilledMonsterId: null,
        },
      }),
    );
    const novas = feed(result).filter((e) => e.label.startsWith('Nova burst'));
    expect(novas).toHaveLength(1);
    expect(novas[0].value).toBe(150);
    expect(result.killCycle.currentTargetHp).toBe(850);
    expect(result.survival.shieldNovaArmed).toBe(false);
  });

  it('absorb: every hit negated while the shield is up, shield restored to capacity', () => {
    // Math.random = 0.05 → every absorb roll (0.05 < 0.15) procs.
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const result = processRoamingClaim(
      claimRequest({
        equippedGear: [makeShield({ behavior: 'absorb', hp: 200 })],
        survival: { currentHp: 100000, maxHp: 100000, shieldHp: 150 },
      }),
    );
    expect(result.survival.currentHp).toBe(100000);
    expect(result.survival.shieldHp).toBe(200); // 150 + 10/tick, capped
    expect(feed(result).filter((e) => e.label === 'Absorbed the hit')).toHaveLength(20);
  });

  it('legacy shield in a claim: pre-behavior math, no behavior events', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const result = processRoamingClaim(
      claimRequest({
        equippedGear: [makeLegacyShield({ hp: 200 })],
        survival: { currentHp: 100000, maxHp: 100000, shieldHp: 150 },
      }),
    );
    // Same attacker stream as the absorb test: 20 hits × 3 damage.
    expect(result.survival.shieldHp).toBe(90);
    expect(result.survival.currentHp).toBe(100000);
    expect(
      feed(result).filter(
        (e) => e.label === 'Absorbed the hit' || e.label.startsWith('Nova burst'),
      ),
    ).toHaveLength(0);
    expect(typeof result.survival.shieldNovaArmed).toBe('boolean');
  });

  it('amp: outgoing kill-cycle damage is multiplied only at full shield', () => {
    // Math.random = 0.5 → variance exactly 1.0; attacker is the drone.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const weapon = makeWeapon();
    const dps = computeEffectiveDpsFromGear({
      weapons: [weapon],
      ordnance: null,
      relic: null,
      classMod: null,
      skillDpsMult: 1,
    });
    expect(dps).toBeGreaterThan(0);
    const brute = getMonster('dustwaste_brute')!;
    const defenseMitigation = 1 - Math.min(0.75, brute.defense / (brute.defense + 40));
    const unamped = Math.max(1, Math.floor(dps * 3 * 1.0 * defenseMitigation));
    const amped = Math.max(1, Math.floor(dps * (1 + T.ampPct) * 3 * 1.0 * defenseMitigation));
    expect(amped).toBeGreaterThan(unamped);

    const target = {
      currentTargetId: 'dustwaste_brute',
      currentTargetHp: 100000,
      currentTargetHpMax: 100000,
      monstersKilledCount: 0,
      totalKills: 0,
      lastKilledMonsterId: null,
    };
    const atFull = processRoamingClaim(
      claimRequest({
        ticks: 1,
        equippedGear: [weapon, makeShield({ behavior: 'amp', hp: 500 })],
        survival: { currentHp: 100000, maxHp: 100000, shieldHp: 500 },
        killCycle: { ...target },
      }),
    );
    expect(atFull.killCycle.currentTargetHp).toBe(100000 - amped);

    const belowFull = processRoamingClaim(
      claimRequest({
        ticks: 1,
        equippedGear: [weapon, makeShield({ behavior: 'amp', hp: 500 })],
        survival: { currentHp: 100000, maxHp: 100000, shieldHp: 499 },
        killCycle: { ...target },
      }),
    );
    expect(belowFull.killCycle.currentTargetHp).toBe(100000 - unamped);
  });
});

// ---------------------------------------------------------------------------
// 5. Boss sim — pooled model through the shared module
// ---------------------------------------------------------------------------

describe('boss shield behavior model', () => {
  it('standard / no capacity: no effects', () => {
    expect(
      modelShieldBehaviorForBoss({
        behavior: 'standard',
        capacity: 200,
        refillPool: 0,
        totalIncomingDamage: 3000,
        mitigation: 0,
      }),
    ).toEqual({ novaDamage: 0, novaFirings: 0, absorbNegated: 0, ampDpsMultiplier: 1, shieldUptimeFraction: 0 });
  });

  it('nova: fires once when the pool depletes; twice only with a real refill past the threshold', () => {
    const base = { behavior: 'nova' as const, capacity: 200, totalIncomingDamage: 3000, mitigation: 0 };
    expect(modelShieldBehaviorForBoss({ ...base, refillPool: 0 }).novaFirings).toBe(1);
    expect(modelShieldBehaviorForBoss({ ...base, refillPool: 0 }).novaDamage).toBe(300);
    expect(modelShieldBehaviorForBoss({ ...base, refillPool: 200 }).novaFirings).toBe(2);
    expect(modelShieldBehaviorForBoss({ ...base, refillPool: 200 }).novaDamage).toBe(600);
    // Refill below the re-arm threshold (100) never re-arms.
    expect(modelShieldBehaviorForBoss({ ...base, refillPool: 50 }).novaFirings).toBe(1);
    // Damage that never depletes the pool never fires.
    expect(
      modelShieldBehaviorForBoss({ ...base, refillPool: 0, totalIncomingDamage: 150 }).novaFirings,
    ).toBe(0);
    // Mitigation stretches the pool: 3000 raw at 50% mitigation is 1500 post-mit.
    expect(
      modelShieldBehaviorForBoss({ ...base, refillPool: 0, capacity: 2000, mitigation: 0.5 })
        .novaFirings,
    ).toBe(0);
  });

  it('absorb: negates its chance of the damage that lands on the pools', () => {
    expect(
      modelShieldBehaviorForBoss({
        behavior: 'absorb',
        capacity: 200,
        refillPool: 0,
        totalIncomingDamage: 3000,
        mitigation: 0,
      }).absorbNegated,
    ).toBeCloseTo(30, 6); // 15% of the 200 pool
    expect(
      modelShieldBehaviorForBoss({
        behavior: 'absorb',
        capacity: 200,
        refillPool: 0,
        totalIncomingDamage: 100,
        mitigation: 0,
      }).absorbNegated,
    ).toBeCloseTo(15, 6); // only 100 damage ever arrives
  });

  it('amp: multiplier averages over shield uptime', () => {
    const partial = modelShieldBehaviorForBoss({
      behavior: 'amp',
      capacity: 200,
      refillPool: 0,
      totalIncomingDamage: 300,
      mitigation: 0,
    });
    expect(partial.shieldUptimeFraction).toBeCloseTo(2 / 3, 6);
    expect(partial.ampDpsMultiplier).toBeCloseTo(1 + 0.25 * (2 / 3), 6);
    const full = modelShieldBehaviorForBoss({
      behavior: 'amp',
      capacity: 200,
      refillPool: 0,
      totalIncomingDamage: 100,
      mitigation: 0,
    });
    expect(full.ampDpsMultiplier).toBe(1.25);
  });
});

function bossInput(overrides: Partial<BossSimulationInput> = {}): BossSimulationInput {
  return {
    primary: makeWeapon(),
    secondary: null,
    heavy: null,
    ordnance: null,
    shield: null,
    classMod: null,
    relic: null,
    consumables: {},
    risk: RiskSetting.Balanced,
    boss: {
      id: 'test-boss',
      name: 'Test Boss',
      tier: 1,
      level: 10,
      health: 10000,
      shield: 0,
      armor: 0,
      dps: 100,
      weaknesses: [],
      resistances: [],
      mechanic: { id: 'none', name: 'None', description: '', checkType: 'dps' },
      tags: [],
      phases: [],
      recommendedPower: 100,
      entryCost: 0,
      rematchCost: 0,
      dropTable: [],
      dedicatedDrops: [],
    },
    playerLevel: 10,
    skillBonuses: {},
    pityCount: 0,
    playerCredits: 0,
    ...overrides,
  };
}

describe('simulateBoss shield behaviors', () => {
  it('nova: burst damage comes straight off the boss HP (timeToKill drops by nova/dps)', () => {
    const standard = simulateBoss(bossInput({ shield: makeShield({ behavior: 'standard', hp: 200 }) }));
    const nova = simulateBoss(bossInput({ shield: makeShield({ behavior: 'nova', hp: 200 }) }));
    // Boss deals 100×30 = 3000 ≥ 200 pool → one burst of 300.
    expect(nova.effectiveDPS).toBe(standard.effectiveDPS);
    expect(nova.timeToKill).toBeCloseTo((10000 - 300) / standard.effectiveDPS, 4);
    // dpsScore is the uncapped 30/timeToKill; winChance caps it, so
    // pin the strict rise on dpsScore and non-decrease on winChance.
    expect(nova.dpsScore).toBeGreaterThan(standard.dpsScore);
    expect(nova.winChance).toBeGreaterThanOrEqual(standard.winChance);
    expect(nova.reasons.some((r) => r.includes('Nova shield'))).toBe(true);
  });

  it('nova with Shield Cell refills fires twice in the model', () => {
    const one = simulateBoss(bossInput({ shield: makeShield({ behavior: 'nova', hp: 200 }) }));
    const two = simulateBoss(
      bossInput({
        shield: makeShield({ behavior: 'nova', hp: 200 }),
        consumables: { ShieldCell: 2 }, // +200 refill pool ≥ 50% of capacity
      }),
    );
    expect(two.timeToKill).toBeCloseTo((10000 - 600) / one.effectiveDPS, 4);
    expect(two.timeToKill).toBeLessThan(one.timeToKill);
  });

  it('amp: effective DPS scales by the uptime-averaged multiplier', () => {
    const boss = { ...bossInput().boss, dps: 10 }; // 300 total damage vs 200 pool
    const standard = simulateBoss(bossInput({ boss, shield: makeShield({ behavior: 'standard', hp: 200 }) }));
    const amp = simulateBoss(bossInput({ boss, shield: makeShield({ behavior: 'amp', hp: 200 }) }));
    expect(amp.effectiveDPS / standard.effectiveDPS).toBeCloseTo(1 + 0.25 * (2 / 3), 4);
    expect(amp.survivalScore).toBe(standard.survivalScore);
  });

  it('absorb: survival score rises by the negated damage over boss output', () => {
    const standard = simulateBoss(bossInput({ shield: makeShield({ behavior: 'standard', hp: 200 }) }));
    const absorb = simulateBoss(bossInput({ shield: makeShield({ behavior: 'absorb', hp: 200 }) }));
    // Negated = 15% × min(3000, 200) = 30 → +30/3000 survival score.
    expect(absorb.survivalScore).toBeCloseTo(standard.survivalScore + 30 / 3000, 6);
    expect(absorb.effectiveDPS).toBe(standard.effectiveDPS);
  });

  it('turtle: the generated capacity edge is the whole effect in the pooled sim', () => {
    const standard = simulateBoss(bossInput({ shield: makeShield({ behavior: 'standard', hp: 200 }) }));
    const turtle = simulateBoss(bossInput({ shield: makeShield({ behavior: 'turtle', hp: 300 }) }));
    expect(turtle.survivalScore).toBeGreaterThan(standard.survivalScore);
    expect(turtle.effectiveDPS).toBe(standard.effectiveDPS);
    expect(turtle.timeToKill).toBe(standard.timeToKill);
  });

  it('legacy shield sims bit-identically to an explicit Standard shield', () => {
    const legacy = simulateBoss(bossInput({ shield: makeLegacyShield({ hp: 200 }) }));
    const standard = simulateBoss(bossInput({ shield: makeShield({ behavior: 'standard', hp: 200 }) }));
    expect(legacy.winChance).toBe(standard.winChance);
    expect(legacy.survivalScore).toBe(standard.survivalScore);
    expect(legacy.dpsScore).toBe(standard.dpsScore);
    expect(legacy.timeToKill).toBe(standard.timeToKill);
    expect(legacy.effectiveDPS).toBe(standard.effectiveDPS);
    expect(legacy.reasons).toEqual(standard.reasons);
  });

  it('the same capacity yields the same nova damage in the boss model as in roaming', () => {
    // Shared-module proof: capacity 100 → 150 burst in BOTH engines.
    expect(novaDamageForCapacity(100)).toBe(150);
    expect(
      modelShieldBehaviorForBoss({
        behavior: 'nova',
        capacity: 100,
        refillPool: 0,
        totalIncomingDamage: 3000,
        mitigation: 0,
      }).novaDamage,
    ).toBe(150);
  });

  it('source pins: both engines resolve behaviors through the shared module', () => {
    const contract = readFileSync(resolve(__dirname, '../lib/combat/damageContract.ts'), 'utf8');
    const sim = readFileSync(resolve(__dirname, '../lib/simulation/bossSimulator.ts'), 'utf8');
    const chef = readFileSync(resolve(__dirname, '../server/chef.ts'), 'utf8');
    expect(contract).toContain("from './shieldBehaviors'");
    expect(sim).toContain('modelShieldBehaviorForBoss');
    expect(chef).toContain('shieldBehaviorOf');
    expect(chef).toContain('ampDamageMultiplier');
  });
});

describe('Chef boss attempts with behavior shields', () => {
  it('nova burst lands on the boss: timeToKill shrinks by exactly the burst share', () => {
    const boss = REGION_1_BOSSES[0]; // Dune Tyrant: 800 HP, dps 30 → 900 incoming
    const attempt = (shield: Shield) =>
      processBossAttempt({
        playerId: PLAYER,
        bossId: boss.id,
        attemptNonce: 123,
        primary: makeWeapon(),
        secondary: null,
        heavy: null,
        ordnance: null,
        shield,
        classMod: null,
        relic: null,
        consumables: {},
        risk: RiskSetting.Balanced,
        playerLevel: 50,
        skillBonuses: {},
        pityCount: 0,
        playerCredits: 10000,
      });
    const standard = attempt(makeShield({ behavior: 'standard', hp: 200 }));
    const nova = attempt(makeShield({ behavior: 'nova', hp: 200 }));
    // One burst of 300 off 800 HP → timeToKill ratio (800−300)/800.
    expect(nova.telemetry.timeToKill / standard.telemetry.timeToKill).toBeCloseTo(500 / 800, 3);
    expect(nova.telemetry.timeToKill).toBeLessThan(standard.telemetry.timeToKill);
  });
});

// ---------------------------------------------------------------------------
// 6. Visibility — cards and loot lines carry the behavior
// ---------------------------------------------------------------------------

describe('shield behavior visibility', () => {
  it('gear card summary names the behavior and badges non-Standard shields', () => {
    const nova = gearCardSummary(makeShield({ behavior: 'nova', hp: 200 }));
    expect(nova.badges).toContain('Nova');
    expect(nova.secondaryStats.some((s) => s.label === 'Behavior' && s.value === 'Nova')).toBe(
      true,
    );

    const legacy = gearCardSummary(makeLegacyShield({ hp: 200 }));
    expect(legacy.badges).not.toContain('Standard');
    expect(
      legacy.secondaryStats.some((s) => s.label === 'Behavior' && s.value === 'Standard'),
    ).toBe(true);
  });

  it('loot stat line names non-Standard behaviors and is unchanged for legacy shields', () => {
    expect(lootStatLine(makeShield({ behavior: 'turtle', hp: 300 }))).toContain('TURTLE');
    expect(lootStatLine(makeLegacyShield({ hp: 200 }))).toBe(
      lootStatLine(makeShield({ behavior: 'standard', hp: 200 })),
    );
  });
});
