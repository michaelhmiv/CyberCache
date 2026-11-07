/**
 * Pxl Craft Sweep S3 — gear-engine craft pass evidence tooling.
 *
 *   npx tsx --tsconfig tsconfig.app.json scripts/render-s3-gear-craft.ts render <outDir>
 *   npx tsx --tsconfig tsconfig.app.json scripts/render-s3-gear-craft.ts compare <beforeDir> <afterDir> <outDir>
 *
 * `render` composes the S3 acceptance corpus (brief check 1)
 * through the PRODUCTION input path — real item records mapped by
 * each grammar's own inputFromItem, composed by the shared gear
 * core at card + thumb — and writes corpus.json (rows + colors
 * per item per density) plus per-kind sheets. Run it on master
 * for the "before" state and on the slice branch for "after".
 *
 * `compare` diffs two corpus.json states cell by cell (brief
 * check 3): silhouette deltas (filled ↔ empty), interior tone
 * changes, and the palette-law check (each item's color map must
 * be byte-identical across states — tones derive from the item,
 * never from the slice). It writes report.md and before/after
 * sheets per kind plus the Absorb acceptance sheet (check 2).
 *
 * Corpus (fixed seeds throughout — the same items both sides):
 *  - shields:    5 families × {Fire, Shock, Corrosive} × {Common, Epic, Legendary}
 *  - ordnance:   4 forms × {Fire, Shock, Corrosive} × {Common, Legendary}
 *  - class mods: 4 trees × {Common, Legendary} × {no boosts, mixed boosts, a +3 stack}
 *  - relics:     12 names × {Common, Legendary} × {WorldDrop, BossDrop}
 * Sheet layout is corpus order, left→right, top→bottom; the
 * corpus index (ids in order) is written beside every sheet set.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DropSource, Element, Rarity } from '../src/types/game';
import type { ClassMod, GearItem, Ordnance, Relic, Shield } from '../src/types/items';
import { hashString } from '../src/lib/utils/rng';
import { encodePng, type RgbaImage } from '../src/lib/pixel/pngCodec';
import {
  composeGear,
  type GearGrammar,
  type GearRender,
} from '../src/lib/pixel/gearCardCompositor';
import { GEAR_GRAMMARS } from '../src/lib/pixel/gearDispatch';
import type { ShieldBehaviorId } from '../src/lib/combat/shieldBehaviors';
import { RELIC_NAMES } from '../src/server/lib/generators/relicGenerator';

/* ------------------------------------------------------------------ */
/* Corpus construction — real records through production mappings      */
/* ------------------------------------------------------------------ */

interface CorpusItem {
  id: string;
  kind: 'shield' | 'ordnance' | 'classMod' | 'relic';
  item: GearItem;
}

const affixes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `aff_${i}`, category: 'combat' as const, stat: 'maxHp', value: 10, displayText: '+10',
  }));

const ELEMENTS = [Element.Fire, Element.Shock, Element.Corrosive];

function shieldItems(): CorpusItem[] {
  const out: CorpusItem[] = [];
  const families: ShieldBehaviorId[] = ['standard', 'nova', 'absorb', 'amp', 'turtle'];
  for (const family of families) {
    for (const element of ELEMENTS) {
      for (const rarity of [Rarity.Common, Rarity.Epic, Rarity.Legendary]) {
        const id = `shield/${family}/${element}/${rarity}`;
        const item: Shield = {
          id, name: 'S3 Corpus Shield', level: 20, rarity, hp: 200, rechargeRate: 5,
          mitigation: 0.2, element, affixes: affixes(3), sourceTag: DropSource.WorldDrop,
          isLocked: false, pixelSeed: hashString(`s3:${id}`), behavior: family,
        };
        out.push({ id, kind: 'shield', item });
      }
    }
  }
  return out;
}

function ordnanceItems(): CorpusItem[] {
  const out: CorpusItem[] = [];
  const forms: Record<string, string> = {
    spike: 'Fragmentation: +15% area damage',
    disc: 'EMP Payload: +25% shield break',
    dart: 'Seeker: Homes on weakpoints (+15% crit)',
    canister: 'Cluster: Splits into 3 bomblets',
  };
  for (const [form, effect] of Object.entries(forms)) {
    for (const element of ELEMENTS) {
      for (const rarity of [Rarity.Common, Rarity.Legendary]) {
        const id = `ordnance/${form}/${element}/${rarity}`;
        const item: Ordnance = {
          id, name: 'S3 Corpus Ordnance', level: 20, rarity, damage: 240, shieldDamage: 180,
          armorDamage: 200, element, effect, affixes: affixes(2), sourceTag: DropSource.WorldDrop,
          isLocked: false, pixelSeed: hashString(`s3:${id}`),
        };
        out.push({ id, kind: 'ordnance', item });
      }
    }
  }
  return out;
}

function classModItems(): CorpusItem[] {
  const out: CorpusItem[] = [];
  const trees = ['Gunslinger', 'Demolition', 'Scavenger', 'Fixer'];
  const boostPatterns: Record<string, Record<string, number>> = {
    none: {},
    mixed: { gs_dmg_1: 2, demo_ord_1: 1, scav_cache_1: 2, fix_quality_1: 1 },
    stack: { gs_crit_1: 3 },
  };
  for (const tree of trees) {
    for (const rarity of [Rarity.Common, Rarity.Legendary]) {
      for (const [pattern, nodeBoosts] of Object.entries(boostPatterns)) {
        const id = `classMod/${tree}/${rarity}/${pattern}`;
        const item: ClassMod = {
          id, name: 'S3 Corpus Class Mod', level: 20, rarity, treeBonus: tree,
          nodeBoosts, affixes: affixes(3), sourceTag: DropSource.WorldDrop, isLocked: false,
        };
        out.push({ id, kind: 'classMod', item });
      }
    }
  }
  return out;
}

function relicItems(): CorpusItem[] {
  const out: CorpusItem[] = [];
  for (const name of RELIC_NAMES) {
    for (const rarity of [Rarity.Common, Rarity.Legendary]) {
      for (const sourceTag of [DropSource.WorldDrop, DropSource.BossDrop]) {
        const id = `relic/${name}/${rarity}/${sourceTag}`;
        const item: Relic = {
          id, name, level: 20, rarity, affixes: affixes(2), sourceTag, isLocked: false,
        };
        out.push({ id, kind: 'relic', item });
      }
    }
  }
  return out;
}

export function s3Corpus(): CorpusItem[] {
  return [...shieldItems(), ...ordnanceItems(), ...classModItems(), ...relicItems()];
}

/* ------------------------------------------------------------------ */
/* Raster helpers (the render-shield-fixtures pattern)                 */
/* ------------------------------------------------------------------ */

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

interface SerializedRender {
  width: number; height: number; rows: string[]; colors: Record<string, string>; signature: string;
}

function blit(sheet: RgbaImage, render: SerializedRender, ox: number, oy: number, scale = 1) {
  for (let y = 0; y < render.height; y++) {
    for (let x = 0; x < render.width; x++) {
      const shade = render.rows[y][x];
      if (shade === '.') continue;
      const color = render.colors[shade];
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

function save(dir: string, name: string, image: RgbaImage) {
  writeFileSync(join(dir, name), encodePng(image));
  console.log(`wrote ${name} (${image.width}x${image.height})`);
}

/** Grid sheet of same-size renders in order. */
function gridSheet(dir: string, name: string, renders: SerializedRender[], cols: number, scale: number, gap = 8) {
  if (renders.length === 0) return;
  const w = renders[0].width * scale;
  const h = renders[0].height * scale;
  const rows = Math.ceil(renders.length / cols);
  const sheet = blank(cols * w + (cols + 1) * gap, rows * h + (rows + 1) * gap);
  renders.forEach((render, i) => {
    const cx = gap + (i % cols) * (w + gap);
    const cy = gap + Math.floor(i / cols) * (h + gap);
    blit(sheet, render, cx, cy, scale);
  });
  save(dir, name, sheet);
}

/* ------------------------------------------------------------------ */
/* render mode                                                         */
/* ------------------------------------------------------------------ */

interface CorpusFile {
  items: { id: string; kind: string; card: SerializedRender; thumb: SerializedRender }[];
}

function serialize(render: GearRender): SerializedRender {
  return {
    width: render.width, height: render.height, rows: render.rows,
    colors: render.colors as Record<string, string>, signature: render.signature,
  };
}

function renderMode(outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const corpus = s3Corpus();
  const file: CorpusFile = { items: [] };
  for (const entry of corpus) {
    const grammar: GearGrammar = GEAR_GRAMMARS[entry.kind];
    const input = grammar.inputFromItem!(entry.item as never);
    const card = composeGear(input, grammar, 'card');
    const thumb = composeGear(input, grammar, 'thumb');
    file.items.push({ id: entry.id, kind: entry.kind, card: serialize(card), thumb: serialize(thumb) });
  }
  writeFileSync(join(outDir, 'corpus.json'), JSON.stringify(file));
  writeFileSync(join(outDir, 'corpus-index.md'),
    `# S3 corpus index (${file.items.length} items)\n\n` + file.items.map((it, i) => `${i}. ${it.id}`).join('\n') + '\n');
  for (const kind of ['shield', 'ordnance', 'classMod', 'relic'] as const) {
    const items = file.items.filter((it) => it.kind === kind);
    gridSheet(outDir, `sheet-${kind}-card.png`, items.map((it) => it.card), 3, 1);
    gridSheet(outDir, `sheet-${kind}-thumb.png`, items.map((it) => it.thumb), 6, 6);
  }
  console.log(`corpus: ${file.items.length} items rendered`);
}

/* ------------------------------------------------------------------ */
/* compare mode                                                        */
/* ------------------------------------------------------------------ */

function diffRenders(before: SerializedRender, after: SerializedRender) {
  let silhouette = 0; // filled <-> empty
  let tone = 0; // filled both sides, different shade
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
      const a = before.rows[y][x];
      const b = after.rows[y][x];
      if (a === b) continue;
      if (a === '.' || b === '.') silhouette++;
      else tone++;
    }
  }
  return { silhouette, tone };
}

function compareMode(beforeDir: string, afterDir: string, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const before = JSON.parse(readFileSync(join(beforeDir, 'corpus.json'), 'utf8')) as CorpusFile;
  const after = JSON.parse(readFileSync(join(afterDir, 'corpus.json'), 'utf8')) as CorpusFile;
  const afterById = new Map(after.items.map((it) => [it.id, it]));
  const lines: string[] = [
    '# S3 form-diff report — master vs branch, acceptance corpus',
    '',
    'Silhouette delta = cells that changed filled ↔ empty. Tone delta = cells filled on',
    'both sides whose shade changed. Palette law = the item color map (derived from the',
    'item alone) is byte-identical across states for every corpus item.',
    '',
  ];
  const totals = new Map<string, { items: number; silCard: number; toneCard: number; silThumb: number; toneThumb: number }>();
  const flagged: string[] = [];
  let paletteViolations = 0;
  for (const b of before.items) {
    const a = afterById.get(b.id);
    if (!a) { flagged.push(`MISSING in after: ${b.id}`); continue; }
    if (JSON.stringify(b.card.colors) !== JSON.stringify(a.card.colors)) {
      paletteViolations++;
      flagged.push(`PALETTE LAW VIOLATION: ${b.id}`);
    }
    const dc = diffRenders(b.card, a.card);
    const dt = diffRenders(b.thumb, a.thumb);
    const t = totals.get(b.kind) ?? { items: 0, silCard: 0, toneCard: 0, silThumb: 0, toneThumb: 0 };
    t.items++; t.silCard += dc.silhouette; t.toneCard += dc.tone; t.silThumb += dt.silhouette; t.toneThumb += dt.tone;
    totals.set(b.kind, t);
    lines.push(`- ${b.id} — card: silhouette ${dc.silhouette}, tone ${dc.tone} · thumb: silhouette ${dt.silhouette}, tone ${dt.tone}`);
  }
  lines.splice(6, 0,
    '## Totals by kind', '',
    '| kind | items | card silhouette Δ | card tone Δ | thumb silhouette Δ | thumb tone Δ |',
    '|---|---|---|---|---|---|',
    ...[...totals.entries()].map(([k, t]) => `| ${k} | ${t.items} | ${t.silCard} | ${t.toneCard} | ${t.silThumb} | ${t.toneThumb} |`),
    '', `Palette-law violations: ${paletteViolations}`, '',
    '## Per-item detail', '');
  if (flagged.length) lines.push('', '## Flags', '', ...flagged.map((f) => `- ${f}`));
  writeFileSync(join(outDir, 'form-diff-report.md'), lines.join('\n') + '\n');
  console.log(`report written; palette violations: ${paletteViolations}`);

  // Before/after sheets: per kind, pairs side by side (before | after).
  for (const kind of ['shield', 'ordnance', 'classMod', 'relic'] as const) {
    const items = before.items.filter((it) => it.kind === kind);
    const pairRenders = (pick: (it: CorpusFile['items'][number]) => SerializedRender) => {
      const out: SerializedRender[] = [];
      for (const b of items) {
        const a = afterById.get(b.id)!;
        out.push(pick(b), pick(a));
      }
      return out;
    };
    gridSheet(outDir, `ba-${kind}-card.png`, pairRenders((it) => it.card), 6, 1);
    gridSheet(outDir, `ba-${kind}-thumb.png`, pairRenders((it) => it.thumb), 12, 6);
  }

  // Absorb acceptance sheet (check 2): the five families side by
  // side at plate + thumb (after state), and Absorb across its
  // corpus row before | after.
  const afterShields = after.items.filter((it) => it.kind === 'shield');
  const epicRow = afterShields.filter((it) => it.id.endsWith('/Epic'));
  {
    // 5 families × {Fire card, Fire thumb×6} — Fire/Epic row.
    const fireEpic = epicRow.filter((it) => it.id.includes('/Fire/'));
    const sheet = blank(5 * 240 + 6 * 8, 140 + 8 + 35 * 6 + 16);
    fireEpic.forEach((it, i) => blit(sheet, it.card, 8 + i * 248, 8, 1));
    fireEpic.forEach((it, i) => blit(sheet, it.thumb, 8 + i * 248, 156, 6));
    save(outDir, 'absorb-sheet-families.png', sheet);
  }
  {
    const absorbAfter = afterShields.filter((it) => it.id.startsWith('shield/absorb/'));
    const absorbBefore = before.items.filter((it) => it.id.startsWith('shield/absorb/'));
    const sheet = blank(3 * 240 + 4 * 8, 3 * (140 + 8) + 8);
    absorbBefore.forEach((it, i) => blit(sheet, it.card, 8 + (i % 3) * 248, 8 + Math.floor(i / 3) * 148, 1));
    // After row block sits below the before block in a second sheet half —
    // kept separate for legibility: this sheet is BEFORE; a twin holds AFTER.
    save(outDir, 'absorb-row-before.png', sheet);
    const sheet2 = blank(3 * 240 + 4 * 8, 3 * (140 + 8) + 8);
    absorbAfter.forEach((it, i) => blit(sheet2, it.card, 8 + (i % 3) * 248, 8 + Math.floor(i / 3) * 148, 1));
    save(outDir, 'absorb-row-after.png', sheet2);
    // Thumbs stacked: before block on top, after block below.
    const sheet4 = blank(9 * 128 + 16, 2 * (35 * 2 + 8) + 8);
    absorbBefore.forEach((it, i) => blit(sheet4, it.thumb, 8 + i * 128, 8, 2));
    absorbAfter.forEach((it, i) => blit(sheet4, it.thumb, 8 + i * 128, 8 + 78, 2));
    save(outDir, 'absorb-thumbs-ba.png', sheet4);
  }
  console.log('sheets written');
}

/* ------------------------------------------------------------------ */

const [mode, ...args] = process.argv.slice(2);
if (mode === 'render') renderMode(args[0] ?? '/tmp/s3-render');
else if (mode === 'compare') compareMode(args[0], args[1], args[2] ?? '/tmp/s3-compare');
else {
  console.error('usage: render <outDir> | compare <beforeDir> <afterDir> <outDir>');
  process.exit(1);
}
