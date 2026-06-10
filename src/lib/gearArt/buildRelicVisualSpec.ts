import { Rarity, DropSource } from '@/types/game';
import type { Relic } from '@/types/items';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import {
  type RelicSilhouette,
  type RelicVisualSpec,
  pickRelicSilhouette,
  DEFAULT_RELIC_SILHOUETTE,
} from '@/constants/relicSilhouettes';
import { buildDecals, type WeaponVisualDecal } from '@/lib/weaponArt/buildWeaponVisualSpec';

function normalizeRarity(rarity: Rarity | string): Rarity {
  return (Object.values(Rarity) as string[]).includes(rarity) ? (rarity as Rarity) : Rarity.Common;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildRelicVisualSpec(relic: Partial<Relic> & {
  rarity: Rarity | string;
}): RelicVisualSpec {
  const rarity = normalizeRarity(relic.rarity);
  const seed = hashString(`${relic.id || ''}:${relic.name || ''}:${relic.rarity}:${relic.sourceTag || ''}`);

  return {
    id: relic.id || `relic-${seed}`,
    seed,
    rarity: relic.rarity,
    sourceTag: relic.sourceTag ?? DropSource.WorldDrop,
    silhouette: pickRelicSilhouette(relic.sourceTag ?? DropSource.WorldDrop, seed),
    rarityFrame: RARITY_FRAME_STYLES[rarity],
    decals: buildDecals((relic as any).affixes, seed, undefined),
    texture: 'crystal',
  };
}

export { buildDecals };
export type { RelicVisualSpec } from '@/constants/relicSilhouettes';
export type { WeaponVisualDecal } from '@/lib/weaponArt/buildWeaponVisualSpec';
