import { describe, expect, it } from 'vitest';
import { CONSUMABLES } from '@/constants/consumables';
import {
  CONSUMABLE_ART,
  composeConsumable,
  composeConsumableCached,
  consumableArtRow,
} from '@/lib/pixel/consumableArt';

/**
 * Consumable item art — the contract: every consumable type is a
 * formed-object pixel sprite from one data table (no sheet glyph,
 * no per-surface maps), composed from the def's OWN visual record
 * (silhouette → chassis, accent → contents, icon → face motif,
 * frame → finish) so the art can never drift from the definition.
 * Every type must be individually recognizable: the pairwise
 * distinctness test below is the forcing function — a declared-
 * visual twin (PatchKit/FieldPatchKit, AdrenalineShot/RedlineTonic)
 * must still render as two different objects.
 */

const ALL_IDS = Object.keys(CONSUMABLES);

function filledCount(rows: string[]): number {
  return rows.reduce((n, row) => n + [...row].filter((c) => c !== '.').length, 0);
}

describe('consumableArt — coverage', () => {
  it('has exactly one art row per consumable type', () => {
    expect(Object.keys(CONSUMABLE_ART).sort()).toEqual([...ALL_IDS].sort());
    expect(ALL_IDS).toHaveLength(44);
  });

  it('resolves an art row for every type, chassis from the def silhouette', () => {
    for (const id of ALL_IDS) {
      const row = consumableArtRow(id);
      expect(row, id).toBeDefined();
      expect(row.chassis, id).toBe(CONSUMABLES[id].visual.silhouette);
      expect(row.variant, id).toBeTruthy();
    }
  });
});

describe('consumableArt — recognizability', () => {
  it('renders all 44 types as pairwise-distinct object sprites', () => {
    const seen = new Map<string, string>();
    for (const id of ALL_IDS) {
      const key = composeConsumable(id).rows.join('/');
      expect(seen.has(key), `${id} renders identically to ${seen.get(key)}`).toBe(false);
      seen.set(key, id);
    }
    expect(seen.size).toBe(44);
  });

  it('separates the declared-visual twins by form, not just hue', () => {
    const pairs: Array<[string, string]> = [
      ['PatchKit', 'FieldPatchKit'],
      ['AdrenalineShot', 'RedlineTonic'],
      ['Grenade', 'OrdnanceCharge'],
      ['MedKit', 'MedKitRefined'],
      ['AmmoPack', 'HighCapacityAmmoPack'],
      ['ElementalCoating', 'PrismCoating'],
    ];
    for (const [a, b] of pairs) {
      expect(composeConsumable(a).rows.join('/'), `${a} vs ${b}`).not.toBe(
        composeConsumable(b).rows.join('/'),
      );
    }
  });

  it('S4: the grenade and scanner chassis separate by FORM at thumb density', () => {
    // Pre-S4 both chassis used one variant-blind thumb stamp: every
    // member's rows were identical and only the colorway separated
    // them. Rows are shade letters, so identical rows = identical
    // form — this pin fails if a stamp ever goes variant-blind again.
    const grenades = [
      'Grenade', 'OrdnanceCharge', 'EMPCharge', 'CorrosiveCharge',
      'PhaseShiftGrenade', 'MagnetizedPayload', 'ForgeheartCharge',
    ];
    const scanners = ['TargetPainter', 'BossScanner', 'Jammer', 'SignalScrambler', 'DataSkimmer'];
    for (const set of [grenades, scanners]) {
      const forms = set.map((id) => composeConsumable(id, 'thumb').rows.join('/'));
      expect(new Set(forms).size, set.join(', ')).toBe(set.length);
    }
    // The brief's named confusion pairs, pinned explicitly.
    const thumb = (id: string) => composeConsumable(id, 'thumb').rows.join('/');
    expect(thumb('EMPCharge')).not.toBe(thumb('MagnetizedPayload'));
    expect(thumb('FieldPatchKit')).not.toBe(thumb('MasterPatchKit'));
    expect(thumb('HelixCalibrationKit')).not.toBe(thumb('WorkshopRushTicket'));
  });

  it('S4: the named weak icons carry their identity marks at thumb density', () => {
    // PatchKit's cross rides white-hot at the core so it survives
    // the rust body at 12×12; PrismCoating keeps all three fleck
    // shades (X/Y/Z) on the pot's face at thumb.
    const patch = composeConsumable('PatchKit', 'thumb').rows.join('');
    expect(patch).toContain('W');
    const prism = composeConsumable('PrismCoating', 'thumb').rows.join('');
    for (const fleck of ['X', 'Y', 'Z']) expect(prism).toContain(fleck);
  });

  it('every render is a grounded, outlined object (filled band + K outline present)', () => {
    for (const id of ALL_IDS) {
      const r = composeConsumable(id);
      const filled = filledCount(r.rows);
      expect(filled, id).toBeGreaterThan(60);
      // Cap 380 in pass 1; pass 2's Incendiary flame flicker is a
      // deliberate silhouette break above the tips (+13 texels
      // with its outline ring) — 400 still catches a blob fill
      // (a full grid is 576) while letting the flame read.
      expect(filled, id).toBeLessThan(400);
      expect(r.rows.join(''), id).toContain('K');
    }
  });
});

/**
 * Pass 2 perceptual separation (owner direction 2026-11-04: the
 * vendor examples "look pretty similar" — sprites must separate
 * "not only in shape, but also in color and texture"). Pass 1's
 * pairwise-distinctness pin could not see the failure: 16 of 43
 * renders shared dominant hue 37° and the six loose-rounds ammos
 * were 56–61% brass casing. These pins encode the collision
 * audit (full table in PR #382's body — the audit is the primary
 * gate for new items; these numbers keep it from regressing):
 *
 * - COLOR HISTOGRAM: every identity texel (outline/shadow
 *   excluded) lands in one of 27 buckets — 12 hue buckets ×
 *   deep/bright value bands for saturated texels, 3 value bands
 *   for muted texels — normalized to a distribution. L1 distance
 *   between two items' distributions is the colorway distance:
 *   it sees hue, value, and how much of the object each owns.
 * - SILHOUETTE PROFILE: per-row filled widths, normalized — the
 *   shape distance.
 * A same-chassis pair must separate on one axis or the other;
 * the floor across the whole set today is the declared twin
 * MedKit/MedKitRefined (color 0.50), so thresholds sit ~20%
 * under the measured floor.
 */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hsvOf(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b) / 255; const mn = Math.min(r, g, b) / 255;
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    const R = r / 255; const G = g / 255; const B = b / 255;
    if (mx === R) h = 60 * (((G - B) / d) % 6);
    else if (mx === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, mx === 0 ? 0 : d / mx, mx];
}
function colorHistogram(id: string): number[] {
  const render = composeConsumable(id, 'object');
  const hist = new Array(27).fill(0);
  let identity = 0;
  for (let y = 0; y < render.height; y++) for (let x = 0; x < render.width; x++) {
    const shade = render.rows[y][x];
    if (shade === '.' || shade === 'K' || shade === 'S') continue;
    const hex = (render.colors as Record<string, string | undefined>)[shade];
    if (!hex) continue;
    identity++;
    const [h, s, v] = hsvOf(...hexToRgb(hex));
    const bucket = s < 0.28
      ? 24 + (v < 0.35 ? 0 : v <= 0.7 ? 1 : 2)
      : (Math.floor(h / 30) % 12) * 2 + (v < 0.5 ? 0 : 1);
    hist[bucket]++;
  }
  return hist.map((n) => n / identity);
}
function silhouetteProfile(id: string): number[] {
  const render = composeConsumable(id, 'object');
  const profile = new Array(24).fill(0);
  let filled = 0;
  for (let y = 0; y < render.height; y++) {
    for (let x = 0; x < render.width; x++) {
      const shade = render.rows[y][x];
      if (shade === '.' || shade === 'S') continue;
      profile[y]++; filled++;
    }
  }
  return profile.map((n) => n / filled);
}
function dominantHueBucket(id: string): number {
  const render = composeConsumable(id, 'object');
  const hist = new Array(12).fill(0);
  let sat = 0;
  for (let y = 0; y < render.height; y++) for (let x = 0; x < render.width; x++) {
    const shade = render.rows[y][x];
    if (shade === '.' || shade === 'K' || shade === 'S') continue;
    const hex = (render.colors as Record<string, string | undefined>)[shade];
    if (!hex) continue;
    const [h, s] = hsvOf(...hexToRgb(hex));
    if (s >= 0.28) { sat++; hist[Math.floor(h / 30) % 12]++; }
  }
  let best = 0;
  for (let i = 1; i < 12; i++) if (hist[i] > hist[best]) best = i;
  return sat ? best : -1;
}
const l1 = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0);

describe('consumableArt — pass 2 perceptual separation', () => {
  it('spreads dominant hues across the wheel (no brass pile-up)', () => {
    const buckets = new Map<number, string[]>();
    for (const id of ALL_IDS) {
      const bucket = dominantHueBucket(id);
      const arr = buckets.get(bucket) ?? [];
      arr.push(id);
      buckets.set(bucket, arr);
    }
    // Pass 1: 16 of 43 at hue ~37°. Pass 2: 9 buckets in use.
    expect(buckets.size).toBeGreaterThanOrEqual(8);
    for (const [bucket, arr] of buckets) {
      expect(arr.length, `hue bucket ${bucket * 30}° holds ${arr.join(', ')}`).toBeLessThanOrEqual(14);
    }
  });

  it('separates every same-chassis pair on colorway or silhouette', () => {
    const byChassis = new Map<string, string[]>();
    for (const id of ALL_IDS) {
      const chassis = CONSUMABLE_ART[id].chassis;
      const arr = byChassis.get(chassis) ?? [];
      arr.push(id);
      byChassis.set(chassis, arr);
    }
    for (const [chassis, arr] of byChassis) {
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const colorDist = l1(colorHistogram(arr[i]), colorHistogram(arr[j]));
        const silDist = l1(silhouetteProfile(arr[i]), silhouetteProfile(arr[j]));
        expect(
          colorDist >= 0.4 || silDist >= 0.3,
          `${chassis}: ${arr[i]} vs ${arr[j]} — color ${colorDist.toFixed(2)}, silhouette ${silDist.toFixed(2)}`,
        ).toBe(true);
      }
    }
  });

  it("separates the owner's example pair: Ordnance Charge vs Incendiary Ammo", () => {
    // The two vendor examples that "look pretty similar" in
    // pass 1 (both brass-dominant). Pass 2: color distance 1.21.
    const dist = l1(colorHistogram('OrdnanceCharge'), colorHistogram('IncendiaryAmmo'));
    expect(dist).toBeGreaterThanOrEqual(0.8);
  });
});

describe('consumableArt — compose contract', () => {
  it('is deterministic and cache-stable', () => {
    for (const id of ['MedKit', 'Grenade', 'CalibrationCore', 'WorkshopRushTicket']) {
      const a = composeConsumable(id);
      const b = composeConsumable(id);
      expect(a.rows).toEqual(b.rows);
      expect(a.signature).toBe(b.signature);
      expect(composeConsumableCached(id).signature).toBe(a.signature);
    }
  });

  it('object density is the 24 grid; thumb density is its own 12 grid, never a downscale', () => {
    for (const id of ALL_IDS) {
      const obj = composeConsumable(id, 'object');
      const thumb = composeConsumable(id, 'thumb');
      expect(obj.width, id).toBe(24);
      expect(obj.height, id).toBe(24);
      expect(thumb.width, id).toBe(12);
      expect(thumb.height, id).toBe(12);
      expect(thumb.rows.join('/'), id).not.toBe(obj.rows.join('/'));
      expect(filledCount(thumb.rows), id).toBeGreaterThan(15);
    }
  });

  it('unknown ids still compose (defensive fallback, never a crash)', () => {
    const r = composeConsumable('NotARealConsumable');
    expect(r.width).toBe(24);
    expect(filledCount(r.rows)).toBeGreaterThan(40);
  });
});
