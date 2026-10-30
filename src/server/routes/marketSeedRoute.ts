/**
 * NPC market seeding — legacy route (POST /api/market/seed).
 *
 * June origin: a secret-gated Chef route that restocked the NPC seller's
 * marketplace listings through the Supabase service client. Route B (B5)
 * keeps the route, its header (`x-npc-market-secret`), and its env
 * (NPC_MARKET_SEED_SECRET) for ops compatibility, but the data path now
 * prefers the Postgres JobStore when one is mounted (Railway deploys);
 * the Supabase service-client path remains only for Supabase-era boots
 * without DATABASE_URL. Item generation is shared with the job route
 * (POST /api/jobs/seed-npc-market) via src/server/jobs/npcItems.ts, and
 * both paths replace the NPC stock (cancel active, insert fresh), so
 * either entry point is safe to call twice.
 */
import type { NextFunction, Request, Response, Router } from 'express';
import { Router as expressRouter } from 'express';
import { getServiceSupabase, NPC_MARKET_USER_ID } from '@/server/lib/supabaseService';
import type { JobStore } from '@/server/jobs/store';
import { buildNpcSeedItems, clampSeedCount, clampSeedLevel } from '@/server/jobs/npcItems';

const SEED_SECRET = process.env.NPC_MARKET_SEED_SECRET;

async function seedNpcMarketLegacy(count: number, level: number) {
  if (!SEED_SECRET) {
    throw new Error('NPC market seeding is not configured on this instance');
  }
  const supabase = getServiceSupabase();
  const items = buildNpcSeedItems(count, level);

  // Clean up prior NPC listings
  await supabase
    .from('market_listings')
    .update({ status: 'cancelled' })
    .eq('seller_user_id', NPC_MARKET_USER_ID)
    .eq('status', 'active');

  for (const item of items) {
    const { error: itemErr } = await supabase.from('item_instances').insert({
      id: item.id,
      owner_user_id: NPC_MARKET_USER_ID,
      kind: item.kind,
      item_level: item.item_level,
      rarity: item.rarity,
      is_locked: false,
      runtime_state: 'available',
      supply_mode: 'npc_market',
      equipped_slot: null,
      payload: item.payload,
    });
    if (itemErr) throw itemErr;

    const { error: listingErr } = await supabase.from('market_listings').insert({
      seller_user_id: NPC_MARKET_USER_ID,
      item_instance_id: item.id,
      price_credits: item.price_credits,
      status: 'active',
    });
    if (listingErr) throw listingErr;
  }

  return { seeded: items.length, level };
}

export function mountMarketSeedRoutes(router: Router, jobStore?: JobStore): void {
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
      if (jobStore) {
        const { seeded } = await jobStore.seedNpcMarket(
          NPC_MARKET_USER_ID,
          buildNpcSeedItems(count, level),
        );
        res.json({ ok: true, seeded, level });
        return;
      }
      const result = await seedNpcMarketLegacy(count, level);
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[market seed] error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Seed failed' });
    }
  };

  r.post('/market/seed', handler);

  router.use('/api', r);
}
