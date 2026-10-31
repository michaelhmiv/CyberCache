import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import {
  MANUFACTURER_WEAPON_STYLES,
  PART_SLOT_LABELS,
  PartSlot,
  RARITY_FRAME_STYLES,
  WEAPON_SILHOUETTES,
} from '@/constants/weaponVisuals';
import { getElementVisual, getManufacturerVisual, getWeaponTypeVisual } from '@/constants/visualAssets';
import { partVariant, type PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import {
  buildDecals,
  conditionFromRoll,
  weaponVisualSeed,
  type WeaponVisualDecal,
} from './decalSpec';

export { buildDecals };
export type { WeaponVisualDecal };

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

function normalizeRarity(rarity: Rarity | string): Rarity {
  return (Object.values(Rarity) as string[]).includes(rarity) ? (rarity as Rarity) : Rarity.Common;
}

/**
 * Part variants — ONE derivation for both renderers (overhaul §4.2
 * fix b): the vector builder used to seed-hash its variants from the
 * weapon id, so a gun's parts looked one way on the card and another
 * in the hand. It now delegates to the pixel compositor's partVariant
 * (which derives from the part's full rolled modifier map), so the
 * same instance picks the same variant index on every surface.
 */
function pickPartVariants(weapon: Partial<Weapon>): WeaponPartVisuals {
  const variants = {} as WeaponPartVisuals;
  const input: PixelWeaponInput = {
    weaponType: weapon.weaponType ?? WeaponType.Pistol,
    manufacturer: weapon.manufacturer ?? Manufacturer.Redline,
    rarity: weapon.rarity ?? Rarity.Common,
    element: weapon.element,
    parts: weapon.parts,
    name: weapon.name,
    legendaryEffectId: weapon.legendaryEffectId,
  };
  PART_SLOTS.forEach((slot) => {
    variants[slot] = partVariant(input, slot, 4);
  });
  return variants;
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
  const baseSeed = weaponVisualSeed(weapon);

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
    partVariants: pickPartVariants(weapon),
    decals: buildDecals(weapon.affixes, baseSeed, weapon.legendaryEffectId),
    condition: conditionFromRoll(rollQuality),
  };
}
