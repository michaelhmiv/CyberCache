import { describe, expect, it } from 'vitest';
import { drawHeldWeapon, drawRig, hunterBox, newCanvas, type RgbaImage } from '@/lib/pixel/sceneRenderer';
import { HUNTER_POSES, HUNTER_RIG } from '@/lib/pixel/rig';
import { decodePng } from '@/lib/pixel/pngCodec';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import sprites from '@/assets/pixel/manifest.json';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';

/**
 * Loadout-truth pixel identity (S6): the character must carry the
 * ACTUAL equipped weapon and nothing else. Presence assertions (the
 * old suite's ceiling) cannot catch a second, baked-in gun under the
 * real one — so these tests work on rendered pixels through the
 * reference renderer, the same path the golden scenes use:
 *
 *  - the armed rig alone paints NOTHING where the shipped art's
 *    baked rifle extended (the barrel zone);
 *  - an armed render is EXACTLY the compositor's render of that
 *    instance over the gun-free rig — pixel for pixel, no third
 *    image hiding underneath;
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

function renderRig(place = DIORAMA): RgbaImage {
  const img = newCanvas();
  drawRig(img, loadSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.aim, xPct: place.xPct, heightPct: place.heightPct, feetX: 0.2717 }, GROUND);
  return img;
}

function renderWeaponOnly(weapon: PixelWeaponInput, place = DIORAMA): RgbaImage {
  const img = newCanvas();
  drawHeldWeapon(img, weapon, hunterBox(img, place.xPct, place.heightPct, GROUND));
  return img;
}

function renderArmed(weapon: PixelWeaponInput, place = DIORAMA): RgbaImage {
  const img = renderRig(place);
  drawHeldWeapon(img, weapon, hunterBox(img, place.xPct, place.heightPct, GROUND));
  return img;
}

/** Count opaque pixels of a render inside a HUNTER-FRAME rect. */
function frameZoneCount(img: RgbaImage, fx0: number, fy0: number, fx1: number, fy1: number, place = DIORAMA): number {
  const box = hunterBox(img, place.xPct, place.heightPct, GROUND);
  const sx = (fx: number) => Math.round(box.x + (fx / 260) * box.w);
  const sy = (fy: number) => Math.round(box.y + (fy / 320) * box.h);
  let count = 0;
  for (let y = sy(fy0); y < sy(fy1); y++) {
    for (let x = sx(fx0); x < sx(fx1); x++) {
      if (x >= 0 && y >= 0 && x < img.width && y < img.height && img.data[(y * img.width + x) * 4 + 3] > 12) count++;
    }
  }
  return count;
}

function diffCount(a: RgbaImage, b: RgbaImage): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) n++;
  }
  return n;
}

/** Pixels where `armed` is neither the rig's pixel (where the weapon
 *  is transparent) nor the compositor's pixel (where it is opaque) —
 *  i.e. evidence of a THIRD image under or over the held weapon. */
function thirdImagePixels(armed: RgbaImage, rig: RgbaImage, weaponOnly: RgbaImage): number {
  let n = 0;
  for (let i = 0; i < armed.data.length; i += 4) {
    const exp = weaponOnly.data[i + 3] > 12 ? weaponOnly : rig;
    if (armed.data[i] !== exp.data[i] || armed.data[i + 1] !== exp.data[i + 1] || armed.data[i + 2] !== exp.data[i + 2] || armed.data[i + 3] !== exp.data[i + 3]) n++;
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

describe('loadout truth — the phantom rifle is gone from the armed rig', () => {
  // Right of the hands: only the shipped art's baked barrel + muzzle
  // ever painted here. Hands end by frame x≈192; the zone starts 198.
  const BARREL_ZONE: [number, number, number, number] = [198, 90, 240, 150];

  it('no segment of the armed rig is a shipped rifle crop', () => {
    const spriteIds = HUNTER_RIG.segments.map((s) => s.spriteId);
    for (const shipped of ['rig-hunter-torso', 'rig-hunter-arm-upper', 'rig-hunter-arm-fore', 'rig-hunter-arm-off']) {
      expect(spriteIds, shipped).not.toContain(shipped);
    }
  });

  it('the armed rig alone paints nothing in the barrel zone', () => {
    expect(frameZoneCount(renderRig(), ...BARREL_ZONE)).toBe(0);
  });

  it('the armed rig alone paints nothing in the barrel zone at boss-stage placement', () => {
    expect(frameZoneCount(renderRig(BOSS), ...BARREL_ZONE, BOSS)).toBe(0);
  });

  it('the hands are visibly at the grip (the pose is a hold)', () => {
    expect(frameZoneCount(renderRig(), 130, 100, 196, 150)).toBeGreaterThan(100);
  });
});

describe('loadout truth — the held render IS the equipped instance', () => {
  it('pistol: the armed render is exactly the compositor pistol over the gun-free rig', () => {
    expect(thirdImagePixels(renderArmed(PISTOL), renderRig(), renderWeaponOnly(PISTOL))).toBe(0);
  });

  it('shotgun: the armed render is exactly the compositor shotgun over the gun-free rig', () => {
    expect(thirdImagePixels(renderArmed(SHOTGUN), renderRig(), renderWeaponOnly(SHOTGUN))).toBe(0);
  });

  it('boss placement: the armed render is exactly the compositor shotgun over the gun-free rig', () => {
    expect(thirdImagePixels(renderArmed(SHOTGUN, BOSS), renderRig(BOSS), renderWeaponOnly(SHOTGUN, BOSS))).toBe(0);
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
