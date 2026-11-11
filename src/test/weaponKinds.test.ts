/**
 * Weapon painting production invariants (Top-Choice INT-1) — the 62
 * adopted weapon paintings (26 legendaries + 36 bases) are registered
 * production sprites with measured trim records, and the production
 * operations in src/lib/pixel/spriteProduction.ts round-trip them
 * exactly:
 *
 *   - kinds: legendary paintings carry kind 'weapon-legendary' under
 *     the legendary-painting-* id space (the bespoke legendary-<slug>
 *     ids stay authored data, never sprites — pixelManifest.test.ts);
 *     base paintings carry kind 'weapon-base' under weapon-base-*.
 *   - trim: untrimSprite places a sprite on its master's full canvas;
 *     retrimSprite re-measures the same record from the alpha mask;
 *     trimSprite cuts the sprite back out pixel-identically.
 *
 * Sprite bytes are read from disk and decoded with the repo codec —
 * the same files the manifest payload test weighs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestData from '@/assets/pixel/manifest.json';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { decodePng } from '@/lib/pixel/pngCodec';
import {
  LEGENDARY_PAINTING_SLUGS,
  WEAPON_BASE_PAINTING_STEMS,
  legendaryPaintingSpriteId,
  retrimSprite,
  trimSprite,
  untrimSprite,
  weaponBaseSpriteId,
  weaponPaintingTrim,
} from '@/lib/pixel/spriteProduction';

interface ManifestEntryLike {
  src: string;
  kind: string;
  width: number;
  height: number;
}
const sprites = (manifestData as { sprites: Record<string, ManifestEntryLike> }).sprites;

const PAINTING_IDS = [
  ...LEGENDARY_PAINTING_SLUGS.map(legendaryPaintingSpriteId),
  ...WEAPON_BASE_PAINTING_STEMS.map(weaponBaseSpriteId),
];

function loadSprite(id: string) {
  const entry = sprites[id];
  if (!entry) throw new Error(`weaponKinds: ${id} is not registered in the manifest`);
  return decodePng(new Uint8Array(readFileSync(join(process.cwd(), 'src/assets/pixel', entry.src))));
}

describe('weapon painting sprites (INT-1)', () => {
  it('all 62 paintings are registered under their production kinds', () => {
    expect(LEGENDARY_PAINTING_SLUGS).toHaveLength(26);
    expect(WEAPON_BASE_PAINTING_STEMS).toHaveLength(36);
    expect(PAINTING_IDS).toHaveLength(62);
    for (const slug of LEGENDARY_PAINTING_SLUGS) {
      const id = legendaryPaintingSpriteId(slug);
      expect(sprites[id]?.kind, id).toBe('weapon-legendary');
      expect(getPixelSprite(id)?.kind, id).toBe('weapon-legendary');
    }
    for (const stem of WEAPON_BASE_PAINTING_STEMS) {
      const id = weaponBaseSpriteId(stem);
      expect(sprites[id]?.kind, id).toBe('weapon-base');
      expect(getPixelSprite(id)?.kind, id).toBe('weapon-base');
    }
  });

  it('trim / untrim / retrim round-trips hold for every production sprite', () => {
    for (const id of PAINTING_IDS) {
      const entry = sprites[id];
      const sprite = loadSprite(id);
      expect([sprite.width, sprite.height], id).toEqual([entry.width, entry.height]);
      const trim = weaponPaintingTrim(id);
      const full = untrimSprite(sprite, trim);
      const measured = retrimSprite(full);
      expect(measured.trim, id).toEqual(trim);
      expect([measured.width, measured.height], id).toEqual([sprite.width, sprite.height]);
      const cutBack = trimSprite(full, trim, sprite.width, sprite.height);
      expect(Buffer.from(cutBack.data).equals(Buffer.from(sprite.data)), id).toBe(true);
    }
  }, 120_000);
});
