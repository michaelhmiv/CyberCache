/**
 * Painted weapon renderer (Top-Choice renderer slice, 2026-11-11).
 *
 * Pins the production law:
 *  - every real weapon (all 36 type x manufacturer bases, all 26
 *    named legendaries) resolves to its adopted painting — the
 *    texel compositor geometry path no longer paints weapon bodies
 *    for production inputs;
 *  - resolution order: bespoke legendary painting BEFORE the
 *    type x manufacturer base painting;
 *  - the zone data is complete and closed: every base has a glow
 *    zone and a swap per element, and a swap's keys are exactly
 *    the zone's glow colors (body/trim can never re-light);
 *  - the render order is painting base -> element swap -> fit ->
 *    decals -> condition: the element swap changes only zone
 *    pixels, decals land on body pixels in grid space, and wear
 *    only ever removes pixels the painting put down.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Affix } from '@/types/items';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { decodePng, type RgbaImage } from '@/lib/pixel/pngCodec';
import { getManifestEntry } from '@/lib/pixel/gearManifestData';
import { BESPOKE_LEGENDARY_SPRITES } from '@/lib/pixel/legendaryArt';
import {
  LEGENDARY_PAINTING_SLUGS,
  WEAPON_BASE_PAINTING_STEMS,
} from '@/lib/pixel/weaponPaintingData';
import { WEAPON_PAINTING_ZONES } from '@/lib/pixel/weaponPaintingZones';
import {
  applyWeaponElementSwap,
  renderWeaponPainting,
  resolveWeaponPainting,
  weaponBaseStem,
  weaponPaintingFractions,
  weaponPaintingShell,
} from '@/lib/pixel/weaponPaintingRender';

function loadSprite(spriteId: string): RgbaImage {
  const entry = getManifestEntry(spriteId);
  if (!entry) throw new Error(`test: ${spriteId} is not in the manifest`);
  return decodePng(new Uint8Array(readFileSync(join(process.cwd(), 'src/assets/pixel', entry.src))));
}

function baseInput(weaponType: WeaponType, manufacturer: Manufacturer, extra: Partial<PixelWeaponInput> = {}): PixelWeaponInput {
  return {
    weaponType,
    manufacturer,
    rarity: Rarity.Rare,
    element: Element.Kinetic,
    id: `test-${weaponType}-${manufacturer}`,
    pixelSeed: 1234,
    rollQuality: 70,
    ...extra,
  };
}

const AFFIX: Affix = { id: 'af-1', category: 'combat', stat: 'critChance', value: 5, displayText: '+5% Crit Chance' };

const TYPES = Object.values(WeaponType);
const MAKERS = Object.values(Manufacturer);
const ELEMENTS = Object.values(Element);

describe('painting resolution (production law)', () => {
  it('every type x manufacturer resolves to its base painting', () => {
    for (const type of TYPES) {
      for (const maker of MAKERS) {
        const res = resolveWeaponPainting(baseInput(type, maker));
        expect(res, `${type} x ${maker}`).toBeDefined();
        expect(res!.kind).toBe('base');
        expect(res!.stem).toBe(weaponBaseStem(type, maker));
        expect(res!.spriteId).toBe(`weapon-base-${weaponBaseStem(type, maker)}`);
      }
    }
    expect(WEAPON_BASE_PAINTING_STEMS).toHaveLength(36);
  });

  it('every named legendary resolves to its bespoke painting, ahead of its base', () => {
    expect(LEGENDARY_PAINTING_SLUGS).toHaveLength(26);
    for (const [name, bespokeId] of Object.entries(BESPOKE_LEGENDARY_SPRITES)) {
      const slug = bespokeId.replace(/^legendary-/, '');
      // The input ALSO carries a type x manufacturer: legendary
      // resolution must win over the base painting.
      const res = resolveWeaponPainting(
        baseInput(WeaponType.Pistol, Manufacturer.Redline, { name, rarity: Rarity.Legendary }),
      );
      expect(res, name).toBeDefined();
      expect(res!.kind).toBe('legendary');
      expect(res!.spriteId).toBe(`legendary-painting-${slug}`);
    }
  });
});

describe('element zone data', () => {
  it('every base has a non-empty glow zone and a swap for every element', () => {
    for (const stem of WEAPON_BASE_PAINTING_STEMS) {
      const zone = WEAPON_PAINTING_ZONES[stem];
      expect(zone, stem).toBeDefined();
      expect(zone.glow.length, stem).toBeGreaterThan(0);
      for (const element of ELEMENTS) {
        const table = zone.swaps[element];
        expect(table, `${stem} ${element}`).toBeDefined();
        expect(Object.keys(table!).length).toBe(zone.glow.length);
      }
    }
  });

  it("a swap's keys are exactly the zone's glow colors — body and trim can never re-light", () => {
    for (const stem of WEAPON_BASE_PAINTING_STEMS) {
      const zone = WEAPON_PAINTING_ZONES[stem];
      const glowKeys = new Set(zone.glow.map(([r, g, b]) => `${r},${g},${b}`));
      for (const element of ELEMENTS) {
        expect(new Set(Object.keys(zone.swaps[element]!)), `${stem} ${element}`).toEqual(glowKeys);
      }
    }
  });

  // Explicit timeout: this pin scans every pixel of all 36
  // full-res base sprites (data verification, not a behavior
  // loop) — on a contended 1.5-CPU runner the default 5s is not
  // enough headroom; the assertions are unchanged.
  it('every glow color actually occurs in its sprite, and zone share is sane', () => {
    for (const stem of WEAPON_BASE_PAINTING_STEMS) {
      const zone = WEAPON_PAINTING_ZONES[stem];
      const sprite = loadSprite(`weapon-base-${stem}`);
      const present = new Set<string>();
      let fg = 0;
      let zonePx = 0;
      const glowKeys = new Set(zone.glow.map(([r, g, b]) => `${r},${g},${b}`));
      const rect = zone.rect;
      for (let y = 0; y < sprite.height; y += 1) {
        for (let x = 0; x < sprite.width; x += 1) {
          const i = (y * sprite.width + x) * 4;
          if (sprite.data[i + 3] <= 8) continue;
          fg += 1;
          const key = `${sprite.data[i]},${sprite.data[i + 1]},${sprite.data[i + 2]}`;
          if (glowKeys.has(key)) {
            present.add(key);
            if (
              !rect ||
              (x >= rect[0] * sprite.width && x < rect[2] * sprite.width &&
                y >= rect[1] * sprite.height && y < rect[3] * sprite.height)
            ) {
              zonePx += 1;
            }
          }
        }
      }
      expect(present.size, stem).toBe(glowKeys.size);
      const share = zonePx / fg;
      expect(share, stem).toBeGreaterThan(0.002);
      expect(share, stem).toBeLessThan(0.25);
    }
  }, 60000);
});

describe('render order: painting base -> overlays', () => {
  it('the element swap changes only zone pixels (beam-helix-works, the zone-proof base)', () => {
    const input = baseInput(WeaponType.Beam, Manufacturer.HelixWorks, { element: Element.Fire });
    const res = resolveWeaponPainting(input)!;
    const sprite = loadSprite(res.spriteId);
    const swapped = applyWeaponElementSwap(sprite, res);
    const zone = WEAPON_PAINTING_ZONES['beam-helix-works'];
    const glowKeys = new Set(zone.glow.map(([r, g, b]) => `${r},${g},${b}`));
    let changed = 0;
    for (let i = 0; i < sprite.data.length; i += 4) {
      const same =
        sprite.data[i] === swapped.data[i] &&
        sprite.data[i + 1] === swapped.data[i + 1] &&
        sprite.data[i + 2] === swapped.data[i + 2] &&
        sprite.data[i + 3] === swapped.data[i + 3];
      if (same) continue;
      changed += 1;
      // Every changed pixel was a glow-zone color, and alpha never moves.
      expect(glowKeys.has(`${sprite.data[i]},${sprite.data[i + 1]},${sprite.data[i + 2]}`)).toBe(true);
      expect(swapped.data[i + 3]).toBe(sprite.data[i + 3]);
    }
    expect(changed).toBeGreaterThan(1000);
  });

  it('a newly-zoned base (smg-redline, rect-gated) re-lights only inside its window rect', () => {
    const input = baseInput(WeaponType.SMG, Manufacturer.Redline, { element: Element.Void });
    const res = resolveWeaponPainting(input)!;
    const sprite = loadSprite(res.spriteId);
    const swapped = applyWeaponElementSwap(sprite, res);
    const rect = WEAPON_PAINTING_ZONES['smg-redline'].rect!;
    let changed = 0;
    for (let y = 0; y < sprite.height; y += 1) {
      for (let x = 0; x < sprite.width; x += 1) {
        const i = (y * sprite.width + x) * 4;
        if (sprite.data[i] === swapped.data[i] && sprite.data[i + 1] === swapped.data[i + 1] && sprite.data[i + 2] === swapped.data[i + 2]) continue;
        changed += 1;
        expect(x).toBeGreaterThanOrEqual(Math.floor(rect[0] * sprite.width));
        expect(x).toBeLessThan(Math.ceil(rect[2] * sprite.width));
        expect(y).toBeGreaterThanOrEqual(Math.floor(rect[1] * sprite.height));
        expect(y).toBeLessThan(Math.ceil(rect[3] * sprite.height));
      }
    }
    expect(changed).toBeGreaterThan(100);
  });

  it('decals stamp after the fit, on body pixels, in the decal color', () => {
    const base = baseInput(WeaponType.Sniper, Manufacturer.Ironwood, {
      element: Element.Corrosive,
      rollQuality: 70,
    });
    const withAffix = { ...base, affixes: [AFFIX] };
    const res = resolveWeaponPainting(withAffix)!;
    const sprite = loadSprite(res.spriteId);
    const plain = renderWeaponPainting(base, res, 'card', sprite);
    const stamped = renderWeaponPainting(withAffix, res, 'card', sprite);
    expect(stamped.decals.length).toBeGreaterThan(0);
    const decal = stamped.decals[0];
    const want = decal.color.replace('#', '');
    const wantRgb = [
      parseInt(want.slice(0, 2), 16),
      parseInt(want.slice(2, 4), 16),
      parseInt(want.slice(4, 6), 16),
    ];
    // Diff the two renders: the ONLY differences are the decal's
    // stamped cells, each exactly the decal color at full alpha —
    // decals land after the painting fit and touch nothing else.
    // (rollQuality 70 is 'clean': no wear, no sparkles either side.)
    const cx = Math.round((decal.x / 200) * stamped.width);
    const cy = Math.round((decal.y / 80) * stamped.height);
    let diffs = 0;
    let nearCenter = 0;
    for (let y = 0; y < stamped.height; y += 1) {
      for (let x = 0; x < stamped.width; x += 1) {
        const i = (y * stamped.width + x) * 4;
        const same =
          plain.image.data[i] === stamped.image.data[i] &&
          plain.image.data[i + 1] === stamped.image.data[i + 1] &&
          plain.image.data[i + 2] === stamped.image.data[i + 2] &&
          plain.image.data[i + 3] === stamped.image.data[i + 3];
        if (same) continue;
        diffs += 1;
        expect([stamped.image.data[i], stamped.image.data[i + 1], stamped.image.data[i + 2]]).toEqual(wantRgb);
        expect(stamped.image.data[i + 3]).toBe(255);
        // The stamp replaced a body pixel — the plain render was opaque there.
        expect(plain.image.data[i + 3]).toBeGreaterThan(8);
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= 12) nearCenter += 1;
      }
    }
    expect(diffs).toBeGreaterThan(0);
    expect(nearCenter).toBeGreaterThan(0);
  });

  it('condition wear only removes painting pixels; mint keeps them all', () => {
    const sprite = loadSprite('weapon-base-pistol-blast-forge');
    const countOpaque = (img: RgbaImage) => {
      let n = 0;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 8) n += 1;
      return n;
    };
    const mint = renderWeaponPainting(
      baseInput(WeaponType.Pistol, Manufacturer.BlastForge, { rollQuality: 90 }),
      resolveWeaponPainting(baseInput(WeaponType.Pistol, Manufacturer.BlastForge))!,
      'card',
      sprite,
    );
    const wornInput = baseInput(WeaponType.Pistol, Manufacturer.BlastForge, { rollQuality: 10 });
    const worn = renderWeaponPainting(wornInput, resolveWeaponPainting(wornInput)!, 'card', sprite);
    expect(mint.condition).toBe('mint');
    expect(worn.condition).toBe('beat-up');
    expect(countOpaque(worn.image)).toBeLessThan(countOpaque(mint.image));
    // Wear never ADDS a pixel: every worn-opaque pixel is mint-opaque.
    for (let i = 3; i < mint.image.data.length; i += 4) {
      if (worn.image.data[i] > 8) expect(mint.image.data[i]).toBeGreaterThan(8);
    }
  });

  it('a legendary render carries decals/condition as fields but never stamps them (V4 law)', () => {
    const input = baseInput(WeaponType.Launcher, Manufacturer.Prismatek, {
      name: 'Glass Sun',
      rarity: Rarity.Legendary,
      rollQuality: 5,
      affixes: [AFFIX],
    });
    const res = resolveWeaponPainting(input)!;
    expect(res.kind).toBe('legendary');
    const sprite = loadSprite(res.spriteId);
    const render = renderWeaponPainting(input, res, 'card', sprite);
    expect(render.condition).toBe('beat-up');
    expect(render.decals.length).toBeGreaterThan(0);
    // No wear: pixel count equals a no-overlay fit of the same sprite.
    const countOpaque = (img: RgbaImage) => {
      let n = 0;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 8) n += 1;
      return n;
    };
    const cleanInput = { ...input, rollQuality: 90, affixes: [] };
    const clean = renderWeaponPainting(cleanInput, res, 'card', sprite);
    expect(countOpaque(render.image)).toBe(countOpaque(clean.image));
    expect(new Uint8Array(render.image.data)).toEqual(new Uint8Array(clean.image.data));
  });

  it('shell anchors and stage fractions stay inside the grid', () => {
    for (const type of TYPES) {
      for (const maker of MAKERS) {
        const input = baseInput(type, maker);
        const res = resolveWeaponPainting(input)!;
        const shell = weaponPaintingShell(input, res, 'held');
        for (const anchor of Object.values(shell.anchors)) {
          expect(anchor.x).toBeGreaterThanOrEqual(0);
          expect(anchor.x).toBeLessThanOrEqual(shell.width);
          expect(anchor.y).toBeGreaterThanOrEqual(0);
          expect(anchor.y).toBeLessThanOrEqual(shell.height);
        }
        const fractions = weaponPaintingFractions(res)!;
        expect(fractions.aspect).toBeCloseTo(88 / 240, 6);
        expect(fractions.gripFrac.x).toBeGreaterThan(0);
        expect(fractions.gripFrac.x).toBeLessThan(1);
        expect(fractions.muzzleFrac.x).toBeGreaterThan(fractions.gripFrac.x);
      }
    }
  });
});
