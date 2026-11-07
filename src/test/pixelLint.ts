/**
 * Pxl Craft Sweep S2 — the pixel lint gate core.
 *
 * A port of the upstream pxl lint semantics (uilianks/pxl,
 * src/core/lint.ts — MIT; see ~/workspace/custom-skills/pxl-craft)
 * adapted to this repo's compositor output shape: renders are
 * shade-key grids (`rows: string[]`, '.' = transparent) plus a
 * key → hex color map, instead of pxl's raster images. The rules
 * and constants are pxl's unless a comment says otherwise:
 *
 *  - orphan: an opaque cell with NO same-color 8-neighbor, fully
 *    enclosed by opaque cells, whose luminance sits within 48 of
 *    its neighborhood mean — noise, not detail. (High-contrast
 *    singles — glints, sparkles — are excluded by the contrast
 *    term, exactly as upstream.)
 *  - jaggy: a doubled corner inside a 1-px line — an L of
 *    same-colored cells (one horizontal + one vertical neighbor,
 *    the diagonal empty, neither arm continuing straight) inside
 *    an 8-connected same-color component of 6+ cells containing
 *    no 2×2 block (a line, not a shape).
 *  - pillow: per hue family, brightness correlates > 0.55 with
 *    BFS distance from the family's own edge while the light's
 *    centroid sits within 0.04·√n of the region's centroid —
 *    light in the middle, dark all around.
 *  - colors: distinct-color discipline (pxl flags > 24 colors on
 *    canvases up to 64×64; larger lit renders are exempt there).
 *  - near-duplicate: two used colors closer than RGB distance 10
 *    read as one color (pxl applies this only at ≤ 64 colors).
 *
 * Plus ONE homegrown rule pxl does not have (the pxl-craft skill
 * names it our addition) — banding, in `lintBanding` below. The
 * defect has two faces and the rule checks both:
 *
 *  - Clause 1 (marching strips): a MARCH is a maximal vertical
 *    stack of ≥ 4 consecutive rows where each row's longest run
 *    of a single BODY shade key (line-work keys — outline, frame,
 *    shadow, glint — excluded by the caller, who knows the
 *    system's key roles) is at least max(6, 20% of width) cells
 *    long, consecutive rows' runs overlap by ≥ 75% of the shorter
 *    run, the stack uses ≥ 2 distinct keys, and at least one
 *    single-key strip inside it is ≥ 2 rows tall. A march is
 *    BANDING when its chromatic keys (saturation ≥ 0.15) span
 *    ≤ 3° of hue: the tones step in lightness only. A stack with
 *    fewer than 2 chromatic keys is exempt — achromatic ramps
 *    stay on the straight lerp by law (S1); they have no hue to
 *    shift.
 *  - Clause 2 (ramp hue travel): the latent form of the same
 *    defect. For each caller-named group of keys that derive
 *    from ONE base hex (a five-tone ramp, an accent ramp), the
 *    group's used chromatic tones must TRAVEL ≥ 4° in hue from
 *    darkest to lightest. A straight-lerp ramp travels exactly
 *    0° — every step the same hue, which is what made pre-S1
 *    renders read as flat bands however they were stacked. A
 *    hue-shifted ramp travels ~15–25°. Groups with < 3 used
 *    chromatic tones, or an achromatic base, are exempt.
 *  - Clause 2b (derived-step rotation): for systems whose
 *    palette derives single steps off verbatim bases (the weapon
 *    card's d / L / c), each derived step's hue must rotate
 *    ≥ 2° TOWARD its pxl target (250° for dark steps, 55° for
 *    light steps) from its base's hue, whenever the base is
 *    chromatic and the step moves lightness by ≥ 0.03. Pre-S1
 *    (hexLerp) rotation is exactly 0°.
 */

export interface LintRender {
  width: number;
  height: number;
  rows: string[];
  colors: Partial<Record<string, string>>;
}

export type LintRule = 'orphan' | 'jaggy' | 'pillow' | 'colors' | 'near-duplicate' | 'banding';

export interface LintFinding {
  rule: LintRule;
  message: string;
  /** Cells involved, when the finding is local. */
  at: [number, number][];
  /** near-duplicate only: the offending hex pairs. */
  pairs?: [string, string][];
}

const TRANSPARENT: unique symbol = Symbol('transparent');
type Cell = string | typeof TRANSPARENT;

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const mx = Math.max(rn, gn, bn);
  const mn = Math.min(rn, gn, bn);
  const li = (mx + mn) / 2;
  if (mx === mn) return [0, 0, li];
  const d = mx - mn;
  const sa = li > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hu = mx === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) : mx === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [hu * 60, sa, li];
}

const lum = (hex: string) => {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const N8: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** Resolve a render to a hex grid (TRANSPARENT for '.' cells). */
export function hexGrid(render: LintRender): Cell[][] {
  const grid: Cell[][] = [];
  for (let y = 0; y < render.height; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < render.width; x++) {
      const key = render.rows[y][x];
      if (key === '.') row.push(TRANSPARENT);
      else row.push(render.colors[key] ?? key);
    }
    grid.push(row);
  }
  return grid;
}

export function lintRender(render: LintRender, name = 'render'): LintFinding[] {
  const { width: w, height: h } = render;
  const img = hexGrid(render);
  const out: LintFinding[] = [];
  const get = (x: number, y: number): Cell => (x < 0 || y < 0 || x >= w || y >= h ? TRANSPARENT : img[y][x]);

  /* ---------------- orphan (pxl) ---------------- */
  const orphans: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = get(x, y);
      if (c === TRANSPARENT) continue;
      if (N8.some(([dx, dy]) => get(x + dx, y + dy) === c)) continue;
      if ([get(x - 1, y), get(x + 1, y), get(x, y - 1), get(x, y + 1)].some((n) => n === TRANSPARENT)) continue;
      // Diagonal neighbors may be transparent; upstream's packed
      // TRANSPARENT is 0, i.e. luminance 0 in this mean.
      const around = N8.map(([dx, dy]) => {
        const n = get(x + dx, y + dy);
        return n === TRANSPARENT ? 0 : lum(n as string);
      }).reduce((a, v) => a + v, 0) / 8;
      if (Math.abs(lum(c as string) - around) < 48) orphans.push([x, y]);
    }
  }
  if (orphans.length) {
    out.push({
      rule: 'orphan',
      at: orphans,
      message: `${name}: ${orphans.length} stray pixel${orphans.length > 1 ? 's' : ''} with no same-color neighbor and little contrast — noise rather than detail.`,
    });
  }

  /* ---------------- jaggy (pxl) ---------------- */
  const comp = new Int32Array(w * h).fill(-1);
  const compSize: number[] = [];
  const compThin: boolean[] = [];
  for (let y0 = 0; y0 < h; y0++) {
    for (let x0 = 0; x0 < w; x0++) {
      const c = get(x0, y0);
      if (c === TRANSPARENT || comp[y0 * w + x0] >= 0) continue;
      const id = compSize.length;
      const stack = [y0 * w + x0];
      comp[stack[0]] = id;
      let size = 0;
      let thin = true;
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % w;
        const y = (i / w) | 0;
        size++;
        if (get(x + 1, y) === c && get(x, y + 1) === c && get(x + 1, y + 1) === c) thin = false;
        for (const [dx, dy] of N8) {
          const nx = x + dx;
          const ny = y + dy;
          if (get(nx, ny) !== c || comp[ny * w + nx] >= 0) continue;
          comp[ny * w + nx] = id;
          stack.push(ny * w + nx);
        }
      }
      compSize.push(size);
      compThin.push(thin);
    }
  }
  const jag: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = get(x, y);
      if (c === TRANSPARENT) continue;
      const same = (dx: number, dy: number) => get(x + dx, y + dy) === c;
      const count = N8.filter(([dx, dy]) => same(dx, dy)).length;
      const id = comp[y * w + x];
      if (count !== 2 || compSize[id] < 6 || !compThin[id]) continue;
      for (const [hx, vy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as [number, number][]) {
        if (same(hx, 0) && same(0, vy) && !same(hx, vy) && !same(2 * hx, 0) && !same(0, 2 * vy)) {
          jag.push([x, y]);
          break;
        }
      }
    }
  }
  if (jag.length) {
    out.push({
      rule: 'jaggy',
      at: jag,
      message: `${name}: ${jag.length} doubled corner${jag.length > 1 ? 's' : ''} in 1-px lines (an L where the line should step diagonally).`,
    });
  }

  /* ---------------- pillow (pxl) ---------------- */
  const family = (hex: string) => {
    const [r, g, b] = channels(hex);
    const [hu, sa, li] = rgbToHsl(r, g, b);
    return sa < 0.15 || li < 0.1 || li > 0.88 ? -1 : Math.round(hu / 40) % 9;
  };
  const fam = new Int8Array(w * h).fill(-2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = get(x, y);
      if (c !== TRANSPARENT) fam[y * w + x] = family(c as string);
    }
  }
  const famAt = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -2 : fam[y * w + x]);
  const pillows: number[] = [];
  for (const f of new Set(fam)) {
    if (f < 0) continue;
    const dist = new Int32Array(w * h).fill(-1);
    const q: number[] = [];
    const inside = (x: number, y: number) => {
      const g = famAt(x, y);
      return g === f || g === -1;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!inside(x, y)) continue;
        if (N8.some(([dx, dy]) => !inside(x + dx, y + dy))) {
          dist[y * w + x] = 0;
          q.push(y * w + x);
        }
      }
    }
    for (let k = 0; k < q.length; k++) {
      const i = q[k];
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * w + nx;
        if (!inside(nx, ny) || dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
    let n = 0;
    let sd = 0;
    let sl = 0;
    let sdd = 0;
    let sll = 0;
    let sdl = 0;
    let cx = 0;
    let cy = 0;
    let lx = 0;
    let ly = 0;
    let lw = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = dist[y * w + x];
        if (d < 1 || fam[y * w + x] !== f) continue;
        const l = lum(get(x, y) as string);
        n++;
        sd += d;
        sl += l;
        sdd += d * d;
        sll += l * l;
        sdl += d * l;
        cx += x;
        cy += y;
        lx += x * l;
        ly += y * l;
        lw += l;
      }
    }
    if (n < 40) continue;
    const corr = (n * sdl - sd * sl) / Math.sqrt(Math.max(1e-9, (n * sdd - sd * sd) * (n * sll - sl * sl)));
    const offset = Math.hypot(lx / lw - cx / n, ly / lw - cy / n) / Math.sqrt(n);
    if (corr > 0.55 && offset < 0.04) pillows.push(corr);
  }
  if (pillows.length) {
    out.push({
      rule: 'pillow',
      at: [],
      message: `${name}: pillow shading — brightness rises toward the middle on every side (correlation ${Math.max(...pillows).toFixed(2)} with distance from the edge, light centered).`,
    });
  }

  /* ---------------- colors + near-duplicate (pxl) ---------------- */
  const counts = new Map<string, number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = get(x, y);
      if (c !== TRANSPARENT) counts.set(c as string, (counts.get(c as string) ?? 0) + 1);
    }
  }
  const cols = [...counts.keys()];
  if (cols.length > 24 && w * h <= 64 * 64) {
    out.push({
      rule: 'colors',
      at: [],
      message: `${name}: ${cols.length} colors in a ${w}x${h} render — small sprites read best with a tight palette (8–16).`,
    });
  }
  const pairs: [string, string][] = [];
  if (cols.length <= 64) {
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        const a = channels(cols[i]);
        const b = channels(cols[j]);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d > 0 && d < 10) pairs.push([cols[i], cols[j]]);
      }
    }
  }
  if (pairs.length) {
    const shown = pairs.map(([a, b]) => `${a}~${b}`);
    out.push({
      rule: 'near-duplicate',
      at: [],
      pairs,
      message: `${name}: ${pairs.length} color pair${pairs.length > 1 ? 's' : ''} so close they read as one (${shown.slice(0, 6).join(' ')}${shown.length > 6 ? ' …' : ''}).`,
    });
  }

  return out;
}

/* ================================================================== */
/* Banding (homegrown — metric defined in the header)                  */
/* ================================================================== */

export interface BandingOptions {
  /** Keys that are line-work, not body tone: outline, frame, ground
   *  shadow, glint. Excluded from march candidacy (clause 1). */
  lineKeys?: Set<string>;
  /** Key groups that derive from ONE base hex (clause 2). */
  rampGroups?: string[][];
  /** Tone families for clause 1: a march is judged only when ≥ 2
   *  of its keys share one family — bands are ONE material's
   *  tones stepping; a stack spanning two materials is
   *  composition, not banding. Defaults to rampGroups. */
  marchGroups?: string[][];
  /** Single derived steps off verbatim bases (clause 2b). */
  derivedPairs?: { derived: string; base: string; toward: 250 | 55 }[];
}

const angDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

function hslOf(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex);
  return rgbToHsl(r, g, b);
}

export function lintBanding(render: LintRender, name = 'render', opts: BandingOptions = {}): LintFinding[] {
  const { width: w, height: h } = render;
  const out: LintFinding[] = [];
  const lineKeys = opts.lineKeys ?? new Set<string>();

  /* ---- clause 1: marching strips ---- */
  const runMin = Math.max(6, Math.round(w * 0.2));
  interface RowRun { key: string; x0: number; x1: number }
  const bestRun = (yy: number): RowRun | null => {
    let best: RowRun | null = null;
    let x = 0;
    while (x < w) {
      const key = render.rows[yy][x];
      if (key === '.' || lineKeys.has(key)) {
        x++;
        continue;
      }
      let x1 = x;
      while (x1 + 1 < w && render.rows[yy][x1 + 1] === key) x1++;
      if (x1 - x + 1 >= runMin && (!best || x1 - x > best.x1 - best.x0)) best = { key, x0: x, x1 };
      x = x1 + 1;
    }
    return best;
  };
  const runs: (RowRun | null)[] = [];
  for (let yy = 0; yy < h; yy++) runs.push(bestRun(yy));
  let y = 0;
  while (y < h) {
    if (!runs[y]) {
      y++;
      continue;
    }
    let yEnd = y;
    const stack: RowRun[] = [runs[y]!];
    while (yEnd + 1 < h && runs[yEnd + 1]) {
      const a = runs[yEnd]!;
      const b = runs[yEnd + 1]!;
      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
      const shorter = Math.min(a.x1 - a.x0, b.x1 - b.x0) + 1;
      if (overlap < shorter * 0.75) break;
      yEnd++;
      stack.push(b);
    }
    if (yEnd - y + 1 >= 4) {
      const keys = stack.map((r) => r.key);
      const distinct = new Set(keys);
      // At least one single-key strip ≥ 2 rows: bands have thickness.
      let strip = 1;
      let maxStrip = 1;
      for (let i = 1; i < keys.length; i++) {
        strip = keys[i] === keys[i - 1] ? strip + 1 : 1;
        maxStrip = Math.max(maxStrip, strip);
      }
      const sharesRamp = (opts.marchGroups ?? opts.rampGroups ?? []).some((group) => {
        const inGroup = new Set(group);
        return [...distinct].filter((k) => inGroup.has(k)).length >= 2;
      });
      if (distinct.size >= 2 && maxStrip >= 2 && sharesRamp) {
        const hues: number[] = [];
        for (const key of distinct) {
          const hex = render.colors[key];
          if (!hex) continue;
          const [hu, sa] = hslOf(hex);
          if (sa >= 0.15) hues.push(hu);
        }
        if (hues.length >= 2) {
          let spread = 0;
          for (const a of hues) for (const b of hues) spread = Math.max(spread, angDist(a, b));
          if (spread <= 3) {
            const stackWidth = Math.max(...stack.map((r) => r.x1 - r.x0 + 1));
            out.push({
              rule: 'banding',
              at: stack.map((r, i) => [r.x0, y + i] as [number, number]),
              message: `${name}: tone march at rows ${y}–${yEnd} (${stackWidth} wide, keys ${[...distinct].join('/')}) — hue spread ${spread.toFixed(1)}° across the stack: flat bands stepping in lightness only.`,
            });
          }
        }
      }
    }
    y = yEnd + 1;
  }

  /* ---- clause 2: ramp hue travel ---- */
  const usedKeys = new Set<string>();
  for (const row of render.rows) for (const ch of row) if (ch !== '.') usedKeys.add(ch);
  for (const group of opts.rampGroups ?? []) {
    const tones: { key: string; hue: number }[] = [];
    const seenHex = new Set<string>();
    for (const key of group) {
      const hex = render.colors[key];
      if (!hex || !usedKeys.has(key) || seenHex.has(hex)) continue;
      seenHex.add(hex);
      const [hu, sa] = hslOf(hex);
      if (sa >= 0.15) tones.push({ key, hue: hu });
    }
    if (tones.length < 3) continue; // too little of the ramp in play — exempt
    let travel = 0;
    for (const a of tones) for (const b of tones) travel = Math.max(travel, angDist(a.hue, b.hue));
    if (travel < 4) {
      out.push({
        rule: 'banding',
        at: [],
        message: `${name}: ramp [${group.join('/')}] travels only ${travel.toFixed(1)}° of hue across its used tones — a straight lightness ramp (the latent form of banding).`,
      });
    }
  }

  /* ---- clause 2b: derived-step rotation ---- */
  for (const pair of opts.derivedPairs ?? []) {
    const baseHex = render.colors[pair.base];
    const derHex = render.colors[pair.derived];
    if (!baseHex || !derHex || !usedKeys.has(pair.derived)) continue;
    const [baseHue, baseSat, baseL] = hslOf(baseHex);
    const [derHue, , derL] = hslOf(derHex);
    if (baseSat < 0.15) continue; // achromatic base: no hue to rotate
    if (Math.abs(derL - baseL) < 0.03) continue; // not a real step
    const moved = angDist(baseHue, pair.toward) - angDist(derHue, pair.toward);
    if (moved < 2) {
      out.push({
        rule: 'banding',
        at: [],
        message: `${name}: derived step ${pair.derived} rotates only ${moved.toFixed(1)}° toward ${pair.toward}° from its base ${pair.base} — a straight-lerp step (the latent form of banding).`,
      });
    }
  }

  return out;
}
