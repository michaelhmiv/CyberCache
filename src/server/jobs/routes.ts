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
import { NPC_MARKET_USER_ID } from '../lib/supabaseService';
import type { JobStore } from './store';
import { cleanPushText, type FcmSender } from './fcm';
import { buildNpcSeedItems, clampSeedCount, clampSeedLevel } from './npcItems';

export interface JobRoutesConfig extends AuthConfig {
  /** CHEF_JOB_SECRET; when empty the /api/jobs/* routes are not mounted. */
  jobSecret?: string;
  /** NPC seller account for market seeding (NPC_MARKET_USER_ID). */
  npcUserId?: string;
  /** FCM sender; null = push not configured on this instance. */
  fcmSender?: FcmSender | null;
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
      return { job: 'daily-heartbeat', recorded };
    });

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
