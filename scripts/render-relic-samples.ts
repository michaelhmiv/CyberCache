/**
 * Relic-marriage sample renderer (gear marriage, slice 4 working
 * script — the pattern of render-weapon-marriage-samples.ts).
 *
 *   npx tsx --tsconfig tsconfig.app.json scripts/render-relic-samples.ts <outDir>
 *
 * Rasterizes the PRODUCTION relic grammar's renders (the shared
 * gear plate engine, src/lib/pixel/relicGrammar.ts) into PNG cells
 * in <outDir>:
 *  - one card + one thumb per name in the pool (the form rows);
 *  - a treatment ladder: one form on all six sourceTag bases;
 *  - a rarity ladder: one form across all five rarities;
 *  - two renders derived from full item records through
 *    inputFromItem — the exact path GearIllustration takes.
 * Sheets are assembled from these cells by
 * scripts/assemble-relic-captures.py.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DropSource, Rarity } from '../src/types/game';
import type { Relic } from '../src/types/items';
import { encodePng, type RgbaImage } from '../src/lib/pixel/pngCodec';
import {
  composeGear,
  type GearComposeInput,
  type GearRender,
} from '../src/lib/pixel/gearCardCompositor';
import {
  RELIC_FORM_ROWS,
  RELIC_TREATMENTS,
  relicGrammar,
  relicInputFromItem,
} from '../src/lib/pixel/relicGrammar';

const outDir = process.argv[2] ?? '/tmp/relic-cells';
mkdirSync(outDir, { recursive: true });

const BG: [number, number, number] = [13, 15, 20];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rasterize(render: GearRender, scale: number): RgbaImage {
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
        const px = (x * scale + dx) + (y * scale + dy) * width;
        data[px * 4] = r; data[px * 4 + 1] = g; data[px * 4 + 2] = b; data[px * 4 + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

function save(name: string, render: GearRender, scale = 1) {
  writeFileSync(join(outDir, `${name}.png`), encodePng(rasterize(render, scale)));
  console.log(`wrote ${name}.png`);
}

const inputFor = (formId: string, over: Partial<GearComposeInput> = {}): GearComposeInput => {
  const row = RELIC_FORM_ROWS.find((r) => r.formId === formId)!;
  return {
    kind: 'relic',
    rarity: Rarity.Epic,
    element: null,
    seed: 4242,
    pips: 3,
    baseColor: row.baseColor,
    variant: `${row.formId}/world`,
    ...over,
  };
};

/* ---- the name pool: card + thumb per row ---- */
for (const row of RELIC_FORM_ROWS) {
  save(`form-${row.formId}-card`, composeGear(inputFor(row.formId), relicGrammar, 'card'));
  save(`form-${row.formId}-thumb`, composeGear(inputFor(row.formId), relicGrammar, 'thumb'), 6);
}

/* ---- treatment ladder: Cache Relic on all six bases ---- */
for (const [tag, treatment] of Object.entries(RELIC_TREATMENTS)) {
  save(
    `treatment-${treatment}`,
    composeGear(
      inputFor('cache-relic', { rarity: Rarity.Rare, seed: 777, variant: `cache-relic/${treatment}` }),
      relicGrammar,
      'card',
    ),
  );
  void tag;
}

/* ---- rarity ladder: Void Prism, Common → Legendary ---- */
for (const rarity of Object.values(Rarity)) {
  save(
    `rarity-${rarity.toLowerCase()}`,
    composeGear(inputFor('void-prism', { rarity, seed: 99, pips: 2 }), relicGrammar, 'card'),
  );
}

/* ---- full records through inputFromItem (the production path) ---- */
const affix = (id: string, text: string) => ({
  id, category: 'utility' as const, stat: 'luck', value: 0.05, displayText: text,
});
const records: Relic[] = [
  {
    id: 'rec-glitched-legendary', name: 'Glitched Token', level: 40, rarity: Rarity.Legendary,
    affixes: [affix('a1', '+5% Luck'), affix('a2', '+4% Luck'), affix('a3', '+3% Luck'), affix('a4', '+2% Luck'), affix('a5', '+1% Luck')],
    sourceTag: DropSource.BossDrop, isLocked: false,
  },
  {
    id: 'rec-quantum-common', name: 'Quantum Fragment', level: 3, rarity: Rarity.Common,
    affixes: [affix('a1', '+5% Luck'), affix('a2', '+4% Luck')],
    sourceTag: DropSource.WorldDrop, isLocked: false,
  },
  {
    id: 'rec-ethereal-epic', name: 'Ethereal Drive', level: 22, rarity: Rarity.Epic,
    affixes: [affix('a1', '+5% Luck'), affix('a2', '+4% Luck'), affix('a3', '+3% Luck')],
    sourceTag: DropSource.Event, isLocked: false,
  },
];
for (const relic of records) {
  save(`record-${relic.id}`, composeGear(relicInputFromItem(relic), relicGrammar, 'card'));
  save(`record-${relic.id}-thumb`, composeGear(relicInputFromItem(relic), relicGrammar, 'thumb'), 6);
}
