/**
 * Activity Log service (AL-3) — the client half of AL-2's read.
 *
 * GET /api/activity-log/me returns the caller's own unified record:
 * one page of ActivityRecords, newest first, cursor-paginated, with
 * server-side kind filters and one search box (item names, enemy
 * names, area names together). Identity comes from the Chef JWT —
 * no player id is ever sent. The DTOs below mirror the server's
 * wire contract (src/server/reads/activityLog.ts) field for field;
 * the projection's honesty rules ride along in the shapes: a drop's
 * receipt is AL-1's stamp read verbatim off the item, and pre-stamp
 * items carry receipt: null — this module never fills that gap.
 */
import { apiRequest } from './http';

export type ActivityRecordKind =
  | 'drop' | 'kills' | 'boss' | 'cache' | 'craft' | 'market'
  | 'earnings' | 'settlement' | 'salvage' | 'dispatch' | 'endless' | 'system';

/** Filter values the route accepts: every kind, plus 'away' (the away-era pseudo-kind). */
export type ActivityLogKindFilter = ActivityRecordKind | 'away';

export interface ActivityItemSummary {
  id: string;
  name: string | null;
  kind: string | null;
  rarity: string | null;
  level: number | null;
}

/** AL-1's odds stamp, verbatim. Fields that did not apply to a drop are absent. */
export interface ActivityDropOdds {
  gearChance?: number;
  kind?: string;
  rarityWeights?: Record<string, number>;
  luck?: number;
  boost?: boolean;
  floor?: string;
  scalar?: number;
  dedicatedChance?: number;
  dedicatedHit?: boolean;
  dropLuckBonus?: number;
}

/** AL-1's receipt, surfaced on drop records only. Null = pre-stamp item. */
export interface ActivityDropReceipt {
  foundVia: string;
  foundContext: string | number | null;
  foundEnemy: { id: string; name: string; relation: string } | null;
  dropOdds: ActivityDropOdds | null;
  sourceId: string | null;
}

export interface ActivityEarnings {
  credits?: number;
  scrap?: number;
  xp?: number;
  fragments?: number;
  materials?: Record<string, number>;
  essences?: Record<string, number>;
}

export interface ActivityRecord {
  id: string;
  kind: ActivityRecordKind;
  /** ISO timestamp of the fact. */
  at: string;
  /** True for facts the offline settler produced (the while-away chapter). */
  away: boolean;
  /** Short server-composed story line, from the record's own facts only. */
  label: string;
  item?: ActivityItemSummary;
  /** Drop records only: the AL-1 receipt, or null for pre-stamp items. */
  receipt?: ActivityDropReceipt | null;
  areaId?: string | null;
  areaName?: string | null;
  kills?: { count: number };
  earnings?: ActivityEarnings;
  boss?: {
    bossId: string;
    bossName: string | null;
    victory: boolean;
    winChance: number | null;
    dedicatedChance: number | null;
    dedicatedDropAwarded: boolean | null;
    dropLuckBonus: number | null;
    creditsGained: number;
    creditsLost: number;
    loot: ActivityItemSummary[];
  };
  cache?: {
    tableId: string | null;
    outcome: string | null;
    roll: number | null;
    totalWeight: number | null;
    oddsTableVersion: number | null;
    cacheQuality: number | null;
    payment: string | null;
  };
  craft?: {
    recipeId: string;
    recipeName: string | null;
    jobKind: string;
    bench: number | null;
    unitsCompleted: number;
    unitsTotal: number | null;
    xpAwarded: number;
    outputs: Array<{ name: string | null; count: number }>;
  };
  market?: {
    direction: 'bought' | 'sold';
    priceCredits: number;
    feeCredits: number | null;
    /** Sold records only: the credits the seller was actually credited (price − fee + any Silver Tongue uplift), proven by the sale's accept rows. Null when unproven. */
    proceedsCredits?: number | null;
    counterpartyId: string | null;
    counterpartyName: string | null;
    listingId: string | null;
    goodsKey?: string | null;
    quantity?: number | null;
  };
  settlement?: {
    elapsedMs: number | null;
    capHours: number | null;
    capReached: boolean | null;
    ticks: number | null;
  };
  salvage?: { scrapAward: number; coresAward: number; auto?: boolean };
  dispatch?: { family: string; payoutCredits: number; payoutFraction: number | null };
  endless?: { status: string; depthReached: number };
  system?: { subtype: string };
}

export interface ActivityLogPage {
  records: ActivityRecord[];
  nextCursor: string | null;
  limit: number;
}

export interface ActivityLogFetchParams {
  kinds?: ActivityLogKindFilter[];
  q?: string;
  cursor?: string;
  limit?: number;
}

export async function fetchActivityLog(params: ActivityLogFetchParams = {}): Promise<ActivityLogPage> {
  const search = new URLSearchParams();
  if (params.kinds?.length) search.set('kind', params.kinds.join(','));
  if (params.q?.trim()) search.set('q', params.q.trim());
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return apiRequest<ActivityLogPage>(`/activity-log/me${qs ? `?${qs}` : ''}`);
}
