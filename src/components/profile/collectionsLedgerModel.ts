import { bespokeSpriteIdForLegendaryEffect, getPixelSprite } from '@/lib/pixel/manifest';
import { AREA_VISUALS, type RoamingAreaId } from '@/content/areaPalettes';
import {
  COLLECTION_FAMILIES,
  COLLECTION_TOTAL,
  collectionEntriesForFamily,
  type CollectionEntry,
  type CollectionFamily,
} from '@/content/collections';
import type { CollectionsPayload } from '@/lib/api/verifiedOps';
import { WEAPON_TYPES } from '@/constants/weaponTypes';
import type { WeaponType } from '@/types/game';

/**
 * CollectionsLedger model — the non-component half of the Variant E
 * ("Quiet plates") design pass: discovery truth, family vocabulary,
 * catalog indexing, and sprite resolution. Split from the component
 * file so the ledger stays fast-refresh clean
 * (react-refresh/only-export-components).
 *
 * Truth rules are the shipped page's (QC A11): found state comes
 * only from the GET /api/collections/me payload's discovery records;
 * undiscovered entries print neither name nor hint anywhere — the
 * ledger shows "Undiscovered" and the family teaser, in the index
 * and in the detail view alike.
 */

export interface DiscoveryInfo {
  source: string;
  discoveredAt?: string;
}

export type DiscoveryMap = Map<string, DiscoveryInfo>;

export const LEDGER_FAMILY_LABELS: Record<CollectionFamily, string> = {
  legendary_effect: 'Legendary Effects',
  boss: 'Bosses',
  weapon_frame: 'Legendary Frames',
  named_elite: 'Named Elites',
};

/** The shipped screen's family blurbs, verbatim — copy stays the
 *  game's voice; only the setting changes. */
export const LEDGER_FAMILY_BLURBS: Record<CollectionFamily, string> = {
  legendary_effect: 'Effects rolled on legendary weapons you have held.',
  boss: 'Every boss in the wastes, beaten at least once.',
  weapon_frame: 'A Legendary of this frame has passed through your hands.',
  named_elite: 'The named elite of each roaming area, brought down.',
};

/** What an UNLOGGED entry may say about itself: how its family is
 *  earned, never which entry it is. (Verbatim from the shipped
 *  screen — the A11 tests pin the boss line.) */
export const LEDGER_UNDISCOVERED_TEASERS: Record<CollectionFamily, string> = {
  legendary_effect: 'An unlogged legendary effect — own a weapon carrying it to log this entry.',
  boss: 'An undefeated boss — beat it to log this entry.',
  weapon_frame: 'An unlogged Legendary frame — own one to log this entry.',
  named_elite: 'An undowned named elite — fell it in its roaming area to log this entry.',
};

export function discoveryMapFromPayload(payload: CollectionsPayload): DiscoveryMap {
  const map: DiscoveryMap = new Map();
  for (const d of payload.discoveries ?? []) {
    map.set(`${d.family}:${d.entry_key}`, { source: d.source, discoveredAt: d.discovered_at });
  }
  return map;
}

/** One catalog row in the ledger: the entry, its continuous catalog
 *  number (1..81 across all families — the index IS the progress),
 *  and its discovery record when the server holds one. */
export interface LedgerRow {
  entry: CollectionEntry;
  number: number;
  discovery?: DiscoveryInfo;
}

export interface LedgerChapter {
  family: CollectionFamily;
  label: string;
  blurb: string;
  rows: LedgerRow[];
  found: number;
  total: number;
}

export function buildLedger(payload: CollectionsPayload): { chapters: LedgerChapter[]; foundTotal: number } {
  const discoveries = discoveryMapFromPayload(payload);
  let number = 0;
  let foundTotal = 0;
  const chapters = COLLECTION_FAMILIES.map((family) => {
    const rows = collectionEntriesForFamily(family).map((entry) => {
      number += 1;
      const discovery = discoveries.get(`${family}:${entry.key}`);
      if (discovery) foundTotal += 1;
      return { entry, number, discovery };
    });
    return {
      family,
      label: LEDGER_FAMILY_LABELS[family],
      blurb: LEDGER_FAMILY_BLURBS[family],
      rows,
      found: rows.filter((r) => r.discovery).length,
      total: rows.length,
    };
  });
  return { chapters, foundTotal };
}

/** Frames group under their weapon type inside the chapter — the
 *  grouping is the only sub-structure the quiet index allows itself.
 *  The type comes from the entry key's type id, never from splitting
 *  the printed name (type names are not single words by contract). */
export function groupFrameRows(rows: LedgerRow[]): Array<{ typeName: string; rows: LedgerRow[] }> {
  const groups = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const typeId = row.entry.key.split(':')[0];
    const typeName = WEAPON_TYPES[typeId as WeaponType]?.name ?? typeId;
    groups.set(typeName, [...(groups.get(typeName) ?? []), row]);
  }
  return [...groups.entries()].map(([typeName, groupRows]) => ({ typeName, rows: groupRows }));
}

export function ledgerSpriteIdFor(entry: CollectionEntry): string | undefined {
  if (entry.family === 'boss') return `boss-${entry.key.replace(/_/g, '-')}`;
  // Legendary effects resolve through the canonical effect → name →
  // sprite resolver, never by munging the effect id (shipped rule).
  if (entry.family === 'legendary_effect') return bespokeSpriteIdForLegendaryEffect(entry.key);
  if (entry.family === 'named_elite') {
    return AREA_VISUALS[entry.key as RoamingAreaId]?.eliteSpriteId ?? 'enemy-elite';
  }
  return undefined;
}

export function ledgerSpriteUrl(entry: CollectionEntry): string | undefined {
  const id = ledgerSpriteIdFor(entry);
  return id ? getPixelSprite(id)?.url : undefined;
}

export function seedFromKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 30, 2026" — the quiet date form used in provenance lines. */
export function formatLedgerDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export { COLLECTION_TOTAL };
