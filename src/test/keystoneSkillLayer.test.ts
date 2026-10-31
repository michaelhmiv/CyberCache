/**
 * Phase 2d — keystone skill layer: zero dead major/keystone effects.
 *
 * Layers covered:
 *   1. The consumer registry (src/lib/skills/skillConsumers.ts) as a
 *      structural test: every major/keystone effect key in the defs
 *      has a registered consumer, every registered needle is present
 *      in its consumer file, and no registry entry is stale. A future
 *      dead key fails this suite instead of shipping silently.
 *   2. Respec sanity for the two REPLACED nodes: ids/names/costs are
 *      unchanged, existing spends flow through computeSkillBonuses
 *      into the NEW effects, and the replaced keys exist nowhere in
 *      the defs anymore.
 *   3. Shipped-path toggles per implemented key: boss sim outcomes
 *      (Gunslinger + Demolition majors/keystone, plus the
 *      heavyWeaponBurst and statusChance small-node fixes), the Chef
 *      roaming claim (lootQuantity), the Chef boss attempt
 *      (consumableRecovery), and salvage through the real write
 *      routes + InMemoryWriteStore (salvageBonus,
 *      lowRarityScrapBonus, commonMaterialChance), with source pins
 *      on migration 0022 keeping the SQL twin in parity.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '../constants/bosses';
import { SKILL_NODES } from '../constants/skillTrees';
import { computeSkillBonuses } from '../lib/skills/skillBonuses';
import { SKILL_EFFECT_CONSUMERS } from '../lib/skills/skillConsumers';
import { applySalvageSkillBonuses } from '../lib/skills/salvageBonuses';
import { simulateBoss } from '../lib/simulation/bossSimulator';
import { computeWeaponDps } from '../lib/stats/dpsChain';
import { processBossAttempt, processRoamingClaim } from '../server/chef';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { BossDef } from '../types/boss';
import type { Ordnance, Weapon } from '../types/items';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteItemData, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'test-weapon',
    name: 'Test Gun',
    level: 50,
    rarity: Rarity.Epic,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic,
    rollQuality: 75,
    baseDamage: 100,
    attackSpeed: 1,
    critChance: 0,
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

function makeBoss(overrides: Partial<BossDef> = {}): BossDef {
  return {
    id: 'test-boss',
    name: 'Test Boss',
    tier: 1,
    level: 10,
    health: 100000,
    shield: 0,
    armor: 0,
    dps: 100,
    weaknesses: [],
    resistances: [],
    mechanic: { id: 'enrage', name: 'Enrage', description: '', checkType: 'dps' },
    tags: [],
    phases: [],
    recommendedPower: 100,
    entryCost: 0,
    rematchCost: 0,
    dropTable: [],
    dedicatedDrops: [],
    ...overrides,
  };
}

function makeOrdnance(overrides: Partial<Ordnance> = {}): Ordnance {
  return {
    id: 'test-ordnance',
    name: 'Test Charge',
    level: 50,
    rarity: Rarity.Epic,
    damage: 0,
    shieldDamage: 0,
    armorDamage: 0,
    element: Element.Kinetic,
    effect: 'Test payload',
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 0,
    ...overrides,
  };
}

function runSim(args: {
  primary?: Weapon | null;
  secondary?: Weapon | null;
  heavy?: Weapon | null;
  ordnance?: Ordnance | null;
  boss: BossDef;
  skillBonuses?: Record<string, number>;
  consumables?: Record<string, number>;
  playerLevel?: number;
}) {
  return simulateBoss({
    primary: args.primary ?? null,
    secondary: args.secondary ?? null,
    heavy: args.heavy ?? null,
    ordnance: args.ordnance ?? null,
    shield: null,
    classMod: null,
    relic: null,
    consumables: args.consumables ?? {},
    risk: RiskSetting.Balanced,
    boss: args.boss,
    playerLevel: args.playerLevel ?? 50,
    skillBonuses: args.skillBonuses ?? {},
    pityCount: 0,
    playerCredits: 0,
  });
}

// ---------------------------------------------------------------------------
// 1. Consumer registry — the structural guard
// ---------------------------------------------------------------------------

describe('skill effect consumer registry', () => {
  const majorKeystoneKeys = new Set<string>();
  const allKeys = new Set<string>();
  for (const node of SKILL_NODES) {
    for (const key of Object.keys(node.effects)) {
      allKeys.add(key);
      if (node.type === 'major' || node.type === 'keystone') majorKeystoneKeys.add(key);
    }
  }

  it('every major/keystone effect key has a registered consumer', () => {
    const missing = [...majorKeystoneKeys].filter((key) => !SKILL_EFFECT_CONSUMERS[key]?.length);
    expect(missing).toEqual([]);
  });

  it('every registered consumer needle is present in its file', () => {
    for (const [key, consumers] of Object.entries(SKILL_EFFECT_CONSUMERS)) {
      for (const consumer of consumers) {
        const source = readFileSync(resolve(process.cwd(), consumer.file), 'utf8');
        expect(source, `${key} → ${consumer.file} must contain "${consumer.needle}"`).toContain(consumer.needle);
      }
    }
  });

  it('no stale registry entries (every key still exists in the defs)', () => {
    const stale = Object.keys(SKILL_EFFECT_CONSUMERS).filter((key) => !allKeys.has(key));
    expect(stale).toEqual([]);
  });

  it('the replaced keys exist nowhere in the defs anymore', () => {
    for (const node of SKILL_NODES) {
      for (const dead of ['autoSalvageBonus', 'autoSalvageConsumableChance', 'postBossDropChance', 'postBossSessions']) {
        expect(node.effects, `${node.id} must not advertise ${dead}`).not.toHaveProperty(dead);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Respec sanity — replaced nodes keep identity, spends get new effects
// ---------------------------------------------------------------------------

describe('replaced nodes — respec sanity', () => {
  it("Hoarder's Instinct keeps its identity and now yields salvageBonus", () => {
    const node = SKILL_NODES.find((n) => n.id === 'scav_major_1');
    expect(node?.name).toBe("Hoarder's Instinct");
    expect(node?.type).toBe('major');
    expect(node?.cost).toBe(3);
    expect(node?.effects).toEqual({ salvageBonus: 0.25 });
    expect(node?.description).toContain('Salvaging');
    const bonuses = computeSkillBonuses({ scav_major_1: 1 });
    expect(bonuses.salvageBonus).toBe(0.25);
    expect(bonuses.autoSalvageBonus).toBeUndefined();
  });

  it('Lucky Find keeps its identity and now yields rareDropChance', () => {
    const node = SKILL_NODES.find((n) => n.id === 'scav_major_4');
    expect(node?.name).toBe('Lucky Find');
    expect(node?.type).toBe('major');
    expect(node?.cost).toBe(3);
    expect(node?.effects).toEqual({ rareDropChance: 0.15 });
    expect(node?.description).toBe('+15% Rare Drop Chance.');
    const bonuses = computeSkillBonuses({ scav_major_4: 1 });
    expect(bonuses.rareDropChance).toBeCloseTo(0.15, 10);
    expect(bonuses.postBossDropChance).toBeUndefined();
  });

  it("Insurance Fraud's description tells the truth about the refund", () => {
    const node = SKILL_NODES.find((n) => n.id === 'scav_major_2');
    expect(node?.effects).toEqual({ consumableRecovery: 0.5 });
    expect(node?.description).toContain('victorious boss fight');
    expect(node?.description).toContain('refunded');
  });
});

// ---------------------------------------------------------------------------
// 3a. Boss sim — Gunslinger majors / keystone
// ---------------------------------------------------------------------------

describe('boss sim — Gunslinger keystone layer', () => {
  it('Focus Fire: +15% boss damage only with a Sniper/Pistol primary', () => {
    const boss = makeBoss();
    const sniper = makeWeapon({ weaponType: WeaponType.Sniper });
    const shotgun = makeWeapon({ weaponType: WeaponType.Shotgun });
    const bonus = { bossDamageSniperPistol: 0.15 };

    const sniperBase = runSim({ primary: sniper, boss });
    const sniperBoosted = runSim({ primary: sniper, boss, skillBonuses: bonus });
    expect(sniperBoosted.effectiveDPS / sniperBase.effectiveDPS).toBeCloseTo(1.15, 4);

    const shotgunBase = runSim({ primary: shotgun, boss });
    const shotgunBoosted = runSim({ primary: shotgun, boss, skillBonuses: bonus });
    expect(shotgunBoosted.effectiveDPS).toBe(shotgunBase.effectiveDPS);
  });

  it('Speedloader: opening attack-speed window lifts DPS by its fight share', () => {
    const boss = makeBoss({ health: 5000 });
    const pistol = makeWeapon({ weaponType: WeaponType.Pistol, baseDamage: 10, attackSpeed: 1 });
    const base = runSim({ primary: pistol, boss });
    const boosted = runSim({ primary: pistol, boss, skillBonuses: { openingAttackSpeed: 0.2 } });
    const share = Math.min(10, base.timeToKill) / base.timeToKill;
    expect(boosted.effectiveDPS / base.effectiveDPS).toBeCloseTo(1 + 0.2 * share, 4);
    expect(boosted.reasons.join(' ')).toContain('Speedloader');
  });

  it('Weakspot Analysis: crit damage counts double in the sub-50% phase average', () => {
    const boss = makeBoss();
    const critGun = makeWeapon({ critChance: 0.4, critDamage: 2 });
    const base = runSim({ primary: critGun, boss });
    const boosted = runSim({ primary: critGun, boss, skillBonuses: { critDamageSub50: 0.3 } });
    // crit share = (0.4×2)/(1+0.4×2) = 4/9; phase average = 1 + ½×0.3×4/9
    expect(boosted.effectiveDPS / base.effectiveDPS).toBeCloseTo(1 + 0.5 * 0.3 * (4 / 9), 3);

    const noCrit = makeWeapon({ critChance: 0 });
    const noCritBase = runSim({ primary: noCrit, boss });
    const noCritBoosted = runSim({ primary: noCrit, boss, skillBonuses: { critDamageSub50: 0.3 } });
    expect(noCritBoosted.effectiveDPS).toBe(noCritBase.effectiveDPS);
  });

  it('Elemental Overclock: +10% only when an equipped weapon matches a weakness', () => {
    const boss = makeBoss({ weaknesses: [Element.Fire] });
    const fire = makeWeapon({ element: Element.Fire });
    const shock = makeWeapon({ element: Element.Shock });
    const bonus = { weaknessMatchDamage: 0.1 };

    const matchedBase = runSim({ primary: fire, boss });
    const matched = runSim({ primary: fire, boss, skillBonuses: bonus });
    expect(matched.effectiveDPS / matchedBase.effectiveDPS).toBeCloseTo(1.1, 4);

    const unmatchedBase = runSim({ primary: shock, boss });
    const unmatched = runSim({ primary: shock, boss, skillBonuses: bonus });
    expect(unmatched.effectiveDPS).toBe(unmatchedBase.effectiveDPS);
  });

  it('Death by a Thousand Cuts I: critDpsBonus moves the DPS score, not physical DPS', () => {
    const boss = makeBoss({ health: 3000 });
    const critGun = makeWeapon({ critChance: 0.5, critDamage: 2 });
    const base = runSim({ primary: critGun, boss });
    const boosted = runSim({ primary: critGun, boss, skillBonuses: { critDpsBonus: 0.25 } });
    // crit share = (0.5×2)/(1+0.5×2) = 0.5 → score × (1 + 0.25×0.5)
    expect(boosted.dpsScore / base.dpsScore).toBeCloseTo(1.125, 3);
    expect(boosted.effectiveDPS).toBe(base.effectiveDPS);
    expect(boosted.timeToKill).toBe(base.timeToKill);
  });

  it('Death by a Thousand Cuts II: highCritBossDamage needs total crit > 50%', () => {
    const boss = makeBoss();
    const bonus = { highCritBossDamage: 0.1 };

    const high = makeWeapon({ critChance: 0.6 });
    const highBase = runSim({ primary: high, boss });
    const highBoosted = runSim({ primary: high, boss, skillBonuses: bonus });
    expect(highBoosted.effectiveDPS / highBase.effectiveDPS).toBeCloseTo(1.1, 4);

    const low = makeWeapon({ critChance: 0.4 });
    const lowBase = runSim({ primary: low, boss });
    const lowBoosted = runSim({ primary: low, boss, skillBonuses: { ...bonus, critChance: 0.05 } });
    expect(lowBoosted.effectiveDPS).toBe(lowBase.effectiveDPS);

    // Skill crit chance counts toward the threshold.
    const pushed = runSim({ primary: low, boss, skillBonuses: { ...bonus, critChance: 0.2 } });
    expect(pushed.effectiveDPS / lowBase.effectiveDPS).toBeCloseTo(1.1, 4);
  });
});

// ---------------------------------------------------------------------------
// 3b. Boss sim — Demolition majors / keystone (+ small-node fixes)
// ---------------------------------------------------------------------------

describe('boss sim — Demolition keystone layer', () => {
  it('Breaching Charge: ordnance shield strip scales by the bonus', () => {
    // The sim reports breakScore = min(shield, armor) score; with no
    // armor pool the armor score is 1, so breakScore IS the shield score.
    const boss = makeBoss({ shield: 10000 });
    const ordnance = makeOrdnance({ shieldDamage: 4000, element: Element.Shock });
    const args = { primary: makeWeapon(), ordnance, boss, consumables: { OrdnanceCharge: 1 } };
    const base = runSim(args);
    const boosted = runSim({ ...args, skillBonuses: { shieldStripBonus: 0.3 } });
    expect(base.breakScore).toBeGreaterThan(0);
    expect(boosted.breakScore / base.breakScore).toBeCloseTo(1.3, 4);
  });

  it('Concussive Payload: stagger uptime × mitigation cuts boss damage in the survival check', () => {
    const boss = makeBoss({ dps: 100 });
    const primary = makeWeapon();
    const base = runSim({ primary, boss, skillBonuses: { staggerChance: 1 } });
    const boosted = runSim({
      primary, boss,
      skillBonuses: { staggerChance: 1, staggerDuration: 0.5, staggerMitigation: 0.3 },
    });
    // uptime = min(1, 1.0 × 1.5) = 1 → boss damage × 0.7 → survival ÷ 0.7
    expect(boosted.survivalScore / base.survivalScore).toBeCloseTo(1 / 0.7, 3);

    // Without stagger chance there is no uptime and no effect.
    const noStagger = runSim({ primary, boss, skillBonuses: { staggerDuration: 0.5, staggerMitigation: 0.3 } });
    const bare = runSim({ primary, boss });
    expect(noStagger.survivalScore).toBe(bare.survivalScore);
  });

  it('Scorched Earth: Launcher heavy gains armor break and boss DPS; other heavies do not', () => {
    const boss = makeBoss({ armor: 7500 });
    const launcher = makeWeapon({ weaponType: WeaponType.Launcher, armorDamageMod: 0.5 });
    const primary = makeWeapon();
    const bonus = { launcherArmorBreak: 0.5, launcherBossDps: 0.25 };

    // No shield pool → breakScore is the armor score.
    const base = runSim({ primary, heavy: launcher, boss });
    const boosted = runSim({ primary, heavy: launcher, boss, skillBonuses: bonus });
    expect(boosted.breakScore / base.breakScore).toBeCloseTo(1.5, 4);
    expect(boosted.effectiveDPS).toBeGreaterThan(base.effectiveDPS);

    const smg = makeWeapon({ weaponType: WeaponType.SMG, armorDamageMod: 0.5 });
    const smgBase = runSim({ primary, heavy: smg, boss });
    const smgBoosted = runSim({ primary, heavy: smg, boss, skillBonuses: bonus });
    expect(smgBoosted.breakScore).toBe(smgBase.breakScore);
    expect(smgBoosted.effectiveDPS).toBe(smgBase.effectiveDPS);
  });

  it('Cluster Bombs: ordnance break contributions scale by the re-trigger EV', () => {
    const ordnance = makeOrdnance({ shieldDamage: 4000, armorDamage: 2000, element: Element.Shock });
    const bonus = { clusterChance: 0.25, clusterDamage: 1.0 };
    // One pool at a time so breakScore reports the tested pool.
    const shieldBoss = makeBoss({ shield: 10000 });
    const shieldArgs = { primary: makeWeapon(), ordnance, boss: shieldBoss, consumables: { OrdnanceCharge: 1 } };
    const shieldBase = runSim(shieldArgs);
    const shieldBoosted = runSim({ ...shieldArgs, skillBonuses: bonus });
    expect(shieldBoosted.breakScore / shieldBase.breakScore).toBeCloseTo(1.25, 4);

    const armorBoss = makeBoss({ armor: 8000 });
    const armorArgs = { primary: makeWeapon(), ordnance, boss: armorBoss, consumables: { OrdnanceCharge: 1 } };
    const armorBase = runSim(armorArgs);
    const armorBoosted = runSim({ ...armorArgs, skillBonuses: bonus });
    expect(armorBase.breakScore).toBeGreaterThan(0);
    expect(armorBoosted.breakScore / armorBase.breakScore).toBeCloseTo(1.25, 4);
  });

  it('Unstable Power I: explosiveArmorBreak flows from spends through the composite', () => {
    const boss = makeBoss({ armor: 10000 });
    const primary = makeWeapon({ armorDamageMod: 0.5, element: Element.Corrosive });
    const base = runSim({ primary, boss, skillBonuses: computeSkillBonuses({}) });
    const keystoned = runSim({ primary, boss, skillBonuses: computeSkillBonuses({ demo_keystone: 1 }) });
    // armorBreak composite 0 → 1.0 doubles the armor-break total.
    expect(base.breakScore).toBeGreaterThan(0);
    expect(keystoned.breakScore / base.breakScore).toBeCloseTo(2, 4);
  });

  it('Unstable Power II: brokenArmorHeavyBonus fires only with broken armor and a heavy', () => {
    const primary = makeWeapon({ armorDamageMod: 1, element: Element.Corrosive });
    const heavy = makeWeapon({ id: 'heavy' });
    const bonus = { brokenArmorHeavyBonus: 0.25 };

    const brokenBoss = makeBoss({ armor: 1 });
    const base = runSim({ primary, heavy, boss: brokenBoss });
    const boosted = runSim({ primary, heavy, boss: brokenBoss, skillBonuses: bonus });
    expect(base.breakScore).toBeGreaterThanOrEqual(1);
    expect(boosted.effectiveDPS).toBeGreaterThan(base.effectiveDPS);

    const noHeavyBase = runSim({ primary, boss: brokenBoss });
    const noHeavy = runSim({ primary, boss: brokenBoss, skillBonuses: bonus });
    expect(noHeavy.effectiveDPS).toBe(noHeavyBase.effectiveDPS);

    const armoredBoss = makeBoss({ armor: 100000 });
    const armoredBase = runSim({ primary, heavy, boss: armoredBoss });
    const armored = runSim({ primary, heavy, boss: armoredBoss, skillBonuses: bonus });
    expect(armoredBase.breakScore).toBeLessThan(1);
    expect(armored.effectiveDPS).toBe(armoredBase.effectiveDPS);
  });

  it('Heavy Weapon Burst (small nodes): the heavy slot gains its burst bonus', () => {
    const boss = makeBoss();
    const primary = makeWeapon();
    const heavy = makeWeapon({ id: 'heavy' });
    const base = runSim({ primary, heavy, boss });
    const boosted = runSim({ primary, heavy, boss, skillBonuses: { heavyWeaponBurst: 0.3 } });
    expect(boosted.effectiveDPS).toBeGreaterThan(base.effectiveDPS);
    const noHeavyBase = runSim({ primary, boss });
    const noHeavy = runSim({ primary, boss, skillBonuses: { heavyWeaponBurst: 0.3 } });
    expect(noHeavy.effectiveDPS).toBe(noHeavyBase.effectiveDPS);
  });
});

// ---------------------------------------------------------------------------
// 3c. statusChance (small node) — chain + sim
// ---------------------------------------------------------------------------

describe('Procedural Loads (statusChance small node)', () => {
  const statusGun = makeWeapon({ statusChance: 0.2, statusDamage: 1 });

  it('the DPS chain prices bonus status chance in its status step', () => {
    const base = computeWeaponDps({ weapon: statusGun });
    const boosted = computeWeaponDps({ weapon: statusGun, bonusStatusChance: 0.1 });
    // status step: 1 + (0.2)(1)(0.3) = 1.06 → 1 + (0.3)(1)(0.3) = 1.09
    expect(boosted / base).toBeCloseTo(1.09 / 1.06, 3);
  });

  it('the boss sim passes the skill total into the chain for every slot', () => {
    const boss = makeBoss();
    const base = runSim({ primary: statusGun, boss });
    const boosted = runSim({ primary: statusGun, boss, skillBonuses: { statusChance: 0.1 } });
    expect(boosted.effectiveDPS / base.effectiveDPS).toBeCloseTo(1.09 / 1.06, 3);

    const inert = makeWeapon({ statusChance: 0.2, statusDamage: 0 });
    const inertBase = runSim({ primary: inert, boss });
    const inertBoosted = runSim({ primary: inert, boss, skillBonuses: { statusChance: 0.1 } });
    expect(inertBoosted.effectiveDPS).toBe(inertBase.effectiveDPS);
  });
});

// ---------------------------------------------------------------------------
// 3d. Chef roaming claim — lootQuantity (small nodes, same-wiring fix)
// ---------------------------------------------------------------------------

describe('Chef roaming claim — Scavenger Quantity (lootQuantity)', () => {
  const fakeSupabase = {} as Parameters<typeof processRoamingClaim>[1];

  function claim(skillBonuses: Record<string, number>) {
    return processRoamingClaim(
      {
        playerId: 'quantity-player',
        areaId: 'dustwaste_frontier',
        ticks: 200,
        tickCount: 1,
        playerLevel: 10,
        idleMods: { offlineEarningsMod: 0, scrapYieldMod: 0, rareDropChanceMod: 0 },
        skillBonuses,
      },
      fakeSupabase,
    );
  }

  it('each material/essence find gains a bonus unit at 100% quantity chance', () => {
    const base = claim({});
    const boosted = claim({ lootQuantity: 1 });
    const total = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
    // The seeded per-tick RNG stream is identical (the bonus roll is
    // gated on the bonus itself), so the base finds are the same —
    // every find simply pays one extra unit.
    expect(total(boosted.rewards.materials)).toBeGreaterThan(total(base.rewards.materials));
    for (const [kind, qty] of Object.entries(base.rewards.materials)) {
      expect(boosted.rewards.materials[kind]).toBeGreaterThanOrEqual(qty);
      expect(boosted.rewards.materials[kind]).toBeLessThanOrEqual(qty * 2);
    }
  });

  it('zero bonus leaves the claim bit-identical (no RNG stream shift)', () => {
    const a = claim({});
    const b = claim({ lootQuantity: 0 });
    expect(b.rewards.materials).toEqual(a.rewards.materials);
    expect(b.rewards.creditsAwarded).toBe(a.rewards.creditsAwarded);
  });
});

// ---------------------------------------------------------------------------
// 3e. Chef boss attempt — Insurance Fraud (consumableRecovery)
// ---------------------------------------------------------------------------

describe('Chef boss attempt — Insurance Fraud (consumableRecovery)', () => {
  const boss = REGION_1_BOSSES[0]; // dune_tyrant

  function strongWeapon(): Weapon {
    return {
      id: 'fraud-test-gun',
      name: 'Fraud Test Gun',
      level: 50,
      rarity: Rarity.Legendary,
      weaponType: WeaponType.SMG,
      manufacturer: Manufacturer.Redline,
      element: Element.Fire,
      rollQuality: 100,
      baseDamage: 10000,
      attackSpeed: 10,
      critChance: 0.5,
      critDamage: 2,
      statusChance: 0,
      statusDamage: 0,
      bossDamageMod: 2,
      waveDamageMod: 0,
      shieldDamageMod: 1,
      armorDamageMod: 1,
      offlineEarningsMod: 0,
      rareDropChanceMod: 0,
      scrapYieldMod: 0,
      parts: [],
      affixes: [],
      sourceTag: DropSource.WorldDrop,
      isLocked: false,
      pixelSeed: 1,
      combatPower: 0,
      bossPower: 0,
      farmPower: 0,
      economyScore: 0,
    };
  }

  it('on victory at 100% recovery, every used consumable is refunded', () => {
    // Nonce 42 with this weapon/level is a pinned victory (bossLoopUnits).
    const base = {
      playerId: 'fraud-player', bossId: boss.id, attemptNonce: 42,
      primary: strongWeapon(), secondary: null, heavy: null, ordnance: null, shield: null,
      classMod: null, relic: null, consumables: { AmmoPack: 1, LuckBooster: 1 },
      risk: RiskSetting.Balanced, playerLevel: 50, pityCount: 0, playerCredits: 10000, entryFee: 0,
    } as const;
    const unskilled = processBossAttempt({ ...base, skillBonuses: {} });
    expect(unskilled.result.victory).toBe(true);
    expect(unskilled.result.consumablesUsed).toEqual({ AmmoPack: 1, LuckBooster: 1 });

    const skilled = processBossAttempt({ ...base, skillBonuses: { consumableRecovery: 1 } });
    expect(skilled.result.victory).toBe(true);
    expect(skilled.result.consumablesUsed).toEqual({});
  });

  it('on defeat the recovery never fires (victory gate)', () => {
    // Nonce 43 unarmed at level 5 is a pinned defeat (bossLoopUnits).
    const base = {
      playerId: 'fraud-player', bossId: boss.id, attemptNonce: 43,
      primary: null, secondary: null, heavy: null, ordnance: null, shield: null,
      classMod: null, relic: null, consumables: { AmmoPack: 1, InsuranceToken: 1 },
      risk: RiskSetting.Balanced, playerLevel: 5, pityCount: 0, playerCredits: 10000, entryFee: 0,
    } as const;
    const unskilled = processBossAttempt({ ...base, skillBonuses: {} });
    expect(unskilled.result.victory).toBe(false);
    const skilled = processBossAttempt({ ...base, skillBonuses: { consumableRecovery: 1 } });
    expect(skilled.result.victory).toBe(false);
    expect(skilled.result.consumablesUsed).toEqual(unskilled.result.consumablesUsed);
    expect(skilled.result.consumablesUsed).toEqual({ AmmoPack: 1, InsuranceToken: 1 });
  });
});

// ---------------------------------------------------------------------------
// 3f. Salvage skill math — the one TS owner
// ---------------------------------------------------------------------------

describe('applySalvageSkillBonuses', () => {
  it('no skills: base award, no material even on a winning roll', () => {
    expect(
      applySalvageSkillBonuses({ baseAward: 60, rarity: 'Common', kind: 'weapon', bonuses: {}, materialRoll: 0 }),
    ).toEqual({ award: 60, bonusMaterial: null });
  });

  it("Hoarder's Instinct: +25% on every salvage, rounded once", () => {
    // Rare L10 base 150 → round(150 × 1.25) = 188
    expect(
      applySalvageSkillBonuses({ baseAward: 150, rarity: 'Rare', kind: 'weapon', bonuses: { salvageBonus: 0.25 }, materialRoll: 1 }).award,
    ).toBe(188);
  });

  it('King of Scrap: low rarities double; Commons can yield a kind-mapped material', () => {
    const common = applySalvageSkillBonuses({
      baseAward: 60, rarity: 'Common', kind: 'weapon',
      bonuses: { lowRarityScrapBonus: 1, commonMaterialChance: 0.25 }, materialRoll: 0.1,
    });
    expect(common).toEqual({ award: 120, bonusMaterial: 'BallisticParts' });

    const missed = applySalvageSkillBonuses({
      baseAward: 60, rarity: 'Common', kind: 'weapon',
      bonuses: { lowRarityScrapBonus: 1, commonMaterialChance: 0.25 }, materialRoll: 0.9,
    });
    expect(missed).toEqual({ award: 120, bonusMaterial: null });

    // Uncommons double too but never yield the material.
    const uncommon = applySalvageSkillBonuses({
      baseAward: 90, rarity: 'Uncommon', kind: 'shield',
      bonuses: { lowRarityScrapBonus: 1, commonMaterialChance: 0.25 }, materialRoll: 0,
    });
    expect(uncommon).toEqual({ award: 180, bonusMaterial: null });
  });

  it('material kind map follows the salvageRules convention', () => {
    const bonuses = { commonMaterialChance: 1 };
    const cases: Array<[string, string]> = [
      ['weapon', 'BallisticParts'],
      ['shield', 'ReactiveComponents'],
      ['ordnance', 'ReactiveComponents'],
      ['classMod', 'TechFragments'],
      ['relic', 'TechFragments'],
      ['vehicle', 'ScrapAlloy'],
    ];
    for (const [kind, expected] of cases) {
      expect(
        applySalvageSkillBonuses({ baseAward: 10, rarity: 'Common', kind, bonuses, materialRoll: 0 }).bonusMaterial,
      ).toBe(expected);
    }
  });

  it('both Scavenger salvage nodes stack multiplicatively', () => {
    // Common L10 base 60 → round(60 × 2 × 1.25) = 150
    expect(
      applySalvageSkillBonuses({
        baseAward: 60, rarity: 'Common', kind: 'weapon',
        bonuses: { salvageBonus: 0.25, lowRarityScrapBonus: 1 }, materialRoll: 1,
      }).award,
    ).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// 3g. Salvage through the shipped write routes (cc_recycle_item twin)
// ---------------------------------------------------------------------------

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PLAIN = '11111111-1111-4111-8111-111111111111';
const HOARDER = '22222222-2222-4222-8222-222222222222';
const KING = '33333333-3333-4333-8333-333333333333';
const BOTH = '44444444-4444-4444-8444-444444444444';

const ITEM_PLAIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ITEM_HOARDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const ITEM_KING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const ITEM_KING2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const ITEM_BOTH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const ITEM_KING_RARE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';

function salvageProfile(overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: null, display_name: null, player_level: 20, player_xp: 0, credits: 0,
    scrap: 0, cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {},
    consumables: {}, skill_spends: {}, boss_state: {}, last_idle_claim_at: '2026-10-29T10:00:00.000Z',
    last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: '2026-10-28T00:00:00.000Z',
    account_type: 'verified', email: null, email_verified_at: '2026-06-14T00:00:00.000Z',
    verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
    last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
    username_updated_at: null, username_change_count: 0,
    ...overrides,
  };
}

function salvageItem(overrides: Partial<WriteItemData> & { id: string; owner_user_id: string }): WriteItemData {
  return {
    kind: 'weapon', static_item_id: null, item_level: 10, rarity: 'Common', quality: null,
    material_tier: null, condition_state: null, condition_current: 40, condition_max: 50,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null, payload: { weaponType: 'Pistol' }, runtime_state: 'available',
    is_locked: false, equipped_slot: null, estimated_value: 100,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('salvage skill bonuses — shipped write route', () => {
  let roll = 0.1;
  let store: InMemoryWriteStore;
  let base = '';
  let closeServer: () => Promise<void> = async () => {};
  const tokens: Record<string, string> = {};
  let nonceCounter = 0;
  const nextNonce = () => `salvage-nonce-${++nonceCounter}-abcdef`;

  beforeAll(async () => {
    const seed: WriteSeed = emptyWriteSeed();
    seed.profiles = [
      salvageProfile({ id: PLAIN, username: 'plain' }),
      salvageProfile({ id: HOARDER, username: 'hoarder', skill_spends: { scav_major_1: 1 } }),
      salvageProfile({ id: KING, username: 'king', skill_spends: { scav_keystone: 1 } }),
      salvageProfile({ id: BOTH, username: 'both', skill_spends: { scav_major_1: 1, scav_keystone: 1 } }),
    ];
    seed.items = [
      salvageItem({ id: ITEM_PLAIN, owner_user_id: PLAIN }),
      salvageItem({ id: ITEM_HOARDER, owner_user_id: HOARDER }),
      salvageItem({ id: ITEM_KING, owner_user_id: KING }),
      salvageItem({ id: ITEM_KING2, owner_user_id: KING }),
      salvageItem({ id: ITEM_BOTH, owner_user_id: BOTH }),
      salvageItem({ id: ITEM_KING_RARE, owner_user_id: KING, rarity: 'Rare' }),
    ];
    store = new InMemoryWriteStore(seed, {
      now: () => new Date(Date.parse('2026-10-30T12:00:00.000Z')),
      rng: () => roll,
      uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
    });
    const app = express();
    app.use(express.json());
    mountWriteRoutes(app, store, { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((resolveListen) => server.on('listening', resolveListen));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () => new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    for (const id of [PLAIN, HOARDER, KING, BOTH]) tokens[id] = issueAccessToken(SECRET, id, false);
  });

  afterAll(async () => { await closeServer(); });

  async function recycle(playerId: string, itemId: string, nonce = nextNonce()) {
    const res = await fetch(`${base}/api/ops/recycle-item`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[playerId]}` },
      body: JSON.stringify({ nonce, item_id: itemId }),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {}, nonce };
  }

  const profileOf = (id: string) => store.seed.profiles.find((p) => p.id === id);

  it('base award is untouched without the nodes (Common L10 = 60)', async () => {
    const r = await recycle(PLAIN, ITEM_PLAIN);
    expect(r.status).toBe(200);
    expect(r.json.scrap_award).toBe(60);
    expect(r.json.bonus_material).toBeNull();
    expect(profileOf(PLAIN)?.scrap).toBe(60);
  });

  it("Hoarder's Instinct pays +25% through the route (75)", async () => {
    const r = await recycle(HOARDER, ITEM_HOARDER);
    expect(r.status).toBe(200);
    expect(r.json.scrap_award).toBe(75);
    expect(profileOf(HOARDER)?.scrap).toBe(75);
  });

  it('King of Scrap doubles a Common (120) and grants the bonus material on a winning roll', async () => {
    roll = 0.1; // < 0.25 chance → grant
    const r = await recycle(KING, ITEM_KING);
    expect(r.status).toBe(200);
    expect(r.json.scrap_award).toBe(120);
    expect(r.json.bonus_material).toBe('BallisticParts');
    expect((profileOf(KING)?.materials as Record<string, number>)?.BallisticParts).toBe(1);
  });

  it('a losing material roll grants nothing; nonce replay never double-pays', async () => {
    roll = 0.9; // > 0.25 chance → no grant
    const first = await recycle(KING, ITEM_KING2);
    expect(first.json.scrap_award).toBe(120);
    expect(first.json.bonus_material).toBeNull();
    expect((profileOf(KING)?.materials as Record<string, number>)?.BallisticParts).toBe(1);
    const scrapBefore = profileOf(KING)?.scrap;
    const replay = await recycle(KING, ITEM_KING2, first.nonce);
    expect(replay.json.scrap_award).toBe(120);
    expect(profileOf(KING)?.scrap).toBe(scrapBefore);
  });

  it('King of Scrap does NOT touch higher rarities (Rare L10 stays 150)', async () => {
    const r = await recycle(KING, ITEM_KING_RARE);
    expect(r.status).toBe(200);
    expect(r.json.scrap_award).toBe(150);
    expect(r.json.bonus_material).toBeNull();
  });

  it('both nodes stack through the route (Common L10 = 150)', async () => {
    const r = await recycle(BOTH, ITEM_BOTH);
    expect(r.status).toBe(200);
    expect(r.json.scrap_award).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// 3h. Migration 0022 source pins (SQL twin parity)
// ---------------------------------------------------------------------------

describe('migration 0022 — salvage skill wiring pins', () => {
  const sql = readFileSync(resolve(process.cwd(), 'db/migrations/0022_salvage_skill_bonuses.sql'), 'utf8');

  it('derives both Scavenger salvage nodes from the player records', () => {
    expect(sql).toContain("'scav_major_1'");
    expect(sql).toContain("'scav_keystone'");
    expect(sql).toContain("mod_payload ->> 'treeBonus' = 'Scavenger'");
    expect(sql).toContain('salvage_bonus := 0.25 * hoarder_pts');
    expect(sql).toContain('low_rarity_bonus := 1.0 * keystone_pts');
    expect(sql).toContain('material_chance := 0.25 * keystone_pts');
  });

  it('carries the kind → material map and the additive result field', () => {
    for (const material of ['BallisticParts', 'ReactiveComponents', 'TechFragments', 'ScrapAlloy']) {
      expect(sql).toContain(`'${material}'`);
    }
    expect(sql).toContain("'bonus_material', bonus_material");
  });

  it('syncs the dormant seed copy for the replaced nodes', () => {
    expect(sql).toContain('update public.skill_node_definitions');
    expect(sql).toContain('{"salvageBonus":0.25}');
    expect(sql).toContain('{"rareDropChance":0.15}');
  });
});
