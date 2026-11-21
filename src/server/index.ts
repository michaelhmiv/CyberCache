/**
 * CyberCache Server — Express + Chef Worker
 *
 * Single Railway service that:
 *   1. Serves the built React app (static files) — unless SERVE_WEB_CLIENT
 *      is off, as in production: the game is app-only there and the
 *      service answers the API alone (see src/server/webClient.ts).
 *   2. Runs the Chef worker — the authoritative engine for gameplay logic.
 * Item generation lives in src/server/lib/generators and is no longer
 * reachable from the browser bundle.
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { mountActionSkillRoutes, mountCacheRankRoutes, mountChefHealthRoute, mountContractsRoutes, mountCosmeticsRoutes, mountDispatchRoutes, mountExtractionRoutes, mountGameplayRoutes, mountLoginStreakRoutes, mountResearchRoutes, mountStandingRoutes } from './gameplay/routes';
import { PgChefGameplayStore } from './gameplay/store';
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
import { isWebClientEnabled, mountWebClient } from './webClient';

const PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = path.resolve(__dirname, '../../dist');

const NATIVE_API_ORIGINS = new Set([
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]);

const DEFAULT_ALLOWED_HOST_ORIGINS = new Set([
  'https://chef-production.up.railway.app',
  'https://chef-staging.up.railway.app',
  ...(process.env.RAILWAY_PUBLIC_DOMAIN ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`] : []),
  ...(process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
]);

function isAllowedApiOrigin(origin?: string): boolean {
  if (!origin) return false;
  if (NATIVE_API_ORIGINS.has(origin)) return true;
  if (DEFAULT_ALLOWED_HOST_ORIGINS.has(origin)) return true;
  return false;
}

function apiCors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && isAllowedApiOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use('/api', apiCors);
app.use(express.json({ limit: '1mb' }));

// Chef API — authoritative gameplay engine. The health route answers on
// every boot; the gameplay routes mount below before app.listen().
mountChefHealthRoute(app);

async function boot(): Promise<void> {
  const chefJwtSecret = process.env.CHEF_JWT_SECRET;
  const databaseUrl = process.env.DATABASE_URL;
  const chefJobSecret = process.env.CHEF_JOB_SECRET;
  if (chefJwtSecret && databaseUrl) {
    try {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: databaseUrl });
      const googleClientIds = (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? '')
        .split(',').map((v) => v.trim()).filter(Boolean);
      const appleClientIds = (process.env.APPLE_OAUTH_CLIENT_IDS ?? '')
        .split(',').map((v) => v.trim()).filter(Boolean);
      mountAuthRoutes(app, new PgAuthStore(pool), { jwtSecret: chefJwtSecret, googleClientIds, appleClientIds });
      console.log('[chef-auth] /api/auth/* mounted (Route B identity)');
      mountReadRoutes(app, new PgReadStore(pool), { jwtSecret: chefJwtSecret });
      console.log('[chef-reads] read APIs mounted (Route B B2)');
      const writeStore = new PgWriteStore(pool);
      mountWriteRoutes(app, writeStore, { jwtSecret: chefJwtSecret, enforceAdPacing: true });
      console.log('[chef-writes] write APIs mounted (Route B B3)');
      const economyStore = new PgEconomyStore(pool);
      const economyConfig = new EconomyConfig(economyStore);
      const gameplayStore = new PgChefGameplayStore(pool);
      mountGameplayRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
        enforceWallClockPacing: true,
      });
      mountActionSkillRoutes(app, gameplayStore, writeStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      mountCacheRankRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      mountDispatchRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      mountExtractionRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      mountLoginStreakRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      mountContractsRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      mountResearchRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      mountCosmeticsRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      mountStandingRoutes(app, gameplayStore, {
        jwtSecret: chefJwtSecret,
        economyConfig,
      });
      const jobStore = new PgJobStore(pool);
      mountJobRoutes(app, jobStore, {
        jwtSecret: chefJwtSecret,
        jobSecret: chefJobSecret,
        fcmSender: fcmSenderFromEnv(),
        economyStore,
        economyConfig,
        leaderboardStore: new PgLeaderboardStore(pool),
      });
      console.log(
        chefJobSecret
          ? '[chef-jobs] job routes + push test mounted (Route B B5)'
          : '[chef-jobs] push test mounted; job routes disabled (CHEF_JOB_SECRET not set)',
      );
    } catch (err) {
      console.error('[chef-auth] failed to initialize pg pool', err);
    }
  } else {
    console.log('[chef-auth] disabled (CHEF_JWT_SECRET / DATABASE_URL not both set)');
    console.log('[chef] gameplay routes disabled (Route B not configured)');
  }

  // Mount SPA / app-only web gate AFTER all /api/* routes so API requests
  // never race or fall through to SPA fallback during boot.
  mountWebClient(app, DIST_DIR, isWebClientEnabled());

  // Structured JSON error handler for malformed JSON bodies & uncaught errors.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : 500;
    if (status === 400 && (err as { type?: string })?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'validation', message: 'Malformed JSON body' });
      return;
    }
    console.error('[cybercache] unhandled server error', err);
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: status === 400 ? 'validation' : 'internal',
      message: status === 400 ? 'Bad request' : 'Something went wrong',
    });
  });

  app.listen(PORT, () => {
    console.log(`[cybercache] server running on port ${PORT}`);
    console.log(`[cybercache] chef worker mounted at /api/claim`);
  });
}

void boot();
