import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PackageOpen, TimerReset } from 'lucide-react';
import { CONSUMABLES, type ConsumableVisual } from '@/constants/consumables';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { getLoadoutConsumableCoverage } from '@/lib/buffs/loadoutCoverage';

const SLOT_LABELS: Record<keyof LoadoutConsumables, string> = {
  PreFight: 'Pre-Fight',
  MidFight: 'Mid-Fight',
  Emergency: 'Emergency',
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
  onClose: () => void;
}> = ({ consumables, onClose }) => {
  const now = Date.now();
  const buffs = useActiveBuffsStore((state) => state.buffs);
  const activeRows = buffs.filter((buff) => buff.expiresAt > now && buff.displayState !== 'armed');
  const coverageRows = getLoadoutConsumableCoverage(consumables);
  const formatRemaining = (expiresAt: number) => {
    const remaining = Math.max(0, expiresAt - now);
    if (remaining >= 60_000) return `${Math.ceil(remaining / 60_000)}m`;
    return `${Math.ceil(remaining / 1000)}s`;
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
              <div className="bl-title text-3xl leading-none text-text-primary">Consumable Ledger</div>
              <div className="mt-1 text-[10px] text-text-muted">
                What you have loaded. Effects apply on trigger (Pre-Fight on encounter start, Mid-Fight on ammo interval, Emergency on HP/shield threshold).
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
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-border bg-bg/80 text-lg">{def?.visual.glyph ?? <TimerReset size={18} />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">{buff.displayState === 'recent' ? 'Recently Triggered' : 'Active Effect'}</div>
                    <div className="truncate text-sm font-black text-text-primary">{def?.name ?? buff.consumableId}</div>
                    <div className="truncate text-[9px] text-text-muted">{buff.displayState === 'recent' ? 'instant feedback window' : `${formatRemaining(buff.expiresAt)} remaining`}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mb-3 border-2 border-cyan/40 bg-cyan/10 p-2 text-[10px] font-bold text-cyan" style={{ clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' }}>
            Armed coverage: {coverageRows.length > 0 ? coverageRows.map((row) => row.decisionHint).join(' ') : 'No consumables loaded.'}
          </div>
          <div className="space-y-2">
            {SLOT_ORDER.map((slot) => {
              const id = consumables[slot];
              const def = id ? CONSUMABLES[id] : null;
              const tone = def
                ? (accentClass[def.visual.accent] ?? 'text-text-primary border-border bg-bg/80')
                : 'text-text-muted border-border bg-bg/60';
              return (
                <div
                  key={slot}
                  data-testid="consumable-ledger-row"
                  data-slot={slot}
                  className={`relative flex items-center gap-3 border-2 p-2 ${tone}`}
                  style={panelClip}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-border bg-bg/80 text-lg">
                    {def ? (
                      <span aria-hidden="true">{def.visual.glyph}</span>
                    ) : (
                      <PackageOpen size={18} className="text-text-muted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">
                      {SLOT_LABELS[slot]}
                    </div>
                    {def ? (
                      <>
                        <div className="truncate text-sm font-black text-text-primary">{def.name}</div>
                        <div className="truncate text-[9px] text-text-muted">{def.runtime.ledgerText}</div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-black text-text-muted">Empty</div>
                        <div className="truncate text-[9px] text-text-muted">
                          Tap to load — open Inventory or Cache to slot a consumable here.
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
