import { hashString } from '@/lib/utils/rng';
import { getPixelSprite } from './manifest';

/**
 * itemArt — the Top-Choice item sprites (INT-4, owner adoption
 * 2026-11-11). The adopted painterly masters for consumables
 * (Wave 11), materials + essences (Wave 12), and the wallet
 * resources (Wave 12) ship as manifest sprites, produced by
 * scripts/topchoice-items-key.py: the master's white ground keyed
 * out (Wave 9 luminance lineage — border-connected near-white,
 * unmultiplied), the object fitted into its ship box at 2× the
 * family's largest display size, palette-256 encoded with true
 * alpha (BRIEF hard floors 2 + 7). Prism Shards is the one
 * object-keyed master: its painting carries a fake-transparency
 * checkerboard that is not border-connected, so its alpha keys
 * from the object silhouette instead (Wave 12/15 disposition).
 *
 * This module is the single id → sprite map for the family —
 * the components (PixelConsumable / PixelMaterial /
 * PixelWalletIcon) read sprites from here, and the wiki
 * generator's plates resolve through the same manifest files,
 * so card / inspect / rows / wiki all show the one adopted
 * render per item (BRIEF floor 6, one-render-signature parity).
 * Cache Fragment has NO sprite: the fragment currency was
 * abolished and its registry entry, glyph mapping, and wiki
 * presence are deleted with this slice (owner ruling
 * 2026-11-11) — the wallet keeps exactly the seven live
 * resources below.
 */

export { CONSUMABLE_SLUGS, MATERIAL_SLUGS, WALLET_SLUGS } from './itemSlugs';
import { CONSUMABLE_SLUGS, MATERIAL_SLUGS, WALLET_SLUGS } from './itemSlugs';

export function consumableSpriteId(id: string): string | undefined {
  const slug = CONSUMABLE_SLUGS[id];
  return slug ? `item-${slug}` : undefined;
}

export function materialSpriteId(id: string): string | undefined {
  const slug = MATERIAL_SLUGS[id];
  return slug ? `mat-${slug}` : undefined;
}

export function walletSpriteId(id: string): string | undefined {
  if (id === 'scrap') return 'mat-scrap';
  const slug = WALLET_SLUGS[id];
  return slug ? `wallet-${slug}` : undefined;
}

/**
 * The render signature for an item sprite: a stable hash of the
 * sprite id + shipped dimensions. Components print it as
 * data-signature exactly as the retired runtime compositors did
 * (their signature was a hash of the composed rows); the sprite
 * IS the render now, so its identity is the signature.
 */
export function itemSpriteSignature(spriteId: string): string {
  const sprite = getPixelSprite(spriteId);
  return hashString(`topchoice-item|${spriteId}|${sprite?.width ?? 0}x${sprite?.height ?? 0}`).toString(16);
}
