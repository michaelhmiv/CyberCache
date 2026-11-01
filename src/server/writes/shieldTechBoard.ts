/**
 * ShieldTechBoard — the shared view/types for the shield-tech
 * services board (migration 0044), assembled identically by the Pg
 * WriteStore (from table rows) and the in-memory WriteStore (from
 * seed state). The board's rules live in src/content/shieldTech.ts
 * and in the cc_*shieldtech* SQL functions; this module only shapes
 * server state for display — it computes no outcomes.
 *
 * The view carries the recalibration itself: the shield's from/to
 * behaviors with their plain-language descriptions (the player is
 * buying a behavior swap, so the board shows exactly what changes),
 * the work size in calibration points, an estimate of the cores the
 * job will burn at the READER's own efficiency (display guidance),
 * and the rolling median price per 1,000 points for the same rarity
 * band (display-only price guidance, the market's median-price law).
 */
import {
  SHIELD_TECH_ABANDON_WINDOW_HOURS_DEFAULT,
  SHIELD_TECH_ABANDON_WINDOW_HOURS_MAX,
  SHIELD_TECH_ABANDON_WINDOW_HOURS_MIN,
  SHIELD_TECH_LISTING_EXPIRY_DAYS_DEFAULT,
  SHIELD_TECH_LISTING_EXPIRY_DAYS_MAX,
  SHIELD_TECH_LISTING_EXPIRY_DAYS_MIN,
  SHIELD_TECH_XP_PER_POINT_DEFAULT,
  SHIELD_TECH_XP_PER_POINT_MAX,
  SHIELD_TECH_XP_PER_POINT_MIN,
  coresNeededForTarget,
  rebasedShieldPayload,
} from '../../content/shieldTech.js';
import {
  SHIELD_BEHAVIORS,
  describeShieldBehavior,
  shieldBehaviorOf,
  type ShieldBehaviorId,
} from '../../lib/combat/shieldBehaviors.js';
import type { ServiceJobData } from './store.js';

/** Lever values the board flow reads. */
export interface ShieldTechLeverValues {
  shieldTechXpPerPoint: number;
  shieldTechAbandonWindowHours: number;
  shieldTechListingExpiryDays: number;
}

const clampNum = (value: number | undefined, def: number, min: number, max: number): number => {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : def;
  return Math.min(max, Math.max(min, v));
};

/** Merge an injected partial over the code defaults, clamped to the
 *  economy registry ranges — the in-memory mirror of the SQL
 *  functions reading economy_config via cc_economy_config_number. */
export function resolveShieldTechLevers(
  partial: Partial<ShieldTechLeverValues> | undefined,
): ShieldTechLeverValues {
  const p = partial ?? {};
  return {
    shieldTechXpPerPoint: clampNum(
      p.shieldTechXpPerPoint,
      SHIELD_TECH_XP_PER_POINT_DEFAULT,
      SHIELD_TECH_XP_PER_POINT_MIN,
      SHIELD_TECH_XP_PER_POINT_MAX,
    ),
    shieldTechAbandonWindowHours: clampNum(
      p.shieldTechAbandonWindowHours,
      SHIELD_TECH_ABANDON_WINDOW_HOURS_DEFAULT,
      SHIELD_TECH_ABANDON_WINDOW_HOURS_MIN,
      SHIELD_TECH_ABANDON_WINDOW_HOURS_MAX,
    ),
    shieldTechListingExpiryDays: clampNum(
      p.shieldTechListingExpiryDays,
      SHIELD_TECH_LISTING_EXPIRY_DAYS_DEFAULT,
      SHIELD_TECH_LISTING_EXPIRY_DAYS_MIN,
      SHIELD_TECH_LISTING_EXPIRY_DAYS_MAX,
    ),
  };
}

export interface ShieldTechShieldView {
  itemId: string;
  rarity: string | null;
  /** Stored capacity — the job's work size in calibration points. */
  capacity: number | null;
  behavior: ShieldBehaviorId;
  behaviorName: string;
}

export interface ShieldTechCoreConsumptionView {
  kitType: string;
  quality: number;
  pointsApplied: number;
}

export interface ShieldTechJobView {
  id: string;
  ownerUserId: string;
  ownerName: string | null;
  providerUserId: string | null;
  providerName: string | null;
  status: string;
  outcome: string | null;
  shield: ShieldTechShieldView | null;
  fromBehavior: ShieldBehaviorId | null;
  fromBehaviorName: string | null;
  fromBehaviorDescription: string | null;
  toBehavior: ShieldBehaviorId | null;
  toBehaviorName: string | null;
  toBehaviorDescription: string | null;
  /** The flip landed at completion (false on drift-refused flips). */
  flipApplied: boolean | null;
  targetPoints: number;
  pointsCalibrated: number;
  /** 0..1 of the target calibrated. */
  progress: number;
  /** 0..1 of the currently open core already applied. */
  coreProgress: number;
  priceCredits: number;
  creditsPerPoint: number;
  /** Cores this job will burn at the READER's efficiency (estimate). */
  estimatedCoresForReader: number | null;
  kitsConsumed: ShieldTechCoreConsumptionView[];
  paidCredits: number | null;
  feeCredits: number | null;
  xpAwarded: number | null;
  createdAtMs: number;
  acceptedAtMs: number | null;
  completedAtMs: number | null;
  expiresAtMs: number | null;
  lastProgressAtMs: number | null;
  /** Owner may reclaim: active job, no progress inside the window. */
  reclaimable: boolean;
  /** Position among the provider's accepted, unfinished jobs (1-based). */
  queuePosition: number | null;
}

export interface ShieldTechBoardStats {
  /** Rolling median credits per 1,000 points across completed board
   *  jobs of the same rarity band as each listed shield — computed
   *  per band in medianByRarity below. */
  medianSampleSize: number;
  myMasteryLevel: number;
  myMasteryXp: number;
  myJobsCompleted: number;
  myJobsAbandoned: number;
}

export interface ShieldTechBoardView {
  open: ShieldTechJobView[];
  mine: ShieldTechJobView[];
  work: ShieldTechJobView[];
  /** Median credits per 1,000 calibration points per rarity band,
   *  from completed board jobs (display-only price guidance). */
  medianPerThousandByRarity: Record<string, number | null>;
  stats: ShieldTechBoardStats;
  levers: ShieldTechLeverValues & { marketFeeRate: number };
}

export interface ShieldTechShieldInfo {
  kind: string;
  payload: Record<string, unknown>;
  rarity: string | null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function shieldTechShieldView(
  itemId: string,
  info: ShieldTechShieldInfo | null,
): ShieldTechShieldView | null {
  if (!info) return null;
  const behavior = shieldBehaviorOf(info.payload);
  const hp = info.payload.hp;
  return {
    itemId,
    rarity: info.rarity,
    capacity: typeof hp === 'number' && Number.isFinite(hp) ? hp : null,
    behavior,
    behaviorName: SHIELD_BEHAVIORS[behavior].name,
  };
}

function behaviorName(id: ShieldBehaviorId | null): string | null {
  return id ? SHIELD_BEHAVIORS[id].name : null;
}

function statsOf(payload: Record<string, unknown>): { hp: number; rechargeRate: number } {
  return {
    hp: typeof payload.hp === 'number' && Number.isFinite(payload.hp) ? payload.hp : 0,
    rechargeRate:
      typeof payload.rechargeRate === 'number' && Number.isFinite(payload.rechargeRate)
        ? payload.rechargeRate
        : 0,
  };
}

/**
 * The plain-language line for a behavior ON THIS SHIELD: the
 * owner's combat numbers (Nova's burst scales with capacity), so
 * the from-line prices the behavior the shield carries today and
 * the to-line prices the behavior it will carry after the flip
 * (rebased stats — a Turtle target shows its real new numbers).
 */
function behaviorDescription(
  id: ShieldBehaviorId | null,
  snapshotPayload: Record<string, unknown> | null,
  rebased: boolean,
): string | null {
  if (!id) return null;
  if (!snapshotPayload) return SHIELD_BEHAVIORS[id].blurb;
  const payload = rebased ? rebasedShieldPayload(snapshotPayload, id) : snapshotPayload;
  return describeShieldBehavior(id, statsOf(payload));
}

export function shieldTechJobView(
  job: ServiceJobData,
  shield: ShieldTechShieldView | null,
  names: Map<string, string | null>,
  nowMs: number,
  abandonWindowHours: number,
  queuePosition: number | null,
  readerEfficiency: number,
): ShieldTechJobView {
  const target = job.target_points ?? 0;
  const calibrated = job.points_restored ?? 0;
  const price = job.quoted_price_credits ?? 0;
  const lastProgress = ms(job.last_progress_at);
  const coreTotal = job.open_kit_total ?? 0;
  const coreRemaining = job.open_kit_capacity ?? 0;
  const snap = job.shieldtech_snapshot ?? null;
  const fromBehavior = (snap?.fromBehavior ?? job.from_behavior ?? null) as ShieldBehaviorId | null;
  const toBehavior = (snap?.toBehavior ?? job.to_behavior ?? null) as ShieldBehaviorId | null;
  const snapPayload = snap?.payload ?? null;
  return {
    id: job.id,
    ownerUserId: job.owner_user_id,
    ownerName: names.get(job.owner_user_id) ?? null,
    providerUserId: job.provider_user_id,
    providerName: job.provider_user_id ? (names.get(job.provider_user_id) ?? null) : null,
    status: job.status,
    outcome: job.outcome ?? null,
    shield,
    fromBehavior,
    fromBehaviorName: behaviorName(fromBehavior),
    fromBehaviorDescription: behaviorDescription(fromBehavior, snapPayload, false),
    toBehavior,
    toBehaviorName: behaviorName(toBehavior),
    toBehaviorDescription: behaviorDescription(toBehavior, snapPayload, true),
    flipApplied: snap && typeof snap.flipApplied === 'boolean' ? snap.flipApplied : null,
    targetPoints: target,
    pointsCalibrated: calibrated,
    progress: target > 0 ? Math.min(1, calibrated / target) : 0,
    coreProgress: coreTotal > 0 ? Math.min(1, Math.max(0, 1 - coreRemaining / coreTotal)) : 0,
    priceCredits: price,
    creditsPerPoint: target > 0 ? price / target : 0,
    estimatedCoresForReader:
      target > 0 ? coresNeededForTarget([{ quality: 100, quantity: 100000 }], target, readerEfficiency) : null,
    kitsConsumed: job.kits_consumed ?? [],
    paidCredits: job.paid_credits ?? null,
    feeCredits: job.fee_credits ?? null,
    xpAwarded: job.xp_awarded ?? null,
    createdAtMs: ms(job.created_at) ?? 0,
    acceptedAtMs: ms(job.accepted_at),
    completedAtMs: ms(job.completed_at),
    expiresAtMs: ms(job.expires_at),
    lastProgressAtMs: lastProgress,
    reclaimable:
      job.status === 'active' &&
      lastProgress !== null &&
      nowMs - lastProgress >= abandonWindowHours * 3600 * 1000,
    queuePosition,
  };
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Assemble the board for one caller. `jobs` must already include the
 * caller's open/mine/work sets plus every completed shield-tech job
 * (the medians' sample); `shields` resolves any job's shield.
 * `readerEfficiency` is the caller's own shield-tech efficiency —
 * core estimates are priced at the reader's hand, never the poster's.
 */
export function buildShieldTechBoardView(input: {
  callerId: string;
  jobs: ServiceJobData[];
  shields: Map<string, ShieldTechShieldInfo | null>;
  names: Map<string, string | null>;
  nowMs: number;
  abandonWindowHours: number;
  myMastery: { level: number; xp: number };
  readerEfficiency: number;
  levers: ShieldTechBoardView['levers'];
}): ShieldTechBoardView {
  const techJobs = input.jobs.filter((j) => j.profession_id === 'shield_tech');
  // Queue positions: each provider's accepted, unfinished jobs in
  // acceptance order. Only the head job accrues work (the provider's
  // one activity slot targets it); the rest are visibly queued.
  const queuePositions = new Map<string, number>();
  const byProvider = new Map<string, ServiceJobData[]>();
  for (const job of techJobs) {
    if (job.status === 'active' && job.provider_user_id) {
      const list = byProvider.get(job.provider_user_id) ?? [];
      list.push(job);
      byProvider.set(job.provider_user_id, list);
    }
  }
  for (const list of byProvider.values()) {
    list
      .sort((a, b) => (ms(a.accepted_at) ?? 0) - (ms(b.accepted_at) ?? 0) || a.id.localeCompare(b.id))
      .forEach((job, i) => queuePositions.set(job.id, i + 1));
  }
  const view = (job: ServiceJobData) =>
    shieldTechJobView(
      job,
      shieldTechShieldView(job.target_item_instance_id, input.shields.get(job.target_item_instance_id) ?? null),
      input.names,
      input.nowMs,
      input.abandonWindowHours,
      queuePositions.get(job.id) ?? null,
      input.readerEfficiency,
    );

  const open = techJobs
    .filter((j) => j.status === 'listed')
    .sort((a, b) => (ms(a.created_at) ?? 0) - (ms(b.created_at) ?? 0))
    .map(view);
  const mine = techJobs
    .filter((j) => j.owner_user_id === input.callerId)
    .sort((a, b) => (ms(b.created_at) ?? 0) - (ms(a.created_at) ?? 0))
    .map(view);
  const work = techJobs
    .filter((j) => j.provider_user_id === input.callerId)
    .sort((a, b) => (ms(b.accepted_at) ?? 0) - (ms(a.accepted_at) ?? 0))
    .map(view);

  // Median price guidance per rarity band: credits per 1,000 points
  // across completed board jobs whose shield sits in that band.
  const completed = techJobs.filter((j) => j.status === 'completed' && (j.target_points ?? 0) > 0);
  const byRarity = new Map<string, number[]>();
  for (const job of completed) {
    const rarity = input.shields.get(job.target_item_instance_id)?.rarity ?? null;
    if (!rarity) continue;
    const rate = ((job.quoted_price_credits ?? 0) / (job.target_points as number)) * 1000;
    const list = byRarity.get(rarity) ?? [];
    list.push(rate);
    byRarity.set(rarity, list);
  }
  const medianPerThousandByRarity: Record<string, number | null> = {};
  for (const [rarity, rates] of byRarity) {
    medianPerThousandByRarity[rarity] = medianOf(rates);
  }
  return {
    open,
    mine,
    work,
    medianPerThousandByRarity,
    stats: {
      medianSampleSize: completed.length,
      myMasteryLevel: input.myMastery.level,
      myMasteryXp: input.myMastery.xp,
      myJobsCompleted: techJobs.filter(
        (j) => j.provider_user_id === input.callerId && j.status === 'completed',
      ).length,
      myJobsAbandoned: techJobs.filter(
        (j) => j.provider_user_id === input.callerId && j.outcome === 'abandoned',
      ).length,
    },
    levers: input.levers,
  };
}
