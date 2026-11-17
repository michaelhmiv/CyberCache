/**
 * Cosmetics slice (skins slice, 0053).
 *
 * Session-scoped holder for the Chef's cosmetics state view: the
 * selection record (equipped part item per slot + the head-variant
 * pick), the owned part items, and the wearable head variants.
 *
 * READ-ONLY since the 2026-11-17 retirements (device-pass Batch 4):
 * the equip/unequip/head-variant write path is gone — no surface
 * wears parts anymore (the hunters are paintings; the Wardrobe
 * wears whole skins device-locally), so this store only loads and
 * holds the view. The held view still feeds the whole-skin
 * ownership mirror (hunterSkins.isSkinOwned) and the market's
 * worn-part marker. The old device-local head pick
 * ('cc-head-variant') is retired with the picker that wrote it:
 * nothing reads or pushes it.
 *
 * One load per session from 'idle'/'error'.
 *
 * Reset by AuthProvider on every user change, like the other
 * session-scoped stores.
 */
import { create } from 'zustand';
import { getCosmeticsState } from '@/lib/chef/chefClient';
import type { CosmeticsStateView } from '@/content/skins';
import { setOwnedSkinIds } from '@/lib/hunters/hunterSkins';

export type CosmeticsLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface CosmeticsState {
  view: CosmeticsStateView | null;
  loadState: CosmeticsLoadState;
  load: () => Promise<void>;
  /** Unconditional refetch (after ops that change ownership
   *  outside this store — market listing/buying a part). */
  refresh: () => Promise<void>;
  applyView: (view: CosmeticsStateView) => void;
  reset: () => void;
}

let inFlight: Promise<void> | null = null;

/** Every held view also mirrors its whole-skin ownership into the
 *  Wardrobe's seam (reshape slice (d)): the cosmetics view is the
 *  server record, hunterSkins.isSkinOwned reads the mirror. */
function holdView(view: CosmeticsStateView): Partial<CosmeticsState> {
  setOwnedSkinIds((view.skins ?? []).map((skin) => skin.skinId));
  return { view, loadState: 'ready' };
}

export const useCosmeticsStore = create<CosmeticsState>()((set, get) => ({
  view: null,
  loadState: 'idle',
  load: () => {
    const { loadState } = get();
    if (loadState === 'loading') return inFlight ?? Promise.resolve();
    if (loadState === 'ready') return Promise.resolve();
    set({ loadState: 'loading' });
    // Deferred a microtask so a transport that throws synchronously
    // (or is absent under a test double) lands in the error state
    // instead of throwing through the caller's effect.
    inFlight = Promise.resolve()
      .then(() => getCosmeticsState())
      .then((result) => {
        set(holdView(result.cosmetics));
      })
      .catch(() => {
        // Chef unreachable: the held view stays empty (the
        // ownership mirror reads it as owning nothing) and a
        // later mount retries.
        set({ loadState: 'error' });
      });
    return inFlight;
  },
  refresh: async () => {
    try {
      const result = await getCosmeticsState();
      set(holdView(result.cosmetics));
    } catch {
      // Keep the held view; a later load retries.
    }
  },
  applyView: (view) => set(holdView(view)),
  reset: () => {
    inFlight = null;
    setOwnedSkinIds([]);
    set({ view: null, loadState: 'idle' });
  },
}));
