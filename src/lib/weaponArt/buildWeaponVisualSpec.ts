import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Affix, Weapon } from '@/types/items';
import {
  AFFIX_DECAL_COLORS,
  MANUFACTURER_WEAPON_STYLES,
  PART_SLOT_LABELS,
  PartSlot,
  RARITY_FRAME_STYLES,
  WEAPON_SILHOUETTES,
} from '@/constants/weaponVisuals';
import { getElementVisual, getManufacturerVisual, getWeaponTypeVisual } from '@/constants/visualAssets';

export interface WeaponVisualDecal {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  rotate: number;
  shape: 'slash' | 'dot' | 'triangle' | 'diamond' | 'tag';
}

export interface WeaponPartVisuals {
  Barrel: number;
  Grip: number;
  Core: number;
  Magazine: number;
  Sight: number;
  Chamber: number;
}

export interface WeaponVisualSpec {
  id: string;
  seed: number;
  type: WeaponType;
  manufacturer: Manufacturer;
  element: Element;
  rarity: Rarity | string;
  rollQuality: number;
  sourceTag?: string;
  legendaryEffectId?: string;
  typeVisual: ReturnType<typeof getWeaponTypeVisual>;
  manufacturerVisual: ReturnType<typeof getManufacturerVisual>;
  elementVisual: ReturnType<typeof getElementVisual>;
  manufacturerStyle: typeof MANUFACTURER_WEAPON_STYLES[Manufacturer.Redline];
  silhouette: typeof WEAPON_SILHOUETTES[WeaponType.Pistol];
  rarityFrame: typeof RARITY_FRAME_STYLES[Rarity.Common];
  partVariants: WeaponPartVisuals;
  decals: WeaponVisualDecal[];
  condition: 'beat-up' | 'field-used' | 'clean' | 'mint' | 'godroll';
}

const PART_SLOTS = Object.keys(PART_SLOT_LABELS) as PartSlot[];

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeRarity(rarity: Rarity | string): Rarity {
  return (Object.values(Rarity) as string[]).includes(rarity) ? (rarity as Rarity) : Rarity.Common;
}

function conditionFromRoll(rollQuality: number): WeaponVisualSpec['condition'] {
  if (rollQuality >= 96) return 'godroll';
  if (rollQuality >= 85) return 'mint';
  if (rollQuality >= 65) return 'clean';
  if (rollQuality >= 35) return 'field-used';
  return 'beat-up';
}

function pickPartVariants(seed: number, weapon: Partial<Weapon>): WeaponPartVisuals {
  const variants = {} as WeaponPartVisuals;
  const existingSlots = new Set((weapon.parts || []).map((part) => part.slot));

  PART_SLOTS.forEach((slot, index) => {
    const slotSeed = hashString(`${seed}:${weapon.id || ''}:${slot}:${weapon.weaponType || ''}:${index}`);
    const value = (slotSeed % 4) + (existingSlots.has(slot) ? 0 : 1);
    variants[slot] = Math.min(4, value);
  });

  return variants;
}

function decalShape(index: number, affix: Affix): WeaponVisualDecal['shape'] {
  if (affix.category === 'boss') return 'tag';
  if (affix.category === 'elemental') return 'diamond';
  if (affix.category === 'idle') return 'dot';
  if (affix.category === 'skill') return 'triangle';
  return index % 2 === 0 ? 'slash' : 'dot';
}

function buildDecals(affixes: Affix[] | undefined, seed: number, legendaryEffectId?: string): WeaponVisualDecal[] {
  const rng = seeded(seed ^ 0x9E3779B9);
  const decals = (affixes || []).slice(0, 5).map((affix, index) => ({
    id: affix.id || `${affix.category}-${index}`,
    label: affix.category.slice(0, 1).toUpperCase(),
    color: AFFIX_DECAL_COLORS[affix.category] || '#FFEA3A',
    x: 58 + Math.floor(rng() * 94),
    y: 45 + Math.floor(rng() * 20),
    rotate: -18 + Math.floor(rng() * 36),
    shape: decalShape(index, affix),
  } satisfies WeaponVisualDecal));

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

export function buildWeaponVisualSpec(weapon: Weapon): WeaponVisualSpec;
export function buildWeaponVisualSpec(weapon: Partial<Weapon> & {
  weaponType: WeaponType;
  manufacturer: Manufacturer;
  element: Element;
  rarity: Rarity | string;
}): WeaponVisualSpec;
export function buildWeaponVisualSpec(weapon: Partial<Weapon> & {
  weaponType: WeaponType;
  manufacturer: Manufacturer;
  element: Element;
  rarity: Rarity | string;
}): WeaponVisualSpec {
  const rarity = normalizeRarity(weapon.rarity);
  const baseSeed = typeof weapon.pixelSeed === 'number'
    ? weapon.pixelSeed
    : hashString(`${weapon.id || ''}:${weapon.name || ''}:${weapon.weaponType}:${weapon.manufacturer}:${weapon.element}:${weapon.rarity}`);

  const rollQuality = typeof weapon.rollQuality === 'number' ? weapon.rollQuality : 50;
  const manufacturerStyle = MANUFACTURER_WEAPON_STYLES[weapon.manufacturer] ?? MANUFACTURER_WEAPON_STYLES[Manufacturer.Redline];
  const silhouette = WEAPON_SILHOUETTES[weapon.weaponType] ?? WEAPON_SILHOUETTES[WeaponType.Pistol];

  return {
    id: weapon.id || `${weapon.weaponType}-${weapon.manufacturer}-${weapon.element}-${baseSeed}`,
    seed: baseSeed,
    type: weapon.weaponType,
    manufacturer: weapon.manufacturer,
    element: weapon.element,
    rarity: weapon.rarity,
    rollQuality,
    sourceTag: weapon.sourceTag,
    legendaryEffectId: weapon.legendaryEffectId,
    typeVisual: getWeaponTypeVisual(weapon.weaponType),
    manufacturerVisual: getManufacturerVisual(weapon.manufacturer),
    elementVisual: getElementVisual(weapon.element),
    manufacturerStyle,
    silhouette,
    rarityFrame: RARITY_FRAME_STYLES[rarity],
    partVariants: pickPartVariants(baseSeed, weapon),
    decals: buildDecals(weapon.affixes, baseSeed, weapon.legendaryEffectId),
    condition: conditionFromRoll(rollQuality),
  };
}
