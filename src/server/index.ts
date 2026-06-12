/**
 * CyberCache Server — Express + Chef Worker
 *
 * Single Railway service that:
 *   1. Serves the built React app (static files)
 *   2. Runs the Chef worker — the authoritative engine for all
 *      gameplay: tick claims, item generation, combat simulation,
 *      boss verification.
 *
 * The Chef imports the SAME generator functions as the client
 * (src/lib/generators/*). One source of truth for game logic.
 */

import express from 'express';
import path from 'node:path';
import { mountChefRoutes } from './routes/chefRoutes';

const PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = path.resolve(__dirname, '../../dist');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Chef API — authoritative gameplay engine
mountChefRoutes(app);

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
