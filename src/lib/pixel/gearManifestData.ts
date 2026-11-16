import manifestData from '@/assets/pixel/manifest.json';

/**
 * The sprite manifest as pure data — no Vite asset glob, so node-side
 * tooling (the wiki generator) can load modules that need declared
 * sprite geometry. manifest.ts re-exports this accessor; it owns the
 * glob and the resolved URLs, this module owns only the JSON.
 */

export interface GearManifestEntry {
  src: string;
  width: number;
  height: number;
  kind: string;
  anchors: Record<string, { x: number; y: number }>;
}

interface GearManifestFile {
  version: number;
  texel: number;
  sprites: Record<string, GearManifestEntry>;
}

const manifest = manifestData as unknown as GearManifestFile;

/** Declared manifest entry for a sprite id (dims, anchors, src). */
export function getManifestEntry(id: string): GearManifestEntry | undefined {
  return manifest.sprites[id];
}

/**
 * Every declared sprite id — the manifest's key set as pure data.
 * Used by the render layer to check a painted sprite exists WITHOUT
 * the glob-backed map (glob results differ across environments —
 * vite build, vitest, node — while the declaration never does).
 */
export function hasManifestEntry(id: string): boolean {
  return id in manifest.sprites;
}

/**
 * The Cache Hunters' paintings (reshape slices (b) + (c), Cast B —
 * owner ruling 2026-11-15, DESIGN.md §12: paintings only on stage —
 * the painting IS the stage figure, its signature weapon part of
 * the character). One painted whole per hunter; skins are painted
 * wholes over the same seat (slice (d) adds more ids beside these).
 * Keyed by HunterId (src/lib/hunters/hunters.ts). Slice (c)'s stage
 * renderer resolves the fielded hunter through this same map — the
 * ids are a shared contract, do not rename. Unknown ids resolve to
 * undefined and stage callers keep their fallback.
 *
 * The map lives HERE, with the pure data, not in manifest.ts:
 * the skin catalog (src/lib/hunters/hunterSkins.ts) is content the
 * wiki generator loads under node, where import.meta.glob does not
 * exist — the same reason this module exists. manifest.ts
 * re-exports it so existing import sites keep working.
 */
export const PIXEL_HUNTER_SPRITES: Record<string, string> = {
  vesper: 'hunter-vesper-cole',
  silas: 'hunter-silas-boone',
  josie: 'hunter-josie-lode',
  doc: 'hunter-doc-sutter',
};
