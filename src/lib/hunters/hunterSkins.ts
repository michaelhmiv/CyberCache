/**
 * Whole skins — the Wardrobe's catalog (Cache Hunters reshape,
 * slice (b); DESIGN.md §12, 2026-11-14 ruling item 3).
 *
 * A skin is ONE painted whole for ONE hunter — never a set of worn
 * parts, never any power. The segmented part system this replaces
 * is retired as a wearing surface by this slice; its catalog
 * (src/content/skins.ts) stays for Collections and the stage rig
 * until slices (c)/(d) finish the retirement.
 *
 * At launch each hunter owns exactly one skin: their Standard
 * Issue — the Cast B painting itself (owner ruling 2026-11-15).
 * Base skins are owned by definition, so the Wardrobe's worn/owned
 * counts are real counts over this catalog, not fixtures. Slice
 * (d) adds crafted skins beside these; their ownership will come
 * from the server record, and `isSkinOwned` is the one seam that
 * learns it.
 */
import { HUNTERS, type HunterId } from './hunters';
import { PIXEL_HUNTER_SPRITES } from '@/lib/pixel/manifest';

export interface HunterSkinDef {
  id: string;
  hunterId: HunterId;
  name: string;
  /** Pixel-manifest sprite id of the painted whole. */
  spriteId: string;
  /** Base skins ship with the hunter — owned by definition.
   *  Crafted skins (slice (d)) are not base. */
  base: boolean;
}

export const HUNTER_SKINS: HunterSkinDef[] = HUNTERS.map((hunter) => ({
  id: `${hunter.id}-standard-issue`,
  hunterId: hunter.id,
  name: 'Standard Issue',
  spriteId: PIXEL_HUNTER_SPRITES[hunter.id],
  base: true,
}));

export function skinsForHunter(hunterId: HunterId): HunterSkinDef[] {
  return HUNTER_SKINS.filter((skin) => skin.hunterId === hunterId);
}

export function baseSkinForHunter(hunterId: HunterId): HunterSkinDef {
  return skinsForHunter(hunterId).find((skin) => skin.base) ?? skinsForHunter(hunterId)[0];
}

export function skinById(id: string | null | undefined): HunterSkinDef | undefined {
  if (!id) return undefined;
  return HUNTER_SKINS.find((skin) => skin.id === id);
}

/**
 * Ownership at this slice: base skins are owned by definition.
 * Slice (d) extends this with the crafted-skin ownership record —
 * callers must go through here, never read `base` directly.
 */
export function isSkinOwned(skin: HunterSkinDef): boolean {
  return skin.base;
}

/** The Wardrobe door's counts for one hunter: whole skins only. */
export function wardrobeCountsForHunter(
  hunterId: HunterId,
  wornSkinId: string | null | undefined,
): { worn: number; owned: number } {
  const owned = skinsForHunter(hunterId).filter(isSkinOwned).length;
  const wornDef = skinById(wornSkinId);
  return { worn: wornDef && wornDef.hunterId === hunterId ? 1 : 0, owned };
}
