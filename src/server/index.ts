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
import { mountChefRoutes } from './routes/chefRoutes';
import { mountMarketSeedRoutes } from './routes/marketSeedRoute';
import { mountAuthRoutes } from './auth/routes';
import { PgAuthStore } from './auth/store';

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

// Chef API — authoritative gameplay engine
mountChefRoutes(app);

// Market seeding — server-side NPC listings
mountMarketSeedRoutes(app);

// Route B identity (slice B1) — Chef-issued auth on Railway Postgres.
// Mounted only when both the database and the JWT secret are configured,
// so existing Supabase-era deployments boot unchanged. Token issuance
// fails closed: no secret, no auth routes.
const chefJwtSecret = process.env.CHEF_JWT_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (chefJwtSecret && databaseUrl) {
  // Lazy import keeps `pg` out of the boot path for Supabase-era deploys.
  void import('pg')
    .then(({ Pool }) => {
      const pool = new Pool({ connectionString: databaseUrl });
      mountAuthRoutes(app, new PgAuthStore(pool), { jwtSecret: chefJwtSecret });
      console.log('[chef-auth] /api/auth/* mounted (Route B identity)');
    })
    .catch((err) => console.error('[chef-auth] failed to initialize pg pool', err));
} else {
  console.log('[chef-auth] disabled (CHEF_JWT_SECRET / DATABASE_URL not both set)');
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
