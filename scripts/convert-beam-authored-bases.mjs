#!/usr/bin/env node
/**
 * S5 scale-up batch 2 converter — pxl authoring sources → checked-in
 * grid data, for the BEAM.
 *
 * Turns the beam's authored part bases (`.px.js`, archived under
 * the batch-2 evidence dir) into `src/lib/pixel/beamAuthoredData.ts`.
 * Adapted from the S5 pilot's scripts/convert-sniper-authored-bases.mjs
 * with the beam's own deltas, each forced by the shipped procedural
 * form it replaces:
 *  - the Sight slot converts as a 3-variant array (the beam reads
 *    its sight variant — iron posts / reflex box / aperture tower;
 *    nothing collapses);
 *  - the form-key set admits 'b' on top of the sniper's: brass
 *    collar rings, channel ticks, and cell bolts are part of the
 *    beam's form language (the procedural beam draws them in its
 *    form passes); the sniper's grids needed none.
 *
 * The upstream pxl tool stays a pinned reference, never a build
 * dependency: this script is author-side tooling, run by hand when
 * the sources change; its OUTPUT is what's committed, and
 * re-running it reproduces the data byte-for-byte (the extraction
 * is `pxl ascii` — the tool's own key grid — parsed
 * deterministically).
 *
 * Usage:
 *   node scripts/convert-beam-authored-bases.mjs [--source <file.px.js>] [--pxl <pxl-bin>]
 *
 * Defaults resolve against this repo's workspace layout:
 *   source: ../cybercache-prep/pxl-craft-sweep/scaleup-batch2/sources/beam-authored.px.js
 *   pxl:    ../skill-review/pxl/bin/pxl.js
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const sourcePath = resolve(argOf('--source', resolve(repoRoot, '../cybercache-prep/pxl-craft-sweep/scaleup-batch2/sources/beam-authored.px.js')));
const pxlBin = resolve(argOf('--pxl', resolve(repoRoot, '../skill-review/pxl/bin/pxl.js')));
const outPath = resolve(repoRoot, 'src/lib/pixel/beamAuthoredData.ts');

const source = readFileSync(sourcePath, 'utf8');
const blockJson = (name) => {
  const m = source.match(new RegExp(`^// ${name} (\\{.*\\})$`, 'm'));
  if (!m) throw new Error(`converter: ${name} block not found in ${sourcePath}`);
  return JSON.parse(m[1]);
};
const SEATS = blockJson('SEATS');
const ANCHORS = blockJson('ANCHORS');

/** Extract one sprite's key grid via the tool's own ascii dump. */
function asciiGrid(name) {
  const text = execFileSync('node', [pxlBin, 'ascii', sourcePath, name], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const lines = text.split('\n');
  // The dump is two ruler lines (the second is the repeating digit
  // run whose length is the canvas width) followed by one line per
  // row: right-aligned index, a space, then the key row.
  const rulerIdx = lines.findIndex((l) => /^\s*0123456789/.test(l));
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

const PIECE_KEYS = new Set('KkDdPpLEecTWb'.split(''));
function piece(name) {
  if (!(name in SEATS)) throw new Error(`converter: no seat declared for ${name}`);
  const grid = asciiGrid(name);
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      if (!PIECE_KEYS.has(ch)) throw new Error(`converter: ${name}: key '${ch}' is not a form key (overlays own 'g')`);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
  });
  if (maxX < 0) throw new Error(`converter: ${name}: empty sprite`);
  const [sx, sy] = SEATS[name];
  const rows = grid.slice(minY, maxY + 1).map((r) => r.slice(minX, maxX + 1).replace(/\.+$/, ''));
  const seat = [sx + minX, sy + minY];
  if (seat[0] < 0 || seat[1] < 0 || seat[0] + (maxX - minX) >= 240 || seat[1] + (maxY - minY) >= 88) {
    throw new Error(`converter: ${name}: seated bbox escapes the 240x88 card grid`);
  }
  return { seat, rows };
}

function overlayCells(name) {
  if (!(name in SEATS)) throw new Error(`converter: no seat declared for ${name}`);
  const grid = asciiGrid(name);
  const [sx, sy] = SEATS[name];
  const cells = [];
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      if (ch !== 'g') throw new Error(`converter: ${name}: overlay sprites carry only the trim key 'g', found '${ch}'`);
      cells.push([sx + x, sy + y]);
    });
  });
  if (!cells.length) throw new Error(`converter: ${name}: empty overlay`);
  return cells;
}

const data = {
  layout: piece('layout'),
  barrel: [piece('barrel-0'), piece('barrel-1'), piece('barrel-2')],
  grip: [piece('grip-0'), piece('grip-1'), piece('grip-2')],
  core: [piece('core-0'), piece('core-1'), piece('core-2')],
  magazine: [piece('mag-0'), piece('mag-1'), piece('mag-2')],
  chamber: [piece('chamber-0'), piece('chamber-1'), piece('chamber-2')],
  sight: [piece('sight-0'), piece('sight-1'), piece('sight-2')],
};
const overlays = {
  magStripe: [overlayCells('overlay-mag-stripe-0'), overlayCells('overlay-mag-stripe-1'), overlayCells('overlay-mag-stripe-2')],
  receiverLine: overlayCells('overlay-receiver-line'),
  chamberLine: [overlayCells('overlay-chamber-line-0'), overlayCells('overlay-chamber-line-1'), overlayCells('overlay-chamber-line-2')],
};

const body = `/**
 * Beam authored bases — GENERATED by
 * scripts/convert-beam-authored-bases.mjs from the pxl authoring
 * source archived at cybercache-prep/pxl-craft-sweep/
 * scaleup-batch2/sources/beam-authored.px.js. Do not edit by
 * hand: edit the .px.js, re-run the converter, keep both.
 * (Pxl Craft Sweep S5 scale-up, batch 2 — Beam.)
 *
 * Each piece is a bounding box of CardShade keys plus its seat on
 * the 240x88 card grid; rows are stored without trailing transparent
 * cells. The compositor stamps the pieces the layout seats, exactly
 * where the procedural form passes used to draw — palette resolution,
 * outline, finishes, decals, and condition all run as today.
 */
export interface AuthoredPiece {
  /** Top-left of the bounding box on the card grid. */
  seat: [number, number];
  rows: string[];
}

export const BEAM_AUTHORED_PIECES: {
  layout: AuthoredPiece;
  barrel: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
  grip: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
  core: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
  magazine: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
  chamber: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
  sight: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
} = ${JSON.stringify(data, null, 1)};

/**
 * Rarity-gated geometry as overlay data (sweep scope 5): cell lists
 * in card-grid coordinates, stamped in the rarity trim shade ('g')
 * only when the item's tier carries the feature — cell trim stripe
 * (Uncommon+), receiver trim line (Rare+), chamber rarity line
 * (Epic+). Authored per piece variant where the feature rides a
 * variant form.
 */
export const BEAM_AUTHORED_OVERLAYS: {
  magStripe: [[number, number][], [number, number][], [number, number][]];
  receiverLine: [number, number][];
  chamberLine: [[number, number][], [number, number][], [number, number][]];
} = ${JSON.stringify(overlays, null, 1)};

/** Chamber window centers per chamber variant (card-grid texels). */
export const BEAM_AUTHORED_CHAMBER_ANCHORS: [[number, number], [number, number], [number, number]] = ${JSON.stringify([ANCHORS.chamber['0'], ANCHORS.chamber['1'], ANCHORS.chamber['2']])};

/** Magazine (power cell) part anchors per cell variant (card-grid texels). */
export const BEAM_AUTHORED_MAGAZINE_ANCHORS: [[number, number], [number, number], [number, number]] = ${JSON.stringify([ANCHORS.magazine['0'], ANCHORS.magazine['1'], ANCHORS.magazine['2']])};
`;

writeFileSync(outPath, body);
console.log(`converter: wrote ${outPath} (${Buffer.byteLength(body)} bytes) from ${sourcePath}`);
