/**
 * Pixel icon registry integrity.
 *
 * The first 52 entries of PX_ICONS are the redesign v2 icon sheet verbatim
 * (redesign-2026-11/mocks/icons-v2.js; redesign-00-global-language-v2.pdf
 * pp.4–5). Everything after the ADDITIONS marker in src/lib/pixel/icons.ts
 * was drawn in the same 16x16 duotone discipline for shipped glyphs the
 * sheet had no counterpart for. These tests pin the sheet's shape so the
 * registry can't silently lose an icon, gain an out-of-grid rect, or drift
 * off the v2 size ramp.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { PX_ICONS, PX_ICON_NAMES, PX_ICON_SIZES, PX_ICON_TONE_FILLS } from '@/lib/pixel/icons';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { hasPainting } from '@/lib/pixel/iconPaintings';

/** The 52 icons of the redesign v2 sheet, verbatim. */
const V2_SHEET = [
  'anvil', 'armor', 'badge', 'basket', 'blob', 'bolt', 'book', 'burst',
  'check', 'chevD', 'chevR', 'chevs', 'cog', 'coin', 'core', 'crate',
  'cross', 'crosshair', 'drop', 'flame', 'flask', 'frag', 'gem', 'gift',
  'grid', 'gun', 'hammer', 'heart', 'home', 'infinity', 'key', 'lock',
  'loot', 'nodes', 'orders', 'pack', 'person', 'pick', 'pin', 'scrap',
  'shelf', 'shield', 'signal', 'skull', 'snow', 'star', 'tag', 'trophy',
  'vendor', 'vial', 'wheel', 'wrench',
] as const;

/** Additions drawn for this purge, in the same discipline. */
const ADDITIONS = [
  'barEmpty', 'barFill', 'boot', 'bullseye', 'calendar', 'chart', 'chevL', 'chevU',
  'chip', 'clock', 'crown', 'diamond', 'diamondFill', 'diamondIn', 'dot',
  'flag', 'halfDisc', 'hatch', 'hatchH', 'help', 'hex', 'info', 'pause', 'pawn', 'pencil',
  'plus', 'power', 'recycle', 'ring', 'ringDot', 'rings', 'search', 'star5',
  'stop', 'swap', 'swirl', 'target', 'triR', 'truck', 'warn', 'waves', 'x',
] as const;

describe('pixel icon registry', () => {
  it('carries the full v2 sheet plus the documented additions', () => {
    expect(V2_SHEET).toHaveLength(52);
    for (const name of V2_SHEET) {
      expect(PX_ICONS[name], `v2 icon '${name}' missing`).toBeDefined();
    }
    for (const name of ADDITIONS) {
      expect(PX_ICONS[name], `addition '${name}' missing`).toBeDefined();
    }
    expect(PX_ICON_NAMES).toHaveLength(V2_SHEET.length + ADDITIONS.length);
  });

  it('every icon is a non-empty set of rects inside the 16x16 grid', () => {
    for (const name of PX_ICON_NAMES) {
      const rects = PX_ICONS[name];
      expect(rects.length, `${name} has no rects`).toBeGreaterThan(0);
      for (const r of rects) {
        const [x, y, w, h, tone] = r;
        expect(x, `${name} rect x`).toBeGreaterThanOrEqual(0);
        expect(y, `${name} rect y`).toBeGreaterThanOrEqual(0);
        expect(w, `${name} rect w`).toBeGreaterThanOrEqual(1);
        expect(h, `${name} rect h`).toBeGreaterThanOrEqual(1);
        expect(x + w, `${name} rect overflows right edge`).toBeLessThanOrEqual(16);
        expect(y + h, `${name} rect overflows bottom edge`).toBeLessThanOrEqual(16);
        if (tone !== undefined) {
          expect(PX_ICON_TONE_FILLS[tone], `${name} uses unknown tone '${tone}'`).toBeDefined();
        }
      }
    }
  });

  it('the size ramp is the v2 token ramp', () => {
    expect([...PX_ICON_SIZES]).toEqual([13, 17, 26, 40]);
  });
});

describe('<PxIcon>', () => {
  // INT-10 (owner REBUILD ruling, 2026-11-11): painted glyphs render
  // their shipped painting as an <img> at the token size; the stencil
  // residue (element badges, wallet sheet, glyphs without a painting)
  // keeps the crisp SVG rect rendering. Both paths are pinned here.
  it('renders every registered icon at the default token size (painting or crisp SVG)', () => {
    for (const name of PX_ICON_NAMES) {
      const { container, unmount } = render(<PxIcon name={name} />);
      if (hasPainting(name)) {
        const img = container.querySelector('img');
        expect(img, `${name} did not render its painting`).not.toBeNull();
        expect(img?.getAttribute('width')).toBe('17');
        expect(img?.getAttribute('height')).toBe('17');
        expect(img?.getAttribute('src')).toContain(`fn-${name}`);
      } else {
        const svg = container.querySelector('svg');
        expect(svg, `${name} did not render an svg`).not.toBeNull();
        expect(svg?.getAttribute('width')).toBe('17');
        expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
        expect(svg?.getAttribute('shape-rendering') ?? svg?.getAttribute('shapeRendering')).toBe('crispEdges');
        expect(container.querySelectorAll('rect')).toHaveLength(PX_ICONS[name].length);
      }
      unmount();
    }
  });

  it('a painted variant glyph selects the baked variant for its resolved color', () => {
    const { container } = render(<PxIcon name="armor" color="#A855F7" />);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('fn-armor--a855f7');
    const { container: plain } = render(<PxIcon name="armor" />);
    expect(plain.querySelector('img')?.getAttribute('src')).toContain('fn-armor.png');
  });

  it('is aria-hidden unless titled, and mass rects take currentColor', () => {
    const { container } = render(<PxIcon name="flame" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    const mass = [...container.querySelectorAll('rect')].find((r) => r.getAttribute('fill') === 'currentColor');
    expect(mass, 'flame should have currentColor mass rects').toBeDefined();

    const { container: titled } = render(<PxIcon name="flame" title="Login streak" size={40} />);
    const svg2 = titled.querySelector('svg');
    expect(svg2?.getAttribute('aria-hidden')).not.toBe('true');
    expect(svg2?.getAttribute('aria-label')).toBe('Login streak');
    expect(svg2?.getAttribute('width')).toBe('40');
  });
});
