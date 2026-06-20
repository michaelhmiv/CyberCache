/**
 * Loadout presets — save/load named loadout configurations.
 *
 * Players can save up to MAX_PRESETS (5) presets. Each preset captures
 * all 7 gear slots and 3 consumable assignments. Presets are persisted
 * via the runtime snapshot (Supabase).
 *
 * Design constraints:
 *   - Presets are client-only (no server validation needed — they're
 *     just slot assignments, not item generation).
 *   - Loading a preset applies it directly to the active loadout.
 *   - Overwriting a preset replaces all fields.
 *   - Item IDs are validated on load — if an item no longer exists in
 *     inventory, the slot is left empty with a console warning.
 */
import { create } from 'zustand';
import type { LoadoutSlot, LoadoutConsumables } from './loadoutSlice';
import { useLoadoutStore } from './loadoutSlice';
import { useInventoryStore } from './inventorySlice';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import { isItemCompatibleWithSlot } from '@/lib/loadout/loadoutSlotCompat';

export interface LoadoutPreset {
  id: string;
  name: string;
  slots: Record<LoadoutSlot, string | null>;
  consumables: LoadoutConsumables;
  createdAt: number;
  updatedAt: number;
}

export interface LoadoutPresetsState {
  presets: LoadoutPreset[];
  activePresetId: string | null;
  presetLoadError: string | null;
  /** Save the current loadout as a new preset. Returns the new preset's id, or null if at max. */
  savePreset: (name: string) => string | null;
  /** Delete a preset by id. */
  deletePreset: (id: string) => void;
  /** Rename a preset. */
  renamePreset: (id: string, name: string) => void;
  /** Load a preset into the active loadout. Marks it as active. */
  loadPreset: (id: string) => Promise<void>;
  /** Overwrite an existing preset with the current loadout state. */
  overwritePreset: (id: string) => void;
  /** Return all presets sorted by updatedAt descending. */
  getPresets: () => LoadoutPreset[];
  /** Check if the current loadout matches a saved preset. Returns the preset id or null. */
  findMatchingPreset: () => string | null;
  /** Clear the preset load error. */
  clearPresetError: () => void;
}

const MAX_PRESETS = 5;

let _idCounter = 1;
function nextId(): string {
  return `preset_${Date.now()}_${_idCounter++}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeSlug(name: string): string {
  return name.trim().slice(0, 32) || 'Untitled';
}

export const useLoadoutPresetsStore = create<LoadoutPresetsState>()((set, get) => ({
  presets: [],
  activePresetId: null,
  presetLoadError: null,

  savePreset: (name) => {
    const state = get();
    if (state.presets.length >= MAX_PRESETS) return null;

    const loadout = useLoadoutStore.getState();
    const preset: LoadoutPreset = {
      id: nextId(),
      name: makeSlug(name),
      slots: { ...loadout.slots },
      consumables: { ...loadout.consumables },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    set({
      presets: [...state.presets, preset].sort((a, b) => b.updatedAt - a.updatedAt),
      activePresetId: preset.id,
    });

    return preset.id;
  },

  deletePreset: (id) => {
    set((s) => ({
      presets: s.presets.filter((p) => p.id !== id),
      activePresetId: s.activePresetId === id ? null : s.activePresetId,
    }));
  },

  renamePreset: (id, name) => {
    set((s) => ({
      presets: s.presets.map((p) =>
        p.id === id ? { ...p, name: makeSlug(name), updatedAt: Date.now() } : p,
      ),
    }));
  },

  loadPreset: async (id) => {
    const preset = get().presets.find((p) => p.id === id);
    if (!preset) return;

    const loadout = useLoadoutStore.getState();
    const inventory = useInventoryStore.getState();

    // Equip each slot through the server — the server handles deduplication
    // and returns the canonical state via syncVerifiedResult.
    const equipPromises: Promise<void>[] = [];
    const failedSlots: string[] = [];
    for (const [slot, itemId] of Object.entries(preset.slots) as [LoadoutSlot, string | null][]) {
      const item = itemId ? inventory.getById(itemId) : undefined;
      if (item && isItemCompatibleWithSlot(item, slot)) {
        equipPromises.push(
          verifiedOps.equipItem(itemId!, slot).catch((err) => {
            console.warn(`[loadoutPresets] Failed to equip ${itemId} to ${slot}:`, err instanceof Error ? err.message : err);
            failedSlots.push(slot);
          }),
        );
      } else if (itemId) {
        console.warn(`[loadoutPresets] Item ${itemId} (slot ${slot}) missing or incompatible — skipping.`);
        failedSlots.push(slot);
      }
    }
    await Promise.all(equipPromises);

    // Surface partial failures to the UI instead of silently swallowing.
    if (failedSlots.length > 0) {
      set({ presetLoadError: `Failed to equip ${failedSlots.length} item(s): ${failedSlots.join(', ')}` });
    } else {
      set({ presetLoadError: null });
    }

    // Consumable slots are local-display-only (not server-verified).
    // The store's setConsumableSlot has a dedup guard, but we call them
    // sequentially and each call sees the result of the previous one —
    // so we sanitize the preset's consumables first to avoid stale
    // duplicates in the preset data itself.
    const sanitized: LoadoutConsumables = { PreFight: null, MidFight: null, Emergency: null };
    const presetSlots: Array<keyof LoadoutConsumables> = ['PreFight', 'MidFight', 'Emergency'];
    for (const ps of presetSlots) {
      const val = preset.consumables[ps];
      if (val && !Object.values(sanitized).includes(val)) {
        sanitized[ps] = val;
      }
    }
    loadout.setConsumableSlot('PreFight', sanitized.PreFight);
    loadout.setConsumableSlot('MidFight', sanitized.MidFight);
    loadout.setConsumableSlot('Emergency', sanitized.Emergency);

    set({ activePresetId: id });
  },

  overwritePreset: (id) => {
    const loadout = useLoadoutStore.getState();
    set((s) => ({
      presets: s.presets.map((p) =>
        p.id === id
          ? { ...p, slots: { ...loadout.slots }, consumables: { ...loadout.consumables }, updatedAt: Date.now() }
          : p,
      ),
    }));
  },

  getPresets: () => get().presets,

  findMatchingPreset: () => {
    const loadout = useLoadoutStore.getState();
    const currentSlots = JSON.stringify(loadout.slots);
    const currentConsumables = JSON.stringify(loadout.consumables);

    for (const preset of get().presets) {
      if (
        JSON.stringify(preset.slots) === currentSlots &&
        JSON.stringify(preset.consumables) === currentConsumables
      ) {
        return preset.id;
      }
    }
    return null;
  },

  clearPresetError: () => set({ presetLoadError: null }),
}));
