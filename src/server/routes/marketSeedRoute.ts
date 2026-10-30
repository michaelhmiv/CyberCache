/**
 * NPC market seeding — legacy route (POST /api/market/seed).
 *
 * June origin: a secret-gated Chef route that restocked the NPC seller's
 * marketplace listings. Route B keeps the route, its header
 * (`x-npc-market-secret`), its env (NPC_MARKET_SEED_SECRET), and its
 * 403-on-bad-secret shape; the data path is the Postgres JobStore, the
 * same store behind POST /api/jobs/seed-npc-market (B5), and seeding
 * replaces the NPC stock (cancel active, insert fresh), so it is safe
 * to call twice. The Supabase service-client path this file used to
 * fall back to was removed in B6 with the rest of the server's
 * Supabase dependency — the route now mounts only on Route B boots,
 * where a JobStore exists.
 */
import type { NextFunction, Request, Response, Router } from 'express';
import { Router as expressRouter } from 'express';
import { NPC_MARKET_USER_ID } from '@/server/lib/npcMarket';
import type { JobStore } from '@/server/jobs/store';
import { buildNpcSeedItems, clampSeedCount, clampSeedLevel } from '@/server/jobs/npcItems';

const SEED_SECRET = process.env.NPC_MARKET_SEED_SECRET;

export function mountMarketSeedRoutes(router: Router, jobStore: JobStore): void {
  const r = expressRouter();

  const handler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const secret = req.headers['x-npc-market-secret'];
      if (!SEED_SECRET || secret !== SEED_SECRET) {
        res.status(403).json({ ok: false, error: 'Forbidden' });
        return;
      }
      const count = clampSeedCount(req.body?.count);
      const level = clampSeedLevel(req.body?.level);
      const { seeded } = await jobStore.seedNpcMarket(
        NPC_MARKET_USER_ID,
        buildNpcSeedItems(count, level),
      );
      res.json({ ok: true, seeded, level });
    } catch (err) {
      console.error('[market seed] error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Seed failed' });
    }
  };

  r.post('/market/seed', handler);

  router.use('/api', r);
}
