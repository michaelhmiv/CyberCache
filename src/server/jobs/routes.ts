/**
 * Chef background-job routes (Route B, slice B5).
 *
 * Replacements for the June background surface:
 *   POST /api/jobs/daily-heartbeat    pg_cron 'cybercache-daily-heartbeat' (0 6 * * *)
 *                                     → cc_record_daily_heartbeats()
 *   POST /api/jobs/prune-snapshots    pg_cron 'cybercache-prune-snapshots' (0 7 * * 0)
 *                                     → cc_prune_progression_snapshots()
 *   POST /api/jobs/seed-npc-market    NPC marketplace cold-start seeding
 *                                     (was: Supabase-backed /api/market/seed only)
 *   POST /api/push/test               Supabase Edge Function 'send-test-push'
 *                                     → FCM via src/server/jobs/fcm.ts
 *   GET  /api/admin/economy           economy metrics report + levers (0018)
 *   POST /api/admin/economy/config    move one economy lever (0018)
 *                                     Both behind the same job secret.
 *
 * Auth model (hard rules):
 *  - /api/jobs/* are machine callers (Railway cron at B6). They require
 *    the shared job secret in the `x-chef-job-secret` header, compared
 *    in constant time. No player JWT is accepted here, and no identity
 *    or economy input is read from the request body beyond the seed's
 *    count/level knobs (clamped to the June ranges).
 *  - /api/push/test is a player route: identity comes ONLY from the
 *    verified Chef JWT (chefPlayerId), exactly like B2/B3 routes. It
 *    sends to the caller's own registered devices, as the Edge Function
 *    did with the caller's Supabase JWT.
 *  - When CHEF_JOB_SECRET is unset the job routes are not mounted at
 *    all (fail closed, same posture as the B1 auth gate). When
 *    FIREBASE_ADMIN_JSON is unset the push route answers 503
 *    push_not_configured and sends/logs nothing.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { chefPlayerId, type AuthConfig } from '../auth/routes';
import { NPC_MARKET_USER_ID } from '../lib/npcMarket';
import type { JobStore } from './store';
import { cleanPushText, type FcmSender } from './fcm';
import { buildNpcSeedItems, clampSeedCount, clampSeedLevel } from './npcItems';
import {
  ECONOMY_CONFIG_DEFAULTS,
  isEconomyConfigKey,
  resolveEconomyConfigValues,
  validateEconomyConfigValue,
  type EconomyConfig,
} from '../economy/config';
import type { EconomyStore } from '../economy/store';

export interface JobRoutesConfig extends AuthConfig {
  /** CHEF_JOB_SECRET; when empty the /api/jobs/* routes are not mounted. */
  jobSecret?: string;
  /** NPC seller account for market seeding (NPC_MARKET_USER_ID). */
  npcUserId?: string;
  /** FCM sender; null = push not configured on this instance. */
  fcmSender?: FcmSender | null;
  /** Economy observability store (0018); absent = admin routes unmounted. */
  economyStore?: EconomyStore;
  /** Live lever accessor shared with the gameplay routes (0018). */
  economyConfig?: EconomyConfig;
}

/** UTC day (YYYY-MM-DD) `offsetDays` before today. */
function utcDay(offsetDays: number): string {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - offsetDays);
  return day.toISOString().slice(0, 10);
}

function unauthorized(res: Response): void {
  res.status(401).json({ error: 'unauthorized', message: 'A valid job secret is required' });
}

function fail(res: Response, err: unknown): void {
  console.error('[chef-jobs] unexpected error', err);
  res.status(500).json({ error: 'internal', message: 'Something went wrong' });
}

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type Body = Record<string, unknown>;

function body(req: Request): Body {
  return (req.body ?? {}) as Body;
}

export function mountJobRoutes(app: Express, store: JobStore, config: JobRoutesConfig): void {
  const jobSecret = config.jobSecret ?? '';
  const npcUserId = config.npcUserId ?? NPC_MARKET_USER_ID;

  if (jobSecret) {
    const job = (path: string, run: (req: Request) => Promise<Record<string, unknown>>) => {
      app.post(path, async (req, res) => {
        const provided = req.headers['x-chef-job-secret'];
        if (!secretMatches(typeof provided === 'string' ? provided : undefined, jobSecret)) {
          unauthorized(res);
          return;
        }
        try {
          res.json({ ok: true, ...(await run(req)) });
        } catch (err) {
          fail(res, err);
        }
      });
    };

    job('/api/jobs/daily-heartbeat', async () => {
      const { recorded } = await store.recordDailyHeartbeats();
      // Economy meters (0018): recompute yesterday (UTC) plus the six
      // days before it — a full recompute per day, so re-running the
      // heartbeat is idempotent and any missed day self-heals within
      // the week. A metrics failure must not fail the heartbeat's
      // snapshots: it is reported in the response instead.
      let economyMetrics: Record<string, unknown> | null = null;
      if (config.economyStore) {
        try {
          const days: string[] = [];
          for (let offset = 7; offset >= 1; offset -= 1) {
            days.push((await config.economyStore.computeMetricsForDay(utcDay(offset))).day);
          }
          economyMetrics = { computedDays: days };
        } catch (err) {
          console.error('[chef-jobs] economy metrics compute failed', err);
          economyMetrics = { error: 'metrics_compute_failed' };
        }
      }
      return { job: 'daily-heartbeat', recorded, economyMetrics };
    });

    // --- Economy admin (0018) -------------------------------------
    // Operator surface only: same job-secret gate as /api/jobs/*,
    // never player-visible, no client UI. GET pulls the metrics
    // report + effective levers; POST moves one lever (validated,
    // history-logged in the store, cache invalidated so the writer
    // sees it take effect).
    if (config.economyStore) {
      const economyStore = config.economyStore;
      app.get('/api/admin/economy', async (req, res) => {
        const provided = req.headers['x-chef-job-secret'];
        if (!secretMatches(typeof provided === 'string' ? provided : undefined, jobSecret)) {
          unauthorized(res);
          return;
        }
        try {
          const rawDays = Number(req.query.days);
          const days = Number.isFinite(rawDays)
            ? Math.max(1, Math.min(90, Math.trunc(rawDays)))
            : 14;
          const [metrics, stored] = await Promise.all([
            economyStore.listMetrics(days),
            economyStore.loadConfigValues(),
          ]);
          res.json({
            ok: true,
            metrics,
            config: resolveEconomyConfigValues(stored),
            defaults: ECONOMY_CONFIG_DEFAULTS,
          });
        } catch (err) {
          fail(res, err);
        }
      });

      app.post('/api/admin/economy/config', async (req, res) => {
        const provided = req.headers['x-chef-job-secret'];
        if (!secretMatches(typeof provided === 'string' ? provided : undefined, jobSecret)) {
          unauthorized(res);
          return;
        }
        const { key, value } = body(req);
        if (typeof key !== 'string' || !isEconomyConfigKey(key)) {
          res.status(400).json({ error: 'unknown_key', message: `Unknown economy config key: ${String(key)}` });
          return;
        }
        const validated = validateEconomyConfigValue(key, value);
        if (validated === null) {
          res.status(400).json({
            error: 'invalid_value',
            message: `Value for ${key} is out of range or the wrong type`,
          });
          return;
        }
        try {
          await economyStore.setConfigValue(key, validated, 'admin-api');
          config.economyConfig?.invalidate();
          const stored = await economyStore.loadConfigValues();
          res.json({ ok: true, key, value: validated, config: resolveEconomyConfigValues(stored) });
        } catch (err) {
          fail(res, err);
        }
      });
    }

    job('/api/jobs/prune-snapshots', async () => {
      const { pruned } = await store.pruneProgressionSnapshots();
      return { job: 'prune-snapshots', pruned };
    });

    job('/api/jobs/seed-npc-market', async (req) => {
      const count = clampSeedCount(body(req).count);
      const level = clampSeedLevel(body(req).level);
      const { seeded } = await store.seedNpcMarket(npcUserId, buildNpcSeedItems(count, level));
      return { job: 'seed-npc-market', seeded, level };
    });
  }

  // Test push — the Edge Function port. Player route (Chef JWT), sends a
  // system push to the caller's own active devices via FCM and records a
  // notification_events row per device, exactly as the function did.
  app.post('/api/push/test', async (req, res) => {
    const playerId = chefPlayerId(config, req);
    if (!playerId) {
      res.status(401).json({ error: 'unauthorized', message: 'A valid Chef access token is required' });
      return;
    }
    const sender = config.fcmSender ?? null;
    if (!sender) {
      res.status(503).json({
        error: 'push_not_configured',
        message: 'Push delivery is not configured on this Chef instance',
      });
      return;
    }
    try {
      const title = cleanPushText(body(req).title, 'CyberCache test push', 80);
      const message = cleanPushText(body(req).message, 'Push delivery is wired.', 180);
      const tokens = await store.listActivePushTokens(playerId);
      if (tokens.length === 0) {
        res.status(404).json({ ok: false, sent: 0, failed: 0, error: 'no_active_push_tokens' });
        return;
      }
      let sent = 0;
      let failed = 0;
      const failures: Array<{ tokenSuffix: string; error: string }> = [];
      for (const token of tokens) {
        const result = await sender.sendToDevice(token, title, message);
        if (result.ok) {
          sent += 1;
          await store.recordNotificationEvent({
            user_id: playerId,
            category: 'system',
            title,
            body: message,
            payload: { token_suffix: token.slice(-8), result: result.response ?? null },
            status: 'sent',
            sent_at: new Date().toISOString(),
          });
        } else {
          failed += 1;
          failures.push({ tokenSuffix: token.slice(-8), error: result.error ?? 'send_failed' });
          await store.recordNotificationEvent({
            user_id: playerId,
            category: 'system',
            title,
            body: message,
            payload: { token_suffix: token.slice(-8), result: { error: result.error ?? 'send_failed' } },
            status: 'failed',
            sent_at: null,
          });
        }
      }
      res.json({ ok: sent > 0, sent, failed, failures });
    } catch (err) {
      fail(res, err);
    }
  });
}
