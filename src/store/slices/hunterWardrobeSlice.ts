/**
 * The whole-skin wardrobe selection (Cache Hunters reshape,
 * slice (b)) — which painted whole each hunter currently wears.
 *
 * Device-local presentation state, the same shape as the head
 * variant preference ('cc-head-variant'): skins are pure cosmetic,
 * so the worn choice needs no server record at this slice. Slice
 * (d)'s crafted skins will carry server ownership; wearing stays
 * this selection.
 *
 * A hunter is never unpainted: the default (and the fallback for
 * any unreadable stored value) is the hunter's base skin worn.
 * Remove takes the selection off — the hunter's look then falls
 * back to the base painting — it never unwears the hunter.
 */
import { create } from 'zustand';
import { HUNTER_IDS, isHunterId, type HunterId } from '@/lib/hunters/hunters';
import { baseSkinForHunter, skinById } from '@/lib/hunters/hunterSkins';

const STORAGE_KEY = 'cc-hunter-wardrobe';

export type WornSkinMap = Record<HunterId, string | null>;

export function defaultWornSkins(): WornSkinMap {
  return {
    vesper: baseSkinForHunter('vesper').id,
    silas: baseSkinForHunter('silas').id,
    josie: baseSkinForHunter('josie').id,
    doc: baseSkinForHunter('doc').id,
  };
}

function loadWornSkins(): WornSkinMap {
  const worn = defaultWornSkins();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return worn;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const id of HUNTER_IDS) {
      const value = parsed[id];
      if (value === null) {
        worn[id] = null;
      } else if (typeof value === 'string') {
        const skin = skinById(value);
        // A stored id that is not this hunter's skin is not a
        // selection — the default stands.
        if (skin && skin.hunterId === id) worn[id] = skin.id;
      }
    }
    return worn;
  } catch {
    return worn;
  }
}

function persistWornSkins(worn: WornSkinMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(worn));
  } catch {
    // Storage full/blocked: the selection still holds for the session.
  }
}

export interface HunterWardrobeState {
  wornByHunter: WornSkinMap;
  wearSkin: (hunterId: HunterId, skinId: string) => void;
  removeSkin: (hunterId: HunterId) => void;
}

export const useHunterWardrobeStore = create<HunterWardrobeState>()((set, get) => ({
  wornByHunter: loadWornSkins(),

  wearSkin: (hunterId, skinId) => {
    const skin = skinById(skinId);
    if (!skin || skin.hunterId !== hunterId) return;
    const wornByHunter = { ...get().wornByHunter, [hunterId]: skin.id };
    persistWornSkins(wornByHunter);
    set({ wornByHunter });
  },

  removeSkin: (hunterId) => {
    if (!isHunterId(hunterId)) return;
    const wornByHunter = { ...get().wornByHunter, [hunterId]: null };
    persistWornSkins(wornByHunter);
    set({ wornByHunter });
  },
}));

/**
 * The painting a hunter is seen in: the worn skin's painting, or
 * the base skin's when nothing is selected. Never undefined for a
 * real hunter — a hunter is never unpainted.
 */
export function wornSkinSpriteId(wornByHunter: WornSkinMap, hunterId: HunterId): string {
  const worn = skinById(wornByHunter[hunterId]);
  if (worn && worn.hunterId === hunterId) return worn.spriteId;
  return baseSkinForHunter(hunterId).spriteId;
}
