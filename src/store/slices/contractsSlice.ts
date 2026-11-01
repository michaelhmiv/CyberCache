/**
 * Contracts Panel Slice (dashboard-top slice, 2026-11-01)
 *
 * Session-scoped holder for the Chef's contracts board view
 * (0042), shared by the two consumers the Dashboard top redesign
 * created:
 *
 *  - the Dashboard contracts ICON (mounts with the Dashboard) —
 *    its mount performs the board read that issues both sets
 *    server-side and drives the icon's claimable badge/animation;
 *  - the ContractsPanel itself (inside the pop-up) — renders
 *    this state and writes claim/reroll results back through
 *    `applyResult`, so the icon's badge updates the moment a
 *    claim lands, without a refetch.
 *
 * One load per session: `load()` fetches only from 'idle' or
 * 'error' (an unreachable Chef retries on a later mount, like
 * the panel's old mount-effect did). Progress accrues from
 * server records between reads; the board re-reads on the next
 * session/account, and claim/reroll responses always carry the
 * fresh board. Reset by AuthProvider on every user change.
 */

import { create } from 'zustand';
import { getContractsState, type ChefContractsResult } from '@/lib/chef/chefClient';
import type { PanelLoadState } from './loginStreakSlice';

export interface ContractsPanelState {
  result: ChefContractsResult | null;
  loadState: PanelLoadState;
  /** Fetch the board once per session (issues the sets server-side). */
  load: () => Promise<void>;
  /** Replace the held board (claim/reroll responses carry it). */
  applyResult: (result: ChefContractsResult) => void;
  reset: () => void;
}

let inFlight: Promise<void> | null = null;

export const useContractsStore = create<ContractsPanelState>()((set, get) => ({
  result: null,
  loadState: 'idle',
  load: () => {
    const { loadState } = get();
    if (loadState === 'loading') return inFlight ?? Promise.resolve();
    if (loadState === 'ready') return Promise.resolve();
    set({ loadState: 'loading' });
    inFlight = getContractsState()
      .then((next) => {
        set({ result: next, loadState: 'ready' });
      })
      .catch(() => {
        // Chef unreachable: the panel stays hidden and the icon
        // stays neutral; a later mount retries from 'error'.
        set({ loadState: 'error' });
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
  applyResult: (result) => set({ result, loadState: 'ready' }),
  reset: () => {
    inFlight = null;
    set({ result: null, loadState: 'idle' });
  },
}));

/** Contracts complete and still claimable, across both sets —
 *  the count the Dashboard icon badges. The panel's own claim
 *  buttons remain the only claim path; this is a display fold
 *  over the Chef's state view, never progress math. */
export function countClaimableContracts(result: ChefContractsResult | null): number {
  if (!result) return 0;
  const board = result.contracts;
  return [...board.daily.contracts, ...board.weekly.contracts].filter(
    (contract) => contract.complete && contract.status === 'active',
  ).length;
}
