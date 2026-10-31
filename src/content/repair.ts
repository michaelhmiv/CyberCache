/**
 * Mechanics & repair services — the ONE content owner for vehicle
 * condition repair (design brief: cybercache-prep/design-briefs/
 * mechanics-and-repair.md, as amended by Michael's 2026-10-30 repair
 * rulings and the crafting brief's F1/F2 flags).
 *
 * What lives here (and nowhere else):
 *   - the repair work-rate / efficiency formulas (§2.11): a mechanic's
 *     edge is TIME + EFFICIENCY, never permission. Untrained work is
 *     deliberately slow; `services.repair` mastery raises both the
 *     points-per-hour rate (capped ×2.0) and per-kit restoration
 *     (capped ×1.5). Kit quality % multiplies underneath, exactly as
 *     the shipped patch-kit numbers always did (F1: bases 30/45/80).
 *   - the patch-kit job recipes: self-repair is a TIMED job on the
 *     crafting slice's job machinery (crafting brief §2.1 admits a
 *     `repair` job kind; F2 resolution). The instant `cc_use_patch_kit`
 *     op is retired by migration 0025.
 *   - the service-board math: pro-rata payout for partial work and the
 *     ONE player-to-player fee rule (brief §2.8): the shared market
 *     fee lever applies to service payments too, and the Scavenger
 *     fee-reduction nodes read it exactly as they read market fees
 *     (Darknet Broker only — Market Manipulator's found-item reduction
 *     never applies to labor; no item changes hands).
 *
 * Rulings baked in: NO NPC mechanic (worst case you walk); the board
 * is an OPEN market — owners post at a set price and escrow the full
 * price up front, any verified mechanic accepts, no private hires;
 * the mechanic supplies the kits on board jobs (price = kits +
 * labor); mechanic XP is 2 per condition point ACTUALLY restored,
 * including partial jobs; self-dealing is not blocked upfront.
 *
 * Jobs are server state (craft_jobs kind 'repair'; service_jobs +
 * escrow_records, migration 0025). Nothing in this module reads a
 * clock; the SQL twins live in migration 0025 and parity is pinned
 * by tests.
 */
import { PATCH_KIT_BASES } from '../lib/vehicles/vehicles';
import { marketFeeReduction } from '../lib/market/marketFee';
import type { SkillBonuses } from '../lib/skills/skillBonuses';

export { PATCH_KIT_BASES };

/** The mastery track that IS the mechanic profession (brief §1.4). */
export const REPAIR_MASTERY_TRACK = 'services.repair';

/** Patch-kit consumable types that can be applied, worst tier first. */
export const REPAIR_KIT_TYPES: readonly string[] = ['PatchKit', 'FieldPatchKit', 'MasterPatchKit'];

/** craft_jobs recipe ids for self-repair jobs, per kit type. */
export const REPAIR_RECIPE_BY_KIT: Readonly<Record<string, string>> = {
  PatchKit: 'repair_patch_kit',
  FieldPatchKit: 'repair_field_patch_kit',
  MasterPatchKit: 'repair_master_patch_kit',
};

/** Reverse of REPAIR_RECIPE_BY_KIT. */
export const REPAIR_KIT_BY_RECIPE: Readonly<Record<string, string>> = {
  repair_patch_kit: 'PatchKit',
  repair_field_patch_kit: 'FieldPatchKit',
  repair_master_patch_kit: 'MasterPatchKit',
};

/** Self-repair jobs sit on bench 0 — their own settle lane, not a bench. */
export const REPAIR_BENCH = 0;

/** Max self-repair jobs a player may hold at once (distinct vehicles). */
export const MAX_ACTIVE_REPAIR_JOBS = 3;

// ─── Levers (brief §2.11; registered in src/server/economy/config.ts) ──

/** Base repair work rate, condition points per hour, before mastery. */
export const REPAIR_WORK_RATE_BASE_DEFAULT = 20;
export const REPAIR_WORK_RATE_BASE_MIN = 1;
export const REPAIR_WORK_RATE_BASE_MAX = 200;

/** Work-rate gain per repair-mastery level (speed cap below). */
export const REPAIR_MASTERY_SPEED_PER_LEVEL_DEFAULT = 0.02;
export const REPAIR_MASTERY_PER_LEVEL_MIN = 0;
export const REPAIR_MASTERY_PER_LEVEL_MAX = 0.1;
/** Work can never run faster than twice the untrained rate. */
export const REPAIR_SPEED_CAP = 2.0;

/** Per-kit restoration gain per repair-mastery level (cap below). */
export const REPAIR_MASTERY_EFFICIENCY_PER_LEVEL_DEFAULT = 0.02;
/** One kit can never restore more than 1.5× its base. */
export const REPAIR_EFFICIENCY_CAP = 1.5;

/** Player XP paid to a mechanic per condition point restored (§2.7). */
export const SERVICE_XP_PER_POINT_DEFAULT = 2;
export const SERVICE_XP_PER_POINT_MIN = 0;
export const SERVICE_XP_PER_POINT_MAX = 10;

/** Hours without progress before an owner may reclaim a job (§2.4). */
export const REPAIR_ABANDON_WINDOW_HOURS_DEFAULT = 48;
export const REPAIR_ABANDON_WINDOW_HOURS_MIN = 1;
export const REPAIR_ABANDON_WINDOW_HOURS_MAX = 720;

/** Days an unaccepted board posting stays open before refund. */
export const REPAIR_LISTING_EXPIRY_DAYS_DEFAULT = 7;
export const REPAIR_LISTING_EXPIRY_DAYS_MIN = 1;
export const REPAIR_LISTING_EXPIRY_DAYS_MAX = 30;

// ─── Formulas (SQL twins in migration 0025; parity-pinned) ──────────

/** Work-rate multiplier from repair mastery level (starts at 1). */
export function repairSpeedMultiplier(masteryLevel: number, perLevel: number): number {
  const level = Math.max(1, Math.floor(masteryLevel || 1));
  return Math.min(REPAIR_SPEED_CAP, 1 + perLevel * (level - 1));
}

/** Condition points restored per hour at this mastery / lever base. */
export function repairWorkRatePointsPerHour(
  masteryLevel: number,
  baseRate: number,
  perLevel: number,
): number {
  return baseRate * repairSpeedMultiplier(masteryLevel, perLevel);
}

/** Per-kit restoration multiplier from repair mastery level. */
export function repairEfficiencyMultiplier(masteryLevel: number, perLevel: number): number {
  const level = Math.max(1, Math.floor(masteryLevel || 1));
  return Math.min(REPAIR_EFFICIENCY_CAP, 1 + perLevel * (level - 1));
}

/** With the Fixer efficiency nodes composed in, one kit can restore
 *  up to 1.8× its base (the mastery term alone stays capped at 1.5). */
export const REPAIR_EFFICIENCY_SKILL_CAP = 1.8;

/**
 * The composed per-kit restoration multiplier (migration 0029):
 * efficiency = min(1.80, masteryEfficiency × (1 + repairEfficiency
 * Bonus)). Kit Stretching / Salvage Solder carry +0.025 per point;
 * the composition is multiplicative AFTER the mastery cap, so the
 * Fixer term is the only way past 1.5×. Snapshotted at self-repair
 * enqueue and at board accept in both store implementations (SQL
 * twins in migration 0029).
 */
export function repairEfficiencyWithSkill(
  masteryLevel: number,
  perLevel: number,
  skillBonus: number,
): number {
  const mastery = repairEfficiencyMultiplier(masteryLevel, perLevel);
  return Math.min(REPAIR_EFFICIENCY_SKILL_CAP, mastery * (1 + Math.max(0, skillBonus || 0)));
}

/**
 * The Fixer repair-speed term (migration 0029): Torque Discipline /
 * Bay Choreography carry +0.03 repairSpeedBonus per point; snapshotted
 * repair durations multiply by 1 − min(0.30, bonus).
 */
export function repairSpeedDurationMultiplier(skillBonus: number): number {
  return 1 - Math.min(0.3, Math.max(0, skillBonus || 0));
}

/**
 * The same speed term expressed on a work RATE (board jobs accrue
 * points over time rather than occupying a fixed unit duration):
 * rate / (1 − min(0.30, bonus)) — mathematically the duration
 * multiplier above, applied to the accept snapshot's rate.
 */
export function repairSpeedRateMultiplier(skillBonus: number): number {
  return 1 / repairSpeedDurationMultiplier(skillBonus);
}

/**
 * Wall-clock milliseconds one kit occupies the work slot: the kit's
 * base restore divided by the current work rate. A 30-point kit at
 * the untrained 20 pts/hour takes 1.5 hours — deliberately slow (F2).
 * The optional Fixer speed term (migration 0029) multiplies the
 * snapshotted duration by repairSpeedDurationMultiplier.
 */
export function repairKitUnitDurationMs(
  kitBase: number,
  ratePointsPerHour: number,
  speedBonus = 0,
): number {
  const rate = ratePointsPerHour > 0 ? ratePointsPerHour : REPAIR_WORK_RATE_BASE_DEFAULT;
  return Math.max(1, Math.ceil(((kitBase * repairSpeedDurationMultiplier(speedBonus)) / rate) * 3_600_000));
}

/** Points one kit restores: base × quality% × mechanic efficiency. */
export function repairKitRestorePoints(kitBase: number, qualityPct: number, efficiency: number): number {
  const raw = kitBase * (qualityPct / 100) * efficiency;
  return Math.round(raw * 100) / 100;
}

/**
 * Pro-rata payout for a board job: price × restored / target, floored.
 * Price is per-point under the hood (brief §2.4) — partial work pays
 * for the points actually restored, never more, never less.
 */
export function repairProRataPayout(priceCredits: number, pointsRestored: number, targetPoints: number): number {
  if (targetPoints <= 0) return 0;
  if (pointsRestored >= targetPoints) return Math.floor(priceCredits);
  return Math.floor((priceCredits * Math.max(0, pointsRestored)) / targetPoints);
}

export interface RepairFeeBreakdown {
  feeCredits: number;
  feeRate: number;
  /** Combined relative fee reduction from the mechanic's nodes, 0..1. */
  feeReduction: number;
  /** What the mechanic actually receives: payout − fee. */
  mechanicProceeds: number;
}

/**
 * The ONE player-to-player fee rule (brief §2.8): board labor pays
 * the shared market fee, destroyed, with the mechanic's Darknet
 * Broker reduction applied exactly as on a market sale. Market
 * Manipulator's found-item reduction does not apply (no item is
 * sold). NPC exemption never applies — there is no NPC mechanic.
 */
export function repairServiceFee(
  payoutCredits: number,
  feeRate: number,
  mechanicBonuses: SkillBonuses,
): RepairFeeBreakdown {
  const feeReduction = marketFeeReduction(mechanicBonuses, false);
  const feeCredits = Math.floor(Math.max(0, payoutCredits) * feeRate * (1 - feeReduction));
  return {
    feeCredits,
    feeRate,
    feeReduction,
    mechanicProceeds: Math.max(0, payoutCredits) - feeCredits,
  };
}

/** Player XP a mechanic earns for a job: per point ACTUALLY restored. */
export function repairServiceXp(pointsRestored: number, xpPerPoint: number): number {
  return Math.max(0, Math.round(xpPerPoint * pointsRestored));
}

/** Mastery XP for the repair track: one per point restored. */
export function repairMasteryXp(pointsRestored: number): number {
  return Math.max(0, Math.ceil(pointsRestored));
}
