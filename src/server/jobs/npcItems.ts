/**
 * NPC market item generation — extracted verbatim from the June Chef route
 * (src/server/routes/marketSeedRoute.ts) so the legacy secret-gated route
 * and the Route B job route (POST /api/jobs/seed-npc-market) generate the
 * exact same stock. Items come from the shared generators (the one source
 * of truth the Chef and client both import); pricing rules are unchanged.
 */
import type { GearItem, Weapon } from '@/types/items';
import { generateShield } from '@/server/lib/generators/shieldGenerator';
import { generateClassMod } from '@/server/lib/generators/classModGenerator';
import { generateRelic } from '@/server/lib/generators/relicGenerator';
import { generateOrdnance } from '@/server/lib/generators/ordnanceGenerator';
import type { Json } from '../writes/store';
import type { NpcSeedItem } from './store';

export function npcPrice(item: GearItem): number {
  if ('weaponType' in item) {
    const w = item as Weapon;
    return Math.max(100, Math.round(w.combatPower * 10 + (w.rollQuality ?? 100) * 0.5));
  }
  return Math.max(100, Math.round((item.level ?? 1) * 250));
}

export function generateNpcItem(level: number): GearItem {
  const roll = Math.random();
  // Pure player market (owner ruling, 2026-11-02): the NPC seed no
  // longer stocks weapons — vendor weapons live in the Vendor lane and
  // the Buy lane is player listings only. The old weapon share (45%)
  // is redistributed across the remaining kinds in their original
  // proportions (shield 25 · classMod 15 · relic 10 · ordnance 5, of
  // the non-weapon 55%), so the rest of the stock mix is unchanged.
  if (roll < 25 / 55) return generateShield(level);
  if (roll < 40 / 55) return generateClassMod(level);
  if (roll < 50 / 55) return generateRelic(level);
  return generateOrdnance(level);
}

function kindOf(item: GearItem): string {
  return 'weaponType' in item ? 'weapon' : 'hp' in item ? 'shield' : 'treeBonus' in item ? 'classMod' : 'damage' in item ? 'ordnance' : 'relic';
}

/** Generate `count` NPC listings at `level`, as persistable seed rows. */
export function buildNpcSeedItems(count: number, level: number): NpcSeedItem[] {
  const items: NpcSeedItem[] = [];
  for (let i = 0; i < count; i += 1) {
    const item = generateNpcItem(level);
    items.push({
      id: item.id,
      kind: `gear:${kindOf(item)}`,
      item_level: item.level ?? 1,
      rarity: item.rarity,
      payload: item as unknown as Json,
      price_credits: npcPrice(item),
    });
  }
  return items;
}

/** Clamp the June route's count/level inputs to their original ranges. */
export function clampSeedCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 12);
  return Math.min(50, Math.max(1, Number.isFinite(n) ? n : 12));
}

export function clampSeedLevel(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 10);
  return Math.min(100, Math.max(1, Number.isFinite(n) ? n : 10));
}
