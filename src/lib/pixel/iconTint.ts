// ── Hue-rotation re-tint for the drop-rise painted masters (INT-9) ─────────
// The Wave 13 tint lab's luminance re-tint keeps a master's shading but
// REPLACES its hue with one flat tint (luminance × tint + white clip).
// The drop-rise system needs something stronger: every material/essence
// drop carries its OWN hue (per-material asset colors), and the painted
// masters ship grayscale. Rotating the master's (zero) hue onto the
// drop's hue is degenerate — a grayscale has no hue to rotate — so the
// re-tint rebuilds the color from the master's LUMINANCE ramp painted
// through the drop-rise palette the texel grids used: each pixel's
// luminance picks its stop on the SAME five-stop ramp dropRisePalette
// builds from the drop's base color (K ink → D dark → B base → L light →
// W glint), interpolated in HSL with the ramp's own hue drift (hueLerp).
// The master's form — every facet and highlight — survives because the
// mapping is monotone in luminance; the drop's hue identity is exact
// because every output color is a ramp color of its base.

import { dropRisePalette } from '@/lib/pixel/dropRiseIcons';

/** The five ramp stops, dark → light, as [luminanceThreshold, hex]. */
const RAMP_ORDER = ['K', 'D', 'B', 'L', 'W'] as const;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
      : max === gn
        ? ((bn - rn) / d + 2) / 6
        : ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [Math.round(conv(h + 1 / 3) * 255), Math.round(conv(h) * 255), Math.round(conv(h - 1 / 3) * 255)];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpHue(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  const h = a + d * t;
  return h < 0 ? h + 1 : h > 1 ? h - 1 : h;
}

interface RampStop {
  lum: number;
  h: number;
  s: number;
  l: number;
}

/** Build the luminance→color ramp for one base color from the drop-rise
 *  palette itself: each stop's position is the palette color's own
 *  luminance, so the master's luminance lands on the same ramp the texel
 *  grids shaded with. */
export function dropRiseTintRamp(base: string): RampStop[] {
  const palette = dropRisePalette(base);
  const stops = RAMP_ORDER.map((key) => {
    const [r, g, b] = hexToRgb(palette[key].color);
    const [h, s, l] = rgbToHsl(r, g, b);
    return { lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, h, s, l };
  });
  stops.sort((a, b) => a.lum - b.lum);
  return stops;
}

/** Map one luminance (0..1) through the ramp → [r, g, b]. Monotone in
 *  luminance by construction (stops sorted, HSL l interpolated). */
export function rampColorAt(ramp: RampStop[], lum: number): [number, number, number] {
  if (lum <= ramp[0].lum) {
    const s = ramp[0];
    return hslToRgb(s.h, s.s, s.l);
  }
  const last = ramp[ramp.length - 1];
  if (lum >= last.lum) return hslToRgb(last.h, last.s, last.l);
  for (let i = 1; i < ramp.length; i++) {
    if (lum <= ramp[i].lum) {
      const a = ramp[i - 1];
      const b = ramp[i];
      const t = b.lum === a.lum ? 0 : (lum - a.lum) / (b.lum - a.lum);
      return hslToRgb(lerpHue(a.h, b.h, t), lerp(a.s, b.s, t), lerp(a.l, b.l, t));
    }
  }
  return hslToRgb(last.h, last.s, last.l);
}

const tintCache = new Map<string, HTMLCanvasElement>();

/**
 * Draw a grayscale master into a canvas re-tinted to `base`'s hue ramp.
 * Results are cached per (src, base) — a rise re-renders every frame of
 * its animation otherwise. Returns null where canvas/Image are
 * unavailable (SSR/tests without image decode) so callers can fall back
 * to the raw master.
 */
export function tintedDropRiseCanvas(src: string, base: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cacheKey = `${src}|${base}`;
  const hit = tintCache.get(cacheKey);
  if (hit) return hit;
  const img = new Image();
  img.src = src;
  if (!img.complete || img.naturalWidth === 0) {
    // Not decoded yet: draw once it lands, then cache. Callers render the
    // raw grayscale master meanwhile (one frame at most in practice —
    // Vite inlines these masters as data URIs, so decode is synchronous).
    img.onload = () => {
      tintCache.delete(cacheKey);
      tintedDropRiseCanvas(src, base);
    };
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  const ramp = dropRiseTintRamp(base);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    const [r, g, b] = rampColorAt(ramp, lum);
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  }
  ctx.putImageData(data, 0, 0);
  tintCache.set(cacheKey, canvas);
  return canvas;
}
