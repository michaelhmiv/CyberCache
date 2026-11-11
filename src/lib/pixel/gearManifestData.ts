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
