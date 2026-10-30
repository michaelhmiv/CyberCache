/**
 * JobStore: the Route B background-job surface (slice B5).
 *
 * Two implementations behind one seam, same pattern as B2/B3:
 *  - PgJobStore runs the SQL job functions landed in
 *    db/migrations/0006_jobs.sql (the pg_cron replacements) and the
 *    direct table work for NPC market seeding and push delivery.
 *  - InMemoryJobStore mirrors the same observable semantics for tests.
 *
 * Jobs take NO player identity: cron jobs are global maintenance, the NPC
 * seed writes under the fixed NPC market account, and push delivery is
 * scoped by the caller's JWT at the route layer before it reaches here.
 * Every job is idempotent — see 0006_jobs.sql and seedNpcMarket below.
 */
import type { Pool } from 'pg';
import type { Json } from '../writes/store';
import {
  gearCategoryFromPayload,
  gearIdentityFromPayload,
} from '../../lib/market/identityKey';

export type JobErrorCode = 'unauthorized' | 'validation' | 'not_found' | 'internal';

export class JobStoreError extends Error {
  readonly code: JobErrorCode;
  constructor(code: JobErrorCode, message: string) {
    super(message);
    this.name = 'JobStoreError';
    this.code = code;
  }
}

/** One generated NPC listing, ready to persist (generation lives in TS). */
export interface NpcSeedItem {
  id: string;
  kind: string;
  item_level: number;
  rarity: string;
  payload: Json;
  price_credits: number;
}

export interface NotificationEventInput {
  user_id: string;
  category: string;
  title: string;
  body: string;
  payload: Json;
  status: 'sent' | 'failed';
  sent_at: string | null;
}

export interface JobStore {
  /** pg_cron 'cybercache-daily-heartbeat' → cc_record_daily_heartbeats(). */
  recordDailyHeartbeats(): Promise<{ recorded: number }>;
  /** pg_cron 'cybercache-prune-snapshots' → cc_prune_progression_snapshots(). */
  pruneProgressionSnapshots(): Promise<{ pruned: number }>;
  /**
   * Replace the NPC market stock: cancel the NPC account's active
   * listings, then insert the freshly generated items + listings as one
   * transaction. Running it twice leaves exactly the latest batch active
   * (the June route's semantics), so a retried cron/manual call is safe.
   */
  seedNpcMarket(npcUserId: string, items: NpcSeedItem[]): Promise<{ seeded: number }>;
  /** Active (enabled) push tokens for one player — push delivery only. */
  listActivePushTokens(playerId: string): Promise<string[]>;
  /** Append a delivery record to notification_events. */
  recordNotificationEvent(event: NotificationEventInput): Promise<void>;
}

export class PgJobStore implements JobStore {
  constructor(private readonly pool: Pool) {}

  async recordDailyHeartbeats(): Promise<{ recorded: number }> {
    const { rows } = await this.pool.query<{ recorded: number }>(
      'select public.cc_record_daily_heartbeats() as recorded',
    );
    return { recorded: Number(rows[0]?.recorded ?? 0) };
  }

  async pruneProgressionSnapshots(): Promise<{ pruned: number }> {
    const { rows } = await this.pool.query<{ pruned: number }>(
      'select public.cc_prune_progression_snapshots() as pruned',
    );
    return { pruned: Number(rows[0]?.pruned ?? 0) };
  }

  async seedNpcMarket(npcUserId: string, items: NpcSeedItem[]): Promise<{ seeded: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // The NPC seller must exist as an account + profile or the item /
      // listing inserts FK-fail on a fresh Route B database. The account
      // is a verified service account on a reserved .invalid address
      // whose stored hash is a non-scrypt sentinel — verifyPassword
      // fails closed on it and there are no provider identities, so it
      // can never sign in. The 0005 bootstrap trigger creates the
      // profile on the account insert; the explicit profile insert
      // below covers databases where it somehow did not.
      await client.query(
        `insert into public.auth_accounts (id, email, password_hash, is_guest, email_verified_at)
         values ($1, 'npc-market@cybercache.invalid', 'disabled:npc-market-service-account', false, now())
         on conflict do nothing`,
        [npcUserId],
      );
      await client.query(
        `insert into public.profiles (id) values ($1)
         on conflict (id) do nothing`,
        [npcUserId],
      );
      await client.query(
        `update public.market_listings set status = 'cancelled'
          where seller_user_id = $1 and status = 'active'`,
        [npcUserId],
      );
      for (const item of items) {
        await client.query(
          `insert into public.item_instances (
             id, owner_user_id, kind, item_level, rarity, is_locked,
             runtime_state, supply_mode, equipped_slot, payload
           ) values ($1, $2, $3, $4, $5, false, 'available', 'npc_market', null, $6::jsonb)`,
          [item.id, npcUserId, item.kind, item.item_level, item.rarity, JSON.stringify(item.payload)],
        );
        // Market depth (0019): seed listings carry the same browse
        // stamps player listings get at creation, seller_type 'npc'.
        const payload = item.payload as unknown as Record<string, unknown>;
        await client.query(
          `insert into public.market_listings (
             seller_user_id, item_instance_id, price_credits, status,
             listing_kind, quantity, identity_key, category, display_name,
             weapon_type, element, rarity, item_level, seller_type
           ) values ($1, $2, $3, 'active', 'gear', 1, $4, $5, $6, $7, $8, $9, $10, 'npc')`,
          [
            npcUserId, item.id, item.price_credits,
            gearIdentityFromPayload(payload, { kind: item.kind, rarity: item.rarity, level: item.item_level }),
            gearCategoryFromPayload(payload, item.kind),
            typeof payload.name === 'string' ? payload.name : null,
            typeof payload.weaponType === 'string' ? payload.weaponType : null,
            typeof payload.element === 'string' ? payload.element : null,
            item.rarity, item.item_level,
          ],
        );
      }
      await client.query('commit');
      return { seeded: items.length };
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async listActivePushTokens(playerId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ token: string }>(
      `select token from public.user_push_devices
        where user_id = $1 and enabled = true
        order by last_registered_at asc`,
      [playerId],
    );
    return rows.map((r) => r.token).filter(Boolean);
  }

  async recordNotificationEvent(event: NotificationEventInput): Promise<void> {
    await this.pool.query(
      `insert into public.notification_events (user_id, category, title, body, payload, status, sent_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        event.user_id,
        event.category,
        event.title,
        event.body,
        JSON.stringify(event.payload),
        event.status,
        event.sent_at,
      ],
    );
  }
}
