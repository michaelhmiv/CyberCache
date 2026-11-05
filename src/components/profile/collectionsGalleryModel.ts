import { bespokeSpriteIdForLegendaryEffect } from '@/lib/pixel/manifest';
import { AREA_VISUALS, type RoamingAreaId } from '@/content/areaPalettes';
import type { CollectionEntry, CollectionFamily } from '@/content/collections';
import type { CollectionsPayload } from '@/lib/api/verifiedOps';

/**
 * CollectionsGallery model — the non-component half of the Variant C
 * ("Showcase") design pass: discovery truth, family vocabulary, and
 * sprite resolution. Split from the component file so the gallery
 * stays fast-refresh clean (react-refresh/only-export-components).
 *
 * Truth rules are the shipped page's (QC A11): found state comes
 * only from the GET /api/collections/me payload's discovery records;
 * undiscovered entries print neither name nor hint anywhere.
 */

export interface DiscoveryInfo {
  source: string;
  discoveredAt?: string;
}

export type DiscoveryMap = Map<string, DiscoveryInfo>;

export const GALLERY_FAMILY_LABELS: Record<CollectionFamily, string> = {
  legendary_effect: 'Legendary Effects',
  boss: 'Bosses Downed',
  weapon_frame: 'Legendary Frames',
  named_elite: 'Named Elites',
};

/** What an UNLOGGED entry may say about itself: how its family is
 *  earned, never which entry it is. (Verbatim from the shipped
 *  screen — the A11 tests pin the boss line.) */
export const GALLERY_UNDISCOVERED_TEASERS: Record<CollectionFamily, string> = {
  legendary_effect: 'An unlogged legendary effect — own a weapon carrying it to log this entry.',
  boss: 'An undefeated boss — beat it to log this entry.',
  weapon_frame: 'An unlogged Legendary frame — own one to log this entry.',
  named_elite: 'An undowned named elite — fell it in its roaming area to log this entry.',
};

export const ZONE_PAINTINGS: Record<string, string> = {
  dustwaste_frontier: 'zone-dustwaste-bg',
  redline_circuit: 'zone-redline-bg',
  ironwood_bastion: 'zone-ironwood-bg',
  blastforge_yards: 'zone-blastforge-bg',
  prismatek_reactor: 'zone-prismatek-bg',
  throwtech_dumpnet: 'zone-throwtech-bg',
  helixworks_labyrinth: 'zone-helixworks-bg',
};

export function gallerySpriteIdFor(entry: CollectionEntry): string | undefined {
  if (entry.family === 'boss') return `boss-${entry.key.replace(/_/g, '-')}`;
  if (entry.family === 'legendary_effect') return bespokeSpriteIdForLegendaryEffect(entry.key);
  if (entry.family === 'named_elite') {
    return AREA_VISUALS[entry.key as RoamingAreaId]?.eliteSpriteId ?? 'enemy-elite';
  }
  return undefined;
}

export function discoveryMapFromPayload(payload: CollectionsPayload): DiscoveryMap {
  const map: DiscoveryMap = new Map();
  for (const d of payload.discoveries ?? []) {
    map.set(`${d.family}:${d.entry_key}`, { source: d.source, discoveredAt: d.discovered_at });
  }
  return map;
}
