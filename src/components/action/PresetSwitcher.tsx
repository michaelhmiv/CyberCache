/**
 * PresetSwitcher — horizontal scroll of saved loadout presets.
 *
 * Shows saved presets as tappable chips. Active preset is highlighted.
 * "Save" button appears when under the limit. A visible "Manage"
 * button opens the preset list with Apply / Rename / Overwrite /
 * Delete controls for every preset (Phase 1: nothing about presets
 * may live ONLY behind the long-press; the long-press remains as a
 * shortcut to the same per-preset sheet).
 */
import React, { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bookmark, Plus, Trash2, Pencil } from 'lucide-react';
import { useLoadoutPresetsStore } from '@/store/slices/loadoutPresetsSlice';

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };
const MAX_PRESETS = 5;

export const PresetSwitcher: React.FC<{ className?: string }> = ({ className }) => {
  const presets = useLoadoutPresetsStore((s) => s.presets);
  const activeId = useLoadoutPresetsStore((s) => s.activePresetId);
  const savePreset = useLoadoutPresetsStore((s) => s.savePreset);
  const loadPreset = useLoadoutPresetsStore((s) => s.loadPreset);
  const deletePreset = useLoadoutPresetsStore((s) => s.deletePreset);
  const renamePreset = useLoadoutPresetsStore((s) => s.renamePreset);
  const overwritePreset = useLoadoutPresetsStore((s) => s.overwritePreset);
  const findMatching = useLoadoutPresetsStore((s) => s.findMatchingPreset);

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
