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
    expect(ALL_IDS).toHaveLength(43);
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
  it('renders all 43 types as pairwise-distinct object sprites', () => {
    const seen = new Map<string, string>();
    for (const id of ALL_IDS) {
      const key = composeConsumable(id).rows.join('/');
      expect(seen.has(key), `${id} renders identically to ${seen.get(key)}`).toBe(false);
      seen.set(key, id);
    }
    expect(seen.size).toBe(43);
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

  it('every render is a grounded, outlined object (filled band + K outline present)', () => {
    for (const id of ALL_IDS) {
      const r = composeConsumable(id);
      const filled = filledCount(r.rows);
      expect(filled, id).toBeGreaterThan(60);
      expect(filled, id).toBeLessThan(380);
      expect(r.rows.join(''), id).toContain('K');
    }
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
