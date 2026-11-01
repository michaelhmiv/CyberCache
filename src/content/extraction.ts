/**
 * Extraction — the gathering occupation (migration 0033).
 *
 * Extraction is a PERSONAL ACTION SLOT occupation, the supply lane of
 * the crafter economy: the hunter works a roaming area's ground —
 * digging, sifting, scanning — and comes back with the SAME material
 * finds roaming drops as a byproduct, at a dedicated gatherer's rate.
 * It exists because the crafting economy (0024) eats materials that
 * roaming only drips; a dedicated gatherer is a real specialization.
 *
 * THE LAWS (extraction-occupation brief, ruled 2026-10-31):
 *  - ONE ACTION AT A TIME. Extraction holds the personal slot like
 *    crafting: starting it settles the outgoing action, and its
 *    progress accrues ONLY while extraction is the active action —
 *    settled server-side at transitions, state reads, and offline
 *    settlement under the SAME window math + AFK cap as crafting
 *    (migration 0024's settler is the template; no special-casing).
 *  - THE PASS. Work is priced in 10-minute passes at one site (area +
 *    method). Passes complete back-to-back while active; accrued
 *    time carries across pauses; a site/method change takes effect
 *    at the NEXT pass boundary — the in-progress pass finishes on
 *    the terms it started on.
 *  - YIELD. Each completed pass performs draws against the area's
 *    SHIPPED find pool (`rollAreaMaterialFind`: base materials at
 *    weight 2, essences at 3 in their home area / 0.75 as guests) at
 *    192 draws/hour at full rate — twice roaming's ~96 finds/hour
 *    byproduct drip, because gathering is the whole job. Material
 *    draws in a signature material's HOME area substitute the Tier-2
 *    signature at `extractSignatureChance` (the roaming rule, on
 *    extraction's own lever). Finds are materials + essences ONLY:
 *    no gear, no legendaries, no credits, no scrap, no fragments,
 *    no cores, no events/elites. Vehicles do NOT apply in v1.
 *  - THE GEAR FACTOR. Yield scales with how safely the hunter can
 *    work the site: `gearFactor = clamp(pool / (pool +
 *    expectedPassDamage), floor, 1)` where pool is the one HP
 *    formula's max HP plus shield capacity, and expectedPassDamage
 *    is one pass of the area roster's expected hits through the
 *    shipped monster-damage contract (damageContract.ts). It is
 *    computed at SETTLEMENT from server records — gear swapped
 *    mid-pass reprices the unfinished pass (deliberate: the pass
 *    pays for the work as it can be done at completion).
 *  - XP PEG. `passXp = round((1/6) x benchmarkXpPerHour(level) x
 *    extractXpRate)` — the crafting peg machinery (§2.3 of 0024) at
 *    the ruled 0.75 rate, lever-clamped to the occupations band
 *    [0.70, 0.85] in the accessor AND the SQL twin. Cache Rank's
 *    Fast Learner composes on top exactly once, as everywhere.
 *  - DEEP DELVE. A second method: mastery `gathering.extraction`
 *    >= 5 AND a settlement-time gear factor >= 0.80 unlock the
 *    `extractDeepYieldMult` (1.5x) draw rate — 288 draws/hour. A
 *    deep pass that settles below the gate pays as Surface, and the
 *    state read says why. Selecting Deep with mastery < 5 is
 *    refused at the start gate.
 *  - MASTERY. Every completed pass grants 20 XP to the
 *    `gathering.extraction` track; mastery widens yield by
 *    `extractMasteryYieldPerLevel` per level past 1 (cap +25%):
 *    specialization must be real.
 *  - GATES. Verified accounts only (guests are refused at start —
 *    extraction feeds the player economy), no starting while a
 *    death record stands, and the site must be unlocked.
 *
 * This module is the content owner: levers, pass math, the gear
 * factor, and the preview numbers the state route serves. The SQL
 * twins live in migration 0033 and are pinned equal by tests.
 */
import { ROAMING_AREAS, getRoamingArea, rollAreaMaterialFind, type RoamingAreaDef } from '../constants/roamingAreas';
import { resolveAreaMonsters } from '../lib/combat/areaMonsterSelector';
import { computeHunterMaxHp } from '../lib/combat/damageContract';
import { signatureMaterialForArea } from './roamingEvents';
import { benchmarkXpPerHour } from './crafting';
import { HOT_AREA_MATERIAL_BONUS } from './hotArea';
import { MaterialType, EssenceType } from '../types/game';

// ─── Shape ───────────────────────────────────────────────────────────

/** One extraction pass: 10 minutes of work at one site. */
export const EXTRACTION_PASS_MS = 600_000;
/** Roaming ticks inside one pass (the shipped 3-second tick). */
export const EXTRACTION_TICKS_PER_PASS = EXTRACTION_PASS_MS / 3000;

/** The mastery track extraction feeds (migration 0033 seed row). */
export const EXTRACTION_MASTERY_TRACK = 'gathering.extraction';
/** Mastery XP per completed pass (the definition's xp_per_unit). */
export const EXTRACTION_MASTERY_XP_PER_PASS = 20;
/** Mastery level Deep Delve requires. */
export const EXTRACTION_DEEP_MASTERY_LEVEL = 5;
/** Settlement-time gear factor Deep Delve requires. */
export const EXTRACTION_DEEP_GEAR_FACTOR = 0.8;

export type ExtractionMethod = 'surface' | 'deep';

export const EXTRACTION_METHODS: readonly ExtractionMethod[] = ['surface', 'deep'];

export function isExtractionMethod(value: unknown): value is ExtractionMethod {
  return value === 'surface' || value === 'deep';
}

// ─── Levers ──────────────────────────────────────────────────────────

export interface ExtractionLeverValues {
  /** XP peg vs roaming's benchmark (occupations band, HARD clamp). */
  extractXpRate: number;
  /** Draws per hour at factor 1, Surface, mastery 1, non-hot. */
  extractFindsPerHour: number;
  /** Signature substitution chance for material draws in the home area. */
  extractSignatureChance: number;
  /** Deep Delve draw multiplier. */
  extractDeepYieldMult: number;
  /** Lowest the gear factor can price a pass. */
  extractGearFactorFloor: number;
  /** Yield bonus per mastery level past 1. */
  extractMasteryYieldPerLevel: number;
}

export const EXTRACTION_LEVER_DEFAULTS: ExtractionLeverValues = {
  extractXpRate: 0.75,
  extractFindsPerHour: 192,
  extractSignatureChance: 0.15,
  extractDeepYieldMult: 1.5,
  extractGearFactorFloor: 0.4,
  extractMasteryYieldPerLevel: 0.005,
};

export const EXTRACTION_LEVER_CLAMPS: Record<keyof ExtractionLeverValues, { min: number; max: number; integer: boolean }> = {
  // The [0.70, 0.85] band is Michael's occupations law (DECISIONS R2):
  // the clamp lives here AND in cc_extract_pass_xp's caller-side SQL
  // clamp, so neither twin can leave the band.
  extractXpRate: { min: 0.7, max: 0.85, integer: false },
  extractFindsPerHour: { min: 48, max: 480, integer: true },
  extractSignatureChance: { min: 0, max: 0.4, integer: false },
  extractDeepYieldMult: { min: 1, max: 2.5, integer: false },
  extractGearFactorFloor: { min: 0, max: 1, integer: false },
  extractMasteryYieldPerLevel: { min: 0, max: 0.02, integer: false },
};

/** Resolve lever values from a raw economy-config snapshot: stored
 *  values win when finite, everything clamps to the hard ranges. */
export function resolveExtractionLevers(values?: Partial<Record<string, unknown>> | null): ExtractionLeverValues {
  const out = { ...EXTRACTION_LEVER_DEFAULTS };
  if (values) {
    (Object.keys(EXTRACTION_LEVER_DEFAULTS) as Array<keyof ExtractionLeverValues>).forEach((key) => {
      const raw = values[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        const clamp = EXTRACTION_LEVER_CLAMPS[key];
        const clamped = Math.min(clamp.max, Math.max(clamp.min, raw));
        out[key] = clamp.integer ? Math.trunc(clamped) : clamped;
      }
    });
  }
  return out;
}

// ─── Find pool identity ──────────────────────────────────────────────

/** The material ids an extraction find may credit (the 20-id
 *  MaterialType space; the SQL applier validates against the same
 *  list, pinned by tests). */
export const EXTRACTION_MATERIAL_IDS: readonly string[] = Object.values(MaterialType);
/** The essence ids an extraction find may credit. */
export const EXTRACTION_ESSENCE_IDS: readonly string[] = Object.values(EssenceType);

/** One pass's rolled outcome before persistence. */
export interface ExtractionPassFinds {
  materials: Record<string, number>;
  essences: Record<string, number>;
  /** Total draws performed (after the factor composition rounded). */
  draws: number;
  /** Signature-material units substituted this pass (display + meter of quality). */
  signatureUnits: number;
}

// ─── Gear factor ─────────────────────────────────────────────────────

/** The shield facts the gear factor prices (from server records). */
export interface ExtractionShieldFacts {
  hp: number;
  mitigation: number;
  element?: string | null;
}

/**
 * Expected damage from ONE monster hit through the shipped contract,
 * as an expectation: accuracy is the hit probability (dodge is 0 —
 * the roaming claim's hunter carries none), variance sits at its
 * mean (1.0), the element term is the contract's shield-element
 * match resist, mitigation is the contract's 80%-capped reduction,
 * and shield behaviors are not priced (Absorb/Nova only help the
 * hunter; the standard path is the honest expectation).
 */
export function expectedMonsterHitDamage(
  monster: { attackPower: number; accuracy?: number; element?: string | null },
  shield: ExtractionShieldFacts | null,
): number {
  const accuracy = monster.accuracy ?? 0.85;
  let elementalResist = 0;
  if (shield?.element && monster.element && shield.element === monster.element) {
    elementalResist += 0.15;
  }
  const elementMult = monster.element ? Math.max(0.1, 1 - elementalResist) : 1;
  const mitigation = Math.min(0.8, shield?.mitigation ?? 0);
  return accuracy * monster.attackPower * elementMult * (1 - mitigation);
}

/** Expected total damage over one pass (200 ticks) at a site: the
 *  roster's weighted per-tick expectation, via resolveAreaMonsters —
 *  the same roster + weights pickAreaMonster draws attackers from. */
export function expectedPassDamage(area: RoamingAreaDef, shield: ExtractionShieldFacts | null): number {
  const roster = resolveAreaMonsters(area);
  if (roster.length === 0) return 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const monster of roster) {
    const w = area.monsterWeights?.[monster.id] ?? 1.0;
    weighted += w * expectedMonsterHitDamage(monster, shield);
    totalWeight += w;
  }
  if (totalWeight <= 0) return 0;
  return (weighted / totalWeight) * EXTRACTION_TICKS_PER_PASS;
}

/** The survivability pool: the one HP formula (max HP already
 *  includes the shield's HP) plus the shield's capacity on top —
 *  the brief's pool definition. */
export function extractionSurvivalPool(level: number, shield: ExtractionShieldFacts | null): number {
  const shieldHp = Math.max(0, Math.floor(shield?.hp ?? 0));
  return computeHunterMaxHp(Math.max(1, Math.floor(level) || 1), shieldHp) + shieldHp;
}

/**
 * gearFactor = clamp(pool / (pool + expectedPassDamage), floor, 1).
 * A hunter who would shrug off the site's whole pass of attention
 * prices at 1.0; a hunter the site would chew through prices toward
 * the floor — never to zero: gathering under fire is slow, not
 * impossible.
 */
export function extractionGearFactor(input: {
  level: number;
  shield: ExtractionShieldFacts | null;
  area: RoamingAreaDef;
  levers: ExtractionLeverValues;
}): number {
  const pool = extractionSurvivalPool(input.level, input.shield);
  const expected = expectedPassDamage(input.area, input.shield);
  if (expected <= 0) return 1;
  const raw = pool / (pool + expected);
  return Math.min(1, Math.max(input.levers.extractGearFactorFloor, raw));
}

// ─── Pass math ───────────────────────────────────────────────────────

/** Mastery yield multiplier: 1 + perLevel x (level - 1), hard-capped
 *  at +25% however the lever moves (the brief's cap). */
export function extractionMasteryYield(masteryLevel: number, levers: ExtractionLeverValues): number {
  const levels = Math.max(0, Math.floor(masteryLevel) - 1);
  return Math.min(1.25, 1 + levers.extractMasteryYieldPerLevel * levels);
}

/** Hot-area factor: the shipped +20% material bonus as a yield
 *  multiplier when the site is today's hot area. */
export function extractionHotFactor(isHot: boolean, hotAreaMaterialBonus: number = HOT_AREA_MATERIAL_BONUS): number {
  return isHot ? 1 + hotAreaMaterialBonus : 1;
}

export interface ExtractionDrawMath {
  draws: number;
  gearFactor: number;
  masteryYield: number;
  methodYield: number;
  hotFactor: number;
  /** True when a Deep pass priced below the 0.80 gate and paid as Surface. */
  deepDegraded: boolean;
}

/**
 * The draw count for one settling pass — the composition the brief
 * fixes: base draws (finds/hour over a 10-minute pass) x gear factor
 * x method yield x mastery yield x hot factor, rounded once.
 */
export function extractionPassDraws(input: {
  method: ExtractionMethod;
  masteryLevel: number;
  gearFactor: number;
  isHot: boolean;
  levers: ExtractionLeverValues;
  hotAreaMaterialBonus?: number;
}): ExtractionDrawMath {
  const levers = input.levers;
  const deepPays = input.method === 'deep' && input.gearFactor >= EXTRACTION_DEEP_GEAR_FACTOR;
  const methodYield = deepPays ? levers.extractDeepYieldMult : 1;
  const masteryYield = extractionMasteryYield(input.masteryLevel, levers);
  const hotFactor = extractionHotFactor(input.isHot, input.hotAreaMaterialBonus);
  const baseDraws = (levers.extractFindsPerHour * EXTRACTION_PASS_MS) / 3_600_000;
  const draws = Math.max(
    0,
    Math.round(baseDraws * input.gearFactor * methodYield * masteryYield * hotFactor),
  );
  return {
    draws,
    gearFactor: input.gearFactor,
    masteryYield,
    methodYield,
    hotFactor,
    deepDegraded: input.method === 'deep' && !deepPays,
  };
}

/** XP for ONE completed pass at the level held at completion — the
 *  crafting peg at extraction's rate: (1/6) x benchmark x rate. The
 *  SQL twin is cc_extract_pass_xp (migration 0033); parity is pinned
 *  by tests. Cache Rank composes OUTSIDE this function, once. */
export function extractionPassXp(levelAtCompletion: number, levers: ExtractionLeverValues): number {
  return Math.round((EXTRACTION_PASS_MS / 3_600_000) * benchmarkXpPerHour(levelAtCompletion) * levers.extractXpRate);
}

/** Whether Deep Delve may be SELECTED (start gate): mastery only.
 *  The gear gate is a settlement-time pricing rule, never a
 *  selection rule — gear changes too easily to lock a player out. */
export function canSelectDeepDelve(masteryLevel: number): boolean {
  return Math.floor(masteryLevel) >= EXTRACTION_DEEP_MASTERY_LEVEL;
}

// ─── Pass rolling ────────────────────────────────────────────────────

export interface ExtractionRollStreams {
  /** Main per-draw stream (seeded per player + pass index). */
  main: () => number;
  /** Signature substitution stream (chef's `:signature` pattern). */
  signature: () => number;
  /** Scavenger lootQuantity stream — rolled per find, only when the
   *  bonus is positive (the chef's gating keeps streams identical
   *  for players without the nodes). */
  lootQuantity: () => number;
}

/**
 * Roll one pass's finds against the area's shipped pool. Draw-for-
 * draw the pool identity is `rollAreaMaterialFind` itself — the
 * parity test compares distributions against it. Signature
 * substitution follows roaming's rule exactly: only MATERIAL-kind
 * draws, only when the rolled area IS the signature's home (the
 * pool is rolled at the site, so a signature can only substitute at
 * home by construction), on its own stream, at extraction's own
 * lever chance.
 */
export function rollExtractionPass(
  area: RoamingAreaDef,
  draws: number,
  streams: ExtractionRollStreams,
  levers: ExtractionLeverValues,
  lootQuantityBonus: number,
): ExtractionPassFinds {
  const materials: Record<string, number> = {};
  const essences: Record<string, number> = {};
  let signatureUnits = 0;
  const signature = signatureMaterialForArea(area.id);
  for (let i = 0; i < draws; i += 1) {
    const find = rollAreaMaterialFind(area, streams.main);
    if (!find) continue;
    let type = find.type;
    const kind = find.kind;
    let substituted = false;
    if (kind === 'material' && signature) {
      if (streams.signature() < levers.extractSignatureChance) {
        type = signature.materialId;
        substituted = true;
      }
    }
    let quantity = 1;
    if (lootQuantityBonus > 0 && streams.lootQuantity() < lootQuantityBonus) {
      quantity += 1;
    }
    if (substituted) signatureUnits += quantity;
    if (kind === 'material') {
      materials[type] = (materials[type] ?? 0) + quantity;
    } else {
      essences[type] = (essences[type] ?? 0) + quantity;
    }
  }
  return { materials, essences, draws, signatureUnits };
}

// ─── Preview (state-read display math) ───────────────────────────────

export interface ExtractionPreview {
  areaId: string;
  areaName: string;
  method: ExtractionMethod;
  /** Live gear factor at the site with the current loadout. */
  gearFactor: number;
  /** The factor's cause, left side: HP + shield capacity pool. */
  survivalPool: number;
  /** The factor's cause, right side: expected damage over one pass. */
  expectedPassDamage: number;
  /** Draws a pass settling right now would perform. */
  drawsPerPass: number;
  /** XP a pass settling right now would award (before Cache Rank). */
  xpPerPass: number;
  deepDegraded: boolean;
  deepUnlocked: boolean;
  isHot: boolean;
}

/** The preview numbers the state route serves — computed from the
 *  content owner over server facts, never the request. */
export function extractionPreview(input: {
  areaId: string;
  method: ExtractionMethod;
  level: number;
  masteryLevel: number;
  shield: ExtractionShieldFacts | null;
  isHot: boolean;
  levers: ExtractionLeverValues;
  hotAreaMaterialBonus?: number;
}): ExtractionPreview {
  const area = getRoamingArea(input.areaId);
  const gearFactor = extractionGearFactor({ level: input.level, shield: input.shield, area, levers: input.levers });
  const math = extractionPassDraws({
    method: input.method,
    masteryLevel: input.masteryLevel,
    gearFactor,
    isHot: input.isHot,
    levers: input.levers,
    hotAreaMaterialBonus: input.hotAreaMaterialBonus,
  });
  return {
    areaId: area.id,
    areaName: area.name,
    method: input.method,
    gearFactor,
    survivalPool: extractionSurvivalPool(input.level, input.shield),
    expectedPassDamage: Math.round(expectedPassDamage(area, input.shield)),
    drawsPerPass: math.draws,
    xpPerPass: extractionPassXp(input.level, input.levers),
    deepDegraded: math.deepDegraded,
    deepUnlocked: canSelectDeepDelve(input.masteryLevel),
    isHot: input.isHot,
  };
}

export function roamingAreaById(areaId: string): RoamingAreaDef {
  return ROAMING_AREAS.find((a) => a.id === areaId) ?? getRoamingArea(areaId);
}
