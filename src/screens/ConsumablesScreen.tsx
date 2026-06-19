import React, { useMemo, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { CONSUMABLES, CONSUMABLE_SLOTS } from '@/constants/consumables';
import type { ConsumableDef, ConsumableVisual } from '@/constants/consumables';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';
import { useLoadoutStore, useMarketStore, usePlayerStore } from '@/store';
import { ConsumableInspectSheet } from '@/components/consumables/ConsumableInspectSheet';

const SLOT_LABELS: Record<keyof LoadoutConsumables, string> = {
  PreFight: 'Slot 1',
  MidFight: 'Slot 2',
  Emergency: 'Slot 3',
};

const SLOT_ORDER: Array<keyof LoadoutConsumables> = ['PreFight', 'MidFight', 'Emergency'];

const accentClass: Record<ConsumableVisual['accent'], string> = {
  green: 'text-green border-green/50 bg-green/10',
  red: 'text-red border-red/55 bg-red/10',
  orange: 'text-orange border-orange/55 bg-orange/10',
  cyan: 'text-cyan border-cyan/45 bg-cyan/10',
  amber: 'text-amber border-amber/55 bg-amber/10',
  purple: 'text-purple border-purple/50 bg-purple/10',
  blue: 'text-blue border-blue/45 bg-blue/10',
};

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' } as const;

export const ConsumablesScreen: React.FC<{ onNavigate?: (screen: string) => void }> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const market = useMarketStore();
  const [expandedSlot, setExpandedSlot] = useState<keyof LoadoutConsumables | null>(null);
  const [inspecting, setInspecting] = useState<ConsumableDef | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ownedConsumables = useMemo(() => {
    return Object.values(CONSUMABLES)
      .filter((def) => (player.consumables[def.id] ?? 0) > 0)
      .sort((a, b) => {
        if (a.family !== b.family) return a.family.localeCompare(b.family);
        return a.name.localeCompare(b.name);
      });
  }, [player.consumables]);

  const totalOwned = useMemo(
    () => Object.values(player.consumables).reduce((sum, n) => sum + (n || 0), 0),
    [player.consumables],
  );

  const handlePick = (slot: keyof LoadoutConsumables, consumableId: string | null) => {
    loadout.setConsumableSlot(slot, consumableId);
    if (consumableId) {
      const name = CONSUMABLES[consumableId]?.name ?? consumableId;
      setNotice(`${name} assigned to ${SLOT_LABELS[slot]}.`);
    } else {
      setNotice(`${SLOT_LABELS[slot]} cleared.`);
    }
    setExpandedSlot(null);
  };

  const handleEquipFromInspect = (id: string) => {
    // Find first empty slot, or first slot already holding this consumable.
    let targetSlot = CONSUMABLE_SLOTS.find((s) => !loadout.consumables[s]);
    if (!targetSlot) targetSlot = CONSUMABLE_SLOTS[0];
    loadout.setConsumableSlot(targetSlot, id);
    const name = CONSUMABLES[id]?.name ?? id;
    setNotice(`${name} assigned to ${SLOT_LABELS[targetSlot!]}.`);
    setInspecting(null);
  };

  const openVendor = () => {
    market.setActiveTab('vendor');
    onNavigate?.('market');
  };

  return (
    <div className="space-y-3 p-3 pb-20">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-black text-text-primary">Consumables</div>
          <div className="text-[10px] text-text-muted">Tap a slot to assign, swap, or inspect.</div>
        </div>
        <button type="button" onClick={openVendor} className="rounded-full border border-amber/40 bg-amber/10 px-2 py-1 text-[10px] font-black text-amber">
          <span className="inline-flex items-center gap-1"><span style={{ fontSize: '11px' }}>$</span> Vendor</span>
        </button>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2">
        <div className="text-[10px] text-text-muted">Total owned</div>
        <div className="text-xs font-black text-amber">{totalOwned}</div>
      </div>

      {notice && <div className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-[10px] text-amber">{notice}</div>}

      {/* 3 slots */}
      <div className="space-y-2">
        {SLOT_ORDER.map((slot) => {
          const id = loadout.consumables[slot];
          const def = id ? CONSUMABLES[id] : null;
          const tone = def
            ? (accentClass[def.visual.accent] ?? 'text-text-primary border-border bg-bg/80')
            : 'text-text-muted border-border bg-bg/60';
          const isExpanded = expandedSlot === slot;
          const stockCount = id ? (player.consumables[id] ?? 0) : 0;

          return (
            <div key={slot}>
              <button
                type="button"
                onClick={() => setExpandedSlot(isExpanded ? null : slot)}
                className={`relative flex w-full items-center gap-3 border-2 p-3 ${tone} ${isExpanded ? 'ring-1 ring-amber' : ''} transition-transform active:scale-[0.98]`}
                style={panelClip}
              >
                {/* Slot number badge */}
                <div className="flex h-12 w-12 shrink-0 items-center justify-center border-2 border-border bg-bg/80">
                  {def ? (
                    <span className="text-2xl font-black" aria-hidden="true">{def.visual.glyph}</span>
                  ) : (
                    <span className="text-xl font-black text-text-muted">{SLOT_ORDER.indexOf(slot) + 1}</span>
                  )}
                </div>

                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">
                    {SLOT_LABELS[slot]}
                  </div>
                  {def ? (
                    <>
                      <div className="truncate text-sm font-black text-text-primary">{def.name}</div>
                      <div className="truncate text-[10px] text-text-muted">{def.tacticalRole} · {def.trigger}</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-[9px] font-black text-amber">{stockCount} in stock</span>
                        {CONSUMABLE_SLOTS.some((s) => s !== slot && loadout.consumables[s] === id) && (
                          <span className="text-[8px] font-bold text-text-muted">also in another slot</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-black text-text-muted">Empty</div>
                      <div className="truncate text-[10px] text-text-muted">
                        Tap to assign a consumable
                      </div>
                    </>
                  )}
                </div>
                <ChevronRight size={16} className={`shrink-0 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </button>

              {/* Expanded picker */}
              {isExpanded && (
                <div className="mt-1 space-y-1 border-2 border-border bg-bg/80 p-2" style={panelClip}>
                  {/* If something is loaded, show inspect option */}
                  {def && (
                    <button
                      type="button"
                      onClick={() => setInspecting(def)}
                      className="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-amber/10"
                    >
                      <span className="shrink-0 text-[14px] font-black" style={{ color: def.visual.accent === 'green' ? '#7CFC00' : '#FFB300' }}>{def.visual.glyph}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-black text-text-primary">Inspect {def.name}</div>
                        <div className="text-[8px] text-text-muted">Effects, quality, crafting</div>
                      </div>
                      <ChevronRight size={12} className="text-text-muted" />
                    </button>
                  )}

                  <div className="px-1 py-0.5 text-[8px] font-black uppercase tracking-wider text-text-muted">
                    {def ? 'Swap or clear' : 'Choose a consumable'}
                  </div>

                  <div className="max-h-[280px] space-y-0.5 overflow-y-auto">
                    {ownedConsumables.length === 0 && (
                      <div className="px-2 py-2 text-[10px] text-text-muted">
                        No consumables in inventory. Visit the Vendor or craft some.
                      </div>
                    )}
                    {ownedConsumables.map((c) => {
                      const owned = player.consumables[c.id] ?? 0;
                      const isEquippedHere = id === c.id;
                      const isEquippedElsewhere = CONSUMABLE_SLOTS.some((s) => s !== slot && loadout.consumables[s] === c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handlePick(slot, c.id)}
                          className={`flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-amber/10 ${isEquippedHere ? 'bg-amber/10' : ''}`}
                        >
                          <span className="shrink-0 text-[14px] font-black" style={{ color: `var(--${c.visual.accent})` }}>
                            {c.visual.glyph}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11px] font-black text-text-primary">{c.name}</div>
                            <div className="truncate text-[8px] text-text-muted">{c.tacticalRole}</div>
                          </div>
                          <div className="shrink-0 flex items-center gap-1.5">
                            {isEquippedElsewhere && !isEquippedHere && (
                              <span className="text-[7px] font-bold text-text-muted">in slot</span>
                            )}
                            {isEquippedHere && (
                              <span className="text-[7px] font-black text-green">HERE</span>
                            )}
                            <span className="text-[9px] font-black text-amber">×{owned}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {def && (
                    <button
                      type="button"
                      onClick={() => handlePick(slot, null)}
                      className="w-full px-2 py-2 text-left text-[10px] font-black uppercase text-red hover:bg-red/10"
                    >
                      Clear {SLOT_LABELS[slot]}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {totalOwned === 0 && (
        <div className="py-8 text-center">
          <div className="text-sm text-text-muted">No consumables in inventory.</div>
          <button type="button" onClick={openVendor} className="mt-3 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-xs font-black text-amber">
            Open Vendor
          </button>
        </div>
      )}

      <ConsumableInspectSheet
        consumable={inspecting}
        open={!!inspecting}
        onClose={() => setInspecting(null)}
        onEquip={handleEquipFromInspect}
      />
    </div>
  );
};
