/**
 * Workshop store — a MIRROR of the server's craft-job state
 * (crafting-as-occupation, migration 0024), nothing more.
 *
 * The old slice ran the job model on the client: queues with
 * Date.now() timers, client-computed completion counts, half-refund
 * cancels settled locally. That model is gone. Jobs live in
 * craft_jobs on the server; they progress only while `crafting` is
 * the active action; the server settles them from its own timestamps
 * and this store simply holds the last state view the server
 * returned (GET /api/workshop/me) and refreshes it after every op.
 * The client animates progress between reads for display only — it
 * never derives an outcome from a local clock.
 */
import { create } from 'zustand';
import { fetchWorkshopState, verifiedOps } from '@/lib/api/verifiedOps';
import { trackCraftCompletions } from '@/lib/analytics/analytics';
import { useAnnouncementsStore } from './announcementsSlice';
import { humanizeWorkshopError, WORKSHOP_ERROR_FALLBACK } from '@/lib/workshop/errors';

/** One job as the server presents it (craftJobView). */
export interface WorkshopJobView {
  id: string;
  bench: number;
  kind: 'consumable' | 'refine' | 'gear' | 'tool' | 'repair';
  recipeId: string;
  name: string;
  state: 'running' | 'queued' | 'paused' | 'complete' | 'cancelled';
  unitsTotal: number;
  unitsCompleted: number;
  unitDurationMs: number;
  accruedMs: number;
  remainingMs: number;
  xpAwarded: number;
  gearRarity: string | null;
  catalystMaterialId: string | null;
  /**
   * Econ 7: the job's snapshotted escrow (per-job totals). The held
   * line reads this so a running job displays its enqueue-time cost
   * even after a lever move. Absent on older payloads.
   */
  escrowInputs?: Record<string, number>;
  /**
   * Econ 10: this job occupies an extra bench-time lane — it runs
   * only because banked bench time is widening the bench. The card
   * tags it so widened work reads differently at a glance. Absent
   * (false) on older payloads and on the baseline lane.
   */
  extraLane?: boolean;
  outputs: Array<Record<string, unknown>>;
  createdAtMs: number;
  completedAtMs: number | null;
  /** Repair jobs only (0025): the vehicle + kit and points restored. */
  repairItemId: string | null;
  repairKitType: string | null;
  repairPointsRestored: number;
}

export interface WorkshopCompletionView extends Record<string, unknown> {
  jobId: string;
  recipeId: string;
  name: string;
}

export interface WorkshopToolsView {
  owned: Record<string, boolean>;
  fitted: Record<string, string | null>;
  charges: Record<string, number>;
}

/** The state view both server stores return (buildWorkshopStateView). */
export interface WorkshopServerView {
  benches: number;
  tools: WorkshopToolsView;
  jobs: WorkshopJobView[];
  masteries: Record<string, { level: number; xp: number }>;
  activeActionKind: string | null;
  recentCompletions: WorkshopCompletionView[];
  /**
   * Economy brief §4.4: the server's resolved per-recipe Scrap costs
   * (recipeId -> Scrap per unit). Displays resolve through this map
   * so the number shown is the number charged; absent on older
   * payloads, where displays fall back to the content literals.
   */
  recipeScrapCosts?: Record<string, number>;
  /**
   * Econ 10 (brief §8.2/§8.3): the bench-time bank and the envelope
   * it puts in force, resolved server-side (buildWorkshopStateView):
   * the balance and cap in seconds, the per-ad grant, and the
   * running/queue/capacity figures for THIS player's Fixer bonus.
   * Absent on older payloads (the bench strip then renders the
   * baseline from the content constants).
   */
  benchTime?: {
    bankedSeconds: number;
    capSeconds: number;
    grantSeconds: number;
    wideActive: boolean;
    runningLimit: number;
    queueLimit: number;
    capacity: number;
  };
}

export interface WorkshopState {
  /** Last server view; null until the first successful refresh. */
  server: WorkshopServerView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  enqueue: (input: {
    bench: number;
    recipeId: string;
    units: number;
    rarity?: string | null;
    useCatalyst?: boolean;
    useRushTicket?: boolean;
  }) => Promise<boolean>;
  cancel: (jobId: string) => Promise<boolean>;
  /**
   * Bank one attested rewarded ad as +1 hour of bench time
   * (cc_bank_bench_time). The caller shows the ad first (the bench
   * strip owns that flow); this op only attests its completion.
   */
  bankBenchTime: (adUnitId?: string) => Promise<boolean>;
}

function asView(result: Record<string, unknown>): WorkshopServerView {
  return result as unknown as WorkshopServerView;
}

export const useWorkshopStore = create<WorkshopState>()((set, get) => ({
  server: null,
  loading: false,
  error: null,

  refresh: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const view = asView(await fetchWorkshopState());
      set({ server: view, loading: false, error: null });
      // Analytics: this refresh is the one place new server views
      // land, so it is where craft completions are observed.
      trackCraftCompletions(view);
      // Eye-leading (2026-11-04): the same observation feeds the
      // bench-ready announcement — a completion the player isn't
      // looking at becomes a chip in Home's claim row. The
      // announcements store applies the in-view suppression.
      useAnnouncementsStore.getState().observeWorkshop(view);
    } catch (err) {
      // A state READ failure is a load problem, not a refusal: the
      // humanizer's generic fallback would mislabel it, so it maps
      // back to load wording here. Real refusal strings (the ops
      // below) keep their translations.
      const humanized = humanizeWorkshopError(err);
      set({
        loading: false,
        error: humanized === WORKSHOP_ERROR_FALLBACK ? 'Unable to load the Workshop right now — try again in a moment.' : humanized,
      });
    }
  },

  enqueue: async (input) => {
    try {
      await verifiedOps.enqueueCraftJob(input);
      await get().refresh();
      return true;
    } catch (err) {
      set({ error: humanizeWorkshopError(err) });
      return false;
    }
  },

  cancel: async (jobId) => {
    try {
      await verifiedOps.cancelCraftJob(jobId);
      await get().refresh();
      return true;
    } catch (err) {
      set({ error: humanizeWorkshopError(err) });
      return false;
    }
  },

  bankBenchTime: async (adUnitId) => {
    try {
      await verifiedOps.bankBenchTime(adUnitId);
      await get().refresh();
      return true;
    } catch (err) {
      set({ error: humanizeWorkshopError(err) });
      return false;
    }
  },

}));
