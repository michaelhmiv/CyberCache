/**
 * Announcements store — the shared eye-leading mechanism for
 * ORPHAN EVENTS (eye-leading pass, 2026-11-04; DESIGN.md §9):
 * earning moments that have no point-of-action surface of their
 * own. The grammar is the one the streak announcement shipped
 * with — past tense, pulse-until-acknowledged, opens the
 * destination — rehoused here for the events that genuinely are
 * past-tense facts:
 *
 *  1. MARKET SALE PROCEEDS (first citizen). A listing sells
 *     while the seller is anywhere — or away — and until this
 *     slice the proceeds surfaced NOWHERE: no chip, toast, or
 *     badge existed; the only record was Sell → History, which
 *     the seller had to think to open. The signal is a real
 *     server read, not a poll: the unified activity log
 *     (GET /api/activity-log/me, kind=market) carries each sale
 *     with the proceeds the seller was actually credited
 *     (price − fee + any Silver Tongue uplift, proven by the
 *     sale's own accept rows). A persisted watermark remembers
 *     which sales have been seen; sales newer than it announce,
 *     aggregated into one chip ("Sold · +1,250 cr").
 *
 *  2. BENCH-READY (second citizen). A bench job completes while
 *     the player is elsewhere. The workshop store's refresh is
 *     the one place new server views land, and it hands each
 *     view here: a completion is news when the job was seen
 *     active earlier this session, or it completed inside the
 *     freshness window (the same rule the analytics observer
 *     uses, so the two never disagree about what a completion
 *     is). If the bench itself is in view (the Workshop screen
 *     is mounted), the completion already reads there — no chip.
 *
 * Baseline rule (shared with the Strip pulse): the FIRST sales
 * read establishes the watermark silently — opening the app
 * never replays a backlog of old sales as news. Announcements
 * live in this store (not in any screen), so they survive tab
 * switches and present when Home next renders; the claim row
 * shows at most one at a time, Sold before bench-ready (the
 * owner's follow-on order).
 */
import { create } from 'zustand';
import { fetchActivityLog, type ActivityRecord } from '@/lib/api/activityLogService';

export interface SoldAnnouncement {
  /** How many sales the chip aggregates. */
  count: number;
  /** Total credits actually credited across those sales. */
  totalProceeds: number;
  /** The sold item's name when exactly one sale is aggregated. */
  itemName: string | null;
}

export interface BenchAnnouncement {
  /** How many jobs completed in this announcement. */
  count: number;
  /** The most recent completed job's name. */
  latestName: string | null;
}

/** Which announcement the claim row shows (owner order: Sold first). */
export type VisibleAnnouncement = 'sold' | 'bench' | null;

export function visibleAnnouncement(state: {
  sold: SoldAnnouncement | null;
  bench: BenchAnnouncement | null;
}): VisibleAnnouncement {
  if (state.sold) return 'sold';
  if (state.bench) return 'bench';
  return null;
}

/** The credited amount for one sold record: the accept rows'
 *  proven proceeds when present; else price − fee (a sale with
 *  no provable fee credited at its price — the pre-fee era's
 *  shape, and the only honest reading of a missing fee). */
export function soldProceeds(record: ActivityRecord): number {
  const market = record.market;
  if (!market) return 0;
  if (typeof market.proceedsCredits === 'number') return market.proceedsCredits;
  return market.priceCredits - (market.feeCredits ?? 0);
}

interface SalesWatermark {
  /** ISO timestamp of the newest seen sale. */
  at: string;
  /** Record ids of seen sales AT that exact timestamp. */
  ids: string[];
}

const SALES_WATERMARK_KEY = 'cybercache.salesSeen.v1';

function readWatermark(): SalesWatermark | null {
  try {
    const raw = localStorage.getItem(SALES_WATERMARK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SalesWatermark>;
    if (typeof parsed.at !== 'string' || !Array.isArray(parsed.ids)) return null;
    return { at: parsed.at, ids: parsed.ids.filter((i): i is string => typeof i === 'string') };
  } catch {
    return null;
  }
}

function writeWatermark(wm: SalesWatermark): void {
  try {
    localStorage.setItem(SALES_WATERMARK_KEY, JSON.stringify(wm));
  } catch {
    // Storage unavailable (private mode): the session-level
    // announced-id guard below still prevents double-counting;
    // the announcement may simply re-derive next launch.
  }
}

/** Is this sale already covered by the watermark? */
function isSeen(record: ActivityRecord, wm: SalesWatermark): boolean {
  const at = Date.parse(record.at);
  const seenAt = Date.parse(wm.at);
  if (Number.isNaN(at) || Number.isNaN(seenAt)) return false;
  if (at < seenAt) return true;
  if (at > seenAt) return false;
  return wm.ids.includes(record.id);
}

/** Advance a watermark to cover the given (newest-first) sales. */
function coverSales(wm: SalesWatermark | null, sales: ActivityRecord[]): SalesWatermark | null {
  if (sales.length === 0) return wm;
  const newestAt = sales[0].at;
  const ids = new Set<string>();
  for (const sale of sales) {
    if (sale.at === newestAt) ids.add(sale.id);
  }
  if (wm && wm.at === newestAt) {
    for (const id of wm.ids) ids.add(id);
  }
  return { at: newestAt, ids: [...ids] };
}

function isSoldRecord(record: ActivityRecord): boolean {
  return record.kind === 'market' && record.market?.direction === 'sold';
}

/** The freshness window for a bench completion to count as news
 *  on first sight — the analytics observer's rule
 *  (CRAFT_COMPLETION_FRESH_MS), kept identical so the chip and
 *  the metrics never disagree about what a completion is. */
export const BENCH_COMPLETION_FRESH_MS = 10 * 60 * 1000;

export interface WorkshopJobObservation {
  id: string;
  name: string;
  state: 'running' | 'queued' | 'paused' | 'complete' | 'cancelled';
  completedAtMs: number | null;
}

export interface WorkshopCompletionObservation {
  jobId: string;
  name: string;
}

export interface WorkshopViewObservation {
  jobs: readonly WorkshopJobObservation[];
  recentCompletions?: readonly WorkshopCompletionObservation[];
}

interface AnnouncementsState {
  sold: SoldAnnouncement | null;
  bench: BenchAnnouncement | null;
  /** True while the Workshop screen (the bench itself) is mounted. */
  benchInView: boolean;
  setBenchInView: (inView: boolean) => void;
  /** Read the activity log and announce any sales past the watermark. */
  checkSales: () => Promise<void>;
  /** The player has seen the sales (chip tapped, or they opened Sell → History themselves). */
  markSalesSeen: () => Promise<void>;
  acknowledgeSold: () => void;
  acknowledgeBench: () => void;
  /** Observe one workshop server view for completions (called by the workshop store's refresh). */
  observeWorkshop: (view: WorkshopViewObservation, now?: number) => void;
}

// Session bookkeeping (module state, like the analytics
// observer's): which sales already folded into the pending
// announcement, and the bench jobs seen active / already
// reported this session.
const announcedSaleIds = new Set<string>();
const seenActiveJobs = new Set<string>();
const reportedJobs = new Set<string>();
let salesCheckInFlight = false;

/** Test-only: restore pristine module state between suites. */
export function __resetAnnouncementsForTests(): void {
  announcedSaleIds.clear();
  seenActiveJobs.clear();
  reportedJobs.clear();
  salesCheckInFlight = false;
}

export const useAnnouncementsStore = create<AnnouncementsState>()((set, get) => {
  /** Fold a set of fresh sales into the pending announcement. */
  const foldSales = (fresh: ActivityRecord[]) => {
    const pending = get().sold;
    const count = (pending?.count ?? 0) + fresh.length;
    const totalProceeds =
      (pending?.totalProceeds ?? 0) + fresh.reduce((sum, r) => sum + soldProceeds(r), 0);
    for (const r of fresh) announcedSaleIds.add(r.id);
    set({
      sold: {
        count,
        totalProceeds,
        itemName: count === 1 ? (fresh[0]?.item?.name ?? pending?.itemName ?? null) : null,
      },
    });
  };

  return {
    sold: null,
    bench: null,
    benchInView: false,

    setBenchInView: (inView) => set({ benchInView: inView }),

    checkSales: async () => {
      if (salesCheckInFlight) return;
      salesCheckInFlight = true;
      try {
        const page = await fetchActivityLog({ kinds: ['market'], limit: 25 });
        const sales = page.records.filter(isSoldRecord);
        if (sales.length === 0) return;
        const wm = readWatermark();
        if (!wm) {
          // Baseline: the first read ever establishes the
          // watermark silently — no backlog replay.
          const base = coverSales(null, sales);
          if (base) writeWatermark(base);
          return;
        }
        const fresh = sales.filter((r) => !isSeen(r, wm) && !announcedSaleIds.has(r.id));
        if (fresh.length > 0) foldSales(fresh);
      } catch {
        // Announcements never surface their own failures: a
        // failed read simply means no chip this time.
      } finally {
        salesCheckInFlight = false;
      }
    },

    markSalesSeen: async () => {
      // The player opened their own trade record: everything
      // currently on the server's first page is seen by
      // definition. Clear the pending chip and move the
      // watermark past it all.
      try {
        const page = await fetchActivityLog({ kinds: ['market'], limit: 25 });
        const sales = page.records.filter(isSoldRecord);
        const wm = coverSales(readWatermark(), sales);
        if (wm) writeWatermark(wm);
      } catch {
        // If the read fails, just clear the chip — the watermark
        // stays and the next successful check re-derives honestly.
      }
      announcedSaleIds.clear();
      set({ sold: null });
    },

    acknowledgeSold: () => {
      // Acknowledging IS having seen them: clear the chip and
      // advance the watermark past the server's current sales
      // (markSalesSeen re-reads and covers), so acknowledged
      // sales never re-announce on the next check.
      void get().markSalesSeen();
    },

    acknowledgeBench: () => set({ bench: null }),

    observeWorkshop: (view, now = Date.now()) => {
      const freshNames: string[] = [];
      const isFresh = (completedAtMs: number | null) =>
        typeof completedAtMs === 'number' &&
        completedAtMs <= now + 60_000 &&
        now - completedAtMs <= BENCH_COMPLETION_FRESH_MS;

      for (const job of view.jobs) {
        if (job.state !== 'complete') {
          seenActiveJobs.add(job.id);
          continue;
        }
        if (reportedJobs.has(job.id)) continue;
        reportedJobs.add(job.id);
        if (seenActiveJobs.has(job.id) || isFresh(job.completedAtMs)) {
          freshNames.push(job.name);
        }
      }
      for (const completion of view.recentCompletions ?? []) {
        if (reportedJobs.has(completion.jobId)) continue;
        if (!seenActiveJobs.has(completion.jobId)) continue;
        reportedJobs.add(completion.jobId);
        freshNames.push(completion.name);
      }

      if (freshNames.length === 0) return;
      // The bench is on screen: the completion already reads
      // there (jobs list + recent completions). No chip.
      if (get().benchInView) return;
      const pending = get().bench;
      set({
        bench: {
          count: (pending?.count ?? 0) + freshNames.length,
          latestName: freshNames[freshNames.length - 1] ?? pending?.latestName ?? null,
        },
      });
    },
  };
});
