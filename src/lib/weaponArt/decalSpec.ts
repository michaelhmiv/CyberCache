import type { Affix } from '@/types/items';
import { AFFIX_DECAL_COLORS } from '@/constants/weaponVisuals';

/**
 * Decal + condition derivation — the shared leaf under both weapon
 * renderers (the vector spec builder and the pixel compositor).
 *
 * Roaming-variance overhaul (§4.2): affix decals and roll-quality
 * condition grades used to exist only on the vector/card path, so a
 * gun's affixes were invisible in the hunter's hand. The derivation
 * lives here — a leaf module both renderers import — so there is
 * exactly one decal set and one condition grade per instance, on
 * every surface (renderer-parity tests pin this).
 */

export interface WeaponVisualDecal {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  rotate: number;
  shape: 'slash' | 'dot' | 'triangle' | 'diamond' | 'tag';
}

export type WeaponCondition = 'beat-up' | 'field-used' | 'clean' | 'mint' | 'godroll';

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** The one seed both renderers derive a weapon's presentation from. */
export function weaponVisualSeed(weapon: {
  id?: string;
  name?: string;
  weaponType?: string;
  manufacturer?: string;
  element?: string;
  rarity?: string;
  pixelSeed?: number;
}): number {
  return typeof weapon.pixelSeed === 'number'
    ? weapon.pixelSeed
    : hashString(`${weapon.id || ''}:${weapon.name || ''}:${weapon.weaponType}:${weapon.manufacturer}:${weapon.element}:${weapon.rarity}`);
}

export function conditionFromRoll(rollQuality: number): WeaponCondition {
  if (rollQuality >= 96) return 'godroll';
  if (rollQuality >= 85) return 'mint';
  if (rollQuality >= 65) return 'clean';
  if (rollQuality >= 35) return 'field-used';
  return 'beat-up';
}

function decalShape(index: number, affix: Affix): WeaponVisualDecal['shape'] {
  if (affix.category === 'boss') return 'tag';
  if (affix.category === 'elemental') return 'diamond';
  if (affix.category === 'idle') return 'dot';
  if (affix.category === 'skill') return 'triangle';
  return index % 2 === 0 ? 'slash' : 'dot';
}

/**
 * The affix decals an instance carries: up to 5 category decals plus
 * the legendary ★. Positions live in the vector builder's ~200×80
 * view space; the pixel compositor scales them onto its grid.
 */
export function buildDecals(affixes: Affix[] | undefined, seed: number, legendaryEffectId?: string): WeaponVisualDecal[] {
  const rng = seededRandom(seed ^ 0x9E3779B9);
  const decals = (affixes || []).slice(0, 5).map((affix, index) => ({
    id: affix.id || `${affix.category}-${index}`,
    label: affix.category.slice(0, 1).toUpperCase(),
    color: AFFIX_DECAL_COLORS[affix.category] || '#FFEA3A',
    x: 58 + Math.floor(rng() * 94),
    y: 45 + Math.floor(rng() * 20),
    rotate: -18 + Math.floor(rng() * 36),
    shape: decalShape(index, affix),
  }) satisfies WeaponVisualDecal);

  if (legendaryEffectId) {
    decals.unshift({
      id: `legendary-${legendaryEffectId}`,
      label: '★',
      color: '#FFEA3A',
      x: 151,
      y: 34,
      rotate: -8,
      shape: 'tag',
    });
  }

  return decals;
}
