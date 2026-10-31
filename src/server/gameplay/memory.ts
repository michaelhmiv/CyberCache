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
import type { ConsumableBatchRow } from '../../lib/consumables/batchProfile';
import {
  settleCraftJobs as settleCraftJobsCore,
  type CraftAdapter,
  type CraftJobRecord,
  type CraftProfileView,
  type WorkshopToolsState,
} from '../writes/craftEngine';
import {
  CRAFT_XP_RATE_DEFAULT,
  CRAFT_TIME_SCALAR_DEFAULT,
  CRAFT_QUALITY_SHIFT_DEFAULT,
  GEAR_TEMPER_BASE_CHANCE_DEFAULT,
  REFINE_BASE_YIELD_DEFAULT,
} from '../../content/crafting';
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

  constructor(private readonly now: () => Date = () => new Date()) {}

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
      materials: { ...p.materials },
      essences: { ...p.essences },
      consumables: { ...p.consumables },
      consumable_batches: [],
      vehicle_fuel: p.vehicle_fuel,
      skill_spends: p.skill_spends,
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
    return { player_level: p.player_level, skill_spends: JSON.parse(JSON.stringify(p.skill_spends)) as Json, last_claimed_tick: p.last_claimed_tick, consumables: { ...p.consumables }, scrap_remainder: p.scrap_remainder, credits_remainder: p.credits_remainder, xp_remainder: p.xp_remainder, vehicle_fuel: p.vehicle_fuel };
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
    };
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
    };
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
    profile.player_level = view.player_level;
    profile.player_xp = view.player_xp;
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

  async getEquippedItems(playerId: string): Promise<EquippedItemEntry[]> {
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
    for (const [itemKey, rawQty] of Object.entries(asRecord(consumed))) {
      if (rawQty <= 0) continue;
      const applied = Math.min(rawQty, Math.max(0, Math.trunc(next[itemKey] ?? 0)));
      if (applied <= 0) continue;
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
    p.consumables = next;
    return { consumables: { ...next } };
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

    const leveled = applyXp(p.player_level, p.player_xp, Math.max(0, Math.trunc(attempt.xp)));
    p.player_level = leveled.player_level;
    p.player_xp = leveled.player_xp;

    const nextConsumables = { ...p.consumables };
    for (const [itemKey, rawQty] of Object.entries(asRecord(attempt.consumables))) {
      const current = Math.trunc(nextConsumables[itemKey] ?? 0);
      if (current < rawQty) {
        throw new GameplayStoreError(`Insufficient consumable quantity for ${itemKey}`);
      }
      nextConsumables[itemKey] = Math.max(0, current - rawQty);
    }
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
    };
    this.ledger.set(nonceKey, result);
    if (attempt.victory) {
      this.bossVictoryLog.push({ playerId, bossId: attempt.bossId, atMs: this.now().getTime() });
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
    }
    run.status = status;
    run.ended_at = this.now().toISOString();
    run.paid_credits = paid.credits;
    run.paid_xp = paid.xp;
    run.paid_scrap = paid.scrap;
    run.payout_fraction = frac;
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
