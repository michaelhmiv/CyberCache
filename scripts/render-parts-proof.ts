/**
 * Parts-system M1 proof render: the Standard Issue part set
 * composited over an empty frame (partsCompositor), shown over the
 * Dustwaste background — unarmed, pistol, sniper, and a bespoke
 * legendary (Thunder Receipt) — plus ×3 joint crops (grip, neck,
 * knee) as the human-read surface for gate G6.
 *
 * Dev/QC tooling only; nothing in the live render path uses this.
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/render-parts-proof.ts [out.png]
 * The background JPG is pre-converted to a temp PNG by the caller
 * (pngCodec is PNG-only): /tmp/dustwaste-bg.png.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sprites from '../src/assets/pixel/manifest.json';
import { decodePng, encodePng, type RgbaImage } from '../src/lib/pixel/pngCodec';
import { blit, newCanvas, type SpriteLoader } from '../src/lib/pixel/sceneRenderer';
import { PART_POSES } from '../src/lib/pixel/parts';
import { composePartSet, type PartsRender, type PartsWeapon } from '../src/lib/pixel/partsCompositor';
import { STANDARD_ISSUE } from '../src/lib/pixel/standardIssue';
import type { PixelWeaponInput } from '../src/lib/pixel/weaponCompositor';
import { Element, Manufacturer, Rarity, WeaponType } from '../src/types/game';

const cache = new Map<string, RgbaImage | undefined>();
const load: SpriteLoader = (id) => {
  if (!cache.has(id)) {
    const entry = (sprites.sprites as Record<string, { src: string }>)[id];
    cache.set(
      id,
      entry ? decodePng(new Uint8Array(readFileSync(join(process.cwd(), 'src/assets/pixel', entry.src)))) : undefined,
    );
  }
  return cache.get(id);
};

const PISTOL: PixelWeaponInput = {
  id: 'proof-pistol',
  name: 'Common Kinetic Pistol',
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Ironwood,
  element: Element.Kinetic,
  rarity: Rarity.Common,
  pixelSeed: 1234,
  affixes: [],
  rollQuality: 50,
};

const SNIPER: PixelWeaponInput = {
  id: 'proof-sniper',
  name: 'Epic Shock Sniper',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Prismatek,
  element: Element.Shock,
  rarity: Rarity.Epic,
  pixelSeed: 4242,
  affixes: [],
  rollQuality: 82,
};

const thunder = (sprites.sprites as Record<string, { anchors: Record<string, { x: number; y: number }> }>)[
  'legendary-thunder-receipt'
];

const PANEL = 420;
const SCALE = 0.92;

function panel(render: PartsRender, bg: RgbaImage): RgbaImage {
  const img = newCanvas(PANEL, PANEL);
  // Cover-fit the background into the panel.
  const bgScale = Math.max(PANEL / bg.width, PANEL / bg.height);
  const bw = Math.round(bg.width * bgScale);
  const bh = Math.round(bg.height * bgScale);
  blit(img, bg, (PANEL - bw) / 2, (PANEL - bh) / 2, bw, bh);
  // Hunter: stage ground line (y=320) lands on the background's
  // ground line (0.86 of the source frame, cover-mapped).
  const groundPanelY = (PANEL - bh) / 2 + 0.86 * bh;
  const dw = Math.round(render.image.width * SCALE);
  const dh = Math.round(render.image.height * SCALE);
  const groundBufferY = 320 - render.origin.y;
  const dx = PANEL / 2 - (130 - render.origin.x) * SCALE;
  const dy = groundPanelY - groundBufferY * SCALE;
  blit(img, render.image, dx, dy, dw, dh);
  return img;
}

function cropX3(render: PartsRender, cx: number, cy: number, half = 34): RgbaImage {
  const sc = 3;
  const img = newCanvas(half * 2 * sc, half * 2 * sc);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 24;
    img.data[i + 1] = 24;
    img.data[i + 2] = 34;
    img.data[i + 3] = 255;
  }
  for (let y = 0; y < half * 2; y++) {
    for (let x = 0; x < half * 2; x++) {
      const sx = Math.round(cx - render.origin.x) - half + x;
      const sy = Math.round(cy - render.origin.y) - half + y;
      if (sx < 0 || sy < 0 || sx >= render.image.width || sy >= render.image.height) continue;
      const si = (sy * render.image.width + sx) * 4;
      if (render.image.data[si + 3] === 0) continue;
      for (let ddy = 0; ddy < sc; ddy++) {
        for (let ddx = 0; ddx < sc; ddx++) {
          const di = ((y * sc + ddy) * img.width + x * sc + ddx) * 4;
          img.data[di] = render.image.data[si];
          img.data[di + 1] = render.image.data[si + 1];
          img.data[di + 2] = render.image.data[si + 2];
          img.data[di + 3] = 255;
        }
      }
    }
  }
  return img;
}

function main(): void {
  const bg = decodePng(new Uint8Array(readFileSync('/tmp/dustwaste-bg.png')));
  const weapons: (PartsWeapon | undefined)[] = [
    undefined,
    { kind: 'compositor', input: PISTOL },
    { kind: 'compositor', input: SNIPER },
    {
      kind: 'bespoke',
      spriteId: 'legendary-thunder-receipt',
      grip: thunder?.anchors.grip,
      muzzle: thunder?.anchors.muzzle,
    },
  ];
  const renders = weapons.map((weapon) =>
    composePartSet(STANDARD_ISSUE, weapon ? PART_POSES.aim : PART_POSES.idle, load, { weapon }),
  );
  const sheet = newCanvas(PANEL * 4, PANEL + 204);
  renders.forEach((render, i) => {
    blit(sheet, panel(render, bg), i * PANEL, 0, PANEL, PANEL);
  });
  // Joint crops from the sniper render (the long-weapon grip chain
  // is the demanding case) + the unarmed neck/knee.
  const sniper = renders[2];
  const grip = sniper.joints.grip;
  const neck = sniper.anchorStages.get('head:neckSeat')!;
  const knee = sniper.anchorStages.get('lowerLegF:knee')!;
  const crops = [cropX3(sniper, grip.x, grip.y), cropX3(sniper, neck.x, neck.y), cropX3(sniper, knee.x, knee.y)];
  crops.forEach((crop, i) => {
    blit(sheet, crop, i * 204 + 8, PANEL, 204, 204);
  });
  const out = process.argv[2] ?? '/tmp/parts-m1-proof-raw.png';
  writeFileSync(out, encodePng(sheet));
  console.log(`proof sheet -> ${out} (${sheet.width}x${sheet.height})`);
  for (const [i, r] of renders.entries()) {
    console.log(
      `panel ${i}: grip stage (${r.joints.grip.x.toFixed(1)}, ${r.joints.grip.y.toFixed(1)})` +
        (r.joints.muzzle ? ` muzzle (${r.joints.muzzle.x.toFixed(1)}, ${r.joints.muzzle.y.toFixed(1)})` : ''),
    );
  }
}

main();
