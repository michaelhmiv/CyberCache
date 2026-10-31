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

export async function finalizePendingCraftedGear(
  pool: Pool,
  playerId: string,
  rng: () => number = Math.random,
): Promise<number> {
  const { rows } = await pool.query('select * from public.cc_pending_crafted_gear($1)', [playerId]);
  let finalized = 0;
  for (const row of rows as Array<Record<string, unknown>>) {
    const candidate = generateCraftedGearItem({
      slot: String(row.slot) as CraftGearSlot,
      rarity: String(row.rarity) as Rarity,
      itemLevel: Number(row.item_level ?? 1),
      creatorId: playerId,
      draws: Number(row.draws ?? 1),
      rng,
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
    await pool.query('select public.cc_finalize_crafted_gear($1, $2, $3, $4)', [
      playerId,
      String(row.job_id),
      Number(row.unit),
      itemId,
    ]);
    finalized += 1;
  }
  return finalized;
}
