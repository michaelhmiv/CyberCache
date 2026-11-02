/**
 * TechFragments → "Tech" display rename (owner ruling, 2026-11-02).
 *
 * The resource collided by name with Cache Fragments (the cache-key
 * shard system). The ruling renames the DISPLAY name only: the
 * internal id stays 'TechFragments' because it is persisted player
 * data — it is the key in the profiles.materials JSONB map, the id in
 * applied-migration SQL whitelists and recipe payloads, and the wire
 * token in Chef feed labels. These tests pin both halves of that
 * contract so neither can drift:
 *
 *  - id stability: enum value, market id list, crafting inputs, and
 *    the vendor entry all still resolve under 'TechFragments';
 *  - display rename: every player-facing name source (visual
 *    registry label, vendor catalog, content glossary) says 'Tech',
 *    no display text anywhere still says 'Tech Fragments', and the
 *    generated wiki annex prints 'Tech'.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ESSENCE_VISUALS, MATERIAL_VISUALS, getVisualAsset } from '../constants/visualAssets';
import { ALL_CRAFT_RECIPES } from '../content/crafting';
import { MATERIALS } from '../content/gameContent';
import { MARKET_MATERIAL_IDS } from '../lib/market/identityKey';
import { VENDOR_MATERIALS } from '../lib/vendor/catalog';
import { MaterialType } from '../types/game';

const WIKI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'wiki');

describe('TechFragments → Tech rename — stored id stays stable', () => {
  it('the MaterialType id (profiles.materials JSONB key) is unchanged', () => {
    expect(MaterialType.TechFragments).toBe('TechFragments');
    expect(Object.values(MaterialType)).toContain('TechFragments');
  });

  it('the market tradable-id list still resolves the id', () => {
    expect(MARKET_MATERIAL_IDS).toContain('TechFragments');
  });

  it('crafting still keys the resource by id (Woven Circuits refining)', () => {
    const refine = ALL_CRAFT_RECIPES.find((r) => r.id === 'refine_woven_circuits');
    expect(refine).toBeDefined();
    expect(refine?.inputs).toEqual({ TechFragments: 10 });
    expect(refine?.outputMaterial).toBe(MaterialType.WovenCircuits);
  });

  it('the vendor entry still resolves under the same id and price', () => {
    const entry = VENDOR_MATERIALS.find((e) => e.id === MaterialType.TechFragments);
    expect(entry).toBeDefined();
    expect(entry?.unitPrice).toBe(35);
  });
});

describe('TechFragments → Tech rename — display name is Tech', () => {
  it('the visual registry (the label every surface renders) says Tech', () => {
    expect(MATERIAL_VISUALS[MaterialType.TechFragments].label).toBe('Tech');
    expect(getVisualAsset('material', MaterialType.TechFragments).label).toBe('Tech');
  });

  it('the vendor catalog name says Tech', () => {
    const entry = VENDOR_MATERIALS.find((e) => e.id === MaterialType.TechFragments);
    expect(entry?.name).toBe('Tech');
  });

  it('the content glossary name says Tech (its own def id untouched)', () => {
    const def = MATERIALS.find((m) => m.id === 'tech_fragments');
    expect(def?.name).toBe('Tech');
  });

  it('no display text in the registries or vendor catalog still says Tech Fragments', () => {
    const displayTexts: string[] = [];
    for (const v of [...Object.values(MATERIAL_VISUALS), ...Object.values(ESSENCE_VISUALS)]) {
      displayTexts.push(v.label, v.description);
    }
    for (const e of VENDOR_MATERIALS) displayTexts.push(e.name);
    for (const m of MATERIALS) displayTexts.push(m.name);
    for (const text of displayTexts) {
      expect(text).not.toMatch(/tech fragments/i);
    }
  });

  it('the generated wiki annex prints Tech, never the old name', () => {
    const recipes = readFileSync(join(WIKI_DIR, 'Reference-Recipes.md'), 'utf8');
    const reference = readFileSync(join(WIKI_DIR, 'Reference.md'), 'utf8');
    expect(recipes).toContain('Tech ×10');
    expect(recipes).not.toContain('TechFragments');
    expect(reference).toContain('Tech');
    expect(reference).not.toContain('TechFragments');
  });
});
