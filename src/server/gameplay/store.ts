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
}

/** profiles subset the boss handler reads. */
export interface BossProfileRow {
  player_level: number;
  credits: number;
  consumables: Json;
  boss_state: Json;
  /** Server-side skill spends — the boss route rebuilds skillBonuses from this, never from a client body (trust hardening). */
  skill_spends: Json;
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
   * The resurrection op (cc_resurrect). Returns the function's payload:
   * { resurrected: true, ... } on success (plus idempotent_replay on a
   * nonce replay) or { resurrected: false, reason, ... } on a
   * validation failure — the route maps reasons to HTTP statuses.
   */
  resurrect(playerId: string, input: ResurrectInput): Promise<Json>;
  applyChefBossAttempt(playerId: string, attempt: ChefBossAttemptInput): Promise<Json>;
  /**
   * Victories against one boss since `dayStartIso` (UTC day start),
   * counted from the verified action ledger — the source for the
   * rematch-fee escalation (src/lib/bossFees.ts). Replayed nonces never
   * double-count: the ledger holds one row per applied attempt.
   */
  countBossVictoriesToday(playerId: string, bossId: string, dayStartIso: string): Promise<number>;
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
      'select player_level, skill_spends, last_claimed_tick, consumables, scrap_remainder, credits_remainder, xp_remainder, vehicle_fuel from public.profiles where id = $1',
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
      }),
    );
  }

  getBossProfile(playerId: string): Promise<BossProfileRow | null> {
    return this.one(
      'select player_level, credits, consumables, boss_state, skill_spends from public.profiles where id = $1',
      [playerId],
      (row) => ({
        player_level: num(row.player_level),
        credits: num(row.credits),
        consumables: json(row.consumables),
        boss_state: json(row.boss_state),
        skill_spends: json(row.skill_spends),
      }),
    );
  }

  getSettlementProfile(playerId: string): Promise<SettlementProfileRow | null> {
    return this.one(
      'select player_level, skill_spends, consumables, last_claimed_tick, last_roaming_settled_at, last_settlement_nonce, offline_cap_hours, scrap_remainder, credits_remainder, xp_remainder, vehicle_fuel from public.profiles where id = $1',
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
      'select public.cc_apply_chef_boss_attempt($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as result',
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
      ],
    );
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
