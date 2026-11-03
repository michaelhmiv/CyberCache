/**
 * Gear-core fixture renderer (gear marriage, slice 0 working script).
 *
 *   npx tsx --tsconfig tsconfig.app.json scripts/render-gear-core-fixtures.ts <outDir>
 *
 * Rasterizes the shared gear plate core's PROOF renders (the
 * placeholder fixture grammars from src/test/gearFixtureGrammar.ts)
 * into capture sheets in <outDir>:
 *  - fixture-matrix-412.png — card plates + their composed thumbs
 *    at phone width (412);
 *  - register-side-by-side.png — a core-rendered gear plate BESIDE
 *    a real weapon card render, both at native texel scale: the
 *    register-match evidence for the density law;
 *  - individual plates (card native, thumb at 6x for inspection).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Element, Manufacturer, Rarity, WeaponType } from '../src/types/game';
import { encodePng, type RgbaImage } from '../src/lib/pixel/pngCodec';
import {
  composeGear,
  type GearComposeInput,
  type GearDensity,
  type GearGrammar,
  type GearRender,
} from '../src/lib/pixel/gearCardCompositor';
import { composeWeaponCard, type WeaponCardRender } from '../src/lib/pixel/weaponCardCompositor';
import type { PixelWeaponInput } from '../src/lib/pixel/weaponCompositor';
import { fixtureBlockGrammar, fixtureSlabGrammar } from '../src/test/gearFixtureGrammar';

const outDir = process.argv[2] ?? '/tmp/gear-core-cells';
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

type AnyRender = GearRender | WeaponCardRender;

function blit(sheet: RgbaImage, render: AnyRender, ox: number, oy: number, scale = 1) {
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

const gear = (input: GearComposeInput, grammar: GearGrammar, density: GearDensity = 'card') =>
  composeGear(input, grammar, density);

const blockFireEpic: GearComposeInput = { kind: 'shield', rarity: Rarity.Epic, element: Element.Fire, seed: 1234, pips: 2 };
const blockVoidRare: GearComposeInput = { kind: 'shield', rarity: Rarity.Rare, element: Element.Void, seed: 99, pips: 3 };
const blockKineticCommon: GearComposeInput = { kind: 'shield', rarity: Rarity.Common, element: Element.Kinetic, seed: 1234, pips: 0 };
const slabShockRare: GearComposeInput = { kind: 'ordnance', rarity: Rarity.Rare, element: Element.Shock, seed: 777, pips: 1 };
const slabKineticLegendary: GearComposeInput = { kind: 'ordnance', rarity: Rarity.Legendary, element: Element.Kinetic, seed: 777, pips: 4 };

/* ---- fixture matrix at 412 wide ---- */
{
  const sheet = blank(412, 276);
  blit(sheet, gear(blockFireEpic, fixtureBlockGrammar), 0, 0);
  blit(sheet, gear(blockFireEpic, fixtureBlockGrammar, 'thumb'), 252, 0);
  blit(sheet, gear(blockVoidRare, fixtureBlockGrammar, 'thumb'), 252, 41);
  blit(sheet, gear(blockKineticCommon, fixtureBlockGrammar, 'thumb'), 252, 82);
  blit(sheet, gear(slabShockRare, fixtureSlabGrammar), 0, 148);
  blit(sheet, gear(slabShockRare, fixtureSlabGrammar, 'thumb'), 252, 148);
  blit(sheet, gear(slabKineticLegendary, fixtureSlabGrammar, 'thumb'), 252, 184);
  save('fixture-matrix-412.png', sheet);
}

/* ---- register evidence: gear plate beside a real weapon card ---- */
{
  const weaponInput: PixelWeaponInput = {
    weaponType: WeaponType.Shotgun,
    manufacturer: Manufacturer.BlastForge,
    element: Element.Fire,
    rarity: Rarity.Epic,
    rollQuality: 75,
    pixelSeed: 1234,
  };
  const sheet = blank(496, 148);
  blit(sheet, composeWeaponCard(weaponInput), 0, 30); // 240×88 native
  blit(sheet, gear(blockFireEpic, fixtureBlockGrammar), 248, 4); // 240×140 native
  save('register-side-by-side.png', sheet);
}

/* ---- individual plates ---- */
{
  const card = blank(240, 140);
  blit(card, gear(blockFireEpic, fixtureBlockGrammar), 0, 0);
  save('block-fire-epic-card.png', card);

  const thumb = blank(60 * 6, 35 * 6);
  blit(thumb, gear(blockFireEpic, fixtureBlockGrammar, 'thumb'), 0, 0, 6);
  save('block-fire-epic-thumb-x6.png', thumb);

  const slabCard = blank(240, 120);
  blit(slabCard, gear(slabShockRare, fixtureSlabGrammar), 0, 0);
  save('slab-shock-rare-card.png', slabCard);
}
