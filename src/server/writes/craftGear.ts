/**
 * Crafted gear generation — the finalization half of the crafting
 * slice's gear frames (brief §2.5c).
 *
 * The settler (SQL in migration 0024, the TS mirror in craftEngine.ts)
 * completes a gear unit by recording a PENDING gear output: slot,
 * rarity (forced at enqueue, capped at Epic), the crafter's level at
 * completion, and whether the unit tempered. The item itself is then
 * generated HERE, through the shared generators
 * (src/server/lib/generators/* — the same generators the Chef's drop
 * pipeline uses), because item generation is a TypeScript source of
 * truth with no SQL twin for non-weapon slots. Finalization runs
 * inside the Pg stores (workshop state reads, craft ops, offline
 * settlement) before any surface can observe the completion, and
 * immediately inside the in-memory mirrors.
 *
 * Crafted provenance is stamped on every payload: origin 'crafted',
 * craftedBy = the crafter's player id, sourceTag 'Player-Forged'
 * (weapons). Crafted items NEVER carry a legendaryEffectId — the
 * rarity is forced to Epic or below at enqueue, and any effect id a
 * generator might attach is stripped here as a hard invariant
 * (cache-forged precedent, brief §2.5c).
 */
import { DropSource, Rarity } from '../../types/game.js';
import { generateWeapon } from '../lib/generators/weaponGenerator.js';
import { generateShield } from '../lib/generators/shieldGenerator.js';
import { generateClassMod } from '../lib/generators/classModGenerator.js';
import { generateRelic } from '../lib/generators/relicGenerator.js';
import { generateOrdnance } from '../lib/generators/ordnanceGenerator.js';

export type CraftGearSlot = 'weapon' | 'shield' | 'classMod' | 'relic' | 'ordnance';

export const CRAFT_GEAR_KIND_BY_SLOT: Record<CraftGearSlot, string> = {
  weapon: 'weapon',
  shield: 'shield',
  classMod: 'classMod',
  relic: 'relic',
  ordnance: 'ordnance',
};

export interface CraftedGearCandidate {
  payload: Record<string, unknown>;
  kind: string;
  rarity: string;
  itemLevel: number;
  rollQuality: number;
}

/** Rarity weights that force exactly one rarity through the
 *  weight-driven generators (every other rarity at weight 0). */
function forcedRarityWeights(rarity: Rarity): Record<Rarity, number> {
  return {
    [Rarity.Common]: 0,
    [Rarity.Uncommon]: 0,
    [Rarity.Rare]: 0,
    [Rarity.Epic]: 0,
    [Rarity.Legendary]: 0,
    [rarity]: 1,
  };
}

/** Generate ONE crafted item candidate through the shared generators. */
export function generateCraftedGearCandidate(input: {
  slot: CraftGearSlot;
  rarity: Rarity;
  itemLevel: number;
  creatorId: string;
  rng: () => number;
}): CraftedGearCandidate {
  const { slot, rarity, itemLevel, creatorId, rng } = input;
  let item: Record<string, unknown>;
  switch (slot) {
    case 'weapon':
      item = generateWeapon(
        { source: DropSource.Crafted, level: itemLevel, forcedRarity: rarity },
        rng,
      ) as unknown as Record<string, unknown>;
      break;
    case 'shield':
      item = generateShield(itemLevel, rng, forcedRarityWeights(rarity)) as unknown as Record<string, unknown>;
      break;
    case 'classMod':
      item = generateClassMod(itemLevel, rng, forcedRarityWeights(rarity)) as unknown as Record<string, unknown>;
      break;
    case 'relic':
      item = generateRelic(itemLevel, rng, forcedRarityWeights(rarity)) as unknown as Record<string, unknown>;
      break;
    case 'ordnance':
      item = generateOrdnance(itemLevel, rng, forcedRarityWeights(rarity)) as unknown as Record<string, unknown>;
      break;
  }
  // Provenance + the no-legendary invariant.
  item.origin = 'crafted';
  item.craftedBy = creatorId;
  if (slot === 'weapon') item.sourceTag = 'Player-Forged';
  if ('legendaryEffectId' in item) delete item.legendaryEffectId;
  const rollQuality = typeof item.rollQuality === 'number' ? item.rollQuality : 0;
  return {
    payload: item,
    kind: CRAFT_GEAR_KIND_BY_SLOT[slot],
    rarity: String(item.rarity ?? rarity),
    itemLevel,
    rollQuality,
  };
}

/**
 * Generate a completed gear unit: `draws` candidates (3 when the unit
 * tempered, else 1), keeping the highest rollQuality (§2.5c — temper
 * draws candidates and keeps the best roll; it never edits stats
 * after generation).
 */
export function generateCraftedGearItem(input: {
  slot: CraftGearSlot;
  rarity: Rarity;
  itemLevel: number;
  creatorId: string;
  draws: number;
  rng: () => number;
}): CraftedGearCandidate {
  const draws = Math.max(1, Math.floor(input.draws) || 1);
  let best: CraftedGearCandidate | null = null;
  for (let i = 0; i < draws; i++) {
    const candidate = generateCraftedGearCandidate(input);
    if (!best || candidate.rollQuality > best.rollQuality) best = candidate;
  }
  return best as CraftedGearCandidate;
}
