/**
 * Deterministic SVG-subset rasterizer for the W5 gear plates.
 *
 * The four non-weapon gear illustrations (src/components/gearArt/) are
 * React components that emit SVG. The wiki generator has no browser and
 * no native SVG library (docs/WIKI.md: plates render from the game's own
 * sources with the repo's own toolchain), so this module renders the
 * markup those components actually emit — obtained via react-dom/server
 * — with a small, fully deterministic rasterizer for exactly the subset
 * they use:
 *
 *   elements: svg, g, path, circle, rect (+ defs/linearGradient/stop
 *   collection; filter subtrees are parsed past, text is skipped —
 *   the plates render with showBadges=false, and affix decals are
 *   per-instance, so no text reaches a plate)
 *   paint:    solid fills (hex / rgb() / rgba() / none), linear gradients
 *             in objectBoundingBox or userSpaceOnUse units, strokes as
 *             capsules (round caps/joins), element/group opacity,
 *             fill-opacity / stroke-opacity
 *   paths:    M L H V C S Q T A Z, absolute + relative, flattened with
 *             a fixed flatness tolerance; all geometry is quantized to
 *             a 1/256 grid before sampling so coverage cannot flip on
 *             float dust between runs
 *   sampling: 2x2 supersampling, premultiplied-alpha source-over,
 *             one final quantization — same markup in, same bytes out
 *
 * What it deliberately does NOT reproduce (disclosed in images-w5.ts):
 * the procedural surface/bevel filters (feTurbulence + specular
 * lighting in SharedDefs) and the CSS drop-shadow glow the card wrapper
 * adds. Those are texture/glow treatments over the same shapes; the
 * plate carries the illustration's geometry, gradients, and colors.
 * An element or paint form outside the subset throws — a future
 * illustration feature must fail the wiki build loudly, never render
 * silently wrong.
 */
import type { RgbaImage } from '../../src/lib/pixel/pngCodec';

/* ------------------------------------------------------------------ */
/* Tiny XML reader (machine-generated markup only)                     */
/* ------------------------------------------------------------------ */

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

function parseXml(markup: string): XmlNode {
  let i = 0;
  const n = markup.length;
  const fail = (msg: string): never => {
    throw new Error(`svgRaster: ${msg} (offset ${i})`);
  };
  function skipMisc(): void {
    for (;;) {
      while (i < n && /\s/.test(markup[i])) i++;
      if (markup.startsWith('<!--', i)) {
        const end = markup.indexOf('-->', i);
        if (end < 0) fail('unterminated comment');
        i = end + 3;
      } else return;
    }
  }
  function parseElement(): XmlNode {
    skipMisc();
    if (markup[i] !== '<') fail('expected <');
    i++;
    const tagMatch = /^[A-Za-z][\w:.-]*/.exec(markup.slice(i));
    if (!tagMatch) fail('expected tag name');
    const tag = tagMatch[0];
    i += tag.length;
    const attrs: Record<string, string> = {};
    for (;;) {
      while (i < n && /\s/.test(markup[i])) i++;
      if (markup.startsWith('/>', i)) {
        i += 2;
        return { tag, attrs, children: [] };
      }
      if (markup[i] === '>') {
        i++;
        break;
      }
      const nameMatch = /^[^\s=/>]+/.exec(markup.slice(i));
      if (!nameMatch) fail('expected attribute name');
      const name = nameMatch[0];
      i += name.length;
      while (i < n && /\s/.test(markup[i])) i++;
      if (markup[i] !== '=') fail(`expected = after attribute ${name}`);
      i++;
      while (i < n && /\s/.test(markup[i])) i++;
      const quote = markup[i];
      if (quote !== '"' && quote !== "'") fail('expected quoted attribute value');
      const end = markup.indexOf(quote, i + 1);
      if (end < 0) fail('unterminated attribute value');
      attrs[name] = markup
        .slice(i + 1, end)
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      i = end + 1;
    }
    const children: XmlNode[] = [];
    for (;;) {
      const lt = markup.indexOf('<', i);
      if (lt < 0) fail(`unterminated element <${tag}>`);
      i = lt; // text content is skipped wholesale (plates carry no text)
      if (markup.startsWith('</', i)) {
        const end = markup.indexOf('>', i);
        if (end < 0) fail('unterminated close tag');
        const closing = markup.slice(i + 2, end).trim();
        if (closing !== tag) fail(`mismatched close </${closing}> for <${tag}>`);
        i = end + 1;
        return { tag, attrs, children };
      }
      if (markup.startsWith('<!--', i)) {
        const end = markup.indexOf('-->', i);
        if (end < 0) fail('unterminated comment');
        i = end + 3;
        continue;
      }
      children.push(parseElement());
    }
  }
  const root = parseElement();
  return root;
}

/* ------------------------------------------------------------------ */
/* Colors                                                              */
/* ------------------------------------------------------------------ */

type Rgba = [number, number, number, number]; // floats 0..1, straight alpha

const NAMED: Record<string, Rgba> = {
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
  none: [0, 0, 0, 0],
};

function parseColor(raw: string): Rgba {
  const s = raw.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = [...m[1]].map((c) => parseInt(c + c, 16) / 255);
    return [r, g, b, 1];
  }
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    return [
      parseInt(m[1].slice(0, 2), 16) / 255,
      parseInt(m[1].slice(2, 4), 16) / 255,
      parseInt(m[1].slice(4, 6), 16) / 255,
      1,
    ];
  }
  m = /^#([0-9a-f]{8})$/.exec(s);
  if (m) {
    return [
      parseInt(m[1].slice(0, 2), 16) / 255,
      parseInt(m[1].slice(2, 4), 16) / 255,
      parseInt(m[1].slice(4, 6), 16) / 255,
      parseInt(m[1].slice(6, 8), 16) / 255,
    ];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p));
    if (parts.length === 3) return [parts[0] / 255, parts[1] / 255, parts[2] / 255, 1];
    if (parts.length === 4) return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3]];
  }
  throw new Error(`svgRaster: unsupported color "${raw}"`);
}

/* ------------------------------------------------------------------ */
/* Affine transforms                                                   */
/* ------------------------------------------------------------------ */

type Mat = [number, number, number, number, number, number]; // a b c d e f

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function multiply(m: Mat, t: Mat): Mat {
  return [
    m[0] * t[0] + m[2] * t[1],
    m[1] * t[0] + m[3] * t[1],
    m[0] * t[2] + m[2] * t[3],
    m[1] * t[2] + m[3] * t[3],
    m[0] * t[4] + m[2] * t[5] + m[4],
    m[1] * t[4] + m[3] * t[5] + m[5],
  ];
}

function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) throw new Error('svgRaster: non-invertible transform');
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

function parseTransform(raw: string | undefined, base: Mat): Mat {
  if (!raw) return base;
  let out = base;
  const re = /([a-zA-Z]+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const args = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    const rad = (deg: number) => (deg * Math.PI) / 180;
    switch (m[1]) {
      case 'translate':
        out = multiply(out, [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]);
        break;
      case 'scale':
        out = multiply(out, [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]);
        break;
      case 'rotate': {
        const c = Math.cos(rad(args[0] ?? 0));
        const s = Math.sin(rad(args[0] ?? 0));
        let rot: Mat = [c, s, -s, c, 0, 0];
        if (args.length >= 3) {
          rot = multiply(multiply([1, 0, 0, 1, args[1], args[2]], rot), [1, 0, 0, 1, -args[1], -args[2]]);
        }
        out = multiply(out, rot);
        break;
      }
      case 'matrix':
        if (args.length !== 6) throw new Error('svgRaster: matrix() needs 6 args');
        out = multiply(out, args as Mat);
        break;
      default:
        throw new Error(`svgRaster: unsupported transform "${m[1]}"`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Path flattening                                                     */
/* ------------------------------------------------------------------ */

const Q = 256; // geometry quantization grid (1/256 viewBox unit)
const q = (v: number): number => Math.round(v * Q) / Q;

interface Pt {
  x: number;
  y: number;
}

interface Subpath {
  pts: Pt[];
  closed: boolean;
}

function flattenPath(d: string): Subpath[] {
  const tokens = d.match(/[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  let ti = 0;
  const num = (): number => {
    const v = Number(tokens[ti++]);
    if (!Number.isFinite(v)) throw new Error(`svgRaster: bad number in path "${d.slice(0, 40)}…"`);
    return v;
  };
  const subpaths: Subpath[] = [];
  let cur: Subpath | null = null;
  let cx = 0;
  let cy = 0; // current point
  let sx = 0;
  let sy = 0; // subpath start
  let prevCmd = '';
  let prevCtrl: Pt | null = null; // for S/T reflection

  const push = (x: number, y: number) => {
    if (!cur) {
      cur = { pts: [], closed: false };
      subpaths.push(cur);
    }
    cur.pts.push({ x: q(x), y: q(y) });
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const p0 = { x: cx, y: cy };
    const p1 = { x: x1, y: y1 };
    const p2 = { x: x2, y: y2 };
    const p3 = { x: x3, y: y3 };
    const subdivide = (a: Pt, b: Pt, cc: Pt, dd: Pt, depth: number) => {
      const mid = (u: Pt, v: Pt): Pt => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 });
      const ab = mid(a, b);
      const bc = mid(b, cc);
      const cd = mid(cc, dd);
      const abc = mid(ab, bc);
      const bcd = mid(bc, cd);
      const abcd = mid(abc, bcd);
      // Flatness: distance of both control points from the chord.
      const dx = dd.x - a.x;
      const dy = dd.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const dist = (p: Pt) => Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
      if (depth >= 10 || (dist(b) < 0.05 && dist(cc) < 0.05)) {
        push(dd.x, dd.y);
        return;
      }
      subdivide(a, ab, abc, abcd, depth + 1);
      subdivide(abcd, bcd, cd, dd, depth + 1);
    };
    subdivide(p0, p1, p2, p3, 0);
    cx = x3;
    cy = y3;
    prevCtrl = { x: x2, y: y2 };
  };
  const quad = (x1: number, y1: number, x2: number, y2: number) => {
    // Degree-elevate to a cubic and reuse the flattener.
    const c1x = cx + (2 / 3) * (x1 - cx);
    const c1y = cy + (2 / 3) * (y1 - cy);
    const c2x = x2 + (2 / 3) * (x1 - x2);
    const c2y = y2 + (2 / 3) * (y1 - y2);
    cubic(c1x, c1y, c2x, c2y, x2, y2);
    prevCtrl = { x: x1, y: y1 };
  };
  const arc = (rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x: number, y: number) => {
    if (rx === 0 || ry === 0) {
      push(x, y);
      cx = x;
      cy = y;
      prevCtrl = null;
      return;
    }
    const phi = (rotDeg * Math.PI) / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const dx = (cx - x) / 2;
    const dy = (cy - y) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;
    let rxi = Math.abs(rx);
    let ryi = Math.abs(ry);
    const lambda = (x1p * x1p) / (rxi * rxi) + (y1p * y1p) / (ryi * ryi);
    if (lambda > 1) {
      rxi *= Math.sqrt(lambda);
      ryi *= Math.sqrt(lambda);
    }
    const num_ = rxi * rxi * ryi * ryi - rxi * rxi * y1p * y1p - ryi * ryi * x1p * x1p;
    const den = rxi * rxi * y1p * y1p + ryi * ryi * x1p * x1p;
    let co = den === 0 ? 0 : Math.sqrt(Math.max(0, num_ / den));
    if (large === sweep) co = -co;
    const cxp = (co * rxi * y1p) / ryi;
    const cyp = (-co * ryi * x1p) / rxi;
    const ccx = cosPhi * cxp - sinPhi * cyp + (cx + x) / 2;
    const ccy = sinPhi * cxp + cosPhi * cyp + (cy + y) / 2;
    const angle = (ux: number, uy: number, vx: number, vy: number) => {
      const dot = ux * vx + uy * vy;
      const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
      let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    };
    const theta1 = angle(1, 0, (x1p - cxp) / rxi, (y1p - cyp) / ryi);
    let dTheta = angle((x1p - cxp) / rxi, (y1p - cyp) / ryi, (-x1p - cxp) / rxi, (-y1p - cyp) / ryi);
    if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
    if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
    const steps = Math.min(64, Math.max(4, Math.ceil(Math.abs(dTheta) / (Math.PI / 16))));
    for (let s = 1; s <= steps; s++) {
      const t = theta1 + (dTheta * s) / steps;
      const ex = rxi * Math.cos(t);
      const ey = ryi * Math.sin(t);
      push(ccx + cosPhi * ex - sinPhi * ey, ccy + sinPhi * ex + cosPhi * ey);
    }
    cx = x;
    cy = y;
    prevCtrl = null;
  };

  while (ti < tokens.length) {
    let cmd = tokens[ti];
    if (/[A-Za-z]/.test(cmd)) ti++;
    else cmd = prevCmd;
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        let x = num();
        let y = num();
        if (rel) {
          x += cx;
          y += cy;
        }
        cx = sx = x;
        cy = sy = y;
        cur = { pts: [{ x: q(x), y: q(y) }], closed: false };
        subpaths.push(cur);
        prevCtrl = null;
        prevCmd = rel ? 'l' : 'L';
        continue;
      }
      case 'L': {
        let x = num();
        let y = num();
        if (rel) {
          x += cx;
          y += cy;
        }
        push(x, y);
        cx = x;
        cy = y;
        prevCtrl = null;
        break;
      }
      case 'H': {
        let x = num();
        if (rel) x += cx;
        push(x, cy);
        cx = x;
        prevCtrl = null;
        break;
      }
      case 'V': {
        let y = num();
        if (rel) y += cy;
        push(cx, y);
        cy = y;
        prevCtrl = null;
        break;
      }
      case 'C': {
        const x1 = num() + (rel ? cx : 0);
        const y1 = num() + (rel ? cy : 0);
        const x2 = num() + (rel ? cx : 0);
        const y2 = num() + (rel ? cy : 0);
        const x3 = num() + (rel ? cx : 0);
        const y3 = num() + (rel ? cy : 0);
        cubic(x1, y1, x2, y2, x3, y3);
        break;
      }
      case 'S': {
        const x2 = num() + (rel ? cx : 0);
        const y2 = num() + (rel ? cy : 0);
        const x3 = num() + (rel ? cx : 0);
        const y3 = num() + (rel ? cy : 0);
        const x1 = prevCtrl && (prevCmd.toUpperCase() === 'C' || prevCmd.toUpperCase() === 'S') ? 2 * cx - prevCtrl.x : cx;
        const y1 = prevCtrl && (prevCmd.toUpperCase() === 'C' || prevCmd.toUpperCase() === 'S') ? 2 * cy - prevCtrl.y : cy;
        cubic(x1, y1, x2, y2, x3, y3);
        break;
      }
      case 'Q': {
        const x1 = num() + (rel ? cx : 0);
        const y1 = num() + (rel ? cy : 0);
        const x2 = num() + (rel ? cx : 0);
        const y2 = num() + (rel ? cy : 0);
        quad(x1, y1, x2, y2);
        break;
      }
      case 'T': {
        const x2 = num() + (rel ? cx : 0);
        const y2 = num() + (rel ? cy : 0);
        const x1 = prevCtrl && (prevCmd.toUpperCase() === 'Q' || prevCmd.toUpperCase() === 'T') ? 2 * cx - prevCtrl.x : cx;
        const y1 = prevCtrl && (prevCmd.toUpperCase() === 'Q' || prevCmd.toUpperCase() === 'T') ? 2 * cy - prevCtrl.y : cy;
        quad(x1, y1, x2, y2);
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num() !== 0;
        const sweep = num() !== 0;
        let x = num();
        let y = num();
        if (rel) {
          x += cx;
          y += cy;
        }
        arc(rx, ry, rot, large, sweep, x, y);
        break;
      }
      case 'Z': {
        if (cur) {
          cur.closed = true;
          if (cur.pts.length && (cur.pts[0].x !== cx || cur.pts[0].y !== cy)) push(sx, sy);
        }
        cx = sx;
        cy = sy;
        prevCtrl = null;
        break;
      }
      default:
        throw new Error(`svgRaster: unsupported path command "${cmd}"`);
    }
    prevCmd = cmd;
  }
  return subpaths.filter((s) => s.pts.length > 0);
}

/* ------------------------------------------------------------------ */
/* Scene compilation                                                   */
/* ------------------------------------------------------------------ */

interface Gradient {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  userSpace: boolean;
  stops: { offset: number; color: Rgba }[];
}

type Paint =
  | { kind: 'none' }
  | { kind: 'solid'; color: Rgba }
  | { kind: 'gradient'; gradient: Gradient };

interface Shape {
  /** Device-space subpaths (fill geometry; stroke uses the same). */
  subpaths: Subpath[];
  /** Device-space bbox of the fill geometry (pre-transform bbox for gradient sampling). */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Local (pre-transform) bbox — objectBoundingBox gradients sample in this space. */
  localBbox: { minX: number; minY: number; maxX: number; maxY: number };
  inverse: Mat;
  fill: Paint;
  fillOpacity: number;
  stroke: Paint;
  strokeWidth: number; // device units (scaled by |transform x-scale|)
  strokeOpacity: number;
  opacity: number;
  kind: 'path' | 'circle' | 'rect';
  circle?: { cx: number; cy: number; r: number }; // device space
}

interface Inherited {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  opacity: number;
  transform: Mat;
}

const DEFAULT_INHERITED: Inherited = {
  fill: '#000000',
  fillOpacity: 1,
  stroke: 'none',
  strokeWidth: 1,
  strokeOpacity: 1,
  opacity: 1,
  transform: IDENTITY,
};

function collectGradients(node: XmlNode, into: Map<string, Gradient>): void {
  if (node.tag === 'linearGradient') {
    const id = node.attrs.id;
    if (id) {
      const stops = node.children
        .filter((c) => c.tag === 'stop')
        .map((c) => {
          const rawOffset = (c.attrs.offset ?? '0').trim();
          const offset = rawOffset.endsWith('%') ? parseFloat(rawOffset) / 100 : parseFloat(rawOffset);
          const color = parseColor(c.attrs['stop-color'] ?? '#000000');
          const stopOpacity = c.attrs['stop-opacity'] !== undefined ? parseFloat(c.attrs['stop-opacity']) : 1;
          return { offset, color: [color[0], color[1], color[2], color[3] * stopOpacity] as Rgba };
        })
        .sort((a, b) => a.offset - b.offset);
      into.set(id, {
        x1: parseFloat(node.attrs.x1 ?? '0'),
        y1: parseFloat(node.attrs.y1 ?? '0'),
        x2: parseFloat(node.attrs.x2 ?? '1'),
        y2: parseFloat(node.attrs.y2 ?? '0'),
        userSpace: node.attrs.gradientUnits === 'userSpaceOnUse',
        stops,
      });
    }
  }
  for (const child of node.children) collectGradients(child, into);
}

function resolvePaint(raw: string, gradients: Map<string, Gradient>): Paint {
  const s = raw.trim();
  if (s === 'none') return { kind: 'none' };
  const url = /^url\(#([^)]+)\)$/.exec(s);
  if (url) {
    const gradient = gradients.get(url[1]);
    if (!gradient) throw new Error(`svgRaster: gradient "${url[1]}" referenced but not defined in this svg`);
    return { kind: 'gradient', gradient };
  }
  if (s.startsWith('url(')) throw new Error(`svgRaster: unsupported paint "${raw}"`);
  return { kind: 'solid', color: parseColor(s) };
}

function numberAttr(node: XmlNode, name: string, fallback: number): number {
  const v = node.attrs[name];
  if (v === undefined) return fallback;
  const parsed = parseFloat(v);
  if (!Number.isFinite(parsed)) throw new Error(`svgRaster: bad ${name}="${v}"`);
  return parsed;
}

function compile(
  node: XmlNode,
  inherited: Inherited,
  gradients: Map<string, Gradient>,
  shapes: Shape[],
): void {
  if (node.tag === 'defs' || node.tag === 'filter' || node.tag === 'linearGradient' || node.tag === 'stop') return;
  if (node.tag === 'text') return; // plates render badge-free; decal text is per-instance (see header)

  const state: Inherited = {
    fill: node.attrs.fill ?? inherited.fill,
    fillOpacity: node.attrs['fill-opacity'] !== undefined ? parseFloat(node.attrs['fill-opacity']) : inherited.fillOpacity,
    stroke: node.attrs.stroke ?? inherited.stroke,
    strokeWidth: node.attrs['stroke-width'] !== undefined ? parseFloat(node.attrs['stroke-width']) : inherited.strokeWidth,
    strokeOpacity: node.attrs['stroke-opacity'] !== undefined ? parseFloat(node.attrs['stroke-opacity']) : inherited.strokeOpacity,
    opacity: inherited.opacity * (node.attrs.opacity !== undefined ? parseFloat(node.attrs.opacity) : 1),
    transform: parseTransform(node.attrs.transform, inherited.transform),
  };
  const fillRule = node.attrs['fill-rule'];
  if (fillRule !== undefined && fillRule !== 'nonzero') {
    throw new Error(`svgRaster: unsupported fill-rule "${fillRule}"`);
  }

  const mat = state.transform;
  const inv = invert(mat);
  const xScale = Math.hypot(mat[0], mat[1]) || 1;

  const finish = (localSubpaths: Subpath[], localBbox: Shape['localBbox'], kind: Shape['kind'], circle?: Shape['circle']) => {
    const subpaths = localSubpaths.map((sp) => ({
      closed: sp.closed,
      pts: sp.pts.map((p) => {
        const [x, y] = apply(mat, p.x, p.y);
        return { x: q(x), y: q(y) };
      }),
    }));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const sp of subpaths) {
      for (const p of sp.pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    shapes.push({
      subpaths,
      bbox: { minX, minY, maxX, maxY },
      localBbox,
      inverse: inv,
      fill: resolvePaint(state.fill, gradients),
      fillOpacity: state.fillOpacity,
      stroke: resolvePaint(state.stroke, gradients),
      strokeWidth: state.strokeWidth * xScale,
      strokeOpacity: state.strokeOpacity,
      opacity: state.opacity,
      kind,
      circle: circle
        ? (() => {
            const [cx, cy] = apply(mat, circle.cx, circle.cy);
            return { cx: q(cx), cy: q(cy), r: circle.r * xScale };
          })()
        : undefined,
    });
  };

  switch (node.tag) {
    case 'svg':
    case 'g':
      for (const child of node.children) compile(child, state, gradients, shapes);
      return;
    case 'path': {
      const local = flattenPath(node.attrs.d ?? '');
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const sp of local) {
        for (const p of sp.pts) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      finish(local, { minX, minY, maxX, maxY }, 'path');
      return;
    }
    case 'circle': {
      const cx = numberAttr(node, 'cx', 0);
      const cy = numberAttr(node, 'cy', 0);
      const r = numberAttr(node, 'r', 0);
      finish([], { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r }, 'circle', { cx, cy, r });
      return;
    }
    case 'rect': {
      const x = numberAttr(node, 'x', 0);
      const y = numberAttr(node, 'y', 0);
      const w = numberAttr(node, 'width', 0);
      const h = numberAttr(node, 'height', 0);
      const pts = [
        { x: q(x), y: q(y) },
        { x: q(x + w), y: q(y) },
        { x: q(x + w), y: q(y + h) },
        { x: q(x), y: q(y + h) },
        { x: q(x), y: q(y) },
      ];
      finish([{ pts, closed: true }], { minX: x, minY: y, maxX: x + w, maxY: y + h }, 'rect');
      return;
    }
    default:
      throw new Error(`svgRaster: unsupported element <${node.tag}> in render position`);
  }
}

/* ------------------------------------------------------------------ */
/* Sampling                                                            */
/* ------------------------------------------------------------------ */

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * A shape's flattened segments with spatial indices, built once per
 * plate: fill ray-casts only test edges whose y-span touches the
 * sample's row bucket; stroke distance tests only test segments whose
 * cells neighbor the sample. Without the indices the flattened curves
 * (hundreds of segments per silhouette) would make the generator
 * quadratic in exactly the wrong place.
 */
interface PreparedShape {
  shape: Shape;
  fillEdges: Seg[];
  rowBuckets: Map<number, number[]>; // row index (8-unit rows) -> fillEdges indices
  strokeSegs: Seg[];
  strokeGrid: Map<string, number[]>; // "cx,cy" (8-unit cells) -> strokeSegs indices
}

const BUCKET = 8;

function prepareShape(shape: Shape): PreparedShape {
  const fillEdges: Seg[] = [];
  const strokeSegs: Seg[] = [];
  for (const sp of shape.subpaths) {
    const pts = sp.pts;
    const n = pts.length;
    for (let i = 0; i + 1 < n; i++) {
      const seg = { ax: pts[i].x, ay: pts[i].y, bx: pts[i + 1].x, by: pts[i + 1].y };
      strokeSegs.push(seg);
      fillEdges.push(seg);
    }
    // Fills implicitly close every subpath: add the wrap segment when
    // the endpoints differ (an explicit Z already appended it, and a
    // zero-length wrap is harmless to both tests).
    if (n > 1 && (pts[0].x !== pts[n - 1].x || pts[0].y !== pts[n - 1].y)) {
      fillEdges.push({ ax: pts[n - 1].x, ay: pts[n - 1].y, bx: pts[0].x, by: pts[0].y });
    }
  }
  const rowBuckets = new Map<number, number[]>();
  fillEdges.forEach((seg, idx) => {
    const r0 = Math.floor(Math.min(seg.ay, seg.by) / BUCKET);
    const r1 = Math.floor(Math.max(seg.ay, seg.by) / BUCKET);
    for (let r = r0; r <= r1; r++) {
      const list = rowBuckets.get(r);
      if (list) list.push(idx);
      else rowBuckets.set(r, [idx]);
    }
  });
  const strokeGrid = new Map<string, number[]>();
  const reach = shape.strokeWidth / 2 + 1;
  strokeSegs.forEach((seg, idx) => {
    const cx0 = Math.floor((Math.min(seg.ax, seg.bx) - reach) / BUCKET);
    const cx1 = Math.floor((Math.max(seg.ax, seg.bx) + reach) / BUCKET);
    const cy0 = Math.floor((Math.min(seg.ay, seg.by) - reach) / BUCKET);
    const cy1 = Math.floor((Math.max(seg.ay, seg.by) + reach) / BUCKET);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = `${cx},${cy}`;
        const list = strokeGrid.get(key);
        if (list) list.push(idx);
        else strokeGrid.set(key, [idx]);
      }
    }
  });
  return { shape, fillEdges, rowBuckets, strokeSegs, strokeGrid };
}

function windingInside(prep: PreparedShape, x: number, y: number): boolean {
  const candidates = prep.rowBuckets.get(Math.floor(y / BUCKET));
  if (!candidates) return false;
  let winding = 0;
  for (const idx of candidates) {
    const a = prep.fillEdges[idx];
    if (a.ay <= y) {
      if (a.by > y && (a.bx - a.ax) * (y - a.ay) - (x - a.ax) * (a.by - a.ay) > 0) winding++;
    } else if (a.by <= y && (a.bx - a.ax) * (y - a.ay) - (x - a.ax) * (a.by - a.ay) < 0) {
      winding--;
    }
  }
  return winding !== 0;
}

function strokeDistance(prep: PreparedShape, x: number, y: number): number {
  const candidates = prep.strokeGrid.get(`${Math.floor(x / BUCKET)},${Math.floor(y / BUCKET)}`);
  if (!candidates) return Infinity;
  let best = Infinity;
  for (const idx of candidates) {
    const s = prep.strokeSegs[idx];
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((x - s.ax) * dx + (y - s.ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = s.ax + t * dx - x;
    const py = s.ay + t * dy - y;
    const d2 = px * px + py * py;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

function samplePaint(paint: Paint, shape: Shape, deviceX: number, deviceY: number): Rgba | null {
  if (paint.kind === 'none') return null;
  if (paint.kind === 'solid') return paint.color;
  const g = paint.gradient;
  let gx: number;
  let gy: number;
  if (g.userSpace) {
    const [lx, ly] = apply(shape.inverse, deviceX, deviceY);
    gx = lx;
    gy = ly;
  } else {
    const [lx, ly] = apply(shape.inverse, deviceX, deviceY);
    const w = shape.localBbox.maxX - shape.localBbox.minX || 1;
    const h = shape.localBbox.maxY - shape.localBbox.minY || 1;
    gx = (lx - shape.localBbox.minX) / w;
    gy = (ly - shape.localBbox.minY) / h;
  }
  const dx = g.x2 - g.x1;
  const dy = g.y2 - g.y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((gx - g.x1) * dx + (gy - g.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const stops = g.stops;
  if (stops.length === 0) return null;
  if (t <= stops[0].offset) return stops[0].color;
  if (t >= stops[stops.length - 1].offset) return stops[stops.length - 1].color;
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.offset && t <= b.offset) {
      const f = b.offset === a.offset ? 0 : (t - a.offset) / (b.offset - a.offset);
      return [
        a.color[0] + (b.color[0] - a.color[0]) * f,
        a.color[1] + (b.color[1] - a.color[1]) * f,
        a.color[2] + (b.color[2] - a.color[2]) * f,
        a.color[3] + (b.color[3] - a.color[3]) * f,
      ];
    }
  }
  return stops[stops.length - 1].color;
}

/** Coverage test for one sample point against one pass of one shape. */
function isCovered(shape: Shape, prep: PreparedShape | null, isFill: boolean, px: number, py: number): boolean {
  if (shape.kind === 'circle' && shape.circle) {
    const d = Math.hypot(px - shape.circle.cx, py - shape.circle.cy);
    return isFill ? d <= shape.circle.r : Math.abs(d - shape.circle.r) <= shape.strokeWidth / 2;
  }
  if (prep === null) return false;
  return isFill ? windingInside(prep, px, py) : strokeDistance(prep, px, py) <= shape.strokeWidth / 2;
}

/**
 * Rasterize one `<svg>` document (the markup an illustration component
 * emits) at its native viewBox size.
 *
 * Compositing is per-subpixel and in document order — shapes iterate
 * outermost, exactly like the SVG painters model: each shape composites
 * source-over into a premultiplied float buffer at 2x resolution, and
 * the buffer is box-averaged down to native size with premultiplied
 * averaging (the same canonical downscale as W4's boxDownscaleHalf),
 * quantized once at the end.
 */
export function rasterizeSvg(svgMarkup: string): RgbaImage {
  const root = parseXml(svgMarkup);
  if (root.tag !== 'svg') throw new Error(`svgRaster: expected <svg> root, got <${root.tag}>`);
  const vb = (root.attrs.viewBox ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v))) {
    throw new Error(`svgRaster: bad viewBox "${root.attrs.viewBox}"`);
  }
  const [vbX, vbY, vbW, vbH] = vb;
  const width = Math.round(vbW);
  const height = Math.round(vbH);
  const gradients = new Map<string, Gradient>();
  collectGradients(root, gradients);
  const shapes: Shape[] = [];
  // Root transform maps viewBox space to device pixels (1 unit = 1 px).
  const rootState: Inherited = { ...DEFAULT_INHERITED, transform: [1, 0, 0, 1, -vbX, -vbY] };
  for (const child of root.children) compile(child, rootState, gradients, shapes);

  const SS = 2;
  const sw = width * SS;
  const sh = height * SS;
  const buf = new Float32Array(sw * sh * 4); // premultiplied rgb + alpha, 0..1
  for (const rawShape of shapes) {
    const shape = rawShape;
    const prep = shape.kind === 'circle' ? null : prepareShape(shape);
    const margin = shape.stroke.kind !== 'none' ? shape.strokeWidth / 2 + 1 : 1;
    const bb =
      shape.kind === 'circle' && shape.circle
        ? {
            minX: shape.circle.cx - shape.circle.r,
            minY: shape.circle.cy - shape.circle.r,
            maxX: shape.circle.cx + shape.circle.r,
            maxY: shape.circle.cy + shape.circle.r,
          }
        : shape.bbox;
    const sx0 = Math.max(0, Math.floor((bb.minX - margin) * SS));
    const sx1 = Math.min(sw - 1, Math.ceil((bb.maxX + margin) * SS));
    const sy0 = Math.max(0, Math.floor((bb.minY - margin) * SS));
    const sy1 = Math.min(sh - 1, Math.ceil((bb.maxY + margin) * SS));
    if (sx1 < sx0 || sy1 < sy0) continue;
    for (let sy = sy0; sy <= sy1; sy++) {
      const py = (sy + 0.5) / SS;
      for (let sx = sx0; sx <= sx1; sx++) {
        const px = (sx + 0.5) / SS;
        // Fill pass, then stroke pass (SVG paints the stroke over the fill).
        for (const pass of ['fill', 'stroke'] as const) {
          const isFill = pass === 'fill';
          const paint = isFill ? shape.fill : shape.stroke;
          if (paint.kind === 'none') continue;
          if (!isCovered(shape, prep, isFill, px, py)) continue;
          const color = samplePaint(paint, shape, px, py);
          if (!color) continue;
          const a = color[3] * shape.opacity * (isFill ? shape.fillOpacity : shape.strokeOpacity);
          if (a <= 0) continue;
          const o = (sy * sw + sx) * 4;
          const keep = 1 - a;
          buf[o] = color[0] * a + buf[o] * keep;
          buf[o + 1] = color[1] * a + buf[o + 1] * keep;
          buf[o + 2] = color[2] * a + buf[o + 2] * keep;
          buf[o + 3] = a + buf[o + 3] * keep;
        }
      }
    }
  }

  // Box-average the SS x SS subpixels with premultiplied averaging.
  const data = new Uint8Array(width * height * 4);
  const samples = SS * SS;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = ((y * SS + dy) * sw + (x * SS + dx)) * 4;
          rSum += buf[o];
          gSum += buf[o + 1];
          bSum += buf[o + 2];
          aSum += buf[o + 3];
        }
      }
      const o = (y * width + x) * 4;
      if (aSum > 0) {
        data[o] = Math.round((rSum / aSum) * 255);
        data[o + 1] = Math.round((gSum / aSum) * 255);
        data[o + 2] = Math.round((bSum / aSum) * 255);
        data[o + 3] = Math.round((aSum / samples) * 255);
      }
    }
  }
  return { width, height, data };
}
