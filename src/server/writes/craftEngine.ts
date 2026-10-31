/**
 * CraftEngine — the shared TypeScript implementation of the crafting
 * job model (brief §2.1–§2.7), used by the in-memory WriteStore and
 * the in-memory gameplay store. The production path is the SQL twin
 * in db/migrations/0024_crafting_occupation.sql (cc_enqueue_craft_job,
 * cc_settle_craft_jobs, cc_cancel_craft_job, cc_unlock_bench,
 * cc_craft_recipe, cc_craft_quality_bounds); the two implementations
 * are pinned to each other by the parity tests, and the SQL is
 * exercised against embedded Postgres in the slice verification.
 *
 * Rules that live here (and in the SQL twin, nowhere else):
 *   - progress accrues ONLY while `crafting` is the active action,
 *     from server timestamps; every settle rebases last_settled_ms so
 *     paused time can never accrue later;
 *   - the away portion of a settle delta (past the activity
 *     heartbeat + grace) is capped by the effective offline cap (F5);
 *     attended time is never truncated;
 *   - escrow at enqueue is atomic (all inputs verified, then taken);
 *   - XP pays per completed unit at the level held at completion,
 *     through the §2.3 formula; quality rolls at completion through
 *     the §2.4 bounds function; gear is Epic-capped, provenance-
 *     stamped, and never carries a legendaryEffectId.
 */
import {
  benchDef,
  catalystForRecipe,
  CATALYST_REQUIRES_BENCH,
  CORE_CATALYST_CORES_PER_UNIT,
  CORE_CATALYST_DRAWS_BONUS,
  composedCraftQualityShift,
  consumableEfficiencyDurationMultiplier,
  craftMasteryForKind,
  craftQualityBounds,
  craftUnitXp,
  CRAFTABLE_GEAR_RARITIES,
  EPIC_FRAME_GEAR_MASTERY,
  fixerCraftSpeedDurationMultiplier,
  gearRarityRequiresBench,
  gearTemperChance,
  getCraftRecipe,
  isMaterialInput,
  MAX_UNITS_PER_JOB,
  qualityMasteryTrackForKind,
  QUEUED_JOBS_PER_BENCH,
  refineOutputCount,
  rollCraftQuality,
  rushTicketTimeReduction,
  toolDef,
  type CraftJobKind,
  type CraftRecipe,
} from '../../content/crafting.js';
import { effectiveOfflineCapHours } from '../../content/offlineCap.js';
import {
  MAX_ACTIVE_REPAIR_JOBS,
  PATCH_KIT_BASES,
  REPAIR_BENCH,
  REPAIR_KIT_TYPES,
  REPAIR_MASTERY_TRACK,
  REPAIR_RECIPE_BY_KIT,
  repairEfficiencyWithSkill,
  repairKitRestorePoints,
  repairKitUnitDurationMs,
  repairMasteryXp,
  repairWorkRatePointsPerHour,
} from '../../content/repair.js';
import { Rarity } from '../../types/game.js';
import { applyXp } from './store.js';
import {
  generateCraftedGearItem,
  type CraftedGearCandidate,
  type CraftGearSlot,
} from './craftGear.js';

export class CraftEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CraftEngineError';
  }
}

function fail(message: string): never {
  throw new CraftEngineError(message);
}

// ─── Records ─────────────────────────────────────────────────────────

export interface CraftJobSnapshot {
  toolId: string | null;
  toolQualityMultiplier: number;
  toolDurationMultiplier: number;
  toolRefineYieldBonus: number;
  toolBonusUnitChance: number;
  skillDurationMultiplier: number;
  rushReduction: number;
  craftTimeScalar: number;
  catalystMaterialId: string | null;
  /** Legendary Core Catalyst (0026): gear jobs only; +2 draws/unit. */
  coreCatalyst?: boolean;
  /** The Fixer keystone's core-catalyst draw bonus (0029), snapshotted
   *  at enqueue beside coreCatalyst: core-catalyst gear units draw
   *  CORE_CATALYST_DRAWS_BONUS + this many generation candidates. */
  coreCatalystDrawBonus?: number;
  gearRarity: string | null;
  /** Repair jobs only (kind 'repair', mechanics slice 0025): the
   *  vehicle being restored, the patch kits escrowed at enqueue (one
   *  quality/origin record per unit, in burn order), and the rate /
   *  efficiency snapshot priced from the owner's repair mastery at
   *  enqueue time. */
  repair?: CraftRepairSnapshot;
}

export interface CraftRepairSnapshot {
  itemId: string;
  kitType: string;
  kitBase: number;
  kitQualities: number[];
  kitOrigins: string[];
  efficiency: number;
  workRatePointsPerHour: number;
  masteryLevel: number;
}

export interface CraftJobOutput {
  unit: number;
  kind: CraftJobKind;
  xp: number;
  /** Settle instant (epoch ms) — the unit's production stamp; the
   *  economy metrics attribute units/XP to this day. */
  completedAtMs: number;
  consumableType?: string;
  quality?: number;
  quantity?: number;
  bonusUnit?: boolean;
  outputMaterial?: string;
  outputQuantity?: number;
  itemId?: string;
  rarity?: string;
  tempered?: boolean;
  toolId?: string;
  /** Repair units: condition points this unit actually restored. */
  pointsRestored?: number;
  /** Repair units: vehicle condition after this unit landed. */
  conditionCurrent?: number;
  /** Settler-internal signal: the vehicle was already at full
   *  condition when this unit would have started, so the job ends
   *  early and every unstarted kit is refunded. Never persisted as
   *  a completion output. */
  vehicleFull?: boolean;
}

export interface CraftJobRecord {
  id: string;
  owner_user_id: string;
  bench: number;
  kind: CraftJobKind;
  recipe_id: string;
  units_total: number;
  units_completed: number;
  unit_duration_ms: number;
  /** Progress inside the current unit (0..unit_duration_ms). */
  accrued_ms: number;
  status: 'active' | 'complete' | 'cancelled';
  /** Per-unit inputs × units (the full escrow taken at enqueue). */
  escrow_inputs: Record<string, number>;
  escrow_catalyst: Record<string, number>;
  /** Legendary cores escrowed at enqueue (0026); refunded on cancel. */
  escrow_cores?: number;
  rush_ticket_quality: number | null;
  rush_ticket_origin: string | null;
  snapshot: CraftJobSnapshot;
  xp_awarded: number;
  outputs: CraftJobOutput[];
  tool_charged: boolean;
  created_at_ms: number;
  last_settled_ms: number;
  completed_at_ms: number | null;
}

export interface WorkshopToolsState {
  owned: Record<string, boolean>;
  fitted: Record<string, string | null>;
  charges: Record<string, number>;
}

export interface CraftProfileView {
  player_level: number;
  player_xp: number;
  credits: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
  consumables: Record<string, number>;
  workshop_benches: number;
  /** Legendary core balance (0026); mirrors profiles.legendary_cores. */
  legendary_cores: number;
  workshop_tools: WorkshopToolsState;
  offline_cap_hours: number | null;
}

export interface CraftLeverValues {
  craftXpRate: number;
  craftTimeScalar: number;
  craftQualityShift: number;
  gearTemperBaseChance: number;
  refineBaseYield: number;
  /** Repair levers (0025); defaults in src/content/repair.ts. */
  repairWorkRateBase: number;
  repairMasterySpeedPerLevel: number;
  repairMasteryEfficiencyPerLevel: number;
}

export interface CraftAdapter {
  nowMs(): number;
  rng(): number;
  uuid(): string;
  profile(playerId: string): CraftProfileView | null;
  activeAction(playerId: string): { kind: string; lastHeartbeatMs: number | null } | null;
  jobs(playerId: string): CraftJobRecord[];
  addJob(job: CraftJobRecord): void;
  masteryLevel(playerId: string, track: string): number;
  /** One aggregated skill-bonus total (computeSkillBonuses key) for
   *  the player, derived by the store from the player's OWN records
   *  (skill_spends + equipped class mod). Optional: adapters that
   *  predate the Fixer tree (0029) read as 0 — every Fixer term is
   *  additive over the pre-Fixer behavior at 0. */
  skillBonus?(playerId: string, key: string): number;
  addMasteryXp(playerId: string, track: string, xp: number): void;
  addStat(playerId: string, key: string, amount: number): void;
  /** Add a consumable batch and bump the profile count with it. */
  addBatch(
    playerId: string,
    type: string,
    qty: number,
    quality: number,
    origin: string,
    creatorId: string | null,
    recipeId: string | null,
  ): void;
  /** FIFO-burn one unit (batch + count); returns what was burned. */
  burnOneBatchUnit(playerId: string, type: string): { quality: number; origin: string } | null;
  /** Insert a generated gear item; returns the new item id. */
  insertGearItem(playerId: string, candidate: CraftedGearCandidate): string;
  /** Repair jobs: read one owned item's repair-relevant state. */
  vehicleInfo(
    playerId: string,
    itemId: string,
  ): { kind: string; runtimeState: string; conditionCurrent: number; conditionMax: number } | null;
  /** Repair jobs: restore condition points (clamped at max) and
   *  return the resulting condition state. */
  restoreVehicle(
    playerId: string,
    itemId: string,
    points: number,
  ): { conditionCurrent: number; conditionMax: number } | null;
  levers(): CraftLeverValues;
}

// ─── Settler (§2.1) ──────────────────────────────────────────────────

/** Heartbeats land every ~60s while the Action screen is mounted;
 *  five minutes of grace marks the boundary between attended time
 *  and away time for the offline cap. */
export const CRAFT_HEARTBEAT_GRACE_MS = 5 * 60 * 1000;

export interface CraftSettleResult {
  settled: boolean;
  reason?: string;
  advancedMs: number;
  xpAwarded: number;
  jobsCompleted: number;
  completions: Array<CraftJobOutput & { jobId: string; recipeId: string }>;
}

/** The internal away-cap when no caller passes one: the earned tier +
 *  limiter + 24h ceiling, WITHOUT the Scavenger keystone bonus (the
 *  settle-offline route passes the exact cap including the bonus).
 *  Conservative by construction — it can only under-pay the rare
 *  direct-to-Workshop login path, never over-pay. */
function internalAwayCapMs(profile: CraftProfileView): number {
  const hours = effectiveOfflineCapHours({
    level: profile.player_level,
    bonusHours: 0,
    userCapHours: profile.offline_cap_hours,
    ceilingHours: 24,
  });
  return hours * 3600 * 1000;
}

export function settleCraftJobs(
  adapter: CraftAdapter,
  playerId: string,
  opts: { maxAdvanceMs?: number } = {},
): CraftSettleResult {
  const profile = adapter.profile(playerId);
  if (!profile) return { settled: false, reason: 'no_profile', advancedMs: 0, xpAwarded: 0, jobsCompleted: 0, completions: [] };
  const now = adapter.nowMs();
  const action = adapter.activeAction(playerId);
  const jobs = adapter
    .jobs(playerId)
    .filter((j) => j.status === 'active')
    .sort((a, b) => a.created_at_ms - b.created_at_ms || a.id.localeCompare(b.id));

  // Rebase every active job first: whatever happens below, paused or
  // capped time is consumed by THIS settle and can never accrue later.
  // Each job advances only in its own lane (0025): craft kinds under
  // the `crafting` action, repair jobs under `workshop_service`.
  const heartbeatMs = action?.lastHeartbeatMs ?? null;
  const perJobAdvance = new Map<string, number>();
  let maxAdvance = 0;
  for (const job of jobs) {
    const startMs = job.last_settled_ms;
    const rawDelta = Math.max(0, now - startMs);
    job.last_settled_ms = now;
    const lane = job.kind === 'repair' ? 'workshop_service' : 'crafting';
    if (!action || action.kind !== lane || rawDelta <= 0) {
      perJobAdvance.set(job.id, 0);
      continue;
    }
    let advance: number;
    if (opts.maxAdvanceMs !== undefined) {
      // Offline settlement (F5): the caller computed the effective
      // cap from server records and the WHOLE away window is capped
      // by it — the same rule cc_settle_offline_roaming applies.
      advance = Math.min(rawDelta, Math.max(0, opts.maxAdvanceMs));
    } else {
      // Lazy settle (reads, transitions, craft ops): attended time —
      // up to the last activity heartbeat + grace — is never
      // truncated; only the away tail is capped, by the internal
      // (keystone-less) effective cap.
      const attendedMs = Math.min(
        rawDelta,
        Math.max(0, (heartbeatMs ?? startMs) + CRAFT_HEARTBEAT_GRACE_MS - startMs),
      );
      const awayMs = rawDelta - attendedMs;
      advance = attendedMs + Math.min(awayMs, internalAwayCapMs(profile));
    }
    perJobAdvance.set(job.id, advance);
    maxAdvance = Math.max(maxAdvance, advance);
  }

  const result: CraftSettleResult = {
    settled: true,
    advancedMs: maxAdvance,
    xpAwarded: 0,
    jobsCompleted: 0,
    completions: [],
  };
  if (!action || (action.kind !== 'crafting' && action.kind !== 'workshop_service')) return result;

  const levers = adapter.levers();
  const benches = new Map<number, CraftJobRecord[]>();
  for (const job of jobs) {
    const list = benches.get(job.bench) ?? [];
    list.push(job);
    benches.set(job.bench, list);
  }

  for (const benchJobs of benches.values()) {
    // Every job on a bench shares the same settle window; the queue
    // consumes it in order and leftover flows to the next job.
    let budget = Math.max(...benchJobs.map((j) => perJobAdvance.get(j.id) ?? 0), 0);
    for (const job of benchJobs) {
      if (budget <= 0) break;
      if (job.status !== 'active') continue;
      // A fitted tool's charge is spent when the job actually starts.
      if (!job.tool_charged && job.snapshot.toolId) {
        job.tool_charged = true;
        consumeToolCharge(profile, job.snapshot.toolId);
      }
      while (budget > 0 && job.units_completed < job.units_total) {
        const need = job.unit_duration_ms - job.accrued_ms;
        if (budget < need) {
          job.accrued_ms += budget;
          budget = 0;
        } else {
          budget -= need;
          job.accrued_ms = 0;
          const output = completeCraftUnit(adapter, profile, job, levers);
          if (output.vehicleFull) {
            // Repair job whose vehicle reached full condition before
            // this unit started: end the job and refund every kit
            // that never got applied, at its escrowed quality.
            refundRemainingRepairKits(adapter, job);
            job.status = 'complete';
            job.completed_at_ms = now;
            result.jobsCompleted += 1;
            break;
          }
          result.xpAwarded += output.xp;
          result.completions.push({ ...output, jobId: job.id, recipeId: job.recipe_id });
        }
      }
      if (job.units_completed >= job.units_total) {
        job.status = 'complete';
        job.completed_at_ms = now;
        result.jobsCompleted += 1;
      }
    }
  }
  return result;
}

export interface OverclockFireResult {
  completions: Array<CraftJobOutput & { jobId: string; recipeId: string }>;
  jobsCompleted: number;
  xpAwarded: number;
}

/**
 * Overclock workshop fire (Action Skill slice, 0030; Fixer brief
 * §3.7): instantly complete the IN-PROGRESS unit on every active
 * bench — the head job of each bench — through the very same
 * completeCraftUnit the settler uses (same outputs, same quality
 * roll, same pegged XP, same tool-charge spend on a job's first
 * unit). It buys time, never output: exactly one unit per bench,
 * regardless of how much time that unit still had left. The SQL twin
 * is cc_fire_overclock_workshop looping cc_complete_craft_unit.
 * Action-lane and offline-cap rules do NOT apply — the fire is an
 * instant discharge, not a settlement window.
 */
export function overclockCompleteInProgressUnits(
  adapter: CraftAdapter,
  playerId: string,
): OverclockFireResult {
  const result: OverclockFireResult = { completions: [], jobsCompleted: 0, xpAwarded: 0 };
  const profile = adapter.profile(playerId);
  if (!profile) return result;
  const now = adapter.nowMs();
  const levers = adapter.levers();
  const jobs = adapter
    .jobs(playerId)
    .filter((j) => j.status === 'active' && j.units_completed < j.units_total)
    .sort((a, b) => a.created_at_ms - b.created_at_ms || a.id.localeCompare(b.id));
  const benchesSeen = new Set<number>();
  for (const job of jobs) {
    if (benchesSeen.has(job.bench)) continue;
    benchesSeen.add(job.bench);
    // A fitted tool's charge is spent when the job actually starts —
    // the settler's rule, mirrored for a fire that starts the unit.
    if (!job.tool_charged && job.snapshot.toolId) {
      job.tool_charged = true;
      consumeToolCharge(profile, job.snapshot.toolId);
    }
    job.accrued_ms = 0;
    const output = completeCraftUnit(adapter, profile, job, levers);
    if (output.vehicleFull) {
      refundRemainingRepairKits(adapter, job);
      job.status = 'complete';
      job.completed_at_ms = now;
      result.jobsCompleted += 1;
      continue;
    }
    result.xpAwarded += output.xp;
    result.completions.push({ ...output, jobId: job.id, recipeId: job.recipe_id });
    if (job.units_completed >= job.units_total) {
      job.status = 'complete';
      job.completed_at_ms = now;
      result.jobsCompleted += 1;
    }
  }
  return result;
}

function consumeToolCharge(profile: CraftProfileView, toolId: string): void {
  const tools = profile.workshop_tools;
  const charges = (tools.charges[toolId] ?? 0) - 1;
  tools.charges[toolId] = Math.max(0, charges);
  if (charges <= 0) {
    tools.owned[toolId] = false;
    for (const bench of Object.keys(tools.fitted)) {
      if (tools.fitted[bench] === toolId) tools.fitted[bench] = null;
    }
  }
}

/** Refund every kit a repair job escrowed but never applied (early
 *  completion at full condition, or cancellation), each as a batch at
 *  its recorded quality and origin. */
function refundRemainingRepairKits(adapter: CraftAdapter, job: CraftJobRecord): number {
  const snap = job.snapshot.repair;
  if (!snap) return 0;
  let refunded = 0;
  for (let i = job.units_completed; i < job.units_total; i += 1) {
    adapter.addBatch(
      job.owner_user_id,
      snap.kitType,
      1,
      snap.kitQualities[i] ?? 100,
      snap.kitOrigins[i] ?? 'crafted',
      job.owner_user_id,
      null,
    );
    refunded += 1;
  }
  return refunded;
}

/**
 * One self-repair unit (0025): apply the next escrowed patch kit to
 * the vehicle. Restoration = kit base × kit quality% × the owner's
 * repair-mastery efficiency snapshot, clamped at the vehicle's max;
 * the partially-wasted kit at full condition is spent (a kit is a
 * consumable, §2.4's board rule is the same). Self-repair pays NO
 * player XP — it is consumption (brief §2.7) — but it trains the
 * repair mastery by the points actually restored, because mastery is
 * what makes self-repair faster and it must be trainable solo.
 */
function completeRepairUnit(
  adapter: CraftAdapter,
  job: CraftJobRecord,
): CraftJobOutput {
  const snap = job.snapshot.repair;
  if (!snap) fail('Repair job snapshot missing');
  const playerId = job.owner_user_id;
  const unit = job.units_completed + 1;
  const output: CraftJobOutput = { unit, kind: 'repair', xp: 0, completedAtMs: adapter.nowMs() };

  const info = adapter.vehicleInfo(playerId, snap.itemId);
  if (
    !info ||
    info.kind !== 'vehicle' ||
    info.conditionCurrent >= info.conditionMax ||
    ['listed', 'consumed', 'salvaged', 'in_service'].includes(info.runtimeState)
  ) {
    // Vehicle gone, no longer a vehicle, already whole, or not in the
    // owner's hands (listed / in board service): the unit never
    // starts; the settler refunds this and all later kits.
    output.vehicleFull = true;
    return output;
  }
  const quality = snap.kitQualities[job.units_completed] ?? 100;
  const restore = repairKitRestorePoints(snap.kitBase, quality, snap.efficiency);
  const after = adapter.restoreVehicle(playerId, snap.itemId, restore);
  const restored = after
    ? Math.round((after.conditionCurrent - info.conditionCurrent) * 100) / 100
    : 0;
  if (restored > 0) {
    adapter.addMasteryXp(playerId, REPAIR_MASTERY_TRACK, repairMasteryXp(restored));
  }
  output.itemId = snap.itemId;
  output.quality = quality;
  output.pointsRestored = restored;
  output.conditionCurrent = after?.conditionCurrent;
  job.units_completed += 1;
  job.outputs.push(output);
  return output;
}

function completeCraftUnit(
  adapter: CraftAdapter,
  profile: CraftProfileView,
  job: CraftJobRecord,
  levers: CraftLeverValues,
): CraftJobOutput {
  if (job.kind === 'repair') return completeRepairUnit(adapter, job);
  const recipe = getCraftRecipe(job.recipe_id) as CraftRecipe;
  const unit = job.units_completed + 1;
  const playerId = job.owner_user_id;
  // All completion reads (XP level, mastery-driven bounds/yield,
  // item level) snapshot the state at the unit's completion instant;
  // this unit's own XP and mastery land after its output is priced.
  const xp = craftUnitXp(job.unit_duration_ms, profile.player_level, levers.craftXpRate);
  const output: CraftJobOutput = { unit, kind: job.kind, xp, completedAtMs: adapter.nowMs() };

  if (job.kind === 'consumable' && recipe.consumableType) {
    const masteryLevel = adapter.masteryLevel(playerId, qualityMasteryTrackForKind(job.kind));
    const bounds = craftQualityBounds({
      consumableType: recipe.consumableType,
      masteryLevel,
      bench: job.bench,
      catalyst: !!job.snapshot.catalystMaterialId,
      // The composed shift (0029): lever + the Fixer craftQualityBonus
      // total, read from the crafter's records at completion, under
      // the one [−10, +20] clamp (composedCraftQualityShift).
      qualityShift: composedCraftQualityShift(
        levers.craftQualityShift,
        adapter.skillBonus?.(playerId, 'craftQualityBonus') ?? 0,
      ),
    });
    const quality = rollCraftQuality(bounds, job.bench, adapter.rng, job.snapshot.toolQualityMultiplier);
    let quantity = 1;
    let bonusUnit = false;
    if (job.snapshot.toolBonusUnitChance > 0 && adapter.rng() < job.snapshot.toolBonusUnitChance) {
      quantity = 2;
      bonusUnit = true;
    }
    adapter.addBatch(playerId, recipe.consumableType, quantity, quality, 'crafted', playerId, recipe.id);
    adapter.addStat(playerId, 'consumables_crafted', quantity);
    output.consumableType = recipe.consumableType;
    output.quality = quality;
    output.quantity = quantity;
    output.bonusUnit = bonusUnit;
  } else if (job.kind === 'refine' && recipe.outputMaterial) {
    const masteryLevel = adapter.masteryLevel(playerId, 'crafting.refining');
    const count = refineOutputCount(recipe, masteryLevel, levers.refineBaseYield, job.snapshot.toolRefineYieldBonus);
    profile.materials[recipe.outputMaterial] = (profile.materials[recipe.outputMaterial] ?? 0) + count;
    output.outputMaterial = recipe.outputMaterial;
    output.outputQuantity = count;
  } else if (job.kind === 'gear' && recipe.gearSlot) {
    const gearLevel = adapter.masteryLevel(playerId, 'crafting.gear');
    const rarity = (job.snapshot.gearRarity ?? Rarity.Common) as Rarity;
    const tempered = adapter.rng() < gearTemperChance(
      gearLevel,
      levers.gearTemperBaseChance,
      adapter.skillBonus?.(playerId, 'craftTemperBonus') ?? 0,
    );
    const candidate = generateCraftedGearItem({
      slot: recipe.gearSlot as CraftGearSlot,
      rarity,
      itemLevel: profile.player_level,
      creatorId: playerId,
      // Core catalyst (0026): +2 draws on top of the temper lever;
      // the Fixer keystone (0029) adds its snapshotted draw bonus.
      draws: (tempered ? 3 : 1)
        + (job.snapshot.coreCatalyst
          ? CORE_CATALYST_DRAWS_BONUS + (job.snapshot.coreCatalystDrawBonus ?? 0)
          : 0),
      rng: adapter.rng,
    });
    output.itemId = adapter.insertGearItem(playerId, candidate);
    output.rarity = candidate.rarity;
    output.tempered = tempered;
  } else if (job.kind === 'tool' && recipe.toolId) {
    const def = toolDef(recipe.toolId);
    profile.workshop_tools.owned[recipe.toolId] = true;
    profile.workshop_tools.charges[recipe.toolId] = def?.durabilityJobs ?? 25;
    output.toolId = recipe.toolId;
  }

  const mastery = craftMasteryForKind(job.kind);
  adapter.addMasteryXp(playerId, mastery.track, mastery.xpPerUnit);
  const next = applyXp(profile.player_level, profile.player_xp, xp);
  profile.player_level = next.player_level;
  profile.player_xp = next.player_xp;
  job.units_completed += 1;
  job.xp_awarded += xp;
  job.outputs.push(output);
  return output;
}

// ─── Enqueue (§2.1 escrow, §2.2/§2.5 gates, §2.7 skill consumer) ────

/** The Fixer enqueue-time bonus totals (migration 0029), derived by
 *  the store from server records exactly like consumableEfficiency
 *  Bonus — the request body never carries them. */
export interface FixerEnqueueBonuses {
  craftSpeedBonus: number;
  workshopQueueBonus: number;
  rushReductionCapBonus: number;
  coreCatalystDrawBonus: number;
}

export interface EnqueueCraftJobInput {
  bench: number;
  recipeId: string;
  units: number;
  rarity?: string | null;
  useCatalyst?: boolean;
  useCoreCatalyst?: boolean;
  useRushTicket?: boolean;
  /** computeSkillBonuses total for consumableEfficiency (server-derived). */
  consumableEfficiencyBonus: number;
  /** Fixer totals (server-derived); absent reads as all-zero. */
  fixerBonuses?: FixerEnqueueBonuses;
}

export function enqueueCraftJob(
  adapter: CraftAdapter,
  playerId: string,
  input: EnqueueCraftJobInput,
): { job: CraftJobRecord } {
  // Settle first: gates and snapshots read post-settle state.
  settleCraftJobs(adapter, playerId);
  const profile = adapter.profile(playerId);
  if (!profile) fail('Profile not found');
  const p = profile as CraftProfileView;

  const recipe = getCraftRecipe(input.recipeId);
  if (!recipe) fail('Unknown craft recipe');
  const r = recipe as CraftRecipe;

  const units = Math.floor(input.units);
  if (!Number.isFinite(units) || units < 1) fail('units must be a positive integer');
  if (units > MAX_UNITS_PER_JOB) fail(`units exceeds the per-job maximum of ${MAX_UNITS_PER_JOB}`);

  const bench = Math.floor(input.bench);
  if (!Number.isFinite(bench) || bench < 1 || bench > 3) fail('bench must be 1, 2 or 3');
  if (bench > p.workshop_benches) fail('Bench not unlocked');
  if (bench < r.requiresBench) fail(`Recipe requires bench ${r.requiresBench} or higher`);
  if (p.player_level < r.requiresLevel) fail(`Requires level ${r.requiresLevel}`);
  if (r.requiresMastery && adapter.masteryLevel(playerId, r.requiresMastery.track) < r.requiresMastery.level) {
    fail(`Requires ${r.requiresMastery.track} mastery ${r.requiresMastery.level}`);
  }

  // Gear rarity: forced at enqueue, Epic-capped by law.
  let gearRarity: Rarity | null = null;
  if (r.kind === 'gear') {
    const rarity = (input.rarity ?? '') as Rarity;
    if (!CRAFTABLE_GEAR_RARITIES.includes(rarity)) {
      fail(rarity === Rarity.Legendary ? 'Legendary gear cannot be crafted' : 'A craftable rarity (Common–Epic) is required');
    }
    gearRarity = rarity;
    if (bench < gearRarityRequiresBench(rarity)) {
      fail(`${rarity} frames require bench ${gearRarityRequiresBench(rarity)}`);
    }
    if (rarity === Rarity.Epic && adapter.masteryLevel(playerId, 'crafting.gear') < EPIC_FRAME_GEAR_MASTERY) {
      fail(`Epic frames require crafting.gear mastery ${EPIC_FRAME_GEAR_MASTERY}`);
    }
  }

  // Tools are unique workshop assets: no duplicates owned or queued.
  if (r.kind === 'tool' && r.toolId) {
    if (p.workshop_tools.owned[r.toolId]) fail('Tool already fitted in the workshop');
    const queued = adapter.jobs(playerId).some((j) => j.status === 'active' && j.recipe_id === r.id);
    if (queued) fail('A job for this tool is already queued');
  }

  // Queue capacity: one running + QUEUED_JOBS_PER_BENCH waiting, plus
  // the Fixer keystone's workshopQueueBonus (0029) — derived from the
  // player's records by the store, snapshotted implicitly by the gate.
  const fixer = input.fixerBonuses;
  const queueBonus = Math.max(0, Math.floor(fixer?.workshopQueueBonus ?? 0));
  const benchActive = adapter
    .jobs(playerId)
    .filter((j) => j.status === 'active' && j.bench === bench).length;
  if (benchActive >= 1 + QUEUED_JOBS_PER_BENCH + queueBonus) fail('Bench queue is full');

  // Catalyst (optional, Forge-gated).
  let catalystMaterialId: string | null = null;
  if (input.useCatalyst) {
    catalystMaterialId = catalystForRecipe(r);
    if (!catalystMaterialId) fail('Recipe takes no catalyst');
    if (bench < CATALYST_REQUIRES_BENCH) fail('Catalysts require the Forge (bench 2)');
  }

  // Legendary Core Catalyst (0026): gear frames only, one core per
  // unit escrowed at enqueue; mutually exclusive with the material
  // catalyst and Forge-gated like it (migration 0026's SQL twin
  // carries the same gates and messages).
  let coreCatalyst = false;
  let escrowCores = 0;
  if (input.useCoreCatalyst) {
    if (catalystMaterialId) fail('Choose one catalyst: material or legendary core');
    if (r.kind !== 'gear') fail('Legendary core catalyst applies to gear frames only');
    if (bench < CATALYST_REQUIRES_BENCH) fail('Catalysts require the Forge (bench 2)');
    coreCatalyst = true;
    escrowCores = units * CORE_CATALYST_CORES_PER_UNIT;
  }

  // Verify the full escrow before taking any of it (atomicity).
  const escrowInputs: Record<string, number> = {};
  for (const [key, perUnit] of Object.entries(r.inputs)) {
    escrowInputs[key] = perUnit * units;
    const available = isMaterialInput(key) ? (p.materials[key] ?? 0) : (p.essences[key] ?? 0);
    if (available < escrowInputs[key]) {
      fail(isMaterialInput(key) ? `Insufficient material ${key}` : `Insufficient essence ${key}`);
    }
  }
  const escrowCatalyst: Record<string, number> = {};
  if (catalystMaterialId) {
    escrowCatalyst[catalystMaterialId] = units;
    if ((p.materials[catalystMaterialId] ?? 0) < units) fail(`Insufficient material ${catalystMaterialId}`);
  }
  if (escrowCores > 0 && (p.legendary_cores ?? 0) < escrowCores) {
    fail('Insufficient legendary cores');
  }
  if (input.useRushTicket && (p.consumables['WorkshopRushTicket'] ?? 0) < 1) {
    fail('No Workshop Rush Ticket available');
  }

  // Fitted tool snapshot for this bench.
  const fittedToolId = p.workshop_tools.fitted[String(bench)] ?? null;
  const fittedDef = fittedToolId && (p.workshop_tools.charges[fittedToolId] ?? 0) > 0 ? toolDef(fittedToolId) : undefined;

  // Rush ticket: escrowed at enqueue, burned when the job starts —
  // the escrow takes it out of inventory now (FIFO, lowest quality
  // first, the shipped burn order); its quality prices the reduction.
  let rushTicketQuality: number | null = null;
  let rushTicketOrigin: string | null = null;
  let rushReduction = 0;
  if (input.useRushTicket) {
    const burned = adapter.burnOneBatchUnit(playerId, 'WorkshopRushTicket');
    if (!burned) fail('No Workshop Rush Ticket available');
    rushTicketQuality = burned.quality;
    rushTicketOrigin = burned.origin;
    // The reduction formula is the SQL twin's clamp (0029): the
    // Fixer keystone's rushReductionCapBonus raises the 0.45 cap.
    rushReduction = rushTicketTimeReduction(burned.quality, fixer?.rushReductionCapBonus ?? 0);
  }

  // Take the escrow.
  for (const [key, total] of Object.entries(escrowInputs)) {
    if (isMaterialInput(key)) p.materials[key] = (p.materials[key] ?? 0) - total;
    else p.essences[key] = (p.essences[key] ?? 0) - total;
  }
  for (const [key, total] of Object.entries(escrowCatalyst)) {
    p.materials[key] = (p.materials[key] ?? 0) - total;
  }
  if (escrowCores > 0) {
    p.legendary_cores = (p.legendary_cores ?? 0) - escrowCores;
  }

  // Snapshotted unit duration: base × skill × tool × scalar × rush.
  const levers = adapter.levers();
  const baseDuration = r.kind === 'gear' && gearRarity
    ? (r.durationByRarityMs?.[gearRarity] ?? 0)
    : r.unitDurationMs;
  // Skill duration terms compose MULTIPLICATIVELY (0029): the
  // Scavenger consumableEfficiency term × the Fixer craftSpeedBonus
  // term, under a combined 0.60× floor (0.80 × 0.75 at both caps).
  const skillMultiplier = Math.max(
    0.6,
    consumableEfficiencyDurationMultiplier(input.consumableEfficiencyBonus)
      * fixerCraftSpeedDurationMultiplier(fixer?.craftSpeedBonus ?? 0),
  );
  const toolDurationMultiplier = fittedDef?.durationMultiplier ?? 1;
  const unitDurationMs = Math.max(
    1,
    Math.round(baseDuration * skillMultiplier * toolDurationMultiplier * levers.craftTimeScalar * (1 - rushReduction)),
  );

  const now = adapter.nowMs();
  const job: CraftJobRecord = {
    id: adapter.uuid(),
    owner_user_id: playerId,
    bench,
    kind: r.kind,
    recipe_id: r.id,
    units_total: units,
    units_completed: 0,
    unit_duration_ms: unitDurationMs,
    accrued_ms: 0,
    status: 'active',
    escrow_inputs: escrowInputs,
    escrow_catalyst: escrowCatalyst,
    escrow_cores: escrowCores,
    rush_ticket_quality: rushTicketQuality,
    rush_ticket_origin: rushTicketOrigin,
    snapshot: {
      toolId: fittedDef ? fittedToolId : null,
      toolQualityMultiplier: fittedDef?.qualityMultiplier ?? 1,
      toolDurationMultiplier,
      toolRefineYieldBonus: fittedDef?.refineYieldBonus ?? 0,
      toolBonusUnitChance: fittedDef?.bonusUnitChance ?? 0,
      skillDurationMultiplier: skillMultiplier,
      rushReduction,
      craftTimeScalar: levers.craftTimeScalar,
      catalystMaterialId,
      coreCatalyst,
      coreCatalystDrawBonus: Math.max(0, Math.floor(fixer?.coreCatalystDrawBonus ?? 0)),
      gearRarity: gearRarity ? String(gearRarity) : null,
    },
    xp_awarded: 0,
    outputs: [],
    tool_charged: false,
    created_at_ms: now,
    last_settled_ms: now,
    completed_at_ms: null,
  };
  adapter.addJob(job);
  return { job };
}

// ─── Self-repair enqueue (0025; crafting brief §2.1's repair kind) ──

export interface EnqueueRepairJobInput {
  itemId: string;
  kitType: string;
  units: number;
}

/**
 * Self-repair as a TIMED job (F2 resolution): the owner's own patch
 * kits are escrowed at enqueue — burned FIFO (worst quality first,
 * the shipped burn order) with each unit's quality/origin recorded —
 * and applied one at a time while `workshop_service` is the active
 * action. The unit duration is snapshotted from the owner's repair
 * mastery: untrained, a 30-point kit occupies the slot for 1.5 hours
 * at the base rate; mastery raises the rate (points/hour) and the
 * per-kit restoration. Anyone may self-repair — the edge is time and
 * efficiency, never permission — so there is deliberately no account
 * gate here (consumption, like refuel).
 */
export function enqueueRepairJob(
  adapter: CraftAdapter,
  playerId: string,
  input: EnqueueRepairJobInput,
): { job: CraftJobRecord } {
  settleCraftJobs(adapter, playerId);
  const profile = adapter.profile(playerId);
  if (!profile) fail('Profile not found');
  const p = profile as CraftProfileView;

  const kitType = input.kitType;
  if (!REPAIR_KIT_TYPES.includes(kitType)) fail('Unknown patch kit type');
  const kitBase = PATCH_KIT_BASES[kitType];
  if (!kitBase) fail('Unknown patch kit type');

  const units = Math.floor(input.units);
  if (!Number.isFinite(units) || units < 1) fail('units must be a positive integer');
  if (units > MAX_UNITS_PER_JOB) fail(`units exceeds the per-job maximum of ${MAX_UNITS_PER_JOB}`);

  const info = adapter.vehicleInfo(playerId, input.itemId);
  if (!info) fail('Vehicle not found');
  if (info.kind !== 'vehicle') fail('Only vehicles can be repaired');
  if (['listed', 'consumed', 'salvaged', 'in_service'].includes(info.runtimeState)) {
    fail('Vehicle is not available for repair');
  }
  if (info.conditionCurrent >= info.conditionMax) fail('Vehicle is already at full condition');

  const repairJobs = adapter
    .jobs(playerId)
    .filter((j) => j.status === 'active' && j.kind === 'repair');
  if (repairJobs.some((j) => j.snapshot.repair?.itemId === input.itemId)) {
    fail('A repair job is already running for this vehicle');
  }
  // Second Shift (Fixer major, 0029): +1 concurrent self-repair job,
  // read from the owner's records at enqueue. (This self-repair cap
  // is the one repair-concurrency cap the shipped game enforces —
  // board work is uncapped-but-sequential; see migration 0029.)
  const bonusRepairJobs = Math.max(0, Math.floor(adapter.skillBonus?.(playerId, 'bonusRepairJobs') ?? 0));
  if (repairJobs.length >= MAX_ACTIVE_REPAIR_JOBS + bonusRepairJobs) {
    fail('Too many repair jobs already running');
  }

  if ((p.consumables[kitType] ?? 0) < units) fail(`Not enough ${kitType} in inventory`);

  // Escrow the kits: burn FIFO, recording each unit's quality/origin
  // so completion prices restoration from the ACTUAL kit and cancel /
  // early-finish refunds return the exact batches.
  const kitQualities: number[] = [];
  const kitOrigins: string[] = [];
  for (let i = 0; i < units; i += 1) {
    const burned = adapter.burnOneBatchUnit(playerId, kitType);
    if (!burned) fail(`Not enough ${kitType} in inventory`);
    kitQualities.push(burned.quality);
    kitOrigins.push(burned.origin);
  }

  const levers = adapter.levers();
  const masteryLevel = adapter.masteryLevel(playerId, REPAIR_MASTERY_TRACK);
  const workRate = repairWorkRatePointsPerHour(
    masteryLevel,
    levers.repairWorkRateBase,
    levers.repairMasterySpeedPerLevel,
  );
  // Fixer terms (0029), from the owner's records: efficiency composes
  // multiplicatively past the mastery cap (repairEfficiencyWithSkill,
  // ceiling 1.80); the speed term multiplies the snapshotted duration.
  const efficiency = repairEfficiencyWithSkill(
    masteryLevel,
    levers.repairMasteryEfficiencyPerLevel,
    adapter.skillBonus?.(playerId, 'repairEfficiencyBonus') ?? 0,
  );
  const unitDurationMs = repairKitUnitDurationMs(
    kitBase,
    workRate,
    adapter.skillBonus?.(playerId, 'repairSpeedBonus') ?? 0,
  );

  const now = adapter.nowMs();
  const job: CraftJobRecord = {
    id: adapter.uuid(),
    owner_user_id: playerId,
    bench: REPAIR_BENCH,
    kind: 'repair',
    recipe_id: REPAIR_RECIPE_BY_KIT[kitType],
    units_total: units,
    units_completed: 0,
    unit_duration_ms: unitDurationMs,
    accrued_ms: 0,
    status: 'active',
    escrow_inputs: {},
    escrow_catalyst: {},
    rush_ticket_quality: null,
    rush_ticket_origin: null,
    snapshot: {
      toolId: null,
      toolQualityMultiplier: 1,
      toolDurationMultiplier: 1,
      toolRefineYieldBonus: 0,
      toolBonusUnitChance: 0,
      skillDurationMultiplier: 1,
      rushReduction: 0,
      craftTimeScalar: 1,
      catalystMaterialId: null,
      gearRarity: null,
      repair: {
        itemId: input.itemId,
        kitType,
        kitBase,
        kitQualities,
        kitOrigins,
        efficiency,
        workRatePointsPerHour: workRate,
        masteryLevel,
      },
    },
    xp_awarded: 0,
    outputs: [],
    tool_charged: false,
    created_at_ms: now,
    last_settled_ms: now,
    completed_at_ms: null,
  };
  adapter.addJob(job);
  return { job };
}

// ─── Cancel (§2.1 refund table) ──────────────────────────────────────

export interface CancelCraftJobResult {
  jobId: string;
  refundedInputs: Record<string, number>;
  rushTicketRefunded: boolean;
  /** Legendary cores refunded (0026); 0 for non-core jobs. */
  coresRefunded: number;
}

export function cancelCraftJob(
  adapter: CraftAdapter,
  playerId: string,
  jobId: string,
): CancelCraftJobResult {
  settleCraftJobs(adapter, playerId);
  const profile = adapter.profile(playerId);
  if (!profile) fail('Profile not found');
  const p = profile as CraftProfileView;
  const job = adapter.jobs(playerId).find((j) => j.id === jobId);
  if (!job) fail('Job not found');
  const j = job as CraftJobRecord;
  if (j.status !== 'active') fail('Job is not active');

  // Repair jobs (0025): kits are discrete items, not divisible
  // inputs — every kit not yet applied refunds whole, including the
  // in-progress unit's kit (it has not been applied yet).
  if (j.kind === 'repair') {
    const snap = j.snapshot.repair;
    const refundedCount = snap ? refundRemainingRepairKits(adapter, j) : 0;
    j.status = 'cancelled';
    return {
      jobId: j.id,
      refundedInputs: snap && refundedCount > 0 ? { [snap.kitType]: refundedCount } : {},
      rushTicketRefunded: false,
      coresRefunded: 0,
    };
  }

  const started = j.units_completed > 0 || j.accrued_ms > 0;
  const inProgress = j.accrued_ms > 0 ? 1 : 0;
  const unstarted = j.units_total - j.units_completed - inProgress;

  const refunded: Record<string, number> = {};
  const refundMap = (perUnitMap: Record<string, number>, target: Record<string, number>) => {
    for (const [key, perUnit] of Object.entries(perUnitMap)) {
      let amount = perUnit * unstarted;
      if (inProgress) amount += Math.floor(perUnit * 0.5);
      if (amount > 0) {
        refunded[key] = (refunded[key] ?? 0) + amount;
        target[key] = (target[key] ?? 0) + amount;
      }
    }
  };
  // Recipe inputs split materials/essences by key space; the catalyst
  // is a per-unit material input and follows the same refund rule.
  const materialInputs: Record<string, number> = {};
  const essenceInputs: Record<string, number> = {};
  for (const [key, total] of Object.entries(j.escrow_inputs)) {
    const perUnit = total / j.units_total;
    if (isMaterialInput(key)) materialInputs[key] = perUnit;
    else essenceInputs[key] = perUnit;
  }
  refundMap(materialInputs, p.materials);
  refundMap(essenceInputs, p.essences);
  const catalystPerUnit: Record<string, number> = {};
  for (const [key, total] of Object.entries(j.escrow_catalyst)) {
    catalystPerUnit[key] = total / j.units_total;
  }
  refundMap(catalystPerUnit, p.materials);

  // Legendary cores (0026): the material catalyst's refund schedule —
  // full for unstarted units, half (floored) for the in-progress one.
  let coresRefunded = 0;
  const escrowCores = j.escrow_cores ?? 0;
  if (escrowCores > 0 && j.units_total > 0) {
    const perUnitCores = escrowCores / j.units_total;
    coresRefunded = Math.floor(perUnitCores * unstarted)
      + (inProgress ? Math.floor(perUnitCores * 0.5) : 0);
    if (coresRefunded > 0) {
      p.legendary_cores = (p.legendary_cores ?? 0) + coresRefunded;
    }
  }

  // Rush ticket: refunded as a batch at its escrowed quality only
  // when the job never started; on a started job it is spent.
  let rushTicketRefunded = false;
  if (j.rush_ticket_quality !== null && !started) {
    adapter.addBatch(
      playerId,
      'WorkshopRushTicket',
      1,
      j.rush_ticket_quality,
      j.rush_ticket_origin ?? 'crafted',
      playerId,
      null,
    );
    rushTicketRefunded = true;
  }

  j.status = 'cancelled';
  return { jobId: j.id, refundedInputs: refunded, rushTicketRefunded, coresRefunded };
}

// ─── Bench unlock (§2.2) ─────────────────────────────────────────────

export function unlockCraftBench(adapter: CraftAdapter, playerId: string): { benches: number } {
  const profile = adapter.profile(playerId);
  if (!profile) fail('Profile not found');
  const p = profile as CraftProfileView;
  const next = p.workshop_benches + 1;
  if (next > 3) fail('All benches already unlocked');
  const def = benchDef(next);
  if (p.player_level < def.unlockLevel) fail(`Bench ${next} requires level ${def.unlockLevel}`);
  if (p.credits < def.costCredits) fail('Insufficient credits');
  for (const [key, amount] of Object.entries(def.costInputs)) {
    if ((p.materials[key] ?? 0) < amount) fail(`Insufficient material ${key}`);
  }
  p.credits -= def.costCredits;
  for (const [key, amount] of Object.entries(def.costInputs)) {
    p.materials[key] = (p.materials[key] ?? 0) - amount;
  }
  p.workshop_benches = next;
  return { benches: next };
}

// ─── Tool fitting (§2.5e) ────────────────────────────────────────────

export function fitCraftTool(
  adapter: CraftAdapter,
  playerId: string,
  bench: number,
  toolId: string | null,
): { fitted: Record<string, string | null> } {
  const profile = adapter.profile(playerId);
  if (!profile) fail('Profile not found');
  const p = profile as CraftProfileView;
  if (bench < 1 || bench > p.workshop_benches) fail('Bench not unlocked');
  const tools = p.workshop_tools;
  if (toolId !== null) {
    if (!toolDef(toolId)) fail('Unknown tool');
    if (!tools.owned[toolId]) fail('Tool not owned');
    // One bench per tool: fitting it here un-fits it elsewhere.
    for (const key of Object.keys(tools.fitted)) {
      if (tools.fitted[key] === toolId) tools.fitted[key] = null;
    }
  }
  tools.fitted[String(bench)] = toolId;
  return { fitted: tools.fitted };
}

// ─── Derived display state (shared by both stores' state reads) ─────

export type CraftJobDisplayState = 'running' | 'queued' | 'paused' | 'complete' | 'cancelled';

export function deriveJobDisplayState(
  job: CraftJobRecord,
  allJobs: CraftJobRecord[],
  activeActionKind: string | null,
): CraftJobDisplayState {
  if (job.status !== 'active') return job.status;
  const ahead = allJobs
    .filter((j) => j.status === 'active' && j.bench === job.bench)
    .sort((a, b) => a.created_at_ms - b.created_at_ms || a.id.localeCompare(b.id));
  const isHead = ahead[0]?.id === job.id;
  if (!isHead) return 'queued';
  const lane = job.kind === 'repair' ? 'workshop_service' : 'crafting';
  return activeActionKind === lane ? 'running' : 'paused';
}

/** The client-facing view of one job (Workshop queue UI, §2.9). All
 *  numbers are server state; the client animates progress between
 *  reads but never derives outcomes from them. */
export interface CraftJobView {
  id: string;
  bench: number;
  kind: CraftJobKind;
  recipeId: string;
  name: string;
  state: CraftJobDisplayState;
  unitsTotal: number;
  unitsCompleted: number;
  unitDurationMs: number;
  accruedMs: number;
  /** Server-computed remaining time if the job ran uninterrupted. */
  remainingMs: number;
  xpAwarded: number;
  gearRarity: string | null;
  catalystMaterialId: string | null;
  /** Legendary Core Catalyst job (0026): escrowed cores, +2 draws/unit. */
  coreCatalyst: boolean;
  escrowCores: number;
  outputs: CraftJobOutput[];
  createdAtMs: number;
  completedAtMs: number | null;
  /** Repair jobs only: the vehicle + kit and total points restored. */
  repairItemId: string | null;
  repairKitType: string | null;
  repairPointsRestored: number;
}

export function craftJobView(
  job: CraftJobRecord,
  allJobs: CraftJobRecord[],
  activeActionKind: string | null,
): CraftJobView {
  const recipe = getCraftRecipe(job.recipe_id);
  const repair = job.kind === 'repair' ? job.snapshot.repair : undefined;
  return {
    id: job.id,
    bench: job.bench,
    kind: job.kind,
    recipeId: job.recipe_id,
    name: recipe?.name ?? (repair ? `Vehicle repair — ${repair.kitType}` : job.recipe_id),
    state: deriveJobDisplayState(job, allJobs, activeActionKind),
    unitsTotal: job.units_total,
    unitsCompleted: job.units_completed,
    unitDurationMs: job.unit_duration_ms,
    accruedMs: job.accrued_ms,
    remainingMs: Math.max(
      0,
      (job.units_total - job.units_completed) * job.unit_duration_ms - job.accrued_ms,
    ),
    xpAwarded: job.xp_awarded,
    gearRarity: job.snapshot.gearRarity,
    catalystMaterialId: job.snapshot.catalystMaterialId,
    coreCatalyst: !!job.snapshot.coreCatalyst,
    escrowCores: job.escrow_cores ?? 0,
    outputs: job.outputs,
    createdAtMs: job.created_at_ms,
    completedAtMs: job.completed_at_ms,
    repairItemId: repair?.itemId ?? null,
    repairKitType: repair?.kitType ?? null,
    repairPointsRestored: job.outputs.reduce((sum, o) => sum + (o.pointsRestored ?? 0), 0),
  };
}

/** The Workshop state payload both stores return from their state
 *  read — one shape, assembled from parts each store supplies. */
export function buildWorkshopStateView(parts: {
  benches: number;
  tools: WorkshopToolsState;
  jobs: CraftJobRecord[];
  masteries: Record<string, { level: number; xp: number }>;
  activeActionKind: string | null;
}): Record<string, unknown> {
  const sorted = [...parts.jobs].sort(
    (a, b) => a.created_at_ms - b.created_at_ms || a.id.localeCompare(b.id),
  );
  const recentCompletions = sorted
    .flatMap((job) =>
      job.outputs.map((output) => ({
        ...output,
        jobId: job.id,
        recipeId: job.recipe_id,
        name:
          getCraftRecipe(job.recipe_id)?.name ??
          (job.snapshot.repair ? `Vehicle repair — ${job.snapshot.repair.kitType}` : job.recipe_id),
      })),
    )
    .slice(-12);
  return {
    benches: parts.benches,
    tools: parts.tools,
    jobs: sorted.map((job) => craftJobView(job, sorted, parts.activeActionKind)),
    masteries: parts.masteries,
    activeActionKind: parts.activeActionKind,
    recentCompletions,
  };
}
