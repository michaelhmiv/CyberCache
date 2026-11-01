/**
 * Store seam for the legacy Chef gameplay routes (Route B, slice B6).
 *
 * /api/claim, /api/verify-boss, /api/settle-offline and /api/salvage are
 * the original Chef surface (June): Express handlers verified the
 * caller's bearer token, ran the shared TypeScript engine
 * (src/server/chef.ts), and persisted the outcome through five
 * Chef-internal Postgres functions reached over PostgREST. B6 moves
 * them onto the Chef JWT (src/server/routes/chefRouteAuth.ts) and onto
 * direct Postgres through this seam — PgChefGameplayStore in
 * production, InMemoryChefGameplayStore in tests — calling the ports
 * in db/migrations/0007_chef_gameplay_appliers.sql (and, for salvage,
 * cc_recycle_item from 0004_write_apis.sql, ported in B3).
 *
 * Handlers never see a pool or a query: they call these methods with
 * the JWT-derived player id, exactly like the B2/B3 stores. Store
 * failures carry the raw Postgres message (GameplayStoreError) because
 * the legacy handlers surface it in their response `detail` fields,
 * the way PostgREST surfaced it in June.
 */
import type { Pool } from 'pg';
import type { Json } from '../writes/store';
import type { GearItem, Vehicle } from '../../types/items';
import type { ConsumableBatchRow } from '../../lib/consumables/batchProfile';
import { finalizePendingCraftedGear } from '../writes/craftFinalize';
import type { DiscoveryRecord } from '../../content/collections';
import { getRoamingArea } from '../../constants/roamingAreas';
import {
  EXTRACTION_MASTERY_XP_PER_PASS,
  extractionGearFactor,
  extractionPassDraws,
  extractionPassXp,
  resolveExtractionLevers,
  rollExtractionPass,
  type ExtractionMethod,
  type ExtractionShieldFacts,
} from '../../content/extraction';
import { applyXp, masteryLevelForXp } from '../writes/store';
import { isHotArea } from '../../content/hotArea';
import { createTickRng } from '../../lib/rng/tickRng';
import { skillBonusesFromRecords } from './serverLoadout';

export type { Json };

export class GameplayStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameplayStoreError';
  }
}

/** profiles subset the claim handler reads (June: PostgREST select). */
export interface RoamingProfileRow {
  /** DB level — the area-gate authority (never the claim body's level). */
  player_level: number;
  /** Server-side skill spends — the claim route rebuilds skillBonuses from this, never from a client body (trust hardening). */
  skill_spends: Json;
  last_claimed_tick: number;
  consumables: Json;
  /** Banked fractional scrap (migration 0009), 0 <= x < 1. */
  scrap_remainder: number;
  /** Banked fractional credits (migration 0010), 0 <= x < 1. */
  credits_remainder: number;
  /** Banked fractional XP (migration 0010), 0 <= x < 1. */
  xp_remainder: number;
  /** Vehicle tank fuel units (migration 0021), profiles.vehicle_fuel. */
  vehicle_fuel: number;
  /** Cache Rank spends (migration 0031) — routes resolve the claim's Cache Rank bonuses from this, never from a client body. */
  cache_rank_spends: Json;
}

/** profiles subset the boss handler reads. */
export interface BossProfileRow {
  player_level: number;
  credits: number;
  consumables: Json;
  boss_state: Json;
  /** Server-side skill spends — the boss route rebuilds skillBonuses from this, never from a client body (trust hardening). */
  skill_spends: Json;
  /** Action skill charge pool, 0..100 (migration 0030). */
  action_skill_charge: number;
  /** Recorded action skill selection (a SkillTreeType name), or null (0030). */
  action_skill_selection: string | null;
  /** Cache Rank spends (migration 0031) — the boss route resolves Cache Rank bonuses from this, never from a client body. */
  cache_rank_spends: Json;
}

/**
 * The action-skill facts (migration 0030): everything the action
 * skill routes derive qualification/selection/charge from — the
 * player's OWN server records, never the request body.
 */
export interface ActionSkillFacts {
  skill_spends: Json;
  /** Equipped class mod payload ({} when none equipped). */
  class_mod_payload: Json;
  action_skill_charge: number;
  action_skill_selection: string | null;
}

/** profiles subset the offline-settlement handler reads. */
export interface SettlementProfileRow {
  player_level: number;
  /** Server-side skill spends (profiles.skill_spends) — offline settlement rebuilds skillBonuses from this, never from a client body. */
  skill_spends: Json;
  consumables: Json;
  last_claimed_tick: number;
  last_roaming_settled_at: string | null;
  last_settlement_nonce: string | null;
  offline_cap_hours: number | null;
  /** Banked fractional scrap (migration 0009), 0 <= x < 1. */
  scrap_remainder: number;
  /** Banked fractional credits (migration 0010), 0 <= x < 1. */
  credits_remainder: number;
  /** Banked fractional XP (migration 0010), 0 <= x < 1. */
  xp_remainder: number;
  /** Vehicle tank fuel units (migration 0021), profiles.vehicle_fuel. */
  vehicle_fuel: number;
  /** Cache Rank spends (migration 0031) — offline settlement resolves Cache Rank bonuses from this, never from a client body. */
  cache_rank_spends: Json;
}

/**
 * The Cache Rank facts (migration 0031): the player's own server
 * records the /api/cache-rank routes render from — level and XP
 * (the earning input + next-token progress), the token balance, the
 * grant watermark, and the spend record. Never the request body.
 */
export interface CacheRankFacts {
  player_level: number;
  player_xp: number;
  cache_rank_tokens: number;
  cache_rank_grant_level: number;
  cache_rank_spends: Json;
}

/**
 * A dispatch mission row (migration 0032) — the read model the
 * /api/dispatch routes render from. Terms are the DEPARTURE
 * snapshot; settlement facts land on the same row.
 */
export interface DispatchMissionRow {
  id: string;
  contract_family: string;
  offer_id: string;
  seed: string;
  destination_area_id: string;
  duration_hours: number;
  status: string;
  loadout_item_ids: string[];
  loadout_strength: number;
  payout_credits: number;
  payout_scrap: number;
  payout_material_id: string | null;
  payout_material_units: number;
  vehicle_item_id: string | null;
  vehicle_class_id: string | null;
  route_ticks: number | null;
  fuel_charged_units: number;
  fuel_refunded_units: number;
  condition_at_departure: number | null;
  wear_projected: number | null;
  wear_applied: number | null;
  breakdown_fraction: number | null;
  cargo_bonus_units: number;
  premium_multiplier: number | null;
  payout_fraction: number | null;
  departed_at: string;
  ends_at: string;
  settled_at: string | null;
}

/**
 * An item_instances row as the dispatch routes read it: everything
 * the term computation needs (state for eligibility, level/rarity
 * for strength, payload + condition for courier math) — server
 * records only, never the request body.
 */
export interface DispatchCandidateItem {
  id: string;
  kind: string;
  runtime_state: string;
  is_locked: boolean;
  equipped_slot: string | null;
  item_level: number;
  rarity: string | null;
  condition_current: number | null;
  condition_max: number | null;
  payload: Json;
}

/** Profile facts the dispatch routes derive terms from. */
export interface DispatchProfileFacts {
  player_level: number;
  vehicle_fuel: number;
  credits: number;
  scrap: number;
}

/**
 * An extraction_state row (migration 0033) — the read model the
 * /api/extraction routes render from. The standing selection
 * (area_id/method) is what the player picked; the in-progress pass
 * keeps the terms it started on (pass_area_id/pass_method) until the
 * next pass boundary adopts the selection.
 */
export interface ExtractionStateRow {
  area_id: string;
  method: string;
  pass_area_id: string;
  pass_method: string;
  accrued_ms: number;
  pending_passes: Array<{ index: number; areaId: string; method: string }>;
  finalized_passes: number;
  total_xp_awarded: number;
  last_settled_ms: number;
}

/** Facts the extraction preview prices from — server records only. */
export interface ExtractionFacts {
  player_level: number;
  player_xp: number;
  mastery_level: number;
  mastery_xp: number;
  shield_hp: number;
  shield_mitigation: number;
  shield_element: string | null;
}

/** One finalized pass in a settle result (route display shape). */
export interface ExtractionSettlePass {
  index: number;
  areaId: string;
  method: string;
  draws: number;
  gearFactor: number;
  deepDegraded: boolean;
  xpAwarded: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
  signatureUnits: number;
}

/** A settle batch's outcome (accrue + finalize). */
export interface ExtractionSettle {
  advancedMs: number;
  passes: ExtractionSettlePass[];
  xpAwarded: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
}

/** Inputs the extraction settler prices with — all server-derived. */
export interface ExtractionSettleInput {
  levers: {
    extractXpRate: number;
    extractFindsPerHour: number;
    extractSignatureChance: number;
    extractDeepYieldMult: number;
    extractGearFactorFloor: number;
    extractMasteryYieldPerLevel: number;
  };
  hotAreaMaterialBonus: number;
  /** Explicit cap for offline settlement; null = lazy settle rules. */
  maxAdvanceMs?: number | null;
  /** Cache Rank Fast Learner fraction, resolved by the route from
   *  the economy snapshot (the applier resolves its own in SQL from
   *  the same spends + config; the two are pinned equal by tests). */
  cacheRankXpFraction: number;
  /** The day key the hot-area stamp is read against (route clock). */
  now: Date;
}

/** active_actions row the offline-settlement handler reads. */
export interface ActiveActionRow {
  user_id: string;
  active_action: string;
  target_id: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  activity_payload: Json;
}

/** Reward bundle the claim/settlement handlers persist (June RPC args). */
export interface ChefRewardsInput {
  credits: number;
  scrap: number;
  /** New banked fractional scrap to persist (migration 0009); omit/null leaves the bank untouched. */
  scrapRemainder?: number | null;
  /** New banked fractional credits to persist (migration 0010); omit/null leaves the bank untouched. */
  creditsRemainder?: number | null;
  /** New banked fractional XP to persist (migration 0010); omit/null leaves the bank untouched. */
  xpRemainder?: number | null;
  xp: number;
  fragments: number;
  materials: Json;
  essences: Json;
  kills: number;
}

/** Boss attempt outcome the verify-boss handler persists. */
export interface ChefBossAttemptInput {
  bossId: string;
  attemptNonce: number;
  victory: boolean;
  creditsDelta: number;
  xp: number;
  consumables: Json;
  attempt: Json;
  unlockedBossId: string | null;
  /** Second Opinion auto-scrap credit (0008 applier arg; 0 when it didn't fire). */
  scrap: number;
  /** Entry fee charged for the attempt (0011 applier arg; already folded into creditsDelta). */
  entryFee: number;
  /**
   * Action skill tree fired in this attempt (0030 applier arg), or
   * null. Route-resolved from server records; the applier re-validates
   * selection + keystone qualification + full charge under the row
   * lock and zeroes the pool — or accrues at actionSkillChargeRate
   * when null.
   */
  actionSkillTree?: string | null;
  /** Route-resolved charge accrual rate (memory mirror; SQL reads its own config). */
  actionSkillChargeRate?: number;
}

/**
 * Server death record (migration 0013, profiles.death_state). Written
 * by recordDeath when the claim sim kills the hunter; the authority
 * the resurrection op validates against. '{}' / null = alive.
 */
export interface DeathRecord {
  /** Epoch ms of the killing tick (engine feed-event clock). */
  diedAtMs: number;
  areaId: string;
  monsterId: string;
  monsterName: string;
}

/** Resurrection op input (migration 0013, cc_resurrect). */
export interface ResurrectInput {
  nonce: string;
  method: 'free' | 'paid';
  /**
   * Paid-path price, derived by the route from the shared
   * resurrectionCostForArea() over the RECORDED death area — never
   * from the request body. Ignored for the free path.
   */
  paidCost: number;
  /**
   * Free-timer duration (shared RESURRECTION_FREE_TIMER_MS); the SQL
   * validates it against the server clock and the recorded death.
   */
  freeTimerMs: number;
}

/**
 * One endless run row (migration 0028, endless_runs). The run is
 * server-owned state: depth, escrow, and history live here, never on
 * the client. Best depth is DERIVED from ended rows (no profile
 * column), so the later leaderboards slice reads the same facts.
 */
export interface EndlessRunRow {
  id: string;
  status: 'active' | 'banked' | 'died' | 'abandoned';
  started_at: string;
  ended_at: string | null;
  start_level: number;
  risk: string;
  prepared_consumables: Record<string, number>;
  depth_reached: number;
  escrow_credits: number;
  escrow_xp: number;
  escrow_scrap: number;
  entry_fee: number;
  milestone_drops: Array<{ depth: number; rarity: string; kind: string; name: string }>;
  paid_credits: number;
  paid_xp: number;
  paid_scrap: number;
  payout_fraction: number | null;
}

/** Facts-only endless read model (prep screen + later Profile slice). */
export interface EndlessFacts {
  /** Deepest depth over ENDED runs (0 when no run has ended). */
  bestDepth: number;
  /** Runs started since the UTC day start (drives the fee escalation). */
  runsStartedToday: number;
  /** Most recent ended runs, newest first (max 10). */
  recentRuns: EndlessRunRow[];
}

/** cc_start_endless_run input (migration 0028). */
export interface StartEndlessRunInput {
  nonce: string;
  risk: string;
  /** The prepared belt (boss-prep semantics), validated ≤ owned by route + applier. */
  preparedConsumables: Record<string, number>;
  /**
   * The route's fee expectation (content formula over route-resolved
   * levers). The SQL applier recomputes the fee from economy_config
   * and charges ITS figure — this value only feeds the in-memory
   * mirror, never the charging path.
   */
  entryFee: number;
  /** Route-resolved death fraction (memory mirror; SQL reads its own config). */
  deathPayoutFraction: number;
}

/** cc_apply_endless_encounter input (migration 0028). */
export interface ApplyEndlessEncounterInput {
  nonce: string;
  runId: string;
  /** Server-derived depth (run.depth_reached + 1 at the route). */
  depth: number;
  victory: boolean;
  /** Escrow deltas from the engine (0s on defeat). */
  rewards: { xp: number; credits: number; scrap: number };
  /** Public encounter facts + resolution, stored on the run history + ledger. */
  encounter: Json;
  /** Milestone drop facts when the engine rolled one (display facts of a server-generated item). */
  milestoneDrop: { rarity: string; kind: string; name: string } | null;
  /** Victory reached the depth cap — the applier banks the run in full. */
  capReached: boolean;
  /** Route-resolved death fraction (memory mirror; SQL reads its own config). */
  deathPayoutFraction: number;
  /**
   * Action skill tree fired in this encounter (0030), or null. The
   * applier validates + spends (or accrues at actionSkillChargeRate)
   * exactly like the boss applier; a run-ending encounter resets the
   * pool after the spend/accrue.
   */
  actionSkillTree?: string | null;
  /** Route-resolved charge accrual rate (memory mirror; SQL reads its own config). */
  actionSkillChargeRate?: number;
}

/** cc_end_endless_run input (migration 0028) — voluntary bank. */
export interface EndEndlessRunInput {
  nonce: string;
  /** Route-resolved death fraction (unused on the bank path; kept for shape parity). */
  deathPayoutFraction: number;
}

/** Loadout slot order the client builds claim gear arrays in. */
export const LOADOUT_SLOT_ORDER = ['primary', 'secondary', 'heavy', 'shield', 'classMod', 'relic', 'ordnance'] as const;

export type LoadoutSlot = (typeof LOADOUT_SLOT_ORDER)[number];

/**
 * One equipped item instance with its slot identity intact. The flat
 * getEquippedGear() payloads lose which weapon slot a weapon sits in;
 * the boss route needs exact slots (primary vs secondary vs heavy),
 * so it reads these entries and maps them by slot name.
 */
export interface EquippedItemEntry {
  slot: LoadoutSlot;
  item: GearItem;
}

/**
 * The equipped vehicle instance (migration 0021): the payload plus
 * the row's condition columns — condition lives on the row, not in
 * the payload, so the claim routes must read both together.
 */
export interface EquippedVehicleRow {
  instanceId: string;
  vehicle: Vehicle;
  conditionCurrent: number;
  conditionMax: number;
}

/** End-of-claim vehicle state the routes persist (cc_apply_vehicle_usage). */
export interface VehicleUsageInput {
  instanceId: string;
  /** Tank fuel units after the claim (profiles.vehicle_fuel). */
  fuelUnits: number;
  /** Vehicle condition after the claim (item_instances.condition_current). */
  conditionCurrent: number;
}

export interface ChefGameplayStore {
  getRoamingProfile(playerId: string): Promise<RoamingProfileRow | null>;
  getBossProfile(playerId: string): Promise<BossProfileRow | null>;
  getSettlementProfile(playerId: string): Promise<SettlementProfileRow | null>;
  getActiveAction(playerId: string): Promise<ActiveActionRow | null>;
  /**
   * The player's consumable batch rows (quality > 0), in burn order
   * per type (quality asc, then oldest first) — the input the claim /
   * settlement / verify-boss routes turn into unit quality profiles
   * for the quality-wired engines (crafting §2.4). Counts stay
   * authoritative in profiles.consumables; batches only price the
   * units' quality.
   */
  getConsumableBatches(playerId: string): Promise<ConsumableBatchRow[]>;
  /**
   * Offline craft settlement (crafting §2.1 + F5): run the craft
   * settler with the caller's effective offline cap as the total
   * advance cap, then finalize any pending crafted gear. Returns the
   * settler result (completions feed the offline recap's crafting
   * section). Only meaningful when the recorded action is crafting —
   * the settlement route checks that first.
   */
  settleOfflineCraftJobs(playerId: string, capMs: number): Promise<Json>;
  /**
   * The player's equipped gear from the server's own records
   * (item_instances rows with runtime_state 'equipped'), payloads in
   * loadout slot order. This is the loadout source of truth for
   * server-side settlement — NOT the runtime display snapshot, which
   * is hydration support only and never economy authority.
   */
  getEquippedGear(playerId: string): Promise<GearItem[]>;
  /**
   * The same equipped rows as getEquippedGear, but with each row's
   * loadout slot attached, in loadout slot order. Used where slot
   * identity is an engine input (the boss sim's per-slot fields).
   */
  getEquippedItems(playerId: string): Promise<EquippedItemEntry[]>;
  /**
   * The player's equipped vehicle instance (equipped_slot 'vehicle'),
   * or null when roaming on foot. Kept OUT of getEquippedGear: the
   * combat engines must never price a vehicle payload as gear.
   */
  getEquippedVehicle(playerId: string): Promise<EquippedVehicleRow | null>;
  /**
   * Persist a claim's vehicle outcome (cc_apply_vehicle_usage):
   * tank fuel + the equipped instance's condition, applied only
   * while that instance is still the player's equipped vehicle.
   */
  applyVehicleUsage(playerId: string, usage: VehicleUsageInput): Promise<Json>;
  applyChefRewards(playerId: string, rewards: ChefRewardsInput, tickCount: number, areaId: string): Promise<Json>;
  storeChefItems(playerId: string, items: unknown[]): Promise<Json>;
  consumeRoamingConsumables(playerId: string, consumed: Json, areaId: string, tickCount: number): Promise<Json>;
  /** The standing death record, or null when the hunter is alive. */
  getDeathRecord(playerId: string): Promise<DeathRecord | null>;
  /**
   * Persist a claim-sim kill (cc_record_death). First death wins: an
   * already-standing record is returned unchanged with recorded=false.
   */
  recordDeath(playerId: string, death: DeathRecord): Promise<{ recorded: boolean; death: DeathRecord }>;
  /**
   * Persist a claim's roaming-event telemetry (migration 0023,
   * cc_record_roaming_events): one 'roaming.event' ledger row (the
   * fired events + count, the realized-EV input for economy
   * observability) and one 'roaming.elite_kill' row when named elites
   * died (feeds the combat.elite_kills mastery via the ledger
   * trigger). Telemetry only — pays nothing; the routes call it
   * log-and-continue after the claim has been paid.
   */
  recordRoamingEvents(
    playerId: string,
    input: {
      events: Array<{ eventId: string; family: string }>;
      eliteKills: number;
      areaId: string;
      tickCount: number;
    },
  ): Promise<Json>;
  /**
   * The resurrection op (cc_resurrect). Returns the function's payload:
   * { resurrected: true, ... } on success (plus idempotent_replay on a
   * nonce replay) or { resurrected: false, reason, ... } on a
   * validation failure — the route maps reasons to HTTP statuses.
   */
  resurrect(playerId: string, input: ResurrectInput): Promise<Json>;
  applyChefBossAttempt(playerId: string, attempt: ChefBossAttemptInput): Promise<Json>;
  /**
   * The action-skill facts for the /api/action-skill routes (0030):
   * skill spends, the equipped class mod payload, the charge pool,
   * and the recorded selection — all server records.
   */
  getActionSkillFacts(playerId: string): Promise<ActionSkillFacts | null>;
  /**
   * Record (or clear, tree = null) the player's active action skill
   * selection (cc_set_action_skill_selection, 0030). The applier
   * validates the choice against keystone qualification derived from
   * the player's own records; nonce-idempotent via the ledger.
   */
  setActionSkillSelection(playerId: string, nonce: string, tree: string | null): Promise<Json>;
  /**
   * The Cache Rank facts for the /api/cache-rank routes (0031):
   * level/XP, token balance, grant watermark, spends — server
   * records only.
   */
  getCacheRankFacts(playerId: string): Promise<CacheRankFacts | null>;
  /**
   * Observe-and-grant (cc_grant_cache_rank_tokens, 0031): pays any
   * ungranted level entitlement and advances the watermark.
   * Idempotent — repeats pay nothing.
   */
  grantCacheRankTokens(playerId: string): Promise<Json>;
  /**
   * Spend one Cache Rank rank (cc_spend_cache_rank, 0031): applies
   * any pending grant inline, then validates balance/cap against
   * server records and debits. Nonce-idempotent via the ledger.
   */
  spendCacheRankBonus(playerId: string, nonce: string, bonusId: string): Promise<Json>;
  /**
   * Dispatch facts (0032): profile level/fuel + every item the
   * player owns, for the routes' term computation. Server records
   * only.
   */
  getDispatchFacts(playerId: string): Promise<{ profile: DispatchProfileFacts; items: DispatchCandidateItem[] } | null>;
  /** The player's dispatch missions (active first, then recent). */
  listDispatchMissions(playerId: string, limit: number): Promise<DispatchMissionRow[]>;
  /**
   * Commit a contract (cc_dispatch_depart, 0032): the SQL applier
   * re-validates every state fact (queue slots, item/vehicle
   * availability, class-band gate, fuel) and locks the committed
   * instances. `terms` is the route's content-owner snapshot.
   * Nonce-idempotent via the ledger.
   */
  departDispatch(playerId: string, nonce: string, terms: Json): Promise<Json>;
  /**
   * The stored departure for a nonce, if one was already applied
   * (the ledger row cc_dispatch_depart wrote). The start route
   * consults this BEFORE pricing: after a departure the committed
   * instances are in_service, so re-pricing a replayed request
   * would refuse it — the nonce, not the current state, decides
   * whether a start is a replay.
   */
  getDispatchDeparture(playerId: string, nonce: string): Promise<Json | null>;
  /**
   * Settle every due mission (cc_dispatch_settle_due, 0032):
   * pro-rata/breakdown settlement from the mission rows' own
   * snapshots, on the server clock. Idempotent.
   */
  settleDispatchDue(playerId: string): Promise<Json>;
  /**
   * Recall a running mission (cc_dispatch_recall, 0032): settles
   * now at the elapsed fraction, capped at the breakdown point.
   * Nonce-idempotent via the ledger.
   */
  recallDispatch(playerId: string, nonce: string, missionId: string): Promise<Json>;
  /**
   * The player's extraction_state row (0033) after a lazy accrual
   * (cc_settle_extraction_time): completed passes wait in
   * pending_passes until a settle finalizes them. Null when the
   * player has never started extraction.
   */
  getExtractionState(playerId: string): Promise<ExtractionStateRow | null>;
  /**
   * Level, gathering.extraction mastery, and equipped-shield facts
   * the extraction preview prices from — server records only.
   */
  getExtractionFacts(playerId: string): Promise<ExtractionFacts | null>;
  /**
   * Full extraction settle (0033): accrue under the settlement
   * window (or the explicit maxAdvanceMs cap for offline
   * settlement), roll every completed pass against the shipped find
   * pool, and persist the batch through cc_apply_extraction, which
   * re-validates pass indexes + the material whitelist and prices
   * XP itself. Idempotent: finalized passes leave pending_passes.
   */
  settleExtraction(playerId: string, input: ExtractionSettleInput): Promise<ExtractionSettle>;
  /**
   * Victories against one boss since `dayStartIso` (UTC day start),
   * counted from the verified action ledger — the source for the
   * rematch-fee escalation (src/lib/bossFees.ts). Replayed nonces never
   * double-count: the ledger holds one row per applied attempt.
   */
  countBossVictoriesToday(playerId: string, bossId: string, dayStartIso: string): Promise<number>;
  /**
   * Start an endless run (cc_start_endless_run, 0028): charges the
   * escalating entry fee (destroyed), burns the prepared belt, takes
   * the personal action slot, and settles any still-active run as
   * abandoned at the death fraction — atomically, nonce-idempotent.
   */
  startEndlessRun(playerId: string, input: StartEndlessRunInput): Promise<Json>;
  /**
   * Persist one resolved endless encounter (cc_apply_endless_encounter,
   * 0028): escrows the engine's deltas on victory; on defeat (or the
   * depth cap) ends the run and pays escrow — the death fraction on
   * death, in full on the cap. Nonce-idempotent via the ledger.
   */
  applyEndlessEncounter(playerId: string, input: ApplyEndlessEncounterInput): Promise<Json>;
  /**
   * Voluntary bank (cc_end_endless_run, 0028): ends the player's
   * active run — the run id is derived from server state, never the
   * body — paying escrow in full and releasing the action slot.
   */
  endEndlessRun(playerId: string, input: EndEndlessRunInput): Promise<Json>;
  /** The player's currently active endless run, or null. */
  getActiveEndlessRun(playerId: string): Promise<EndlessRunRow | null>;
  /** Best depth, today's start count, and recent ended runs (facts only). */
  getEndlessFacts(playerId: string, dayStartIso: string): Promise<EndlessFacts>;
  /**
   * `capHours` (pacing-baseline tuning): the server-derived offline cap
   * — earnedOfflineCapHours(player level) + the Scavenger keystone's
   * offlineCapBonus — computed by the settlement route from server
   * records. When provided it overrides the stored profile preference
   * inside the settlement; when omitted the stored value applies
   * (legacy callers).
   */
  settleOfflineRoaming(playerId: string, settlementNonce: string, rewards: ChefRewardsInput, consumedConsumables?: Json, capHours?: number): Promise<Json>;
  recycleItem(playerId: string, nonce: string, itemId: string): Promise<Json>;
  /**
   * Record collection discoveries proven by a settled server-side
   * fact (cc_record_discoveries, 0026). Entries are derived by the
   * routes from Chef/store results — never from the request body.
   * Insert-on-conflict-do-nothing; records, never pays. Routes call
   * it log-and-continue (the 0023 telemetry precedent).
   */
  recordDiscoveries(playerId: string, entries: DiscoveryRecord[]): Promise<Json>;
}

type Row = Record<string, unknown>;

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function json(value: unknown): Json {
  return (value ?? {}) as Json;
}

/** Parse a profiles.death_state jsonb value into a DeathRecord (null = alive). */
export function deathRecordFromJson(value: unknown): DeathRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const diedAtMs = num(record.diedAtMs);
  if (!diedAtMs) return null;
  return {
    diedAtMs,
    areaId: typeof record.areaId === 'string' ? record.areaId : '',
    monsterId: typeof record.monsterId === 'string' ? record.monsterId : '',
    monsterName: typeof record.monsterName === 'string' ? record.monsterName : '',
  };
}

/** Map a dispatch_missions row (0032) to the shared read model. */
export function dispatchMissionFromRow(row: Row): DispatchMissionRow {
  const ids = Array.isArray(row.loadout_item_ids) ? row.loadout_item_ids : [];
  return {
    id: String(row.id ?? ''),
    contract_family: String(row.contract_family ?? 'foot'),
    offer_id: String(row.offer_id ?? ''),
    seed: String(row.seed ?? ''),
    destination_area_id: String(row.destination_area_id ?? ''),
    duration_hours: num(row.duration_hours),
    status: String(row.status ?? 'active'),
    loadout_item_ids: ids.map((v) => String(v)),
    loadout_strength: num(row.loadout_strength),
    payout_credits: num(row.payout_credits),
    payout_scrap: num(row.payout_scrap),
    payout_material_id: row.payout_material_id === null || row.payout_material_id === undefined ? null : String(row.payout_material_id),
    payout_material_units: num(row.payout_material_units),
    vehicle_item_id: row.vehicle_item_id === null || row.vehicle_item_id === undefined ? null : String(row.vehicle_item_id),
    vehicle_class_id: row.vehicle_class_id === null || row.vehicle_class_id === undefined ? null : String(row.vehicle_class_id),
    route_ticks: numOrNull(row.route_ticks),
    fuel_charged_units: num(row.fuel_charged_units),
    fuel_refunded_units: num(row.fuel_refunded_units),
    condition_at_departure: numOrNull(row.condition_at_departure),
    wear_projected: numOrNull(row.wear_projected),
    wear_applied: numOrNull(row.wear_applied),
    breakdown_fraction: numOrNull(row.breakdown_fraction),
    cargo_bonus_units: num(row.cargo_bonus_units),
    premium_multiplier: numOrNull(row.premium_multiplier),
    payout_fraction: numOrNull(row.payout_fraction),
    departed_at: isoOrNull(row.departed_at) ?? '',
    ends_at: isoOrNull(row.ends_at) ?? '',
    settled_at: isoOrNull(row.settled_at),
  };
}

const ENDLESS_RUN_COLUMNS = `id, status, started_at, ended_at, start_level, risk,
  prepared_consumables, depth_reached, escrow_credits, escrow_xp, escrow_scrap,
  entry_fee, milestone_drops, paid_credits, paid_xp, paid_scrap, payout_fraction`;

/** Map an endless_runs row (0028) to the shared read model. */
export function endlessRunFromRow(row: Row): EndlessRunRow {
  const drops = Array.isArray(row.milestone_drops) ? row.milestone_drops : [];
  return {
    id: String(row.id ?? ''),
    status: (typeof row.status === 'string' ? row.status : 'active') as EndlessRunRow['status'],
    started_at: isoOrNull(row.started_at) ?? '',
    ended_at: isoOrNull(row.ended_at),
    start_level: num(row.start_level),
    risk: typeof row.risk === 'string' ? row.risk : 'Balanced',
    prepared_consumables: (json(row.prepared_consumables) ?? {}) as Record<string, number>,
    depth_reached: num(row.depth_reached),
    escrow_credits: num(row.escrow_credits),
    escrow_xp: num(row.escrow_xp),
    escrow_scrap: num(row.escrow_scrap),
    entry_fee: num(row.entry_fee),
    milestone_drops: drops.map((d) => {
      const drop = (d ?? {}) as Record<string, unknown>;
      return {
        depth: num(drop.depth),
        rarity: typeof drop.rarity === 'string' ? drop.rarity : '',
        kind: typeof drop.kind === 'string' ? drop.kind : '',
        name: typeof drop.name === 'string' ? drop.name : '',
      };
    }),
    paid_credits: num(row.paid_credits),
    paid_xp: num(row.paid_xp),
    paid_scrap: num(row.paid_scrap),
    payout_fraction: numOrNull(row.payout_fraction),
  };
}

/** Translate a pg failure into the raw-message GameplayStoreError. */
function translatePgError(err: unknown): never {
  if (err instanceof GameplayStoreError) throw err;
  const message = err instanceof Error ? err.message : String(err);
  throw new GameplayStoreError(message);
}

export class PgChefGameplayStore implements ChefGameplayStore {
  constructor(private readonly pool: Pool) {}

  private async one<T>(sql: string, params: unknown[], map: (row: Row) => T): Promise<T | null> {
    try {
      const { rows } = await this.pool.query(sql, params);
      const row = rows[0] as Row | undefined;
      return row ? map(row) : null;
    } catch (err) {
      return translatePgError(err);
    }
  }

  private async callJson(sql: string, params: unknown[]): Promise<Json> {
    try {
      const { rows } = await this.pool.query(sql, params);
      return (rows[0]?.result ?? {}) as Json;
    } catch (err) {
      return translatePgError(err);
    }
  }

  getRoamingProfile(playerId: string): Promise<RoamingProfileRow | null> {
    return this.one(
      'select player_level, skill_spends, last_claimed_tick, consumables, scrap_remainder, credits_remainder, xp_remainder, vehicle_fuel, cache_rank_spends from public.profiles where id = $1',
      [playerId],
      (row) => ({
        player_level: num(row.player_level),
        skill_spends: json(row.skill_spends),
        last_claimed_tick: num(row.last_claimed_tick),
        consumables: json(row.consumables),
        scrap_remainder: num(row.scrap_remainder),
        credits_remainder: num(row.credits_remainder),
        xp_remainder: num(row.xp_remainder),
        vehicle_fuel: num(row.vehicle_fuel),
        cache_rank_spends: json(row.cache_rank_spends),
      }),
    );
  }

  getBossProfile(playerId: string): Promise<BossProfileRow | null> {
    return this.one(
      'select player_level, credits, consumables, boss_state, skill_spends, action_skill_charge, action_skill_selection, cache_rank_spends from public.profiles where id = $1',
      [playerId],
      (row) => ({
        player_level: num(row.player_level),
        credits: num(row.credits),
        consumables: json(row.consumables),
        boss_state: json(row.boss_state),
        skill_spends: json(row.skill_spends),
        action_skill_charge: num(row.action_skill_charge),
        action_skill_selection:
          row.action_skill_selection === null || row.action_skill_selection === undefined
            ? null
            : String(row.action_skill_selection),
        cache_rank_spends: json(row.cache_rank_spends),
      }),
    );
  }

  async getActionSkillFacts(playerId: string): Promise<ActionSkillFacts | null> {
    const profile = await this.one(
      'select skill_spends, action_skill_charge, action_skill_selection from public.profiles where id = $1',
      [playerId],
      (row) => ({
        skill_spends: json(row.skill_spends),
        action_skill_charge: num(row.action_skill_charge),
        action_skill_selection:
          row.action_skill_selection === null || row.action_skill_selection === undefined
            ? null
            : String(row.action_skill_selection),
      }),
    );
    if (!profile) return null;
    const mod = await this.one(
      `select payload from public.item_instances
        where owner_user_id = $1 and runtime_state = 'equipped' and payload ? 'treeBonus'
        limit 1`,
      [playerId],
      (row) => json(row.payload),
    );
    return { ...profile, class_mod_payload: (mod ?? {}) as Json };
  }

  setActionSkillSelection(playerId: string, nonce: string, tree: string | null): Promise<Json> {
    return this.callJson('select public.cc_set_action_skill_selection($1, $2, $3) as result', [
      playerId,
      nonce,
      tree,
    ]);
  }

  getCacheRankFacts(playerId: string): Promise<CacheRankFacts | null> {
    return this.one(
      'select player_level, player_xp, cache_rank_tokens, cache_rank_grant_level, cache_rank_spends from public.profiles where id = $1',
      [playerId],
      (row) => ({
        player_level: num(row.player_level),
        player_xp: num(row.player_xp),
        cache_rank_tokens: num(row.cache_rank_tokens),
        cache_rank_grant_level: num(row.cache_rank_grant_level),
        cache_rank_spends: json(row.cache_rank_spends),
      }),
    );
  }

  grantCacheRankTokens(playerId: string): Promise<Json> {
    return this.callJson('select public.cc_grant_cache_rank_tokens($1) as result', [playerId]);
  }

  spendCacheRankBonus(playerId: string, nonce: string, bonusId: string): Promise<Json> {
    return this.callJson('select public.cc_spend_cache_rank($1, $2, $3) as result', [
      playerId,
      nonce,
      bonusId,
    ]);
  }

  async getDispatchFacts(playerId: string): Promise<{ profile: DispatchProfileFacts; items: DispatchCandidateItem[] } | null> {
    const profile = await this.one(
      'select player_level, vehicle_fuel, credits, scrap from public.profiles where id = $1',
      [playerId],
      (row) => ({
        player_level: num(row.player_level),
        vehicle_fuel: num(row.vehicle_fuel),
        credits: num(row.credits),
        scrap: num(row.scrap),
      }),
    );
    if (!profile) return null;
    try {
      const { rows } = await this.pool.query(
        `select id, kind, runtime_state, is_locked, equipped_slot, item_level, rarity,
                condition_current, condition_max, payload
           from public.item_instances where owner_user_id = $1
          order by created_at asc`,
        [playerId],
      );
      const items = (rows as Row[]).map((row) => ({
        id: String(row.id ?? ''),
        kind: String(row.kind ?? ''),
        runtime_state: String(row.runtime_state ?? 'available'),
        is_locked: Boolean(row.is_locked),
        equipped_slot: row.equipped_slot === null || row.equipped_slot === undefined ? null : String(row.equipped_slot),
        item_level: num(row.item_level),
        rarity: row.rarity === null || row.rarity === undefined ? null : String(row.rarity),
        condition_current: numOrNull(row.condition_current),
        condition_max: numOrNull(row.condition_max),
        payload: json(row.payload),
      }));
      return { profile, items };
    } catch (err) {
      return translatePgError(err);
    }
  }

  async listDispatchMissions(playerId: string, limit: number): Promise<DispatchMissionRow[]> {
    try {
      const { rows } = await this.pool.query(
        `select * from public.dispatch_missions where user_id = $1
          order by (status = 'active') desc, departed_at desc limit $2`,
        [playerId, Math.max(1, Math.trunc(limit) || 20)],
      );
      return (rows as Row[]).map((row) => dispatchMissionFromRow(row));
    } catch (err) {
      return translatePgError(err);
    }
  }

  departDispatch(playerId: string, nonce: string, terms: Json): Promise<Json> {
    return this.callJson('select public.cc_dispatch_depart($1, $2, $3) as result', [
      playerId,
      nonce,
      JSON.stringify(terms),
    ]);
  }

  async getDispatchDeparture(playerId: string, nonce: string): Promise<Json | null> {
    try {
      const { rows } = await this.pool.query(
        `select result_payload from public.verified_action_ledger
          where user_id = $1 and action_type = 'cc_dispatch_depart' and idempotency_key = $2
          limit 1`,
        [playerId, nonce],
      );
      const row = (rows as Row[])[0];
      return row ? json(row.result_payload) : null;
    } catch (err) {
      return translatePgError(err);
    }
  }

  settleDispatchDue(playerId: string): Promise<Json> {
    return this.callJson('select public.cc_dispatch_settle_due($1) as result', [playerId]);
  }

  recallDispatch(playerId: string, nonce: string, missionId: string): Promise<Json> {
    return this.callJson('select public.cc_dispatch_recall($1, $2, $3) as result', [
      playerId,
      nonce,
      missionId,
    ]);
  }

  getSettlementProfile(playerId: string): Promise<SettlementProfileRow | null> {
    return this.one(
      'select player_level, skill_spends, consumables, last_claimed_tick, last_roaming_settled_at, last_settlement_nonce, offline_cap_hours, scrap_remainder, credits_remainder, xp_remainder, vehicle_fuel, cache_rank_spends from public.profiles where id = $1',
      [playerId],
      (row) => ({
        player_level: num(row.player_level),
        skill_spends: json(row.skill_spends),
        consumables: json(row.consumables),
        last_claimed_tick: num(row.last_claimed_tick),
        last_roaming_settled_at: isoOrNull(row.last_roaming_settled_at),
        last_settlement_nonce:
          row.last_settlement_nonce === null || row.last_settlement_nonce === undefined
            ? null
            : String(row.last_settlement_nonce),
        offline_cap_hours: numOrNull(row.offline_cap_hours),
        scrap_remainder: num(row.scrap_remainder),
        credits_remainder: num(row.credits_remainder),
        xp_remainder: num(row.xp_remainder),
        vehicle_fuel: num(row.vehicle_fuel),
        cache_rank_spends: json(row.cache_rank_spends),
      }),
    );
  }

  getActiveAction(playerId: string): Promise<ActiveActionRow | null> {
    return this.one(
      'select user_id, active_action, target_id, started_at, last_heartbeat_at, activity_payload from public.active_actions where user_id = $1',
      [playerId],
      (row) => ({
        user_id: String(row.user_id),
        active_action: String(row.active_action),
        target_id: row.target_id === null || row.target_id === undefined ? null : String(row.target_id),
        started_at: isoOrNull(row.started_at),
        last_heartbeat_at: isoOrNull(row.last_heartbeat_at),
        activity_payload: json(row.activity_payload),
      }),
    );
  }

  async getConsumableBatches(playerId: string): Promise<ConsumableBatchRow[]> {
    try {
      const { rows } = await this.pool.query(
        `select consumable_type, quality_percent, quantity, created_at
           from public.consumable_batches
          where owner_user_id = $1 and quantity > 0
          order by consumable_type asc, quality_percent asc, created_at asc`,
        [playerId],
      );
      return (rows as Row[]).map((row) => ({
        consumable_type: String(row.consumable_type),
        quality_percent: num(row.quality_percent),
        quantity: num(row.quantity),
        created_at: isoOrNull(row.created_at) ?? undefined,
      }));
    } catch (err) {
      return translatePgError(err);
    }
  }

  async settleOfflineCraftJobs(playerId: string, capMs: number): Promise<Json> {
    const result = await this.callJson('select public.cc_settle_craft_jobs($1, $2) as result', [
      playerId,
      Math.max(0, Math.floor(capMs)),
    ]);
    await finalizePendingCraftedGear(this.pool, playerId);
    return result;
  }

  async getExtractionState(playerId: string): Promise<ExtractionStateRow | null> {
    // Lazy accrual first (0033): the read settles time before it
    // renders, exactly like the craft reads settle jobs.
    await this.callJson('select public.cc_settle_extraction_time($1, $2) as result', [playerId, null]);
    return this.one(
      `select area_id, method, pass_area_id, pass_method, accrued_ms, pending_passes,
              finalized_passes, total_xp_awarded,
              (extract(epoch from last_settled_at) * 1000)::bigint as last_settled_ms
         from public.extraction_state where user_id = $1`,
      [playerId],
      (row) => ({
        area_id: String(row.area_id),
        method: String(row.method),
        pass_area_id: String(row.pass_area_id),
        pass_method: String(row.pass_method),
        accrued_ms: num(row.accrued_ms),
        pending_passes: (Array.isArray(row.pending_passes) ? row.pending_passes : []).map((p) => {
          const pass = (p ?? {}) as Record<string, unknown>;
          return {
            index: num(pass.index),
            areaId: String(pass.areaId ?? ''),
            method: String(pass.method ?? 'surface'),
          };
        }),
        finalized_passes: num(row.finalized_passes),
        total_xp_awarded: num(row.total_xp_awarded),
        last_settled_ms: num(row.last_settled_ms),
      }),
    );
  }

  async getExtractionFacts(playerId: string): Promise<ExtractionFacts | null> {
    return this.one(
      `select p.player_level, p.player_xp,
              coalesce(m.mastery_level, 1) as mastery_level,
              coalesce(m.mastery_xp, 0) as mastery_xp,
              s.payload as shield_payload
         from public.profiles p
         left join public.player_masteries m
           on m.user_id = p.id and m.mastery_id = 'gathering.extraction'
         left join public.item_instances s
           on s.owner_user_id = p.id and s.runtime_state = 'equipped' and s.equipped_slot = 'shield'
        where p.id = $1`,
      [playerId],
      (row) => {
        const shield = (row.shield_payload ?? null) as Record<string, unknown> | null;
        return {
          player_level: num(row.player_level),
          player_xp: num(row.player_xp),
          mastery_level: num(row.mastery_level) || 1,
          mastery_xp: num(row.mastery_xp),
          shield_hp: shield && typeof shield.hp === 'number' ? shield.hp : 0,
          shield_mitigation: shield && typeof shield.mitigation === 'number' ? shield.mitigation : 0,
          shield_element: shield && typeof shield.element === 'string' ? shield.element : null,
        };
      },
    );
  }

  async settleExtraction(playerId: string, input: ExtractionSettleInput): Promise<ExtractionSettle> {
    const levers = resolveExtractionLevers(input.levers);
    const accrued = (await this.callJson('select public.cc_settle_extraction_time($1, $2) as result', [
      playerId,
      input.maxAdvanceMs == null ? null : Math.max(0, Math.floor(input.maxAdvanceMs)),
    ])) as Record<string, unknown>;
    const advancedMs = num(accrued.advanced_ms);
    const pending = (Array.isArray(accrued.pending_passes) ? accrued.pending_passes : []) as Array<Record<string, unknown>>;
    const empty: ExtractionSettle = { advancedMs, passes: [], xpAwarded: 0, materials: {}, essences: {} };
    if (pending.length === 0) return empty;

    // Roll every pending pass in the Chef (the SQL twin cannot roll:
    // the pool and the tick-RNG streams are TypeScript). Every input
    // is a server record: profile, mastery, equipped items.
    const profile = await this.getSettlementProfile(playerId);
    if (!profile) return empty;
    const facts = await this.getExtractionFacts(playerId);
    const items = await this.getEquippedItems(playerId);
    const gear = items.map((e) => e.item);
    const skillBonuses = skillBonusesFromRecords(gear, (profile.skill_spends ?? {}) as Record<string, number>);
    const lootQuantity = Math.max(0, skillBonuses.lootQuantity ?? 0);
    const shieldEntry = items.find((e) => e.slot === 'shield');
    const shieldPayload = (shieldEntry?.item ?? null) as unknown as Record<string, unknown> | null;
    const shield: ExtractionShieldFacts | null = shieldPayload && typeof shieldPayload.hp === 'number'
      ? {
          hp: shieldPayload.hp,
          mitigation: typeof shieldPayload.mitigation === 'number' ? shieldPayload.mitigation : 0,
          element: typeof shieldPayload.element === 'string' ? shieldPayload.element : null,
        }
      : null;

    // Level/mastery evolve as the batch pays out (a level-up mid-
    // batch reprices later passes, like craft units). The applier
    // recomputes XP authoritatively with the same sequential rule
    // (cc_extract_pass_xp + cc_apply_xp per pass); the pricing here
    // exists to evolve the level/mastery the DRAWS read, and the
    // memory twin runs the identical sequence.
    let level = profile.player_level || 1;
    let xpTotal = facts?.player_xp ?? 0;
    let masteryXp = facts?.mastery_xp ?? 0;
    let masteryLevel = facts?.mastery_level ?? 1;
    const rolled: Array<Record<string, unknown>> = [];
    for (const pass of pending) {
      const index = num(pass.index);
      const areaId = String(pass.areaId ?? '');
      const method = (String(pass.method ?? 'surface') === 'deep' ? 'deep' : 'surface') as ExtractionMethod;
      const area = getRoamingArea(areaId);
      const gearFactor = extractionGearFactor({ level, shield, area, levers });
      const math = extractionPassDraws({
        method,
        masteryLevel,
        gearFactor,
        isHot: isHotArea(area.id, input.now),
        levers,
        hotAreaMaterialBonus: input.hotAreaMaterialBonus,
      });
      const finds = rollExtractionPass(
        area,
        math.draws,
        {
          main: createTickRng(playerId, 'extract', index),
          signature: createTickRng(playerId, 'extract:signature', index),
          lootQuantity: createTickRng(playerId, 'extract:loot', index),
        },
        levers,
        lootQuantity,
      );
      rolled.push({
        index,
        area_id: area.id,
        method,
        draws: math.draws,
        gear_factor: gearFactor,
        deep_degraded: math.deepDegraded,
        finds_materials: finds.materials,
        finds_essences: finds.essences,
        signature_units: finds.signatureUnits,
      });
      // Sequential pricing evolution (mirrors the applier): this
      // pass's XP can level the player before the next pass prices.
      const passXp = Math.round(extractionPassXp(level, levers) * (1 + input.cacheRankXpFraction));
      const next = applyXp(level, xpTotal, passXp);
      level = next.player_level;
      xpTotal = next.player_xp;
      masteryXp += EXTRACTION_MASTERY_XP_PER_PASS;
      masteryLevel = masteryLevelForXp(masteryXp);
    }

    const firstIndex = rolled[0]?.index ?? 0;
    const applied = (await this.callJson('select public.cc_apply_extraction($1, $2, $3) as result', [
      playerId,
      `extraction-settle:${firstIndex}`,
      JSON.stringify(rolled),
    ])) as Record<string, unknown>;

    const appliedPasses = (Array.isArray(applied.passes) ? applied.passes : []) as Array<Record<string, unknown>>;
    return {
      advancedMs,
      xpAwarded: num(applied.xp_awarded),
      materials: (applied.finds_materials ?? {}) as Record<string, number>,
      essences: (applied.finds_essences ?? {}) as Record<string, number>,
      passes: appliedPasses.map((p) => ({
        index: num(p.index),
        areaId: String(p.area_id ?? ''),
        method: String(p.method ?? 'surface'),
        draws: num(p.draws),
        gearFactor: num(p.gear_factor),
        deepDegraded: Boolean(p.deep_degraded),
        xpAwarded: num(p.xp),
        materials: (p.finds_materials ?? {}) as Record<string, number>,
        essences: (p.finds_essences ?? {}) as Record<string, number>,
        signatureUnits: num(p.signature_units),
      })),
    };
  }

  async getEquippedGear(playerId: string): Promise<GearItem[]> {
    const entries = await this.getEquippedItems(playerId);
    return entries.map((entry) => entry.item);
  }

  async getEquippedItems(playerId: string): Promise<EquippedItemEntry[]> {
    try {
      const { rows } = await this.pool.query(
        `select equipped_slot, payload from public.item_instances
          where owner_user_id = $1 and runtime_state = 'equipped'
            and equipped_slot in ('primary','secondary','heavy','shield','classMod','relic','ordnance')
          order by array_position(array['primary','secondary','heavy','shield','classMod','relic','ordnance'], equipped_slot)`,
        [playerId],
      );
      return rows.map((row) => ({
        slot: String((row as Row).equipped_slot) as LoadoutSlot,
        item: (row as Row).payload as GearItem,
      }));
    } catch (err) {
      return translatePgError(err);
    }
  }

  getEquippedVehicle(playerId: string): Promise<EquippedVehicleRow | null> {
    return this.one(
      `select id, payload, condition_current, condition_max from public.item_instances
        where owner_user_id = $1 and runtime_state = 'equipped' and equipped_slot = 'vehicle'
        limit 1`,
      [playerId],
      (row) => ({
        instanceId: String(row.id),
        vehicle: row.payload as Vehicle,
        conditionCurrent: num(row.condition_current),
        conditionMax: num(row.condition_max),
      }),
    );
  }

  applyVehicleUsage(playerId: string, usage: VehicleUsageInput): Promise<Json> {
    return this.callJson('select public.cc_apply_vehicle_usage($1, $2, $3, $4) as result', [
      playerId,
      usage.instanceId,
      usage.fuelUnits,
      usage.conditionCurrent,
    ]);
  }

  applyChefRewards(playerId: string, rewards: ChefRewardsInput, tickCount: number, areaId: string): Promise<Json> {
    return this.callJson(
      'select public.cc_apply_chef_rewards($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) as result',
      [
        playerId,
        rewards.credits,
        rewards.scrap,
        rewards.xp,
        rewards.fragments,
        rewards.materials,
        rewards.essences,
        rewards.kills,
        tickCount,
        areaId,
        rewards.scrapRemainder ?? null,
        rewards.creditsRemainder ?? null,
        rewards.xpRemainder ?? null,
      ],
    );
  }

  storeChefItems(playerId: string, items: unknown[]): Promise<Json> {
    // JSON.stringify: a bare JS array would be sent as a Postgres
    // array literal, not as the jsonb document the function expects.
    return this.callJson('select public.cc_store_chef_items($1, $2) as result', [
      playerId,
      JSON.stringify(items),
    ]);
  }

  recordDiscoveries(playerId: string, entries: DiscoveryRecord[]): Promise<Json> {
    return this.callJson('select public.cc_record_discoveries($1, $2::jsonb) as result', [
      playerId,
      JSON.stringify(entries),
    ]);
  }

  consumeRoamingConsumables(playerId: string, consumed: Json, areaId: string, tickCount: number): Promise<Json> {
    return this.callJson('select public.cc_consume_roaming_consumables($1, $2, $3, $4) as result', [
      playerId,
      consumed,
      areaId,
      tickCount,
    ]);
  }

  getDeathRecord(playerId: string): Promise<DeathRecord | null> {
    return this.one(
      'select death_state from public.profiles where id = $1',
      [playerId],
      (row) => deathRecordFromJson(row.death_state),
    ).then((record) => record ?? null);
  }

  async recordDeath(playerId: string, death: DeathRecord): Promise<{ recorded: boolean; death: DeathRecord }> {
    const result = (await this.callJson('select public.cc_record_death($1, $2, $3, $4, $5) as result', [
      playerId,
      death.diedAtMs,
      death.areaId,
      death.monsterId,
      death.monsterName,
    ])) as Record<string, unknown>;
    const stored = deathRecordFromJson(result.death);
    return { recorded: result.recorded === true, death: stored ?? death };
  }

  recordRoamingEvents(
    playerId: string,
    input: {
      events: Array<{ eventId: string; family: string }>;
      eliteKills: number;
      areaId: string;
      tickCount: number;
    },
  ): Promise<Json> {
    return this.callJson('select public.cc_record_roaming_events($1, $2, $3, $4, $5) as result', [
      playerId,
      input.events.map((e) => ({ event_id: e.eventId, family: e.family })) as unknown as Json,
      Math.trunc(input.eliteKills),
      input.areaId,
      Math.trunc(input.tickCount),
    ]);
  }

  resurrect(playerId: string, input: ResurrectInput): Promise<Json> {
    return this.callJson('select public.cc_resurrect($1, $2, $3, $4, $5) as result', [
      playerId,
      input.nonce,
      input.method,
      Math.trunc(input.paidCost),
      Math.trunc(input.freeTimerMs),
    ]);
  }

  applyChefBossAttempt(playerId: string, attempt: ChefBossAttemptInput): Promise<Json> {
    return this.callJson(
      'select public.cc_apply_chef_boss_attempt($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) as result',
      [
        playerId,
        attempt.bossId,
        attempt.attemptNonce,
        attempt.victory,
        attempt.creditsDelta,
        attempt.xp,
        attempt.consumables,
        attempt.attempt,
        attempt.unlockedBossId,
        attempt.scrap,
        attempt.entryFee,
        attempt.actionSkillTree ?? null,
      ],
    );
  }

  startEndlessRun(playerId: string, input: StartEndlessRunInput): Promise<Json> {
    return this.callJson('select public.cc_start_endless_run($1, $2, $3, $4, $5) as result', [
      playerId,
      input.nonce,
      input.risk,
      input.preparedConsumables as unknown as Json,
      Math.trunc(input.entryFee),
    ]);
  }

  applyEndlessEncounter(playerId: string, input: ApplyEndlessEncounterInput): Promise<Json> {
    return this.callJson(
      'select public.cc_apply_endless_encounter($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as result',
      [
        playerId,
        input.nonce,
        input.runId,
        Math.trunc(input.depth),
        input.victory,
        input.rewards as unknown as Json,
        input.encounter,
        (input.milestoneDrop ?? null) as unknown as Json,
        input.capReached,
        input.actionSkillTree ?? null,
      ],
    );
  }

  endEndlessRun(playerId: string, input: EndEndlessRunInput): Promise<Json> {
    return this.callJson('select public.cc_end_endless_run($1, $2) as result', [playerId, input.nonce]);
  }

  getActiveEndlessRun(playerId: string): Promise<EndlessRunRow | null> {
    return this.one(
      `select ${ENDLESS_RUN_COLUMNS} from public.endless_runs
        where user_id = $1 and status = 'active'
        order by started_at desc limit 1`,
      [playerId],
      (row) => endlessRunFromRow(row),
    ).then((run) => run ?? null);
  }

  async getEndlessFacts(playerId: string, dayStartIso: string): Promise<EndlessFacts> {
    const best = await this.one(
      `select coalesce(max(depth_reached), 0)::int as best_depth from public.endless_runs
        where user_id = $1 and status <> 'active'`,
      [playerId],
      (row) => num(row.best_depth),
    );
    const started = await this.one(
      `select count(*)::int as started from public.verified_action_ledger
        where user_id = $1 and action_type = 'cc_start_endless_run'
          and created_at >= $2::timestamptz`,
      [playerId, dayStartIso],
      (row) => num(row.started),
    );
    let recentRuns: EndlessRunRow[] = [];
    try {
      const { rows } = await this.pool.query(
        `select ${ENDLESS_RUN_COLUMNS} from public.endless_runs
          where user_id = $1 and status <> 'active'
          order by ended_at desc nulls last, started_at desc limit 10`,
        [playerId],
      );
      recentRuns = (rows as Row[]).map((row) => endlessRunFromRow(row));
    } catch (err) {
      translatePgError(err);
    }
    return { bestDepth: best ?? 0, runsStartedToday: started ?? 0, recentRuns };
  }

  async countBossVictoriesToday(playerId: string, bossId: string, dayStartIso: string): Promise<number> {
    const count = await this.one(
      `select count(*)::int as victories from public.verified_action_ledger
        where user_id = $1 and action_type = 'cc_apply_boss_attempt'
          and result_payload->>'boss_id' = $2
          and coalesce((result_payload->'attempt'->>'victory')::boolean, false)
          and created_at >= $3::timestamptz`,
      [playerId, bossId, dayStartIso],
      (row) => num(row.victories),
    );
    return count ?? 0;
  }

  settleOfflineRoaming(playerId: string, settlementNonce: string, rewards: ChefRewardsInput, consumedConsumables?: Json, capHours?: number): Promise<Json> {
    return this.callJson('select public.cc_settle_offline_roaming($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) as result', [
      playerId,
      settlementNonce,
      rewards.credits,
      rewards.scrap,
      rewards.xp,
      rewards.fragments,
      rewards.materials,
      rewards.essences,
      rewards.kills,
      rewards.scrapRemainder ?? null,
      rewards.creditsRemainder ?? null,
      rewards.xpRemainder ?? null,
      // 0012: the engine's consumed set, applied atomically inside the
      // settlement (offline claims used to grant consumable benefits
      // without ever decrementing inventory).
      consumedConsumables ?? null,
      // 0015: the route's server-derived earned cap; null keeps the
      // function's stored-preference fallback for legacy callers.
      capHours ?? null,
    ]);
  }

  recycleItem(playerId: string, nonce: string, itemId: string): Promise<Json> {
    return this.callJson('select public.cc_recycle_item($1, $2, $3) as result', [playerId, nonce, itemId]);
  }
}
