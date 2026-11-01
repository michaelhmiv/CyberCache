/**
 * CyberCache Server — Express + Chef Worker
 *
 * Single Railway service that:
 *   1. Serves the built React app (static files)
 *   2. Runs the Chef worker — the authoritative engine for gameplay logic.
 * Item generation lives in src/server/lib/generators and is no longer
 * reachable from the browser bundle.
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { mountActionSkillRoutes, mountCacheRankRoutes, mountChefHealthRoute, mountContractsRoutes, mountDispatchRoutes, mountExtractionRoutes, mountGameplayRoutes, mountLoginStreakRoutes, mountResearchRoutes } from './gameplay/routes';
import { PgChefGameplayStore } from './gameplay/store';
import { mountMarketSeedRoutes } from './routes/marketSeedRoute';
import { mountAuthRoutes } from './auth/routes';
import { PgAuthStore } from './auth/store';
import { mountReadRoutes } from './reads/routes';
import { PgReadStore } from './reads/store';
import { mountWriteRoutes } from './writes/routes';
import { PgWriteStore } from './writes/store';
import { mountJobRoutes } from './jobs/routes';
import { PgJobStore } from './jobs/store';
import { PgLeaderboardStore } from './leaderboards/store';
import { PgEconomyStore } from './economy/store';
import { EconomyConfig } from './economy/config';
import { fcmSenderFromEnv } from './jobs/fcm';

const PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = path.resolve(__dirname, '../../dist');

const NATIVE_API_ORIGINS = new Set([
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]);

function isAllowedApiOrigin(origin?: string): boolean {
  if (!origin) return false;
  if (NATIVE_API_ORIGINS.has(origin)) return true;
  // Hosted browser builds are same-origin, but keeping the production host in
  // this allow-list makes API smoke tests and future custom-domain moves safe.
  return /^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i.test(origin);
}

function apiCors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && isAllowedApiOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

const app = express();
app.use('/api', apiCors);
app.use(express.json({ limit: '1mb' }));

// Chef API — authoritative gameplay engine. The health route answers on
// every boot; the gameplay routes mount below with the rest of Route B.
mountChefHealthRoute(app);

// Market seeding — server-side NPC listings. Mounted below with the
// Postgres JobStore (Route B boots only, since B6 removed the legacy
// Supabase data path).

// Route B identity (slice B1) — Chef-issued auth on Railway Postgres.
// All Route B surfaces mount only when both the database and the JWT
// secret are configured. Token issuance fails closed: no secret, no
// auth routes; no database, no gameplay routes.
const chefJwtSecret = process.env.CHEF_JWT_SECRET;
const databaseUrl = process.env.DATABASE_URL;
const chefJobSecret = process.env.CHEF_JOB_SECRET;
if (chefJwtSecret && databaseUrl) {
  // Lazy import keeps `pg` out of the boot path until Route B is configured.
  void import('pg')
    .then(({ Pool }) => {
      const pool = new Pool({ connectionString: databaseUrl });
      const googleClientIds = (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? '')
        .split(',').map((v) => v.trim()).filter(Boolean);
      mountAuthRoutes(app, new PgAuthStore(pool), { jwtSecret: chefJwtSecret, googleClientIds });
      console.log('[chef-auth] /api/auth/* mounted (Route B identity)');
      // Route B read APIs (slice B2) — same gate as identity: they are
      // useless without Chef JWTs to authenticate them.
      mountReadRoutes(app, new PgReadStore(pool), { jwtSecret: chefJwtSecret });
      console.log('[chef-reads] read APIs mounted (Route B B2)');
      // Route B write APIs (slice B3) — same gate: every mutation derives
      // its actor from the Chef JWT and lands in the cc_* write functions.
      const writeStore = new PgWriteStore(pool);
      mountWriteRoutes(app, writeStore, { jwtSecret: chefJwtSecret });
      console.log('[chef-writes] write APIs mounted (Route B B3)');
      // Economy observability (0018): one store + one lever accessor,
      // shared by the gameplay routes (lever consumers) and the job
      // routes (heartbeat meters + job-secret admin surface).
      const economyStore = new PgEconomyStore(pool);
      const economyConfig = new EconomyConfig(economyStore);
      // Route B cutover (slice B6) — the legacy Chef gameplay routes
      // (/api/claim, /api/settle-offline, /api/verify-boss, /api/salvage)
      // on Chef JWT auth + the Postgres gameplay store. With this mount
      // the Chef has no Supabase dependency left.
      const gameplayStore = new PgChefGameplayStore(pool);
      mountGameplayRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      // Action skill routes (0030): state/selection on the gameplay
      // store, the Overclock workshop fire on the write store.
      mountActionSkillRoutes(app, gameplayStore, writeStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      // Cache Rank routes (0031): state read (observe-and-grant) +
      // spend on the gameplay store.
      mountCacheRankRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      // Dispatch routes (0032): timed contracts for spare loadouts
      // and spare vehicles, on the gameplay store.
      mountDispatchRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      // Extraction routes (0033): settle-then-read state surface for
      // the gathering occupation, on the gameplay store.
      mountExtractionRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      // Login streak routes (0036): the daily check-in
      // (observe-and-record) on the gameplay store.
      mountLoginStreakRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      // Contracts board routes (0042): board read
      // (issue-on-first-read) + claim/reroll on the gameplay store.
      mountContractsRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      // Research routes (0038): the parallel education track —
      // state read + enroll/cancel on the gameplay store.
      mountResearchRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      // Route B background jobs (slice B5) — pg_cron replacements +
      // Edge Function test-push port. Job routes mount only when
      // CHEF_JOB_SECRET is set (fail closed); the NPC seed route gets
      // the Postgres store here.
      const jobStore = new PgJobStore(pool);
      mountJobRoutes(app, jobStore, {
        jwtSecret: chefJwtSecret,
        jobSecret: chefJobSecret,
        fcmSender: fcmSenderFromEnv(),
        economyStore,
        economyConfig,
        // Weekly leaderboard settlement (0035) rides the heartbeat.
        leaderboardStore: new PgLeaderboardStore(pool),
      });
      console.log(
        chefJobSecret
          ? '[chef-jobs] job routes + push test mounted (Route B B5)'
          : '[chef-jobs] push test mounted; job routes disabled (CHEF_JOB_SECRET not set)',
      );
      mountMarketSeedRoutes(app, jobStore);
    })
    .catch((err) => console.error('[chef-auth] failed to initialize pg pool', err));
} else {
  console.log('[chef-auth] disabled (CHEF_JWT_SECRET / DATABASE_URL not both set)');
  console.log('[chef] gameplay + market seed routes disabled (Route B not configured)');
}

// Static files — the React SPA
app.use(express.static(DIST_DIR));

// SPA fallback — all non-API routes serve index.html
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[cybercache] server running on port ${PORT}`);
  console.log(`[cybercache] chef worker mounted at /api/claim`);
});
