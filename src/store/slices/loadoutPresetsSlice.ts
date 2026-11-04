/**
 * Saved builds (loadout presets) — save/load named loadout
 * configurations.
 *
 * Players can save up to MAX_PRESETS (5) builds. Each build captures
 * all 8 loadout slots (7 gear + vehicle) and the 3 belt consumable
 * assignments. Builds are persisted via the runtime snapshot.
 *
 * APPLY IS ONE SERVER OPERATION (SB-1, migration 0066): loadPreset
 * sends the build's full slot map to cc_apply_build, which equips
 * what it can — the vehicle included, resolved from server item
 * records — and returns a per-slot outcome for every slot it could
 * not apply (gone / listed / in_service / locked / incompatible),
 * each carrying the data its remedy needs. The old client-side
 * fan-out of per-slot equip calls is gone: it silently dropped the
 * vehicle (vehicles never enter the gear inventory store), swallowed
 * missing items into a console.warn while their slot's occupant
 * stayed equipped, and marked the build active over half-swapped
 * sets.
 *
 * Marker law: activePresetId moves ONLY when the server reports a
 * clean full apply (applied: true). A partial apply leaves the
 * previous marker untouched and surfaces the outcome report instead.
 * The belt (client display state) applies only after the server op
 * returns, so a failed apply never leaves belt and gear from
 * different builds.
 */
import { create } from 'zustand';
import type { LoadoutSlot, LoadoutConsumables } from './loadoutSlice';
import { useLoadoutStore } from './loadoutSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { recallDispatch } from '@/lib/chef/chefClient';

export interface LoadoutPreset {
  id: string;
  name: string;
  slots: Record<LoadoutSlot, string | null>;
  consumables: LoadoutConsumables;
  createdAt: number;
  updatedAt: number;
}

export type BuildSlotOutcomeKind =
  | 'equipped'
  | 'empty'
  | 'gone'
  | 'listed'
  | 'in_service'
  | 'locked'
  | 'incompatible';

/** One slot's apply outcome, as reported by cc_apply_build (0066). */
export interface BuildSlotOutcome {
  slot: LoadoutSlot;
  itemId: string | null;
  outcome: BuildSlotOutcomeKind;
  /** For 'listed': the player's active listing for the item (delist remedy). */
  listingId: string | null;
  /** For 'in_service': the dispatch mission holding the item (recall remedy). */
  missionId: string | null;
  /** For 'in_service': when the mission returns the item (ISO string). */
  returnsAt: string | null;
  /** For 'locked': the repair / shield-tech board job holding the item. */
  jobId: string | null;
  /** For 'locked': the job's profession ('repair' | 'shield_tech'). */
  jobKind: string | null;
}

/** The last apply's full report — the switcher renders it as the outcome sheet. */
export interface ApplyBuildReport {
  presetId: string;
  presetName: string;
  /** True only on a clean full apply — the only case that moves the marker. */
  applied: boolean;
  outcomes: BuildSlotOutcome[];
}

export interface LoadoutPresetsState {
  presets: LoadoutPreset[];
  activePresetId: string | null;
  presetLoadError: string | null;
  lastApplyReport: ApplyBuildReport | null;
  /** Save the current loadout as a new preset. Returns the new preset's id, or null if at max. */
  savePreset: (name: string) => string | null;
  /** Delete a preset by id. */
  deletePreset: (id: string) => void;
  /** Rename a preset. */
  renamePreset: (id: string, name: string) => void;
  /** Load a preset into the active loadout via cc_apply_build. Marks it active only on a clean full apply. */
  loadPreset: (id: string) => Promise<void>;
  /** Remedy for a 'listed' outcome: cancel the listing, then re-apply the build. */
  delistAndReapply: (presetId: string, listingId: string) => Promise<void>;
  /** Remedy for an 'in_service' outcome: recall the mission, then re-apply the build. */
  recallAndReapply: (presetId: string, missionId: string) => Promise<void>;
  /** Overwrite an existing preset with the current loadout state. */
  overwritePreset: (id: string) => void;
  /** Return all presets sorted by updatedAt descending. */
  getPresets: () => LoadoutPreset[];
  /** Check if the current loadout matches a saved preset. Returns the preset id or null. */
  findMatchingPreset: () => string | null;
  /** Clear the preset load error. */
  clearPresetError: () => void;
  /** Dismiss the apply outcome report. */
  dismissApplyReport: () => void;
}

const MAX_PRESETS = 5;

const SLOT_ORDER: LoadoutSlot[] = [
  'primary', 'secondary', 'heavy', 'ordnance', 'shield', 'classMod', 'relic', 'vehicle',
];

const OUTCOME_KINDS: readonly string[] = [
  'equipped', 'empty', 'gone', 'listed', 'in_service', 'locked', 'incompatible',
];

let _idCounter = 1;
function nextId(): string {
  return `preset_${Date.now()}_${_idCounter++}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeSlug(name: string): string {
  return name.trim().slice(0, 32) || 'Untitled';
}

const strOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** Parse the cc_apply_build wire outcomes into the typed client shape. */
function parseOutcomes(result: Record<string, unknown>, preset: LoadoutPreset): BuildSlotOutcome[] {
  const raw = Array.isArray(result.outcomes) ? result.outcomes : [];
  const bySlot = new Map<LoadoutSlot, BuildSlotOutcome>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const slot = SLOT_ORDER.find((s) => s === row.slot);
    if (!slot || typeof row.outcome !== 'string' || !OUTCOME_KINDS.includes(row.outcome)) continue;
    bySlot.set(slot, {
      slot,
      itemId: strOrNull(row.item_id) ?? preset.slots[slot],
      outcome: row.outcome as BuildSlotOutcomeKind,
      listingId: strOrNull(row.listing_id),
      missionId: strOrNull(row.mission_id),
      returnsAt: strOrNull(row.returns_at),
      jobId: strOrNull(row.job_id),
      jobKind: strOrNull(row.job_kind),
    });
  }
  // Any slot the server did not report (defensive — the op reports
  // all 8) reads as equipped when it names an item, empty when not.
  return SLOT_ORDER.map(
    (slot) =>
      bySlot.get(slot) ?? {
        slot,
        itemId: preset.slots[slot],
        outcome: preset.slots[slot] ? 'equipped' : 'empty',
        listingId: null,
        missionId: null,
        returnsAt: null,
        jobId: null,
        jobKind: null,
      },
  );
}

export const useLoadoutPresetsStore = create<LoadoutPresetsState>()((set, get) => ({
  presets: [],
  activePresetId: null,
  presetLoadError: null,
  lastApplyReport: null,

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
      lastApplyReport: s.lastApplyReport?.presetId === id ? null : s.lastApplyReport,
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

    let result: Record<string, unknown>;
    try {
      result = await verifiedOps.applyBuild({ ...preset.slots });
    } catch (err) {
      // The op itself failed (transport/auth): nothing was applied,
      // the belt stays with the previous build, and the marker does
      // not move. The error renders in the switcher with its remedy.
      set({
        presetLoadError: err instanceof Error ? err.message : 'That build could not be applied.',
        lastApplyReport: null,
      });
      return;
    }

    const applied = result.applied === true;
    const outcomes = parseOutcomes(result, preset);

    // The belt is client display state, applied only after the
    // server op returns (brief D3) — sanitize duplicates the way the
    // old path did (sequential sets, each seeing the previous one).
    const loadout = useLoadoutStore.getState();
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

    set({
      presetLoadError: null,
      lastApplyReport: { presetId: id, presetName: preset.name, applied, outcomes },
      // Marker law (defect 3): the active marker moves ONLY on a
      // clean full apply. A partial apply leaves the previous
      // marker untouched — the header never claims a build that
      // isn't fully worn.
      ...(applied ? { activePresetId: id } : {}),
    });
  },

  delistAndReapply: async (presetId, listingId) => {
    try {
      await verifiedOps.marketCancel(listingId);
    } catch (err) {
      set({
        presetLoadError: err instanceof Error ? err.message : 'That listing could not be cancelled.',
      });
      return;
    }
    await get().loadPreset(presetId);
  },

  recallAndReapply: async (presetId, missionId) => {
    try {
      await recallDispatch({
        nonce: `recall:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        missionId,
      });
    } catch (err) {
      set({
        presetLoadError: err instanceof Error ? err.message : 'That mission could not be recalled.',
      });
      return;
    }
    await get().loadPreset(presetId);
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

  dismissApplyReport: () => set({ lastApplyReport: null }),
}));
