/**
 * RepairBoard — the shared view/types for the mechanics & repair
 * services board (migration 0025), assembled identically by the Pg
 * WriteStore (from table rows) and the in-memory WriteStore (from
 * seed state). The board's rules live in src/content/repair.ts and
 * in the cc_repair_* SQL functions; this module only shapes server
 * state for display — it computes no outcomes.
 */
import {
  PATCH_KIT_BASES,
  REPAIR_ABANDON_WINDOW_HOURS_DEFAULT,
  REPAIR_ABANDON_WINDOW_HOURS_MAX,
  REPAIR_ABANDON_WINDOW_HOURS_MIN,
  REPAIR_KIT_TYPES,
  REPAIR_LISTING_EXPIRY_DAYS_DEFAULT,
  REPAIR_LISTING_EXPIRY_DAYS_MAX,
  REPAIR_LISTING_EXPIRY_DAYS_MIN,
  SERVICE_XP_PER_POINT_DEFAULT,
  SERVICE_XP_PER_POINT_MAX,
  SERVICE_XP_PER_POINT_MIN,
  repairKitRestorePoints,
} from '../../content/repair.js';
import {
  applyServiceBoardQuery,
  filterServiceBoardStatus,
  hasServiceBoardFilters,
  type ServiceBoardBrowseFacts,
  type ServiceBoardQuery,
} from '../../lib/market/boardQuery.js';
import {
  repairJobRequirements,
  type RepairJobRequirements,
  type ServiceReaderFacts,
} from './boardRequirements.js';
import { getVehicleClass } from '../../lib/vehicles/vehicles.js';
import type { ServiceJobData } from './store.js';

/** Lever values the board flow reads beyond the craft engine's set. */
export interface RepairLeverValues {
  serviceXpPerPoint: number;
  repairAbandonWindowHours: number;
  repairListingExpiryDays: number;
}

const clampNum = (value: number | undefined, def: number, min: number, max: number): number => {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : def;
  return Math.min(max, Math.max(min, v));
};

/** Merge an injected partial over the code defaults, clamped to the
 *  economy registry ranges — the in-memory mirror of the SQL
 *  functions reading economy_config via cc_economy_config_number. */
export function resolveRepairLevers(partial: Partial<RepairLeverValues> | undefined): RepairLeverValues {
  const p = partial ?? {};
  return {
    serviceXpPerPoint: clampNum(p.serviceXpPerPoint, SERVICE_XP_PER_POINT_DEFAULT, SERVICE_XP_PER_POINT_MIN, SERVICE_XP_PER_POINT_MAX),
    repairAbandonWindowHours: clampNum(
      p.repairAbandonWindowHours,
      REPAIR_ABANDON_WINDOW_HOURS_DEFAULT,
      REPAIR_ABANDON_WINDOW_HOURS_MIN,
      REPAIR_ABANDON_WINDOW_HOURS_MAX,
    ),
    repairListingExpiryDays: clampNum(
      p.repairListingExpiryDays,
      REPAIR_LISTING_EXPIRY_DAYS_DEFAULT,
      REPAIR_LISTING_EXPIRY_DAYS_MIN,
      REPAIR_LISTING_EXPIRY_DAYS_MAX,
    ),
  };
}

export interface RepairVehicleView {
  itemId: string;
  classId: string | null;
  className: string | null;
  rarity: string | null;
  conditionCurrent: number;
  conditionMax: number;
}

export interface RepairKitConsumptionView {
  kitType: string;
  quality: number;
  pointsApplied: number;
}

export interface RepairJobView {
  id: string;
  ownerUserId: string;
  ownerName: string | null;
  providerUserId: string | null;
  providerName: string | null;
  status: string;
  outcome: string | null;
  vehicle: RepairVehicleView | null;
  targetPoints: number;
  pointsRestored: number;
  /** 0..1 of the target restored. */
  progress: number;
  /** 0..1 of the currently open kit already applied. */
  kitProgress: number;
  priceCredits: number;
  creditsPerPoint: number;
  kitType: string | null;
  kitsConsumed: RepairKitConsumptionView[];
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
  /** What taking this job demands of the READER (open postings
   *  only; null on the caller's own lists, where the reader is a
   *  party to the job already). */
  requirements: RepairJobRequirements | null;
}

export interface RepairBoardStats {
  /** Rolling median credits per point across completed board jobs. */
  medianCreditsPerPoint: number | null;
  /** Completed jobs the median is computed from. */
  medianSampleSize: number;
  myMasteryLevel: number;
  myMasteryXp: number;
  myJobsCompleted: number;
  myJobsAbandoned: number;
}

export interface RepairBoardView {
  open: RepairJobView[];
  /** Full count of open postings matching the browse query,
   *  before pagination (equals open.length on an unfiltered read). */
  openTotal: number;
  mine: RepairJobView[];
  work: RepairJobView[];
  stats: RepairBoardStats;
  levers: RepairLeverValues & { marketFeeRate: number };
}

export interface RepairVehicleInfo {
  kind: string;
  payload: Record<string, unknown>;
  rarity: string | null;
  conditionCurrent: number;
  conditionMax: number;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function repairVehicleView(itemId: string, info: RepairVehicleInfo | null): RepairVehicleView | null {
  if (!info) return null;
  const classId = typeof info.payload.vehicleClassId === 'string' ? info.payload.vehicleClassId : null;
  return {
    itemId,
    classId,
    className: getVehicleClass(classId)?.displayName ?? null,
    rarity: info.rarity,
    conditionCurrent: info.conditionCurrent,
    conditionMax: info.conditionMax,
  };
}

export function repairJobView(
  job: ServiceJobData,
  vehicle: RepairVehicleView | null,
  names: Map<string, string | null>,
  nowMs: number,
  abandonWindowHours: number,
  queuePosition: number | null,
  requirements: RepairJobRequirements | null = null,
): RepairJobView {
  const target = job.target_points ?? 0;
  const restored = job.points_restored ?? 0;
  const price = job.quoted_price_credits ?? 0;
  const lastProgress = ms(job.last_progress_at);
  const kitTotal = job.open_kit_total ?? 0;
  const kitRemaining = job.open_kit_capacity ?? 0;
  return {
    id: job.id,
    ownerUserId: job.owner_user_id,
    ownerName: names.get(job.owner_user_id) ?? null,
    providerUserId: job.provider_user_id,
    providerName: job.provider_user_id ? (names.get(job.provider_user_id) ?? null) : null,
    status: job.status,
    outcome: job.outcome ?? null,
    vehicle,
    targetPoints: target,
    pointsRestored: restored,
    progress: target > 0 ? Math.min(1, restored / target) : 0,
    kitProgress: kitTotal > 0 ? Math.min(1, Math.max(0, 1 - kitRemaining / kitTotal)) : 0,
    priceCredits: price,
    creditsPerPoint: target > 0 ? price / target : 0,
    kitType: job.kit_type ?? null,
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
    requirements,
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
 * caller's open/mine/work sets plus every completed repair job (the
 * median's sample); `vehicles` resolves any job's vehicle.
 */
export function buildRepairBoardView(input: {
  callerId: string;
  jobs: ServiceJobData[];
  vehicles: Map<string, RepairVehicleInfo | null>;
  names: Map<string, string | null>;
  nowMs: number;
  abandonWindowHours: number;
  myMastery: { level: number; xp: number };
  levers: RepairBoardView['levers'];
  /** Browse query for the open postings (market-lane parity);
   *  absent/empty = the historic full board, oldest first. */
  query?: ServiceBoardQuery;
  /** The reader's supply/pace facts for the requirements block;
   *  absent = requirements unknown (cards render without them and
   *  the requirements-met filter matches nothing). */
  reader?: ServiceReaderFacts;
}): RepairBoardView {
  const repairJobs = input.jobs.filter((j) => j.profession_id === 'repair');
  // Queue positions: each provider's accepted, unfinished jobs in
  // acceptance order. Only the head job accrues work (the provider's
  // one activity slot targets it); the rest are visibly queued.
  const queuePositions = new Map<string, number>();
  const byProvider = new Map<string, ServiceJobData[]>();
  for (const job of repairJobs) {
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
    repairJobView(
      job,
      repairVehicleView(job.target_item_instance_id, input.vehicles.get(job.target_item_instance_id) ?? null),
      input.names,
      input.nowMs,
      input.abandonWindowHours,
      queuePositions.get(job.id) ?? null,
    );

  // Open postings carry the reader's requirements (what taking the
  // job demands of THEM) and browse facts; the query fold runs over
  // both. An unfiltered read keeps the historic shape — every open
  // job, oldest first — so existing callers see no change.
  const openRows = repairJobs
    .filter((j) => j.status === 'listed')
    .map((job) => {
      const jobView = repairJobView(
        job,
        repairVehicleView(job.target_item_instance_id, input.vehicles.get(job.target_item_instance_id) ?? null),
        input.names,
        input.nowMs,
        input.abandonWindowHours,
        null,
        input.reader
          ? repairJobRequirements({
            ownerUserId: job.owner_user_id,
            callerId: input.callerId,
            targetPoints: job.target_points ?? 0,
            priceCredits: job.quoted_price_credits ?? 0,
            kitTypes: REPAIR_KIT_TYPES,
            kitBase: (kitType) => PATCH_KIT_BASES[kitType] ?? 0,
            kitRestorePoints: repairKitRestorePoints,
            reader: input.reader,
          })
          : null,
      );
      const conditionPct = jobView.vehicle && jobView.vehicle.conditionMax > 0
        ? (jobView.vehicle.conditionCurrent / jobView.vehicle.conditionMax) * 100
        : null;
      const facts: ServiceBoardBrowseFacts = {
        searchText: [
          jobView.vehicle?.className ?? '',
          jobView.vehicle?.classId ?? '',
          jobView.vehicle?.rarity ?? '',
          jobView.ownerName ?? '',
        ].join(' '),
        rarity: jobView.vehicle?.rarity ?? null,
        vehicleClass: jobView.vehicle?.classId ?? null,
        fromBehavior: null,
        toBehavior: null,
        conditionPct,
        conditionKey: conditionPct,
        targetPoints: jobView.targetPoints,
        priceCredits: jobView.priceCredits,
        createdAtMs: jobView.createdAtMs,
        expiresAtMs: jobView.expiresAtMs,
        canTake: jobView.requirements?.canTake ?? false,
      };
      return { job: jobView, facts };
    });
  let open: RepairJobView[];
  let openTotal: number;
  if (hasServiceBoardFilters(input.query)) {
    const page = applyServiceBoardQuery(openRows, input.query ?? {});
    open = page.rows.map((row) => row.job);
    openTotal = page.total;
  } else {
    open = openRows
      .sort((a, b) => a.job.createdAtMs - b.job.createdAtMs)
      .map((row) => row.job);
    openTotal = open.length;
  }
  const mine = filterServiceBoardStatus(
    repairJobs
      .filter((j) => j.owner_user_id === input.callerId)
      .sort((a, b) => (ms(b.created_at) ?? 0) - (ms(a.created_at) ?? 0))
      .map(view),
    input.query,
  );
  const work = filterServiceBoardStatus(
    repairJobs
      .filter((j) => j.provider_user_id === input.callerId)
      .sort((a, b) => (ms(b.accepted_at) ?? 0) - (ms(a.accepted_at) ?? 0))
      .map(view),
    input.query,
  );

  const completed = repairJobs.filter((j) => j.status === 'completed' && (j.target_points ?? 0) > 0);
  const rates = completed.map((j) => (j.quoted_price_credits ?? 0) / (j.target_points as number));
  return {
    open,
    openTotal,
    mine,
    work,
    stats: {
      medianCreditsPerPoint: medianOf(rates),
      medianSampleSize: completed.length,
      myMasteryLevel: input.myMastery.level,
      myMasteryXp: input.myMastery.xp,
      myJobsCompleted: repairJobs.filter(
        (j) => j.provider_user_id === input.callerId && j.status === 'completed',
      ).length,
      myJobsAbandoned: repairJobs.filter(
        (j) => j.provider_user_id === input.callerId && j.outcome === 'abandoned',
      ).length,
    },
    levers: input.levers,
  };
}
