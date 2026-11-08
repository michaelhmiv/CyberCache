#!/usr/bin/env node
/**
 * V4 legendary authored-data converter.
 *
 * The 26 bespoke legendaries are hand-authored in the pxl tool, one
 * source file per legendary, archived at
 *   ~/workspace/cybercache-prep/full-asset-audit/v4-evidence/sources/
 *     legendary-<slug>.px.js
 * Each source draws its weapon on the full 240x88 card grid in
 * absolute card coordinates and carries two JSON comment blocks:
 *   // PALETTE {"<id>": {CardShade: hex, ...}}   (full resolved palette)
 *   // ANCHORS {"<id>": {bbox, grip, muzzle}}     (card texels)
 * This converter extracts each sprite's key grid via `pxl ascii`
 * (the tool's own key dump, parsed deterministically like the S5
 * converters), bbox-trims it into a single AuthoredPiece, derives
 * the 120x44 stage-density piece by a documented 2x2 downsample,
 * and emits src/lib/pixel/legendaryAuthoredData.ts. Re-running it
 * on unchanged sources reproduces the committed data byte-for-byte.
 *
 * Stage downsample (documented, deterministic): each 2x2 block of
 * the card grid maps to one stage cell. Card keys map into the
 * 7-key PixelShade alphabet via STAGE_KEY_MAP; the block's stage
 * key is the most frequent mapped key among its FILLED cells (a
 * single filled cell carries the block, so thin structures
 * survive); ties break by STAGE_PRIORITY (identity accents first).
 * A fully transparent block stays transparent.
 *
 * Usage:
 *   node scripts/convert-legendary-authored.mjs [--source-dir DIR] [--pxl BIN]
 * Defaults: source dir ../cybercache-prep/full-asset-audit/v4-evidence/sources
 * (relative to the repo root), pxl ../skill-review/pxl/bin/pxl.js.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const sourceDir = resolve(repoRoot, opt('--source-dir', '../cybercache-prep/full-asset-audit/v4-evidence/sources'));
const pxlBin = resolve(repoRoot, opt('--pxl', '../skill-review/pxl/bin/pxl.js'));
const outPath = join(repoRoot, 'src/lib/pixel/legendaryAuthoredData.ts');

const CARD_W = 240;
const CARD_H = 88;

function asciiGrid(sourcePath, name) {
  const text = execFileSync('node', [pxlBin, 'ascii', sourcePath, name], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const lines = text.split('\n');
  const rulerIdx = lines.findIndex((l) => {
    const t = l.trim();
    return t.length > 0 && /^\d+$/.test(t) && '0123456789'.repeat(32).startsWith(t);
  });
  if (rulerIdx < 0) throw new Error(`converter: ${name}: ascii ruler not found`);
  const w = lines[rulerIdx].trim().length;
  const rows = [];
  for (const line of lines.slice(rulerIdx + 1)) {
    const m = line.match(/^\s*(\d+) (.*)$/);
    if (!m || m[2].replace(/\s+$/, '').length !== w) continue;
    if (Number(m[1]) !== rows.length) throw new Error(`converter: ${name}: row index ${m[1]} out of sequence`);
    rows.push(m[2].replace(/\s+$/, ''));
  }
  if (!rows.length) throw new Error(`converter: ${name}: no grid rows parsed`);
  return rows;
}

function trimPiece(grid) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.' || ch === ' ') return;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
  });
  if (maxX < 0) throw new Error('converter: empty sprite grid');
  const rows = [];
  for (let y = minY; y <= maxY; y++) {
    rows.push([...grid[y]].slice(minX, maxX + 1).join('').replace(/ +$/, (m) => '.'.repeat(m.length)).replace(/\s/g, '.'));
  }
  // Trailing transparent cells per row are stripped (AuthoredPiece contract).
  return {
    seat: [minX, minY],
    rows: rows.map((r) => r.replace(/\.+$/, '')),
  };
}

const STAGE_KEY_MAP = {
  K: 'K', k: 'D', D: 'D', d: 'D', P: 'P', p: 'P', L: 'L', W: 'L',
  T: 'T', G: 'G', g: 'G', b: 'G', E: 'E', e: 'E', c: 'D',
  v: 'D', w: 'P', u: 'L',
};
const STAGE_PRIORITY = ['E', 'G', 'L', 'P', 'T', 'D', 'K'];

function downsampleToStage(cardGrid) {
  const stage = Array.from({ length: CARD_H / 2 }, () => Array(CARD_W / 2).fill('.'));
  for (let sy = 0; sy < CARD_H / 2; sy++) {
    for (let sx = 0; sx < CARD_W / 2; sx++) {
      const counts = new Map();
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const ch = cardGrid[sy * 2 + dy]?.[sx * 2 + dx] ?? '.';
          if (ch === '.' || ch === ' ') continue;
          const mapped = STAGE_KEY_MAP[ch];
          if (!mapped) throw new Error(`converter: unmapped card key '${ch}' in stage downsample`);
          counts.set(mapped, (counts.get(mapped) ?? 0) + 1);
        }
      }
      if (!counts.size) continue;
      let best = null;
      let bestCount = -1;
      for (const key of STAGE_PRIORITY) {
        const n = counts.get(key) ?? 0;
        if (n > bestCount) { best = key; bestCount = n; }
      }
      stage[sy][sx] = best;
    }
  }
  return stage.map((row) => row.join(''));
}

function readBlock(source, tag, file) {
  const m = source.match(new RegExp(`// ${tag} (\\{.*\\})`));
  if (!m) throw new Error(`converter: ${file}: missing // ${tag} block`);
  return JSON.parse(m[1]);
}

const files = readdirSync(sourceDir).filter((f) => /^legendary-[a-z0-9-]+\.px\.js$/.test(f)).sort();
if (!files.length) throw new Error(`converter: no legendary sources in ${sourceDir}`);

const entries = [];
for (const file of files) {
  const sourcePath = join(sourceDir, file);
  const source = readFileSync(sourcePath, 'utf8');
  const palettes = readBlock(source, 'PALETTE', file);
  const anchors = readBlock(source, 'ANCHORS', file);
  const ids = Object.keys(palettes);
  if (ids.length !== 1 || !anchors[ids[0]]) throw new Error(`converter: ${file}: expected exactly one legendary per source`);
  const id = ids[0];
  const grid = asciiGrid(sourcePath, id);
  if (grid.length !== CARD_H || grid[0].length !== CARD_W) {
    throw new Error(`converter: ${id}: expected a ${CARD_W}x${CARD_H} canvas, got ${grid[0].length}x${grid.length}`);
  }
  const piece = trimPiece(grid);
  const [bx, by, bw, bh] = anchors[id].bbox;
  const drawnW = Math.max(...piece.rows.map((r) => r.length));
  if (piece.seat[0] < bx - 2 || piece.seat[1] < by - 2 || piece.seat[0] + drawnW > bx + bw + 2) {
    // Soft check only: report drift between declared bbox and drawn bbox.
    console.error(`converter: note: ${id} drawn bbox seat ${piece.seat} vs declared ${[bx, by]}`);
  }
  const stageGrid = downsampleToStage(grid);
  const stagePiece = trimPiece(stageGrid);
  const pal = palettes[id];
  const stageColors = { K: pal.K, D: pal.D, P: pal.P, L: pal.L, T: pal.T, G: pal.G, E: pal.E };
  entries.push({
    id,
    piece,
    colors: pal,
    grip: anchors[id].grip,
    muzzle: anchors[id].muzzle,
    stagePiece,
    stageColors,
    stageGrip: [Math.round(anchors[id].grip[0] / 2), Math.round(anchors[id].grip[1] / 2)],
    stageMuzzle: [Math.round(anchors[id].muzzle[0] / 2), Math.round(anchors[id].muzzle[1] / 2)],
  });
  const pieceW = Math.max(...piece.rows.map((r) => r.length));
  const stageW = Math.max(...stagePiece.rows.map((r) => r.length));
  console.log(`converter: ${id}: card piece ${pieceW}x${piece.rows.length} @ ${piece.seat}, stage piece ${stageW}x${stagePiece.rows.length} @ ${stagePiece.seat}`);
}

const pieceTs = (p) =>
  `{ seat: [${p.seat[0]}, ${p.seat[1]}], rows: [\n${p.rows.map((r) => `      '${r}',`).join('\n')}\n    ] }`;
const colorsTs = (colors, indent) =>
  Object.entries(colors).map(([k, v]) => `${indent}${k}: '${v}',`).join('\n');

const body = entries.map((e) => `  '${e.id}': {
    pieces: [${pieceTs(e.piece)}],
    colors: {
${colorsTs(e.colors, '      ')}
    },
    grip: { x: ${e.grip[0]}, y: ${e.grip[1]} },
    muzzle: { x: ${e.muzzle[0]}, y: ${e.muzzle[1]} },
    stagePieces: [${pieceTs(e.stagePiece)}],
    stageColors: {
${colorsTs(e.stageColors, '      ')}
    },
    stageGrip: { x: ${e.stageGrip[0]}, y: ${e.stageGrip[1]} },
    stageMuzzle: { x: ${e.stageMuzzle[0]}, y: ${e.stageMuzzle[1]} },
  },`).join('\n');

const out = `/**
 * GENERATED by scripts/convert-legendary-authored.mjs from the pxl
 * sources archived at
 * cybercache-prep/full-asset-audit/v4-evidence/sources/legendary-*.px.js.
 * Do not edit by hand: edit the .px.js source, re-run the converter,
 * commit both.
 *
 * Full Visual Program V4 (2026-11-07): the 26 bespoke legendaries as
 * hand-authored pxl data. Each entry is one fixed identity: card-density
 * form pieces (240x88 grid, CardShade keys), the legendary's own
 * resolved palette, declared grip/muzzle anchors (card texels, frozen
 * from the retired sprite's measured manifest anchors), and the
 * converter-derived stage-density pieces (120x44, PixelShade keys).
 */
import type { CardShade } from './weaponCardCompositor';
import type { PixelShade } from './weaponCompositor';

/** A bounding box of shade keys plus its seat on its density grid;
 *  rows are stored without trailing transparent cells (the S5
 *  authored-data contract, declared per data module). */
export interface AuthoredPiece {
  /** Top-left of the bounding box on the grid. */
  seat: [number, number];
  rows: string[];
}

export interface LegendaryAuthoredSet {
  /** Card-density form pieces, stamped in order on the 240x88 grid. */
  pieces: AuthoredPiece[];
  /** Full CardShade palette for this legendary (palette law: the
   *  game's hexes — shared steel ramp, brass/legendary gold, and the
   *  identity accent ramp E/e/c derived with hueLerp). */
  colors: Record<CardShade, string>;
  /** Declared grip point, card texels. */
  grip: { x: number; y: number };
  /** Declared muzzle point, card texels. */
  muzzle: { x: number; y: number };
  /** Stage-density form pieces on the 120x44 grid (converter-derived
   *  2x2 downsample of the card form; see the converter header). */
  stagePieces: AuthoredPiece[];
  /** Stage palette (PixelShade keys). */
  stageColors: Record<Exclude<PixelShade, '.'>, string>;
  /** Declared grip point, stage texels. */
  stageGrip: { x: number; y: number };
  /** Declared muzzle point, stage texels. */
  stageMuzzle: { x: number; y: number };
}

export const LEGENDARY_AUTHORED: Record<string, LegendaryAuthoredSet> = {
${body}
};
`;

writeFileSync(outPath, out);
console.log(`converter: wrote ${outPath} (${entries.length} legendaries)`);
