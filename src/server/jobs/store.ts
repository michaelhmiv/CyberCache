/**
 * JobStore: the Route B background-job surface (slice B5).
 *
 * Two implementations behind one seam, same pattern as B2/B3:
 *  - PgJobStore runs the SQL job functions landed in
 *    db/migrations/0006_jobs.sql (the pg_cron replacements) and the
 *    direct table work for push delivery.
 *  - InMemoryJobStore mirrors the same observable semantics for tests.
 *
 * Jobs take NO player identity: cron jobs are global maintenance, and
 * push delivery is scoped by the caller's JWT at the route layer
 * before it reaches here. Every job is idempotent — see 0006_jobs.sql.
 *
 * There is deliberately NO NPC market seeding here anymore (owner
 * ruling, 2026-11-04): the Buy/Sell lanes are the pure player market,
 * so nothing in the job surface creates marketplace listings. The
 * seed job, its item generation, and both seed routes were removed;
 * migration 0081 retired the seeded rows that were still live.
 */
import type { Pool } from 'pg';
import type { Json } from '../writes/store';

export type JobErrorCode = 'unauthorized' | 'validation' | 'not_found' | 'internal';

export class JobStoreError extends Error {
  readonly code: JobErrorCode;
  constructor(code: JobErrorCode, message: string) {
    super(message);
    this.name = 'JobStoreError';
    this.code = code;
  }
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
