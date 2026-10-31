/**
 * Runtime palette swaps (visual overhaul brief §4.4) — per-area enemy
 * identity without new source paintings: the archetype's pixels are
 * hue-shifted toward the area's signature hue, saturation-scaled, and
 * the brightest trim pixels blend toward the area accent. The pure
 * remap core is deterministic and unit-tested; the canvas wrapper
 * caches data URLs per (sprite, palette).
 */

export interface PaletteSpec {
  hueShiftDeg: number;
  saturationScale: number;
  /** RGB 0..255 the brightest trim pixels blend toward. */
  accent: [number, number, number];
  accentBlend: number;
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
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const chan = (t: number): number => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return [Math.round(chan(hn + 1 / 3) * 255), Math.round(chan(hn) * 255), Math.round(chan(hn - 1 / 3) * 255)];
}

/** Remap an RGBA pixel buffer in place. Alpha is never touched. */
export function remapPixelData(data: Uint8ClampedArray, palette: PaletteSpec): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    // Grays stay gray (structure reads through value, not hue).
    if (s < 0.04) continue;
    let [r, g, b] = hslToRgb(h + palette.hueShiftDeg, Math.min(1, s * palette.saturationScale), l);
    if (l > 0.8 && palette.accentBlend > 0) {
      r = Math.round(r + (palette.accent[0] - r) * palette.accentBlend);
      g = Math.round(g + (palette.accent[1] - g) * palette.accentBlend);
      b = Math.round(b + (palette.accent[2] - b) * palette.accentBlend);
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

const urlCache = new Map<string, string>();

/**
 * Swap a sprite image's palette and return a cached data URL. Browser
 * only (canvas); returns the original URL while loading is impossible
 * (SSR/tests) — callers treat it as a progressive enhancement.
 */
export function paletteSpriteUrl(spriteId: string, sourceUrl: string, paletteId: string, palette: PaletteSpec): string {
  const key = `${spriteId}:${paletteId}`;
  const cached = urlCache.get(key);
  if (cached) return cached;
  if (typeof document === 'undefined') return sourceUrl;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      remapPixelData(imageData.data, palette);
      ctx.putImageData(imageData, 0, 0);
      urlCache.set(key, canvas.toDataURL('image/png'));
    } catch {
      // Tainted canvas or decode quirk: keep the base art.
      urlCache.set(key, sourceUrl);
    }
  };
  img.src = sourceUrl;
  // First paint uses the base art; the swapped URL lands in cache for
  // the next mount (the stage re-renders on every tick event anyway).
  return urlCache.get(key) ?? sourceUrl;
}

export function paletteCacheSize(): number {
  return urlCache.size;
}
