/**
 * Workshop readiness derivation (Direction A — "Make-now first",
 * owner-approved 2026-11-03).
 *
 * Pure display derivation: given a recipe and the player's live
 * state (balances, benches, mastery levels, standing ranks, research
 * completions, active jobs), this module answers the three questions
 * the redesigned Workshop is built on:
 *
 *   1. Can this be queued right now?      → 'craftable'
 *   2. Is exactly ONE family of gates in  → 'one-gate'
 *      the way?
 *   3. Are two or more gate families in   → 'locked'
 *      the way?
 *
 * A "gate family" is one independent kind of blocker: player level,
 * bench ownership, mastery, research, manufacturer standing, the
 * material bill (ALL shortages together count once — the mock's
 * Weapon Frame is one gate away with three materials short, while
 * Calibration Core is Locked with level + materials), the bench
 * queue, or tool ownership. The classification counts families, not
 * individual failures, and every failing gate is still PRINTED on
 * the card (the all-gates rule) — classification never hides a gate.
 *
 * This module computes no gameplay outcomes: no timers, no rolls,
 * no payouts. It mirrors the enqueue gates the Chef enforces
 * (src/server/writes/craftEngine.ts) so the card can name them
 * before the tap; the server remains the authority and re-checks
 * every one at enqueue.
 */
import {
  CRAFT_BENCHES,
  EPIC_FRAME_GEAR_MASTERY,
  QUEUED_JOBS_PER_BENCH,
  catalystForRecipe,
  craftQualityBounds,
  craftRelicByName,
  isMaterialInput,
  refineOutputRange,
  REFINE_BASE_YIELD_DEFAULT,
  type CraftRecipe,
} from '@/content/crafting';
import { resolvedRecipeInputs } from './recipeCosts';
import { CONSUMABLES, getConsumableQualityBand } from '@/constants/consumables';
import { RESEARCH_COURSES } from '@/content/research';
import { SKIN_PARTS } from '@/content/skins';
import { getVisualAsset } from '@/constants/visualAssets';
import { Rarity } from '@/types/game';

/** Jobs that may sit on one bench at BASELINE: 1 running + the
 *  queued line. Banked bench time (Econ 10) widens the envelope —
 *  the Workshop feeds the server's live capacity through
 *  WorkshopPlayerContext.benchCapacity when it has one. */
export const BENCH_JOB_CAPACITY = 1 + QUEUED_JOBS_PER_BENCH;

/** Mastery track ids → the names players read. One label owner. */
export const MASTERY_TRACK_LABELS: Record<string, string> = {
  crafting_consumables: 'Consumables',
  'crafting.refining': 'Refining',
  'crafting.gear': 'Gear',
  'crafting.cosmetics': 'Cosmetics',
};

export function masteryTrackLabel(track: string): string {
  return MASTERY_TRACK_LABELS[track] ?? track.replace(/^crafting[._]/, '').replace(/^\w/, (c) => c.toUpperCase());
}

/** The mastery track whose level prices a recipe kind's quality. */
export function masteryTrackForRecipe(recipe: CraftRecipe): string {
  if (recipe.kind === 'refine') return 'crafting.refining';
  if (recipe.kind === 'gear') return 'crafting.gear';
  if (recipe.kind === 'cosmetic') return 'crafting.cosmetics';
  return 'crafting_consumables';
}

/** Display label for a recipe input id ('Scrap' is a balance, not a material). */
export function inputLabel(key: string): string {
  return key === 'Scrap' ? 'Scrap' : getVisualAsset('material', key).label;
}

/** The player's live state the readiness derivation reads. */
export interface WorkshopPlayerContext {
  playerLevel: number;
  scrap: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
  consumables: Record<string, number>;
  benchesOwned: number;
  masteries: Record<string, { level: number; xp: number }>;
  standingRanks: Record<string, number>;
  /**
   * Completed research course ids, or null when the Chef read has
   * not landed / failed — research-gated recipes stay locked either
   * way (never optimistically open).
   */
  researchCompletedIds: ReadonlySet<string> | null;
  /** Active (running/queued/paused) jobs, for queue checks. */
  activeJobs: Array<{ bench: number; recipeId: string }>;
  /**
   * Econ 7 (brief §4.4): the server's resolved per-recipe Scrap
   * costs from the Workshop snapshot. Material-shortage math runs
   * off the RESOLVED bill so a card never calls a recipe
   * unaffordable at a price the server no longer charges (or vice
   * versa). Absent = content literals, the pre-lever behavior.
   */
  recipeScrapCosts?: Record<string, number>;
  /**
   * Econ 10 (brief §8.3): the bench's live job capacity from the
   * Workshop snapshot — the server's benchEnvelope for this player
   * (banked bench time widens it from the baseline 6 to 18, the
   * Fixer queue bonus included in the server's figure). Absent =
   * the baseline constant, the pre-slice behavior.
   */
  benchCapacity?: number;
}

export type GateFamily =
  | 'level'
  | 'bench'
  | 'mastery'
  | 'research'
  | 'standing'
  | 'materials'
  | 'queue'
  | 'ticket';

export type GateDoor = 'research' | 'repdesk';

export interface RecipeGate {
  family: GateFamily;
  met: boolean;
  /** Short name the disabled-CTA summary uses for this gate. */
  summary?: string;
  /** Player words; failing gates carry their remedy in the line. */
  label: string;
  door?: GateDoor;
}

export interface InputShortage {
  key: string;
  label: string;
  have: number;
  need: number;
  short: number;
}

export type RecipeClassification = 'craftable' | 'one-gate' | 'locked';

export interface RecipeEvalOptions {
  units?: number;
  /** Gear frames only; defaults to Common. */
  rarity?: string;
  /** Defaults to the lowest bench that could run the recipe. */
  bench?: number;
  useCatalyst?: boolean;
  useRushTicket?: boolean;
}

export interface RecipeReadiness {
  classification: RecipeClassification;
  /** Distinct failing families, in gate order. */
  blockerFamilies: GateFamily[];
  /** Every gate the recipe carries — met ones included. */
  gates: RecipeGate[];
  shortages: InputShortage[];
  /** The bench the evaluated configuration would run on. */
  bench: number;
  rarity: string | null;
  canEnqueue: boolean;
  /** CTA text when the job cannot queue ('' when it can). */
  disabledSummary: string;
}

export function masteryLevel(ctx: WorkshopPlayerContext, track: string): number {
  return ctx.masteries[track]?.level ?? 1;
}

function haveFor(ctx: WorkshopPlayerContext, key: string): number {
  // Econ 5 (0069): 'Scrap' is a material key — the one stock is
  // ctx.materials['Scrap'] (ctx.scrap mirrors it from the profile).
  return isMaterialInput(key) ? (ctx.materials[key] ?? 0) : (ctx.essences[key] ?? 0);
}

/** The default queue configuration a card opens with. */
export function defaultEvalOptions(recipe: CraftRecipe): Required<RecipeEvalOptions> {
  return {
    units: 1,
    rarity: recipe.kind === 'gear' ? Rarity.Common : '',
    bench: 0, // 0 = derive
    useCatalyst: false,
    useRushTicket: false,
  };
}

function summaryPart(family: GateFamily, gates: RecipeGate[], shortages: InputShortage[]): string {
  switch (family) {
    case 'level':
      return 'level';
    case 'bench':
      return 'the bench';
    case 'mastery':
      return 'mastery';
    case 'research':
      return 'research';
    case 'standing':
      return 'standing';
    case 'materials':
      return shortages.length === 1 ? '1 material' : 'materials';
    case 'queue':
      return 'bench queue full';
    case 'ticket':
      return 'a Rush Ticket';
  }
}

/**
 * Evaluate one recipe against the player's live state. With no
 * options this is the card's opening configuration (1 unit, Common
 * for frames, no catalyst, no rush ticket, best available bench) —
 * the configuration the section classification and the craftable
 * count are computed from, so the chip, the sections, and the cards
 * can never disagree.
 */
export function deriveRecipeReadiness(
  recipe: CraftRecipe,
  ctx: WorkshopPlayerContext,
  opts: RecipeEvalOptions = {},
): RecipeReadiness {
  const units = Math.max(1, Math.floor(opts.units ?? 1));
  const isGear = recipe.kind === 'gear';
  const rarity = isGear ? (opts.rarity ?? Rarity.Common) : null;
  // Bench collapse (slice 9): ONE bench, always owned, and every
  // recipe's requiresBench is 1 — the bench is a constant of the
  // workshop, not a choice. (Econ 10 widens its envelope — running
  // + queued — never its count.)
  const bench = 1;

  const gates: RecipeGate[] = [];
  const shortages: InputShortage[] = [];

  // Level — always printed (met or not) on a gated card.
  gates.push({
    family: 'level',
    met: ctx.playerLevel >= recipe.requiresLevel,
    label:
      ctx.playerLevel >= recipe.requiresLevel
        ? `Level ${recipe.requiresLevel} — met`
        : `Level ${recipe.requiresLevel} — yours is ${ctx.playerLevel}`,
  });

  // Bench — met by construction since the collapse: one bench,
  // always owned. The gate line stays so the card's checklist keeps
  // its shape and says the true thing.
  const benchOwned = true;
  gates.push({
    family: 'bench',
    met: true,
    label: 'The bench — ready',
  });

  // Mastery — the recipe's own gate, with the player's standing.
  if (recipe.requiresMastery) {
    const track = recipe.requiresMastery.track;
    const current = masteryLevel(ctx, track);
    const met = current >= recipe.requiresMastery.level;
    gates.push({
      family: 'mastery',
      met,
      label: met
        ? `Mastery — ${masteryTrackLabel(track)} ${recipe.requiresMastery.level} — met (yours is ${current})`
        : `Mastery — ${masteryTrackLabel(track)} ${recipe.requiresMastery.level}. Yours is ${current}. Every finished ${masteryTrackLabel(track).toLowerCase()} job raises it.`,
    });
  }

  // Epic frames carry a second, rarity-priced mastery gate.
  if (isGear && rarity === Rarity.Epic) {
    const current = masteryLevel(ctx, 'crafting.gear');
    const met = current >= EPIC_FRAME_GEAR_MASTERY;
    gates.push({
      family: 'mastery',
      met,
      label: met
        ? `Epic frames — Gear mastery ${EPIC_FRAME_GEAR_MASTERY} — met (yours is ${current})`
        : `Epic frames need Gear mastery ${EPIC_FRAME_GEAR_MASTERY}. Yours is ${current}.`,
    });
  }

  // Research — completion is a server fact; unknown reads as locked.
  if (recipe.requiresResearch) {
    const course = RESEARCH_COURSES.find((c) => c.id === recipe.requiresResearch);
    const courseName = course?.name ?? 'Production Systems';
    const met = ctx.researchCompletedIds?.has(recipe.requiresResearch) === true;
    gates.push({
      family: 'research',
      met,
      label: met
        ? `Research — ${courseName} complete`
        : `Research — ${courseName} not taken. Finish the course and this unlocks:`,
      door: met ? undefined : 'research',
    });
  }

  // Manufacturer standing — rank held vs rank demanded.
  if (recipe.requiresStanding) {
    const { manufacturer, rank } = recipe.requiresStanding;
    const held = ctx.standingRanks[manufacturer] ?? 0;
    const met = held >= rank;
    gates.push({
      family: 'standing',
      met,
      label: met
        ? `${manufacturer} Standing Rank ${rank} — met (yours is Rank ${held})`
        : `${manufacturer} Standing Rank ${rank} — yours is Rank ${held}. Earn it at the Rep Desk:`,
      door: met ? undefined : 'repdesk',
    });
  }

  // Materials — every shortage, counted as ONE family. Econ 7: the
  // bill is the RESOLVED one (the Scrap leg at its lever value).
  for (const [key, per] of Object.entries(resolvedRecipeInputs(recipe, ctx.recipeScrapCosts))) {
    const need = per * units;
    const have = haveFor(ctx, key);
    if (have < need) shortages.push({ key, label: inputLabel(key), have, need, short: need - have });
  }
  const catalystId = catalystForRecipe(recipe);
  if (opts.useCatalyst && catalystId) {
    const have = ctx.materials[catalystId] ?? 0;
    if (have < units) {
      shortages.push({ key: catalystId, label: inputLabel(catalystId), have, need: units, short: units - have });
    }
    if (bench < 2) {
      gates.push({ family: 'bench', met: false, label: 'Catalysts need the Forge (Bench 2).', summary: 'the Forge (catalyst)' });
    }
  }
  if (shortages.length > 0) {
    gates.push({
      family: 'materials',
      met: false,
      label:
        shortages.length === 1
          ? `Missing ${shortages[0].label} ×${shortages[0].short} — its source is on its line above`
          : `Short on ${shortages.length} materials — every source is on its line above`,
    });
  }

  // Rush ticket — an escrow the player must actually hold.
  if (opts.useRushTicket && (ctx.consumables['WorkshopRushTicket'] ?? 0) < 1) {
    gates.push({
      family: 'ticket',
      met: false,
      label: 'No Workshop Rush Ticket held — craft one here (Utility) or catch it in the Vendor rotation.',
    });
  }

  // Queue capacity — only binds when an owned, sufficient bench is
  // the one that would run the job and it is full. The capacity is
  // the server's live envelope when the snapshot carries one
  // (bench time widens it; Econ 10), else the baseline constant.
  if (benchOwned) {
    const onBench = ctx.activeJobs.filter((j) => j.bench === bench).length;
    if (onBench >= (ctx.benchCapacity ?? BENCH_JOB_CAPACITY)) {
      gates.push({
        family: 'queue',
        met: false,
        label: 'Bench queue full — jobs finish while Crafting is your action, or cancel one above.',
      });
    }
  }

  // Canonical summary order (the mock's CTA words: "the Lab +
  // materials", "mastery + 1 material", "level + materials") —
  // structural gates first, the material bill last.
  const FAMILY_ORDER: GateFamily[] = ['level', 'bench', 'mastery', 'research', 'standing', 'materials', 'queue', 'ticket'];
  const blockerFamilies: GateFamily[] = [];
  for (const gate of gates) {
    if (!gate.met && !blockerFamilies.includes(gate.family)) blockerFamilies.push(gate.family);
  }
  blockerFamilies.sort((a, b) => FAMILY_ORDER.indexOf(a) - FAMILY_ORDER.indexOf(b));

  const classification: RecipeClassification =
    blockerFamilies.length === 0 ? 'craftable' : blockerFamilies.length === 1 ? 'one-gate' : 'locked';

  let disabledSummary = '';
  if (blockerFamilies.length > 0) {
    disabledSummary =
      blockerFamilies.length === 1 && blockerFamilies[0] === 'materials'
        ? 'Missing materials'
        : `Locked — ${blockerFamilies.map((f) => summaryPart(f, gates, shortages)).join(' + ')}`;
  }

  return {
    classification,
    blockerFamilies,
    gates,
    shortages,
    bench,
    rarity,
    canEnqueue: blockerFamilies.length === 0,
    disabledSummary,
  };
}

/** The honest craftable count: default configuration, live state. */
export function countCraftableNow(recipes: readonly CraftRecipe[], ctx: WorkshopPlayerContext): number {
  return recipes.filter((r) => deriveRecipeReadiness(r, ctx).classification === 'craftable').length;
}

// ─── Card copy: purpose + quality ────────────────────────────────────

/**
 * The recipe's PURPOSE line — what the item is FOR, from the real
 * content owners (consumable defs, refining yields, tool blurbs,
 * skin-part catalog). Rendered nowhere before Direction A.
 */
export function recipePurpose(
  recipe: CraftRecipe,
  ctx: WorkshopPlayerContext,
): { text: string; hint: string | null } {
  if (recipe.kind === 'consumable' && recipe.consumableType) {
    const def = CONSUMABLES[recipe.consumableType];
    if (def) return { text: def.shortDescription, hint: def.uiHints?.[0] ?? null };
  }
  if (recipe.kind === 'refine' && recipe.outputMaterial) {
    // Stochastic rounding (economy brief §9.3): a fractional
    // expectation prints as its honest range ("2–3 out"), never as
    // a single count that would be wrong half the time.
    const range = refineOutputRange(recipe, masteryLevel(ctx, 'crafting.refining'), REFINE_BASE_YIELD_DEFAULT);
    const out = range.max > range.min ? `${range.min}–${range.max}` : `${range.min}`;
    const inputs = Object.entries(resolvedRecipeInputs(recipe, ctx.recipeScrapCosts))
      .map(([k, v]) => `${v} ${inputLabel(k)}`)
      .join(' + ');
    return {
      text: `Turns ${inputs} into ${out} ${inputLabel(recipe.outputMaterial)} — the material gear frames are built from.`,
      hint: 'Your Refining mastery lifts the yield toward 10 back for 10.',
    };
  }
  if (recipe.kind === 'gear') {
    const slot =
      recipe.gearSlot === 'classMod'
        ? 'class mod'
        : recipe.gearSlot === 'weapon'
          ? 'weapon'
          : (recipe.gearSlot ?? 'item');
    return {
      text: `Builds a real, equippable ${slot} at the rarity you pick.`,
      hint: 'Epic frames can finish tempered: a bonus stat roll.',
    };
  }
  if (recipe.namedRelic) {
    const def = craftRelicByName(recipe.namedRelic);
    if (def) {
      return {
        text: def.blurb,
        hint: 'A named relic — equip it on your hunter; its workshop effects apply to every job while worn. Permanent: relics never wear out.',
      };
    }
  }
  if (recipe.kind === 'cosmetic') {
    const part = SKIN_PARTS.find((p) => p.id === recipe.cosmeticPartId);
    return {
      text: `Skin part — ${part?.name ?? recipe.name} for your hunter. Pure cosmetic: craft it, wear it, or sell it.`,
      hint: 'Its finish (quality) rolls at completion.',
    };
  }
  return { text: recipe.name, hint: null };
}

/**
 * The in-place quality definition for a card: the player's ACTUAL
 * bounds from the shared bounds function, plus what the % means.
 * Null for kinds that roll no quality (refining, tools).
 */
export function recipeQualityLine(
  recipe: CraftRecipe,
  ctx: WorkshopPlayerContext,
  bench: number,
  useCatalyst: boolean,
): string | null {
  if (recipe.kind === 'refine') return null;
  const bounds = craftQualityBounds({
    consumableType: recipe.kind === 'consumable' ? recipe.consumableType : null,
    masteryLevel: masteryLevel(ctx, masteryTrackForRecipe(recipe)),
    bench: Math.min(Math.max(bench, 1), Math.max(1, ctx.benchesOwned)),
    catalyst: useCatalyst && catalystForRecipe(recipe) !== null,
  });
  const min = Math.round(bounds.min);
  const max = Math.round(bounds.max);
  if (recipe.kind === 'cosmetic') {
    return `Quality rolls ${min}–${max}% — the finished part carries this quality; 100% is the standard finish`;
  }
  return `Quality rolls ${min}–${max}% — % of the item's base effect; 100% = Vendor strength`;
}

/** The quality band key (real thresholds from getConsumableQualityBand). */
export const QUALITY_BAND_KEY: Array<{ band: string; from: number }> = [
  { band: getConsumableQualityBand(0), from: 0 },
  { band: getConsumableQualityBand(85), from: 85 },
  { band: getConsumableQualityBand(95), from: 95 },
  { band: getConsumableQualityBand(106), from: 106 },
  { band: getConsumableQualityBand(120), from: 120 },
  { band: getConsumableQualityBand(140), from: 140 },
  { band: getConsumableQualityBand(160), from: 160 },
];

/** Search haystack: name, purpose/job, and material — the chip's promise. */
export function recipeSearchText(recipe: CraftRecipe, ctx: WorkshopPlayerContext): string {
  const purpose = recipePurpose(recipe, ctx);
  const inputs = Object.keys(recipe.inputs).map((k) => `${inputLabel(k)} ${k}`).join(' ');
  return [recipe.name, purpose.text, purpose.hint ?? '', inputs].join(' ');
}

/** Bench defs re-exported for the strips (one import surface). */
export { CRAFT_BENCHES };
