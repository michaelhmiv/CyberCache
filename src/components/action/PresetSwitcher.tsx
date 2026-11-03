/**
 * PresetSwitcher — horizontal scroll of saved loadout presets.
 *
 * Shows saved presets as tappable chips. Active preset is highlighted.
 * "Save" button appears when under the limit. A visible "Manage"
 * button opens the preset list with Apply / Rename / Overwrite /
 * Delete controls for every preset (Phase 1: nothing about presets
 * may live ONLY behind the long-press; the long-press remains as a
 * shortcut to the same per-preset sheet).
 *
 * Applying a build is one server operation (SB-1, cc_apply_build):
 * the report under the chips states the truth — a clean apply gets a
 * one-line confirmation; a partial apply lists every slot that did
 * not land, why, and its remedy (delist & equip, recall, pick a
 * replacement — every "no" carries its remedy, DESIGN.md).
 */
import React, { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bookmark, Plus, Trash2, Pencil } from 'lucide-react';
import {
  useLoadoutPresetsStore,
  type ApplyBuildReport,
  type BuildSlotOutcome,
} from '@/store/slices/loadoutPresetsSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useVehicleStore } from '@/store/slices/vehicleSlice';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };
const MAX_PRESETS = 5;

const SLOT_LABELS: Record<LoadoutSlot, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  heavy: 'Heavy',
  ordnance: 'Ordnance',
  shield: 'Shield',
  classMod: 'Mod',
  relic: 'Relic',
  vehicle: 'Vehicle',
};

function formatReturnTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'soon';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** The per-slot outcome sheet rendered after an apply (SB-1). */
const ApplyReport: React.FC<{
  report: ApplyBuildReport;
  onPickReplacement?: (slot: LoadoutSlot) => void;
}> = ({ report, onPickReplacement }) => {
  const dismissApplyReport = useLoadoutPresetsStore((s) => s.dismissApplyReport);
  const delistAndReapply = useLoadoutPresetsStore((s) => s.delistAndReapply);
  const recallAndReapply = useLoadoutPresetsStore((s) => s.recallAndReapply);
  const inventoryItems = useInventoryStore((s) => s.items);
  const vehicleItems = useVehicleStore((s) => s.vehicles);

  const itemName = (outcome: BuildSlotOutcome): string => {
    if (!outcome.itemId) return SLOT_LABELS[outcome.slot];
    const found =
      inventoryItems.find((i) => i.id === outcome.itemId) ??
      vehicleItems.find((i) => i.id === outcome.itemId);
    return found?.name ?? SLOT_LABELS[outcome.slot];
  };

  if (report.applied) {
    return (
      <div
        data-testid="apply-report"
        className="mt-2 flex items-center gap-2 border-2 border-border bg-surface px-2 py-2"
      >
        <span className="flex-1 text-[11px] font-bold text-text-primary">
          {report.presetName} applied — every slot equipped.
        </span>
        <button
          type="button"
          onClick={dismissApplyReport}
          className="bl-secondary shrink-0 px-2 py-1 text-[11px] font-black"
        >
          Done
        </button>
      </div>
    );
  }

  const attention = report.outcomes.filter((o) => o.outcome !== 'equipped' && o.outcome !== 'empty');
  return (
    <div data-testid="apply-report" className="mt-2 border-2 border-amber/50 bg-surface px-2 py-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11px] font-black text-text-primary">
          {report.presetName} partially applied — {attention.length}{' '}
          {attention.length === 1 ? 'slot needs' : 'slots need'} attention. The rest equipped fine.
        </span>
        <button
          type="button"
          onClick={dismissApplyReport}
          className="bl-secondary shrink-0 px-2 py-1 text-[11px] font-black"
        >
          Dismiss
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {attention.map((outcome) => (
          <div key={outcome.slot} className="flex items-center gap-2 border border-border bg-bg/60 px-2 py-1.5">
            <span className="min-w-0 flex-1 text-[11px] font-bold text-text-primary">
              <span className="uppercase tracking-wide text-text-muted">{SLOT_LABELS[outcome.slot]}</span>
              {' — '}
              {itemName(outcome)}:{' '}
              {outcome.outcome === 'gone' && 'that item is gone (sold, salvaged, or traded away).'}
              {outcome.outcome === 'listed' && 'that item is listed on the market.'}
              {outcome.outcome === 'in_service' &&
                `that item is out on dispatch — back ${outcome.returnsAt ? formatReturnTime(outcome.returnsAt) : 'when the mission ends'}.`}
              {outcome.outcome === 'locked' &&
                `that item is committed to a ${outcome.jobKind === 'shield_tech' ? 'shield-tech' : 'repair'} job — it frees up when the job finishes.`}
              {outcome.outcome === 'incompatible' && 'that item no longer fits this slot.'}
            </span>
            {outcome.outcome === 'listed' && outcome.listingId && (
              <button
                type="button"
                onClick={() => void delistAndReapply(report.presetId, outcome.listingId as string)}
                className="bl-primary shrink-0 px-2 py-1 text-[11px] font-black"
              >
                Delist &amp; equip
              </button>
            )}
            {outcome.outcome === 'in_service' && outcome.missionId && (
              <button
                type="button"
                onClick={() => void recallAndReapply(report.presetId, outcome.missionId as string)}
                className="bl-primary shrink-0 px-2 py-1 text-[11px] font-black"
              >
                Recall mission
              </button>
            )}
            {(outcome.outcome === 'gone' || outcome.outcome === 'incompatible') && onPickReplacement && (
              <button
                type="button"
                onClick={() => onPickReplacement(outcome.slot)}
                className="bl-primary shrink-0 px-2 py-1 text-[11px] font-black"
              >
                Pick a replacement
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export const PresetSwitcher: React.FC<{
  className?: string;
  /** Opens the loadout slot picker for a slot (the gone/incompatible remedy). */
  onPickReplacement?: (slot: LoadoutSlot) => void;
}> = ({ className, onPickReplacement }) => {
  const presets = useLoadoutPresetsStore((s) => s.presets);
  const activeId = useLoadoutPresetsStore((s) => s.activePresetId);
  const savePreset = useLoadoutPresetsStore((s) => s.savePreset);
  const loadPreset = useLoadoutPresetsStore((s) => s.loadPreset);
  const deletePreset = useLoadoutPresetsStore((s) => s.deletePreset);
  const renamePreset = useLoadoutPresetsStore((s) => s.renamePreset);
  const overwritePreset = useLoadoutPresetsStore((s) => s.overwritePreset);
  const findMatching = useLoadoutPresetsStore((s) => s.findMatchingPreset);
  const lastApplyReport = useLoadoutPresetsStore((s) => s.lastApplyReport);
  const presetLoadError = useLoadoutPresetsStore((s) => s.presetLoadError);
  const clearPresetError = useLoadoutPresetsStore((s) => s.clearPresetError);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [rowRenameId, setRowRenameId] = useState<string | null>(null);
  const [rowRenameName, setRowRenameName] = useState('');
  const [manageId, setManageId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');

  const matchedId = findMatching();
  const atMax = presets.length >= MAX_PRESETS;

  const handleSave = useCallback(() => {
    const name = saveName.trim() || `Loadout ${presets.length + 1}`;
    savePreset(name);
    setSaveName('');
    setSaveOpen(false);
  }, [saveName, presets.length, savePreset]);

  const handleRename = useCallback(() => {
    if (manageId && renameName.trim()) {
      renamePreset(manageId, renameName.trim());
      setRenameName('');
      setRenameOpen(false);
      setManageId(null);
    }
  }, [manageId, renameName, renamePreset]);

  const handleOverwrite = useCallback(() => {
    if (manageId) {
      overwritePreset(manageId);
    }
  }, [manageId, overwritePreset]);

  const handleDelete = useCallback(() => {
    if (manageId) {
      deletePreset(manageId);
      setManageId(null);
    }
  }, [manageId, deletePreset]);

  if (presets.length === 0 && !saveOpen) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setSaveOpen(true)}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-text-muted hover:text-amber transition-colors"
        >
          <Bookmark size={12} />
          <span>Save Loadout</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`${className ?? ''}`}>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {/* Existing presets */}
        {presets.map((preset) => {
          const isActive = preset.id === activeId;
          const isMatched = preset.id === matchedId && !isActive;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => loadPreset(preset.id)}
              onContextMenu={(e) => { e.preventDefault(); setManageId(preset.id); }}
              className={`shrink-0 flex items-center gap-1 border-2 px-2 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
                isActive
                  ? 'border-amber bg-amber/15 text-amber'
                  : isMatched
                    ? 'border-amber/30 bg-amber/5 text-text-primary'
                    : 'border-border bg-bg/70 text-text-muted hover:border-amber/40'
              }`}
              style={signClip}
            >
              <Bookmark size={10} className={isActive ? 'text-amber' : 'text-text-muted'} />
              <span className="truncate max-w-[80px]">{preset.name}</span>
            </button>
          );
        })}

        {/* Save button */}
        {!atMax && (
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            className="shrink-0 flex items-center gap-1 border-2 border-dashed border-border bg-bg/40 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-text-muted hover:border-amber/40 hover:text-amber transition-colors"
            style={signClip}
          >
            <Plus size={10} />
            <span>Save</span>
          </button>
        )}

        {/* Visible preset management — the non-long-press path */}
        {presets.length > 0 && (
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className="shrink-0 flex items-center gap-1 border-2 border-border bg-bg/40 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-text-muted hover:border-amber/40 hover:text-amber transition-colors"
            style={signClip}
            data-testid="preset-manage-button"
          >
            <Pencil size={10} />
            <span>Manage</span>
          </button>
        )}
      </div>

      {/* Apply failure (the op itself failed — nothing was applied) */}
      {presetLoadError && (
        <div
          data-testid="apply-error"
          className="mt-2 flex items-center gap-2 border-2 border-red/40 bg-surface px-2 py-2"
        >
          <span className="flex-1 text-[11px] font-bold text-text-primary">
            That build could not be applied — {presetLoadError} Your current gear is unchanged; try again.
          </span>
          <button
            type="button"
            onClick={clearPresetError}
            className="bl-secondary shrink-0 px-2 py-1 text-[11px] font-black"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* The apply outcome report (SB-1): clean confirmation or the
          per-slot sheet with remedies. */}
      {lastApplyReport && (
        <ApplyReport report={lastApplyReport} onPickReplacement={onPickReplacement} />
      )}

      {/* Save name input */}
      <AnimatePresence>
        {saveOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Loadout name…"
                maxLength={32}
                className="bl-input flex-1 px-2 py-1 text-[11px]"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaveOpen(false); }}
              />
              <button type="button" onClick={handleSave} className="bl-primary px-2 py-1 text-[10px] font-black">Save</button>
              <button type="button" onClick={() => setSaveOpen(false)} className="bl-secondary px-2 py-1 text-[10px]">Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preset list sheet — visible list/apply/rename/delete controls */}
      <AnimatePresence>
        {listOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => { setListOpen(false); setRowRenameId(null); }}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="w-full max-w-xs border-2 border-border bg-bg p-4"
              style={signClip}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-black text-text-primary mb-3">Loadout Presets</div>
              <div className="space-y-2">
                {presets.map((preset) => {
                  const isActive = preset.id === activeId;
                  const renaming = rowRenameId === preset.id;
                  return (
                    <div key={preset.id} className="border-2 border-border bg-surface p-2">
                      {renaming ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={rowRenameName}
                            onChange={(e) => setRowRenameName(e.target.value)}
                            className="bl-input flex-1 px-2 py-1 text-[11px]"
                            autoFocus
                            maxLength={32}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && rowRenameName.trim()) {
                                renamePreset(preset.id, rowRenameName.trim());
                                setRowRenameId(null);
                              }
                              if (e.key === 'Escape') setRowRenameId(null);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (rowRenameName.trim()) renamePreset(preset.id, rowRenameName.trim());
                              setRowRenameId(null);
                            }}
                            className="bl-primary px-2 py-1 text-[10px]"
                          >
                            OK
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <Bookmark size={12} className={isActive ? 'text-amber' : 'text-text-muted'} />
                            <span className="min-w-0 flex-1 truncate text-xs font-black text-text-primary">{preset.name}</span>
                            {isActive && <span className="text-[8px] font-black uppercase tracking-wider text-amber">Active</span>}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => { loadPreset(preset.id); setListOpen(false); }}
                              className="bl-primary px-2 py-1 text-[9px] font-black"
                            >
                              Apply
                            </button>
                            <button
                              type="button"
                              onClick={() => { setRowRenameId(preset.id); setRowRenameName(preset.name); }}
                              className="bl-secondary px-2 py-1 text-[9px] font-black"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => overwritePreset(preset.id)}
                              className="bl-secondary px-2 py-1 text-[9px] font-black text-amber"
                            >
                              Overwrite
                            </button>
                            <button
                              type="button"
                              onClick={() => deletePreset(preset.id)}
                              className="flex items-center gap-1 border border-red/30 bg-red/5 px-2 py-1 text-[9px] font-black text-red"
                            >
                              <Trash2 size={10} /> Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => { setListOpen(false); setRowRenameId(null); }}
                className="bl-secondary w-full mt-3 py-2 text-[10px] font-black"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manage sheet (rename / overwrite / delete) — long-press shortcut */}
      <AnimatePresence>
        {manageId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setManageId(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="w-full max-w-xs border-2 border-border bg-bg p-4"
              style={signClip}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-black text-text-primary mb-3">Manage Preset</div>

              <button
                type="button"
                onClick={handleOverwrite}
                className="w-full flex items-center gap-2 border-2 border-border bg-surface p-2 text-left text-xs font-black text-amber mb-1"
                style={signClip}
              >
                <Bookmark size={14} /> Overwrite with current loadout
              </button>

              <button
                type="button"
                onClick={() => { setRenameOpen(true); setRenameName(presets.find((p) => p.id === manageId)?.name ?? ''); }}
                className="w-full flex items-center gap-2 border-2 border-border bg-surface p-2 text-left text-xs font-black text-text-primary mb-1"
                style={signClip}
              >
                <Pencil size={14} /> Rename
              </button>

              {renameOpen && (
                <div className="flex items-center gap-2 mb-1 p-2 border border-border bg-bg/70">
                  <input
                    type="text"
                    value={renameName}
                    onChange={(e) => setRenameName(e.target.value)}
                    className="bl-input flex-1 px-2 py-1 text-[11px]"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
                  />
                  <button type="button" onClick={handleRename} className="bl-primary px-2 py-1 text-[10px]">OK</button>
                </div>
              )}

              <button
                type="button"
                onClick={handleDelete}
                className="w-full flex items-center gap-2 border-2 border-red/30 bg-red/5 p-2 text-left text-xs font-black text-red mt-2"
                style={signClip}
              >
                <Trash2 size={14} /> Delete preset
              </button>

              <button
                type="button"
                onClick={() => setManageId(null)}
                className="bl-secondary w-full mt-2 py-2 text-[10px] font-black"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
