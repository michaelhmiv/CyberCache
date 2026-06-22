import type { NextFunction, Request, Response, Router } from 'express';
import { Router as expressRouter } from 'express';
import type { GearItem, Weapon } from '@/types/items';
import { DropSource } from '@/types/game';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { generateShield } from '@/server/lib/generators/shieldGenerator';
import { generateClassMod } from '@/server/lib/generators/classModGenerator';
import { generateRelic } from '@/server/lib/generators/relicGenerator';
import { generateOrdnance } from '@/server/lib/generators/ordnanceGenerator';
import { getServiceSupabase, NPC_MARKET_USER_ID } from '@/server/lib/supabaseService';

const SEED_SECRET = process.env.NPC_MARKET_SEED_SECRET;

function npcPrice(item: GearItem): number {
  if ('weaponType' in item) {
    const w = item as Weapon;
    return Math.max(100, Math.round(w.combatPower * 10 + (w.rollQuality ?? 100) * 0.5));
  }
  return Math.max(100, Math.round((item.level ?? 1) * 250));
}

function generateNpcItem(level: number): GearItem {
  const roll = Math.random();
  if (roll < 0.45) return generateWeapon({ source: DropSource.Marketplace, level });
  if (roll < 0.70) return generateShield(level);
  if (roll < 0.85) return generateClassMod(level);
  if (roll < 0.95) return generateRelic(level);
  return generateOrdnance(level);
}

async function seedNpcMarket(count: number, level: number) {
  if (!SEED_SECRET) {
    throw new Error('NPC market seeding is not configured on this instance');
  }
  const supabase = getServiceSupabase();
  const kindPool: string[] = [];
  const items: GearItem[] = [];
  for (let i = 0; i < count; i += 1) {
    const item = generateNpcItem(level);
    items.push(item);
    kindPool.push('weaponType' in item ? 'weapon' : 'hp' in item ? 'shield' : 'treeBonus' in item ? 'classMod' : 'damage' in item ? 'ordnance' : 'relic');
  }

  // Clean up prior NPC listings
  await supabase
    .from('market_listings')
    .update({ status: 'cancelled' })
    .eq('seller_user_id', NPC_MARKET_USER_ID)
    .eq('status', 'active');

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const { error: itemErr } = await supabase.from('item_instances').insert({
      id: item.id,
      owner_user_id: NPC_MARKET_USER_ID,
      kind: `gear:${kindPool[i]}`,
      item_level: item.level ?? 1,
      rarity: item.rarity,
      is_locked: false,
      runtime_state: 'available',
      supply_mode: 'npc_market',
      equipped_slot: null,
      payload: item as unknown as Record<string, unknown>,
    });
    if (itemErr) throw itemErr;

    const { error: listingErr } = await supabase.from('market_listings').insert({
      seller_user_id: NPC_MARKET_USER_ID,
      item_instance_id: item.id,
      price_credits: npcPrice(item),
      status: 'active',
    });
    if (listingErr) throw listingErr;
  }

  return { seeded: items.length, level };
}

export function mountMarketSeedRoutes(router: Router): void {
  const r = expressRouter();

  const handler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const secret = req.headers['x-npc-market-secret'];
      if (!SEED_SECRET || secret !== SEED_SECRET) {
        res.status(403).json({ ok: false, error: 'Forbidden' });
        return;
      }
      const count = Math.min(50, Math.max(1, Number(req.body.count ?? 12)));
      const level = Math.min(100, Math.max(1, Number(req.body.level ?? 10)));
      const result = await seedNpcMarket(count, level);
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[market seed] error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Seed failed' });
    }
  };

  r.post('/market/seed', handler);

  router.use('/api', r);
}
