/**
 * CraftEngine — the shared TypeScript implementation of the crafting
 * job model (brief §2.1–§2.7), used by the in-memory WriteStore and
 * the in-memory gameplay store. The production path is the SQL twin
 * (cc_enqueue_craft_job, cc_settle_craft_jobs, cc_cancel_craft_job,
 * cc_craft_recipe, cc_craft_quality_bounds — chain heads through
 * migration 0075); the two implementations are pinned to each other
 * by the parity tests, and the SQL is exercised against embedded
 * Postgres in the slice verification.
 *
 * Economy slice 10 (bench time, brief §8): banked hours widen the
 * one bench's envelope (content benchEnvelope — baseline 1 + 5,
 * banked 3 + 15, the Fixer queue bonus counting x1 / x3) at the
 * enqueue gates, and the settler spends bench 1's window across
 * three lanes while the bank lasts; only extra-lane busy time
 * drains the bank, deducted from the profile view so the store's
 * flush persists it. Mirrors 0075 exactly.
 *
 * Economy slice 9 (bench collapse + relic merger): there is ONE
 * bench; every generic job runs on bench 1. The fitted-tool
 * snapshot fields below keep their names (in-flight jobs carry
 * them) but are now sourced from the player's EQUIPPED RELIC at
 * enqueue — the snapshot's toolId records the relic item's id and
 * the tool* multipliers carry the composed relic crafting effects
 * (content/crafting composeCraftRelicEffects, ceiling-clamped).
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
  BENCH_TIME_RUNNING_JOBS,
  benchEnvelope,
  catalystForRecipe,
  composeCraftRelicEffects,
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
  gearTemperChance,
  getCraftRecipe,
  isMaterialInput,
  MAX_UNITS_PER_JOB,
  NO_CRAFT_RELIC_EFFECTS,
  qualityMasteryTrackForKind,
  QUEUED_JOBS_PER_BENCH,
  rollRefineOutputCount,
  rollCraftQuality,
  rushTicketTimeReduction,
  type CraftJobKind,
  type CraftRecipe,
} from '../../content/crafting.js';
import type { Affix } from '../../types/items.js';
import { effectiveOfflineCapHours } from '../../content/offlineCap.js';
import { clampRecipeScrapCost } from '../economy/config.js';
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
import {
  MAX_ACTIVE_SHIELDTECH_JOBS,
  SHIELD_TECH_MASTERY_TRACK,
  SHIELDTECH_BENCH,
  calibrationCoreCapacityPoints,
  isLegalShieldTechTarget,
  rebasedShieldPayload,
  shieldPayloadDrifted,
  shieldTechCoreUnitDurationMs,
  shieldTechEfficiencyMultiplier,
  shieldTechMasteryXp,
  shieldTechWorkRatePointsPerHour,
} from '../../content/shieldTech.js';
import { shieldBehaviorOf, type ShieldBehaviorId } from '../../lib/combat/shieldBehaviors.js';
import {
  buildCosmeticPartPayload,
  rollCosmeticQuality,
  tintPaletteById,
  type CosmeticPartPayload,
} from '../../content/skins.js';
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
  /** The equipped relic item's id at enqueue (pre-slice-9 jobs: the
   *  fitted tool's id). Null when no relic was equipped. */
  toolId: string | null;
  toolQualityMultiplier: number;
  toolDurationMultiplier: number;
  toolRefineYieldBonus: number;
  toolBonusUnitChance: number;
  /** Slice 9: the equipped relic's composed min-quality bonus
   *  (the Prime Laboratory's +5, ceiling-clamped at compose time),
   *  added into the quality bounds at completion. Absent on
   *  pre-slice-9 snapshots — readers default it to 0. */
  relicMinQualityBonus?: number;
  /** Slice 9: named-relic crafts mint this named relic at
   *  completion (fixed affixes, fixed rarity in gearRarity). */
  namedRelic?: string | null;
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
  /** Shield-tech jobs only (kind 'shieldtech', shield-tech slice
   *  0044): the shield being recalibrated, the behavior swap, the
   *  posting payload snapshot (the flip's identity check), the
   *  Calibration Cores escrowed at enqueue (one quality/origin
   *  record per unit, in burn order), and the rate / efficiency
   *  snapshot priced from the owner's shield-tech mastery. */
  shieldtech?: CraftShieldTechSnapshot;
  /** Tint jobs only (kind 'cosmetic' with the tint recipe, skins
   *  slice 0053): the owned part item being re-tinted and the
   *  palette the job will write at completion. */
  tint?: CraftTintSnapshot;
}

export interface CraftTintSnapshot {
  itemId: string;
  paletteId: string;
  fromPaletteId: string | null;
}

export interface CraftShieldTechSnapshot {
  itemId: string;
  fromBehavior: string;
  toBehavior: string;
  targetPoints: number;
  payload: Record<string, unknown>;
  coreQualities: number[];
  coreOrigins: string[];
  efficiency: number;
  workRatePointsPerHour: number;
  masteryLevel: number;
  pointsApplied: number;
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
  /** Shield-tech units: calibration points this unit applied. */
  pointsApplied?: number;
  /** Shield-tech units: accumulated points after this unit. */
  totalPointsApplied?: number;
  /** Shield-tech units: this unit's flip landed the recalibration. */
  flipped?: boolean;
  fromBehavior?: string;
  toBehavior?: string;
  /** Settler-internal signals (0044): the flip landed or was refused
   *  on payload drift — either way the job's work is done, this
   *  unit's core is spent, and unstarted cores refund. Never
   *  persisted as completion outputs beyond the unit record. */
  shieldtechComplete?: boolean;
  shieldDrift?: boolean;
  /** Settler-internal signal: the shield was gone, busy, or no
   *  longer carried the enqueued behavior when this unit would have
   *  started; the job ends and this + later cores refund. */
  shieldUnavailable?: boolean;
  /** Cosmetic units (0053): the skin part a part craft produced. */
  cosmeticPartId?: string;
  /** Tint units (0053): the palette written to the target part. */
  paletteId?: string;
  /** Tint units (0053): whether the tint actually landed (the
   *  target is re-read at completion; a part that left the
   *  workshop state records false instead of failing the job). */
  tintApplied?: boolean;
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
  // Econ 5 (0069): no scrap balance on this view — Scrap is the
  // materials['Scrap'] stock like every other material key.
  materials: Record<string, number>;
  essences: Record<string, number>;
  consumables: Record<string, number>;
  workshop_benches: number;
  /** Legendary core balance (0026); mirrors profiles.legendary_cores. */
  legendary_cores: number;
  workshop_tools: WorkshopToolsState;
  offline_cap_hours: number | null;
  /**
   * Banked bench time, whole seconds (economy slice 10, 0075;
   * mirrors profiles.bench_time_banked_seconds). Optional on the
   * view: adapters that predate bench time read as an empty bank —
   * the envelope stays baseline and nothing drains, exactly the
   * pre-slice behavior. The production adapters always carry it.
   */
  bench_time_banked_seconds?: number;
  /** The settlers' sub-second drain remainder, ms (0..999). */
  bench_time_remainder_ms?: number;
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
  /** Shield-tech levers (0044); defaults in src/content/shieldTech.ts. */
  shieldTechWorkRateBase: number;
  shieldTechMasterySpeedPerLevel: number;
  shieldTechMasteryEfficiencyPerLevel: number;
  /**
   * Economy brief §4 (0072): the resolved per-recipe Scrap costs
   * (recipeId -> Scrap per unit) for every recipe whose inputs carry
   * a Scrap leg. OPTIONAL adapter surface: an adapter that omits it
   * resolves every recipe to its content literal — exactly the
   * pre-lever behavior — so parity never depends on it being wired.
   */
  recipeScrapCosts?: Record<string, number>;
  /**
   * Economy slice 10 (brief §8.2): the bench-time grant and bank
   * cap, resolved from the economy-config levers. OPTIONAL adapter
   * surface like recipeScrapCosts: an adapter that omits them reads
   * the content literals (BENCH_TIME_GRANT_SECONDS /
   * BENCH_TIME_BANK_CAP_SECONDS) — the registry defaults.
   */
  benchTimeGrantSeconds?: number;
  benchTimeBankCapSeconds?: number;
}

/**
 * Economy brief §4: a recipe's inputs with the Scrap leg resolved
 * through the per-recipe lever — the escrow the enqueue charges and
 * the Workshop displays. Every other leg stays the content literal;
 * a recipe without a Scrap leg (or without a resolved value) returns
 * untouched. The resolved figure is clamped to the registry spec so
 * a bad adapter value can never mint a negative or absurd escrow.
 */
export function withResolvedScrapInputs(
  recipe: CraftRecipe,
  levers: CraftLeverValues,
): Record<string, number> {
  const literal = recipe.inputs['Scrap'];
  if (literal === undefined) return recipe.inputs;
  return { ...recipe.inputs, Scrap: clampRecipeScrapCost(levers.recipeScrapCosts?.[recipe.id], literal) };
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
  /** The player's Cache Rank Fast Learner XP fraction (0031),
   *  derived by the store from the player's own cache_rank_spends.
   *  Optional: adapters that predate Cache Rank read as 0. */
  cacheRankXpBonus?(playerId: string): number;
  /** Research (0038): one completion-derived bonus total for the
   *  player (a computeResearchBonuses key), derived by the store
   *  from the player's OWN research_completions records. Optional:
   *  adapters that predate Research read as 0 — every research term
   *  is additive over the pre-Research behavior at 0. */
  researchBonus?(playerId: string, key: string): number;
  /** Research (0038): whether the player holds a course completion
   *  (the batch recipes' enqueue gate). Optional: pre-Research
   *  adapters read as false (the gate refuses). */
  researchCompleted?(playerId: string, courseId: string): boolean;
  /** Manufacturer Standing (0043): the player's GRANTED rank on a
   *  manufacturer's ladder (the exclusive recipes' enqueue gate).
   *  Optional: pre-Standing adapters read as 0 (the gate refuses). */
  standingRank?(playerId: string, manufacturer: string): number;
  /** Economy slice 9: the player's EQUIPPED relic (item id + its
   *  affix rows), derived by the store from the player's own item
   *  records — the crafting effects source at enqueue. Optional:
   *  adapters that predate the merger read as no relic equipped
   *  (NO_CRAFT_RELIC_EFFECTS). */
  equippedRelic?(playerId: string): { itemId: string; affixes: Affix[] } | null;
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
  /** Shield-tech jobs: read one owned item's shield state. */
  shieldInfo(
    playerId: string,
    itemId: string,
  ): {
    kind: string;
    runtimeState: string;
    isLocked: boolean;
    rarity: string | null;
    payload: Record<string, unknown>;
  } | null;
  /** Shield-tech jobs: write a shield's payload (the flip). */
  applyShieldPayload(playerId: string, itemId: string, payload: Record<string, unknown>): void;
  /** Repair jobs: restore condition points (clamped at max) and
   *  return the resulting condition state. */
  restoreVehicle(
    playerId: string,
    itemId: string,
    points: number,
  ): { conditionCurrent: number; conditionMax: number } | null;
  /** Cosmetic crafts (0053): insert a finished skin part item;
   *  returns the new item id (the gear insert's mirror). */
  insertCosmeticItem(playerId: string, payload: CosmeticPartPayload): string;
  /** Tint jobs (0053): read one owned item's cosmetic state. */
  cosmeticInfo(
    playerId: string,
    itemId: string,
  ): {
    kind: string;
    runtimeState: string;
    isLocked: boolean;
    payload: Record<string, unknown>;
  } | null;
  /** Tint jobs (0053): write a part's tint palette id. */
  applyCosmeticTint(playerId: string, itemId: string, paletteId: string): void;
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

/** The internal away-cap when no caller passes one: the earned cap
 *  (2h base + the Research Logistics track's grants, read live
 *  through the adapter's research accessor) + limiter + 24h
 *  ceiling, WITHOUT the Scavenger keystone bonus (the settle-offline
 *  route passes the exact cap including the bonus). Conservative by
 *  construction — it can only under-pay the rare direct-to-Workshop
 *  login path, never over-pay. */
function internalAwayCapMs(adapter: CraftAdapter, playerId: string, profile: CraftProfileView): number {
  const hours = effectiveOfflineCapHours({
    researchCapHours: adapter.researchBonus?.(playerId, 'offlineCapBonus') ?? 0,
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
    const lane = job.kind === 'repair' || job.kind === 'shieldtech' ? 'workshop_service' : 'crafting';
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
      advance = attendedMs + Math.min(awayMs, internalAwayCapMs(adapter, playerId, profile));
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

  // Bench time (Econ 10, brief §8.3; SQL twin 0075): the bank at
  // settle start in milliseconds. Bench 1's window is spent across
  // three lanes while at least one whole second is banked; busy
  // time on lanes past the first is the bank's drain, accumulated
  // here and deducted from the profile view after the pass (the
  // store's flush persists it). The baseline lane never drains.
  const bankMs =
    (profile.bench_time_banked_seconds ?? 0) * 1000 + (profile.bench_time_remainder_ms ?? 0);
  let extraMs = 0;

  for (const [bench, benchJobs] of benches.entries()) {
    // Every job on a bench shares the same settle window; each lane
    // holds the bench's full window, the queue consumes lanes in
    // order, and a finished lane's leftover flows to the next job.
    const benchBudget = Math.max(...benchJobs.map((j) => perJobAdvance.get(j.id) ?? 0), 0);
    const lanes = bench === 1 && bankMs >= 1000 ? BENCH_TIME_RUNNING_JOBS : 1;
    const laneBudgets = new Array<number>(lanes).fill(benchBudget);
    for (const job of benchJobs) {
      if (job.status !== 'active') continue;
      // Take the usable lane holding the most window (ties go to
      // the lowest lane, so a lone job always lands on the baseline
      // lane and never drains). A lane past the first is usable
      // only while undrained bank remains; its per-job allowance is
      // clamped by that remainder, so an emptied bank stops the
      // extra lanes accruing mid-settle — nothing is killed,
      // paused out of existence, or repriced.
      let lane = -1;
      let avail = 0;
      for (let li = 0; li < lanes; li++) {
        if (laneBudgets[li] > avail && (li === 0 || extraMs < bankMs)) {
          lane = li;
          avail = laneBudgets[li];
        }
      }
      if (lane < 0) break;
      if (lane > 0) avail = Math.min(avail, bankMs - extraMs);
      const initAvail = avail;
      let budget = avail;
      // A job's first unit still marks the job tool-charged for
      // record parity with the SQL twin, but nothing is ever spent:
      // the snapshot's effects came from a permanent relic (slice 9;
      // before it, a permanent fitted tool, 0067) — never consumed,
      // unfitted, or treated as absent.
      if (!job.tool_charged && job.snapshot.toolId) {
        job.tool_charged = true;
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
          if (output.shieldUnavailable) {
            // Shield-tech job whose shield is gone, busy, or no
            // longer carries the enqueued behavior: this unit never
            // started — end the job and refund this and every later
            // core at its escrowed quality (0044).
            refundRemainingShieldTechCores(adapter, job);
            job.status = 'complete';
            job.completed_at_ms = now;
            result.jobsCompleted += 1;
            break;
          }
          if (output.shieldtechComplete || output.shieldDrift) {
            // The job's work is done (the flip landed, or refused on
            // drift): this unit's core is spent; refund only the
            // unstarted cores and end the job. The unit itself was
            // already recorded by completeCraftUnit below.
            refundRemainingShieldTechCores(adapter, job);
            if (job.units_completed < job.units_total) {
              job.status = 'complete';
              job.completed_at_ms = now;
              result.jobsCompleted += 1;
            }
            result.xpAwarded += output.xp;
            result.completions.push({ ...output, jobId: job.id, recipeId: job.recipe_id });
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
      // Lane bookkeeping: what this job drew leaves its lane; on an
      // extra lane it is also the bank's drain.
      laneBudgets[lane] -= initAvail - budget;
      if (lane > 0) extraMs += initAvail - budget;
    }
  }

  // Bench-time drain: deduct this settle's extra-lane busy time
  // from the bank — whole seconds into the bank field, the
  // sub-second remainder carried so no fraction of a banked hour
  // is ever lost to rounding.
  if (extraMs > 0) {
    const newBankMs = Math.max(0, bankMs - extraMs);
    profile.bench_time_banked_seconds = Math.floor(newBankMs / 1000);
    profile.bench_time_remainder_ms = newBankMs % 1000;
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
 * roll, same pegged XP). It buys time, never output: exactly one unit per bench,
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
    // The fire marks the job tool-charged like the settler does,
    // and spends nothing (permanent relic effects, slice 9).
    if (!job.tool_charged && job.snapshot.toolId) {
      job.tool_charged = true;
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
    if (output.shieldUnavailable) {
      refundRemainingShieldTechCores(adapter, job);
      job.status = 'complete';
      job.completed_at_ms = now;
      result.jobsCompleted += 1;
      continue;
    }
    if (output.shieldtechComplete || output.shieldDrift) {
      refundRemainingShieldTechCores(adapter, job);
      result.xpAwarded += output.xp;
      result.completions.push({ ...output, jobId: job.id, recipeId: job.recipe_id });
      if (job.units_completed < job.units_total) {
        job.status = 'complete';
        job.completed_at_ms = now;
        result.jobsCompleted += 1;
      }
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

/** Refund every Calibration Core a shield-tech job escrowed but
 *  never applied (early finish, drift, cancellation), each as a
 *  batch at its recorded quality and origin. Refunds start at
 *  units_completed — the first unstarted unit's core. */
function refundRemainingShieldTechCores(adapter: CraftAdapter, job: CraftJobRecord): number {
  const snap = job.snapshot.shieldtech;
  if (!snap) return 0;
  let refunded = 0;
  for (let i = job.units_completed; i < job.units_total; i += 1) {
    adapter.addBatch(
      job.owner_user_id,
      'CalibrationCore',
      1,
      snap.coreQualities[i] ?? 100,
      snap.coreOrigins[i] ?? 'crafted',
      job.owner_user_id,
      null,
    );
    refunded += 1;
  }
  return refunded;
}

/**
 * One self-lane recalibration unit (0044): apply the next escrowed
 * Calibration Core. Its capacity (base 2,500 × quality% × the
 * owner's efficiency snapshot) accrues toward the target; the flip
 * lands only when accumulated points cover the target, and only if
 * the shield is still exactly the shield that was enqueued (the
 * finalize identity rule). Pays NO player XP (consumption, the
 * self-repair rule); shield-tech mastery trains by points applied.
 */
function completeShieldTechUnit(
  adapter: CraftAdapter,
  job: CraftJobRecord,
): CraftJobOutput {
  const snap = job.snapshot.shieldtech;
  if (!snap) fail('Shield-tech job snapshot missing');
  const playerId = job.owner_user_id;
  const unit = job.units_completed + 1;
  const output: CraftJobOutput = { unit, kind: 'shieldtech', xp: 0, completedAtMs: adapter.nowMs() };

  const info = adapter.shieldInfo(playerId, snap.itemId);
  if (
    !info ||
    info.kind !== 'shield' ||
    info.runtimeState !== 'available' ||
    info.isLocked ||
    shieldBehaviorOf(info.payload) !== snap.fromBehavior
  ) {
    // The unit never starts: the settler ends the job here and
    // refunds this and every later core at its recorded quality.
    output.shieldUnavailable = true;
    return output;
  }
  const quality = snap.coreQualities[job.units_completed] ?? 100;
  const applied = calibrationCoreCapacityPoints(quality, snap.efficiency);
  const total = Math.round((snap.pointsApplied + applied) * 10000) / 10000;
  snap.pointsApplied = total;
  if (applied > 0) {
    adapter.addMasteryXp(playerId, SHIELD_TECH_MASTERY_TRACK, shieldTechMasteryXp(applied));
  }
  output.itemId = snap.itemId;
  output.quality = quality;
  output.pointsApplied = applied;
  output.totalPointsApplied = total;
  if (total >= snap.targetPoints) {
    if (shieldPayloadDrifted(info.payload, snap.payload)) {
      // The shield changed under the job (e.g. a reforge landed
      // first): the flip refuses; the settler ends the job and
      // refunds the unstarted cores. This core is spent.
      output.shieldDrift = true;
    } else {
      adapter.applyShieldPayload(playerId, snap.itemId, rebasedShieldPayload(info.payload, snap.toBehavior as ShieldBehaviorId));
      output.flipped = true;
      output.fromBehavior = snap.fromBehavior;
      output.toBehavior = snap.toBehavior;
      output.shieldtechComplete = true;
    }
  }
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
  if (job.kind === 'shieldtech') return completeShieldTechUnit(adapter, job);
  const recipe = getCraftRecipe(job.recipe_id) as CraftRecipe;
  const unit = job.units_completed + 1;
  const playerId = job.owner_user_id;
  // All completion reads (XP level, mastery-driven bounds/yield,
  // item level) snapshot the state at the unit's completion instant;
  // this unit's own XP and mastery land after its output is priced.
  // Cache Rank Fast Learner (0031): craft XP carries the same XP
  // bonus as every other source — applied after the peg rate,
  // before applyXp (the SQL twin scales v_xp in
  // cc_complete_craft_unit identically).
  const xp = Math.round(
    craftUnitXp(job.unit_duration_ms, profile.player_level, levers.craftXpRate) *
      (1 + (adapter.cacheRankXpBonus?.(playerId) ?? 0)),
  );
  const output: CraftJobOutput = { unit, kind: job.kind, xp, completedAtMs: adapter.nowMs() };

  if (job.kind === 'consumable' && recipe.consumableType) {
    const masteryLevel = adapter.masteryLevel(playerId, qualityMasteryTrackForKind(job.kind));
    const bounds = craftQualityBounds({
      consumableType: recipe.consumableType,
      masteryLevel,
      bench: job.bench,
      catalyst: !!job.snapshot.catalystMaterialId,
      relicMinQualityBonus: job.snapshot.relicMinQualityBonus ?? 0,
      // The composed shift (0029): lever + the Fixer craftQualityBonus
      // total, read from the crafter's records at completion, under
      // the one [−10, +20] clamp (composedCraftQualityShift).
      qualityShift: composedCraftQualityShift(
        levers.craftQualityShift,
        adapter.skillBonus?.(playerId, 'craftQualityBonus') ?? 0,
        adapter.researchBonus?.(playerId, 'craftQualityShift') ?? 0,
      ),
    });
    const quality = rollCraftQuality(bounds, job.bench, adapter.rng, job.snapshot.toolQualityMultiplier);
    // Batch recipes (0038) produce outputQuantity units per unit;
    // every shipped recipe is 1 (bit-identical). A fitted tool's
    // bonus unit adds +1 on top, as it does at quantity 1.
    let quantity = recipe.outputQuantity ?? 1;
    let bonusUnit = false;
    if (job.snapshot.toolBonusUnitChance > 0 && adapter.rng() < job.snapshot.toolBonusUnitChance) {
      quantity += 1;
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
    // Stochastic rounding (economy brief §9.3, 0067): floor(x) plus
    // one extra unit with probability frac(x) — mastery and the
    // Reclaimer Head move furnace yields for the first time.
    const count = rollRefineOutputCount(recipe, masteryLevel, levers.refineBaseYield, job.snapshot.toolRefineYieldBonus, adapter.rng);
    profile.materials[recipe.outputMaterial] = (profile.materials[recipe.outputMaterial] ?? 0) + count;
    output.outputMaterial = recipe.outputMaterial;
    output.outputQuantity = count;
  } else if (job.kind === 'gear' && recipe.gearSlot) {
    const gearLevel = adapter.masteryLevel(playerId, 'crafting.gear');
    const rarity = (job.snapshot.gearRarity ?? Rarity.Common) as Rarity;
    // Named-relic crafts (slice 9) mint a fixed item: no temper
    // roll, no draws — the name is the item.
    const namedRelic = job.snapshot.namedRelic ?? recipe.namedRelic ?? null;
    const tempered = namedRelic
      ? false
      : adapter.rng() < gearTemperChance(
          gearLevel,
          levers.gearTemperBaseChance,
          (adapter.skillBonus?.(playerId, 'craftTemperBonus') ?? 0)
            + (adapter.researchBonus?.(playerId, 'gearTemperBonus') ?? 0),
        );
    // Material catalyst (economy brief §9.1, 0067): a gear job that
    // escrowed a material catalyst (ForgeheartIngots) gets the same
    // bounds shift the consumable branch applies — the shared bounds
    // function with the catalyst flag set (+10 min / +15 max on the
    // frame bounds), composed with the same quality shift. Each
    // candidate draw rolls inside the shifted bounds and the draw
    // selection keeps the best bounds roll (see craftGear.ts). The
    // core catalyst is mutually exclusive at enqueue, so the two
    // never compose on one unit.
    const catalystBounds = job.snapshot.catalystMaterialId
      ? craftQualityBounds({
          consumableType: null,
          masteryLevel: gearLevel,
          bench: job.bench,
          catalyst: true,
          relicMinQualityBonus: job.snapshot.relicMinQualityBonus ?? 0,
          qualityShift: composedCraftQualityShift(
            levers.craftQualityShift,
            adapter.skillBonus?.(playerId, 'craftQualityBonus') ?? 0,
            adapter.researchBonus?.(playerId, 'craftQualityShift') ?? 0,
          ),
        })
      : null;
    const candidate = generateCraftedGearItem({
      slot: recipe.gearSlot as CraftGearSlot,
      rarity,
      itemLevel: profile.player_level,
      creatorId: playerId,
      // Core catalyst (0026): +2 draws on top of the temper lever;
      // the Fixer keystone (0029) adds its snapshotted draw bonus.
      // Named relics mint once — the fixed item has no draws.
      draws: namedRelic
        ? 1
        : (tempered ? 3 : 1)
            + (job.snapshot.coreCatalyst
              ? CORE_CATALYST_DRAWS_BONUS + (job.snapshot.coreCatalystDrawBonus ?? 0)
              : 0)
            + (adapter.researchBonus?.(playerId, 'gearDrawBonus') ?? 0),
      ...(namedRelic ? { namedRelic } : {}),
      rng: adapter.rng,
      ...(catalystBounds
        ? {
            qualityRoll: {
              bounds: catalystBounds,
              bench: job.bench,
              toolQualityMultiplier: job.snapshot.toolQualityMultiplier,
            },
          }
        : {}),
    });
    output.itemId = adapter.insertGearItem(playerId, candidate);
    output.rarity = candidate.rarity;
    output.tempered = tempered;
    if (candidate.craftQuality !== undefined) output.quality = candidate.craftQuality;
  } else if (job.kind === 'cosmetic' && recipe.tintCraft) {
    // Tint job (0053): the craft lands on the TARGET part item,
    // re-read at completion (the SQL branch's twin). A part that
    // left the workshop state records tintApplied=false; the job
    // still completes — the work happened.
    const snap = job.snapshot.tint;
    if (!snap) fail('Tint job snapshot missing');
    const info = adapter.cosmeticInfo(playerId, snap.itemId);
    const applied =
      !!info &&
      info.kind === 'cosmetic' &&
      (info.runtimeState === 'available' || info.runtimeState === 'locked');
    if (applied) adapter.applyCosmeticTint(playerId, snap.itemId, snap.paletteId);
    output.itemId = snap.itemId;
    output.cosmeticPartId =
      typeof info?.payload.partId === 'string' ? info.payload.partId : undefined;
    output.paletteId = snap.paletteId;
    output.tintApplied = applied;
  } else if (job.kind === 'cosmetic' && recipe.cosmeticPartId) {
    // Skin part craft (0053): the finish roll prices the part's
    // permanent quality (content/skins.ts rollCosmeticQuality —
    // the one formula; migration 0053's SQL branch is its twin),
    // then the part item is inserted like a gear completion.
    const masteryLevel = adapter.masteryLevel(playerId, 'crafting.cosmetics');
    const quality = rollCosmeticQuality({
      random01: adapter.rng(),
      bench: job.bench,
      toolQualityMultiplier: job.snapshot.toolQualityMultiplier,
      shift: composedCraftQualityShift(
        levers.craftQualityShift,
        adapter.skillBonus?.(playerId, 'craftQualityBonus') ?? 0,
        adapter.researchBonus?.(playerId, 'craftQualityShift') ?? 0,
      ),
      masteryLevel,
    });
    const payload = buildCosmeticPartPayload(recipe.cosmeticPartId, quality, playerId);
    if (!payload) fail('Unknown cosmetic part');
    output.itemId = adapter.insertCosmeticItem(playerId, payload);
    output.cosmeticPartId = recipe.cosmeticPartId;
    output.quality = quality;
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
  // Cosmetics (0053): the tint craft is an item-target job and
  // starts only through enqueueTintJob; per-recipe unit caps
  // (prestige crafts) bind here.
  if (r.tintCraft) fail('Tint crafts start from the Tinting action');
  if (r.maxUnits !== undefined && units > r.maxUnits) {
    fail(`This craft runs at most ${r.maxUnits} units at a time`);
  }

  // Bench collapse (slice 9): there is one bench. Requests naming
  // a retired tier land on it — the catalog's requiresBench is 1
  // for every recipe, and every profile owns the bench.
  const benchInput = Math.floor(input.bench);
  if (!Number.isFinite(benchInput) || benchInput < 1 || benchInput > 3) fail('bench must be 1, 2 or 3');
  const bench = 1;
  if (bench > p.workshop_benches) fail('Bench not unlocked');
  if (bench < r.requiresBench) fail(`Recipe requires bench ${r.requiresBench} or higher`);
  if (p.player_level < r.requiresLevel) fail(`Requires level ${r.requiresLevel}`);
  if (r.requiresMastery && adapter.masteryLevel(playerId, r.requiresMastery.track) < r.requiresMastery.level) {
    fail(`Requires ${r.requiresMastery.track} mastery ${r.requiresMastery.level}`);
  }
  // Research gate (0038): the batch recipes require the Production
  // Systems completion — a fourth gate beside level / bench /
  // mastery, read from the player's completion records.
  if (r.requiresResearch && !(adapter.researchCompleted?.(playerId, r.requiresResearch) ?? false)) {
    fail('research_required');
  }
  // Manufacturer Standing gate (0043): the exclusive recipes require
  // the granted rank on that manufacturer's own ladder — a fifth gate
  // beside level / bench / mastery / research.
  if (r.requiresStanding && (adapter.standingRank?.(playerId, r.requiresStanding.manufacturer) ?? 0) < r.requiresStanding.rank) {
    fail('standing_required');
  }

  // Gear rarity: forced at enqueue, Epic-capped by law. The rarity
  // bench gates retired with the collapse (brief §8.1) — Epic keeps
  // its surviving carrier, the mastery gate. Named-relic crafts
  // mint at the recipe's fixed rarity; the caller's rarity is
  // ignored for them.
  let gearRarity: Rarity | null = null;
  if (r.kind === 'gear') {
    if (r.namedRelic && r.fixedRarity) {
      gearRarity = r.fixedRarity;
    } else {
      const rarity = (input.rarity ?? '') as Rarity;
      if (!CRAFTABLE_GEAR_RARITIES.includes(rarity)) {
        fail(rarity === Rarity.Legendary ? 'Legendary gear cannot be crafted' : 'A craftable rarity (Common–Epic) is required');
      }
      gearRarity = rarity;
      if (rarity === Rarity.Epic && adapter.masteryLevel(playerId, 'crafting.gear') < EPIC_FRAME_GEAR_MASTERY) {
        fail(`Epic frames require crafting.gear mastery ${EPIC_FRAME_GEAR_MASTERY}`);
      }
    }
  }

  // Named relics take no catalyst (slice 9): their affixes are
  // fixed, so a catalyst would burn for zero effect — the §9.1
  // defect class. The refusal is the remedy.
  if (r.namedRelic && (input.useCatalyst || input.useCoreCatalyst)) {
    fail('Named relic crafts take no catalyst — the relic is fixed');
  }

  // Queue capacity — THE BENCH ENVELOPE (content benchEnvelope;
  // SQL twin 0075): baseline one running + QUEUED_JOBS_PER_BENCH
  // queued plus the Fixer keystone's workshopQueueBonus (0029) —
  // derived from the player's records by the store, snapshotted
  // implicitly by the gate; banked bench time widens it to the
  // pre-collapse three running + fifteen queued with the bonus
  // counting x3. The store settles before this call, so the bank
  // read here is post-drain — the envelope in force at enqueue.
  const fixer = input.fixerBonuses;
  const queueBonus = Math.max(0, Math.floor(fixer?.workshopQueueBonus ?? 0));
  const benchActive = adapter
    .jobs(playerId)
    .filter((j) => j.status === 'active' && j.bench === bench).length;
  if (benchActive >= benchEnvelope(p.bench_time_banked_seconds ?? 0, queueBonus).capacity) {
    fail('Bench queue is full');
  }

  // Catalyst (optional; baseline since the bench collapse —
  // catalysts run on the one bench, their cost is their input).
  let catalystMaterialId: string | null = null;
  if (input.useCatalyst) {
    catalystMaterialId = catalystForRecipe(r);
    if (!catalystMaterialId) fail('Recipe takes no catalyst');
  }

  // Legendary Core Catalyst (0026): gear frames only, one core per
  // unit escrowed at enqueue; mutually exclusive with the material
  // catalyst. (Its Forge bench gate retired with the collapse,
  // like the material catalyst's.)
  let coreCatalyst = false;
  let escrowCores = 0;
  if (input.useCoreCatalyst) {
    if (catalystMaterialId) fail('Choose one catalyst: material or legendary core');
    if (r.kind !== 'gear') fail('Legendary core catalyst applies to gear frames only');
    coreCatalyst = true;
    escrowCores = units * CORE_CATALYST_CORES_PER_UNIT;
  }

  // Verify the full escrow before taking any of it (atomicity).
  // Econ 5 (0069): the `Scrap` key is an ordinary material key now —
  // the 0053 scrap-column special case is deleted in both twins.
  // Econ 7 (0072, brief §4): the Scrap leg resolves through the
  // per-recipe lever AT ENQUEUE — this escrow is the snapshot every
  // later step (settle, cancel refund) reads, so a lever move never
  // reprices the job. Levers are read once, here.
  const levers = adapter.levers();
  const escrowInputs: Record<string, number> = {};
  for (const [key, perUnit] of Object.entries(withResolvedScrapInputs(r, levers))) {
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

  // Equipped-relic snapshot (slice 9): the crafting effects of the
  // relic the hunter carries, composed + ceiling-clamped by the
  // content composer and snapshotted onto the job — swapping the
  // relic mid-job never reprices a running job (the snapshot law).
  const equippedRelic = adapter.equippedRelic?.(playerId) ?? null;
  const relicEffects = equippedRelic
    ? composeCraftRelicEffects(equippedRelic.affixes)
    : NO_CRAFT_RELIC_EFFECTS;

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
  // (`levers` was read once at the escrow build above — Econ 7.)
  const baseDuration = r.kind === 'gear' && gearRarity && !r.namedRelic
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
  const toolDurationMultiplier = relicEffects.durationMultiplier;
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
      toolId: equippedRelic ? equippedRelic.itemId : null,
      toolQualityMultiplier: relicEffects.qualityMultiplier,
      toolDurationMultiplier,
      toolRefineYieldBonus: relicEffects.refineYieldBonus,
      toolBonusUnitChance: relicEffects.bonusUnitChance,
      relicMinQualityBonus: relicEffects.minQualityBonus,
      namedRelic: r.namedRelic ?? null,
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
  // Wrench Basics (0038): the owner's research term multiplies the
  // work rate (the SQL twin composes it into the same snapshot).
  const workRate = repairWorkRatePointsPerHour(
    masteryLevel,
    levers.repairWorkRateBase,
    levers.repairMasterySpeedPerLevel,
  ) * (1 + (adapter.researchBonus?.(playerId, 'repairWorkRateBonus') ?? 0));
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

// ─── Self-lane recalibration enqueue (0044) ──────────────────────────

export interface EnqueueShieldTechJobInput {
  itemId: string;
  toBehavior: string;
}

const SHIELD_BEHAVIOR_ID_SET = new Set(['standard', 'nova', 'absorb', 'amp', 'turtle']);

/**
 * Self-lane recalibration as a TIMED job (0044): the owner's own
 * Calibration Cores escrow at enqueue — exactly the count whose true
 * capacity (base 2,500 × quality% × the owner's efficiency snapshot,
 * walked worst-first in the game's one burn order) covers the
 * shield's stored capacity — and apply one at a time while
 * `workshop_service` is the active action. No verified-account gate
 * (consumption, the self-repair rule); no price, no fee, no player
 * XP. The target must satisfy the generation rule (R8): a Legendary
 * shield can never be recalibrated to Standard.
 */
export function enqueueShieldTechJob(
  adapter: CraftAdapter,
  playerId: string,
  input: EnqueueShieldTechJobInput,
): { job: CraftJobRecord } {
  settleCraftJobs(adapter, playerId);
  const profile = adapter.profile(playerId);
  if (!profile) fail('Profile not found');

  const info = adapter.shieldInfo(playerId, input.itemId);
  if (!info) fail('Shield not found');
  if (info.kind !== 'shield') fail('Only shields can be recalibrated');
  if (info.runtimeState !== 'available' || info.isLocked) {
    fail('Shield is not available for recalibration');
  }
  const payload = info.payload;
  const fromBehavior = shieldBehaviorOf(payload);
  if (!SHIELD_BEHAVIOR_ID_SET.has(input.toBehavior)) fail('Unknown shield behavior');
  const toBehavior = input.toBehavior as ShieldBehaviorId;
  if (toBehavior === fromBehavior) fail('Shield already carries that behavior');
  const rarity = (info.rarity ?? 'Common') as Parameters<typeof isLegalShieldTechTarget>[0];
  if (!isLegalShieldTechTarget(rarity, toBehavior)) {
    if (toBehavior === 'standard' && rarity === 'Legendary') {
      fail('Legendary shields cannot be recalibrated to Standard');
    }
    fail('Behavior cannot be generated for this rarity');
  }
  const hp = payload.hp;
  if (typeof hp !== 'number' || !Number.isFinite(hp)) fail('Shield has no stored capacity');
  const targetPoints = Math.round(hp);
  if (targetPoints < 1) fail('Shield has no stored capacity');

  const shieldTechJobs = adapter
    .jobs(playerId)
    .filter((j) => j.status === 'active' && j.kind === 'shieldtech');
  if (shieldTechJobs.some((j) => j.snapshot.shieldtech?.itemId === input.itemId)) {
    fail('A recalibration job is already running for this shield');
  }
  if (shieldTechJobs.length >= MAX_ACTIVE_SHIELDTECH_JOBS) fail('Too many recalibration jobs already running');

  const levers = adapter.levers();
  const masteryLevel = adapter.masteryLevel(playerId, SHIELD_TECH_MASTERY_TRACK);
  const workRate = shieldTechWorkRatePointsPerHour(
    masteryLevel,
    levers.shieldTechWorkRateBase,
    levers.shieldTechMasterySpeedPerLevel,
  );
  const efficiency = shieldTechEfficiencyMultiplier(
    masteryLevel,
    levers.shieldTechMasteryEfficiencyPerLevel,
  );
  const unitDurationMs = shieldTechCoreUnitDurationMs(workRate);

  // Escrow the cores: burn worst-first, accumulating true capacity
  // until the target is covered. If the owner's cores cannot cover
  // it, every burned core goes back at its recorded quality/origin
  // and the enqueue refuses — nothing is consumed.
  const coreQualities: number[] = [];
  const coreOrigins: string[] = [];
  let covered = 0;
  while (covered < targetPoints) {
    const burned = adapter.burnOneBatchUnit(playerId, 'CalibrationCore');
    if (!burned) {
      for (let i = 0; i < coreQualities.length; i += 1) {
        adapter.addBatch(playerId, 'CalibrationCore', 1, coreQualities[i], coreOrigins[i], playerId, null);
      }
      fail('Not enough Calibration Core capacity for this shield');
    }
    coreQualities.push(burned.quality);
    coreOrigins.push(burned.origin);
    covered += calibrationCoreCapacityPoints(burned.quality, efficiency);
  }

  const now = adapter.nowMs();
  const job: CraftJobRecord = {
    id: adapter.uuid(),
    owner_user_id: playerId,
    bench: SHIELDTECH_BENCH,
    kind: 'shieldtech',
    recipe_id: 'shieldtech_recalibration',
    units_total: coreQualities.length,
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
      shieldtech: {
        itemId: input.itemId,
        fromBehavior,
        toBehavior,
        targetPoints,
        payload: { ...payload },
        coreQualities,
        coreOrigins,
        efficiency,
        workRatePointsPerHour: workRate,
        masteryLevel,
        pointsApplied: 0,
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

// ─── Tint enqueue (0053; the shield-tech item-target pattern) ─────

export interface EnqueueTintJobInput {
  itemId: string;
  paletteId: string;
}

/**
 * Tint a cosmetic part: a single-unit cosmetic job against an OWNED
 * part item. Escrow = the tint recipe's flat Scrap leg plus the
 * palette's Chromaweave (starter palettes are free). The tint lands
 * at completion (completeCraftUnit's tint branch), never at
 * enqueue. Migration 0053's cc_enqueue_tint_job is the SQL twin —
 * same gates, same messages.
 */
export function enqueueTintJob(
  adapter: CraftAdapter,
  playerId: string,
  input: EnqueueTintJobInput,
): { job: CraftJobRecord } {
  settleCraftJobs(adapter, playerId);
  const profile = adapter.profile(playerId);
  if (!profile) fail('Profile not found');
  const p = profile as CraftProfileView;

  const recipe = getCraftRecipe('tint_craft');
  if (!recipe || !recipe.tintCraft) fail('Unknown craft recipe');
  const palette = tintPaletteById(input.paletteId);
  if (!palette) fail('Unknown tint palette');
  const chromaweave = palette.chromaweave;
  // Econ 7 (0072, brief §4): the tint craft's flat Scrap leg resolves
  // through recipeScrap.tint_craft, exactly like the generic enqueue.
  const scrapCost = clampRecipeScrapCost(
    adapter.levers().recipeScrapCosts?.['tint_craft'],
    recipe.inputs['Scrap'] ?? 0,
  );

  const info = adapter.cosmeticInfo(playerId, input.itemId);
  if (!info) fail('Item not found');
  if (info.kind !== 'cosmetic') fail('Item is not a cosmetic part');
  if (info.runtimeState !== 'available' || info.isLocked) {
    fail('Part is not available for tinting');
  }
  const fromPaletteId = typeof info.payload.tintPaletteId === 'string' ? info.payload.tintPaletteId : null;
  if (fromPaletteId === input.paletteId) fail('Part already carries that tint');
  const tintJobs = adapter
    .jobs(playerId)
    .filter((j) => j.status === 'active' && j.kind === 'cosmetic' && j.snapshot.tint);
  if (tintJobs.some((j) => j.snapshot.tint?.itemId === input.itemId)) {
    fail('A tint job is already running for this part');
  }

  // Verify the full escrow before taking any of it (atomicity).
  if ((p.materials['Scrap'] ?? 0) < scrapCost) fail('Insufficient scrap');
  if (chromaweave > 0 && (p.materials['Chromaweave'] ?? 0) < chromaweave) {
    fail('Insufficient material Chromaweave');
  }

  // The one bench (slice 9), under the generic capacity rule —
  // widened by banked bench time exactly like the generic gate
  // (0075), except that this gate has never carried the Fixer
  // queue bonus and still does not. (The settle at this function's
  // head already drained the bank, so the figure read is current.)
  const bench = 1;
  const tintActive = adapter.jobs(playerId).filter((j) => j.status === 'active' && j.bench === bench).length;
  if (tintActive >= benchEnvelope(p.bench_time_banked_seconds ?? 0, 0).capacity) {
    fail('Bench queue is full');
  }

  const escrowInputs: Record<string, number> = {};
  if (scrapCost > 0) {
    escrowInputs['Scrap'] = scrapCost;
    p.materials['Scrap'] = (p.materials['Scrap'] ?? 0) - scrapCost;
  }
  if (chromaweave > 0) {
    escrowInputs['Chromaweave'] = chromaweave;
    p.materials['Chromaweave'] = (p.materials['Chromaweave'] ?? 0) - chromaweave;
  }

  const now = adapter.nowMs();
  const job: CraftJobRecord = {
    id: adapter.uuid(),
    owner_user_id: playerId,
    bench,
    kind: 'cosmetic',
    recipe_id: 'tint_craft',
    units_total: 1,
    units_completed: 0,
    unit_duration_ms: recipe.unitDurationMs,
    accrued_ms: 0,
    status: 'active',
    escrow_inputs: escrowInputs,
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
      tint: { itemId: input.itemId, paletteId: input.paletteId, fromPaletteId },
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

  // Shield-tech jobs (0044): cores are discrete items — every core
  // not yet applied refunds whole, including the in-progress unit's
  // core. Applied cores stay spent; the shield is unchanged (the
  // flip only ever lands at full coverage, inside the completion
  // that ends the job).
  if (j.kind === 'shieldtech') {
    const snap = j.snapshot.shieldtech;
    const refundedCount = snap ? refundRemainingShieldTechCores(adapter, j) : 0;
    j.status = 'cancelled';
    return {
      jobId: j.id,
      refundedInputs: snap && refundedCount > 0 ? { CalibrationCore: refundedCount } : {},
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
  // Econ 5 (0069): the `Scrap` key is a material key, so its refund
  // rides the materials map on the standard schedule — the 0053
  // scrap-column fold is deleted.
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

// ─── Derived display state (shared by both stores' state reads) ─────

export type CraftJobDisplayState = 'running' | 'queued' | 'paused' | 'complete' | 'cancelled';

export function deriveJobDisplayState(
  job: CraftJobRecord,
  allJobs: CraftJobRecord[],
  activeActionKind: string | null,
  /**
   * How many of the bench's FIFO-first jobs read as occupying a
   * running lane (economy slice 10: bench 1 runs 3 lanes while
   * bench time is banked). Defaults to the baseline single lane.
   */
  runningLanes = 1,
): CraftJobDisplayState {
  if (job.status !== 'active') return job.status;
  const ahead = allJobs
    .filter((j) => j.status === 'active' && j.bench === job.bench)
    .sort((a, b) => a.created_at_ms - b.created_at_ms || a.id.localeCompare(b.id));
  const position = ahead.findIndex((j) => j.id === job.id);
  if (position < 0 || position >= Math.max(1, runningLanes)) return 'queued';
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
  /**
   * Econ 7: the job's snapshotted escrow (per-job totals) — the held
   * line in the Workshop reads THIS, never the live recipe, so a
   * lever move can't make a running job's display lie about its cost.
   */
  escrowInputs: Record<string, number>;
  outputs: CraftJobOutput[];
  createdAtMs: number;
  completedAtMs: number | null;
  /**
   * Economy slice 10: this job occupies an EXTRA lane — it runs
   * (or holds its lane) only because bench time is banked. The
   * Workshop marks these cards so widened-envelope work reads
   * differently from baseline work at a glance. Always false on
   * the baseline lane and on bench 0.
   */
  extraLane: boolean;
  /** Repair jobs only: the vehicle + kit and total points restored. */
  repairItemId: string | null;
  repairKitType: string | null;
  repairPointsRestored: number;
  /** Shield-tech jobs only (0044): the shield + behavior swap and
   *  total calibration points applied. */
  shieldtechItemId: string | null;
  shieldtechFromBehavior: string | null;
  shieldtechToBehavior: string | null;
  shieldtechPointsApplied: number;
}

export function craftJobView(
  job: CraftJobRecord,
  allJobs: CraftJobRecord[],
  activeActionKind: string | null,
  /** Running lanes on THIS job's bench (bench-time widening). */
  runningLanes = 1,
): CraftJobView {
  const recipe = getCraftRecipe(job.recipe_id);
  const repair = job.kind === 'repair' ? job.snapshot.repair : undefined;
  const shieldtech = job.kind === 'shieldtech' ? job.snapshot.shieldtech : undefined;
  const benchPosition =
    job.status === 'active'
      ? [...allJobs]
          .filter((j) => j.status === 'active' && j.bench === job.bench)
          .sort((a, b) => a.created_at_ms - b.created_at_ms || a.id.localeCompare(b.id))
          .findIndex((j) => j.id === job.id)
      : -1;
  return {
    id: job.id,
    bench: job.bench,
    kind: job.kind,
    recipeId: job.recipe_id,
    name:
      recipe?.name ??
      (repair
        ? `Vehicle repair — ${repair.kitType}`
        : shieldtech
          ? `Shield recalibration — ${shieldtech.fromBehavior} → ${shieldtech.toBehavior}`
          : job.recipe_id),
    state: deriveJobDisplayState(job, allJobs, activeActionKind, runningLanes),
    extraLane: benchPosition > 0 && benchPosition < Math.max(1, runningLanes),
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
    escrowInputs: job.escrow_inputs,
    outputs: job.outputs,
    createdAtMs: job.created_at_ms,
    completedAtMs: job.completed_at_ms,
    repairItemId: repair?.itemId ?? null,
    repairKitType: repair?.kitType ?? null,
    repairPointsRestored: job.outputs.reduce((sum, o) => sum + (o.pointsRestored ?? 0), 0),
    shieldtechItemId: shieldtech?.itemId ?? null,
    shieldtechFromBehavior: shieldtech?.fromBehavior ?? null,
    shieldtechToBehavior: shieldtech?.toBehavior ?? null,
    shieldtechPointsApplied: job.outputs.reduce((sum, o) => sum + (o.pointsApplied ?? 0), 0),
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
  /**
   * Economy brief §4.4: the server's resolved per-recipe Scrap costs.
   * The Workshop displays THESE (falling back to content literals
   * when the field is absent) so the number shown is the number
   * charged. Optional so older payloads stay valid.
   */
  recipeScrapCosts?: Record<string, number>;
  /**
   * Economy slice 10 (brief §8.2/§8.3): the bench-time bank as the
   * server reads it — the balance, the cap and per-ad grant (the
   * resolved levers), and the player's own Fixer queue bonus (the
   * envelope's last input). The view derives the envelope from
   * these via content benchEnvelope, so the numbers the Workshop
   * shows are the numbers the enqueue gate enforces. Optional so
   * older payloads stay valid; both stores supply it.
   */
  benchTime?: {
    bankedSeconds: number;
    capSeconds: number;
    grantSeconds: number;
    queueBonus: number;
  };
}): Record<string, unknown> {
  const sorted = [...parts.jobs].sort(
    (a, b) => a.created_at_ms - b.created_at_ms || a.id.localeCompare(b.id),
  );
  const benchTime = parts.benchTime
    ? (() => {
        const envelope = benchEnvelope(parts.benchTime.bankedSeconds, parts.benchTime.queueBonus);
        return {
          bankedSeconds: parts.benchTime.bankedSeconds,
          capSeconds: parts.benchTime.capSeconds,
          grantSeconds: parts.benchTime.grantSeconds,
          wideActive: envelope.wide,
          runningLimit: envelope.running,
          queueLimit: envelope.queued,
          capacity: envelope.capacity,
        };
      })()
    : undefined;
  const benchRunningLanes = benchTime?.wideActive ? benchTime.runningLimit : 1;
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
    jobs: sorted.map((job) =>
      craftJobView(job, sorted, parts.activeActionKind, job.bench === 1 ? benchRunningLanes : 1),
    ),
    masteries: parts.masteries,
    activeActionKind: parts.activeActionKind,
    recentCompletions,
    ...(parts.recipeScrapCosts ? { recipeScrapCosts: parts.recipeScrapCosts } : {}),
    ...(benchTime ? { benchTime } : {}),
  };
}
