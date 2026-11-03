/**
 * Gear-ordnance sample renderer (gear marriage, slice 2 working script).
 *
 *   npx tsx --tsconfig tsconfig.app.json scripts/render-gear-ordnance-samples.ts <outDir>
 *
 * Rasterizes the PRODUCTION ordnance grammar (src/lib/pixel/
 * ordnanceGrammar.ts through the shared gear plate core) into
 * capture cells in <outDir>:
 *  - form-<form>-<element>.png — the 4 forms × 6 elements at card
 *    density (Rare, seed 777, 2 pips), native 240×120;
 *  - thumb-<form>-<element>.png — the composed thumbs (60×30 at 4x);
 *  - rar-<form>-<rarity>.png — one form per rarity row (Fire).
 * The assemble-gear-ordnance-insitu.py script builds the labeled
 * 412px sheets + in-situ compositions from these cells.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Element, Rarity } from '../src/types/game';
import { encodePng, type RgbaImage } from '../src/lib/pixel/pngCodec';
import {
  composeGear,
  type GearComposeInput,
  type GearDensity,
  type GearRender,
} from '../src/lib/pixel/gearCardCompositor';
import {
  ordnanceGrammar,
  ORDNANCE_FORM_ROWS,
  type OrdnanceFormId,
} from '../src/lib/pixel/ordnanceGrammar';

const outDir = process.argv[2] ?? '/tmp/gear-ordnance-cells';
mkdirSync(outDir, { recursive: true });

const BG: [number, number, number] = [13, 15, 20];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rasterize(render: GearRender, scale = 1): RgbaImage {
  const width = render.width * scale;
  const height = render.height * scale;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = BG[0]; data[i * 4 + 1] = BG[1]; data[i * 4 + 2] = BG[2]; data[i * 4 + 3] = 255;
  }
  for (let y = 0; y < render.height; y++) {
    for (let x = 0; x < render.width; x++) {
      const shade = render.rows[y][x];
      if (shade === '.') continue;
      const color = (render.colors as Record<string, string | undefined>)[shade];
      if (!color) continue;
      const [r, g, b] = hexToRgb(color);
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = x * scale + dx;
        const py = y * scale + dy;
        const i = (px + py * width) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

function save(name: string, input: GearComposeInput, density: GearDensity = 'card', scale = 2) {
  const render = composeGear(input, ordnanceGrammar, density);
  writeFileSync(join(outDir, `${name}.png`), encodePng(rasterize(render, scale)));
  console.log(`wrote ${name}.png sig=${render.signature}`);
}

const FORMS = Object.keys(ORDNANCE_FORM_ROWS) as OrdnanceFormId[];
const ELEMENTS = Object.values(Element);
const RARITIES = Object.values(Rarity);

for (const form of FORMS) {
  for (const element of ELEMENTS) {
    save(`form-${form}-${element}`, {
      kind: 'ordnance', rarity: Rarity.Rare, element, seed: 777, pips: 2, variant: form,
    });
    save(`thumb-${form}-${element}`, {
      kind: 'ordnance', rarity: Rarity.Rare, element, seed: 777, pips: 2, variant: form,
    }, 'thumb', 4);
  }
  for (const rarity of RARITIES) {
    save(`rar-${form}-${rarity}`, {
      kind: 'ordnance', rarity, element: Element.Fire, seed: 4242, pips: 3, variant: form,
    });
  }
}
