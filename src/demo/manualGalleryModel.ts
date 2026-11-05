/**
 * ManualGallery model — the non-component exports for the Field
 * Manual Showcase prototype (kept apart from the components file
 * for the react-refresh export rule): the gallery palette/type
 * voices shared with the other variant-C passes, and the art each
 * section hangs with.
 *
 * Every piece's art is the game's own, resolved through the pixel
 * manifest: a section hangs on the painting or object that IS its
 * subject — Getting Started on the Dustwaste Frontier (the first
 * turf the tour names), Weapons & Loot on a bespoke legendary
 * sprite, Boss Fights on the Dune Tyrant standing in its own
 * arena, Economy on the cache crate itself.
 */
import { getPixelSprite } from '@/lib/pixel/manifest';
import { bossArt } from '@/lib/pixel/bossIdentity';

export const GROUND = '#171008';
export const BONE = '#F5EFE6';
export const BODY = '#D9CFBC';
export const FAINT = '#A2957F';
export const HAIR = 'rgba(245,239,230,0.14)';
export const AMBER = '#FF9000';
export const DISPLAY = '"Bebas Neue", "Chakra Petch", sans-serif';

export type SectionArt =
  | { kind: 'painting'; spriteId: string }
  | { kind: 'object'; spriteId: string }
  | { kind: 'boss'; bossId: string };

export const SECTION_ART: Record<string, SectionArt> = {
  start: { kind: 'painting', spriteId: 'zone-dustwaste-bg' },
  loot: { kind: 'object', spriteId: 'legendary-emberfall' },
  loadout: { kind: 'painting', spriteId: 'zone-ironwood-bg' },
  bosses: { kind: 'boss', bossId: 'dune_tyrant' },
  economy: { kind: 'object', spriteId: 'crate' },
  skills: { kind: 'painting', spriteId: 'zone-prismatek-bg' },
  mastery: { kind: 'painting', spriteId: 'zone-helixworks-bg' },
  tips: { kind: 'painting', spriteId: 'zone-throwtech-bg' },
};

/** The featured exhibit — the tour crosses every turf; it hangs on the Redline Circuit. */
export const TOUR_ART: SectionArt = { kind: 'painting', spriteId: 'zone-redline-bg' };

export interface ResolvedArt {
  paintingUrl?: string;
  objectUrl?: string;
  bossSpriteUrl?: string;
  bossArenaUrl?: string;
}

export function resolveArt(art: SectionArt): ResolvedArt {
  if (art.kind === 'boss') {
    const boss = bossArt(art.bossId);
    return boss ? { bossSpriteUrl: boss.spriteUrl, bossArenaUrl: boss.arenaUrl } : {};
  }
  const sprite = getPixelSprite(art.spriteId);
  if (!sprite) return {};
  return art.kind === 'painting' ? { paintingUrl: sprite.url } : { objectUrl: sprite.url };
}
