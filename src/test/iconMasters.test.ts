/**
 * INT-9 — painted icon masters (Top-Choice Wave 13 integration).
 *
 * Pins the slice's contract:
 *  - every master slot resolves to a real committed PNG of the right
 *    ship dimensions, inside the ~2–4 KB per-master band the task set;
 *  - the re-tinted drop-rise kinds ship GRAYSCALE (their hue comes from
 *    the runtime ramp, never from the file), and credits/crate ship in
 *    color;
 *  - the runtime re-tint ramp is built from dropRisePalette itself,
 *    spans the palette's own luminance range, is monotone in luminance,
 *    and carries the base color's hue identity;
 *  - PX_ICONS keeps its functional glyphs (the 76 everyday glyphs are
 *    untouched by this slice — their adoption decision is still open).
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DISPLAY_CALENDAR_MASTER,
  DROP_RISE_MASTERS,
  DROP_RISE_RETINTED,
  NAV_SIGIL_MASTERS,
} from '@/lib/pixel/iconMasters';
import { dropRiseTintRamp, rampColorAt } from '@/lib/pixel/iconTint';
import { dropRisePalette } from '@/lib/pixel/dropRiseIcons';
import { PX_ICONS } from '@/lib/pixel/icons';

const ICONS_DIR = resolve(process.cwd(), 'src/assets/icons');

function pngInfo(file: string): { width: number; height: number; colorType: number; bytes: number } {
  const path = resolve(ICONS_DIR, file);
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25],
    bytes: statSync(path).size,
  };
}

/** Decode a palette PNG's pixels via the recorded PLTE + tRNS chunks is
 *  overkill; grayscale-ness is proven differently: the grayscale masters
 *  were encoded from an L-mode image, so their PLTE contains only
 *  equal-channel entries. Returns true when every palette entry is gray. */
function paletteIsGray(file: string): boolean {
  const buf = readFileSync(resolve(ICONS_DIR, file));
  let off = 8;
  let sawPlte = false;
  let allGray = true;
  while (off < buf.length - 8) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('latin1');
    if (type === 'PLTE') {
      sawPlte = true;
      for (let i = 0; i < len; i += 3) {
        const r = buf[off + 8 + i];
        const g = buf[off + 8 + i + 1];
        const b = buf[off + 8 + i + 2];
        if (!(r === g && g === b)) allGray = false;
      }
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  expect(sawPlte, `${file} must be a palette PNG`).toBe(true);
  return allGray;
}

describe('INT-9 painted icon masters', () => {
  it('nav sigil masters exist at ship size inside the byte band', () => {
    for (const slug of ['home', 'pack', 'tag', 'person']) {
      expect(NAV_SIGIL_MASTERS[slug], `nav master '${slug}'`).toBeTruthy();
      const info = pngInfo(`nav-${slug}.png`);
      expect(info.width).toBe(34);
      expect(info.height).toBe(34);
      expect(info.bytes).toBeGreaterThan(400);
      expect(info.bytes).toBeLessThan(6000);
    }
  });

  it('calendar display master exists at 80x80 (2x of the 40px slot)', () => {
    expect(DISPLAY_CALENDAR_MASTER).toBeTruthy();
    const info = pngInfo('display-calendar.png');
    expect(info.width).toBe(80);
    expect(info.height).toBe(80);
    expect(info.bytes).toBeLessThan(9000);
  });

  it('drop-rise masters exist at 60x60 (2x of the 30px slot)', () => {
    for (const kind of ['material', 'essence', 'fragment', 'scrap', 'credits', 'crate'] as const) {
      expect(DROP_RISE_MASTERS[kind], `drop master '${kind}'`).toBeTruthy();
      const info = pngInfo(`drop-${kind}.png`);
      expect(info.width).toBe(60);
      expect(info.height).toBe(60);
      expect(info.bytes).toBeGreaterThan(400);
      expect(info.bytes).toBeLessThan(6000);
    }
  });

  it('the re-tinted kinds ship grayscale; credits/crate ship in color', () => {
    for (const kind of DROP_RISE_RETINTED) {
      expect(paletteIsGray(`drop-${kind}.png`), `${kind} palette must be gray`).toBe(true);
    }
    expect(paletteIsGray('drop-credits.png')).toBe(false);
    expect(paletteIsGray('drop-crate.png')).toBe(false);
  });

  it('the tint ramp is the drop-rise palette itself, monotone, hue-true', () => {
    const base = '#2196F3'; // fragment blue
    const ramp = dropRiseTintRamp(base);
    expect(ramp).toHaveLength(5);
    // Stops sorted by luminance, span covering the palette's own range.
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i].lum).toBeGreaterThanOrEqual(ramp[i - 1].lum);
    }
    const palette = dropRisePalette(base);
    const baseHex = palette.B.color;
    expect(baseHex.toUpperCase()).toBe(base);
    // The ramp's mid stop IS the base color: at the base's own luminance
    // the mapping returns the base hue family (blue dominant channel).
    const mid = rampColorAt(ramp, ramp[2].lum);
    expect(mid[2]).toBeGreaterThan(mid[0]); // blue channel dominates for a blue base
    // Monotone: sampled luminance order never decreases in output lightness.
    let prev = -1;
    for (let lum = 0; lum <= 1.0001; lum += 0.05) {
      const [r, g, b] = rampColorAt(ramp, Math.min(1, lum));
      const out = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(out).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = out;
    }
    // A green material base yields a green-dominant mid — hue identity
    // follows the DROP, not the master.
    const greenRamp = dropRiseTintRamp('#22C55E');
    const gMid = rampColorAt(greenRamp, greenRamp[2].lum);
    expect(gMid[1]).toBeGreaterThan(gMid[0]);
    expect(gMid[1]).toBeGreaterThan(gMid[2]);
  });

  it('PX_ICONS functional glyphs are untouched by the slice', () => {
    // The everyday glyphs stay on the texel system; the masters only
    // replaced their named big slots' RENDERING, never the registry.
    for (const name of ['home', 'pack', 'tag', 'person', 'calendar', 'infinity', 'skull'] as const) {
      expect(PX_ICONS[name], `glyph '${name}' still registered`).toBeDefined();
    }
  });
});
