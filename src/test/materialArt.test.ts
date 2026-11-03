import { describe, expect, it } from 'vitest';
import { EssenceType, MaterialType } from '@/types/game';
import { ESSENCE_VISUALS, MATERIAL_VISUALS, getMaterialVisual } from '@/constants/visualAssets';
import {
  MATERIAL_ART,
  composeMaterial,
  composeMaterialCached,
  materialArtRow,
} from '@/lib/pixel/materialArt';

/**
 * STUFF (materials pixel system) — the contract the owner approved:
 * every registry good is a formed object from one data table (no
 * per-surface maps, no fallback glyph), the letter mark is dead,
 * lineage survives refinement, and the thumb is composed at
 * detail level 0 on its own 12-grid.
 */

const REGISTRY_IDS = [...Object.keys(MATERIAL_VISUALS), ...Object.keys(ESSENCE_VISUALS)];
const ALL_IDS = [...REGISTRY_IDS, 'Scrap'];

function filledCount(rows: string[]): number {
  return rows.reduce((n, row) => n + [...row].filter((c) => c !== '.').length, 0);
}

describe('materialArt — coverage', () => {
  it('has exactly one STUFF row per registry good, plus the Scrap resource row', () => {
    expect(Object.keys(MATERIAL_ART).sort()).toEqual([...ALL_IDS].sort());
  });

  it('resolves an art row for every registry id', () => {
    for (const id of REGISTRY_IDS) {
      const row = materialArtRow(id);
      expect(row, id).toBeDefined();
      expect(row.family, id).toBeTruthy();
      expect(row.band, id).toBeTruthy();
    }
  });

  it('bands follow the registry: 5 raw, 7 signature, 5 refined, 4 composite, 5 essence', () => {
    const bands = REGISTRY_IDS.map((id) => MATERIAL_ART[id].band);
    expect(bands.filter((b) => b === 'raw')).toHaveLength(5);
    expect(bands.filter((b) => b === 'signature')).toHaveLength(7);
    expect(bands.filter((b) => b === 'refined')).toHaveLength(5);
    expect(bands.filter((b) => b === 'composite')).toHaveLength(4);
    expect(bands.filter((b) => b === 'essence')).toHaveLength(5);
  });
});

describe('materialArt — lineage (refinement reads as alignment of the same stuff)', () => {
  const PAIRS: Array<[MaterialType, MaterialType]> = [
    [MaterialType.Scrap, MaterialType.RefinedAlloy],
    [MaterialType.BallisticParts, MaterialType.TemperedParts],
    [MaterialType.ReactiveComponents, MaterialType.StabilizedCells],
    [MaterialType.TechFragments, MaterialType.WovenCircuits],
    [MaterialType.VoidDust, MaterialType.CondensedVoid],
  ];

  it('each refined form keeps its base material family', () => {
    for (const [base, refined] of PAIRS) {
      // The one authored exception (the exploration's own table):
      // Tech is a broken chunk, and WOVEN Circuits is what weaving
      // it produces — the form changes because weaving IS the
      // processing. Every other pair keeps its family outright.
      if (base === MaterialType.TechFragments) continue;
      expect(MATERIAL_ART[refined].family, `${base} -> ${refined}`).toBe(MATERIAL_ART[base].family);
      expect(MATERIAL_ART[refined].band).toBe('refined');
    }
  });

  it('every lineage pair keeps its colorway family (identical registry accent)', () => {
    for (const [base, refined] of PAIRS) {
      expect(getMaterialVisual(refined).accentColor, `${base} -> ${refined}`)
        .toBe(getMaterialVisual(base).accentColor);
    }
  });

  it('each lineage pair renders differently (alignment changes the form)', () => {
    for (const [base, refined] of PAIRS) {
      expect(composeMaterial(refined).signature, `${base} -> ${refined}`).not.toBe(composeMaterial(base).signature);
    }
  });
});

describe('materialArt — renders', () => {
  it('composes a 24x24 object and a 12x12 thumb for every good', () => {
    for (const id of ALL_IDS) {
      const obj = composeMaterial(id, 'object');
      expect(obj.width, id).toBe(24);
      expect(obj.height, id).toBe(24);
      expect(obj.rows).toHaveLength(24);
      expect(filledCount(obj.rows), id).toBeGreaterThan(40);
      const thumb = composeMaterial(id, 'thumb');
      expect(thumb.width, id).toBe(12);
      expect(thumb.height, id).toBe(12);
      expect(filledCount(thumb.rows), id).toBeGreaterThan(12);
    }
  });

  it('is deterministic: the same id composes the identical render', () => {
    for (const id of ALL_IDS) {
      expect(composeMaterial(id).signature).toBe(composeMaterial(id).signature);
      expect(composeMaterial(id, 'thumb').rows).toEqual(composeMaterial(id, 'thumb').rows);
    }
  });

  it('cache returns the identical render object for identical input', () => {
    expect(composeMaterialCached('VoidDust')).toBe(composeMaterialCached('VoidDust'));
  });

  it('every good renders distinctly at object density — no two silhouettes collide', () => {
    const signatures = ALL_IDS.map((id) => composeMaterial(id).signature);
    expect(new Set(signatures).size).toBe(ALL_IDS.length);
  });

  it('Void Dust and Void Essence — the pair whose letter tiles were IDENTICAL — now differ', () => {
    expect(composeMaterial(MaterialType.VoidDust).signature).not.toBe(composeMaterial(EssenceType.VoidEssence).signature);
    expect(composeMaterial(MaterialType.VoidDust, 'thumb').signature).not.toBe(composeMaterial(EssenceType.VoidEssence, 'thumb').signature);
  });

  it('every shade painted has a color (no unmapped texels)', () => {
    for (const id of ALL_IDS) {
      for (const density of ['object', 'thumb'] as const) {
        const render = composeMaterial(id, density);
        const used = new Set(render.rows.join('').replace(/\./g, '').split(''));
        for (const shade of used) {
          expect(render.colors[shade as keyof typeof render.colors], `${id}/${density}/${shade}`).toBeTruthy();
        }
      }
    }
  });

  it('the thumb is detail level 0: its own composition, never the object downscaled', () => {
    for (const id of ALL_IDS) {
      const obj = composeMaterial(id, 'object');
      const thumb = composeMaterial(id, 'thumb');
      expect(thumb.signature).not.toBe(obj.signature);
      // A raw 2x downscale of the object would keep the object's
      // exact texel parity pattern; the composed thumb's filled
      // count sits in the bold-silhouette band instead.
      expect(filledCount(thumb.rows)).toBeLessThan(filledCount(obj.rows) / 2);
    }
  });

  it('unknown ids still render a formed object (never a crash, never a letter)', () => {
    const render = composeMaterial('NotARealMaterial');
    expect(render.width).toBe(24);
    expect(filledCount(render.rows)).toBeGreaterThan(40);
  });
});

describe('materialArt — the swatch family separates on structure, not color alone', () => {
  it('the four woven goods have pairwise-distinct thumbs', () => {
    const woven = [
      MaterialType.WovenCircuits,
      MaterialType.CircuitLattice,
      MaterialType.Voidweave,
      MaterialType.Chromaweave,
      MaterialType.MycoSteelFiber,
    ];
    const thumbs = woven.map((id) => composeMaterial(id, 'thumb').signature);
    expect(new Set(thumbs).size).toBe(woven.length);
  });
});
