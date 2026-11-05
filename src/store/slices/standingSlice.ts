/**
 * Manufacturer Standing Slice (redesign Wave C — Home claimables,
 * 2026-11-01)
 *
 * Session-scoped holder for the Chef's standing state view
 * (0043), shared by the three Home surfaces the redesign gives
 * the weekly Parts Crate + Signature Orders (DESIGN.md §3/§4/§9):
 *
 *  - the claim CHIP under Home's Strip (DashboardTopBar) — its
 *    mount performs the state read that drives the chip's
 *    claimable count, the same not-behind-the-tap pattern the
 *    streak/contracts icons use;
 *  - the Weekly claimables PANEL in Home's deck — renders this
 *    state and claims through it;
 *  - the claim sheet the chip opens — the same panel, same store.
 *
 * The Rep Desk (Market → Rep Desk) keeps its own panel-local
 * state: it is the canonical home of the desk, and its reads are
 * fresh on every mount. This mirror exists only so Home's
 * claimables announce and settle without a second fetch — claim
 * responses carry the fresh standing view and are written back
 * through `applyView`, so the chip and the panel update the
 * moment a claim lands.
 *
 * One load per session: `load()` fetches only from 'idle' or
 * 'error' (an unreachable Chef retries on a later mount, like
 * the contracts board). Reset by AuthProvider on user change.
 */

import { create } from 'zustand';
import {
  getStandingState,
  newStandingBuyNonce,
  newStandingOrderNonce,
  standingBuy,
  standingOrder,
} from '@/lib/chef/chefClient';
import { syncVerifiedResult } from '@/lib/api/verifiedStateSync';
import { withArticle } from '@/lib/utils/articles';
import type {
  StandingManufacturerView,
  StandingStateView,
} from '@/content/manufacturerStanding';
import type { PanelLoadState } from './loginStreakSlice';

export interface WeeklyClaimable {
  manufacturer: StandingManufacturerView['manufacturer'];
  makerName: string;
  color: string;
  kind: 'crate' | 'order';
  /** The desk's own offer key for crate buys (the wire value). */
  offerKey: string | null;
  priceCredits: number;
  /** Player-facing contents line (crate contents / order terms). */
  detail: string;
}

/**
 * The weekly offers a player can act on right now, folded from
 * the Chef's state view — display only, never progress math.
 * A crate counts when the desk says it is available (rank met,
 * week open) and not yet bought; an order when the lane is
 * enabled, available, and not yet ordered this week.
 */
export function weeklyClaimables(view: StandingStateView | null): WeeklyClaimable[] {
  if (!view) return [];
  const out: WeeklyClaimable[] = [];
  for (const m of view.manufacturers) {
    if (m.crate.available && !m.crate.boughtThisWeek) {
      const contents = Object.entries({ ...m.crate.materials, ...m.crate.essences })
        .map(([k, v]) => `${k} ×${v}`)
        .join(', ');
      out.push({
        manufacturer: m.manufacturer,
        makerName: m.name,
        color: m.color,
        kind: 'crate',
        offerKey: m.crate.offerKey,
        priceCredits: m.crate.priceCredits,
        detail: contents ? `Parts Crate — ${contents} · weekly` : 'Parts Crate · weekly',
      });
    }
    if (m.order.enabled && m.order.available && !m.order.orderedThisWeek) {
      out.push({
        manufacturer: m.manufacturer,
        makerName: m.name,
        color: m.color,
        kind: 'order',
        offerKey: null,
        priceCredits: m.order.priceCredits,
        detail: `Signature Order — ${withArticle(m.name)} weapon at your level, Rare–Epic · weekly`,
      });
    }
  }
  return out;
}

export interface StandingPanelState {
  view: StandingStateView | null;
  loadState: PanelLoadState;
  /** Offer key (`crate:<maker>` / `order:<maker>`) mid-claim. */
  busyKey: string | null;
  flash: { text: string; error: boolean } | null;
  /** Fetch the standing view once per session. */
  load: () => Promise<void>;
  /** Replace the held view (claim responses carry it). */
  applyView: (view: StandingStateView) => void;
  /** Claim one weekly offer through the Rep Desk's real ops. */
  claim: (claimable: WeeklyClaimable) => Promise<void>;
  reset: () => void;
}

let inFlight: Promise<void> | null = null;

export const useStandingStore = create<StandingPanelState>()((set, get) => ({
  view: null,
  loadState: 'idle',
  busyKey: null,
  flash: null,
  load: () => {
    const { loadState } = get();
    if (loadState === 'loading') return inFlight ?? Promise.resolve();
    if (loadState === 'ready') return Promise.resolve();
    set({ loadState: 'loading' });
    inFlight = getStandingState()
      .then((result) => {
        set({ view: result.standing, loadState: 'ready' });
      })
      .catch(() => {
        // Chef unreachable: the chip stays absent and the panel
        // stays hidden; a later mount retries from 'error'.
        set({ loadState: 'error' });
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
  applyView: (view) => set({ view, loadState: 'ready' }),
  claim: async (claimable) => {
    const key = `${claimable.kind}:${claimable.manufacturer}`;
    if (get().busyKey) return;
    set({ busyKey: key, flash: null });
    try {
      const result =
        claimable.kind === 'crate'
          ? await standingBuy({
              nonce: newStandingBuyNonce(),
              offerKey: claimable.offerKey ?? '',
              quantity: 1,
            })
          : await standingOrder({
              nonce: newStandingOrderNonce(),
              manufacturer: claimable.manufacturer,
            });
      if (result.standing) get().applyView(result.standing);
      else {
        // The op landed but carried no fresh view — re-read so
        // the chip/panel stop offering a spent claim.
        set({ loadState: 'idle' });
        await get().load();
      }
      syncVerifiedResult(result as unknown as Record<string, unknown>);
      set({
        flash: {
          text:
            claimable.kind === 'crate'
              ? `${claimable.makerName} Parts Crate claimed for ${claimable.priceCredits.toLocaleString()}cr.`
              : `Signature Order placed — ${claimable.priceCredits.toLocaleString()}cr. Your weapon is in your inventory.`,
          error: false,
        },
      });
    } catch (err) {
      set({
        flash: {
          text: err instanceof Error ? err.message : 'Rep Desk op failed',
          error: true,
        },
      });
    } finally {
      set({ busyKey: null });
    }
  },
  reset: () => {
    inFlight = null;
    set({ view: null, loadState: 'idle', busyKey: null, flash: null });
  },
}));
