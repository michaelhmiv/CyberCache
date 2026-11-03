import type { ShowcaseItemPayload } from '@/lib/api/verifiedOps';
import { RARITIES } from '@/constants/rarities';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';

/**
 * Showcase payload mapping (0034 shelf; shared since 0058) — a
 * shelved item row (the owner's stats fold or the public profile
 * projection) becomes the compositor input for its render. The
 * payload IS the instance the generators minted (real-item
 * invariant): seed, parts, affixes, and roll quality all ride it.
 */

export function showcaseWeaponInput(item: ShowcaseItemPayload): PixelWeaponInput {
  const payload = item.payload ?? {};
  const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value !== '' ? value : undefined;
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return {
    id: item.id,
    name: str(payload.name),
    weaponType: (str(payload.weaponType) ?? WeaponType.Pistol) as WeaponType,
    manufacturer: (str(payload.manufacturer) ?? Manufacturer.HelixWorks) as Manufacturer,
    element: str(payload.element) as Element | undefined,
    rarity: (item.rarity ?? str(payload.rarity) ?? Rarity.Common) as Rarity,
    pixelSeed: num(payload.pixelSeed),
    rollQuality: num(payload.rollQuality),
    affixes: Array.isArray(payload.affixes) ? (payload.affixes as PixelWeaponInput['affixes']) : undefined,
    parts: Array.isArray(payload.parts) ? (payload.parts as PixelWeaponInput['parts']) : undefined,
  };
}

export function showcaseRarityColor(rarity: string | null): string {
  return RARITIES[rarity as Rarity]?.color ?? '#A5A7B5';
}
