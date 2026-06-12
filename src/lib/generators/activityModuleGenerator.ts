/**
 * Activity Module Generator — the procedural engine that creates activity
 * affixes with Borderlands-level depth.
 *
 * Takes an item's context (level, rarity, manufacturer, RNG) and an activity
 * kind, and produces an Affix with `category: 'activity'` and multi-dimensional
 * `subStats`. Each sub-stat is scaled by level, rarity, manufacturer bias, and
 * quality roll — yielding billions of unique combinations.
 *
 * This is the CLIENT-SIDE generator (runs during item creation in the browser).
 * The Chef verifies outcomes by re-running this same function with the same RNG
 * seed (deterministic re-roll).
 */

import type { Affix } from '@/types/items';
import type { ActivityKind } from '@/types/activity';
import { Rarity, Manufacturer } from '@/types/game';
import { seededRandom } from '@/lib/utils/rng';
import {
  ACTIVITY_MODULE_DEFS,
  RARITY_MULT,
  QUALITY_MIN,
  MFG_BIAS_MULT,
  SLOT_ACTIVITY_WEIGHTS,
  MODULE_ACTIVITY_KINDS,
  type SubStatDef,
  type ActivityModuleDef,
} from '@/content/activityModuleDefs';

// ── Types ─────────────────────────────────────────────────────────

export interface ActivityModuleContext {
  itemLevel: number;
  itemRarity: Rarity;
  manufacturer: Manufacturer;
  slot: 'weapon' | 'shield' | 'ordnance' | 'relic' | 'classMod';
  activityKind: ActivityKind;
  /** Seeded PRNG from the item's pixelSeed. */
  rng: () => number;
}

// ── Quality Roll ──────────────────────────────────────────────────

/**
 * Compute the quality roll (0–1) for this module. Quality is derived from
 * the RNG stream and represents the "tier" of the roll — visible as a
 * progress bar in the UI.
 *
 * HelixWorks items get a +10 quality floor (mirroring their +10 rollQualityBias
 * for combat stats).
 */
function computeQuality(rng: () => number, manufacturer: Manufacturer): number {
  const raw = seededRandom(0, 1, rng);
  const floor = manufacturer === Manufacturer.HelixWorks
    ? QUALITY_MIN + 0.08
    : QUALITY_MIN;
  return Math.min(1.0, floor + raw * (1.0 - floor));
}

// ── Level Scalar ──────────────────────────────────────────────────

/**
 * Compute the level scalar for a given sub-stat.
 *   scalar = 1 + (level - 1) * growthRate
 */
function levelScalar(level: number, growthRate: number): number {
  return 1 + (level - 1) * growthRate;
}

// ── Manufacturer Modifier ─────────────────────────────────────────

/**
 * Check if a sub-stat key is favored by the item's manufacturer.
 * Returns the multiplier (≥1.0 for favored, 1.0 for neutral).
 */
function mfgModifier(
  statKey: string,
  manufacturer: Manufacturer,
  def: ActivityModuleDef,
): number {
  const bonus = def.mfgBonus?.[manufacturer];
  if (bonus && bonus.stat === statKey) {
    return bonus.mult * MFG_BIAS_MULT;
  }
  // Check if this manufacturer has an anti-bias (any stat that conflicts
  // with their identity). For now, only apply anti-bias to primary stat
  // if the manufacturer favors a different stat in the same module.
  // This is subtle but creates manufacturer "feel" — e.g., BlastForge
  // weapons are slightly worse at precision crafting stats.
  const primaryStat = def.subStats.find((s) => s.isPrimary);
  if (primaryStat && statKey === primaryStat.key) {
    // If manufacturer has a bonus that targets a non-primary stat, slightly
    // penalize the primary to create trade-offs.
    const hasNonPrimaryBonus = bonus && bonus.stat !== primaryStat.key;
    if (hasNonPrimaryBonus) {
      return 0.92; // -8% to primary when manufacturer specializes elsewhere
    }
    // Manufacturer that favors the primary gets a small boost
    if (bonus && bonus.stat === primaryStat.key) {
      return bonus.mult;
    }
  }
  return 1.0;
}

// ── Variance Roll ─────────────────────────────────────────────────

/**
 * Final ±20% variance that makes every module feel unique.
 */
function varianceRoll(rng: () => number): number {
  return seededRandom(0.80, 1.20, rng);
}

// ── Sub-Stat Computation ──────────────────────────────────────────

/**
 * Compute the final value for a single sub-stat given the full item context.
 *
 *   value = baseValue
 *     × levelScalar
 *     × rarityMultiplier
 *     × manufacturerModifier
 *     × quality
 *     × variance
 */
function computeSubStat(
  def: SubStatDef,
  ctx: ActivityModuleContext,
  quality: number,
): number {
  const ls = levelScalar(ctx.itemLevel, def.levelGrowth);
  const rm = RARITY_MULT[ctx.itemRarity];
  const moduleDef = ACTIVITY_MODULE_DEFS[ctx.activityKind as keyof typeof ACTIVITY_MODULE_DEFS];
  const mm = mfgModifier(def.key, ctx.manufacturer, moduleDef);
  const vr = varianceRoll(ctx.rng);

  // Clamp quality to not go below minimum
  const q = Math.max(QUALITY_MIN, quality);

  const raw = def.baseValue * ls * rm * mm * q * vr;

  // Round to 3 decimal places for display precision
  return parseFloat(raw.toFixed(3));
}

// ── Display Text Builder ──────────────────────────────────────────

function buildDisplayText(
  def: ActivityModuleDef,
  subStats: Record<string, number>,
  quality: number,
): string {
  const qualityPct = Math.round(quality * 100);
  const primary = def.subStats.find((s) => s.isPrimary) ?? def.subStats[0];
  const primaryVal = subStats[primary.key] ?? 0;

  const parts: string[] = [];
  parts.push(`${def.name} [${qualityPct}%]`);

  // Show primary stat first
  const primaryDisplay = primary.displayFormat.replace('{v}', (primaryVal * 100).toFixed(1));
  parts.push(primaryDisplay);

  // Show 1-2 additional notable sub-stats
  const others = def.subStats
    .filter((s) => !s.isPrimary && subStats[s.key] > 0)
    .slice(0, 2);
  for (const s of others) {
    const val = subStats[s.key];
    const display = s.displayFormat.replace('{v}', (val * 100).toFixed(1));
    parts.push(display);
  }

  return parts.join(' · ');
}

// ── Main Generator ────────────────────────────────────────────────

/**
 * Generate an activity module affix for a given item context.
 *
 * Returns null if the activity kind has no module definition (e.g., boss_fight
 * uses combat affixes instead of activity modules).
 */
export function generateActivityModule(ctx: ActivityModuleContext): Affix | null {
  const moduleDef = ACTIVITY_MODULE_DEFS[ctx.activityKind as keyof typeof ACTIVITY_MODULE_DEFS];
  if (!moduleDef) return null;

  const quality = computeQuality(ctx.rng, ctx.manufacturer);

  // Determine which sub-stats are eligible based on rarity
  const eligibleStats = moduleDef.subStats.filter(
    (s) => {
      const rarityIndex = Object.values(Rarity).indexOf(ctx.itemRarity);
      const minIndex = Object.values(Rarity).indexOf(s.rarityMin);
      return rarityIndex >= minIndex;
    },
  );

  if (eligibleStats.length === 0) return null;

  // Compute sub-stat values
  const subStats: Record<string, number> = {};
  for (const def of eligibleStats) {
    subStats[def.key] = computeSubStat(def, ctx, quality);
  }

  const affix: Affix = {
    id: `activity_${ctx.activityKind}_${ctx.slot}`,
    category: 'activity',
    stat: `${ctx.activityKind}Module`,
    value: quality, // quality roll 0–1, shown as progress bar
    subStats,
    displayText: buildDisplayText(moduleDef, subStats, quality),
  };

  return affix;
}

/**
 * Pick a random activity kind weighted by slot tendencies.
 * Used by item generators when deciding which activity module to roll.
 */
export function pickActivityKind(
  slot: ActivityModuleContext['slot'],
  rng: () => number,
): ActivityKind | null {
  const weights = SLOT_ACTIVITY_WEIGHTS[slot];

  // Build weighted pool
  const entries: Array<{ kind: ActivityKind; weight: number }> = [];
  for (const kind of MODULE_ACTIVITY_KINDS) {
    const w = weights[kind] ?? 1.0;
    if (w > 0) {
      entries.push({ kind, weight: w });
    }
  }

  if (entries.length === 0) return null;

  // Weighted random pick
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = seededRandom(0, totalWeight, rng);
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.kind;
  }

  return entries[entries.length - 1].kind;
}
