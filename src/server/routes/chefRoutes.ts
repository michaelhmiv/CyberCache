import { Express } from 'express';
import { mountChefRoutes as mountLegacyChefRoutes } from './claim';
import { handleSettleOffline } from './settleOffline';

export function mountChefRoutes(app: Express): void {
  // Register the fixed settlement route before the legacy route bundle. Express
  // handles the first matching route, so this service-role compatible endpoint
  // takes precedence over the older auth.uid()-based implementation in claim.ts.
  app.post('/api/settle-offline', handleSettleOffline);
  mountLegacyChefRoutes(app);
}
