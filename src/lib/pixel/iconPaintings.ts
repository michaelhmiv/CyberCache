// ── Painted functional icon masters (INT-10, Top-Choice Wave 13 tranche 2) ──
// The 76 everyday functional glyphs join the INT-9 big slots: the owner
// saw the side-by-side exhibits and picked the paintings for these too
// (REBUILD ruling, 2026-11-11). Paintings ship as standalone assets
// (INT-9 precedent — the sprite manifest is untouched), produced by
// scripts/build-icon-masters.py (functional section):
//   - FIXED glyphs (census §7): every appearance resolves to one
//     effective look, so the painting ships as-is (fn-<glyph>.png).
//   - VARIANT glyphs (census §6): state rides tint at the call sites, so
//     one asset per deliberate color was BAKED at build time by luminance
//     re-tint — the painting's luminance through the five-stop ramp
//     dropRisePalette builds from the state color (the drop-rise
//     discipline, iconTint.ts). fn-<glyph>--<hex>.png. There is NO
//     runtime tinting of paintings: <PxIcon> only SELECTS the baked
//     file for the color the site already resolves.
//   - The market stop-rail glyphs (badge/basket/vendor) are census-FIXED
//     under the INT-9 nav pattern: their two rail states bake as a
//     variant pair alongside the base painting.
//   - Element badges (dot/flame/bolt/drop/snow/ringDot at the badge's
//     #171008 stencil) have no paintings here and stay PxIcon stencils
//     permanently (owner ruling). Glyphs with no call sites (blob, boot,
//     gift, power) are not built — their paintings stay sheet-complete
//     in the wave folders.
// The color sets in iconPaintingsData.ts are GENERATED from the
// tranche-2 state census (NOTES §6) — the census is the contract.

import { FN_FIXED_GLYPHS, FN_RAIL_COLORS, FN_VARIANT_COLORS } from './iconPaintingsData';

const modules = import.meta.glob<string>('@/assets/icons/fn-*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** filename stem → asset URL, e.g. 'fn-rings' / 'fn-rings--ffea3a'. */
const ASSETS: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const stem = path.split('/').pop()!.replace(/\.png$/, '');
  ASSETS[stem] = url;
}

const FIXED = new Set<string>(FN_FIXED_GLYPHS);
const RAIL = new Set<string>(Object.keys(FN_RAIL_COLORS));

/** Glyphs whose base painting <PxIcon> renders in place of the stencil. */
export function hasPainting(name: string): boolean {
  return FIXED.has(name) || RAIL.has(name) || name in FN_VARIANT_COLORS;
}

/** The deliberate baked colors for a glyph (rail pair ∪ variant set). */
export function bakedColorsFor(name: string): readonly string[] {
  return FN_VARIANT_COLORS[name] ?? FN_RAIL_COLORS[name] ?? [];
}

/** Normalize a CSS color to '#RRGGBB' uppercase, or null when it is not
 *  a plain hex/rgb color we can match against the baked sets. */
export function normalizeIconColor(color: string | undefined | null): string | null {
  if (!color) return null;
  const c = color.trim();
  const hex = c.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) return `#${hex[1].toUpperCase()}`;
  const short = c.match(/^#([0-9a-fA-F]{3})$/);
  if (short) return `#${short[1].split('').map((ch) => ch + ch).join('').toUpperCase()}`;
  const rgb = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  return null;
}

/** Tailwind/theme class tokens → the deliberate hex they resolve to
 *  (theme tokens from src/index.css + the census's named literals).
 *  text-primary is the ambient body color — deliberately absent: ambient
 *  sites take the base painting, which IS the new ambient look. */
const CLASS_COLORS: Record<string, string> = {
  'text-amber': '#FF9000',
  'text-red': '#FF4B5C',
  'text-green': '#7CFC00',
  'text-blue': '#3B82F6',
  'text-purple': '#A855F7',
  'text-cyan': '#F7D20B',
  'text-text-muted': '#8A847C',
  'text-muted': '#8A847C',
  'text-text-secondary': '#B8B0A8',
  'text-secondary': '#B8B0A8',
  'text-bg': '#050608',
  'text-fuchsia-400': '#E879F9',
  'text-pink-300': '#F9A8D4',
};

/** Resolve the deliberate color a <PxIcon> site carries, from its
 *  className tokens (incl. arbitrary text-[#hex] and /opacity forms). */
export function colorFromClassName(className: string | undefined): string | null {
  if (!className) return null;
  for (const token of className.split(/\s+/)) {
    const base = token.split('/')[0];
    const arbitrary = base.match(/^text-\[(#[0-9a-fA-F]{6})\]$/);
    if (arbitrary) return normalizeIconColor(arbitrary[1]);
    if (CLASS_COLORS[base]) return CLASS_COLORS[base];
  }
  return null;
}

/**
 * Select the shipped painting for a glyph + the site's resolved color:
 * the baked variant when the color is in the glyph's deliberate set,
 * otherwise the base painting. Returns null for glyphs with no painting
 * (stencil residue: element badges, wallet sheet, nav names, orders…).
 */
export function paintedIconFor(name: string, color?: string | null): string | null {
  if (!hasPainting(name)) return null;
  const hex = normalizeIconColor(color);
  if (hex && bakedColorsFor(name).some((c) => c.toUpperCase() === hex)) {
    return ASSETS[`fn-${name}--${hex.slice(1).toLowerCase()}`] ?? ASSETS[`fn-${name}`] ?? null;
  }
  return ASSETS[`fn-${name}`] ?? null;
}
