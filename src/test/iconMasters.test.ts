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

// ── INT-10 functional paintings (tranche-2 census contract) ─────────────
// The everyday glyphs are paintings now. This block pins:
//  - every FIXED/rail/VARIANT glyph's base painting exists at the 64px
//    ship canvas inside the byte band;
//  - every deliberate color in the census sets has its baked variant
//    file (no runtime tinting — the file IS the state);
//  - the census's load-bearing sets match the shipped data exactly
//    (armor's single purple, the loadout rarity/element machinery, the
//    rail pairs) — transcribed here independently from NOTES §6;
//  - baked variants actually carry their state's hue (palette mean);
//  - selection: element-badge glyphs and the wallet sheet have NO
//    painting (stencil residue), and uncalled glyphs were not built.
import { FN_FIXED_GLYPHS, FN_RAIL_COLORS, FN_VARIANT_COLORS } from '@/lib/pixel/iconPaintingsData';
import { bakedColorsFor, colorFromClassName, hasPainting, normalizeIconColor, paintedIconFor } from '@/lib/pixel/iconPaintings';

function paletteMean(file: string): [number, number, number] {
  const buf = readFileSync(resolve(ICONS_DIR, file));
  let off = 8;
  let r = 0, g = 0, b = 0, n = 0;
  while (off < buf.length - 8) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('latin1');
    if (type === 'PLTE') {
      for (let i = 0; i < len; i += 3) { r += buf[off + 8 + i]; g += buf[off + 8 + i + 1]; b += buf[off + 8 + i + 2]; n++; }
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  expect(n, `${file} must be a palette PNG`).toBeGreaterThan(0);
  return [r / n, g / n, b / n];
}

describe('INT-10 painted functional icons', () => {
  it('every painted glyph ships a base painting at 64x64 inside the byte band', () => {
    const glyphs = [...FN_FIXED_GLYPHS, ...Object.keys(FN_RAIL_COLORS), ...Object.keys(FN_VARIANT_COLORS)];
    expect(glyphs.length).toBe(69);
    for (const glyph of glyphs) {
      const info = pngInfo(`fn-${glyph}.png`);
      expect(info.width, glyph).toBe(64);
      expect(info.height, glyph).toBe(64);
      expect(info.bytes, glyph).toBeGreaterThan(300);
      expect(info.bytes, glyph).toBeLessThan(14000);
    }
  });

  it('every deliberate census color has a baked variant file', () => {
    for (const [glyph, colors] of Object.entries({ ...FN_RAIL_COLORS, ...FN_VARIANT_COLORS })) {
      for (const color of colors) {
        const info = pngInfo(`fn-${glyph}--${color.slice(1).toLowerCase()}.png`);
        expect(info.width, `${glyph} ${color}`).toBe(64);
        expect(info.height, `${glyph} ${color}`).toBe(64);
        expect(info.bytes, `${glyph} ${color}`).toBeGreaterThan(200);
        expect(info.bytes, `${glyph} ${color}`).toBeLessThan(14000);
      }
    }
  });

  it('the census sets shipped are the census sets (independent transcription)', () => {
    // Armor's only deliberate tint is boss-vitals purple (NOTES §6 callout).
    expect(FN_VARIANT_COLORS['armor']).toEqual(['#A855F7']);
    // The loadout machinery: rarity 5 ∪ elements 6 ∪ muted, per glyph.
    const loadout = ['#06B6D4', '#22C55E', '#3B82F6', '#5AA7FF', '#7CFC00', '#8A847C', '#8B5CF6', '#9CA3AF', '#A5A7B5', '#EF4444', '#FF9DF5', '#FFEA3A'];
    expect([...FN_VARIANT_COLORS['gem']].sort()).toEqual(loadout);
    expect([...FN_VARIANT_COLORS['diamond']].sort()).toEqual([...loadout, '#00E5FF', '#FF9000'].sort());
    expect([...FN_VARIANT_COLORS['rings']].sort()).toEqual([...loadout, '#FF4B5C', '#FF9000'].sort());
    expect([...FN_VARIANT_COLORS['shield']].sort()).toEqual([...loadout, '#050608', '#B8B0A8', '#FF9000'].sort());
    // Rail pairs: active ink on amber / inactive secondary.
    for (const glyph of ['badge', 'basket', 'vendor']) {
      expect(FN_RAIL_COLORS[glyph]).toEqual(['#050608', '#B8B0A8']);
    }
    // Census shape: 17 fixed + 3 rail + 49 variant glyphs (48 census + star5's accent path).
    expect(FN_FIXED_GLYPHS.length).toBe(17);
    expect(Object.keys(FN_VARIANT_COLORS).length).toBe(49);
  });

  it('baked variants carry their state hue', () => {
    const [pr, pg, pb] = paletteMean('fn-armor--a855f7.png');
    expect(pb).toBeGreaterThan(pr);
    expect(pr).toBeGreaterThan(pg);
    const [rr, rg, rb] = paletteMean('fn-heart--ff4b5c.png');
    expect(rr).toBeGreaterThan(rg);
    expect(rr).toBeGreaterThan(rb);
    const [yr, yg, yb] = paletteMean('fn-rings--ffea3a.png');
    expect(yr).toBeGreaterThan(yb);
    expect(yg).toBeGreaterThan(yb);
  });

  it('selection: paintings resolve, variants select, stencils stay stencil', () => {
    expect(paintedIconFor('check')).toContain('fn-check');
    expect(paintedIconFor('armor', '#A855F7')).toContain('fn-armor--a855f7');
    expect(paintedIconFor('armor')).toContain('fn-armor.png');
    expect(paintedIconFor('badge', '#050608')).toContain('fn-badge--050608');
    // Stencil residue: element badges + wallet + nav names have no painting.
    for (const glyph of ['flame', 'snow', 'bolt', 'drop', 'ringDot', 'dot', 'coin', 'key', 'core', 'loot', 'tag', 'person', 'orders', 'chevs', 'nodes', 'shelf', 'star']) {
      expect(hasPainting(glyph), glyph).toBe(false);
      expect(paintedIconFor(glyph), glyph).toBeNull();
    }
    // Uncalled glyphs were not built (sheet-complete in the wave folders).
    for (const glyph of ['blob', 'boot', 'gift', 'power']) {
      expect(hasPainting(glyph), glyph).toBe(false);
    }
    // PX_ICONS keeps every glyph incl. the badge set (registry untouched).
    for (const glyph of ['flame', 'snow', 'bolt', 'drop', 'ringDot', 'dot', 'check', 'armor', 'rings']) {
      expect(PX_ICONS[glyph as keyof typeof PX_ICONS], glyph).toBeDefined();
    }
  });

  it('color resolution: hex, rgb, theme tokens, arbitrary classes', () => {
    expect(normalizeIconColor('#ff9000')).toBe('#FF9000');
    expect(normalizeIconColor('rgb(255, 144, 0)')).toBe('#FF9000');
    expect(normalizeIconColor('var(--amber)')).toBeNull();
    expect(colorFromClassName('shrink-0 text-amber')).toBe('#FF9000');
    expect(colorFromClassName('text-text-muted/60')).toBe('#8A847C');
    expect(colorFromClassName('text-[#7DD0F0]')).toBe('#7DD0F0');
    expect(bakedColorsFor('crate')).toContain('#7DD0F0');
  });
});
