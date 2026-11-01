/**
 * InMemoryChefGameplayStore — the test double behind ChefGameplayStore.
 *
 * Mirrors the observable semantics of the five Chef gameplay appliers
 * (db/migrations/0007_chef_gameplay_appliers.sql) and cc_recycle_item
 * (db/migrations/0004_write_apis.sql) the way the B2/B3 in-memory
 * stores mirror their SQL: same ledger keys, same replay behavior,
 * same profile mutations, same result payloads, same error messages.
 * The one deliberate simplification is consumable batches: the boss
 * applier tracks quality batches behind the profiles.consumables
 * totals (cc_add_consumable_batch / cc_consume_consumable_batch); the
 * routes only ever observe the totals and the profile snapshot, so
 * this double tracks the totals and returns an empty consumed_batches
 * list.
 *
 * State (profiles, items, ledger) is plain data so tests can seed and
 * inspect it directly. The clock is injectable so offline settlement
 * can be exercised at exact elapsed times.
 *
 * Mastery (0014): in Postgres the ledger trigger
 * (cc_apply_mastery_for_verified_action) grants mastery XP as a side
 * effect of the appliers' ledger inserts. This double mirrors the
 * trigger's SHIPPED branches (cc_apply_chef_rewards,
 * cc_apply_boss_attempt, cc_settle_offline_roaming) onto its own
 * `masteries` rows so HTTP tests can assert the same end state.
 * Stat counters are not mirrored here — they live in the writes
 * store's port of the same trigger.
 */
import { randomUUID } from 'node:crypto';
import { applyXp, computeItemEstimatedValue, masteryLevelForXp, salvageScrap, type Json } from '../writes/store';
import {
  deathRecordFromJson,
  GameplayStoreError,
  LOADOUT_SLOT_ORDER,
  type ActiveActionRow,
  type ActionSkillFacts,
  type CacheRankFacts,
  type LoginStreakFacts,
  type ContractsFacts,
  type DispatchCandidateItem,
  type DispatchMissionRow,
  type DispatchProfileFacts,
  type ExtractionFacts,
  type ExtractionSettle,
  type ExtractionSettleInput,
  type ExtractionStateRow,
  type ApplyEndlessEncounterInput,
  type BossProfileRow,
  type ChefBossAttemptInput,
  type ChefGameplayStore,
  type ChefRewardsInput,
  type DeathRecord,
  type EndEndlessRunInput,
  type EndlessFacts,
  type EndlessRunRow,
  type EquippedItemEntry,
  type EquippedVehicleRow,
  type LoadoutSlot,
  type StartEndlessRunInput,
  type VehicleUsageInput,
  type ResurrectInput,
  type RoamingProfileRow,
  type SettlementProfileRow,
} from './store';
import type { GearItem, Vehicle } from '../../types/items';
import { VEHICLE_CONDITION_MAX } from '../../lib/vehicles/vehicles';
import {
  computeSkillBonuses,
  type ClassModBoosts,
} from '../../lib/skills/skillBonuses';
import { applySalvageSkillBonuses } from '../../lib/skills/salvageBonuses';
import { legendaryCoreYieldFor, type DiscoveryRecord } from '../../content/collections';
import {
  accrueActionSkillCharge,
  isActionSkillTree,
  resolveActionSkill,
  resolveActionSkillLevers,
} from '../../content/actionSkills';
import {
  cacheRankBonusDef,
  cacheRankBonuses,
  cacheRankCostForRank,
  cacheRankEntitlement,
  resolveCacheRankLevers,
  sanitizeCacheRankSpends,
  type CacheRankLeverValues,
} from '../../content/cacheRank';
import {
  courierTierGate,
  resolveDispatchLevers,
  type DispatchLeverValues,
} from '../../content/dispatch';
import { getVehicleClass } from '../../lib/vehicles/vehicles';
import { SkillTreeType } from '../../types/game';
import type { ConsumableBatchRow } from '../../lib/consumables/batchProfile';
import {
  settleCraftJobs as settleCraftJobsCore,
  type CraftAdapter,
  type CraftJobRecord,
  type CraftProfileView,
  type WorkshopToolsState,
} from '../writes/craftEngine';
import {
  CONTRACT_STAT_KEYS,
  CONTRACT_TEMPLATE_BY_ID,
  contractBandById,
  contractBandForLevel,
  contractPeriodExpired,
  contractPeriodKey,
  contractPeriodWindow,
  contractProgressFor,
  contractRewardFor,
  contractSetBonusFor,
  contractSetSeed,
  contractTargetFor,
  drawContractReroll,
  drawContractSet,
  resolveContractLevers,
  type ContractBandId,
  type ContractInstanceRecord,
  type ContractLeverValues,
  type ContractPeriodKind,
  type ContractSetFacts,
  type ContractTemplate,
  type ContractWindowFacts,
} from '../../content/contracts';
import {
  isStandingManufacturer,
  isoWeekKey,
  rarityMeetsMinimum,
  resolveStandingLevers,
  standingOffer,
  standingRankDef,
  standingTributeCredits,
  standingTurnInAward,
  standingTurnInRefusal,
  utcDayKey,
  type StandingFacts,
  type StandingLeverValues,
} from '../../content/manufacturerStanding';
import { generateStandingOrderWeapon } from './standingOrder';
import { REGION_1_BOSSES } from '../../constants/bosses';

/** Band-eligible bounty source for contract draws (id + level only). */
const CONTRACT_BOSS_CHOICES = REGION_1_BOSSES.map((b) => ({ id: b.id, level: b.level }));
import {
  CRAFT_XP_RATE_DEFAULT,
  CRAFT_TIME_SCALAR_DEFAULT,
  CRAFT_QUALITY_SHIFT_DEFAULT,
  GEAR_TEMPER_BASE_CHANCE_DEFAULT,
  REFINE_BASE_YIELD_DEFAULT,
} from '../../content/crafting';
import {
  EXTRACTION_MASTERY_TRACK,
  resolveExtractionLevers,
  type ExtractionLeverValues,
  type ExtractionMethod,
} from '../../content/extraction';
import {
  loginStreakGrantFor,
  loginStreakLengthAfter,
  loginStreakPositionFor,
  loginStreakUtcDay,
  resolveLoginStreakLevers,
  type LoginStreakLeverValues,
} from '../../content/loginStreak';
import {
  RESEARCH_MASTERY_TRACK,
  computeResearchBonuses,
  researchCourse,
  researchEnrollmentTerms,
  researchMasteryXpFor,
  resolveResearchLevers,
  type ResearchBonuses,
  type ResearchFacts,
  type ResearchLeverValues,
} from '../../content/research';
import { isHotArea } from '../../content/hotArea';
import {
  accrueExtractionTime,
  finalizeExtractionPasses,
  type ExtractionAdapter,
  type ExtractionStateRecord,
} from '../writes/extractionEngine';
import {
  REPAIR_MASTERY_EFFICIENCY_PER_LEVEL_DEFAULT,
  REPAIR_MASTERY_SPEED_PER_LEVEL_DEFAULT,
  REPAIR_WORK_RATE_BASE_DEFAULT,
} from '../../content/repair';

/** A consumable batch row in this double (owner-attributed). */
export interface InMemoryConsumableBatch extends ConsumableBatchRow {
  owner_user_id: string;
  created_at: string;
}

export interface InMemoryProfile {
  id: string;
  player_level: number;
  player_xp: number;
  credits: number;
  scrap: number;
  /** Banked fractional scrap (migration 0009), 0 <= x < 1. */
  scrap_remainder: number;
  /** Banked fractional credits (migration 0010), 0 <= x < 1. */
  credits_remainder: number;
  /** Banked fractional XP (migration 0010), 0 <= x < 1. */
  xp_remainder: number;
  cache_tokens: number;
  cache_token_parts: number;
  /** Vehicle tank fuel units (migration 0021). */
  vehicle_fuel: number;
  /** Legendary core balance (migration 0026). */
  legendary_cores: number;
  /** Cache Rank token balance (migration 0031). */
  cache_rank_tokens: number;
  /** Cache Rank grant watermark — highest level whose entitlement is paid (0031). */
  cache_rank_grant_level: number;
  /** Cache Rank per-track spend ranks (migration 0031). */
  cache_rank_spends: Record<string, number>;
  /** Action skill charge pool 0..100 (migration 0030). */
  action_skill_charge: number;
  /** Recorded action skill selection (SkillTreeType name), or null (0030). */
  action_skill_selection: string | null;
  materials: Record<string, number>;
  essences: Record<string, number>;
  consumables: Record<string, number>;
  skill_spends: Json;
  boss_state: Record<string, unknown>;
  /** Server death record (migration 0013); {} = alive. */
  death_state: Record<string, unknown>;
  /** Server death log, newest first, cap 20 (migration 0013). */
  death_log: Array<{ monsterId: string; monsterName: string; areaId: string; at: number }>;
  last_idle_claim_at: string | null;
  last_claimed_tick: number;
  last_roaming_settled_at: string | null;
  last_settlement_nonce: string | null;
  offline_cap_hours: number | null;
  [key: string]: unknown;
}

export interface InMemoryItem {
  id: string;
  owner_user_id: string;
  kind: string;
  runtime_state: string;
  is_locked: boolean;
  rarity: string | null;
  item_level: number;
  estimated_value: number;
  supply_mode: string;
  tradeable: boolean;
  equipped_slot: string | null;
  /** Vehicle condition (item_instances columns, migration 0021); null for non-vehicles. */
  condition_current?: number | null;
  condition_max?: number | null;
  payload: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InMemoryActiveAction {
  user_id: string;
  active_action: string;
  target_id: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  activity_payload: Record<string, unknown>;
}

export interface ConsumableEvent {
  user_id: string;
  consumable_type: string;
  quantity_delta: number;
  event_type: string;
  activity_type: string;
  reason: string;
}

/** player_masteries row mirror (0014 mastery side effects). */
export interface InMemoryMastery {
  user_id: string;
  mastery_id: string;
  mastery_xp: number;
  mastery_level: number;
}

/**
 * cc_location_mastery_id (0014): roaming area id -> locations
 * mastery id. Dustwaste Frontier is special-cased: its mastery
 * definition ('locations.dustwaste') predates the area-id scheme.
 */
export function locationMasteryIdForArea(areaId: string | null | undefined): string | null {
  if (!areaId) return null;
  if (areaId === 'dustwaste_frontier') return 'locations.dustwaste';
  return `locations.${areaId}`;
}

/** weapons.<type> mastery id for a gear payload's weaponType. */
export function weaponMasteryIdForWeaponType(weaponType: unknown): string | null {
  if (typeof weaponType !== 'string' || weaponType.length === 0) return null;
  return `weapons.${weaponType.toLowerCase()}`;
}

/** Consumable types the trigger's ordnance family also feeds combat.ordnance. */
const ORDNANCE_FAMILY_PREFIXES = ['Ordnance', 'EMP', 'Corrosive', 'Magnetized', 'PhaseShift', 'Void'];

const TICK_MS = 3000;

function asRecord(value: unknown): Record<string, number> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = Math.trunc(Number(v) || 0);
    return out;
  }
  return {};
}

/** Item kind derivation — cc_store_chef_items' payload-key cascade. */
function itemKind(payload: Record<string, unknown>): string {
  if ('vehicleClassId' in payload) return 'vehicle';
  if ('weaponType' in payload) return 'weapon';
  if ('mitigation' in payload) return 'shield';
  if ('treeBonus' in payload) return 'classMod';
  if ('damage' in payload) return 'ordnance';
  if ('affixes' in payload) return 'relic';
  return 'gear';
}

export class InMemoryChefGameplayStore implements ChefGameplayStore {
  readonly profiles = new Map<string, InMemoryProfile>();
  readonly items = new Map<string, InMemoryItem>();
  readonly activeActions = new Map<string, InMemoryActiveAction>();
  readonly ledger = new Map<string, Json>();
  /**
   * Boss victory timestamps (the store clock), one entry per freshly
   * applied victory — the in-memory mirror of the verified action
   * ledger rows countBossVictoriesToday reads on the Pg store. The
   * ledger map itself carries no timestamps, so the escalation count
   * needs this side log; nonce replays return before it is appended.
   */
  readonly bossVictoryLog: Array<{ playerId: string; bossId: string; atMs: number }> = [];
  /** Roaming-event telemetry rows (0023 mirror) for test introspection. */
  readonly roamingEventLog: Array<{
    playerId: string;
    events: Array<{ eventId: string; family: string }>;
    eliteKills: number;
    areaId: string;
    tickCount: number;
  }> = [];
  readonly consumableEvents: ConsumableEvent[] = [];
  /**
   * Lifetime kills by weapon type (migration 0034 mirror of
   * player_kill_stats): `${playerId}:${weaponType}` → kills. Written
   * ONLY by the two roaming appliers' pay paths (applyChefRewards /
   * settleOfflineRoaming), after their idempotency early-returns —
   * exactly where the SQL cc_record_kill_stats calls sit.
   */
  readonly killStats = new Map<string, number>();
  /** player_masteries mirror — written by the 0014 mastery grants below. */
  readonly masteries: InMemoryMastery[] = [];
  /**
   * Consumable batch rows (crafting §2.4): this double DOES model
   * batches — the quality-wired routes read them through
   * getConsumableBatches to price consumable effects. Boss/roaming
   * consumption still tracks profile totals only (the standing
   * simplification above); batches here are the quality record.
   */
  readonly consumableBatches: InMemoryConsumableBatch[] = [];
  /** Endless run rows (migration 0028) — the mirror of endless_runs. */
  readonly endlessRuns: Array<EndlessRunRow & { user_id: string; encounters: Json[] }> = [];
  /** Endless start timestamps (the store clock) for the fee-escalation count. */
  readonly endlessStartLog: Array<{ playerId: string; atMs: number }> = [];
  /** Craft jobs (migration 0024) for the offline craft settler. */
  readonly craftJobs: CraftJobRecord[] = [];
  /** Stat counter mirror for craft settler side effects. */
  readonly craftStatCounters: Array<{ user_id: string; stat_key: string; stat_value: number }> = [];
  /** Workshop bench/tool state for the craft settler (defaults: bench 1, no tools). */
  readonly workshopBenches = new Map<string, number>();
  readonly workshopTools = new Map<string, WorkshopToolsState>();
  /** Cache Rank grant log (0031 mirror of the cc_cache_rank_grant ledger rows) for test introspection. */
  readonly cacheRankGrantLog: Array<{ playerId: string; fromLevel: number; toLevel: number; tokens: number }> = [];
  /** Cache Rank spend log (0031 mirror of the cc_cache_rank_spend ledger rows). */
  readonly cacheRankSpendLog: Array<{ playerId: string; bonusId: string; rankAfter: number; cost: number }> = [];
  /** Dispatch mission rows (migration 0032) — the mirror of dispatch_missions. */
  readonly dispatchMissions: Array<DispatchMissionRow & { user_id: string }> = [];
  /** Dispatch settlement log (0032 mirror of the cc_dispatch_settle ledger rows) for test introspection. */
  readonly dispatchSettleLog: Json[] = [];
  /** Drop-luck buff grants (migration 0035) — the mirror of leaderboard_drop_buffs. */
  readonly dropBuffs: Array<{ playerId: string; bonus: number; expiresAt: string }> = [];
  /** Extraction state rows (migration 0033) — the mirror of extraction_state. */
  readonly extractionStates = new Map<string, ExtractionStateRecord>();
  /** Extraction settle log (0033 mirror of the cc_apply_extraction ledger rows) for test introspection. */
  readonly extractionSettleLog: Json[] = [];
  /** Stat counter mirror for extraction settler side effects. */
  readonly extractionStatCounters: Array<{ user_id: string; stat_key: string; stat_value: number }> = [];

  /** Login-streak standing state (0036): playerId → the state row. */
  readonly loginStreakStates = new Map<string, {
    current_streak: number;
    longest_streak: number;
    last_claim_day: string | null;
    last_cycle_day: number | null;
    last_tier: number | null;
  }>();
  /** Research enrollments (0038): playerId → the ONE active enrollment. */
  readonly researchEnrollments = new Map<string, {
    course_id: string;
    enrolled_at: string;
    completes_at: string;
    cost_credits: number;
    duration_ms: number;
  }>();
  /** Research completions (0038): playerId → courseId → completed_at (ISO). */
  readonly researchCompletions = new Map<string, Map<string, string>>();
  /** Login-streak claim rows (0036): `${playerId}:${day}` → the claim. */
  readonly loginStreakClaims = new Map<string, {
    day: string;
    streak_length: number;
    cycle_day: number;
    tier: number;
    credits_awarded: number;
    fragments_awarded: number;
    cache_keys_awarded: number;
  }>();

  /**
   * Contract instances (0042 mirror of contract_instances): every
   * generation ever issued — rerolled rows stay, exactly like SQL.
   */
  readonly contractInstances: Array<ContractInstanceRecord & { user_id: string; band: string }> = [];
  /** Contract set bonuses (0042): `${playerId}:${kind}:${periodKey}` → the paid bonus. */
  readonly contractSetBonuses = new Map<string, { credits: number; fragments: number; cacheKeys: number }>();
  /**
   * Standing stat counters the contracts evaluator diffs (0042):
   * `${playerId}:${statKey}` → value. Fed by hooks at this twin's
   * pay paths — the same points where the SQL 0014 trigger's stats
   * land (roaming claims, boss victories, roaming events, salvage,
   * consumable use, repair completions). Kinds whose domains this
   * twin does not implement (market, cache draws, reforge) stay 0
   * here, the twin's standing simplification.
   */
  readonly contractStats = new Map<string, number>();
  /** Extraction unit log (0042 window fold): units found per settle. */
  readonly contractExtractionLog: Array<{ playerId: string; units: number; atMs: number }> = [];
  /** Manufacturer Standing rows (0043): `${playerId}:${manufacturer}` → balance + granted rank. */
  readonly standingRows = new Map<string, { standing: number; rank: number }>();
  /** Manufacturer Standing drip counters (0043): `${playerId}:${manufacturer}:${utcDay}` → points. */
  readonly standingDaily = new Map<string, number>();
  /** Manufacturer Standing weekly desk purchases (0043): `${playerId}:${manufacturer}:${isoWeek}:${kind}`. */
  readonly standingWeekly = new Set<string>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly cacheRankLeverProvider?: () => Partial<CacheRankLeverValues>,
    private readonly dispatchLeverProvider?: () => Partial<DispatchLeverValues>,
    private readonly extractionLeverProvider?: () => Partial<ExtractionLeverValues>,
    private readonly loginStreakLeverProvider?: () => Partial<LoginStreakLeverValues>,
    private readonly researchLeverProvider?: () => Partial<ResearchLeverValues>,
    private readonly contractsLeverProvider?: () => Partial<ContractLeverValues>,
    private readonly standingLeverProvider?: () => Partial<StandingLeverValues>,
  ) {}

  /** Standing levers for this twin: injected provider, else content defaults (the Pg store reads them in SQL via cc_economy_config_number). */
  standingLevers(): StandingLeverValues {
    return resolveStandingLevers(this.standingLeverProvider?.());
  }

  /** Granted standing rank (the craft adapter's requiresStanding read). */
  standingRankFor(playerId: string, manufacturer: string): number {
    return this.standingRows.get(`${playerId}:${manufacturer}`)?.rank ?? 0;
  }

  /** Contracts levers for this twin: injected provider, else content defaults (the Pg store reads them in SQL via cc_economy_config_number). */
  contractsLevers(): ContractLeverValues {
    return resolveContractLevers(this.contractsLeverProvider?.());
  }

  /** Research levers for this twin: injected provider, else content defaults (the Pg store reads them in SQL via cc_economy_config_number). */
  researchLevers(): ResearchLeverValues {
    return resolveResearchLevers(this.researchLeverProvider?.());
  }

  /** Login-streak levers for this twin: injected provider, else content defaults (the Pg store reads them in SQL via cc_economy_config_number). */
  loginStreakLevers(): LoginStreakLeverValues {
    return resolveLoginStreakLevers(this.loginStreakLeverProvider?.());
  }

  /** Extraction levers for this twin: injected provider, else content defaults (the Pg store reads them in SQL via cc_economy_config_number). */
  extractionLevers(): ExtractionLeverValues {
    return resolveExtractionLevers(this.extractionLeverProvider?.());
  }

  /** Dispatch levers for this twin: injected provider, else content defaults (the Pg store reads them in SQL via cc_economy_config_number). */
  dispatchLevers(): DispatchLeverValues {
    return resolveDispatchLevers(this.dispatchLeverProvider?.());
  }

  /** Cache Rank levers for this twin: injected provider, else content defaults (the Pg store reads the live economy config). */
  cacheRankLevers(): CacheRankLeverValues {
    return resolveCacheRankLevers(this.cacheRankLeverProvider?.());
  }

  /**
   * The grant the BEFORE UPDATE OF player_level trigger performs in
   * SQL (0031): pay entitlement(level) − entitlement(watermark)
   * exactly once and advance the watermark. Called after EVERY
   * level assignment in this twin — the trigger's coverage by
   * construction. Returns the tokens granted.
   */
  applyCacheRankGrant(p: InMemoryProfile): number {
    const from = Math.trunc(Number(p.cache_rank_grant_level) || 0);
    if (p.player_level <= from) return 0;
    const levers = this.cacheRankLevers();
    const grant = Math.max(
      0,
      cacheRankEntitlement(p.player_level, levers) - cacheRankEntitlement(from, levers),
    );
    if (grant > 0) {
      p.cache_rank_tokens = Math.trunc(Number(p.cache_rank_tokens) || 0) + grant;
      this.cacheRankGrantLog.push({ playerId: p.id, fromLevel: from, toLevel: p.player_level, tokens: grant });
    }
    p.cache_rank_grant_level = p.player_level;
    return grant;
  }

  /** Test helper: insert a profile row with June defaults. */
  seedProfile(overrides: Partial<InMemoryProfile> & { id: string }): InMemoryProfile {
    const profile: InMemoryProfile = {
      player_level: 1,
      player_xp: 0,
      credits: 0,
      scrap: 0,
      scrap_remainder: 0,
      credits_remainder: 0,
      xp_remainder: 0,
      cache_tokens: 0,
      cache_token_parts: 0,
      vehicle_fuel: 0,
      legendary_cores: 0,
      cache_rank_tokens: 0,
      cache_rank_grant_level: 0,
      cache_rank_spends: {},
      action_skill_charge: 0,
      action_skill_selection: null,
      materials: {},
      essences: {},
      consumables: {},
      skill_spends: {},
      boss_state: {},
      death_state: {},
      death_log: [],
      last_idle_claim_at: null,
      last_claimed_tick: 0,
      last_roaming_settled_at: null,
      last_settlement_nonce: null,
      offline_cap_hours: null,
      ...overrides,
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  /** Test helper: insert an item instance. */
  seedItem(overrides: Partial<InMemoryItem> & { id: string; owner_user_id: string }): InMemoryItem {
    const item: InMemoryItem = {
      kind: 'weapon',
      runtime_state: 'available',
      is_locked: false,
      rarity: 'Common',
      item_level: 1,
      estimated_value: 0,
      supply_mode: 'verified_action',
      tradeable: true,
      equipped_slot: null,
      payload: {},
      ...overrides,
    };
    this.items.set(item.id, item);
    return item;
  }

  /** Test helper: set the player's active action row. */
  seedActiveAction(action: InMemoryActiveAction): InMemoryActiveAction {
    this.activeActions.set(action.user_id, action);
    return action;
  }

  /** cc_profile_snapshot's key set (final June definition, ported in 0004). */
  private snapshot(p: InMemoryProfile): Json {
    return {
      id: p.id,
      player_level: p.player_level,
      player_xp: p.player_xp,
      credits: p.credits,
      scrap: p.scrap,
      cache_tokens: p.cache_tokens,
      cache_token_parts: p.cache_token_parts,
      legendary_cores: p.legendary_cores ?? 0,
      cache_rank_tokens: p.cache_rank_tokens ?? 0,
      cache_rank_grant_level: p.cache_rank_grant_level ?? 0,
      cache_rank_spends: { ...(p.cache_rank_spends ?? {}) },
      materials: { ...p.materials },
      essences: { ...p.essences },
      consumables: { ...p.consumables },
      consumable_batches: [],
      vehicle_fuel: p.vehicle_fuel,
      skill_spends: p.skill_spends,
      action_skill_charge: p.action_skill_charge ?? 0,
      action_skill_selection: p.action_skill_selection ?? null,
      boss_state: JSON.parse(JSON.stringify(p.boss_state)) as Json,
      last_idle_claim_at: p.last_idle_claim_at,
    };
  }

  private requireProfile(playerId: string): InMemoryProfile {
    const profile = this.profiles.get(playerId);
    if (!profile) throw new GameplayStoreError('Profile not found');
    return profile;
  }

  /**
   * The reward application shared by cc_apply_chef_rewards and
   * cc_settle_offline_roaming: XP curve, raw credit/scrap adds,
   * material/essence merges, and the 5-fragments-to-1-token roll-up.
   * Returns the SQL functions' rewards echo.
   */
  private applyRewardBundle(p: InMemoryProfile, rewards: ChefRewardsInput): Json {
    const leveled = applyXp(p.player_level, p.player_xp, rewards.xp);
    p.player_level = leveled.player_level;
    p.player_xp = leveled.player_xp;
    this.applyCacheRankGrant(p);
    p.credits += Math.trunc(rewards.credits);
    p.scrap += Math.trunc(rewards.scrap);
    if (rewards.scrapRemainder != null) p.scrap_remainder = rewards.scrapRemainder;
    if (rewards.creditsRemainder != null) p.credits_remainder = rewards.creditsRemainder;
    if (rewards.xpRemainder != null) p.xp_remainder = rewards.xpRemainder;
    for (const [k, v] of Object.entries(asRecord(rewards.materials))) p.materials[k] = (p.materials[k] ?? 0) + v;
    for (const [k, v] of Object.entries(asRecord(rewards.essences))) p.essences[k] = (p.essences[k] ?? 0) + v;
    let parts = p.cache_token_parts + Math.trunc(rewards.fragments);
    let tokens = p.cache_tokens;
    while (parts >= 5) {
      parts -= 5;
      tokens += 1;
    }
    p.cache_token_parts = parts;
    p.cache_tokens = tokens;
    return {
      credits_awarded: Math.trunc(rewards.credits),
      scrap_awarded: Math.trunc(rewards.scrap),
      xp_awarded: Math.trunc(rewards.xp),
      cache_fragments_awarded: Math.trunc(rewards.fragments),
      materials: rewards.materials,
      essences: rewards.essences,
      kills_recorded: Math.trunc(rewards.kills),
    };
  }

  // -- Mastery side effects (0014 — the ledger trigger's shipped branches) --

  private addMasteryXp(userId: string, masteryId: string, amount: number): void {
    const grant = Math.trunc(amount);
    if (!Number.isFinite(grant) || grant === 0) return;
    const existing = this.masteries.find((m) => m.user_id === userId && m.mastery_id === masteryId);
    if (existing) {
      existing.mastery_xp = Math.max(0, existing.mastery_xp + grant);
      existing.mastery_level = masteryLevelForXp(existing.mastery_xp);
    } else {
      const xp = Math.max(0, grant);
      this.masteries.push({ user_id: userId, mastery_id: masteryId, mastery_xp: xp, mastery_level: masteryLevelForXp(xp) });
    }
  }

  /** cc_equipped_weapon_mastery_id: the equipped primary weapon's mastery. */
  private equippedWeaponMasteryId(playerId: string): string | null {
    const primary = [...this.items.values()].find(
      (item) => item.owner_user_id === playerId && item.runtime_state === 'equipped' && item.equipped_slot === 'primary',
    );
    return primary ? weaponMasteryIdForWeaponType(primary.payload?.weaponType) : null;
  }

  /**
   * Location + weapon grants shared by foreground claims and offline
   * settlements (the trigger's cc_apply_chef_rewards /
   * cc_settle_offline_roaming branches): location follows the legacy
   * cc_idle_claim rule — greatest(1, xp) — fed the REAL area; weapon
   * mastery is 1 XP per player XP earned with that type equipped
   * (the weapons.* definitions' xp_per_unit = 1, unit 'XP').
   */
  private grantRoamingMastery(playerId: string, areaId: string | null | undefined, xpAwarded: number): void {
    const amount = Math.max(0, Math.trunc(xpAwarded) || 0);
    const locationId = locationMasteryIdForArea(areaId);
    if (locationId) this.addMasteryXp(playerId, locationId, Math.max(1, amount));
    const weaponId = this.equippedWeaponMasteryId(playerId);
    if (weaponId) this.addMasteryXp(playerId, weaponId, amount);
  }

  /** The trigger's consumable block: efficiency per use, ordnance family bonus. */
  private grantConsumedMastery(playerId: string, consumed: Record<string, number>): void {
    for (const [type, count] of Object.entries(consumed)) {
      if (count <= 0) continue;
      this.addMasteryXp(playerId, 'consumable.efficiency', count * 10);
      if (ORDNANCE_FAMILY_PREFIXES.some((prefix) => type.startsWith(prefix))) {
        this.addMasteryXp(playerId, 'combat.ordnance', count * 10);
      }
    }
  }

  async getRoamingProfile(playerId: string): Promise<RoamingProfileRow | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    return { player_level: p.player_level, skill_spends: JSON.parse(JSON.stringify(p.skill_spends)) as Json, last_claimed_tick: p.last_claimed_tick, consumables: { ...p.consumables }, scrap_remainder: p.scrap_remainder, credits_remainder: p.credits_remainder, xp_remainder: p.xp_remainder, vehicle_fuel: p.vehicle_fuel, cache_rank_spends: JSON.parse(JSON.stringify(p.cache_rank_spends ?? {})) as Json };
  }

  async getBossProfile(playerId: string): Promise<BossProfileRow | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    return {
      player_level: p.player_level,
      credits: p.credits,
      consumables: { ...p.consumables },
      boss_state: JSON.parse(JSON.stringify(p.boss_state)) as Json,
      skill_spends: JSON.parse(JSON.stringify(p.skill_spends)) as Json,
      action_skill_charge: p.action_skill_charge ?? 0,
      action_skill_selection: p.action_skill_selection ?? null,
      cache_rank_spends: JSON.parse(JSON.stringify(p.cache_rank_spends ?? {})) as Json,
    };
  }

  async getActionSkillFacts(playerId: string): Promise<ActionSkillFacts | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    const mod = [...this.items.values()].find(
      (item) =>
        item.owner_user_id === playerId &&
        item.runtime_state === 'equipped' &&
        item.payload &&
        'treeBonus' in item.payload,
    );
    return {
      skill_spends: JSON.parse(JSON.stringify(p.skill_spends)) as Json,
      class_mod_payload: (mod ? JSON.parse(JSON.stringify(mod.payload)) : {}) as Json,
      action_skill_charge: p.action_skill_charge ?? 0,
      action_skill_selection: p.action_skill_selection ?? null,
    };
  }

  async setActionSkillSelection(playerId: string, nonce: string, tree: string | null): Promise<Json> {
    const p = this.requireProfile(playerId);
    if (!nonce || nonce.trim().length < 8) throw new GameplayStoreError('nonce is required');
    const prior = this.ledger.get(nonce);
    if (prior) return { ...(prior as Record<string, unknown>), idempotent_replay: true };
    if (tree !== null) {
      if (!isActionSkillTree(tree)) {
        throw new GameplayStoreError(`Unknown action skill tree: ${tree}`);
      }
      const { qualified } = resolveActionSkill(
        (p.skill_spends ?? {}) as Record<string, number>,
        this.classModBoostsFor(playerId),
        null,
      );
      if (!qualified.includes(tree)) {
        throw new GameplayStoreError('Action skill not qualified for the selected tree');
      }
    }
    p.action_skill_selection = tree;
    const result: Json = {
      action_type: 'cc_set_action_skill_selection',
      selection: tree,
      profile: this.snapshot(p),
    };
    this.ledger.set(nonce, result);
    return result;
  }

  async getSettlementProfile(playerId: string): Promise<SettlementProfileRow | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    return {
      player_level: p.player_level,
      skill_spends: JSON.parse(JSON.stringify(p.skill_spends)) as Json,
      consumables: { ...p.consumables },
      last_claimed_tick: p.last_claimed_tick,
      last_roaming_settled_at: p.last_roaming_settled_at,
      last_settlement_nonce: p.last_settlement_nonce,
      offline_cap_hours: p.offline_cap_hours,
      scrap_remainder: p.scrap_remainder,
      credits_remainder: p.credits_remainder,
      xp_remainder: p.xp_remainder,
      vehicle_fuel: p.vehicle_fuel,
      cache_rank_spends: JSON.parse(JSON.stringify(p.cache_rank_spends ?? {})) as Json,
    };
  }

  async getCacheRankFacts(playerId: string): Promise<CacheRankFacts | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    return {
      player_level: p.player_level,
      player_xp: p.player_xp,
      cache_rank_tokens: p.cache_rank_tokens ?? 0,
      cache_rank_grant_level: p.cache_rank_grant_level ?? 0,
      cache_rank_spends: JSON.parse(JSON.stringify(p.cache_rank_spends ?? {})) as Json,
    };
  }

  /** cc_grant_cache_rank_tokens mirror: observe-and-grant, idempotent by the watermark. */
  async grantCacheRankTokens(playerId: string): Promise<Json> {
    const p = this.requireProfile(playerId);
    const granted = this.applyCacheRankGrant(p);
    return {
      granted,
      tokens: p.cache_rank_tokens ?? 0,
      grant_level: p.cache_rank_grant_level ?? 0,
      level: p.player_level,
    };
  }

  /** cc_spend_cache_rank mirror: pending grant first, then balance/cap validation from server records. */
  async spendCacheRankBonus(playerId: string, nonce: string, bonusId: string): Promise<Json> {
    const p = this.requireProfile(playerId);
    if (!nonce || nonce.trim().length < 8) throw new GameplayStoreError('nonce is required');
    const prior = this.ledger.get(nonce);
    if (prior) return prior;
    this.applyCacheRankGrant(p);
    const def = cacheRankBonusDef(bonusId);
    if (!def) throw new GameplayStoreError('Unknown Cache Rank bonus');
    const spends = sanitizeCacheRankSpends(p.cache_rank_spends);
    const ranks = spends[def.id];
    if (ranks >= def.maxRanks) throw new GameplayStoreError('Cache Rank bonus maxed');
    const levers = this.cacheRankLevers();
    const cost = cacheRankCostForRank(ranks, levers);
    if ((p.cache_rank_tokens ?? 0) < cost) {
      throw new GameplayStoreError('Not enough Cache Rank tokens');
    }
    p.cache_rank_tokens = (p.cache_rank_tokens ?? 0) - cost;
    spends[def.id] = ranks + 1;
    p.cache_rank_spends = spends;
    this.cacheRankSpendLog.push({ playerId, bonusId: def.id, rankAfter: ranks + 1, cost });
    const result: Json = {
      action_type: 'cc_cache_rank_spend',
      bonus_id: def.id,
      rank_after: ranks + 1,
      cost,
      tokens: p.cache_rank_tokens,
      profile: this.snapshot(p),
    };
    this.ledger.set(nonce, result);
    return result;
  }

  // ─── Login streak (0036) ─────────────────────────────────────────
  // Mirrors cc_record_login_streak_day: same streak arithmetic,
  // same ladder + lever scalars, same claim-row idempotency, same
  // ledger payload shape.

  async getLoginStreakFacts(playerId: string): Promise<LoginStreakFacts | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    const today = loginStreakUtcDay(this.now());
    const state = this.loginStreakStates.get(playerId);
    const claim = this.loginStreakClaims.get(`${playerId}:${today}`);
    return {
      current_streak: state?.current_streak ?? 0,
      longest_streak: state?.longest_streak ?? 0,
      last_claim_day: state?.last_claim_day ?? null,
      today,
      today_claim: claim ? { ...claim } : null,
    };
  }

  /** cc_record_login_streak_day mirror: the (player, day) claim row is the idempotency anchor. */
  async recordLoginStreakDay(playerId: string): Promise<Json> {
    const p = this.requireProfile(playerId);
    const today = loginStreakUtcDay(this.now());
    const claimKey = `${playerId}:${today}`;
    const prior = this.loginStreakClaims.get(claimKey);
    if (prior) {
      return {
        action_type: 'cc_login_streak_claim',
        already_claimed: true,
        day: prior.day,
        streak_length: prior.streak_length,
        cycle_day: prior.cycle_day,
        tier: prior.tier,
        credits_awarded: prior.credits_awarded,
        fragments_awarded: prior.fragments_awarded,
        cache_keys_awarded: prior.cache_keys_awarded,
        profile: this.snapshot(p),
      };
    }
    const state = this.loginStreakStates.get(playerId) ?? {
      current_streak: 0,
      longest_streak: 0,
      last_claim_day: null,
      last_cycle_day: null,
      last_tier: null,
    };
    const streakLength = loginStreakLengthAfter(state.last_claim_day, state.current_streak, today);
    const position = loginStreakPositionFor(streakLength);
    const grant = loginStreakGrantFor(position.cycleDay, position.tier, this.loginStreakLevers());
    p.credits += grant.credits;
    p.cache_token_parts = (p.cache_token_parts ?? 0) + grant.fragments;
    p.cache_tokens += grant.cacheKeys;
    const claim = {
      day: today,
      streak_length: streakLength,
      cycle_day: position.cycleDay,
      tier: position.tier,
      credits_awarded: grant.credits,
      fragments_awarded: grant.fragments,
      cache_keys_awarded: grant.cacheKeys,
    };
    this.loginStreakClaims.set(claimKey, claim);
    state.current_streak = streakLength;
    state.longest_streak = Math.max(state.longest_streak, streakLength);
    state.last_claim_day = today;
    state.last_cycle_day = position.cycleDay;
    state.last_tier = position.tier;
    this.loginStreakStates.set(playerId, state);
    const result: Json = {
      action_type: 'cc_login_streak_claim',
      already_claimed: false,
      day: today,
      streak_length: streakLength,
      cycle_day: position.cycleDay,
      tier: position.tier,
      credits_awarded: grant.credits,
      fragments_awarded: grant.fragments,
      cache_keys_awarded: grant.cacheKeys,
      profile: this.snapshot(p),
    };
    this.ledger.set(`login-streak:${playerId}:${today}`, result);
    return result;
  }

  // ─── Research (0038) ─────────────────────────────────────────────
  // Mirrors cc_settle_research / cc_enroll_research /
  // cc_cancel_research: pure wall-clock progress, lazy settlement,
  // fee destroyed at enroll, cancel forfeits, NO player XP.

  /** cc_settle_research mirror: a due enrollment becomes a completion + the one-time mastery grant. */
  settleResearch(playerId: string): { course_id: string; completed_at: string; mastery_xp: number }[] {
    const enrollment = this.researchEnrollments.get(playerId);
    if (!enrollment) return [];
    if (Date.parse(enrollment.completes_at) > this.now().getTime()) return [];
    const course = researchCourse(enrollment.course_id);
    const masteryXp = course ? researchMasteryXpFor(course) : 0;
    let completions = this.researchCompletions.get(playerId);
    if (!completions) {
      completions = new Map();
      this.researchCompletions.set(playerId, completions);
    }
    completions.set(enrollment.course_id, enrollment.completes_at);
    this.researchEnrollments.delete(playerId);
    if (masteryXp > 0) this.addMasteryXp(playerId, RESEARCH_MASTERY_TRACK, masteryXp);
    const fact = {
      course_id: enrollment.course_id,
      completed_at: enrollment.completes_at,
      mastery_xp: masteryXp,
    };
    this.ledger.set(`research-complete:${playerId}:${enrollment.course_id}`, {
      action_type: 'cc_research_complete',
      ...fact,
    });
    return [fact];
  }

  async getResearchFacts(playerId: string): Promise<ResearchFacts | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    this.settleResearch(playerId);
    const enrollment = this.researchEnrollments.get(playerId);
    const completions = this.researchCompletions.get(playerId);
    return {
      playerLevel: p.player_level,
      workshopBenches: p.workshop_benches,
      credits: p.credits,
      completed: completions
        ? [...completions.entries()]
            .map(([courseId, completedAt]) => ({ courseId, completedAt }))
            .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1))
        : [],
      activeEnrollment: enrollment
        ? {
            courseId: enrollment.course_id,
            enrolledAt: enrollment.enrolled_at,
            completesAt: enrollment.completes_at,
            costCredits: enrollment.cost_credits,
            durationMs: enrollment.duration_ms,
          }
        : null,
      nowMs: this.now().getTime(),
    };
  }

  async enrollResearch(playerId: string, nonce: string, courseId: string): Promise<Json> {
    if (!nonce) throw new GameplayStoreError('cc_enroll_research requires a nonce');
    const key = `cc_enroll_research:${nonce}`;
    const prior = this.ledger.get(key);
    if (prior) return { ...(prior as Record<string, unknown>), idempotent_replay: true } as Json;
    this.settleResearch(playerId);
    const p = this.requireProfile(playerId);
    const course = researchCourse(courseId);
    if (!course) throw new GameplayStoreError('unknown_course');
    const completions = this.researchCompletions.get(playerId);
    if (completions?.has(courseId)) throw new GameplayStoreError('course_already_completed');
    if (this.researchEnrollments.has(playerId)) {
      throw new GameplayStoreError('research_already_enrolled');
    }
    if (course.requiresLevel != null && p.player_level < course.requiresLevel) {
      throw new GameplayStoreError('level_too_low');
    }
    if (course.prerequisite && !completions?.has(course.prerequisite)) {
      throw new GameplayStoreError('prerequisite_not_met');
    }
    if (course.requiresBench != null && (p.workshop_benches ?? 1) < course.requiresBench) {
      throw new GameplayStoreError('bench_too_low');
    }
    const terms = researchEnrollmentTerms(course, this.researchLevers());
    if (p.credits < terms.costCredits) throw new GameplayStoreError('insufficient_credits');
    p.credits -= terms.costCredits;
    const enrolledAt = this.now();
    const completesAt = new Date(enrolledAt.getTime() + terms.durationMs);
    this.researchEnrollments.set(playerId, {
      course_id: courseId,
      enrolled_at: enrolledAt.toISOString(),
      completes_at: completesAt.toISOString(),
      cost_credits: terms.costCredits,
      duration_ms: terms.durationMs,
    });
    const result: Json = {
      action_type: 'cc_enroll_research',
      course_id: courseId,
      cost_credits: terms.costCredits,
      duration_ms: terms.durationMs,
      enrolled_at: enrolledAt.toISOString(),
      completes_at: completesAt.toISOString(),
      profile: this.snapshot(p),
    };
    this.ledger.set(key, result);
    return result;
  }

  async cancelResearch(playerId: string, nonce: string): Promise<Json> {
    if (!nonce) throw new GameplayStoreError('cc_cancel_research requires a nonce');
    const key = `cc_cancel_research:${nonce}`;
    const prior = this.ledger.get(key);
    if (prior) return { ...(prior as Record<string, unknown>), idempotent_replay: true } as Json;
    this.settleResearch(playerId);
    this.requireProfile(playerId);
    const enrollment = this.researchEnrollments.get(playerId);
    let result: Json;
    if (!enrollment) {
      result = { action_type: 'cc_cancel_research', cancelled: false };
    } else {
      this.researchEnrollments.delete(playerId);
      result = {
        action_type: 'cc_cancel_research',
        cancelled: true,
        course_id: enrollment.course_id,
        fee_forfeited: enrollment.cost_credits,
      };
    }
    this.ledger.set(key, result);
    return result;
  }

  async getResearchBonuses(playerId: string): Promise<ResearchBonuses> {
    this.settleResearch(playerId);
    const completions = this.researchCompletions.get(playerId);
    return computeResearchBonuses(completions ? [...completions.keys()] : []);
  }

  // ─── Manufacturer Standing (0043) ────────────────────────────────
  // Mirrors cc_turn_in_item / cc_rank_up_manufacturer /
  // cc_standing_buy / cc_standing_order_weapon /
  // cc_accrue_manufacturer_standing. Ladders are independent (R6);
  // rank grants only on tribute (R7); turn-ins pay standing only.

  /** can_use_player_economy mirror: verified + email-verified (an
   *  unmarked profile reads verified, this twin's convention). */
  private canUseStandingEconomy(p: InMemoryProfile): boolean {
    const rec = p as Record<string, unknown>;
    if (rec.account_type === undefined) return true;
    return rec.account_type === 'verified' && rec.email_verified_at != null;
  }

  async getStandingFacts(playerId: string): Promise<StandingFacts | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    const week = isoWeekKey(this.now());
    const rows: StandingFacts['rows'] = [];
    for (const [key, row] of this.standingRows) {
      const [owner, manufacturer] = key.split(':');
      if (owner === playerId) rows.push({ manufacturer, standing: row.standing, rank: row.rank });
    }
    const weeklyPurchases: StandingFacts['weeklyPurchases'] = [];
    for (const key of this.standingWeekly) {
      const [owner, manufacturer, isoWeek, kind] = key.split(':');
      if (owner === playerId && isoWeek === week) weeklyPurchases.push({ manufacturer, kind });
    }
    const accountType = (p as Record<string, unknown>).account_type;
    return {
      accountType: typeof accountType === 'string' ? accountType : 'guest',
      canUsePlayerEconomy: this.canUseStandingEconomy(p),
      credits: p.credits,
      playerLevel: p.player_level,
      rows,
      weeklyPurchases,
    };
  }

  async accrueManufacturerStanding(playerId: string, manufacturer: string, kills: number): Promise<Json> {
    const levers = this.standingLevers();
    const cap = levers.standingDripDailyCap;
    const rowKey = `${playerId}:${manufacturer}`;
    const row = this.standingRows.get(rowKey) ?? { standing: 0, rank: 0 };
    if (!isStandingManufacturer(manufacturer) || !Number.isFinite(kills) || kills <= 0) {
      return {
        manufacturer, points: 0, cap_remaining: cap,
        balance: row.standing, rank: row.rank,
      } as Json;
    }
    const dayKey = `${rowKey}:${utcDayKey(this.now())}`;
    const already = this.standingDaily.get(dayKey) ?? 0;
    const points = Math.min(cap - already, Math.floor(kills * levers.standingPerKill));
    if (points <= 0) {
      return {
        manufacturer, points: 0, cap_remaining: Math.max(0, cap - already),
        balance: row.standing, rank: row.rank,
      } as Json;
    }
    this.standingDaily.set(dayKey, already + points);
    const next = { standing: row.standing + points, rank: row.rank };
    this.standingRows.set(rowKey, next);
    return {
      manufacturer, points,
      cap_remaining: Math.max(0, cap - already - points),
      balance: next.standing, rank: next.rank,
    } as Json;
  }

  async turnInItem(playerId: string, nonce: string, itemId: string): Promise<Json> {
    if (!nonce || nonce.length < 8) throw new GameplayStoreError('nonce is required');
    const key = `cc_turn_in_item:${playerId}:${nonce}`;
    const prior = this.ledger.get(key);
    if (prior) return prior;
    const p = this.requireProfile(playerId);
    if (!this.canUseStandingEconomy(p)) throw new GameplayStoreError('Verified account required');
    const item = this.items.get(itemId);
    if (!item || item.owner_user_id !== playerId) throw new GameplayStoreError('Item not found');
    const manufacturer = typeof item.payload.manufacturer === 'string' ? item.payload.manufacturer : null;
    const refusal = standingTurnInRefusal({
      kind: item.kind,
      runtimeState: item.runtime_state,
      isLocked: item.is_locked,
      equippedSlot: item.equipped_slot,
      rarity: item.rarity,
      itemLevel: item.item_level,
      manufacturer,
      legendaryEffectId: typeof item.payload.legendaryEffectId === 'string' ? item.payload.legendaryEffectId : null,
    });
    if (refusal) throw new GameplayStoreError(refusal);
    const rowKey = `${playerId}:${manufacturer}`;
    const row = this.standingRows.get(rowKey) ?? { standing: 0, rank: 0 };
    if (row.rank >= 5) {
      throw new GameplayStoreError(`Already at maximum rank with ${manufacturer}`);
    }
    const levers = this.standingLevers();
    const award = standingTurnInAward(
      {
        rarity: item.rarity,
        itemLevel: item.item_level,
        legendaryEffectId: typeof item.payload.legendaryEffectId === 'string' ? item.payload.legendaryEffectId : null,
      },
      levers.standingScrapDivisor,
    );
    const scrapValue =
      salvageScrap(item.rarity ?? 'Common', item.item_level) *
      (item.payload.legendaryEffectId === 'market_crash' ? 4 : 1);
    item.runtime_state = 'consumed';
    item.tradeable = false;
    item.equipped_slot = null;
    const next = { standing: row.standing + award, rank: row.rank };
    this.standingRows.set(rowKey, next);
    const result = {
      action_type: 'cc_turn_in_item',
      profile: this.snapshot(p),
      item: { ...item },
      manufacturer,
      standing_awarded: award,
      scrap_value: scrapValue,
      new_balance: next.standing,
      rank: next.rank,
      loadout: null,
    } as unknown as Json;
    this.ledger.set(key, result);
    return result;
  }

  async rankUpManufacturer(
    playerId: string,
    nonce: string,
    manufacturer: string,
    tributeItemId: string | null,
  ): Promise<Json> {
    if (!nonce || nonce.length < 8) throw new GameplayStoreError('nonce is required');
    const key = `cc_rank_up_manufacturer:${playerId}:${nonce}`;
    const prior = this.ledger.get(key);
    if (prior) return prior;
    const p = this.requireProfile(playerId);
    if (!this.canUseStandingEconomy(p)) throw new GameplayStoreError('Verified account required');
    if (!isStandingManufacturer(manufacturer)) throw new GameplayStoreError('Unknown manufacturer');
    const rowKey = `${playerId}:${manufacturer}`;
    const row = this.standingRows.get(rowKey) ?? { standing: 0, rank: 0 };
    if (row.rank >= 5) throw new GameplayStoreError(`Already at maximum rank with ${manufacturer}`);
    const nextDef = standingRankDef(row.rank + 1);
    if (row.standing < nextDef.threshold) {
      throw new GameplayStoreError(`Requires ${nextDef.threshold} standing with ${manufacturer}`);
    }
    const levers = this.standingLevers();
    const tribute = standingTributeCredits(nextDef.rank, levers.standingTributeScalar);
    if (p.credits < tribute) throw new GameplayStoreError('Insufficient credits');
    let tributeItem: InMemoryItem | undefined;
    if (nextDef.tributeMinRarity) {
      if (!tributeItemId) {
        throw new GameplayStoreError(
          `Rank ${nextDef.rank} requires a tribute item of ${nextDef.tributeMinRarity} rarity or better`,
        );
      }
      tributeItem = this.items.get(tributeItemId);
      if (!tributeItem || tributeItem.owner_user_id !== playerId) {
        throw new GameplayStoreError('Tribute item not found');
      }
      if (tributeItem.kind === 'vehicle') throw new GameplayStoreError('Vehicles cannot be tribute');
      if (tributeItem.payload.manufacturer !== manufacturer) {
        throw new GameplayStoreError(`Tribute item must be made by ${manufacturer}`);
      }
      if (!rarityMeetsMinimum(tributeItem.rarity, nextDef.tributeMinRarity)) {
        throw new GameplayStoreError(`Tribute item must be ${nextDef.tributeMinRarity} rarity or better`);
      }
      if (tributeItem.is_locked) throw new GameplayStoreError('Locked item');
      if (tributeItem.equipped_slot) {
        throw new GameplayStoreError('Unequip the item before offering it as tribute');
      }
      if (tributeItem.runtime_state !== 'available') throw new GameplayStoreError('Item is not available');
    } else if (tributeItemId) {
      throw new GameplayStoreError(`Rank ${nextDef.rank} requires no tribute item`);
    }
    p.credits -= tribute;
    if (tributeItem) {
      tributeItem.runtime_state = 'consumed';
      tributeItem.tradeable = false;
      tributeItem.equipped_slot = null;
    }
    this.standingRows.set(rowKey, { standing: row.standing, rank: nextDef.rank });
    const result = {
      action_type: 'cc_rank_up_manufacturer',
      profile: this.snapshot(p),
      manufacturer,
      new_rank: nextDef.rank,
      tribute_credits: tribute,
      tribute_item_id: tributeItemId ?? null,
      standing_balance: row.standing,
      item: tributeItem ? { ...tributeItem } : null,
      loadout: null,
    } as unknown as Json;
    this.ledger.set(key, result);
    return result;
  }

  async standingBuy(playerId: string, nonce: string, offerKey: string, quantity: number): Promise<Json> {
    if (!nonce || nonce.length < 8) throw new GameplayStoreError('nonce is required');
    const key = `cc_standing_buy:${playerId}:${nonce}`;
    const prior = this.ledger.get(key);
    if (prior) return prior;
    const p = this.requireProfile(playerId);
    if (!this.canUseStandingEconomy(p)) throw new GameplayStoreError('Verified account required');
    const offer = standingOffer(offerKey);
    if (!offer) throw new GameplayStoreError('Unknown standing offer');
    const row = this.standingRows.get(`${playerId}:${offer.manufacturer}`) ?? { standing: 0, rank: 0 };
    if (row.rank < offer.rankRequired) {
      throw new GameplayStoreError(`Requires rank ${offer.rankRequired} with ${offer.manufacturer}`);
    }
    let qty = Math.max(1, Math.trunc(quantity) || 1);
    const week = isoWeekKey(this.now());
    const weeklyKey = `${playerId}:${offer.manufacturer}:${week}:crate`;
    if (offer.kind === 'crate') {
      qty = 1;
      if (this.standingWeekly.has(weeklyKey)) {
        throw new GameplayStoreError('Parts Crate already claimed this week');
      }
    }
    const totalPrice = offer.priceCredits * qty;
    if (p.credits < totalPrice) throw new GameplayStoreError('Insufficient credits');
    p.credits -= totalPrice;
    if (offer.kind === 'shelf' && offer.consumableType) {
      p.consumables[offer.consumableType] = (p.consumables[offer.consumableType] ?? 0) + qty;
    } else {
      for (const [m, n] of Object.entries(offer.materials)) {
        p.materials[m] = (p.materials[m] ?? 0) + n;
      }
      for (const [e, n] of Object.entries(offer.essences)) {
        p.essences[e] = (p.essences[e] ?? 0) + n;
      }
      this.standingWeekly.add(weeklyKey);
    }
    const result = {
      action_type: 'cc_standing_buy',
      profile: this.snapshot(p),
      offer_key: offer.offerKey,
      manufacturer: offer.manufacturer,
      kind: offer.kind,
      quantity: qty,
      consumable_type: offer.consumableType,
      total_price: totalPrice,
      batch_id: null,
    } as unknown as Json;
    this.ledger.set(key, result);
    return result;
  }

  async standingOrderWeapon(playerId: string, nonce: string, manufacturer: string): Promise<Json> {
    if (!nonce || nonce.length < 8) throw new GameplayStoreError('nonce is required');
    const key = `cc_standing_order_weapon:${playerId}:${nonce}`;
    const prior = this.ledger.get(key);
    if (prior) return prior;
    const p = this.requireProfile(playerId);
    if (!this.canUseStandingEconomy(p)) throw new GameplayStoreError('Verified account required');
    if (!isStandingManufacturer(manufacturer)) throw new GameplayStoreError('Unknown manufacturer');
    const levers = this.standingLevers();
    if (levers.standingOrderEnabled !== 1) throw new GameplayStoreError('Signature Orders are disabled');
    const row = this.standingRows.get(`${playerId}:${manufacturer}`) ?? { standing: 0, rank: 0 };
    if (row.rank < 5) throw new GameplayStoreError(`Requires rank 5 with ${manufacturer}`);
    const week = isoWeekKey(this.now());
    const weeklyKey = `${playerId}:${manufacturer}:${week}:order`;
    if (this.standingWeekly.has(weeklyKey)) {
      throw new GameplayStoreError('Signature Order already placed this week');
    }
    const price = levers.standingOrderPrice;
    if (p.credits < price) throw new GameplayStoreError('Insufficient credits');
    const payload = generateStandingOrderWeapon({
      playerId, nonce, manufacturer, level: p.player_level,
    });
    p.credits -= price;
    const itemId = randomUUID();
    const rarity = String(payload.rarity ?? 'Rare');
    const item: InMemoryItem = {
      id: itemId,
      owner_user_id: playerId,
      kind: 'weapon',
      runtime_state: 'available',
      is_locked: false,
      rarity,
      item_level: Math.max(1, p.player_level),
      estimated_value: computeItemEstimatedValue(payload, 'weapon', rarity, Math.max(1, p.player_level)),
      supply_mode: 'verified_action',
      tradeable: true,
      equipped_slot: null,
      payload,
    };
    this.items.set(itemId, item);
    this.standingWeekly.add(weeklyKey);
    const result = {
      action_type: 'cc_standing_order_weapon',
      profile: this.snapshot(p),
      item: { ...item },
      manufacturer,
      total_price: price,
    } as unknown as Json;
    this.ledger.set(key, result);
    return result;
  }

  // ─── Dispatch (0032) ─────────────────────────────────────────────
  // Mirrors cc_dispatch_depart / cc_dispatch_settle_due /
  // cc_dispatch_recall: same validations, same error messages, same
  // pro-rata settlement arithmetic, same ledger payloads.

  // ─── Contracts board (0042) ─────────────────────────────────────
  // The twin mirrors cc_issue_contracts / cc_claim_contract_reward /
  // cc_reroll_contract / cc_contract_progress with the content
  // module's own pure functions, so generation, baselines, targets,
  // and rewards cannot drift from the Pg path. Progress facts come
  // from this twin's own records (craft outputs, discovery rows,
  // endless runs, boss victory log, extraction log) plus the
  // contractStats hooks at the pay paths below.

  private addContractStat(playerId: string, statKey: string, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const key = `${playerId}:${statKey}`;
    this.contractStats.set(key, (this.contractStats.get(key) ?? 0) + Math.trunc(amount));
  }

  private contractStatsSnapshot(playerId: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of this.contractStats) {
      if (key.startsWith(`${playerId}:`)) out[key.slice(playerId.length + 1)] = value;
    }
    // consumables_crafted is not hook-fed: it folds from craft outputs.
    out['consumables_crafted'] = this.craftJobs
      .filter((j) => j.owner_user_id === playerId)
      .reduce((n, j) => n + j.outputs.filter((o) => o.consumableType != null).length, 0);
    return out;
  }

  private contractBaselineFor(playerId: string, template: ContractTemplate): Record<string, number> {
    const statKey = CONTRACT_STAT_KEYS[template.kind];
    if (!statKey) return {};
    return { [statKey]: this.contractStatsSnapshot(playerId)[statKey] ?? 0 };
  }

  private contractWindowFactsFor(playerId: string, inst: ContractInstanceRecord): ContractWindowFacts {
    const { start, end } = contractPeriodWindow(inst.periodKind, inst.periodKey);
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    const inWindow = (ms: number) => ms >= startMs && ms < endMs;
    let crafts = 0;
    let refines = 0;
    for (const job of this.craftJobs) {
      if (job.owner_user_id !== playerId) continue;
      for (const o of job.outputs) {
        if (!inWindow(o.completedAtMs)) continue;
        crafts += 1;
        if (o.kind === 'refine') refines += 1;
      }
    }
    const endedRuns = this.endlessRuns.filter(
      (r) => r.user_id === playerId && r.status !== 'active' && r.ended_at && inWindow(Date.parse(r.ended_at)),
    );
    const specificBossVictories: Record<string, number> = {};
    for (const v of this.bossVictoryLog) {
      if (v.playerId === playerId && inWindow(v.atMs)) {
        specificBossVictories[v.bossId] = (specificBossVictories[v.bossId] ?? 0) + 1;
      }
    }
    return {
      crafts,
      refines,
      sellerSales: 0,
      discoveries: this.discoveryRows.filter(
        (d) => d.user_id === playerId && inWindow(Date.parse(d.discovered_at)),
      ).length,
      endlessRuns: endedRuns.length,
      endlessBestDepth: endedRuns.reduce((m, r) => Math.max(m, r.depth_reached), 0),
      extractionUnits: this.contractExtractionLog
        .filter((e) => e.playerId === playerId && inWindow(e.atMs))
        .reduce((n, e) => n + e.units, 0),
      specificBossVictories,
    };
  }

  private currentContractInstances(playerId: string, kind: ContractPeriodKind, periodKey: string) {
    const rows = this.contractInstances.filter(
      (i) => i.user_id === playerId && i.periodKind === kind && i.periodKey === periodKey,
    );
    const bySlot = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
      const cur = bySlot.get(row.slot);
      if (!cur || row.generation > cur.generation) bySlot.set(row.slot, row);
    }
    return { rows, current: [...bySlot.values()].sort((a, b) => a.slot - b.slot) };
  }

  async issueContracts(playerId: string, periodKind: ContractPeriodKind): Promise<Json> {
    const p = this.requireProfile(playerId);
    const now = this.now();
    const periodKey = contractPeriodKey(periodKind, now);
    const existing = this.contractInstances.some(
      (i) => i.user_id === playerId && i.periodKind === periodKind && i.periodKey === periodKey,
    );
    if (existing) {
      return { period_kind: periodKind, period_key: periodKey, issued: 0, already_issued: true } as Json;
    }
    const band = contractBandForLevel(p.player_level);
    const levers = this.contractsLevers();
    const count = periodKind === 'daily' ? levers.contractDailyCount : levers.contractWeeklyCount;
    const draws = drawContractSet({
      seed: contractSetSeed(periodKind, periodKey, band.id, playerId),
      kind: periodKind,
      band,
      count,
      bosses: CONTRACT_BOSS_CHOICES,
    });
    draws.forEach((draw, slot) => {
      this.contractInstances.push({
        user_id: playerId,
        id: randomUUID(),
        periodKind,
        periodKey,
        slot,
        generation: 0,
        templateId: draw.template.id,
        band: band.id,
        params: draw.params,
        target: contractTargetFor(draw.template, periodKind, band, levers),
        baseline: this.contractBaselineFor(playerId, draw.template),
        reward: contractRewardFor(draw.template, periodKind, band, levers),
        status: 'active',
        issuedAt: now.toISOString(),
        claimedAt: null,
      });
    });
    return {
      period_kind: periodKind, period_key: periodKey, band: band.id,
      issued: draws.length, already_issued: false,
    } as Json;
  }

  async getContractsFacts(playerId: string): Promise<ContractsFacts | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    const now = this.now();
    const assemble = (kind: ContractPeriodKind): ContractSetFacts => {
      const periodKey = contractPeriodKey(kind, now);
      const { rows, current } = this.currentContractInstances(playerId, kind, periodKey);
      const stats = this.contractStatsSnapshot(playerId);
      return {
        band: (current[0]?.band ?? contractBandForLevel(p.player_level).id) as ContractSetFacts['band'],
        instances: current.map((inst) => ({
          ...inst,
          progress: contractProgressFor(inst, stats, this.contractWindowFactsFor(playerId, inst)),
        })),
        rerollsUsed: rows.filter((r) => r.status === 'rerolled').length,
        setBonusClaimed: this.contractSetBonuses.has(`${playerId}:${kind}:${periodKey}`),
      };
    };
    const accountType = (p as Record<string, unknown>).account_type;
    return {
      account_type: typeof accountType === 'string' ? accountType : 'guest',
      player_level: p.player_level,
      daily: assemble('daily'),
      weekly: assemble('weekly'),
    };
  }

  async claimContractReward(playerId: string, nonce: string, instanceId: string): Promise<Json> {
    const p = this.requireProfile(playerId);
    const ledgerKey = `contracts-claim:${playerId}:${nonce}`;
    const prior = this.ledger.get(ledgerKey);
    if (prior) return prior;
    if (!nonce || nonce.length < 8) throw new GameplayStoreError('A claim nonce is required');
    const facts = await this.getContractsFacts(playerId);
    if (facts && facts.account_type === 'guest') {
      throw new GameplayStoreError('Contracts require a verified account — link Google sign-in to claim rewards');
    }
    const inst = this.contractInstances.find((i) => i.id === instanceId && i.user_id === playerId);
    if (!inst) throw new GameplayStoreError('Contract not found');
    if (inst.status === 'claimed') throw new GameplayStoreError('Contract already claimed');
    if (inst.status === 'rerolled') throw new GameplayStoreError('Contract was rerolled');
    if (contractPeriodExpired(inst.periodKind, inst.periodKey, this.now())) {
      throw new GameplayStoreError('Contract expired — the window has closed');
    }
    const progress = contractProgressFor(
      inst,
      this.contractStatsSnapshot(playerId),
      this.contractWindowFactsFor(playerId, inst),
    );
    if (progress < inst.target) throw new GameplayStoreError('Contract not complete');

    p.credits += inst.reward.credits;
    p.cache_token_parts += inst.reward.fragments;
    inst.status = 'claimed';
    inst.claimedAt = this.now().toISOString();

    let setBonus: Json = null;
    const bonusKey = `${playerId}:${inst.periodKind}:${inst.periodKey}`;
    const { current } = this.currentContractInstances(playerId, inst.periodKind, inst.periodKey);
    if (current.length > 0 && current.every((i) => i.status === 'claimed')
      && !this.contractSetBonuses.has(bonusKey)) {
      const bonus = contractSetBonusFor(
        inst.periodKind, contractBandById(inst.band as ContractBandId), this.contractsLevers());
      this.contractSetBonuses.set(bonusKey, bonus);
      p.credits += bonus.credits;
      p.cache_token_parts += bonus.fragments;
      p.cache_tokens += bonus.cacheKeys;
      setBonus = { credits: bonus.credits, fragments: bonus.fragments, cache_keys: bonus.cacheKeys } as Json;
    }

    const result = {
      action_type: 'cc_claim_contract_reward',
      instance_id: inst.id,
      template_id: inst.templateId,
      period_kind: inst.periodKind,
      period_key: inst.periodKey,
      credits_awarded: inst.reward.credits,
      fragments_awarded: inst.reward.fragments,
      set_bonus: setBonus,
      profile: this.snapshot(p),
    } as Json;
    this.ledger.set(ledgerKey, result);
    return result;
  }

  async rerollContract(playerId: string, nonce: string, instanceId: string): Promise<Json> {
    const p = this.requireProfile(playerId);
    const ledgerKey = `contracts-reroll:${playerId}:${nonce}`;
    const prior = this.ledger.get(ledgerKey);
    if (prior) return prior;
    if (!nonce || nonce.length < 8) throw new GameplayStoreError('A reroll nonce is required');
    const inst = this.contractInstances.find((i) => i.id === instanceId && i.user_id === playerId);
    if (!inst) throw new GameplayStoreError('Contract not found');
    if (inst.status === 'claimed') throw new GameplayStoreError('Claimed contracts cannot be rerolled');
    if (inst.status === 'rerolled') throw new GameplayStoreError('Contract already rerolled');
    if (contractPeriodExpired(inst.periodKind, inst.periodKey, this.now())) {
      throw new GameplayStoreError('Contract expired — the window has closed');
    }
    const progress = contractProgressFor(
      inst,
      this.contractStatsSnapshot(playerId),
      this.contractWindowFactsFor(playerId, inst),
    );
    if (progress >= inst.target) {
      throw new GameplayStoreError('Contract complete — claim it or let it expire');
    }
    const levers = this.contractsLevers();
    const { rows, current } = this.currentContractInstances(playerId, inst.periodKind, inst.periodKey);
    const used = rows.filter((r) => r.status === 'rerolled').length;
    const free = used < 1;
    const cost = free ? 0 : inst.periodKind === 'daily'
      ? levers.contractRerollScrapDaily : levers.contractRerollScrapWeekly;
    if (cost > 0 && p.scrap < cost) throw new GameplayStoreError('Insufficient scrap for a reroll');
    const band = contractBandById(inst.band as ContractBandId);
    const draw = drawContractReroll({
      kind: inst.periodKind,
      periodKey: inst.periodKey,
      band,
      playerId,
      slot: inst.slot,
      generation: inst.generation + 1,
      bosses: CONTRACT_BOSS_CHOICES,
      excludeIds: current.map((i) => i.templateId),
      setFamilies: current
        .filter((i) => i.slot !== inst.slot)
        .map((i) => CONTRACT_TEMPLATE_BY_ID.get(i.templateId)?.family ?? 'meta'),
    });
    if (!draw) throw new GameplayStoreError('No replacement contract available on this board');
    if (cost > 0) p.scrap -= cost;
    inst.status = 'rerolled';
    const replacement: ContractInstanceRecord & { user_id: string; band: string } = {
      user_id: playerId,
      id: randomUUID(),
      periodKind: inst.periodKind,
      periodKey: inst.periodKey,
      slot: inst.slot,
      generation: inst.generation + 1,
      templateId: draw.template.id,
      band: inst.band,
      params: draw.params,
      target: contractTargetFor(draw.template, inst.periodKind, band, levers),
      baseline: this.contractBaselineFor(playerId, draw.template),
      reward: contractRewardFor(draw.template, inst.periodKind, band, levers),
      status: 'active',
      issuedAt: this.now().toISOString(),
      claimedAt: null,
    };
    this.contractInstances.push(replacement);
    const result = {
      action_type: 'cc_reroll_contract',
      instance_id: replacement.id,
      replaced_instance_id: inst.id,
      template_id: draw.template.id,
      period_kind: inst.periodKind,
      period_key: inst.periodKey,
      scrap_charged: cost,
      free_reroll: free,
      profile: this.snapshot(p),
    } as Json;
    this.ledger.set(ledgerKey, result);
    return result;
  }

  async getDispatchFacts(playerId: string): Promise<{ profile: DispatchProfileFacts; items: DispatchCandidateItem[] } | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    const items: DispatchCandidateItem[] = [...this.items.values()]
      .filter((i) => i.owner_user_id === playerId)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        runtime_state: i.runtime_state,
        is_locked: i.is_locked,
        equipped_slot: i.equipped_slot,
        item_level: i.item_level,
        rarity: i.rarity,
        condition_current: i.condition_current ?? null,
        condition_max: i.condition_max ?? null,
        payload: JSON.parse(JSON.stringify(i.payload)) as Json,
      }));
    return {
      profile: {
        player_level: p.player_level,
        vehicle_fuel: p.vehicle_fuel,
        credits: p.credits,
        scrap: p.scrap,
      },
      items,
    };
  }

  async listDispatchMissions(playerId: string, limit: number): Promise<DispatchMissionRow[]> {
    return this.dispatchMissions
      .filter((m) => m.user_id === playerId)
      .sort((a, b) =>
        (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
        || b.departed_at.localeCompare(a.departed_at))
      .slice(0, Math.max(1, Math.trunc(limit) || 20))
      .map((m) => {
        const { user_id: _userId, ...row } = m;
        return { ...row, loadout_item_ids: [...row.loadout_item_ids] };
      });
  }

  /** cc_dispatch_depart mirror. */
  async departDispatch(playerId: string, nonce: string, terms: Json): Promise<Json> {
    if (!nonce || nonce.trim().length < 8) throw new GameplayStoreError('nonce is required');
    const prior = this.ledger.get(nonce);
    if (prior) return prior;
    const p = this.requireProfile(playerId);
    const t = terms as Record<string, unknown>;
    const family = String(t.family ?? '');
    const duration = Math.trunc(Number(t.duration_hours) || 0);
    if (family !== 'foot' && family !== 'courier') throw new GameplayStoreError('Unknown dispatch family');
    if (![2, 8, 24].includes(duration)) throw new GameplayStoreError('Invalid dispatch duration');
    const payoutCredits = Number(t.payout_credits ?? -1);
    const payoutScrap = Number(t.payout_scrap ?? -1);
    const payoutUnits = Number(t.payout_material_units ?? -1);
    if (!(payoutCredits >= 0 && payoutCredits <= 10000000)
      || !(payoutScrap >= 0 && payoutScrap <= 1000000)
      || !(payoutUnits >= 0 && payoutUnits <= 10000)) {
      throw new GameplayStoreError('Dispatch payout snapshot out of bounds');
    }
    const slots = this.dispatchLevers().dispatchQueueSlots;
    const activeCount = this.dispatchMissions.filter((m) => m.user_id === playerId && m.status === 'active').length;
    if (activeCount >= slots) throw new GameplayStoreError('Dispatch queue full');

    let loadoutIds: string[] = [];
    let vehicle: InMemoryItem | null = null;
    if (family === 'foot') {
      loadoutIds = Array.isArray(t.loadout_item_ids) ? t.loadout_item_ids.map((v) => String(v)) : [];
      if (loadoutIds.length < 1 || loadoutIds.length > 8) {
        throw new GameplayStoreError('Dispatch loadout must carry 1 to 8 items');
      }
      let missing = false;
      for (const id of loadoutIds) {
        const item = this.items.get(id);
        if (!item || item.owner_user_id !== playerId) { missing = true; continue; }
        if (item.runtime_state !== 'available' || item.equipped_slot !== null) {
          throw new GameplayStoreError(`Dispatch item is not spare: ${item.id}`);
        }
        if (item.kind === 'vehicle') {
          throw new GameplayStoreError('Vehicles ride courier contracts, not foot loadouts');
        }
      }
      if (missing || new Set(loadoutIds).size !== loadoutIds.length) {
        throw new GameplayStoreError('Dispatch item not found');
      }
      for (const id of loadoutIds) {
        const item = this.items.get(id)!;
        item.runtime_state = 'in_service';
        item.is_locked = true;
      }
    } else {
      const vehicleId = String(t.vehicle_item_id ?? '');
      vehicle = this.items.get(vehicleId) ?? null;
      if (!vehicle || vehicle.owner_user_id !== playerId) throw new GameplayStoreError('Courier vehicle not found');
      if (vehicle.kind !== 'vehicle') throw new GameplayStoreError('Courier assignment is not a vehicle');
      if (vehicle.runtime_state !== 'available' || vehicle.equipped_slot !== null) {
        throw new GameplayStoreError('Courier vehicle is not spare');
      }
      const classId = typeof vehicle.payload.vehicleClassId === 'string' ? vehicle.payload.vehicleClassId : null;
      if (classId !== (t.vehicle_class_id ?? null)) throw new GameplayStoreError('Courier vehicle class mismatch');
      const unlock = getVehicleClass(classId)?.unlockLevel ?? -1;
      if (unlock < courierTierGate(duration as 2 | 8 | 24)) {
        throw new GameplayStoreError('Vehicle class cannot run this courier tier');
      }
      const fuelCharged = Number(t.fuel_charged_units ?? 0);
      if ((p.vehicle_fuel ?? 0) < fuelCharged) throw new GameplayStoreError('Insufficient vehicle fuel');
      p.vehicle_fuel = (p.vehicle_fuel ?? 0) - fuelCharged;
      vehicle.runtime_state = 'in_service';
      vehicle.is_locked = true;
    }

    const departedAt = this.now();
    const mission: DispatchMissionRow & { user_id: string } = {
      user_id: playerId,
      id: randomUUID(),
      contract_family: family,
      offer_id: String(t.offer_id ?? ''),
      seed: String(t.seed ?? ''),
      destination_area_id: String(t.area_id ?? ''),
      duration_hours: duration,
      status: 'active',
      loadout_item_ids: [...loadoutIds],
      loadout_strength: Number(t.loadout_strength ?? 0),
      payout_credits: Math.trunc(payoutCredits),
      payout_scrap: Math.trunc(payoutScrap),
      payout_material_id: typeof t.payout_material_id === 'string' ? t.payout_material_id : null,
      payout_material_units: Math.trunc(payoutUnits),
      vehicle_item_id: family === 'courier' ? vehicle!.id : null,
      vehicle_class_id: family === 'courier' ? String(t.vehicle_class_id ?? '') : null,
      route_ticks: family === 'courier' ? Math.trunc(Number(t.route_ticks) || 0) : null,
      fuel_charged_units: family === 'courier' ? Number(t.fuel_charged_units ?? 0) : 0,
      fuel_refunded_units: 0,
      condition_at_departure: family === 'courier' ? Number(t.condition_at_departure ?? 0) : null,
      wear_projected: family === 'courier' ? Number(t.wear_projected ?? 0) : null,
      wear_applied: null,
      breakdown_fraction: family === 'courier' && t.breakdown_fraction !== null && t.breakdown_fraction !== undefined
        ? Number(t.breakdown_fraction) : null,
      cargo_bonus_units: Math.trunc(Number(t.cargo_bonus_units ?? 0)),
      premium_multiplier: family === 'courier' ? Number(t.premium_multiplier ?? 0) : null,
      payout_fraction: null,
      departed_at: departedAt.toISOString(),
      ends_at: new Date(departedAt.getTime() + duration * 3600_000).toISOString(),
      settled_at: null,
    };
    this.dispatchMissions.push(mission);
    const { user_id: _userId, ...row } = mission;
    const result: Json = {
      action_type: 'cc_dispatch_depart',
      mission: JSON.parse(JSON.stringify(row)) as Json,
      profile: this.snapshot(p),
    };
    this.ledger.set(nonce, result);
    return result;
  }

  /** The stored departure for a nonce (cc_dispatch_depart ledger mirror). */
  async getDispatchDeparture(playerId: string, nonce: string): Promise<Json | null> {
    const prior = this.ledger.get(nonce);
    if (!prior || prior.action_type !== 'cc_dispatch_depart') return null;
    const mission = (prior as Record<string, unknown>).mission as Record<string, unknown> | undefined;
    const owned = this.dispatchMissions.some(
      (m) => m.user_id === playerId && mission && m.id === mission.id,
    );
    return owned ? prior : null;
  }

  /** The shared settlement (cc_dispatch_settle_mission mirror). */
  private settleDispatchMission(
    mission: DispatchMissionRow & { user_id: string },
    fraction: number,
    recalled: boolean,
  ): Json {
    const p = this.requireProfile(mission.user_id);
    const f = Math.min(1, Math.max(0, fraction));
    const credits = Math.floor(mission.payout_credits * f);
    const scrap = Math.floor(mission.payout_scrap * f);
    const units = Math.floor(mission.payout_material_units * f);
    for (const id of mission.loadout_item_ids) {
      const item = this.items.get(id);
      if (item && item.runtime_state === 'in_service') {
        item.runtime_state = 'available';
        item.is_locked = false;
      }
    }
    let wearApplied: number | null = null;
    let fuelRefunded = 0;
    if (mission.contract_family === 'courier' && mission.vehicle_item_id) {
      wearApplied = (mission.wear_projected ?? 0) * f;
      fuelRefunded = mission.fuel_charged_units * (1 - f);
      const vehicle = this.items.get(mission.vehicle_item_id);
      if (vehicle && vehicle.runtime_state === 'in_service') {
        vehicle.runtime_state = 'available';
        vehicle.is_locked = false;
        vehicle.condition_current = Math.max(0, (mission.condition_at_departure ?? 0) - wearApplied);
      }
    }
    p.credits += credits;
    p.scrap += scrap;
    if (mission.payout_material_id && units > 0) {
      p.materials[mission.payout_material_id] = (p.materials[mission.payout_material_id] ?? 0) + units;
    }
    p.vehicle_fuel = (p.vehicle_fuel ?? 0) + fuelRefunded;
    mission.status = recalled ? 'recalled' : 'settled';
    mission.settled_at = this.now().toISOString();
    mission.payout_fraction = f;
    mission.wear_applied = wearApplied;
    mission.fuel_refunded_units = fuelRefunded;
    const result: Json = {
      action_type: 'cc_dispatch_settle',
      mission_id: mission.id,
      family: mission.contract_family,
      offer_id: mission.offer_id,
      area_id: mission.destination_area_id,
      duration_hours: mission.duration_hours,
      fraction: f,
      recalled,
      breakdown: mission.breakdown_fraction !== null && mission.breakdown_fraction < 1
        && f >= mission.breakdown_fraction - 0.000000001,
      payout: {
        credits,
        scrap,
        material_id: mission.payout_material_id,
        material_units: units,
      },
      wear_applied: wearApplied,
      fuel_refunded_units: fuelRefunded,
      profile: this.snapshot(p),
    };
    this.ledger.set(`dispatch-settle:${mission.id}`, result);
    this.dispatchSettleLog.push(result);
    return result;
  }

  /** cc_dispatch_settle_due mirror: due missions settle at term (breakdown fraction when set). */
  async settleDispatchDue(playerId: string): Promise<Json> {
    const nowMs = this.now().getTime();
    const due = this.dispatchMissions
      .filter((m) => m.user_id === playerId && m.status === 'active' && Date.parse(m.ends_at) <= nowMs)
      .sort((a, b) => a.ends_at.localeCompare(b.ends_at));
    const settled = due.map((m) => this.settleDispatchMission(m, m.breakdown_fraction ?? 1, false));
    return { action_type: 'cc_dispatch_settle_due', settled } as Json;
  }

  /** cc_dispatch_recall mirror: elapsed fraction, capped at the breakdown point. */
  async recallDispatch(playerId: string, nonce: string, missionId: string): Promise<Json> {
    if (!nonce || nonce.trim().length < 8) throw new GameplayStoreError('nonce is required');
    const prior = this.ledger.get(nonce);
    if (prior) return prior;
    const mission = this.dispatchMissions.find((m) => m.id === missionId && m.user_id === playerId);
    if (!mission) throw new GameplayStoreError('Dispatch mission not found');
    if (mission.status !== 'active') throw new GameplayStoreError('Dispatch mission not active');
    const elapsedMs = this.now().getTime() - Date.parse(mission.departed_at);
    let fraction = Math.min(1, Math.max(0, elapsedMs / (mission.duration_hours * 3600_000)));
    if (mission.breakdown_fraction !== null) fraction = Math.min(fraction, mission.breakdown_fraction);
    const result = this.settleDispatchMission(mission, fraction, true);
    this.ledger.set(nonce, result);
    return result;
  }

  async getActiveAction(playerId: string): Promise<ActiveActionRow | null> {
    const a = this.activeActions.get(playerId);
    if (!a) return null;
    return { ...a, activity_payload: { ...a.activity_payload } };
  }

  /** Test helper: seed a consumable batch row (quality record). */
  seedConsumableBatch(batch: InMemoryConsumableBatch): InMemoryConsumableBatch {
    this.consumableBatches.push(batch);
    return batch;
  }

  /** Test helper: seed a craft job for the offline settler. */
  seedCraftJob(job: CraftJobRecord): CraftJobRecord {
    this.craftJobs.push(job);
    return job;
  }

  async getConsumableBatches(playerId: string): Promise<ConsumableBatchRow[]> {
    return this.consumableBatches
      .filter((b) => b.owner_user_id === playerId && b.quantity > 0)
      .map((b) => ({ ...b }))
      .sort(
        (a, b) =>
          a.consumable_type.localeCompare(b.consumable_type) ||
          a.quality_percent - b.quality_percent ||
          a.created_at.localeCompare(b.created_at),
      );
  }

  /**
   * Offline craft settlement through the shared craft engine
   * (craftEngine.ts) — the same settler the in-memory WriteStore
   * runs, bound to this store's state. Levers resolve to the code
   * defaults here (the mirror's lever surface lives on the writes
   * store); the cap arrives from the settlement route.
   */
  async settleOfflineCraftJobs(playerId: string, capMs: number): Promise<Json> {
    const profile = this.profiles.get(playerId);
    if (!profile) return { settled: false, reason: 'no_profile' } as Json;
    const tools: WorkshopToolsState =
      this.workshopTools.get(playerId) ?? { owned: {}, fitted: {}, charges: {} };
    this.workshopTools.set(playerId, tools);
    const view: CraftProfileView = {
      player_level: profile.player_level,
      player_xp: profile.player_xp,
      credits: profile.credits,
      materials: profile.materials,
      essences: profile.essences,
      consumables: profile.consumables,
      workshop_benches: this.workshopBenches.get(playerId) ?? 1,
      legendary_cores: profile.legendary_cores ?? 0,
      workshop_tools: tools,
      offline_cap_hours: profile.offline_cap_hours,
    };
    const adapter: CraftAdapter = {
      nowMs: () => this.now().getTime(),
      rng: () => Math.random(),
      uuid: () => randomUUID(),
      profile: (id) => (id === playerId ? view : null),
      activeAction: (id) => {
        const a = this.activeActions.get(id);
        if (!a) return null;
        return {
          kind: a.active_action,
          lastHeartbeatMs: a.last_heartbeat_at ? new Date(a.last_heartbeat_at).getTime() : null,
        };
      },
      jobs: (id) => this.craftJobs.filter((j) => j.owner_user_id === id),
      addJob: (job) => {
        this.craftJobs.push(job);
      },
      masteryLevel: (id, track) => {
        const row = this.masteries.find((m) => m.user_id === id && m.mastery_id === track);
        return row ? Math.max(1, row.mastery_level) : 1;
      },
      skillBonus: (id, key) => {
        const prof = this.profiles.get(id);
        if (!prof) return 0;
        const spends: Record<string, number> = {};
        for (const [k, v] of Object.entries((prof.skill_spends ?? {}) as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v)) spends[k] = v;
        }
        return computeSkillBonuses(spends, this.classModBoostsFor(id))[key] ?? 0;
      },
      cacheRankXpBonus: (id) => {
        const prof = this.profiles.get(id);
        if (!prof) return 0;
        return cacheRankBonuses(prof.cache_rank_spends, this.cacheRankLevers()).xp;
      },
      // Research (0038): settle-first, then read this store's
      // completion records (the mirror of cc_research_bonus_number).
      researchBonus: (id, key) => {
        this.settleResearch(id);
        const completions = this.researchCompletions.get(id);
        if (!completions) return 0;
        const bonuses = computeResearchBonuses([...completions.keys()]) as unknown as Record<string, number>;
        return bonuses[key] ?? 0;
      },
      researchCompleted: (id, courseId) => {
        this.settleResearch(id);
        return this.researchCompletions.get(id)?.has(courseId) ?? false;
      },
      standingRank: (id, manufacturer) => this.standingRankFor(id, manufacturer),
      addMasteryXp: (id, track, xp) => {
        const existing = this.masteries.find((m) => m.user_id === id && m.mastery_id === track);
        if (existing) {
          existing.mastery_xp += xp;
          existing.mastery_level = masteryLevelForXp(existing.mastery_xp);
        } else {
          this.masteries.push({
            user_id: id,
            mastery_id: track,
            mastery_xp: xp,
            mastery_level: masteryLevelForXp(xp),
          });
        }
      },
      addStat: (id, key, amount) => {
        const existing = this.craftStatCounters.find((s) => s.user_id === id && s.stat_key === key);
        if (existing) existing.stat_value += amount;
        else this.craftStatCounters.push({ user_id: id, stat_key: key, stat_value: amount });
      },
      addBatch: (id, type, qty, quality, _origin, _creatorId, _recipeId) => {
        this.consumableBatches.push({
          owner_user_id: id,
          consumable_type: type,
          quality_percent: quality,
          quantity: qty,
          created_at: this.now().toISOString(),
        });
        profile.consumables[type] = (profile.consumables[type] ?? 0) + qty;
      },
      // Enqueue-time escrow is a writes-store concern; the offline
      // settler never burns units.
      burnOneBatchUnit: () => null,
      insertGearItem: (id, candidate) => {
        const payload = { ...(candidate.payload as Record<string, unknown>) };
        const itemId = typeof payload.id === 'string' && payload.id ? payload.id : randomUUID();
        payload.id = itemId;
        this.items.set(itemId, {
          id: itemId,
          owner_user_id: id,
          kind: candidate.kind,
          runtime_state: 'available',
          is_locked: false,
          rarity: candidate.rarity,
          item_level: candidate.itemLevel,
          estimated_value: computeItemEstimatedValue(
            payload,
            candidate.kind,
            candidate.rarity,
            candidate.itemLevel,
          ),
          supply_mode: 'verified_action',
          tradeable: true,
          equipped_slot: null,
          payload,
        });
        return itemId;
      },
      vehicleInfo: (id, itemId) => {
        const item = this.items.get(itemId);
        if (!item || item.owner_user_id !== id) return null;
        return {
          kind: item.kind,
          runtimeState: item.runtime_state,
          conditionCurrent: item.condition_current ?? VEHICLE_CONDITION_MAX,
          conditionMax: item.condition_max ?? VEHICLE_CONDITION_MAX,
        };
      },
      restoreVehicle: (id, itemId, points) => {
        const item = this.items.get(itemId);
        if (!item || item.owner_user_id !== id || item.kind !== 'vehicle') return null;
        const max = item.condition_max ?? VEHICLE_CONDITION_MAX;
        item.condition_current = Math.min(max, (item.condition_current ?? max) + points);
        return { conditionCurrent: item.condition_current, conditionMax: max };
      },
      levers: () => ({
        craftXpRate: CRAFT_XP_RATE_DEFAULT,
        craftTimeScalar: CRAFT_TIME_SCALAR_DEFAULT,
        craftQualityShift: CRAFT_QUALITY_SHIFT_DEFAULT,
        gearTemperBaseChance: GEAR_TEMPER_BASE_CHANCE_DEFAULT,
        refineBaseYield: REFINE_BASE_YIELD_DEFAULT,
        repairWorkRateBase: REPAIR_WORK_RATE_BASE_DEFAULT,
        repairMasterySpeedPerLevel: REPAIR_MASTERY_SPEED_PER_LEVEL_DEFAULT,
        repairMasteryEfficiencyPerLevel: REPAIR_MASTERY_EFFICIENCY_PER_LEVEL_DEFAULT,
      }),
    };
    const settled = settleCraftJobsCore(adapter, playerId, { maxAdvanceMs: Math.max(0, capMs) });
    // 0042: contracts stat mirror — repair-unit completions restore
    // condition points for the item's owner (self-repair lane; the
    // SQL stat lands inside cc_complete_craft_unit).
    for (const completion of settled.completions) {
      if (completion.kind === 'repair' && (completion.pointsRestored ?? 0) > 0) {
        this.addContractStat(playerId, 'services.points_restored', Math.round(completion.pointsRestored ?? 0));
      }
    }
    // 0030: offline craft completions charge a Fixer-selected
    // player's Overclock pool, like every verified settlement (the
    // SQL path accrues inside cc_complete_craft_unit). Rates resolve
    // at the content defaults in this twin.
    if (settled.completions.length > 0 && profile.action_skill_selection === 'Fixer') {
      const { qualified } = resolveActionSkill(
        (profile.skill_spends ?? {}) as Record<string, number>,
        this.classModBoostsFor(playerId),
        'Fixer',
      );
      if (qualified.includes(SkillTreeType.Fixer)) {
        const levers = resolveActionSkillLevers();
        let gain = 0;
        for (const completion of settled.completions) {
          gain +=
            completion.kind === 'repair'
              ? levers.actionSkillChargePerRepairPoint * (completion.pointsRestored ?? 0)
              : levers.actionSkillChargePerCraftUnit;
        }
        profile.action_skill_charge = accrueActionSkillCharge(profile.action_skill_charge ?? 0, gain);
      }
    }
    profile.player_level = view.player_level;
    profile.player_xp = view.player_xp;
    this.applyCacheRankGrant(profile);
    profile.credits = view.credits;
    this.workshopBenches.set(playerId, view.workshop_benches);
    return {
      settled: settled.settled,
      advanced_ms: settled.advancedMs,
      xp_awarded: settled.xpAwarded,
      jobs_completed: settled.jobsCompleted,
      completions: settled.completions as unknown as Json,
    } as Json;
  }

  async getEquippedGear(playerId: string): Promise<GearItem[]> {
    const entries = await this.getEquippedItems(playerId);
    return entries.map((entry) => entry.item);
  }

  /**
   * The extraction engine adapter (src/server/writes/extractionEngine.ts)
   * bound to this store's state — the twin of migration 0033's SQL
   * (cc_settle_extraction_time + cc_apply_extraction), shared with
   * the writes store's transition hooks.
   */
  private extractionAdapter(): ExtractionAdapter {
    return {
      nowMs: () => this.now().getTime(),
      profile: (id) => {
        const p = this.profiles.get(id);
        if (!p) return null;
        const spends: Record<string, number> = {};
        for (const [k, v] of Object.entries((p.skill_spends ?? {}) as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v)) spends[k] = v;
        }
        return {
          level: p.player_level,
          skillSpends: spends,
          cacheRankSpends: sanitizeCacheRankSpends(p.cache_rank_spends),
          deathState: (p.death_state ?? {}) as Record<string, unknown>,
          offlineCapHours: p.offline_cap_hours,
          verified:
            (p as Record<string, unknown>).account_type === undefined
              ? true
              : (p as Record<string, unknown>).account_type === 'verified' &&
                (p as Record<string, unknown>).email_verified_at != null,
        };
      },
      activeAction: (id) => {
        const a = this.activeActions.get(id);
        if (!a) return null;
        return {
          kind: a.active_action,
          targetId: a.target_id,
          payload: a.activity_payload ?? {},
          lastHeartbeatMs: a.last_heartbeat_at ? new Date(a.last_heartbeat_at).getTime() : null,
          startedMs: a.started_at ? new Date(a.started_at).getTime() : null,
        };
      },
      equippedItems: (id) => this.equippedItemsSync(id),
      masteryLevel: (id, track) => {
        const row = this.masteries.find((m) => m.user_id === id && m.mastery_id === track);
        return row ? Math.max(1, row.mastery_level) : 1;
      },
      addMasteryXp: (id, track, xp) => {
        const existing = this.masteries.find((m) => m.user_id === id && m.mastery_id === track);
        if (existing) {
          existing.mastery_xp += xp;
          existing.mastery_level = masteryLevelForXp(existing.mastery_xp);
        } else {
          this.masteries.push({
            user_id: id,
            mastery_id: track,
            mastery_xp: xp,
            mastery_level: masteryLevelForXp(xp),
          });
        }
      },
      cacheRankXpBonus: (id) => {
        const prof = this.profiles.get(id);
        if (!prof) return 0;
        return cacheRankBonuses(prof.cache_rank_spends, this.cacheRankLevers()).xp;
      },
      state: (id) => this.extractionStates.get(id) ?? null,
      saveState: (id, state) => {
        this.extractionStates.set(id, state);
      },
      applyPlayerXp: (id, xp) => {
        const p = this.profiles.get(id);
        if (!p) return 1;
        const next = applyXp(p.player_level, p.player_xp, xp);
        p.player_level = next.player_level;
        p.player_xp = next.player_xp;
        this.applyCacheRankGrant(p);
        return p.player_level;
      },
      creditFinds: (id, materials, essences) => {
        const p = this.profiles.get(id);
        if (!p) return;
        for (const [k, v] of Object.entries(materials)) p.materials[k] = (p.materials[k] ?? 0) + v;
        for (const [k, v] of Object.entries(essences)) p.essences[k] = (p.essences[k] ?? 0) + v;
      },
      addStat: (id, key, amount) => {
        const existing = this.extractionStatCounters.find((s) => s.user_id === id && s.stat_key === key);
        if (existing) existing.stat_value += amount;
        else this.extractionStatCounters.push({ user_id: id, stat_key: key, stat_value: amount });
      },
      recordSettle: (id, payload) => {
        this.extractionSettleLog.push({ user_id: id, ...payload } as Json);
      },
    };
  }

  /** Test helper: seed an extraction_state row directly. */
  seedExtractionState(state: ExtractionStateRecord): ExtractionStateRecord {
    this.extractionStates.set(state.user_id, state);
    return state;
  }

  async getExtractionState(playerId: string): Promise<ExtractionStateRow | null> {
    // Lazy accrual on read (0033): completed passes wait pending
    // until a settle finalizes them.
    accrueExtractionTime(this.extractionAdapter(), playerId);
    const state = this.extractionStates.get(playerId);
    if (!state) return null;
    return {
      area_id: state.area_id,
      method: state.method,
      pass_area_id: state.pass_area_id,
      pass_method: state.pass_method,
      accrued_ms: state.accrued_ms,
      pending_passes: state.pending_passes.map((p) => ({ index: p.index, areaId: p.areaId, method: p.method })),
      finalized_passes: state.finalized_passes,
      total_xp_awarded: state.total_xp_awarded,
      last_settled_ms: state.last_settled_ms,
    };
  }

  async getExtractionFacts(playerId: string): Promise<ExtractionFacts | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    const mastery = this.masteries.find(
      (m) => m.user_id === playerId && m.mastery_id === EXTRACTION_MASTERY_TRACK,
    );
    const shield = this.equippedItemsSync(playerId).find((e) => e.slot === 'shield');
    const payload = (shield?.item ?? null) as unknown as Record<string, unknown> | null;
    return {
      player_level: p.player_level,
      player_xp: p.player_xp,
      mastery_level: mastery ? Math.max(1, mastery.mastery_level) : 1,
      mastery_xp: mastery?.mastery_xp ?? 0,
      shield_hp: payload && typeof payload.hp === 'number' ? payload.hp : 0,
      shield_mitigation: payload && typeof payload.mitigation === 'number' ? payload.mitigation : 0,
      shield_element: payload && typeof payload.element === 'string' ? payload.element : null,
    };
  }

  async settleExtraction(playerId: string, input: ExtractionSettleInput): Promise<ExtractionSettle> {
    const adapter = this.extractionAdapter();
    const levers = resolveExtractionLevers({ ...this.extractionLevers(), ...input.levers });
    const accrued = accrueExtractionTime(adapter, playerId, { maxAdvanceMs: input.maxAdvanceMs ?? null });
    const settled = finalizeExtractionPasses(adapter, playerId, levers, {
      isHot: (areaId) => isHotArea(areaId, input.now),
      hotAreaMaterialBonus: input.hotAreaMaterialBonus,
    });
    // 0042: contracts window fold — extraction units found this settle.
    const extractionUnits = Object.values(settled.materials).reduce((n, q) => n + q, 0)
      + Object.values(settled.essences).reduce((n, q) => n + q, 0);
    if (extractionUnits > 0) {
      this.contractExtractionLog.push({ playerId, units: extractionUnits, atMs: this.now().getTime() });
    }
    return {
      advancedMs: accrued.advancedMs,
      xpAwarded: settled.xpAwarded,
      materials: settled.materials,
      essences: settled.essences,
      passes: settled.passes.map((p) => ({
        index: p.index,
        areaId: p.areaId,
        method: p.method as ExtractionMethod,
        draws: p.draws,
        gearFactor: p.gearFactor,
        deepDegraded: p.deepDegraded,
        xpAwarded: p.xpAwarded,
        materials: p.materials,
        essences: p.essences,
        signatureUnits: p.signatureUnits,
      })),
    };
  }

  async getEquippedItems(playerId: string): Promise<EquippedItemEntry[]> {
    return this.equippedItemsSync(playerId);
  }

  /** Synchronous equipped-items read (the extraction adapter's seam). */
  private equippedItemsSync(playerId: string): EquippedItemEntry[] {
    const slotRank = new Map<string, number>(LOADOUT_SLOT_ORDER.map((slot, i) => [slot, i]));
    return [...this.items.values()]
      .filter(
        (item) =>
          item.owner_user_id === playerId &&
          item.runtime_state === 'equipped' &&
          item.equipped_slot !== null &&
          slotRank.has(item.equipped_slot),
      )
      .sort((a, b) => (slotRank.get(a.equipped_slot!) ?? 0) - (slotRank.get(b.equipped_slot!) ?? 0))
      .map((item) => ({
        slot: item.equipped_slot as LoadoutSlot,
        item: JSON.parse(JSON.stringify(item.payload)) as GearItem,
      }));
  }

  async getActiveDropBonus(playerId: string, now: Date): Promise<number> {
    const nowMs = now.getTime();
    let best = 0;
    for (const buff of this.dropBuffs) {
      if (buff.playerId !== playerId) continue;
      if (Date.parse(buff.expiresAt) <= nowMs) continue;
      best = Math.max(best, buff.bonus);
    }
    return best;
  }

  /** Test helper: grant a drop-luck buff row (0035 mirror). */
  seedDropBuff(playerId: string, bonus: number, expiresAt: string): void {
    this.dropBuffs.push({ playerId, bonus, expiresAt });
  }

  async getEquippedVehicle(playerId: string): Promise<EquippedVehicleRow | null> {
    const item = [...this.items.values()].find(
      (entry) =>
        entry.owner_user_id === playerId &&
        entry.runtime_state === 'equipped' &&
        entry.equipped_slot === 'vehicle',
    );
    if (!item) return null;
    return {
      instanceId: item.id,
      vehicle: JSON.parse(JSON.stringify(item.payload)) as Vehicle,
      conditionCurrent: item.condition_current ?? VEHICLE_CONDITION_MAX,
      conditionMax: item.condition_max ?? VEHICLE_CONDITION_MAX,
    };
  }

  /** cc_apply_vehicle_usage (0021): guarded on the instance still being the equipped vehicle. */
  async applyVehicleUsage(playerId: string, usage: VehicleUsageInput): Promise<Json> {
    const p = this.requireProfile(playerId);
    const item = this.items.get(usage.instanceId);
    if (
      !item ||
      item.owner_user_id !== playerId ||
      item.runtime_state !== 'equipped' ||
      item.equipped_slot !== 'vehicle'
    ) {
      return { applied: false, reason: 'vehicle_not_equipped' };
    }
    p.vehicle_fuel = Math.max(0, usage.fuelUnits);
    item.condition_current = Math.max(0, Math.min(item.condition_max ?? VEHICLE_CONDITION_MAX, usage.conditionCurrent));
    return {
      applied: true,
      vehicle_fuel: p.vehicle_fuel,
      condition_current: item.condition_current,
      condition_max: item.condition_max ?? VEHICLE_CONDITION_MAX,
    };
  }

  /**
   * cc_record_kill_stats (0034): accumulate a settled claim's kills
   * under the weapon the hunter currently holds — the equipped weapon
   * instance's payload weaponType, or 'unarmed' with no weapon
   * equipped (the SQL derives the same from item_instances). Callers
   * invoke this ONLY on their pay paths, after the idempotency
   * early-return, so a replayed claim never double-counts.
   */
  private recordKillStats(playerId: string, kills: number): void {
    if (!Number.isFinite(kills) || kills <= 0) return;
    let weaponType = 'unarmed';
    for (const item of this.items.values()) {
      if (
        item.owner_user_id === playerId
        && item.runtime_state === 'equipped'
        && item.equipped_slot === 'weapon'
      ) {
        const fromPayload = item.payload?.weaponType;
        weaponType = typeof fromPayload === 'string' && fromPayload !== '' ? fromPayload : 'unarmed';
        break;
      }
    }
    const key = `${playerId}:${weaponType}`;
    this.killStats.set(key, (this.killStats.get(key) ?? 0) + Math.trunc(kills));
  }

  /** Test-visible view of the 0034 kill record for one player. */
  killStatsFor(playerId: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, kills] of this.killStats) {
      const sep = key.indexOf(':');
      if (key.slice(0, sep) === playerId) out[key.slice(sep + 1)] = kills;
    }
    return out;
  }

  async applyChefRewards(
    playerId: string,
    rewards: ChefRewardsInput,
    tickCount: number,
    areaId: string,
  ): Promise<Json> {
    const p = this.requireProfile(playerId);
    const nonceKey = `${playerId}:chef:${tickCount}`;
    const prior = this.ledger.get(nonceKey);
    if (prior) return prior;
    if (tickCount <= p.last_claimed_tick) {
      throw new GameplayStoreError(
        `tick_count ${tickCount} is not after last claimed tick ${p.last_claimed_tick}`,
      );
    }
    const echo = this.applyRewardBundle(p, rewards);
    // 0034: lifetime kill record (cc_record_kill_stats on the pay path).
    this.recordKillStats(playerId, rewards.kills);
    // 0042: contracts stat mirror (the SQL trigger's roaming branch).
    this.addContractStat(playerId, 'combat.roaming_kills', rewards.kills);
    this.addContractStat(playerId, 'combat.idle_xp_claimed', rewards.xp);
    p.last_claimed_tick = tickCount;
    p.last_roaming_settled_at = this.now().toISOString();

    const action = this.activeActions.get(playerId);
    if (action) {
      action.last_heartbeat_at = this.now().toISOString();
      action.activity_payload = {
        ...action.activity_payload,
        last_claim_ticks: 1,
        last_claim_at: this.now().getTime(),
      };
    }

    const result: Json = {
      action_type: 'cc_apply_chef_rewards',
      profile: this.snapshot(p),
      // 0014: the SQL applier records the farmed area in the payload.
      area_id: areaId,
      rewards: echo,
    };
    this.ledger.set(nonceKey, result);
    // 0014: the ledger insert fires the mastery trigger in Postgres;
    // mirror its cc_apply_chef_rewards branch.
    this.grantRoamingMastery(playerId, areaId, rewards.xp);
    return result;
  }

  async storeChefItems(playerId: string, items: unknown[]): Promise<Json> {
    let inserted = 0;
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const payload = { ...(raw as Record<string, unknown>) };
      const kind = itemKind(payload);
      const rarity = typeof payload.rarity === 'string' ? payload.rarity : null;
      const itemLevel = Math.trunc(Number(payload.level) || 1);
      const id = randomUUID();
      this.items.set(id, {
        id,
        owner_user_id: playerId,
        kind,
        runtime_state: 'available',
        is_locked: false,
        rarity,
        item_level: itemLevel,
        estimated_value: computeItemEstimatedValue(payload as Json, kind, rarity ?? '', itemLevel),
        supply_mode: 'verified_action',
        tradeable: true,
        equipped_slot: null,
        // Vehicles are stored at full condition (0021 cc_store_chef_items).
        condition_current: kind === 'vehicle' ? VEHICLE_CONDITION_MAX : null,
        condition_max: kind === 'vehicle' ? VEHICLE_CONDITION_MAX : null,
        payload,
      });
      inserted += 1;
    }
    return { inserted };
  }

  async consumeRoamingConsumables(
    playerId: string,
    consumed: Json,
    areaId: string,
    tickCount: number,
  ): Promise<Json> {
    const p = this.profiles.get(playerId);
    if (!p) return { consumables: {} };
    const next = { ...p.consumables };
    let usedTotal = 0;
    for (const [itemKey, rawQty] of Object.entries(asRecord(consumed))) {
      if (rawQty <= 0) continue;
      const applied = Math.min(rawQty, Math.max(0, Math.trunc(next[itemKey] ?? 0)));
      if (applied <= 0) continue;
      usedTotal += applied;
      next[itemKey] = Math.trunc(next[itemKey] ?? 0) - applied;
      this.consumableEvents.push({
        user_id: playerId,
        consumable_type: itemKey,
        quantity_delta: -applied,
        event_type: 'used',
        activity_type: 'roaming_loot',
        reason: `Consumed during roaming tick ${tickCount} in ${areaId}`,
      });
    }
    // 0042: contracts stat mirror (consumables.used).
    this.addContractStat(playerId, 'consumables.used', usedTotal);
    p.consumables = next;
    return { consumables: { ...next } };
  }

  /**
   * Action skill charge resolution shared by the boss + endless
   * applier mirrors (0030): a fire is validated against the profile's
   * recorded selection + keystone qualification derived from the
   * player's OWN records, and spends the pool to 0; a non-firing
   * resolution accrues at the route-resolved rate, capped. Throws the
   * SQL applier's messages verbatim. Returns the payload block both
   * appliers record.
   */
  private resolveActionSkillCharge(
    p: InMemoryProfile,
    playerId: string,
    tree: string | null | undefined,
    rate: number | undefined,
  ): { tree: string | null; fired: boolean; charge_after: number } {
    if (tree !== null && tree !== undefined) {
      if (!isActionSkillTree(tree)) {
        throw new GameplayStoreError(`Unknown action skill tree: ${tree}`);
      }
      if (p.action_skill_selection !== tree) {
        throw new GameplayStoreError('Action skill selection mismatch');
      }
      const { qualified } = resolveActionSkill(
        (p.skill_spends ?? {}) as Record<string, number>,
        this.classModBoostsFor(playerId),
        p.action_skill_selection,
      );
      if (!qualified.includes(tree)) {
        throw new GameplayStoreError('Action skill not qualified for the selected tree');
      }
      if ((p.action_skill_charge ?? 0) < 100) {
        throw new GameplayStoreError('Action skill is not charged');
      }
      p.action_skill_charge = 0;
      return { tree, fired: true, charge_after: 0 };
    }
    p.action_skill_charge = accrueActionSkillCharge(p.action_skill_charge ?? 0, rate ?? 0);
    return { tree: null, fired: false, charge_after: p.action_skill_charge };
  }

  async applyChefBossAttempt(playerId: string, attempt: ChefBossAttemptInput): Promise<Json> {
    const p = this.requireProfile(playerId);
    const nonceKey = `${playerId}:chef-boss:${attempt.bossId}:${attempt.attemptNonce}`;
    const prior = this.ledger.get(nonceKey);
    // 0011: a replay returns the stored payload plus the replay
    // marker (merged at return time only — the ledger copy is the
    // pristine first-application payload, like the SQL applier).
    if (prior) return { ...(prior as Record<string, unknown>), idempotent_replay: true };

    // 0011: entry-fee affordability guard (mirrors the SQL applier).
    // The fee is already folded into creditsDelta by the Chef; this
    // guard is the applier-level backstop behind the route's check.
    if (Math.trunc(attempt.entryFee) > 0 && p.credits < Math.trunc(attempt.entryFee)) {
      throw new GameplayStoreError('Insufficient credits for boss entry fee');
    }

    // 0030: action skill spend/accrue (mirrors the SQL applier block).
    const actionSkill = this.resolveActionSkillCharge(
      p,
      playerId,
      attempt.actionSkillTree ?? null,
      attempt.actionSkillChargeRate,
    );

    const leveled = applyXp(p.player_level, p.player_xp, Math.max(0, Math.trunc(attempt.xp)));

    const nextConsumables = { ...p.consumables };
    for (const [itemKey, rawQty] of Object.entries(asRecord(attempt.consumables))) {
      const current = Math.trunc(nextConsumables[itemKey] ?? 0);
      if (current < rawQty) {
        throw new GameplayStoreError(`Insufficient consumable quantity for ${itemKey}`);
      }
      nextConsumables[itemKey] = Math.max(0, current - rawQty);
    }

    // 0040 (CONS-02): the attempt's loot is stored as part of the
    // attempt application — after every validation that can throw,
    // before the profile mutations — mirroring the SQL applier, which
    // stores the items inside the attempt transaction. A failure can
    // therefore never leave a recorded victory whose loot is missing.
    if (attempt.items && attempt.items.length > 0) {
      await this.storeChefItems(playerId, attempt.items);
    }

    p.player_level = leveled.player_level;
    p.player_xp = leveled.player_xp;
    this.applyCacheRankGrant(p);
    p.consumables = nextConsumables;

    const bossState = JSON.parse(JSON.stringify(p.boss_state)) as Record<string, unknown>;
    const defeated = Array.isArray(bossState.defeatedBossIds) ? [...(bossState.defeatedBossIds as string[])] : [];
    const unlocked = Array.isArray(bossState.unlockedBossIds)
      ? [...(bossState.unlockedBossIds as string[])]
      : ['dune_tyrant'];
    const pity = { ...((bossState.pityCounters as Record<string, number> | undefined) ?? {}) };
    if (attempt.victory) {
      if (!defeated.includes(attempt.bossId)) defeated.push(attempt.bossId);
      if (attempt.unlockedBossId && !unlocked.includes(attempt.unlockedBossId)) {
        unlocked.push(attempt.unlockedBossId);
      }
      pity[attempt.bossId] = 0;
    } else {
      pity[attempt.bossId] = (pity[attempt.bossId] ?? 0) + 1;
    }
    bossState.defeatedBossIds = defeated;
    bossState.unlockedBossIds = unlocked;
    bossState.pityCounters = pity;
    bossState.lastBossAttempt = attempt.attempt;
    p.boss_state = bossState;

    p.credits = Math.max(0, p.credits + Math.trunc(attempt.creditsDelta));
    // 0008: Second Opinion auto-scrap credit (SQL: scrap = scrap + delta).
    p.scrap += Math.trunc(attempt.scrap);

    const result: Json = {
      action_type: 'cc_apply_boss_attempt',
      profile: this.snapshot(p),
      boss_id: attempt.bossId,
      attempt: attempt.attempt,
      consumed_batches: [],
      scrap_awarded: Math.trunc(attempt.scrap),
      entry_fee: Math.trunc(attempt.entryFee),
      // 0014: the SQL applier records the awarded XP in the payload.
      xp_awarded: Math.max(0, Math.trunc(attempt.xp)),
      // 0030: the action skill outcome (fire meters fold from this).
      action_skill: actionSkill,
    };
    this.ledger.set(nonceKey, result);
    if (attempt.victory) {
      this.bossVictoryLog.push({ playerId, bossId: attempt.bossId, atMs: this.now().getTime() });
      // 0042: contracts stat mirror (boss victories).
      this.addContractStat(playerId, 'combat.boss_defeats', 1);
    }
    // 0014: mirror the trigger's cc_apply_boss_attempt branch —
    // attempts always count, defeats pay on victory, weapon mastery
    // follows the (victory-gated) awarded XP, and the prepared set
    // the applier consumed feeds consumable mastery. No location
    // grant: bosses have no area in the data model.
    this.addMasteryXp(playerId, 'combat.boss_attempts', 20);
    if (attempt.victory) this.addMasteryXp(playerId, 'combat.boss_defeats', 100);
    const weaponId = this.equippedWeaponMasteryId(playerId);
    if (weaponId) this.addMasteryXp(playerId, weaponId, Math.max(0, Math.trunc(attempt.xp)));
    this.grantConsumedMastery(playerId, asRecord(attempt.consumables));
    return result;
  }

  // --- Endless mode (migration 0028 mirrors) ---

  private endlessRunView(run: EndlessRunRow & { user_id: string; encounters: Json[] }): EndlessRunRow {
    const { user_id: _userId, encounters: _encounters, ...view } = run;
    return JSON.parse(JSON.stringify(view)) as EndlessRunRow;
  }

  /** Pay a run's escrow into the profile at `fraction` (1 = banked in full). */
  private settleEndlessEscrow(
    p: InMemoryProfile,
    run: EndlessRunRow & { user_id: string; encounters: Json[] },
    status: 'banked' | 'died' | 'abandoned',
    fraction: number,
  ): { credits: number; xp: number; scrap: number; fraction: number } {
    const frac = Math.max(0, Math.min(1, fraction));
    const paid = {
      credits: Math.floor(run.escrow_credits * frac),
      xp: Math.floor(run.escrow_xp * frac),
      scrap: Math.floor(run.escrow_scrap * frac),
    };
    p.credits += paid.credits;
    p.scrap += paid.scrap;
    if (paid.xp > 0) {
      const leveled = applyXp(p.player_level, p.player_xp, paid.xp);
      p.player_level = leveled.player_level;
      p.player_xp = leveled.player_xp;
      this.applyCacheRankGrant(p);
    }
    run.status = status;
    run.ended_at = this.now().toISOString();
    run.paid_credits = paid.credits;
    run.paid_xp = paid.xp;
    run.paid_scrap = paid.scrap;
    run.payout_fraction = frac;
    // 0030: every run ending resets the action skill charge pool
    // (the SQL appliers write the same reset on each ending path).
    p.action_skill_charge = 0;
    // Release the personal slot when it points at this run.
    const action = this.activeActions.get(run.user_id);
    if (action && action.active_action === 'endless_run' && action.target_id === run.id) {
      this.activeActions.set(run.user_id, {
        user_id: run.user_id,
        active_action: 'idle_standby',
        target_id: null,
        started_at: this.now().toISOString(),
        last_heartbeat_at: this.now().toISOString(),
        activity_payload: {},
      });
    }
    return { ...paid, fraction: frac };
  }

  async startEndlessRun(playerId: string, input: StartEndlessRunInput): Promise<Json> {
    const p = this.requireProfile(playerId);
    const nonceKey = `${playerId}:endless-start:${input.nonce}`;
    const prior = this.ledger.get(nonceKey);
    if (prior) return { ...(prior as Record<string, unknown>), idempotent_replay: true };

    if (deathRecordFromJson(p.death_state)) {
      throw new GameplayStoreError('Hunter is dead — resurrect before entering the Chamber');
    }
    // Validations run before any mutation (the SQL applier gets the
    // same atomicity from its transaction): belt counts first, then
    // the fee against the post-abandon balance — a carried-out bank
    // can fund the next entry, like cc_start_endless_run.
    const prepared = asRecord(input.preparedConsumables);
    for (const [type, qty] of Object.entries(prepared)) {
      if (Math.trunc(p.consumables[type] ?? 0) < qty) {
        throw new GameplayStoreError(`Insufficient consumable quantity for ${type}`);
      }
    }
    const existing = this.endlessRuns.find((r) => r.user_id === playerId && r.status === 'active');
    const fee = Math.max(0, Math.trunc(input.entryFee));
    const abandonCredits = existing
      ? Math.floor(existing.escrow_credits * Math.max(0, Math.min(1, input.deathPayoutFraction)))
      : 0;
    if (p.credits + abandonCredits < fee) {
      throw new GameplayStoreError('Insufficient credits for endless entry fee');
    }

    // A still-active run is carried out first: abandoned at the death
    // fraction (the cc_start_endless_run ordering — settle, then open).
    let abandonedSettlement: Json = null;
    if (existing) {
      const payout = this.settleEndlessEscrow(p, existing, 'abandoned', input.deathPayoutFraction);
      abandonedSettlement = {
        run_id: existing.id,
        depth_reached: existing.depth_reached,
        payout,
      } as Json;
    }

    // Burn the prepared belt (once, at entry — the run is one attempt).
    const nextConsumables = { ...p.consumables };
    for (const [type, qty] of Object.entries(prepared)) {
      nextConsumables[type] = Math.max(0, Math.trunc(nextConsumables[type] ?? 0) - qty);
    }
    p.consumables = nextConsumables;
    p.credits -= fee;

    const run: EndlessRunRow & { user_id: string; encounters: Json[] } = {
      id: randomUUID(),
      user_id: playerId,
      status: 'active',
      started_at: this.now().toISOString(),
      ended_at: null,
      start_level: p.player_level,
      risk: input.risk,
      prepared_consumables: prepared,
      depth_reached: 0,
      escrow_credits: 0,
      escrow_xp: 0,
      escrow_scrap: 0,
      entry_fee: fee,
      milestone_drops: [],
      paid_credits: 0,
      paid_xp: 0,
      paid_scrap: 0,
      payout_fraction: null,
      encounters: [],
    };
    this.endlessRuns.push(run);
    this.endlessStartLog.push({ playerId, atMs: this.now().getTime() });
    this.activeActions.set(playerId, {
      user_id: playerId,
      active_action: 'endless_run',
      target_id: run.id,
      started_at: this.now().toISOString(),
      last_heartbeat_at: this.now().toISOString(),
      activity_payload: { run_id: run.id, mode: 'chaos_chamber' },
    });

    const result: Json = {
      action_type: 'cc_start_endless_run',
      run: this.endlessRunView(run),
      entry_fee: fee,
      runs_started_today: this.endlessStartLog.filter(
        (e) => e.playerId === playerId && e.atMs >= Date.parse(new Date(this.now()).toISOString().slice(0, 10) + 'T00:00:00.000Z'),
      ).length,
      abandoned_settlement: abandonedSettlement,
      profile: this.snapshot(p),
    };
    this.ledger.set(nonceKey, result);
    return result;
  }

  async applyEndlessEncounter(playerId: string, input: ApplyEndlessEncounterInput): Promise<Json> {
    const p = this.requireProfile(playerId);
    const nonceKey = `${playerId}:endless-encounter:${input.nonce}`;
    const prior = this.ledger.get(nonceKey);
    if (prior) return { ...(prior as Record<string, unknown>), idempotent_replay: true };

    const run = this.endlessRuns.find((r) => r.id === input.runId && r.user_id === playerId);
    if (!run || run.status !== 'active') {
      throw new GameplayStoreError('Endless run is not active');
    }
    const action = this.activeActions.get(playerId);
    if (!action || action.active_action !== 'endless_run' || action.target_id !== run.id) {
      throw new GameplayStoreError('Endless run does not hold the action slot');
    }
    if (Math.trunc(input.depth) !== run.depth_reached + 1) {
      throw new GameplayStoreError('Endless depth mismatch');
    }

    // 0030: action skill spend/accrue. When this encounter ends the
    // run, settleEndlessEscrow below resets the pool to 0 — the same
    // net state the SQL applier lands (validate + spend, then reset).
    const actionSkill = this.resolveActionSkillCharge(
      p,
      playerId,
      input.actionSkillTree ?? null,
      input.actionSkillChargeRate,
    );

    run.encounters.push(input.encounter);
    let payout: { credits: number; xp: number; scrap: number; fraction: number } | null = null;
    if (input.victory) {
      run.escrow_credits += Math.max(0, Math.trunc(input.rewards.credits));
      run.escrow_xp += Math.max(0, Math.trunc(input.rewards.xp));
      run.escrow_scrap += Math.max(0, Math.trunc(input.rewards.scrap));
      run.depth_reached = Math.trunc(input.depth);
      if (input.milestoneDrop) {
        run.milestone_drops.push({
          depth: Math.trunc(input.depth),
          rarity: input.milestoneDrop.rarity,
          kind: input.milestoneDrop.kind,
          name: input.milestoneDrop.name,
        });
      }
      if (input.capReached) {
        payout = this.settleEndlessEscrow(p, run, 'banked', 1);
      }
    } else {
      payout = this.settleEndlessEscrow(p, run, 'died', input.deathPayoutFraction);
    }

    const result: Json = {
      action_type: 'cc_apply_endless_encounter',
      run_id: run.id,
      depth: Math.trunc(input.depth),
      victory: input.victory,
      rewards: {
        xp: Math.max(0, Math.trunc(input.rewards.xp)),
        credits: Math.max(0, Math.trunc(input.rewards.credits)),
        scrap: Math.max(0, Math.trunc(input.rewards.scrap)),
      },
      escrow: { credits: run.escrow_credits, xp: run.escrow_xp, scrap: run.escrow_scrap },
      run_status: run.status,
      milestone_drop: (input.milestoneDrop ?? null) as Json,
      payout: payout as Json,
      action_skill: actionSkill,
      profile: this.snapshot(p),
      run: this.endlessRunView(run),
    };
    this.ledger.set(nonceKey, result);
    return result;
  }

  async endEndlessRun(playerId: string, input: EndEndlessRunInput): Promise<Json> {
    const p = this.requireProfile(playerId);
    const nonceKey = `${playerId}:endless-end:${input.nonce}`;
    const prior = this.ledger.get(nonceKey);
    if (prior) return { ...(prior as Record<string, unknown>), idempotent_replay: true };

    const run = this.endlessRuns.find((r) => r.user_id === playerId && r.status === 'active');
    if (!run) {
      return { action_type: 'cc_end_endless_run', ended: false, reason: 'no_active_run' } as Json;
    }
    const payout = this.settleEndlessEscrow(p, run, 'banked', 1);
    const result: Json = {
      action_type: 'cc_end_endless_run',
      ended: true,
      run_id: run.id,
      depth_reached: run.depth_reached,
      payout,
      profile: this.snapshot(p),
      run: this.endlessRunView(run),
    };
    this.ledger.set(nonceKey, result);
    return result;
  }

  async getActiveEndlessRun(playerId: string): Promise<EndlessRunRow | null> {
    const run = this.endlessRuns.find((r) => r.user_id === playerId && r.status === 'active');
    return run ? this.endlessRunView(run) : null;
  }

  async getEndlessFacts(playerId: string, dayStartIso: string): Promise<EndlessFacts> {
    const ended = this.endlessRuns
      .filter((r) => r.user_id === playerId && r.status !== 'active')
      .sort((a, b) => (b.ended_at ?? '').localeCompare(a.ended_at ?? ''));
    const dayStartMs = Date.parse(dayStartIso);
    return {
      bestDepth: ended.reduce((max, r) => Math.max(max, r.depth_reached), 0),
      runsStartedToday: this.endlessStartLog.filter(
        (e) => e.playerId === playerId && e.atMs >= dayStartMs,
      ).length,
      recentRuns: ended.slice(0, 10).map((r) => this.endlessRunView(r)),
    };
  }

  async getDeathRecord(playerId: string): Promise<DeathRecord | null> {
    const p = this.profiles.get(playerId);
    if (!p) return null;
    return deathRecordFromJson(p.death_state);
  }

  /** cc_record_death (0013): first death wins; log prepends, cap 20. */
  async recordDeath(playerId: string, death: DeathRecord): Promise<{ recorded: boolean; death: DeathRecord }> {
    const p = this.requireProfile(playerId);
    const existing = deathRecordFromJson(p.death_state);
    if (existing) return { recorded: false, death: existing };
    const record: DeathRecord = {
      diedAtMs: Math.trunc(death.diedAtMs),
      areaId: death.areaId,
      monsterId: death.monsterId,
      monsterName: death.monsterName,
    };
    p.death_state = { ...record };
    p.death_log = [
      { monsterId: record.monsterId, monsterName: record.monsterName, areaId: record.areaId, at: record.diedAtMs },
      ...p.death_log,
    ].slice(0, 20);
    return { recorded: true, death: record };
  }

  /**
   * cc_record_roaming_events (0023): telemetry rows for a claim's
   * fired events + elite kills. Mirrors the SQL trigger's elite
   * branch: combat.elite_kills mastery at 100 XP per kill.
   */
  async recordRoamingEvents(
    playerId: string,
    input: {
      events: Array<{ eventId: string; family: string }>;
      eliteKills: number;
      areaId: string;
      tickCount: number;
    },
  ): Promise<Json> {
    this.requireProfile(playerId);
    const eliteKills = Math.max(0, Math.trunc(input.eliteKills));
    this.roamingEventLog.push({
      playerId,
      events: input.events.map((e) => ({ ...e })),
      eliteKills,
      areaId: input.areaId,
      tickCount: Math.trunc(input.tickCount),
    });
    // 0042: contracts stat mirror (events fired + elite kills).
    this.addContractStat(playerId, 'roaming.events_fired', input.events.length);
    this.addContractStat(playerId, 'combat.elite_kills', eliteKills);
    if (eliteKills > 0) this.addMasteryXp(playerId, 'combat.elite_kills', eliteKills * 100);
    return {
      recorded_event_rows: input.events.length > 0 ? 1 : 0,
      recorded_elite_rows: eliteKills > 0 ? 1 : 0,
      event_count: input.events.length,
      elite_kills: eliteKills,
    } as Json;
  }

  private discoveryRows: Array<DiscoveryRecord & { user_id: string; discovered_at: string }> = [];

  /**
   * cc_record_discoveries (0026): the in-memory twin — insert-on-
   * conflict-do-nothing against (player, family, entry). Test-visible
   * via discoveriesFor().
   */
  async recordDiscoveries(playerId: string, entries: DiscoveryRecord[]): Promise<Json> {
    this.requireProfile(playerId);
    let recorded = 0;
    for (const entry of entries ?? []) {
      if (!entry?.family || !entry?.entry_key) continue;
      const exists = this.discoveryRows.some(
        (r) => r.user_id === playerId && r.family === entry.family && r.entry_key === entry.entry_key,
      );
      if (exists) continue;
      this.discoveryRows.push({
        user_id: playerId,
        family: entry.family,
        entry_key: entry.entry_key,
        source: entry.source || 'unknown',
        discovered_at: new Date().toISOString(),
      });
      recorded += 1;
    }
    return { recorded } as Json;
  }

  /** Test/read accessor: this player's recorded discovery rows. */
  discoveriesFor(playerId: string): Array<DiscoveryRecord & { discovered_at: string }> {
    return this.discoveryRows
      .filter((r) => r.user_id === playerId)
      .map(({ family, entry_key, source, discovered_at }) => ({ family, entry_key, source, discovered_at }));
  }

  /**
   * cc_resurrect (0013): nonce-idempotent via the ledger; the free
   * path validates against this store's clock and the recorded death;
   * the paid path charges the route-derived cost atomically with
   * clearing the death state. Validation failures return the SQL
   * function's { resurrected: false, reason } payloads and write no
   * ledger row, so the nonce stays reusable.
   */
  async resurrect(playerId: string, input: ResurrectInput): Promise<Json> {
    if (!input.nonce || input.nonce.trim().length < 8) {
      throw new GameplayStoreError('nonce is required (min 8 chars)');
    }
    if (input.method !== 'free' && input.method !== 'paid') {
      throw new GameplayStoreError("method must be 'free' or 'paid'");
    }
    const nonceKey = `${playerId}:resurrect:${input.nonce}`;
    const prior = this.ledger.get(nonceKey);
    if (prior) return { ...(prior as Record<string, unknown>), idempotent_replay: true };

    const p = this.requireProfile(playerId);
    const death = deathRecordFromJson(p.death_state);
    if (!death) return { resurrected: false, reason: 'no_death_recorded' };

    let cost = 0;
    if (input.method === 'free') {
      const freeReadyAtMs = death.diedAtMs + Math.max(0, Math.trunc(input.freeTimerMs));
      if (this.now().getTime() < freeReadyAtMs) {
        return {
          resurrected: false,
          reason: 'free_not_ready',
          diedAtMs: death.diedAtMs,
          freeReadyAtMs,
        };
      }
    } else {
      cost = Math.max(0, Math.trunc(input.paidCost));
      if (p.credits < cost) {
        return { resurrected: false, reason: 'insufficient_credits', cost, credits: p.credits };
      }
    }

    p.credits -= cost;
    p.death_state = {};
    const result: Json = {
      resurrected: true,
      method: input.method,
      creditsCharged: cost,
      death: { monsterId: death.monsterId, monsterName: death.monsterName, areaId: death.areaId, at: death.diedAtMs },
      deathLog: p.death_log.map((entry) => ({ ...entry })),
      profile: this.snapshot(p),
    };
    this.ledger.set(nonceKey, result);
    return result;
  }

  async countBossVictoriesToday(playerId: string, bossId: string, dayStartIso: string): Promise<number> {
    const dayStartMs = Date.parse(dayStartIso);
    return this.bossVictoryLog.filter(
      (entry) => entry.playerId === playerId && entry.bossId === bossId && entry.atMs >= dayStartMs,
    ).length;
  }

  async settleOfflineRoaming(playerId: string, settlementNonce: string, rewards: ChefRewardsInput, consumedConsumables?: Json, capHours?: number): Promise<Json> {
    if (!settlementNonce || settlementNonce.trim().length < 8) {
      throw new GameplayStoreError('settlement_nonce is required (min 8 chars)');
    }
    const nonceKey = `${playerId}:offline_settle:${settlementNonce}`;
    const prior = this.ledger.get(nonceKey);
    if (prior) return prior;

    const p = this.requireProfile(playerId);
    const action = this.activeActions.get(playerId);
    if (!action || action.active_action !== 'roaming_loot') {
      return { settled: false, reason: 'not_roaming', active_action: action?.active_action ?? 'none' };
    }
    const settleFrom = p.last_roaming_settled_at ?? action.started_at;
    if (!settleFrom) {
      return { settled: false, reason: 'no_elapsed', detail: 'No settlement start timestamp available' };
    }
    const nowTs = this.now();
    const rawElapsedMs = Math.max(0, nowTs.getTime() - new Date(settleFrom).getTime());
    // 0015 mirror, limiter semantics (0023 era): the route's cap —
    // min(earned, the player's stored limiter, 24h ceiling) computed
    // by effectiveOfflineCapHours — always wins; the stored
    // offline_cap_hours read here is only the legacy fallback for
    // callers that pass no cap.
    const effectiveCapHours = capHours ?? p.offline_cap_hours ?? 2;
    const capMs = Math.floor(Math.max(0.25, effectiveCapHours) * 3_600_000);
    const capReached = rawElapsedMs > capMs;
    const elapsedMs = Math.min(rawElapsedMs, capMs);
    const ticksRequested = Math.floor(elapsedMs / TICK_MS);
    if (ticksRequested <= 0) {
      return { settled: false, reason: 'no_elapsed', elapsed_ms: elapsedMs };
    }

    const newTickCount = p.last_claimed_tick + ticksRequested;
    const echo = this.applyRewardBundle(p, rewards);
    // 0034: lifetime kill record (cc_record_kill_stats on the settled path).
    this.recordKillStats(playerId, rewards.kills);
    // 0042: contracts stat mirror (the SQL trigger's offline branch).
    this.addContractStat(playerId, 'combat.roaming_kills', rewards.kills);
    this.addContractStat(playerId, 'combat.idle_xp_claimed', rewards.xp);

    // 0012: apply the engine's consumed set in the same settlement —
    // clamped to owned counts, with consumable_events rows, mirroring
    // cc_consume_roaming_consumables (the foreground write path).
    const appliedConsumables: Record<string, number> = {};
    if (consumedConsumables) {
      const nextConsumables = { ...p.consumables };
      for (const [itemKey, rawQty] of Object.entries(asRecord(consumedConsumables))) {
        if (rawQty <= 0) continue;
        const applied = Math.min(rawQty, Math.max(0, Math.trunc(nextConsumables[itemKey] ?? 0)));
        if (applied <= 0) continue;
        nextConsumables[itemKey] = Math.trunc(nextConsumables[itemKey] ?? 0) - applied;
        appliedConsumables[itemKey] = applied;
        this.consumableEvents.push({
          user_id: playerId,
          consumable_type: itemKey,
          quantity_delta: -applied,
          event_type: 'used',
          activity_type: 'roaming_loot',
          reason: `Consumed during offline settlement in ${action.target_id ?? ''}`,
        });
      }
      p.consumables = nextConsumables;
      // 0042: contracts stat mirror (consumables.used, offline shape).
      this.addContractStat(playerId, 'consumables.used',
        Object.values(appliedConsumables).reduce((n, q) => n + q, 0));
    }

    p.last_claimed_tick = newTickCount;
    p.last_roaming_settled_at = nowTs.toISOString();
    p.last_settlement_nonce = settlementNonce;

    action.last_heartbeat_at = nowTs.toISOString();
    action.activity_payload = {
      ...action.activity_payload,
      last_offline_settle_at: nowTs.getTime(),
      last_offline_settle_ticks: ticksRequested,
    };

    const result: Json = {
      settled: true,
      atomic: true,
      area_id: action.target_id,
      settle_from: new Date(settleFrom).toISOString(),
      settled_at: nowTs.toISOString(),
      raw_elapsed_ms: rawElapsedMs,
      elapsed_ms: elapsedMs,
      capped_ms: capMs,
      cap_reached: capReached,
      cap_hours: effectiveCapHours,
      ticks_requested: ticksRequested,
      ticks_settled: ticksRequested,
      new_tick_count: newTickCount,
      start_tick: newTickCount - ticksRequested,
      end_tick: newTickCount,
      profile: this.snapshot(p),
      rewards: { ...echo, ticks: ticksRequested },
      consumed_consumables: appliedConsumables,
    };
    this.ledger.set(nonceKey, result);
    // 0014: mirror the trigger's cc_settle_offline_roaming branch —
    // same roaming grants for the settled area, and the settlement's
    // applied (clamped) consumed set feeds consumable mastery.
    this.grantRoamingMastery(playerId, action.target_id, rewards.xp);
    this.grantConsumedMastery(playerId, appliedConsumables);
    return result;
  }

  async recycleItem(playerId: string, nonce: string, itemId: string): Promise<Json> {
    if (!nonce || nonce.trim().length < 8) {
      throw new GameplayStoreError('nonce is required');
    }
    const prior = this.ledger.get(nonce);
    if (prior) return prior;
    const p = this.profiles.get(playerId);
    const item = this.items.get(itemId);
    if (!p || !item || item.owner_user_id !== playerId) {
      throw new GameplayStoreError('Item not found');
    }
    if (item.is_locked) throw new GameplayStoreError('Locked item');
    if (!['available', 'equipped'].includes(item.runtime_state)) {
      throw new GameplayStoreError('Item state invalid');
    }
    // Market Crash (legendary): 4x scrap when recycling this weapon —
    // mirrors cc_recycle_item as amended by 0008_legendary_honesty.sql.
    const baseAward = salvageScrap(item.rarity ?? '', item.item_level);
    const payload = (item.payload ?? {}) as { legendaryEffectId?: string };
    const crashedAward = payload.legendaryEffectId === 'market_crash' ? baseAward * 4 : baseAward;
    // Salvage skill bonuses (Phase 2d; migration 0022 mirrors this in
    // cc_recycle_item): Hoarder's Instinct bonus scrap, King of Scrap
    // low-rarity multiplier + bonus material from Commons. Derived
    // from the player's own records through computeSkillBonuses.
    const spends: Record<string, number> = {};
    for (const [k, v] of Object.entries((p.skill_spends ?? {}) as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) spends[k] = v;
    }
    const bonuses = computeSkillBonuses(spends, this.classModBoostsFor(playerId));
    const needsMaterialRoll = item.rarity === 'Common' && (bonuses.commonMaterialChance || 0) > 0;
    const { award, bonusMaterial } = applySalvageSkillBonuses({
      baseAward: crashedAward,
      rarity: item.rarity ?? '',
      kind: item.kind,
      bonuses,
      materialRoll: needsMaterialRoll ? Math.random() : 1,
    });
    if (bonusMaterial) {
      p.materials[bonusMaterial] = (p.materials[bonusMaterial] ?? 0) + 1;
    }
    // Legendary cores (0026): minted by the same formula as the SQL
    // twin (src/content/collections.ts), NOT scaled by the scrap
    // bonuses above (Market Crash 4x included).
    const cores = legendaryCoreYieldFor({
      rarity: item.rarity,
      item_level: item.item_level,
      kind: item.kind,
      payload: (item.payload ?? {}) as Record<string, unknown>,
    });
    item.runtime_state = 'consumed';
    item.tradeable = false;
    item.equipped_slot = null;
    p.scrap += award;
    // 0042: contracts stat mirror (salvages).
    this.addContractStat(playerId, 'inventory.recycle.count', 1);
    p.legendary_cores = (p.legendary_cores ?? 0) + cores;
    const result: Json = {
      action_type: 'cc_recycle_item',
      profile: this.snapshot(p),
      item: {
        id: item.id,
        owner_user_id: item.owner_user_id,
        kind: item.kind,
        runtime_state: item.runtime_state,
        is_locked: item.is_locked,
        rarity: item.rarity,
        item_level: item.item_level,
        payload: item.payload,
      },
      scrap_award: award,
      cores_award: cores,
      bonus_material: bonusMaterial,
      loadout: null,
    };
    this.ledger.set(nonce, result);
    return result;
  }

  /**
   * The player's equipped class mod boosts, from their own item
   * records — mirrors classModBoostsFromGear's predicate (the
   * equipped gear whose payload carries treeBonus) over raw payloads.
   */
  private classModBoostsFor(playerId: string): ClassModBoosts {
    for (const item of this.items.values()) {
      if (item.owner_user_id !== playerId || item.runtime_state !== 'equipped') continue;
      const payload = (item.payload ?? {}) as Record<string, unknown>;
      if (!('treeBonus' in payload)) continue;
      const nodeBoosts = (payload.nodeBoosts ?? {}) as Record<string, number>;
      return {
        treeBonus: typeof payload.treeBonus === 'string' ? payload.treeBonus : undefined,
        nodeBoosts: { ...nodeBoosts },
      };
    }
    return { nodeBoosts: {} };
  }
}
