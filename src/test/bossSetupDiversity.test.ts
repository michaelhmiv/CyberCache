/**
 * Boss setup-diversity (slice C2, owner rulings D1–D8, 2026-11-10).
 *
 * What C2 changed, and what this suite pins:
 *
 * 1. THE MECHANIC LEG COLLECTS. Every boss whose mechanic declares
 *    a checkType + threshold (Enrage Protocol's 1.3 DPS, Rapid
 *    Shield Regen's 1.2 shield break, Burning Ground's 1.4
 *    survival, Heavy Repair's and Living Armor's 1.5 armor break)
 *    advertised that demand on its prep screen since it shipped;
 *    before C2 the sim's mechanicScore was 1.0 by construction for
 *    all of them. The leg is min(1, axis ÷ threshold) — the same
 *    normalized ratio prep prints for the matching phase.
 * 2. THE SCRAP BISHOP COMPOSITE. Its three_phase mechanic carries
 *    no single axis; its leg is the min over its three phase
 *    targets (shield 1.25, armor 1.25, enrage-DPS 1.35). Phases on
 *    every other boss stay reporting-only (ruling D5).
 * 3. TRAIT GATES, THE OVERCLOCK RAMP, ADAPTIVE PLATING, AND THE
 *    CONSUMABLE PATCH ARE UNCHANGED — the patch (e.g. Ordnance
 *    Charge's declared +0.04 flat) applies to the collected score
 *    in the same order it always did, and the Jammer rule still
 *    forces enrage/phase mechanics to 1.
 * 4. ENDLESS IS BIT-IDENTICAL: generated Chamber encounters borrow
 *    a kit's mechanic WITHOUT its threshold and WITHOUT any
 *    composite (cadence was already stripped by C1), so the Chamber
 *    sims exactly as before. The sim keys the Bishop's leg on the
 *    declared composite field, never the mechanic id — an early cut
 *    keyed on the id leaked the siege into the Chamber, and the
 *    strong Endless fixtures below caught it.
 * 5. THE CRYOAMMO RE-READ WAS MEASURED AND DROPPED (ruling D6's
 *    own escape hatch). Priced as ×1.15 hit intervals in the fold,
 *    cryo's survival value measured 1.0000 on 11 of 13 matrix rows
 *    (1.0145 on the Widow / Omega pair) against the shipped flat
 *    read's 1.1500 / 1.1667 — the ±2% parity gate failed by ~13
 *    points, so the flat read stands and a pin below keeps it.
 *
 * THE MATRIX (the slice's acceptance evidence). Parity is one gear
 * budget per boss: a three-gun kit (primary, secondary, heavy
 * sharing one solved stat line), a shield, Ordnance Charges in the
 * belt, rechargeRate 0 (cadence gains are C1's, excluded by the
 * brief's own method). Gear is solved in the sim's own score space
 * — real generated kits run 16–50× a boss's recommendedPower and
 * saturate every row, so they cannot evidence separation; C1's
 * suite calibrated fixtures the same way. MATCHED answers every
 * advertised demand (weakness elements — the Mirror leads
 * off-element because she attunes to the primary and her sidearm /
 * heavy carry her Kinetic weakness; the trait answered; demanded
 * axes solved above threshold). BRUTE is the same budget as a
 * one-note build: a single neutral element in every slot (the
 * Mirror: all Kinetic, every slot attuned-resisted), no trait, and
 * the demanded axis solved DOWN to the ignore line — break / DPS
 * axes 0.80, Ashgut's survival exactly 1.00 (the raw budget
 * survived with zero margin for the burn). The ignore lines are
 * round, boss-independent numbers fixed before any post-C2 number
 * was seen; the axis solves bisect (the ordnance floor makes ratio
 * corrections land sloppily).
 *
 * Baselines below were measured on the pre-C2 tree (master
 * 86905872) with THESE builders, and the post-C2 expectations in
 * the same run. Win chance is linear in mechanicScore, so a taxed
 * brute's drop is exactly its leg (plus the shipped +0.04
 * Ordnance-Charge patch the belt has always carried).
 */
import { describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '../constants/bosses';
import { endlessEncounterForDepth } from '../content/endless';
import { computeHunterMaxHp } from '../lib/combat/damageContract';
import { simulateBoss, type BossSimulationInput, type BossSimulationOutput } from '../lib/simulation/bossSimulator';
import type { BossDef } from '../types/boss';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Ordnance, Shield, Weapon } from '../types/items';

// ── Fixture builders (the matrix doctrine, above) ─────────────────

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'matrix-gun', name: 'Matrix Gun', level: 50, rarity: Rarity.Epic,
    weaponType: WeaponType.Sniper, manufacturer: Manufacturer.Redline,
    element: Element.Kinetic, rollQuality: 75, baseDamage: 100, attackSpeed: 3,
    critChance: 0.15, critDamage: 1.5, statusChance: 0.1, statusDamage: 1,
    bossDamageMod: 1, waveDamageMod: 1, shieldDamageMod: 1, armorDamageMod: 1,
    offlineEarningsMod: 1, rareDropChanceMod: 1, scrapYieldMod: 1,
    parts: [], affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: 0, combatPower: 0, bossPower: 0, farmPower: 0, economyScore: 0,
    ...overrides,
  } as Weapon;
}

function makeShield(hp: number): Shield {
  return {
    id: 'matrix-shield', name: 'Matrix Shield', level: 50, rarity: Rarity.Rare,
    hp, rechargeRate: 0, mitigation: 0, element: Element.Kinetic, affixes: [],
    sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 0,
  } as Shield;
}

function makeOrdnance(element: Element): Ordnance {
  return {
    id: 'matrix-ordnance', name: 'Matrix Charge', level: 50, rarity: Rarity.Rare,
    damage: 0, shieldDamage: 300, armorDamage: 300, element,
    affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 0,
  } as unknown as Ordnance;
}

interface Kit { baseDamage: number; shieldDamageMod: number; armorDamageMod: number; shieldHp: number | null }
interface RunOpts { primaryElement: Element; sideElement: Element; skills: Record<string, number>; consumables: Record<string, number> }

function simKit(boss: BossDef, kit: Kit, opts: RunOpts): BossSimulationOutput {
  const gun = (element: Element) => makeWeapon({ element, baseDamage: kit.baseDamage, shieldDamageMod: kit.shieldDamageMod, armorDamageMod: kit.armorDamageMod });
  return simulateBoss({
    primary: gun(opts.primaryElement), secondary: gun(opts.sideElement), heavy: gun(opts.sideElement),
    ordnance: makeOrdnance(opts.primaryElement),
    shield: kit.shieldHp === null ? null : makeShield(kit.shieldHp),
    classMod: null, relic: null, consumables: opts.consumables,
    risk: RiskSetting.Balanced, boss, playerLevel: boss.level,
    skillBonuses: opts.skills, pityCount: 0, playerCredits: 0,
  } as BossSimulationInput);
}

/** Exact axis read: breakScore is min(shield, armor) axis, so
 * scaling one pool ×1000 and zeroing the other reads that axis. */
function axisScore(boss: BossDef, kit: Kit, opts: RunOpts, pool: 'shield' | 'armor'): number {
  if (pool === 'shield') {
    if (boss.shield <= 0) return 1;
    return simKit({ ...boss, shield: boss.shield * 1000, armor: 0 }, kit, opts).breakScore * 1000;
  }
  if (boss.armor <= 0) return 1;
  return simKit({ ...boss, shield: 0, armor: boss.armor * 1000 }, kit, opts).breakScore * 1000;
}

interface RowTargets { ttk: number; survival: number | null; shieldBreak: number; armorBreak: number }
const ROWS: Record<string, RowTargets> = {
  siltstalker: { ttk: 22, survival: 0.95, shieldBreak: 1.45, armorBreak: 1.45 },
  scrap_bishop: { ttk: 20, survival: null, shieldBreak: 1.45, armorBreak: 1.45 },
  ashgut: { ttk: 35, survival: 1.45, shieldBreak: 1.45, armorBreak: 1.45 },
  rust_prophet: { ttk: 35, survival: 1.15, shieldBreak: 1.45, armorBreak: 1.65 },
  verdant_maw: { ttk: 35, survival: 1.15, shieldBreak: 1.45, armorBreak: 1.65 },
};
const DEFAULT_ROW: RowTargets = { ttk: 35, survival: 1.15, shieldBreak: 1.45, armorBreak: 1.45 };

function matchedOpts(boss: BossDef): RunOpts {
  return {
    primaryElement: boss.id === 'mnemosyne_mirror' ? Element.Shock : boss.weaknesses[0],
    sideElement: boss.weaknesses[0],
    skills: boss.mechanic.requiredLoadoutTrait ? { [boss.mechanic.requiredLoadoutTrait]: (boss.mechanic.threshold || 0) + 0.05 } : {},
    consumables: { OrdnanceCharge: 3 },
  };
}

const ELEMENTS = [Element.Kinetic, Element.Fire, Element.Shock, Element.Corrosive, Element.Cryo, Element.Void];
function bruteOpts(boss: BossDef): RunOpts {
  const el = boss.id === 'mnemosyne_mirror'
    ? Element.Kinetic
    : ELEMENTS.find((e) => !boss.weaknesses.includes(e) && !boss.resistances.includes(e)) ?? Element.Kinetic;
  return { primaryElement: el, sideElement: el, skills: {}, consumables: { OrdnanceCharge: 3 } };
}

const DAMP = 0.7;
function solveKit(boss: BossDef, t: RowTargets, opts: RunOpts): Kit {
  const hunterHp = computeHunterMaxHp(boss.level, 0);
  const kit: Kit = {
    baseDamage: 100, shieldDamageMod: 1, armorDamageMod: 1,
    shieldHp: t.survival === null ? null : Math.max(200, Math.round(t.survival * boss.dps * 30 - hunterHp)),
  };
  for (let i = 0; i < 22; i++) {
    const out = simKit(boss, kit, opts);
    kit.baseDamage *= Math.pow(out.timeToKill / t.ttk, DAMP);
    if (t.survival !== null && kit.shieldHp !== null) {
      const pool = hunterHp + kit.shieldHp;
      kit.shieldHp = Math.max(200, Math.round(pool * Math.pow(t.survival / Math.max(0.05, out.survivalScore), DAMP) - hunterHp));
    }
    if (boss.shield > 0) {
      const ax = axisScore(boss, kit, opts, 'shield');
      kit.shieldDamageMod = Math.max(0.02, kit.shieldDamageMod * Math.pow(t.shieldBreak / Math.max(0.02, ax), DAMP));
    }
    if (boss.armor > 0) {
      const ax = axisScore(boss, kit, opts, 'armor');
      kit.armorDamageMod = Math.max(0.02, kit.armorDamageMod * Math.pow(t.armorBreak / Math.max(0.02, ax), DAMP));
    }
  }
  return kit;
}

const DEMAND: Record<string, 'shieldBreak' | 'armorBreak' | 'both-break' | 'survival' | 'dps' | null> = {
  heap_guard: 'shieldBreak', rust_prophet: 'armorBreak', verdant_maw: 'armorBreak',
  scrap_bishop: 'both-break', ashgut: 'survival', siltstalker: 'dps',
};

function bisect(read: () => number, set: (v: number) => void, lo: number, hi: number, target: number) {
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    set(mid);
    if (read() < target) lo = mid; else hi = mid;
  }
  set((lo + hi) / 2);
}

function bruteKit(boss: BossDef, matched: Kit): Kit {
  const kit: Kit = { ...matched };
  const opts = bruteOpts(boss);
  const demand = DEMAND[boss.id] ?? null;
  if (demand === 'shieldBreak' || demand === 'both-break') {
    bisect(() => axisScore(boss, kit, opts, 'shield'), (v) => { kit.shieldDamageMod = v; }, 0.02, Math.max(0.05, matched.shieldDamageMod), 0.8);
  }
  if (demand === 'armorBreak' || demand === 'both-break') {
    bisect(() => axisScore(boss, kit, opts, 'armor'), (v) => { kit.armorDamageMod = v; }, 0.02, Math.max(0.05, matched.armorDamageMod), 0.8);
  }
  if (demand === 'dps') {
    bisect(() => simKit(boss, kit, opts).dpsScore, (v) => { kit.baseDamage = v; }, matched.baseDamage * 0.4, matched.baseDamage * 1.8, 0.8);
  }
  if (demand === 'survival') {
    bisect(() => simKit(boss, kit, opts).survivalScore, (v) => { kit.shieldHp = Math.round(v); }, 200, Math.max(400, (matched.shieldHp ?? 0) * 1.6), 1.0);
  }
  return kit;
}

// Kits are solved once per boss and shared across the matrix tests.
const kitCache = new Map<string, { kit: Kit; mOpts: RunOpts; bKit: Kit; bOpts: RunOpts }>();
function rowFor(boss: BossDef) {
  let row = kitCache.get(boss.id);
  if (!row) {
    const mOpts = matchedOpts(boss);
    const kit = solveKit(boss, ROWS[boss.id] ?? DEFAULT_ROW, mOpts);
    row = { kit, mOpts, bKit: bruteKit(boss, kit), bOpts: bruteOpts(boss) };
    kitCache.set(boss.id, row);
  }
  return row;
}

// ── The matrix: baselines measured pre-C2 (master 86905872) ──────

interface MatrixRow { matchedPre: number; brutePre: number; brutePost: number; taxedByC2: boolean }
const MATRIX: Record<string, MatrixRow> = {
  dune_tyrant: { matchedPre: 0.8571, brutePre: 0.6593, brutePost: 0.6593, taxedByC2: false },
  siltstalker: { matchedPre: 0.98, brutePre: 0.7602, brutePost: 0.4983, taxedByC2: true },
  heap_guard: { matchedPre: 0.8571, brutePre: 0.5275, brutePost: 0.3727, taxedByC2: true },
  ashgut: { matchedPre: 0.8571, brutePre: 0.6593, brutePost: 0.4973, taxedByC2: true },
  mirage_duster: { matchedPre: 0.8571, brutePre: 0.2769, brutePost: 0.2769, taxedByC2: false },
  rust_prophet: { matchedPre: 0.8571, brutePre: 0.5275, brutePost: 0.3024, taxedByC2: true },
  scrap_bishop: { matchedPre: 0.9444, brutePre: 0.5812, brutePost: 0.3952, taxedByC2: true },
  spinneret_widow: { matchedPre: 0.8571, brutePre: 0.6528, brutePost: 0.6528, taxedByC2: false },
  mnemosyne_mirror: { matchedPre: 0.8571, brutePre: 0.6115, brutePost: 0.6115, taxedByC2: false },
  static_choir: { matchedPre: 0.8571, brutePre: 0.356, brutePost: 0.356, taxedByC2: false },
  verdant_maw: { matchedPre: 0.8571, brutePre: 0.5275, brutePost: 0.3024, taxedByC2: true },
  sister_null: { matchedPre: 0.8571, brutePre: 0.3364, brutePost: 0.3364, taxedByC2: false },
  vaultkeeper_omega: { matchedPre: 0.8571, brutePre: 0.6528, brutePost: 0.6528, taxedByC2: false },
};

describe('C2 archetype matrix — matched builds hold, taxed brutes fall', () => {
  for (const boss of REGION_1_BOSSES) {
    it(`${boss.name}: matched within ±5 of pre-C2; brute at its pinned post-C2 line`, () => {
      const expected = MATRIX[boss.id];
      const { kit, mOpts, bKit, bOpts } = rowFor(boss);
      const matched = simKit(boss, kit, mOpts);
      const brute = simKit(boss, bKit, bOpts);
      // The matched build answers the demand: the collected leg is 1.
      expect(matched.mechanicScore).toBe(1);
      // §(f): matched win chance within ±5 points of pre-C2 on
      // every boss (measured: 0.0 everywhere — no relief valve used).
      expect(Math.abs(matched.winChance - expected.matchedPre)).toBeLessThanOrEqual(0.05);
      expect(matched.winChance).toBeCloseTo(expected.matchedPre, 2);
      // The brute lands where the post-C2 sim puts it.
      expect(brute.winChance).toBeCloseTo(expected.brutePost, 2);
      if (expected.taxedByC2) {
        // §(f): ignoring a C2-collected demand costs ≥15 points
        // against the same build's pre-C2 price.
        expect(expected.brutePre - brute.winChance).toBeGreaterThanOrEqual(0.15);
        // …and the ignoring build stays under the ~65% cap.
        expect(brute.winChance).toBeLessThanOrEqual(0.65);
      } else {
        // Rows C2 does not tax (trait gates, ramp, adaptive) are
        // bit-stable: their legs were already real before C2.
        expect(brute.winChance).toBeCloseTo(expected.brutePre, 3);
      }
      // No new walls: the matched-vs-brute separation is ≥15
      // points on every row of the roster.
      expect(matched.winChance - brute.winChance).toBeGreaterThanOrEqual(0.15);
    });
  }
});

// ── Threshold truth: the leg is the ratio prep advertises ────────

/** A bare-belt run (no consumables) so mechanicScore reads the
 * pure leg — no shipped patch on top. */
function bareOpts(boss: BossDef): RunOpts {
  return { primaryElement: boss.weaknesses[0], sideElement: boss.weaknesses[0], skills: {}, consumables: {} };
}

/** Land one axis exactly on a target and return the run config.
 * Break/DPS axes bisect their gear knob (brackets widened well past
 * the target: a belt-less read carries no ordnance share, so the
 * matched kit's knob alone cannot reach it). Survival bisects a
 * boss-DPS multiplier on a def clone instead — the hunter's own HP
 * pool floors survivalScore near 1.0 on the real def, so low
 * survival targets are unreachable with a shield knob alone; the
 * leg divides the clone's score by the same threshold, so the
 * ratio truth is identical. Every landing is verified by re-reading
 * the axis from the returned config. */
function landRun(boss: BossDef, base: Kit, opts: RunOpts, pool: 'shield' | 'armor' | 'dps' | 'survival', target: number): { def: BossDef; kit: Kit } {
  const kit: Kit = { ...base };
  if (pool === 'shield') {
    bisect(() => axisScore(boss, kit, opts, 'shield'), (v) => { kit.shieldDamageMod = v; }, 0.02, Math.max(0.05, base.shieldDamageMod * 10), target);
    expect(axisScore(boss, kit, opts, 'shield')).toBeCloseTo(target, 2);
    return { def: boss, kit };
  }
  if (pool === 'armor') {
    bisect(() => axisScore(boss, kit, opts, 'armor'), (v) => { kit.armorDamageMod = v; }, 0.02, Math.max(0.05, base.armorDamageMod * 10), target);
    expect(axisScore(boss, kit, opts, 'armor')).toBeCloseTo(target, 2);
    return { def: boss, kit };
  }
  if (pool === 'dps') {
    bisect(() => simKit(boss, kit, opts).dpsScore, (v) => { kit.baseDamage = v; }, base.baseDamage * 0.2, base.baseDamage * 5, target);
    expect(simKit(boss, kit, opts).dpsScore).toBeCloseTo(target, 2);
    return { def: boss, kit };
  }
  let mult = 1;
  // Survival FALLS as the boss-DPS multiplier grows — the bisect
  // helper assumes an increasing read, so it walks the negated
  // score.
  bisect(
    () => -simKit({ ...boss, dps: boss.dps * mult }, kit, opts).survivalScore,
    (v) => { mult = v; },
    0.4, 5, -target,
  );
  const def: BossDef = { ...boss, dps: boss.dps * mult };
  expect(simKit(def, kit, opts).survivalScore).toBeCloseTo(target, 2);
  return { def, kit };
}

describe('C2 threshold truth — axis at threshold collects 1.0, at half collects 0.5', () => {
  const cases: Array<{ bossId: string; pool: 'shield' | 'armor' | 'dps' | 'survival'; threshold: number }> = [
    { bossId: 'heap_guard', pool: 'shield', threshold: 1.2 },
    { bossId: 'rust_prophet', pool: 'armor', threshold: 1.5 },
    { bossId: 'verdant_maw', pool: 'armor', threshold: 1.5 },
    { bossId: 'siltstalker', pool: 'dps', threshold: 1.3 },
    { bossId: 'ashgut', pool: 'survival', threshold: 1.4 },
  ];
  for (const c of cases) {
    it(`${c.bossId}: ${c.pool} at ${c.threshold} → 1.0; at half → 0.5`, () => {
      const boss = REGION_1_BOSSES.find((b) => b.id === c.bossId)!;
      const { kit } = rowFor(boss);
      const opts = bareOpts(boss);
      const atThreshold = landRun(boss, kit, opts, c.pool, c.threshold);
      expect(simKit(atThreshold.def, atThreshold.kit, opts).mechanicScore).toBeCloseTo(1, 3);
      const atHalf = landRun(boss, kit, opts, c.pool, c.threshold / 2);
      expect(simKit(atHalf.def, atHalf.kit, opts).mechanicScore).toBeCloseTo(0.5, 2);
    });
  }

  it("the Bishop's declared composite mirrors its phase targets", () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === 'scrap_bishop')!;
    const target = (type: string) => boss.phases.find((p) => p.type === type)?.targetValue;
    expect(boss.mechanic.composite).toEqual({
      shieldBreak: target('shieldBreak'),
      armorBreak: target('armorBreak'),
      dps: target('dps'),
    });
  });

  it('Scrap Bishop composite: all three axes at target → 1.0; one at half its target → 0.5', () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === 'scrap_bishop')!;
    const { kit } = rowFor(boss);
    const opts = bareOpts(boss);
    // Land all three demanded axes on the composite's targets with
    // a bare belt (no patch on top): the leg reads exactly 1.
    // Order matters: baseDamage moves every axis, so DPS lands
    // first; the break mods then move only their own axis.
    let landed = landRun(boss, kit, opts, 'dps', 1.35).kit;
    landed = landRun(boss, landed, opts, 'shield', 1.25).kit;
    landed = landRun(boss, landed, opts, 'armor', 1.25).kit;
    expect(simKit(boss, landed, opts).mechanicScore).toBeCloseTo(1, 3);
    const halved = landRun(boss, landed, opts, 'shield', 0.625).kit;
    expect(simKit(boss, halved, opts).mechanicScore).toBeCloseTo(0.5, 2);
  });

  it('the shipped patch applies AFTER collection: half-axis + Boss Scanner → 0.54', () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === 'heap_guard')!;
    const { kit } = rowFor(boss);
    const half = landRun(boss, kit, bareOpts(boss), 'shield', 0.6);
    const opts: RunOpts = { ...bareOpts(boss), consumables: { BossScanner: 1 } };
    expect(simKit(half.def, half.kit, opts).mechanicScore).toBeCloseTo(0.54, 3);
  });

  it('the Jammer rule still forces an enrage mechanic to 1', () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === 'siltstalker')!;
    const { kit } = rowFor(boss);
    const half = landRun(boss, kit, bareOpts(boss), 'dps', 0.65);
    const opts: RunOpts = { ...bareOpts(boss), consumables: { Jammer: 1 } };
    expect(simKit(half.def, half.kit, opts).mechanicScore).toBe(1);
  });

  it('Dune Tyrant stays demand-free (tutorial, by design)', () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === 'dune_tyrant')!;
    const { bKit, bOpts } = rowFor(boss);
    expect(simKit(boss, bKit, { ...bOpts, consumables: {} }).mechanicScore).toBe(1);
  });
});

// ── Endless bit-identity ──────────────────────────────────────────

function endlessFlat(depth: number, start: number, strong: boolean) {
  const enc = endlessEncounterForDepth(depth, start);
  const out = simulateBoss({
    primary: makeWeapon(strong ? { baseDamage: 400 } : {}),
    secondary: null, heavy: null, ordnance: null,
    shield: makeShield(strong ? 5000 : 2000),
    classMod: null, relic: null, consumables: {},
    risk: RiskSetting.Balanced, boss: enc.def, playerLevel: enc.level,
    skillBonuses: {}, pityCount: 0, playerCredits: 0,
  } as BossSimulationInput);
  return { enc, out };
}

describe('C2 Endless bit-identity — the Chamber never collects a threshold', () => {
  it('generated boss-depth defs carry the mechanic without its threshold or composite (trait gates intact)', () => {
    const heap = endlessEncounterForDepth(15, 20);
    expect(heap.def.mechanic.id).toBe('shield_regen');
    expect(heap.def.mechanic.threshold).toBeUndefined();
    const bishop = endlessEncounterForDepth(35, 20);
    expect(bishop.def.mechanic.id).toBe('three_phase');
    expect(bishop.def.mechanic.composite).toBeUndefined();
    const mirage = endlessEncounterForDepth(25, 20);
    expect(mirage.def.mechanic.requiredLoadoutTrait).toBeTruthy();
    expect(mirage.def.mechanic.threshold).toBeGreaterThan(0);
  });

  it('flat fixtures reproduce the pre-C2 Chamber numbers exactly', () => {
    expect(endlessFlat(15, 20, false).out.winChance).toBeCloseTo(0.072185, 5);
    expect(endlessFlat(20, 20, false).out.winChance).toBeCloseTo(0.059335, 5);
    expect(endlessFlat(30, 20, false).out.winChance).toBeCloseTo(0.02, 5);
    expect(endlessFlat(55, 20, false).out.winChance).toBeCloseTo(0.02, 5);
  });

  it('strong fixtures (off the floor, leak-discriminating) reproduce pre-C2 numbers', () => {
    expect(endlessFlat(15, 20, true).out.winChance).toBeCloseTo(0.288739, 4);
    expect(endlessFlat(20, 20, true).out.winChance).toBeCloseTo(0.237342, 4);
    expect(endlessFlat(30, 20, true).out.winChance).toBeCloseTo(0.072426, 4);
    expect(endlessFlat(35, 20, true).out.winChance).toBeCloseTo(0.023945, 4);
  });
});

// ── CryoAmmo: the dropped re-read leaves the flat read standing ──

describe('C2 CryoAmmo — parity gate failed, flat read stands (ruling D6)', () => {
  it('CryoAmmo still prices survival at ×1.15 on a matrix row', () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === 'heap_guard')!;
    const { kit, mOpts } = rowFor(boss);
    const bare = simKit(boss, kit, mOpts);
    const cryo = simKit(boss, kit, { ...mOpts, consumables: { ...mOpts.consumables, CryoAmmo: 1 } });
    // The cadence re-read measured 1.0000 here (rate-0 shield: the
    // slowed rhythm restores nothing) against this 1.1500 — a ~13
    // point parity failure, so the re-read was dropped, not shipped.
    expect(cryo.survivalScore / bare.survivalScore).toBeCloseTo(1.15, 3);
  });
});
