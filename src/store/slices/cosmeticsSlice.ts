/**
 * Cosmetics slice (skins slice, 0053).
 *
 * Session-scoped holder for the Chef's cosmetics state view: the
 * selection record (equipped part item per slot + the head-variant
 * pick), the owned part items, and the wearable head variants.
 * Every hunter render resolves through this state (lookResolution)
 * — stages never read selection state on their own.
 *
 * One load per session from 'idle'/'error'; ops replace the held
 * view with the op result's fresh view. The one-time migration of
 * the device-local head pick ('cc-head-variant', pre-0053 storage)
 * rides the first load: when the account has NO server selection
 * record yet and a valid local pick exists, it is posted once —
 * after that the server record is the only source.
 *
 * Reset by AuthProvider on every user change, like the other
 * session-scoped stores.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import {
  equipCosmetic,
  getCosmeticsState,
  newCosmeticEquipNonce,
  newCosmeticHeadVariantNonce,
  newCosmeticUnequipNonce,
  setCosmeticHeadVariant,
  unequipCosmetic,
} from '@/lib/chef/chefClient';
import type { CosmeticSlot, CosmeticsStateView } from '@/content/skins';
import { headVariantPreference, isHunterHeadVariantId } from '@/lib/pixel/headParts';
import { resolveOwnLook, type ResolvedLook } from '@/lib/pixel/lookResolution';

export type CosmeticsLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface CosmeticsState {
  view: CosmeticsStateView | null;
  loadState: CosmeticsLoadState;
  load: () => Promise<void>;
  /** Unconditional refetch (after ops that change ownership
   *  outside this store — market listing/buying a part). */
  refresh: () => Promise<void>;
  applyView: (view: CosmeticsStateView) => void;
  equip: (itemId: string) => Promise<void>;
  unequip: (slot: CosmeticSlot) => Promise<void>;
  setHeadVariant: (variant: string) => Promise<void>;
  reset: () => void;
}

let inFlight: Promise<void> | null = null;
let localPickMigrated = false;

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
      .then(async (result) => {
        set({ view: result.cosmetics, loadState: 'ready' });
        // One-time device-local head-pick migration (see header).
        if (!localPickMigrated && !result.cosmetics.selectionExists) {
          localPickMigrated = true;
          const local = headVariantPreference();
          if (
            isHunterHeadVariantId(local) &&
            local !== result.cosmetics.selection.headVariant &&
            result.cosmetics.wearableVariantIds.includes(local)
          ) {
            try {
              await get().setHeadVariant(local);
            } catch {
              // The server record stays authoritative either way;
              // a refused migration simply leaves the default.
            }
          }
        }
      })
      .catch(() => {
        // Chef unreachable: renders fall back to the stock look
        // (the pre-0053 behavior) and a later mount retries.
        set({ loadState: 'error' });
      });
    return inFlight;
  },
  refresh: async () => {
    try {
      const result = await getCosmeticsState();
      set({ view: result.cosmetics, loadState: 'ready' });
    } catch {
      // Keep the held view; a later load retries.
    }
  },
  applyView: (view) => set({ view, loadState: 'ready' }),
  equip: async (itemId) => {
    const result = await equipCosmetic({ nonce: newCosmeticEquipNonce(), itemId });
    set({ view: result.result.cosmetics, loadState: 'ready' });
  },
  unequip: async (slot) => {
    const result = await unequipCosmetic({ nonce: newCosmeticUnequipNonce(), slot });
    set({ view: result.result.cosmetics, loadState: 'ready' });
  },
  setHeadVariant: async (variant) => {
    const result = await setCosmeticHeadVariant({
      nonce: newCosmeticHeadVariantNonce(),
      variant,
    });
    set({ view: result.result.cosmetics, loadState: 'ready' });
  },
  reset: () => {
    inFlight = null;
    localPickMigrated = false;
    set({ view: null, loadState: 'idle' });
  },
}));

let lookCache: { view: CosmeticsStateView | null; fallback: string; look: ResolvedLook } | null = null;

/** The local player's resolved look (parts set + per-part
 *  palettes) from the held cosmetics view — the stock Standard
 *  Issue look until the view lands or when nothing is worn.
 *  Memoized on the view's identity: as a zustand selector this
 *  MUST return a stable reference between store changes, or
 *  React's snapshot check reads a fresh object as a perpetual
 *  change and loops the render. */
export function selectOwnLook(state: CosmeticsState): ResolvedLook {
  const view = state.view;
  const fallback = headVariantPreference();
  if (lookCache && lookCache.view === view && lookCache.fallback === fallback) {
    return lookCache.look;
  }
  const partsById = new Map((view?.parts ?? []).map((p) => [p.id, p]));
  const look = resolveOwnLook({
    selection: view?.selection ?? null,
    partsById,
    fallbackHeadVariant: fallback,
  });
  lookCache = { view, fallback, look };
  return look;
}

/** Hook form of selectOwnLook for stage components. */
export function useOwnLook(): ResolvedLook {
  return useCosmeticsStore(selectOwnLook);
}

/** useOwnLook + the once-per-session state load, for stage
 *  components that render the hunter without a Wardrobe nearby. */
export function useOwnLookWithLoad(): ResolvedLook {
  const look = useOwnLook();
  const load = useCosmeticsStore((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  return look;
}
