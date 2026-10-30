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

export type { Json };

export class GameplayStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameplayStoreError';
  }
}

/** profiles subset the claim handler reads (June: PostgREST select). */
export interface RoamingProfileRow {
  last_claimed_tick: number;
  consumables: Json;
  /** Banked fractional scrap (migration 0009), 0 <= x < 1. */
  scrap_remainder: number;
}

/** profiles subset the boss handler reads. */
export interface BossProfileRow {
  player_level: number;
  credits: number;
  consumables: Json;
  boss_state: Json;
}

/** profiles subset the offline-settlement handler reads. */
export interface SettlementProfileRow {
  player_level: number;
  consumables: Json;
  last_claimed_tick: number;
  last_roaming_settled_at: string | null;
  last_settlement_nonce: string | null;
  offline_cap_hours: number | null;
  /** Banked fractional scrap (migration 0009), 0 <= x < 1. */
  scrap_remainder: number;
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
}

export interface ChefGameplayStore {
  getRoamingProfile(playerId: string): Promise<RoamingProfileRow | null>;
  getBossProfile(playerId: string): Promise<BossProfileRow | null>;
  getSettlementProfile(playerId: string): Promise<SettlementProfileRow | null>;
  getActiveAction(playerId: string): Promise<ActiveActionRow | null>;
  applyChefRewards(playerId: string, rewards: ChefRewardsInput, tickCount: number, areaId: string): Promise<Json>;
  storeChefItems(playerId: string, items: unknown[]): Promise<Json>;
  consumeRoamingConsumables(playerId: string, consumed: Json, areaId: string, tickCount: number): Promise<Json>;
  applyChefBossAttempt(playerId: string, attempt: ChefBossAttemptInput): Promise<Json>;
  settleOfflineRoaming(playerId: string, settlementNonce: string, rewards: ChefRewardsInput): Promise<Json>;
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
      'select last_claimed_tick, consumables, scrap_remainder from public.profiles where id = $1',
      [playerId],
      (row) => ({
        last_claimed_tick: num(row.last_claimed_tick),
        consumables: json(row.consumables),
        scrap_remainder: num(row.scrap_remainder),
      }),
    );
  }

  getBossProfile(playerId: string): Promise<BossProfileRow | null> {
    return this.one(
      'select player_level, credits, consumables, boss_state from public.profiles where id = $1',
      [playerId],
      (row) => ({
        player_level: num(row.player_level),
        credits: num(row.credits),
        consumables: json(row.consumables),
        boss_state: json(row.boss_state),
      }),
    );
  }

  getSettlementProfile(playerId: string): Promise<SettlementProfileRow | null> {
    return this.one(
      'select player_level, consumables, last_claimed_tick, last_roaming_settled_at, last_settlement_nonce, offline_cap_hours, scrap_remainder from public.profiles where id = $1',
      [playerId],
      (row) => ({
        player_level: num(row.player_level),
        consumables: json(row.consumables),
        last_claimed_tick: num(row.last_claimed_tick),
        last_roaming_settled_at: isoOrNull(row.last_roaming_settled_at),
        last_settlement_nonce:
          row.last_settlement_nonce === null || row.last_settlement_nonce === undefined
            ? null
            : String(row.last_settlement_nonce),
        offline_cap_hours: numOrNull(row.offline_cap_hours),
        scrap_remainder: num(row.scrap_remainder),
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

  applyChefRewards(playerId: string, rewards: ChefRewardsInput, tickCount: number, areaId: string): Promise<Json> {
    return this.callJson(
      'select public.cc_apply_chef_rewards($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as result',
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

  applyChefBossAttempt(playerId: string, attempt: ChefBossAttemptInput): Promise<Json> {
    return this.callJson(
      'select public.cc_apply_chef_boss_attempt($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as result',
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
      ],
    );
  }

  settleOfflineRoaming(playerId: string, settlementNonce: string, rewards: ChefRewardsInput): Promise<Json> {
    return this.callJson('select public.cc_settle_offline_roaming($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as result', [
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
    ]);
  }

  recycleItem(playerId: string, nonce: string, itemId: string): Promise<Json> {
    return this.callJson('select public.cc_recycle_item($1, $2, $3) as result', [playerId, nonce, itemId]);
  }
}
