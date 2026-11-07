#!/usr/bin/env node
/**
 * Batch-1 converter — pxl authoring sources → checked-in grid data.
 *
 * The generalized form of the S5 converter
 * (scripts/convert-sniper-authored-bases.mjs): turns one weapon type's
 * authored part bases (`.px.js`, archived under the scale-up batch's
 * evidence dir) into `src/lib/pixel/<type>AuthoredData.ts`. The upstream
 * pxl tool stays a pinned reference, never a build dependency: this
 * script is author-side tooling, run by hand when the sources change;
 * its OUTPUT is what's committed, and re-running it reproduces the
 * committed data byte-for-byte (the extraction is `pxl ascii` — the
 * tool's own key grid — parsed deterministically).
 *
 * Batch-1 differences from the sniper pilot: the Sight slot carries
 * three authored forms here (the pistol/SMG/shotgun sight pass reads
 * the rolled variant, where the sniper's procedural pass collapsed to
 * one coded scope), and the shotgun exports no magazine anchors (its
 * Magazine slot authors the pump; procedural parity — no anchor).
 *
 * Usage:
 *   node scripts/convert-authored-bases.mjs <pistol|smg|shotgun|all>
 *     [--source <file.px.js>] [--pxl <pxl-bin>]
 *
 * Defaults resolve against this repo's workspace layout:
 *   source: ../cybercache-prep/pxl-craft-sweep/scaleup-batch1/sources/<type>-authored.px.js
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
const pxlBin = resolve(argOf('--pxl', resolve(repoRoot, '../skill-review/pxl/bin/pxl.js')));

const TYPES = {
  pistol: { prefix: 'PISTOL', label: 'Pistol', magazineAnchors: true },
  smg: { prefix: 'SMG', label: 'SMG', magazineAnchors: true },
  shotgun: { prefix: 'SHOTGUN', label: 'Shotgun', magazineAnchors: false },
};
const requested = args.find((a) => !a.startsWith('--') && TYPES[a] !== undefined || a === 'all');
if (!requested) {
  console.error('usage: node scripts/convert-authored-bases.mjs <pistol|smg|shotgun|all>');
  process.exit(1);
}
const typeNames = requested === 'all' ? Object.keys(TYPES) : [requested];

for (const typeName of typeNames) {
  const spec = TYPES[typeName];
  const sourcePath = resolve(argOf('--source', resolve(repoRoot, `../cybercache-prep/pxl-craft-sweep/scaleup-batch1/sources/${typeName}-authored.px.js`)));
  const outPath = resolve(repoRoot, `src/lib/pixel/${typeName}AuthoredData.ts`);
  const sourceRel = `cybercache-prep/pxl-craft-sweep/scaleup-batch1/sources/${typeName}-authored.px.js`;

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
    // row: right-aligned index, a space, then the key row. The digit
    // run is matched as a prefix of the repeating 0-9 sequence so
    // narrow canvases (< 10 wide, e.g. the aperture tower) parse too.
    const rulerIdx = lines.findIndex((l) => {
      const t = l.trim();
      return t.length > 0 && /^\d+$/.test(t) && '0123456789'.repeat(16).startsWith(t);
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

  const PIECE_KEYS = new Set('KkDdPpLEecTW'.split(''));
  function piece(name) {
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

  const triple = (base) => [piece(`${base}-0`), piece(`${base}-1`), piece(`${base}-2`)];
  const data = {
    layout: piece('layout'),
    barrel: triple('barrel'),
    grip: triple('grip'),
    core: triple('core'),
    magazine: triple('mag'),
    chamber: triple('chamber'),
    sight: triple('sight'),
  };
  const overlays = {
    magStripe: [overlayCells('overlay-mag-stripe-0'), overlayCells('overlay-mag-stripe-1'), overlayCells('overlay-mag-stripe-2')],
    receiverLine: overlayCells('overlay-receiver-line'),
    chamberLine: [overlayCells('overlay-chamber-line-0'), overlayCells('overlay-chamber-line-1'), overlayCells('overlay-chamber-line-2')],
  };

  const P = spec.prefix;
  const body = `/**
 * ${spec.label} authored bases — GENERATED by scripts/convert-authored-bases.mjs
 * from the pxl authoring sources archived at
 * ${sourceRel}.
 * Do not edit by hand: edit the .px.js, re-run the converter, commit
 * both. (Weapon Authored-Bases Scale-Up, Batch 1 — the S5 pilot's
 * pattern replicated per type.)
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

export const ${P}_AUTHORED_PIECES: {
  layout: AuthoredPiece;
  barrel: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
  grip: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
  core: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
  magazine: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
  chamber: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
  sight: [AuthoredPiece, AuthoredPiece, AuthoredPiece];
} = ${JSON.stringify(data, null, 1)};

/**
 * Rarity-gated geometry as overlay data: cell lists in card-grid
 * coordinates, stamped in the rarity trim shade ('g') only when the
 * item's tier carries the feature — magazine trim stripe
 * (Uncommon+), receiver trim line (Rare+), chamber rarity line
 * (Epic+). Authored per piece variant where the feature rides a
 * variant form.
 */
export const ${P}_AUTHORED_OVERLAYS: {
  magStripe: [[number, number][], [number, number][], [number, number][]];
  receiverLine: [number, number][];
  chamberLine: [[number, number][], [number, number][], [number, number][]];
} = ${JSON.stringify(overlays, null, 1)};

/** Chamber window centers per chamber variant (card-grid texels) —
 *  decal/anchor data, declared here rather than derived in code. */
export const ${P}_AUTHORED_CHAMBER_ANCHORS: [[number, number], [number, number], [number, number]] = ${JSON.stringify(ANCHORS.chamber)};
${spec.magazineAnchors ? `
/** Magazine visual centers per magazine variant (card-grid texels). */
export const ${P}_AUTHORED_MAGAZINE_ANCHORS: [[number, number], [number, number], [number, number]] = ${JSON.stringify(ANCHORS.magazine)};
` : ''}`;
  writeFileSync(outPath, body);
  console.log(`${typeName}: wrote ${outPath} (${body.length} bytes)`);
}
