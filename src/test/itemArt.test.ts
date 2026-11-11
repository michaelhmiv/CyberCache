import { describe, expect, it } from 'vitest';
import { CONSUMABLES } from '@/constants/consumables';
import { ESSENCE_VISUALS, MATERIAL_VISUALS, RESOURCE_VISUALS } from '@/constants/visualAssets';
import { getPixelSprite } from '@/lib/pixel/manifest';
import {
  consumableSpriteId,
  itemSpriteSignature,
  materialSpriteId,
  walletSpriteId,
} from '@/lib/pixel/itemArt';
import { CONSUMABLE_SLUGS, MATERIAL_SLUGS, WALLET_SLUGS } from '@/lib/pixel/itemSlugs';

/**
 * Top-Choice item art (INT-4) — the adoption contract:
 * every consumable type, every material + essence, and every
 * surviving wallet resource resolves to a registered manifest
 * sprite (the adopted Wave 11/12 painting), so no item surface
 * can fall back to a glyph or a letter mark. Cache Fragment
 * resolves NOWHERE: its registry entry is deleted (owner ruling
 * 2026-11-11) and it must never reappear in the maps.
 */
describe('itemArt — Top-Choice sprite coverage (INT-4)', () => {
  it('maps all 44 consumable types to registered sprites', () => {
    const ids = Object.keys(CONSUMABLES);
    expect(ids).toHaveLength(44);
    expect(Object.keys(CONSUMABLE_SLUGS).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const spriteId = consumableSpriteId(id);
      expect(spriteId, id).toBeDefined();
      const sprite = getPixelSprite(spriteId!);
      expect(sprite, `${id} → ${spriteId}`).toBeDefined();
      expect(sprite!.kind).toBe('item');
      expect(sprite!.url).toBeTruthy();
    }
  });

  it('maps all 26 materials + essences to registered sprites', () => {
    const ids = [...Object.keys(MATERIAL_VISUALS), ...Object.keys(ESSENCE_VISUALS)];
    expect(ids).toHaveLength(26);
    expect(Object.keys(MATERIAL_SLUGS).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const sprite = getPixelSprite(materialSpriteId(id)!);
      expect(sprite, id).toBeDefined();
      expect(sprite!.kind).toBe('item');
    }
  });

  it('maps the surviving wallet resources; scrap shares the material master', () => {
    const ids = Object.keys(RESOURCE_VISUALS);
    expect(ids).toHaveLength(8);
    for (const id of ids) {
      const sprite = getPixelSprite(walletSpriteId(id)!);
      expect(sprite, id).toBeDefined();
      expect(sprite!.kind).toBe('item');
    }
    expect(walletSpriteId('scrap')).toBe('mat-scrap');
    expect(walletSpriteId('scrap')).toBe(materialSpriteId('Scrap'));
    expect(Object.keys(WALLET_SLUGS)).toHaveLength(7);
  });

  it('Cache Fragment is deleted from every registry and map', () => {
    expect('cacheFragment' in RESOURCE_VISUALS).toBe(false);
    expect(walletSpriteId('cacheFragment')).toBeUndefined();
    expect('cacheFragment' in WALLET_SLUGS).toBe(false);
    expect(Object.values(CONSUMABLE_SLUGS)).not.toContain('cache-fragment');
    expect(Object.values(MATERIAL_SLUGS)).not.toContain('cache-fragment');
    expect(getPixelSprite('wallet-cache-fragment')).toBeUndefined();
    expect(getPixelSprite('mat-cache-fragment')).toBeUndefined();
  });

  it('signatures are stable per sprite and distinct across families', () => {
    const a = itemSpriteSignature('item-med-kit');
    expect(a).toBe(itemSpriteSignature('item-med-kit'));
    expect(a).not.toBe(itemSpriteSignature('mat-scrap'));
    expect(a).not.toBe(itemSpriteSignature('wallet-credits'));
  });
});
