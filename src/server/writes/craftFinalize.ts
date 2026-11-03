/**
 * Pending crafted-gear finalization (Pg stores).
 *
 * The SQL settler (migration 0024) completes gear units by recording
 * pending outputs on the job — item generation is a TypeScript source
 * of truth (src/server/lib/generators) with no SQL twin for
 * non-weapon slots, so the item is generated here through the shared
 * generators (craftGear.ts), inserted as an item_instances row with
 * its value from cc_compute_item_estimated_value (the same function
 * cc_store_chef_items prices with), and the job's output is marked
 * finalized with the new item id (cc_finalize_crafted_gear).
 *
 * Every surface that can observe a completion runs this first
 * (workshop state reads, craft ops, offline settlement), so a pending
 * output is never visible to a player: it exists only inside the
 * settle→finalize window of a single request.
 */
import type { Pool } from 'pg';
import { Rarity } from '../../types/game.js';
import { generateCraftedGearItem, type CraftGearSlot } from './craftGear.js';
import { buildCosmeticPartPayload } from '../../content/skins.js';

export async function finalizePendingCraftedGear(
  pool: Pool,
  playerId: string,
  rng: () => number = Math.random,
): Promise<number> {
  const { rows } = await pool.query('select * from public.cc_pending_crafted_gear($1)', [playerId]);
  let finalized = 0;
  for (const row of rows as Array<Record<string, unknown>>) {
    // Material catalyst (economy brief §9.1, 0067): the SQL settler
    // stamps the unit's catalyst-shifted bounds onto the pending
    // output; generation rolls each candidate inside them, exactly
    // like the in-memory twin's gear branch.
    const boundsRaw = row.quality_bounds as { min?: unknown; max?: unknown; cap?: unknown } | null;
    const qualityRoll =
      boundsRaw && typeof boundsRaw.min === 'number' && typeof boundsRaw.max === 'number'
        ? {
            bounds: {
              min: boundsRaw.min,
              max: boundsRaw.max,
              cap: typeof boundsRaw.cap === 'number' ? boundsRaw.cap : 175,
            },
            bench: Number(row.bench ?? 1),
            toolQualityMultiplier: Number(row.tool_quality_multiplier ?? 1),
          }
        : undefined;
    const candidate = generateCraftedGearItem({
      slot: String(row.slot) as CraftGearSlot,
      rarity: String(row.rarity) as Rarity,
      itemLevel: Number(row.item_level ?? 1),
      creatorId: playerId,
      draws: Number(row.draws ?? 1),
      rng,
      ...(qualityRoll ? { qualityRoll } : {}),
    });
    const inserted = await pool.query(
      `insert into public.item_instances (
         owner_user_id, kind, runtime_state, is_locked, rarity,
         item_level, estimated_value, supply_mode, payload
       ) values (
         $1, $2, 'available', false, $3, $4,
         public.cc_compute_item_estimated_value($5::jsonb, $2, $3, $4),
         'verified_action', $5::jsonb
       ) returning id`,
      [playerId, candidate.kind, candidate.rarity, candidate.itemLevel, JSON.stringify(candidate.payload)],
    );
    const itemId = String((inserted.rows[0] as { id: string }).id);
    await pool.query('select public.cc_finalize_crafted_gear($1, $2, $3, $4, $5)', [
      playerId,
      String(row.job_id),
      Number(row.unit),
      itemId,
      candidate.craftQuality ?? null,
    ]);
    finalized += 1;
  }
  return finalized;
}

/**
 * Pending crafted-cosmetic finalization (0053) — the gear path's
 * mirror. The SQL settler completes cosmetic part units as pending
 * outputs carrying the part id + the finish-roll quality; the item
 * payload is a TypeScript source of truth (content/skins.ts
 * buildCosmeticPartPayload — no generation rolls: the part IS the
 * catalog entry), inserted as a kind='cosmetic' item_instances row
 * and stamped in through cc_finalize_crafted_cosmetic. Runs at the
 * same surfaces as the gear finalizer.
 */
export async function finalizePendingCraftedCosmetics(
  pool: Pool,
  playerId: string,
): Promise<number> {
  const { rows } = await pool.query('select * from public.cc_pending_crafted_cosmetics($1)', [playerId]);
  let finalized = 0;
  for (const row of rows as Array<Record<string, unknown>>) {
    const payload = buildCosmeticPartPayload(String(row.part_id), Number(row.quality ?? 50), playerId);
    if (!payload) continue;
    const inserted = await pool.query(
      `insert into public.item_instances (
         owner_user_id, kind, runtime_state, is_locked, rarity,
         item_level, estimated_value, supply_mode, payload
       ) values (
         $1, 'cosmetic', 'available', false, 'Common', 1,
         public.cc_compute_item_estimated_value($2::jsonb, 'cosmetic', 'Common', 1),
         'verified_action', $2::jsonb
       ) returning id`,
      [playerId, JSON.stringify(payload)],
    );
    const itemId = String((inserted.rows[0] as { id: string }).id);
    await pool.query('select public.cc_finalize_crafted_cosmetic($1, $2, $3, $4)', [
      playerId,
      String(row.job_id),
      Number(row.unit),
      itemId,
    ]);
    finalized += 1;
  }
  return finalized;
}
