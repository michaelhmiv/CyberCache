import { Rarity } from '@/types/game';
import type { ClassMod } from '@/types/items';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import {
  type ClassModSilhouette,
  type ClassModVisualSpec,
  pickClassModSilhouette,
  DEFAULT_CLASSMOD_SILHOUETTE,
} from '@/constants/classModSilhouettes';
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

export function buildClassModVisualSpec(mod: Partial<ClassMod> & {
  rarity: Rarity | string;
  treeBonus: string;
}): ClassModVisualSpec {
  const rarity = normalizeRarity(mod.rarity);
  const seed = hashString(`${mod.id || ''}:${mod.name || ''}:${mod.rarity}:${mod.treeBonus || ''}`);

  return {
    id: mod.id || `classmod-${seed}`,
    seed,
    rarity: mod.rarity,
    treeBonus: mod.treeBonus ?? 'Balanced',
    silhouette: pickClassModSilhouette(mod.treeBonus ?? 'Balanced'),
    rarityFrame: RARITY_FRAME_STYLES[rarity],
    decals: buildDecals((mod as any).affixes, seed, undefined),
    texture: 'data',
    nodeCount: Object.keys(mod.nodeBoosts || {}).length,
  };
}

export { buildDecals };
export type { ClassModVisualSpec } from '@/constants/classModSilhouettes';
export type { WeaponVisualDecal } from '@/lib/weaponArt/buildWeaponVisualSpec';
