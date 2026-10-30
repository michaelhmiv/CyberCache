import manifestData from '@/assets/pixel/manifest.json';

/**
 * Pixel sprite manifest — the single registry for P1+ pixel art.
 *
 * Sprites are produced by `scripts/pixel-key.py` (magenta chroma-key + trim +
 * canonical downscale). Every sprite carries normalized (0..1) anchor points
 * measured from its alpha mask; components position actors and FX from these
 * anchors (feet for ground placement, muzzle for tracers, lootPoint for drop
 * beams) — never hand-tuned pixel offsets per screen.
 */

export type PixelSpriteKind = 'character' | 'enemy' | 'prop' | 'weapon-legendary' | 'background';

export interface PixelAnchor {
  x: number;
  y: number;
}

export interface PixelSprite {
  id: string;
  /** Resolved asset URL (Vite-bundled). */
  url: string;
  width: number;
  height: number;
  kind: PixelSpriteKind;
  anchors: Record<string, PixelAnchor>;
}

interface ManifestEntry {
  src: string;
  width: number;
  height: number;
  kind: PixelSpriteKind;
  anchors: Record<string, PixelAnchor>;
}

interface ManifestFile {
  version: number;
  texel: number;
  sprites: Record<string, ManifestEntry>;
}

const manifest = manifestData as ManifestFile;

/** Canonical texel size (source pixels per rendered pixel at 1x). */
export const PIXEL_TEXEL = manifest.texel;

const spriteUrls = import.meta.glob<string>('../../assets/pixel/sprites/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const urlByFileName = new Map<string, string>();
for (const [path, url] of Object.entries(spriteUrls)) {
  urlByFileName.set(path.split('/').pop() ?? path, url);
}

const sprites = new Map<string, PixelSprite>();
for (const [id, entry] of Object.entries(manifest.sprites)) {
  const fileName = entry.src.split('/').pop() ?? entry.src;
  const url = urlByFileName.get(fileName);
  if (!url) continue; // integrity is enforced by src/test/pixelManifest.test.ts
  sprites.set(id, {
    id,
    url,
    width: entry.width,
    height: entry.height,
    kind: entry.kind,
    anchors: entry.anchors,
  });
}

export function getPixelSprite(id: string): PixelSprite | undefined {
  return sprites.get(id);
}

export function requirePixelSprite(id: string): PixelSprite {
  const sprite = sprites.get(id);
  if (!sprite) throw new Error(`Unknown pixel sprite: ${id}`);
  return sprite;
}

export function listPixelSprites(): PixelSprite[] {
  return [...sprites.values()];
}

/** Raw manifest (ids + entries) — used by integrity tests and tooling. */
export function getPixelManifest(): ManifestFile {
  return manifest;
}

/**
 * Resolve an anchor to pixel coordinates inside a rendered box of
 * `renderWidth` x `renderHeight`. Falls back to centerMass, then center.
 */
export function anchorPoint(
  sprite: PixelSprite,
  anchorName: string,
  renderWidth: number,
  renderHeight: number,
): { x: number; y: number } {
  const anchor = sprite.anchors[anchorName] ?? sprite.anchors.centerMass ?? { x: 0.5, y: 0.5 };
  return { x: anchor.x * renderWidth, y: anchor.y * renderHeight };
}

/**
 * Bespoke legendary weapon sprites, keyed by normalized weapon name.
 * Legendaries have fixed identities, so they get fixed art (production spec
 * §3) — the Emberfall rifle from the approved loot proof is the first entry.
 * Procedural weapons never hit this map; they render through the parts-kit
 * compositor (src/lib/pixel/weaponCompositor.ts).
 */
export const BESPOKE_LEGENDARY_SPRITES: Record<string, string> = {
  emberfall: 'legendary-emberfall',
};

export function bespokeSpriteIdForWeaponName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return BESPOKE_LEGENDARY_SPRITES[name.trim().toLowerCase()];
}

/**
 * Roaming-area id -> pixel background sprite id, for areas whose diorama has
 * been converted to pixel art. P1 converts one zone (Dustwaste Frontier, the
 * default area); P4 converts the rest. Areas absent here keep the vector
 * diorama.
 */
export const PIXEL_AREA_BACKGROUNDS: Record<string, string> = {
  dustwaste_frontier: 'zone-dustwaste-bg',
};

export function pixelBackgroundForArea(areaId: string): string | undefined {
  return PIXEL_AREA_BACKGROUNDS[areaId];
}
