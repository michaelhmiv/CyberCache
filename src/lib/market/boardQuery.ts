/**
 * boardQuery — the ONE service-board browse query contract
 * (market-lane parity: the repair board and the shield-tech board
 * browse with the same discipline the Buy lane got in market depth
 * 0019 — server-side filtering / sorting / searching / pagination
 * instead of downloading the whole board and eyeballing it).
 *
 * The boards are assembled by ONE pair of view builders shared by
 * both write stores (buildRepairBoardView / buildShieldTechBoardView
 * in src/server/writes/), so unlike market listings — where the Pg
 * store runs a SQL twin of this fold — the fold below IS the single
 * execution path for both stores. The query vocabulary deliberately
 * mirrors MarketListingQuery (search / priceMin / priceMax / sort /
 * limit / offset, same limit clamps) so a player who learned the Buy
 * lane already knows these boards.
 *
 * Scope of the query: it browses the OPEN postings (the board's
 * storefront). `status` is the one exception — open postings are
 * 'listed' by construction, so a status filter applies where
 * statuses actually vary: the caller's own postings and workbench.
 */
import { clampLimit, clampOffset } from './listingQuery';

export type ServiceBoardSort = 'newest' | 'pay_desc' | 'pay_asc' | 'condition' | 'expiring';

export const SERVICE_BOARD_SORTS: readonly ServiceBoardSort[] = [
  'newest', 'pay_desc', 'pay_asc', 'condition', 'expiring',
];

/** Job statuses the board ever shows (service_jobs.status values). */
export const SERVICE_BOARD_STATUSES: readonly string[] = [
  'listed', 'active', 'completed', 'cancelled',
];

export interface ServiceBoardQuery {
  /** Case-insensitive substring over the job's display haystack:
   *  vehicle class name, shield rarity + behavior swap names, and
   *  the owner's display name. */
  search?: string;
  /** Statuses for the caller's OWN lists (mine / work). Open
   *  postings are always 'listed' and ignore this. */
  status?: string[];
  rarity?: string;
  /** Repair lane: vehicle class id (e.g. 'dune_buggy'). */
  vehicleClass?: string;
  /** Shield-tech lane: behavior ids (e.g. 'nova', 'turtle'). */
  fromBehavior?: string;
  toBehavior?: string;
  /** Repair lane: vehicle condition percent band
   *  (condition_current / condition_max × 100). */
  conditionMin?: number;
  conditionMax?: number;
  /** Work-size band over the job's target points (repair: points to
   *  restore; shield-tech: calibration points). */
  pointsMin?: number;
  pointsMax?: number;
  /** Escrowed job price band (what the owner escrowed up front). */
  priceMin?: number;
  priceMax?: number;
  /** Requirements-met filter: only jobs the reader can accept right
   *  now (server-computed requirements: verified account, not the
   *  reader's own job, holds the supply the lane burns). */
  canTake?: boolean;
  sort?: ServiceBoardSort;
  limit?: number;
  offset?: number;
}

/**
 * A board job reduced to its browse facts — everything filtering,
 * sorting and pagination need. Each lane's view builder derives
 * these from its job view, so the fold never reaches into lane
 * payloads. `conditionKey` is the lane's headline state number for
 * the 'condition' sort: repair = vehicle condition percent (most
 * worn first); shield-tech shields carry no condition, so it is
 * the calibration size (smallest job first).
 */
export interface ServiceBoardBrowseFacts {
  searchText: string;
  rarity: string | null;
  vehicleClass: string | null;
  fromBehavior: string | null;
  toBehavior: string | null;
  conditionPct: number | null;
  conditionKey: number | null;
  targetPoints: number;
  priceCredits: number;
  createdAtMs: number;
  expiresAtMs: number | null;
  canTake: boolean;
}

function matches(facts: ServiceBoardBrowseFacts, q: ServiceBoardQuery): boolean {
  if (q.search && !facts.searchText.toLowerCase().includes(q.search.toLowerCase())) return false;
  if (q.rarity && facts.rarity !== q.rarity) return false;
  if (q.vehicleClass && facts.vehicleClass !== q.vehicleClass) return false;
  if (q.fromBehavior && facts.fromBehavior !== q.fromBehavior) return false;
  if (q.toBehavior && facts.toBehavior !== q.toBehavior) return false;
  if (q.conditionMin !== undefined && (facts.conditionPct === null || facts.conditionPct < q.conditionMin)) return false;
  if (q.conditionMax !== undefined && (facts.conditionPct === null || facts.conditionPct > q.conditionMax)) return false;
  if (q.pointsMin !== undefined && facts.targetPoints < q.pointsMin) return false;
  if (q.pointsMax !== undefined && facts.targetPoints > q.pointsMax) return false;
  if (q.priceMin !== undefined && facts.priceCredits < q.priceMin) return false;
  if (q.priceMax !== undefined && facts.priceCredits > q.priceMax) return false;
  if (q.canTake && !facts.canTake) return false;
  return true;
}

function comparator(
  sort: ServiceBoardSort,
): (a: ServiceBoardBrowseFacts, b: ServiceBoardBrowseFacts) => number {
  const byNewest = (a: ServiceBoardBrowseFacts, b: ServiceBoardBrowseFacts) =>
    b.createdAtMs - a.createdAtMs;
  switch (sort) {
    case 'pay_desc':
      return (a, b) => b.priceCredits - a.priceCredits || byNewest(a, b);
    case 'pay_asc':
      return (a, b) => a.priceCredits - b.priceCredits || byNewest(a, b);
    case 'condition':
      return (a, b) =>
        (a.conditionKey ?? Number.POSITIVE_INFINITY) - (b.conditionKey ?? Number.POSITIVE_INFINITY)
        || byNewest(a, b);
    case 'expiring':
      return (a, b) =>
        (a.expiresAtMs ?? Number.POSITIVE_INFINITY) - (b.expiresAtMs ?? Number.POSITIVE_INFINITY)
        || byNewest(a, b);
    case 'newest':
    default:
      return byNewest;
  }
}

/**
 * Filter + sort + paginate the open postings. Rows carry their lane
 * view plus the derived facts; returns the page plus the FULL match
 * count (the Buy lane's `{ rows, total }` shape).
 */
export function applyServiceBoardQuery<T extends { facts: ServiceBoardBrowseFacts }>(
  rows: readonly T[],
  query: ServiceBoardQuery,
): { rows: T[]; total: number } {
  const filtered = rows.filter((row) => matches(row.facts, query));
  const cmp = comparator(query.sort ?? 'newest');
  const sorted = [...filtered].sort((a, b) => cmp(a.facts, b.facts));
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  return { rows: sorted.slice(offset, offset + limit), total: filtered.length };
}

/**
 * Whether ANY browse filter is set (the open list is being narrowed,
 * as opposed to the default board fetch). The default fetch keeps
 * the historic order (oldest posting first) and returns every open
 * job; a filtered fetch is a real query — newest-first pages of the
 * Buy lane's size. The builders use this to decide whether the
 * pagination fold applies at all.
 */
export function hasServiceBoardFilters(query: ServiceBoardQuery | undefined): boolean {
  if (!query) return false;
  return hasServiceBoardBrowseTerms(query)
    || query.limit !== undefined
    || query.offset !== undefined;
}

/**
 * Whether the query carries any actual browse terms (a search,
 * filter, requirements-met flag, or an explicit sort) — as opposed
 * to pagination alone or the caller's status filter. Clients use
 * this to decide whether they are browsing (paged fetches) or
 * reading the plain board.
 */
export function hasServiceBoardBrowseTerms(query: ServiceBoardQuery | undefined): boolean {
  if (!query) return false;
  return Boolean(
    query.search || query.rarity || query.vehicleClass || query.fromBehavior
    || query.toBehavior || query.conditionMin !== undefined || query.conditionMax !== undefined
    || query.pointsMin !== undefined || query.pointsMax !== undefined
    || query.priceMin !== undefined || query.priceMax !== undefined
    || query.canTake || query.sort,
  );
}

/** The caller's own lists under a status filter (statuses vary only
 *  there). No filter → the list passes through untouched. */
export function filterServiceBoardStatus<T extends { status: string }>(
  rows: readonly T[],
  query: ServiceBoardQuery | undefined,
): T[] {
  if (!query?.status || query.status.length === 0) return [...rows];
  const wanted = new Set(query.status);
  return rows.filter((row) => wanted.has(row.status));
}
