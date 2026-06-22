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
