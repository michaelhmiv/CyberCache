import { Express } from 'express';
import { mountChefRoutes as mountLegacyChefRoutes } from './claim';
import { handleClaim } from './roamingHandler';
import { handleSettleOffline } from './settleOffline';

export function mountChefRoutes(app: Express): void {
  // Register fixed routes before the legacy route bundle. Express handles the
  // first matching route, so these service-route compatible endpoints take
  // precedence over older implementations in claim.ts.
  app.post('/api/claim', handleClaim);
  app.post('/api/settle-offline', handleSettleOffline);
  mountLegacyChefRoutes(app);
}
