/**
 * Pxl craft sweep S1 — the trained ramp root + selective outline.
 *
 * Pins the three S1 contracts:
 *  1. Palette law: BASE tones are the game's exact hexes everywhere
 *     (fiveToneRamp base, gear colorway P, card D/P/p, the pixel
 *     path's whole color map) — only DERIVED steps move.
 *  2. Derived steps move in HUE, pxl-style: darker steps rotate
 *     toward blue-violet (250°), lighter steps toward warm yellow
 *     (55°), at the straight lerp's own lightness. Achromatic bases
 *     have no hue to rotate and stay on the straight lerp.
 *  3. The weapon outlines are selective now: the silhouette ring
 *     takes the bordered form's darker shades on lit faces instead
 *     of one uniform ink frame (master's ring on the census render
 *     was {K: 392, k: 82} and nothing else).
 * Plus the condition contract that survived the dead-lift deletion:
 * wear and godroll sparkles live, mint is a no-op grade.
 */
import { describe, expect, it } from 'vitest';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import { hexLerp, hueLerp, composeWeaponCard, CARD_SELOUT_DARKER } from '@/lib/pixel/weaponCardCompositor';
import { composePixelWeapon, PIXEL_SELOUT_DARKER, type PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { fiveToneRamp, gearColorsFor, type GearComposeInput } from '@/lib/pixel/gearCardCompositor';
import { MANUFACTURER_WEAPON_STYLES, RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { getElementVisual } from '@/constants/visualAssets';

/** Hue of a '#RRGGBB' hex, degrees 0..360. */
function hueOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

const angDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const sniper = (over: Partial<PixelWeaponInput> = {}): PixelWeaponInput => ({
  id: 's1-sniper',
  name: 'S1 Sniper',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.BlastForge,
  rarity: Rarity.Legendary,
  element: Element.Shock,
  rollQuality: 50,
  pixelSeed: 4242,
  parts: [],
  affixes: [],
  ...over,
} as PixelWeaponInput);

describe('hueLerp — the trained derivation', () => {
  it('t = 0 is the straight lerp (the base itself)', () => {
    expect(hueLerp('#FF9000', '#000000', 0)).toBe(hexLerp('#FF9000', '#000000', 0));
  });

  it('darker steps rotate toward blue-violet; lighter steps toward warm yellow', () => {
    for (const base of ['#FF9000', '#22C55E', '#3B82F6', '#FF4B1F']) {
      const shadow = hueLerp(base, '#000000', 0.30);
      const highlight = hueLerp(base, '#FFFFFF', 0.36);
      expect(angDist(hueOf(shadow), 250), `${base} shadow`).toBeLessThan(angDist(hueOf(base), 250));
      expect(angDist(hueOf(highlight), 55), `${base} highlight`).toBeLessThan(angDist(hueOf(base), 55));
      // …and the movement is real, not a rounding artifact:
      expect(shadow).not.toBe(hexLerp(base, '#000000', 0.30));
      expect(highlight).not.toBe(hexLerp(base, '#FFFFFF', 0.36));
    }
  });

  it('BlastForge orange: the shadow cools through red, the highlight warms to gold', () => {
    expect(hueLerp('#FF9000', '#000000', 0.30)).toBe('#b35000');
    expect(hueLerp('#FF9000', '#FFFFFF', 0.36)).toBe('#f6cc65');
  });

  it('achromatic bases have no hue to rotate — straight lerp, untouched', () => {
    expect(hueLerp('#808080', '#000000', 0.30)).toBe(hexLerp('#808080', '#000000', 0.30));
    expect(hueLerp('#808080', '#FFFFFF', 0.60)).toBe(hexLerp('#808080', '#FFFFFF', 0.60));
  });
});

describe('palette law — base tones are the game hexes, byte-equal', () => {
  it('fiveToneRamp: base is exact; straight mode reproduces the legacy ramp', () => {
    expect(fiveToneRamp('#FF9000').base).toBe('#FF9000');
    expect(fiveToneRamp('#FF9000', 'straight')).toEqual({
      deep: '#6b3c00',
      dark: '#b36500',
      base: '#FF9000',
      light: '#ffb85c',
      pale: '#ffd9a8',
    });
  });

  it('fiveToneRamp hue mode: same base, hue-moved steps', () => {
    expect(fiveToneRamp('#FF9000')).toEqual({
      deep: '#6b2400',
      dark: '#b35000',
      base: '#FF9000',
      light: '#f6cc65',
      pale: '#f6eab1',
    });
    // Achromatic base: hue mode and straight mode agree exactly.
    expect(fiveToneRamp('#808080')).toEqual(fiveToneRamp('#808080', 'straight'));
  });

  it('gear colorway: P is the element base hex; E is the element hex itself', () => {
    const input: GearComposeInput = { kind: 'shield', rarity: Rarity.Epic, element: Element.Fire, seed: 7, pips: 2 };
    const colors = gearColorsFor(input);
    expect(colors.P).toBe(getElementVisual(Element.Fire).color);
    expect(colors.E).toBe('#FF4B1F');
  });

  it('card path: D / P / p are the manufacturer hexes verbatim', () => {
    const style = MANUFACTURER_WEAPON_STYLES[Manufacturer.BlastForge];
    const colors = composeWeaponCard(sniper()).colors;
    expect(colors.D).toBe(style.dark);
    expect(colors.P).toBe(style.primary);
    expect(colors.p).toBe(style.light);
    expect(colors.G).toBe('#FFEA3A');
  });

  it('pixel path: the whole color map is the master mapping, unchanged', () => {
    const render = composePixelWeapon(sniper());
    const style = MANUFACTURER_WEAPON_STYLES[Manufacturer.BlastForge];
    expect(render.colors).toEqual({
      K: '#0B0B0E',
      D: style.dark,
      P: style.primary,
      L: style.light,
      T: RARITY_FRAME_STYLES[Rarity.Legendary].color,
      G: RARITY_FRAME_STYLES[Rarity.Legendary].color,
      E: getElementVisual(Element.Shock).color,
    });
  });
});

describe('selective outline — the silhouette follows the shading', () => {
  it('the darker maps encode two ramp steps darker, ink as the fallback', () => {
    expect(PIXEL_SELOUT_DARKER.L).toBe('D');
    expect(PIXEL_SELOUT_DARKER.P).toBe('D');
    expect(CARD_SELOUT_DARKER.L).toBe('P');
    expect(CARD_SELOUT_DARKER.p).toBe('d');
    expect(CARD_SELOUT_DARKER.P).toBe('D');
    expect(CARD_SELOUT_DARKER.E).toBe('c');
  });

  it('pixel path: column tops over lit faces take the maker dark, over dark faces ink', () => {
    const render = composePixelWeapon(sniper());
    let darkOverLit = 0;
    let inkOverDark = 0;
    for (let x = 0; x < render.width; x++) {
      for (let y = 0; y < render.height; y++) {
        const c = render.rows[y][x];
        if (c === '.') continue;
        const below = y + 1 < render.height ? render.rows[y + 1][x] : '.';
        if (c === 'D' && (below === 'P' || below === 'L')) darkOverLit++;
        if (c === 'K' && (below === 'D' || below === 'E')) inkOverDark++;
        break;
      }
    }
    expect(darkOverLit).toBeGreaterThan(20);
    expect(inkOverDark).toBeGreaterThan(0);
  });

  it('card path: the outline ring is no longer a single uniform ink', () => {
    const render = composeWeaponCard(sniper({ rarity: Rarity.Common, rollQuality: 85 }));
    const ring = new Map<string, number>();
    for (let y = 0; y < render.height; y++) for (let x = 0; x < render.width; x++) {
      const c = render.rows[y][x];
      if (c === '.') continue;
      const adjEmpty = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx < 0 || ny < 0 || nx >= render.width || ny >= render.height || render.rows[ny][nx] === '.';
      });
      if (adjEmpty) ring.set(c, (ring.get(c) ?? 0) + 1);
    }
    // Master's ring on this render was {K: 392, k: 82} — ink only.
    // Selout puts the form's own darker shades on lit faces:
    expect(ring.get('P') ?? 0).toBeGreaterThan(50); // above the light top edge
    expect(ring.get('d') ?? 0).toBeGreaterThan(10); // above the light maker tone
    expect(ring.get('K') ?? 0).toBeGreaterThan(0); // ink remains on dark faces
    expect(ring.get('K') ?? 0).toBeLessThan(392);
  });
});

describe('condition after the dead-lift deletion', () => {
  it('godroll sparkles still land on both paths; mint adds none', () => {
    const gCount = (rows: string[]) => rows.join('').split('').filter((c) => c === 'G').length;
    const pixelMint = composePixelWeapon(sniper({ rollQuality: 85 }));
    const pixelGod = composePixelWeapon(sniper({ rollQuality: 99 }));
    expect(gCount(pixelGod.rows)).toBeGreaterThan(gCount(pixelMint.rows));
    const cardMint = composeWeaponCard(sniper({ rollQuality: 85 }));
    const cardGod = composeWeaponCard(sniper({ rollQuality: 99 }));
    expect(gCount(cardGod.rows)).toBeGreaterThan(gCount(cardMint.rows));
  });

  it('mint and godroll report their grades; wear still separates beat-up from godroll', () => {
    expect(composePixelWeapon(sniper({ rollQuality: 85 })).condition).toBe('mint');
    expect(composePixelWeapon(sniper({ rollQuality: 99 })).condition).toBe('godroll');
    const beatUp = composePixelWeapon(sniper({ rollQuality: 5 }));
    const godroll = composePixelWeapon(sniper({ rollQuality: 99 }));
    expect(beatUp.signature).not.toBe(godroll.signature);
  });
});
