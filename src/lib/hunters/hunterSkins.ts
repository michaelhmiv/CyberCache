/**
 * Whole skins — the Wardrobe's catalog (Cache Hunters reshape,
 * slices (b) + (d); DESIGN.md §12, 2026-11-14 ruling item 3).
 *
 * A skin is ONE painted whole for ONE hunter — never a set of worn
 * parts, never any power. The segmented part system this replaces
 * is retired as a wearing surface; its catalog
 * (src/content/skins.ts) stays for Collections and grandfathered
 * part items.
 *
 * At launch each hunter owns exactly one skin: their Standard
 * Issue — the Cast B painting itself (owner ruling 2026-11-15).
 * Base skins are owned by definition. Slice (d) adds the crafted /
 * converted skin machinery beside them: a non-base skin becomes
 * wearable only when (1) its painting exists — a def in this
 * catalog, whose spriteId resolves in the pixel manifest — and
 * (2) the account owns it, proven by a server-owned item record
 * (kind 'cosmetic', payload below) carried in the cosmetics view.
 * `isSkinOwned` is the one seam that reads both facts; callers
 * never read `base` or the record directly.
 *
 * PAINTING GATE (brief §2.4/§8.2): today this catalog holds ONLY
 * the four base skins. Neither part set (Bulwark, Dreadplate) is
 * painted as a whole for any hunter, so there are no craftable
 * whole skins and set conversion grants nothing yet. Adding a
 * commissioned, owner-approved painting = adding its def here
 * (with `setId` for a set skin); the Workshop recipe, the market
 * family, and conversion all key off this catalog with no further
 * code change.
 */
import { HUNTERS, type HunterId } from './hunters';
import { PIXEL_HUNTER_SPRITES } from '@/lib/pixel/gearManifestData';
import { skinPartsForSet } from '@/content/skins';

export interface HunterSkinDef {
  id: string;
  hunterId: HunterId;
  name: string;
  /** Pixel-manifest sprite id of the painted whole. */
  spriteId: string;
  /** Base skins ship with the hunter — owned by definition.
   *  Crafted / converted skins (slice (d)) are not base. */
  base: boolean;
  /** Set skins only: the part set (content/skins.ts) this whole
   *  paints. Drives complete-set conversion: owning every part
   *  of the set grants this skin. Absent on base skins and on
   *  standalone crafted skins. */
  setId?: string;
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

/** The painted whole skins of one part set (empty for every set
 *  until a set painting is commissioned + approved). */
export function setSkinsForSet(setId: string): HunterSkinDef[] {
  return HUNTER_SKINS.filter((skin) => skin.setId === setId);
}

// ─── Server ownership record (slice (d)) ─────────────────────────

/**
 * The item_instances payload of a whole-skin item. Written by the
 * craft finalizers (origin 'crafted') and by set conversion
 * (origin 'converted'), read by the cosmetics view. Like the part
 * payload there are deliberately NO stat fields — a skin has
 * nothing for a mechanics path to read (check D4's hard law).
 */
export interface CosmeticSkinPayload {
  name: string;
  skinId: string;
  hunterId: HunterId;
  setId: string | null;
  quality: number;
  origin: 'crafted' | 'converted';
  craftedBy: string | null;
}

/** Build the payload for a newly granted whole skin (the one
 *  constructor — Pg, InMemory, and conversion stamp identical
 *  payloads). Returns null for an unknown skin def. */
export function buildCosmeticSkinPayload(
  skinId: string,
  quality: number,
  origin: 'crafted' | 'converted',
  craftedBy: string | null,
): CosmeticSkinPayload | null {
  const def = skinById(skinId);
  if (!def || def.base) return null;
  return {
    name: def.name,
    skinId: def.id,
    hunterId: def.hunterId,
    setId: def.setId ?? null,
    quality,
    origin,
    craftedBy,
  };
}

export function isCosmeticSkinPayload(value: unknown): value is CosmeticSkinPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.skinId === 'string' &&
    typeof p.hunterId === 'string' &&
    typeof p.quality === 'number' &&
    !!skinById(p.skinId as string)
  );
}

// ─── Ownership seam ──────────────────────────────────────────────

/**
 * The client-side mirror of the server ownership record: the
 * cosmetics slice hydrates this from the cosmetics view's `skins`
 * array on every load, and the market/trade flows refresh the
 * view after a transfer. Server code never reads this registry —
 * it reads item rows; this exists so the Wardrobe's synchronous
 * `isSkinOwned` seam can answer without a store import cycle.
 */
let ownedSkinIds: ReadonlySet<string> = new Set();

export function setOwnedSkinIds(ids: Iterable<string>): void {
  ownedSkinIds = new Set(ids);
}

export function ownedSkinIdSnapshot(): ReadonlySet<string> {
  return ownedSkinIds;
}

/**
 * Ownership: base skins are owned by definition; any other skin
 * is owned exactly when the server record (mirrored above) holds
 * an item for its def. Callers must go through here, never read
 * `base` or the mirror directly.
 */
export function isSkinOwned(skin: HunterSkinDef): boolean {
  return skin.base || ownedSkinIds.has(skin.id);
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

// ─── Complete-set conversion (slice (d)) ─────────────────────────

/**
 * The conversion rule, pure: given the part ids an account owns
 * and the skin def ids it already holds, the set skins it should
 * be granted — one per (set × painted hunter) whose COMPLETE part
 * list is owned and whose skin is not already held. Partial sets
 * grant nothing; parts are never consumed (they grandfather as
 * collection pieces). With today's catalog (no set skins) this
 * always returns [] — the gate is the painting, by design.
 */
export function evaluateSetConversions(
  ownedPartIds: ReadonlySet<string>,
  heldSkinIds: ReadonlySet<string>,
  catalog: readonly HunterSkinDef[] = HUNTER_SKINS,
): HunterSkinDef[] {
  const grants: HunterSkinDef[] = [];
  for (const skin of catalog) {
    if (!skin.setId || skin.base || heldSkinIds.has(skin.id)) continue;
    const parts = skinPartsForSet(skin.setId);
    if (parts.length === 0) continue;
    if (parts.every((part) => ownedPartIds.has(part.id))) grants.push(skin);
  }
  return grants;
}
