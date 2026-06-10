import { Element, Rarity } from '@/types/game';
import type { Ordnance } from '@/types/items';
import { getElementVisual } from '@/constants/visualAssets';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import {
  type OrdnanceSilhouette,
  type OrdnanceVisualSpec,
  pickOrdnanceSilhouette,
  DEFAULT_ORDNANCE_SILHOUETTE,
} from '@/constants/ordnanceSilhouettes';
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

export function buildOrdnanceVisualSpec(ordnance: Partial<Ordnance> & {
  element: Element;
  rarity: Rarity | string;
  effect: string;
}): OrdnanceVisualSpec {
  const rarity = normalizeRarity(ordnance.rarity);
  const seed = typeof (ordnance as any).pixelSeed === 'number'
    ? (ordnance as any).pixelSeed
    : hashString(`${ordnance.id || ''}:${ordnance.name || ''}:${ordnance.element}:${ordnance.effect}:${ordnance.rarity}`);

  return {
    id: ordnance.id || `ordnance-${ordnance.element}-${seed}`,
    seed,
    rarity: ordnance.rarity,
    element: ordnance.element,
    damage: ordnance.damage ?? 50,
    effect: ordnance.effect ?? 'frag',
    silhouette: pickOrdnanceSilhouette(ordnance.effect ?? 'frag', seed),
    rarityFrame: RARITY_FRAME_STYLES[rarity],
    elementVisual: getElementVisual(ordnance.element),
    decals: buildDecals((ordnance as any).affixes, seed, undefined),
    texture: 'ordnance',
  };
}

export { buildDecals };
export type { WeaponVisualDecal } from '@/lib/weaponArt/buildWeaponVisualSpec';
