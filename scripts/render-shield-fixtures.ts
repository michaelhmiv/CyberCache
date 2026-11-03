/**
 * Shield grammar renderer (gear marriage, slice 1 working script).
 *
 *   npx tsx --tsconfig tsconfig.app.json scripts/render-shield-fixtures.ts <outDir>
 *
 * Rasterizes the production shield grammar (src/lib/pixel/
 * shieldGrammar.ts) through the real compositor into capture
 * sheets in <outDir>:
 *  - matrix-behaviors-x-elements.png — the full 5 behaviors × 6
 *    elements card matrix at native texel scale (Rare, one seed);
 *  - shield-matrix-412.png — the matrix as thumbs + card plates
 *    composed at phone width (412);
 *  - plate-<behavior>-<element>-<rarity>.png — the four
 *    owner-approved v3 reference combos + Absorb, at ×2;
 *  - rarity-row-turtle-kinetic.png — one family across all five
 *    rarities (finish escalates, form never changes).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Element, Rarity } from '../src/types/game';
import { encodePng, type RgbaImage } from '../src/lib/pixel/pngCodec';
import {
  composeGear,
  type GearComposeInput,
  type GearRender,
} from '../src/lib/pixel/gearCardCompositor';
import { shieldGrammar } from '../src/lib/pixel/shieldGrammar';
import type { ShieldBehaviorId } from '../src/lib/combat/shieldBehaviors';

const outDir = process.argv[2] ?? '/tmp/shield-cells';
mkdirSync(outDir, { recursive: true });

const BG: [number, number, number] = [13, 15, 20];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blank(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = BG[0]; data[i * 4 + 1] = BG[1]; data[i * 4 + 2] = BG[2]; data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function blit(sheet: RgbaImage, render: GearRender, ox: number, oy: number, scale = 1) {
  for (let y = 0; y < render.height; y++) {
    for (let x = 0; x < render.width; x++) {
      const shade = render.rows[y][x];
      if (shade === '.') continue;
      const color = (render.colors as Record<string, string | undefined>)[shade];
      if (!color) continue;
      const [r, g, b] = hexToRgb(color);
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = ox + x * scale + dx;
        const py = oy + y * scale + dy;
        if (px < 0 || py < 0 || px >= sheet.width || py >= sheet.height) continue;
        const i = (px + py * sheet.width) * 4;
        sheet.data[i] = r; sheet.data[i + 1] = g; sheet.data[i + 2] = b; sheet.data[i + 3] = 255;
      }
    }
  }
}

function save(name: string, image: RgbaImage) {
  writeFileSync(join(outDir, name), encodePng(image));
  console.log(`wrote ${name} (${image.width}x${image.height})`);
}

const BEHAVIORS: ShieldBehaviorId[] = ['standard', 'nova', 'absorb', 'amp', 'turtle'];
const ELEMENTS: Element[] = [Element.Kinetic, Element.Fire, Element.Shock, Element.Corrosive, Element.Cryo, Element.Void];

const input = (
  behavior: ShieldBehaviorId,
  element: Element,
  rarity: Rarity,
  seed = 20261103,
  pips = 3,
): GearComposeInput => ({
  kind: 'shield', rarity, element, seed, pips, variant: behavior,
});

const card = (behavior: ShieldBehaviorId, element: Element, rarity: Rarity, seed?: number, pips?: number) =>
  composeGear(input(behavior, element, rarity, seed, pips), shieldGrammar, 'card');
const thumb = (behavior: ShieldBehaviorId, element: Element, rarity: Rarity) =>
  composeGear(input(behavior, element, rarity), shieldGrammar, 'thumb');

/* ---- full behavior × element matrix (card, native scale) ---- */
{
  const gap = 8;
  const sheet = blank(6 * 240 + 7 * gap, 5 * 140 + 6 * gap);
  BEHAVIORS.forEach((behavior, row) => {
    ELEMENTS.forEach((element, col) => {
      blit(sheet, card(behavior, element, Rarity.Rare), gap + col * (240 + gap), gap + row * (140 + gap));
    });
  });
  save('matrix-behaviors-x-elements.png', sheet);
}

/* ---- the matrix at phone width: thumbs grid + card plates ---- */
{
  const sheet = blank(412, 5 * 41 + 5 * 148 + 12);
  BEHAVIORS.forEach((behavior, row) => {
    ELEMENTS.forEach((element, col) => {
      blit(sheet, thumb(behavior, element, Rarity.Rare), 10 + col * 66, 6 + row * 41);
    });
  });
  BEHAVIORS.forEach((behavior, row) => {
    blit(sheet, card(behavior, Element.Fire, Rarity.Epic), 86, 5 * 41 + 6 + row * 148);
  });
  save('shield-matrix-412.png', sheet);
}

/* ---- the v3 reference combos (+ Absorb) at ×2 ---- */
{
  const combos: [ShieldBehaviorId, Element, Rarity][] = [
    ['nova', Element.Fire, Rarity.Epic],
    ['amp', Element.Shock, Rarity.Legendary],
    ['turtle', Element.Kinetic, Rarity.Rare],
    ['standard', Element.Void, Rarity.Epic],
    ['absorb', Element.Void, Rarity.Legendary],
  ];
  for (const [behavior, element, rarity] of combos) {
    const sheet = blank(240 * 2, 140 * 2);
    blit(sheet, card(behavior, element, rarity, 1101, 3), 0, 0, 2);
    save(`plate-${behavior}-${element.toLowerCase()}-${rarity.toLowerCase()}.png`, sheet);
  }
}

/* ---- rarity row: form constant, finish escalates ---- */
{
  const gap = 8;
  const sheet = blank(5 * 240 + 6 * gap, 140 + 2 * gap);
  [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary].forEach((rarity, i) => {
    blit(sheet, card('turtle', Element.Kinetic, rarity, 1103, 2), gap + i * (240 + gap), gap);
  });
  save('rarity-row-turtle-kinetic.png', sheet);
}
