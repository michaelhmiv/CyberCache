/**
 * Legacy Chef gameplay route mounting (Route B, slice B6).
 *
 * The four original Chef endpoints, mounted once each on a Route B
 * boot (inside the CHEF_JWT_SECRET + DATABASE_URL gate in
 * src/server/index.ts, alongside identity/reads/writes/jobs). The
 * handlers live with the other Chef routes (routes/roamingHandler.ts,
 * routes/settleOffline.ts, routes/claim.ts) and are built over the
 * ChefGameplayStore seam. GET /api/health stays unconditional — it
 * answers on every boot, configured or not, exactly as in June.
 */
import type { Express } from 'express';
import type { AuthConfig } from '../auth/routes';
import { createClaimHandler } from '../routes/roamingHandler';
import { createSettleOfflineHandler } from '../routes/settleOffline';
import { createSalvageHandler, createVerifyBossHandler } from '../routes/claim';
import type { ChefGameplayStore } from './store';

export function mountChefHealthRoute(app: Express): void {
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', chef: 'ready' });
  });
}

export function mountGameplayRoutes(app: Express, store: ChefGameplayStore, config: AuthConfig): void {
  app.post('/api/claim', createClaimHandler(store, config));
  app.post('/api/settle-offline', createSettleOfflineHandler(store, config));
  app.post('/api/verify-boss', createVerifyBossHandler(store, config));
  app.post('/api/salvage', createSalvageHandler(store, config));
  console.log(
    '[chef] gameplay routes mounted: POST /api/claim, /api/settle-offline, /api/verify-boss, /api/salvage (Route B B6)',
  );
}
