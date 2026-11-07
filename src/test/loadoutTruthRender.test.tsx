import { describe, expect, it } from 'vitest';
import { blit, newCanvas } from '@/lib/pixel/sceneRenderer';
import type { RgbaImage } from '@/lib/pixel/pngCodec';
import { PART_POSES, PART_SLOTS, PARTS_FEET_X, SKELETON, WEAPON_PAINT_ORDER } from '@/lib/pixel/parts';
import {
  composePartSet,
  compositorWeaponFractions,
  layoutPartSet,
  PARTS_WEAPON_TARGET_W,
  rasterizeWeaponCardRaster,
  type PartsRender,
} from '@/lib/pixel/partsCompositor';
import { composeWeaponCard } from '@/lib/pixel/weaponCardCompositor';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import { decodePng } from '@/lib/pixel/pngCodec';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import sprites from '@/assets/pixel/manifest.json';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';

/**
 * Loadout-truth pixel identity (S6, parts edition M2): the character
 * must carry the ACTUAL equipped weapon and nothing else. Presence
 * assertions cannot catch a second, baked-in gun under the real one —
 * so these tests work on rendered pixels through the parts
 * compositor, the same path the golden scenes use:
 *
 *  - the part set contains no deleted rifle-crop sprite, and the
 *    parts-only render paints NOTHING beyond the hand in the aim
 *    pose (a baked barrel ran ~90 px past the hands in the old art);
 *  - an armed render is EXACTLY the compositor's weapon layer over
 *    the parts — pixel for pixel, no third image hiding underneath;
 *  - different instances (type, manufacturer, parts) produce
 *    measurably different held renders.
 */

const spriteCache = new Map<string, RgbaImage | undefined>();
function loadSprite(id: string): RgbaImage | undefined {
  if (!spriteCache.has(id)) {
    const entry = (sprites as { sprites: Record<string, { src: string }> }).sprites[id];
    let img: RgbaImage | undefined;
    if (entry) {
      try {
        img = decodePng(new Uint8Array(readFileSync(join(process.cwd(), 'src/assets/pixel', entry.src))));
      } catch {
        img = undefined;
      }
    }
    spriteCache.set(id, img);
  }
  return spriteCache.get(id);
}

const GROUND = 0.86;
// The diorama's hunter placement and the boss stage's, respectively.
const DIORAMA = { xPct: 22, heightPct: 57 };
const BOSS = { xPct: 20, heightPct: 62 };

/** The actor's frame box on the scene canvas (the golden scenes'
 *  drawHunterParts math): feet anchor at xPct, soles on the ground. */
function frameBox(img: RgbaImage, place: { xPct: number; heightPct: number }): { x: number; y: number; w: number; h: number; scale: number } {
  const h = (place.heightPct / 100) * img.height;
  const scale = h / SKELETON.frameHeight;
  const w = SKELETON.frameWidth * scale;
  return { x: (place.xPct / 100) * img.width - PARTS_FEET_X * w, y: GROUND * img.height - h, w, h, scale };
}

function placeRender(img: RgbaImage, render: PartsRender, place: { xPct: number; heightPct: number }): void {
  const box = frameBox(img, place);
  blit(
    img,
    render.image,
    box.x + render.origin.x * box.scale,
    box.y + render.origin.y * box.scale,
    render.image.width * box.scale,
    render.image.height * box.scale,
  );
}

function renderParts(place = DIORAMA): RgbaImage {
  const img = newCanvas();
  placeRender(img, composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite), place);
  return img;
}

function renderArmed(weapon: PixelWeaponInput, place = DIORAMA): RgbaImage {
  const img = newCanvas();
  placeRender(
    img,
    composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
      weapon: { kind: 'compositor', input: weapon },
    }),
    place,
  );
  return img;
}

/** Count opaque pixels of a render inside a HUNTER-FRAME rect. */
function frameZoneCount(img: RgbaImage, fx0: number, fy0: number, fx1: number, fy1: number, place = DIORAMA): number {
  const box = frameBox(img, place);
  const sx = (fx: number) => Math.round(box.x + (fx / SKELETON.frameWidth) * box.w);
  const sy = (fy: number) => Math.round(box.y + (fy / SKELETON.frameHeight) * box.h);
  let count = 0;
  for (let y = sy(fy0); y < sy(fy1); y++) {
    for (let x = sx(fx0); x < sx(fx1); x++) {
      if (x >= 0 && y >= 0 && x < img.width && y < img.height && img.data[(y * img.width + x) * 4 + 3] > 12) count++;
    }
  }
  return count;
}

/** Re-stage a composed render layer by layer, in paint order — the
 *  independent reconstruction the armed render must match exactly. */
function renderLayered(render: PartsRender, place: { xPct: number; heightPct: number }, skipWeapon = false): RgbaImage {
  const img = newCanvas();
  const box = frameBox(img, place);
  const ordered = PART_SLOTS.filter(({ slot }) => render.layers.has(slot))
    .map(({ slot, paintOrder }) => ({ key: slot as string, order: paintOrder }))
    .concat(render.layers.has('weapon') && !skipWeapon ? [{ key: 'weapon', order: WEAPON_PAINT_ORDER }] : [])
    .sort((a, b) => a.order - b.order);
  for (const { key } of ordered) {
    const layer = render.layers.get(key)!;
    blit(
      img,
      layer,
      box.x + render.origin.x * box.scale,
      box.y + render.origin.y * box.scale,
      layer.width * box.scale,
      layer.height * box.scale,
    );
  }
  return img;
}

/** The weapon layer, built independently of composePartSet's weapon
 *  path: the instance's own HELD card raster (One Grammar), blitted
 *  onto an empty frame at the resolved grip joint with the layout's
 *  fractions. */
function buildWeaponLayer(weapon: PixelWeaponInput): RgbaImage {
  const render = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
    weapon: { kind: 'compositor', input: weapon },
  });
  const fractions = compositorWeaponFractions(weapon);
  const layout = layoutPartSet(STANDARD_ISSUE, PART_POSES.aim, fractions);
  const raster = rasterizeWeaponCardRaster(composeWeaponCard(weapon, undefined, { held: true }));
  const targetW = PARTS_WEAPON_TARGET_W;
  const targetH = Math.round((targetW * raster.height) / raster.width);
  const layer = newCanvas(render.image.width, render.image.height);
  blit(
    layer,
    raster,
    layout.joints.grip.x - fractions.gripFrac.x * targetW - render.origin.x,
    layout.joints.grip.y - fractions.gripFrac.y * targetH - render.origin.y,
    targetW,
    targetH,
  );
  return layer;
}

function diffCount(a: RgbaImage, b: RgbaImage): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) n++;
  }
  return n;
}

const PISTOL: PixelWeaponInput = {
  id: 'truth-pistol',
  name: 'Common Kinetic Pistol',
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Ironwood,
  element: Element.Kinetic,
  rarity: Rarity.Common,
  pixelSeed: 1234,
  affixes: [],
  rollQuality: 50,
};

const PISTOL_OTHER: PixelWeaponInput = {
  ...PISTOL,
  id: 'truth-pistol-other',
  manufacturer: Manufacturer.Redline,
  element: Element.Shock,
  rarity: Rarity.Rare,
  pixelSeed: 987,
  rollQuality: 64,
};

const SHOTGUN: PixelWeaponInput = {
  id: 'truth-shotgun',
  name: 'Epic Fire Shotgun',
  weaponType: WeaponType.Shotgun,
  manufacturer: Manufacturer.BlastForge,
  element: Element.Fire,
  rarity: Rarity.Epic,
  pixelSeed: 777,
  affixes: [],
  rollQuality: 82,
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } },
    { slot: 'Grip', modifier: { handling: 1.04 } },
    { slot: 'Core', modifier: { baseDamage: 1.02 } },
    { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
    { slot: 'Sight', modifier: { critChance: 1.06 } },
    { slot: 'Chamber', modifier: { fireRate: 0.98 } },
  ] as PixelWeaponInput['parts'],
};

const SHOTGUN_OTHER_PARTS: PixelWeaponInput = {
  ...SHOTGUN,
  id: 'truth-shotgun-other-parts',
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 0.92, handling: 1.12 } },
    { slot: 'Grip', modifier: { handling: 0.95 } },
    { slot: 'Core', modifier: { baseDamage: 1.11 } },
    { slot: 'Magazine', modifier: { magazineSize: 0.9 } },
    { slot: 'Sight', modifier: { critChance: 0.94 } },
    { slot: 'Chamber', modifier: { fireRate: 1.07 } },
  ] as PixelWeaponInput['parts'],
};

describe('loadout truth — the phantom rifle is gone from the part set', () => {
  it('no part of the set is one of the deleted rifle-crop sprites', () => {
    const spriteIds = Object.values(STANDARD_ISSUE.parts).map((p) => p?.spriteId);
    for (const deleted of [
      'hunter',
      'rig-hunter-torso',
      'rig-hunter-torso-unarmed',
      'rig-hunter-arm-upper',
      'rig-hunter-arm-fore',
      'rig-hunter-arm-off',
    ]) {
      expect(spriteIds, deleted).not.toContain(deleted);
    }
  });

  it('the parts alone paint nothing beyond the hand in the aim pose', () => {
    // The old shipped art's baked barrel ran to the frame's right
    // edge, ~90 px past the hands. The parts' hand resolves at the
    // grip joint; 20 px past it is fingers at most — a barrel would
    // paint hundreds of pixels in this zone.
    const render = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite);
    const grip = render.joints.grip;
    const img = newCanvas();
    placeRender(img, render, DIORAMA);
    expect(frameZoneCount(img, Math.ceil(grip.x) + 20, Math.floor(grip.y) - 30, SKELETON.frameWidth, Math.ceil(grip.y) + 30)).toBe(0);
  });

  it('the parts alone paint nothing beyond the hand at boss-stage placement', () => {
    const render = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite);
    const grip = render.joints.grip;
    const img = newCanvas();
    placeRender(img, render, BOSS);
    expect(
      frameZoneCount(img, Math.ceil(grip.x) + 20, Math.floor(grip.y) - 30, SKELETON.frameWidth, Math.ceil(grip.y) + 30, BOSS),
    ).toBe(0);
  });

  it('the hands are visibly at the grip (the pose is a hold)', () => {
    expect(frameZoneCount(renderParts(), 130, 100, 196, 150)).toBeGreaterThan(100);
  });
});

describe('loadout truth — the held render IS the equipped instance', () => {
  it('pistol: the weapon layer is exactly the instance render at the resolved grip', () => {
    const render = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
      weapon: { kind: 'compositor', input: PISTOL },
    });
    expect(diffCount(render.layers.get('weapon')!, buildWeaponLayer(PISTOL))).toBe(0);
  });

  it('shotgun: the weapon layer is exactly the instance render at the resolved grip', () => {
    const render = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
      weapon: { kind: 'compositor', input: SHOTGUN },
    });
    expect(diffCount(render.layers.get('weapon')!, buildWeaponLayer(SHOTGUN))).toBe(0);
  });

  it('the forearm wraps the grip: part of the weapon layer is covered by the hand in the composite', () => {
    const render = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
      weapon: { kind: 'compositor', input: SHOTGUN },
    });
    const weaponLayer = render.layers.get('weapon')!;
    let covered = 0;
    let visible = 0;
    for (let i = 0; i < render.image.data.length; i += 4) {
      if (weaponLayer.data[i + 3] <= 12) continue;
      const same =
        render.image.data[i] === weaponLayer.data[i] &&
        render.image.data[i + 1] === weaponLayer.data[i + 1] &&
        render.image.data[i + 2] === weaponLayer.data[i + 2];
      if (same) visible++;
      else covered++;
    }
    expect(covered).toBeGreaterThan(0);
    expect(visible).toBeGreaterThan(500);
  });

  it('diorama: the armed render is exactly its declared layers in paint order — no third image', () => {
    const render = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
      weapon: { kind: 'compositor', input: SHOTGUN },
    });
    expect(diffCount(renderArmed(SHOTGUN), renderLayered(render, DIORAMA))).toBe(0);
    expect(diffCount(renderParts(), renderLayered(render, DIORAMA, true))).toBe(0);
  });

  it('boss placement: the armed render is exactly its declared layers in paint order — no third image', () => {
    const render = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
      weapon: { kind: 'compositor', input: SHOTGUN },
    });
    expect(diffCount(renderArmed(SHOTGUN, BOSS), renderLayered(render, BOSS))).toBe(0);
    expect(diffCount(renderParts(BOSS), renderLayered(render, BOSS, true))).toBe(0);
  });

  it('a pistol and a shotgun produce measurably different held renders', () => {
    expect(diffCount(renderArmed(PISTOL), renderArmed(SHOTGUN))).toBeGreaterThan(300);
  });

  it('two pistols of different make/element/seed produce different held renders', () => {
    expect(diffCount(renderArmed(PISTOL), renderArmed(PISTOL_OTHER))).toBeGreaterThan(100);
  });

  it('the same shotgun with different rolled parts produces a different held render', () => {
    expect(diffCount(renderArmed(SHOTGUN), renderArmed(SHOTGUN_OTHER_PARTS))).toBeGreaterThan(10);
  });
});
