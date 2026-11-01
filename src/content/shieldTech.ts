/**
 * Shield-Tech services — the ONE content owner for shield behavior
 * recalibration (design brief: cybercache-prep/design-briefs/
 * expansion-pack/shield-tech-services.md; Michael's defaults settled
 * 2026-10-31, DECISIONS.md R8).
 *
 * What a shield-tech service IS (§1.2): a behavior recalibration. The
 * owner of a shield pays another player to change the shield's
 * `behavior` archetype from its current archetype to a different,
 * owner-chosen archetype that the shield's rarity could have
 * generated with — nothing else about the item changes. It is not
 * repair (a shield has no condition), not stat tuning (behavior
 * numbers are code constants in src/lib/combat/shieldBehaviors.ts,
 * never levers), and not a re-roll (the owner picks the target; the
 * tech's skill buys speed and consumable efficiency, never
 * permission or luck). The work is measured in CALIBRATION POINTS —
 * the shield's stored capacity (payload.hp, Turtle transform
 * included), the one size number every shield already carries.
 *
 * Rulings baked in (inherited wholesale from the repair rulings,
 * mechanics-and-repair.md, and the brief's settled laws):
 *   - NO NPC shield tech; the board is an OPEN market only — owners
 *     post at a set price and escrow the full price up front, any
 *     verified player accepts, NO private hires.
 *   - The provider supplies the consumable (Calibration Cores,
 *     crafter-only); price = cores + labor.
 *   - ONE fee rule for player-to-player services: the shared
 *     marketFeeRate lever applies to the paid part and is destroyed;
 *     the provider's Darknet Broker reduction applies; Market
 *     Manipulator's does not (no item is sold). This is
 *     repairServiceFee, reused verbatim — not a second fee function.
 *   - Money follows the repair rule exactly: every terminal state
 *     pays floor(price × points_done / target_points) for work
 *     actually done (repairProRataPayout, reused), remainder
 *     refunded. The FLIP follows the work: payload.behavior changes
 *     only at 100% completion; partial / abandoned / cancelled /
 *     expired jobs leave the shield bit-identical to posting.
 *   - R8 (DECISIONS.md): recalibrating a Legendary shield DOWN to
 *     Standard is BANNED — generation can never produce a Standard
 *     Legendary (SHIELD_BEHAVIOR_WEIGHTS.Legendary.standard = 0), so
 *     no service may create one. The legality rule below IS the
 *     generation rule: a target is legal iff its weight for the
 *     shield's rarity is > 0.
 *   - XP is paid per point of work actually done at terminal
 *     settlement, partial jobs included (the repair rule), at
 *     shieldTechXpPerPoint (default 0.25 — per-point XP cannot copy
 *     repair's 2/point: a 7,900-point endgame job would pay 15,800
 *     XP against a level-75 boss victory's 3,750).
 *   - Self-dealing is not blocked upfront (same-account self-accept
 *     refused; detection via economy baselines, docs/ECONOMY.md).
 *
 * Jobs are server state (service_jobs profession 'shield_tech' +
 * escrow_records, migration 0044; the self-lane is a craft_jobs row
 * of kind 'shieldtech' on bench 0). Nothing in this module reads a
 * clock; the SQL twins live in migration 0044 and parity is pinned
 * by tests.
 */
import {
  SHIELD_BEHAVIOR_WEIGHTS,
  applyShieldBehaviorGenerationStats,
  invertShieldBehaviorGenerationStats,
  shieldBehaviorOf,
  type ShieldBehaviorId,
} from '../lib/combat/shieldBehaviors';
import type { Rarity } from '../types/game';

export { repairProRataPayout, repairServiceFee } from './repair';

/** The mastery track that IS the shield-tech profession. */
export const SHIELD_TECH_MASTERY_TRACK = 'services.shield_tech';

/** service_jobs discriminator for this lane (migration 0044). */
export const SHIELD_TECH_PROFESSION_ID = 'shield_tech';
/** service_jobs requested_service_id for a recalibration job. */
export const SHIELD_TECH_SERVICE_ID = 'shield_recalibration';

/** The one consumable the lane burns (crafter-only, §2.4). */
export const CALIBRATION_CORE_TYPE = 'CalibrationCore';
/** Crafting recipe id for the Calibration Core (catalog, §2.4). */
export const CALIBRATION_CORE_RECIPE_ID = 'recipe_calibration_core';

/** Self-lane jobs sit on bench 0 — their own settle lane (the
 *  REPAIR_BENCH precedent, src/content/repair.ts). */
export const SHIELDTECH_BENCH = 0;

/** Max self-lane recalibration jobs a player may hold at once
 *  (distinct shields; the MAX_ACTIVE_REPAIR_JOBS precedent). */
export const MAX_ACTIVE_SHIELDTECH_JOBS = 3;

/**
 * Calibration points one Calibration Core carries at 100% quality
 * (§2.4). Effective capacity = base × quality% × the tech's
 * efficiency multiplier — quality is read by the engine here, so a
 * crafted 140% core is visibly worth more.
 */
export const CALIBRATION_CORE_BASE_POINTS = 2500;

// ─── Levers (brief §2.7; registered in src/server/economy/config.ts) ──

/** Base recalibration work rate, calibration points per hour. */
export const SHIELD_TECH_WORK_RATE_BASE_DEFAULT = 500;
export const SHIELD_TECH_WORK_RATE_BASE_MIN = 50;
export const SHIELD_TECH_WORK_RATE_BASE_MAX = 5000;

/** Work-rate gain per shield-tech mastery level (speed cap below). */
export const SHIELD_TECH_MASTERY_SPEED_PER_LEVEL_DEFAULT = 0.02;
export const SHIELD_TECH_MASTERY_PER_LEVEL_MIN = 0;
export const SHIELD_TECH_MASTERY_PER_LEVEL_MAX = 0.1;
/** Work can never run faster than twice the untrained rate. */
export const SHIELD_TECH_SPEED_CAP = 2.0;

/** Per-core capacity gain per shield-tech mastery level. */
export const SHIELD_TECH_MASTERY_EFFICIENCY_PER_LEVEL_DEFAULT = 0.02;
/** One core can never carry more than 1.5× its base capacity. */
export const SHIELD_TECH_EFFICIENCY_CAP = 1.5;

/** Player XP paid to a tech per calibration point completed (§2.6). */
export const SHIELD_TECH_XP_PER_POINT_DEFAULT = 0.25;
export const SHIELD_TECH_XP_PER_POINT_MIN = 0;
export const SHIELD_TECH_XP_PER_POINT_MAX = 2;

/** Hours without progress before an owner may reclaim a job. */
export const SHIELD_TECH_ABANDON_WINDOW_HOURS_DEFAULT = 48;
export const SHIELD_TECH_ABANDON_WINDOW_HOURS_MIN = 1;
export const SHIELD_TECH_ABANDON_WINDOW_HOURS_MAX = 720;

/** Days an unaccepted board posting stays open before refund. */
export const SHIELD_TECH_LISTING_EXPIRY_DAYS_DEFAULT = 7;
export const SHIELD_TECH_LISTING_EXPIRY_DAYS_MIN = 1;
export const SHIELD_TECH_LISTING_EXPIRY_DAYS_MAX = 30;

// ─── Legality (brief §2.3 — the generation rule, R8) ────────────────

/**
 * The target legality rule: a behavior is a legal recalibration
 * target for a shield iff generation could have rolled it for that
 * shield's rarity — its weight in SHIELD_BEHAVIOR_WEIGHTS is > 0.
 * This reads the shipped weight table and never re-tables it. The
 * Legendary row is the rule with teeth: standard weight 0, so
 * Legendary → Standard is refused here and in the SQL twin
 * (cc_shieldtech_behavior_legal, migration 0044).
 */
export function isLegalShieldTechTarget(rarity: Rarity, target: ShieldBehaviorId): boolean {
  const weights = SHIELD_BEHAVIOR_WEIGHTS[rarity];
  if (!weights) return false;
  return (weights[target] ?? 0) > 0;
}

/** Every legal target for a shield of this rarity leaving `from`. */
export function legalShieldTechTargets(
  rarity: Rarity,
  from: ShieldBehaviorId,
): ShieldBehaviorId[] {
  return (Object.keys(SHIELD_BEHAVIOR_WEIGHTS[rarity] ?? {}) as ShieldBehaviorId[]).filter(
    (id) => id !== from && isLegalShieldTechTarget(rarity, id),
  );
}

// ─── Formulas (SQL twins in migration 0044; parity-pinned) ──────────

/** Work-rate multiplier from shield-tech mastery level (starts at 1). */
export function shieldTechSpeedMultiplier(masteryLevel: number, perLevel: number): number {
  const level = Math.max(1, Math.floor(masteryLevel || 1));
  return Math.min(SHIELD_TECH_SPEED_CAP, 1 + perLevel * (level - 1));
}

/** Calibration points per hour at this mastery / lever base. */
export function shieldTechWorkRatePointsPerHour(
  masteryLevel: number,
  baseRate: number,
  perLevel: number,
): number {
  return baseRate * shieldTechSpeedMultiplier(masteryLevel, perLevel);
}

/** Per-core capacity multiplier from shield-tech mastery level. */
export function shieldTechEfficiencyMultiplier(masteryLevel: number, perLevel: number): number {
  const level = Math.max(1, Math.floor(masteryLevel || 1));
  return Math.min(SHIELD_TECH_EFFICIENCY_CAP, 1 + perLevel * (level - 1));
}

/** Points one core carries: base × quality% × tech efficiency. */
export function calibrationCoreCapacityPoints(
  qualityPct: number,
  efficiency: number,
): number {
  const raw = CALIBRATION_CORE_BASE_POINTS * (qualityPct / 100) * efficiency;
  return Math.round(raw * 100) / 100;
}

/**
 * Wall-clock milliseconds one core segment occupies the self-lane
 * work slot: the core's BASE capacity divided by the current work
 * rate (the repair lane's kit-duration shape — quality changes how
 * much work a core carries, not how long it takes to burn).
 */
export function shieldTechCoreUnitDurationMs(
  ratePointsPerHour: number,
): number {
  const rate = ratePointsPerHour > 0 ? ratePointsPerHour : SHIELD_TECH_WORK_RATE_BASE_DEFAULT;
  return Math.max(1, Math.ceil((CALIBRATION_CORE_BASE_POINTS / rate) * 3_600_000));
}

/** Player XP a tech earns for a job: per point ACTUALLY completed,
 *  paid once at terminal settlement, partial jobs included. */
export function shieldTechServiceXp(pointsCompleted: number, xpPerPoint: number): number {
  return Math.max(0, Math.round(xpPerPoint * Math.max(0, pointsCompleted)));
}

/** Mastery XP for the shield-tech track: one per 10 points. */
export function shieldTechMasteryXp(pointsCompleted: number): number {
  return Math.max(0, Math.ceil(Math.max(0, pointsCompleted) / 10));
}

/**
 * Cores a self-lane job must escrow: walk the owner's batches in the
 * game's one burn order (worst quality first) accumulating each
 * core's true capacity until the target is covered. Returns the
 * count, or null when the owner's total core capacity cannot cover
 * the target (the enqueue refuses cleanly). Deterministic: the burn
 * order at work time is this same order, so the escrowed cores are
 * exactly the cores that will burn.
 */
export function coresNeededForTarget(
  batchesWorstFirst: Array<{ quality: number; quantity: number }>,
  targetPoints: number,
  efficiency: number,
): number | null {
  if (targetPoints <= 0) return null;
  let covered = 0;
  let count = 0;
  for (const batch of batchesWorstFirst) {
    for (let i = 0; i < batch.quantity; i++) {
      covered += calibrationCoreCapacityPoints(batch.quality, efficiency);
      count += 1;
      if (covered >= targetPoints) return count;
    }
  }
  return null;
}

/**
 * The payload a completed recalibration writes (the twin of
 * cc_shieldtech_rebased_payload, migration 0044): un-bake the FROM
 * behavior's generation transform, apply the TO behavior's, stamp
 * the new behavior. Only Turtle transforms stats, so every other
 * swap changes nothing but the behavior field — and a legacy shield
 * with no baked stats gains just the behavior field.
 */
export function rebasedShieldPayload(
  payload: Record<string, unknown>,
  toBehavior: ShieldBehaviorId,
): Record<string, unknown> {
  const hp = payload.hp;
  const rechargeRate = payload.rechargeRate;
  if (
    typeof hp !== 'number' || !Number.isFinite(hp) ||
    typeof rechargeRate !== 'number' || !Number.isFinite(rechargeRate)
  ) {
    return { ...payload, behavior: toBehavior };
  }
  const from = shieldBehaviorOf(payload);
  const base = invertShieldBehaviorGenerationStats(from, { hp, rechargeRate });
  const rebased = applyShieldBehaviorGenerationStats(toBehavior, base);
  return { ...payload, behavior: toBehavior, hp: rebased.hp, rechargeRate: rebased.rechargeRate };
}

/** Payload minus the three fields a recalibration may legitimately
 *  change — the identity the finalize drift check compares. */
export function stripShieldBehaviorStats(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const { behavior: _b, hp: _h, rechargeRate: _r, ...rest } = payload;
  return rest;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * True when a shield's payload differs from its posting snapshot
 * anywhere outside behavior/hp/rechargeRate — the flip refuses on
 * drift (the money still settles). The twin of the finalize check in
 * migration 0044.
 */
export function shieldPayloadDrifted(
  current: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): boolean {
  return canonicalJson(stripShieldBehaviorStats(current)) !== canonicalJson(stripShieldBehaviorStats(snapshot));
}
