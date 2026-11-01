/**
 * Signature Order weapon generation (Manufacturer Standing, 0043).
 *
 * The Chef generates the ordered weapon with the SHARED generator —
 * the same code path as every drop — with the manufacturer forced
 * and the rarity forced into the Rare–Epic band. The RNG stream is
 * seeded from (player, nonce), so rarity and roll stats are a pure
 * function of the pair (the reforge pattern).
 *
 * Order laws enforced here and revalidated in cc_standing_order_weapon:
 * never Legendary (the rarity band), never a legendaryEffectId
 * (the generator only attaches one at Legendary, and we strip the
 * key defensively), payload.origin = 'standing_order'. The seeded
 * stream drives rarity and the roll stats; the generator's id and
 * pixelSeed are ambient per generation (not seeded) and are not
 * the item's identity (the item_instances row id is), and a
 * retried apply returns the op's stored ledger result without
 * inserting a second weapon.
 */

import { DropSource, Manufacturer, Rarity } from '@/types/game';
import { createRNG, hashString } from '@/lib/utils/rng';
import { generateWeapon } from '../lib/generators/weaponGenerator.js';

/** Rare/Epic split for a Signature Order roll. */
export const STANDING_ORDER_RARITY_WEIGHTS = { Rare: 0.75, Epic: 0.25 } as const;

export function generateStandingOrderWeapon(args: {
  playerId: string;
  nonce: string;
  manufacturer: string;
  level: number;
}): Record<string, unknown> {
  const rng = createRNG(hashString(`standing-order:${args.playerId}:${args.nonce}`));
  const rarity =
    rng() < STANDING_ORDER_RARITY_WEIGHTS.Rare ? Rarity.Rare : Rarity.Epic;
  const weapon = generateWeapon(
    {
      source: DropSource.Crafted,
      level: Math.max(1, Math.trunc(args.level) || 1),
      forcedRarity: rarity,
      forcedManufacturer: args.manufacturer as Manufacturer,
    },
    rng,
  );
  const payload = { ...(weapon as unknown as Record<string, unknown>) };
  payload.origin = 'standing_order';
  payload.sourceTag = 'Signature Order';
  delete payload.legendaryEffectId;
  return payload;
}
