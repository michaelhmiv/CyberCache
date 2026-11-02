import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight } from 'lucide-react';
import { CONSUMABLES, type ConsumableVisual } from '@/constants/consumables';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';
import { useLoadoutStore } from '@/store';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { getLoadoutConsumableCoverage } from '@/lib/buffs/loadoutCoverage';

const SLOT_LABELS: Record<keyof LoadoutConsumables, string> = {
  PreFight: 'Slot 1',
  MidFight: 'Slot 2',
  Emergency: 'Slot 3',
};

const SLOT_ORDER: Array<keyof LoadoutConsumables> = ['PreFight', 'MidFight', 'Emergency'];

// Mirrors the accent color vocabulary in ConsumableRing.tsx (which uses hex)
// but maps to Tailwind classes for the modal rows. The fallback catches
// a runtime accent that isn't enumerated here — a new accent in the
// ConsumableVisual union will fail to compile until this map is updated,
// which is the correct behavior.
const accentClass: Record<ConsumableVisual['accent'], string> = {
  green: 'text-green border-green/50 bg-green/10',
  red: 'text-red border-red/55 bg-red/10',
  orange: 'text-orange border-orange/55 bg-orange/10',
  cyan: 'text-cyan border-cyan/45 bg-cyan/10',
  amber: 'text-amber border-amber/55 bg-amber/10',
  purple: 'text-purple border-purple/50 bg-purple/10',
  blue: 'text-blue border-blue/45 bg-blue/10',
};

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };

export const ConsumableLedger: React.FC<{
  consumables: LoadoutConsumables;
  inventory: Record<string, number>;
  focusedSlot?: keyof LoadoutConsumables | null;
  onClose: () => void;
}> = ({ consumables, inventory, focusedSlot, onClose }) => {
  const [now] = React.useState(Date.now);
  const [pickingSlot, setPickingSlot] = useState<keyof LoadoutConsumables | null>(null);
  const loadout = useLoadoutStore();
  const buffs = useActiveBuffsStore((state) => state.buffs);
  const activeRows = buffs.filter((buff) => buff.expiresAt > now && buff.displayState !== 'armed');
  const coverageRows = getLoadoutConsumableCoverage(consumables);
  const formatRemaining = (expiresAt: number) => {
    const remaining = Math.max(0, expiresAt - now);
    if (remaining >= 60_000) return `${Math.ceil(remaining / 60_000)}m`;
    return `${Math.ceil(remaining / 1000)}s`;
  };

  // Build the picker list: all consumables the player owns, sorted by family then name.
  const ownedConsumables = useMemo(() => {
    return Object.values(CONSUMABLES)
      .filter((def) => (inventory[def.id] ?? 0) > 0)
      .sort((a, b) => {
        if (a.family !== b.family) return a.family.localeCompare(b.family);
        return a.name.localeCompare(b.name);
      });
  }, [inventory]);

  const handlePick = (slot: keyof LoadoutConsumables, consumableId: string | null) => {
    loadout.setConsumableSlot(slot, consumableId);
    setPickingSlot(null);
  };

  // ── Focused single-slot mode ──
  const isFocused = !!focusedSlot;
  const focusedSlotKey = (focusedSlot ?? null) as keyof LoadoutConsumables | null;

  // Resolve the focused slot's current consumable
  const focusedId = focusedSlotKey ? consumables[focusedSlotKey] : null;
  const focusedDef = focusedId ? CONSUMABLES[focusedId] : null;

  const accentToHex: Record<string, string> = {
    green: '#7CFC00', red: '#FF4B5C', orange: '#FF9000', cyan: '#00E5FF',
    amber: '#FFB300', purple: '#B66BFF', blue: '#5AA7FF',
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[85] flex items-end justify-center bg-black/80"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="max-h-[80vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-4 shadow-[0_-12px_32px_rgba(0,0,0,0.7)]"
          style={panelClip}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">Combat Pharmacy</div>
              <div className="bl-title text-3xl leading-none text-text-primary">
                {isFocused ? `Slot ${SLOT_ORDER.indexOf(focusedSlotKey!) + 1}` : 'Consumable Ledger'}
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                {isFocused
                  ? (focusedDef
                      ? `${focusedDef.name} · ${focusedDef.tacticalRole}`
                      : 'Choose a consumable to arm this slot.')
                  : 'What you have loaded. Each consumable fires automatically when its trigger condition is met.'}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close consumable ledger"
              onClick={onClose}
              className="bl-secondary shrink-0 p-2 text-text-muted"
            >
              <X size={15} />
            </button>
          </div>

          {/* Active / Recent section — only in full ledger view */}
          {!isFocused && (
            <div className="mb-3 space-y-2" data-testid="active-consumable-section">
              <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.2em] text-amber">
                <span>Active / Recent</span>
                <span>{activeRows.length} live</span>
              </div>
              {activeRows.length === 0 ? (
                <div className="border-2 border-border bg-bg/70 p-2 text-[10px] text-text-muted" style={panelClip}>No active consumable effect has fired yet. Loaded slots below show what is armed.</div>
              ) : activeRows.map((buff) => {
                const def = CONSUMABLES[buff.consumableId];
                const tone = def ? (accentClass[def.visual.accent] ?? 'text-text-primary border-border bg-bg/80') : 'text-text-muted border-border bg-bg/60';
                return (
                  <div key={buff.id} data-testid="active-consumable-row" data-state={buff.displayState} className={`relative flex items-center gap-3 border-2 p-2 ${tone}`} style={panelClip}>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-border bg-bg/80"><PxIcon name={def?.visual.icon ?? 'clock'} size={17} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">{buff.displayState === 'recent' ? 'Recently Triggered' : 'Active Effect'}</div>
                      <div className="truncate text-sm font-black text-text-primary">{def?.name ?? buff.consumableId}</div>
                      <div className="truncate text-[9px] text-text-muted">{buff.displayState === 'recent' ? 'instant feedback window' : `${formatRemaining(buff.expiresAt)} remaining`}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Coverage banner — only in full view */}
          {!isFocused && (
            <div className="mb-3 border-2 border-cyan/40 bg-cyan/10 p-2 text-[10px] font-bold text-cyan" style={{ clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' }}>
              Armed coverage: {coverageRows.length > 0 ? coverageRows.map((row) => row.decisionHint).join(' ') : 'No consumables loaded.'}
            </div>
          )}

          {/* ── Focused single-slot page ── */}
          {isFocused && focusedSlotKey ? (
            <div className="space-y-3">
              {/* Current loadout preview */}
              <div className="border-2 border-border bg-bg/70 p-3" style={panelClip}>
                {focusedDef ? (
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center border-2 border-border bg-bg/80 text-2xl" style={{ color: accentToHex[focusedDef.visual.accent] ?? '#888' }}>
                      <PxIcon name={focusedDef.visual.icon} size={26} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black text-text-primary">{focusedDef.name}</div>
                      <div className="truncate text-[9px] text-text-muted">{focusedDef.tacticalRole} · {focusedDef.trigger}</div>
                      <div className="mt-0.5 text-[8px] font-black uppercase text-amber">
                        ×{(inventory[focusedId ?? ''] ?? 0)} in stock
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="text-sm font-black text-text-muted">Empty slot</div>
                    <div className="truncate text-[9px] text-text-muted">Choose a consumable below.</div>
                  </div>
                )}
              </div>

              {/* Picker list */}
              <div data-testid={`slot-picker-${focusedSlotKey}`} className="border-2 border-border bg-bg/80 p-2" style={panelClip}>
                <div className="mb-1 px-1 py-0.5 text-[8px] font-black uppercase tracking-wider text-text-muted">
                  {focusedDef ? 'Swap or clear' : 'Choose a consumable'}
                </div>
                <div className="max-h-[280px] overflow-y-auto space-y-0.5">
                  {ownedConsumables.length === 0 && (
                    <div className="px-2 py-2 text-[10px] text-text-muted">No consumables in inventory. Visit the Vendor or craft some.</div>
                  )}
                  {ownedConsumables.map((c) => {
                    const owned = inventory[c.id] ?? 0;
                    const isEquippedHere = focusedId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handlePick(focusedSlotKey, c.id)}
                        className={`flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-amber/10 ${isEquippedHere ? 'bg-amber/10' : ''}`}
                      >
                        <PxIcon name={c.visual.icon} size={13} style={{ color: accentToHex[c.visual.accent] ?? '#888' }} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-black text-text-primary">{c.name}</div>
                          <div className="truncate text-[8px] text-text-muted">{c.tacticalRole}</div>
                        </div>
                        <span className="shrink-0 text-[9px] font-black text-amber">×{owned}</span>
                      </button>
                    );
                  })}
                </div>
                {focusedDef && (
                  <button
                    type="button"
                    onClick={() => handlePick(focusedSlotKey, null)}
                    className="w-full px-2 py-1.5 text-left text-[10px] font-black uppercase text-red hover:bg-red/10"
                  >
                    Clear slot
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* ── Full ledger: all 3 slots ── */
            <div className="space-y-2">
              {SLOT_ORDER.map((slot) => {
                const id = consumables[slot];
                const def = id ? CONSUMABLES[id] : null;
                const tone = def
                  ? (accentClass[def.visual.accent] ?? 'text-text-primary border-border bg-bg/80')
                  : 'text-text-muted border-border bg-bg/60';
                const isPicking = pickingSlot === slot;
                return (
                  <div key={slot}>
                    <button
                      type="button"
                      data-testid="consumable-ledger-row"
                      data-slot={slot}
                      onClick={() => setPickingSlot(isPicking ? null : slot)}
                      className={`relative flex w-full items-center gap-3 border-2 p-2 ${tone} ${isPicking ? 'ring-1 ring-amber' : ''} transition-transform active:scale-[0.98]`}
                      style={panelClip}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-border bg-bg/80 text-lg">
                        {def ? (
                          <PxIcon name={def.visual.icon} size={17} />
                        ) : (
                          <span className="font-black text-text-muted" style={{ fontSize: '18px' }}>+</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">
                          {SLOT_LABELS[slot]}
                        </div>
                        {def ? (
                          <>
                            <div className="truncate text-sm font-black text-text-primary">{def.name}</div>
                            <div className="truncate text-[9px] text-text-muted">{def.tacticalRole} · {def.trigger}</div>
                            <div className="mt-0.5 text-[8px] font-black uppercase text-amber">
                              {(inventory[id ?? ''] ?? 0)} in stock
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-black text-text-muted">Empty</div>
                            <div className="truncate text-[9px] text-text-muted">
                              Tap to assign a consumable
                            </div>
                          </>
                        )}
                      </div>
                      <ChevronRight size={14} className={`shrink-0 text-text-muted transition-transform ${isPicking ? 'rotate-90' : ''}`} />
                    </button>
                    {isPicking && (
                      <div data-testid={`slot-picker-${slot}`} className="mt-1 space-y-1 border-2 border-border bg-bg/80 p-1.5" style={panelClip}>
                        <div className="px-1 py-0.5 text-[8px] font-black uppercase tracking-wider text-text-muted">
                          {def ? 'Swap or clear' : 'Choose a consumable'}
                        </div>
                        <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                          {ownedConsumables.length === 0 && (
                            <div className="px-2 py-1.5 text-[10px] text-text-muted">No consumables in inventory. Visit the Vendor or craft some.</div>
                          )}
                          {ownedConsumables.map((c) => {
                            const owned = inventory[c.id] ?? 0;
                            const isEquippedHere = id === c.id;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => handlePick(slot, c.id)}
                                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-amber/10 ${isEquippedHere ? 'bg-amber/10' : ''}`}
                              >
                                <PxIcon name={c.visual.icon} size={13} style={{ color: accentClass[c.visual.accent]?.split(' ')[0].replace('text-', '') ?? '#888' }} />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[11px] font-black text-text-primary">{c.name}</div>
                                  <div className="truncate text-[8px] text-text-muted">{c.tacticalRole}</div>
                                </div>
                                <span className="shrink-0 text-[9px] font-black text-amber">×{owned}</span>
                              </button>
                            );
                          })}
                        </div>
                        {def && (
                          <button
                            type="button"
                            onClick={() => handlePick(slot, null)}
                            className="w-full px-2 py-1.5 text-left text-[10px] font-black uppercase text-red hover:bg-red/10"
                          >
                            Clear slot
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
