import { Element, Rarity } from '@/types/game';
import type { Shield } from '@/types/items';
import { getElementVisual } from '@/constants/visualAssets';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import {
  type ShieldVisualSpec,
  pickShieldSilhouette,
} from '@/constants/shieldSilhouettes';
import { buildDecals } from '@/lib/weaponArt/buildWeaponVisualSpec';

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

/**
 * Build a ShieldVisualSpec from a shield item.
 */
export function buildShieldVisualSpec(shield: Partial<Shield> & {
  element: Element;
  rarity: Rarity | string;
}): ShieldVisualSpec {
  const rarity = normalizeRarity(shield.rarity);
  const seed = typeof shield.pixelSeed === 'number'
    ? shield.pixelSeed
    : hashString(`${shield.id || ''}:${shield.name || ''}:${shield.element}:${shield.rarity}`);

  return {
    id: shield.id || `shield-${shield.element}-${seed}`,
    seed,
    rarity: shield.rarity,
    element: shield.element,
    hp: shield.hp ?? 100,
    rechargeRate: shield.rechargeRate ?? 10,
    silhouette: pickShieldSilhouette(shield.element, seed),
    rarityFrame: RARITY_FRAME_STYLES[rarity],
    elementVisual: getElementVisual(shield.element),
    decals: buildDecals(shield.affixes, seed, undefined),
    texture: getElementVisual(shield.element).texture || 'energy',
  };
}

// Re-export buildDecals for other spec builders
export { buildDecals } from '@/lib/weaponArt/buildWeaponVisualSpec';
export type { WeaponVisualDecal } from '@/lib/weaponArt/buildWeaponVisualSpec';
