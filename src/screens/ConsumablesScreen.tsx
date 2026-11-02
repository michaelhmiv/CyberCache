import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { CONSUMABLES, CONSUMABLE_SLOTS } from '@/constants/consumables';
import type { ConsumableDef, ConsumableVisual } from '@/constants/consumables';
import type { ConsumableSlot } from '@/types/game';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';
import { useLoadoutStore, useMarketStore, usePlayerStore } from '@/store';
import { ConsumableInspectSheet } from '@/components/consumables/ConsumableInspectSheet';
import { ConsumablePicker } from '@/components/consumables/ConsumablePicker';

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
  const [pickerSlot, setPickerSlot] = useState<ConsumableSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<ConsumableDef | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const totalOwned = useMemo(
    () => Object.values(player.consumables).reduce((sum, n) => sum + (n || 0), 0),
    [player.consumables],
  );

  const handlePick = (slot: keyof LoadoutConsumables, consumableId: string | null) => {
    loadout.setConsumableSlot(slot, consumableId);
    if (consumableId) {
      const name = CONSUMABLES[consumableId]?.name ?? consumableId;
      setNotice(`${name} on your belt (${SLOT_LABELS[slot]}) — it pre-loads boss prep.`);
    } else {
      setNotice(`${SLOT_LABELS[slot]} cleared.`);
    }
    setExpandedSlot(null);
  };

  // Picker handlers — async to match SlotGearPicker's verifiedOps pattern.
  // Currently no verified RPC for consumable slot assignment; the local
  // store call is the established pattern (mirrored from the original
  // handlePick above). When verifiedOps.setConsumableSlot lands, replace
  // the body of these two handlers.
  const onPickerEquip = async (consumableId: string) => {
    if (!pickerSlot) return;
    setBusy(true);
    setPickerError(null);
    try {
      loadout.setConsumableSlot(pickerSlot, consumableId);
      const name = CONSUMABLES[consumableId]?.name ?? consumableId;
      setNotice(`${name} on your belt (${SLOT_LABELS[pickerSlot]}) — it pre-loads boss prep.`);
      setPickerSlot(null);
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Unable to assign consumable.');
    } finally {
      setBusy(false);
    }
  };

  const onPickerUnequip = async () => {
    if (!pickerSlot) return;
    setBusy(true);
    setPickerError(null);
    try {
      loadout.setConsumableSlot(pickerSlot, null);
      setNotice(`${SLOT_LABELS[pickerSlot]} cleared.`);
      setPickerSlot(null);
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Unable to clear slot.');
    } finally {
      setBusy(false);
    }
  };

  const handleEquipFromInspect = (id: string) => {
    // If already equipped in any slot, don't duplicate — just close.
    if (CONSUMABLE_SLOTS.some((s) => loadout.consumables[s] === id)) {
      setInspecting(null);
      return;
    }
    // Find first empty slot, or default to first slot.
    let targetSlot = CONSUMABLE_SLOTS.find((s) => !loadout.consumables[s]);
    if (!targetSlot) targetSlot = CONSUMABLE_SLOTS[0];
    loadout.setConsumableSlot(targetSlot, id);
    const name = CONSUMABLES[id]?.name ?? id;
    setNotice(`${name} on your belt (${SLOT_LABELS[targetSlot!]}) — it pre-loads boss prep.`);
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
          <div className="text-[10px] text-text-muted">Your belt — tap a slot to assign, swap, or inspect.</div>
        </div>
        <button type="button" onClick={openVendor} className="rounded-full border border-amber/40 bg-amber/10 px-2 py-1 text-[10px] font-black text-amber">
          <span className="inline-flex items-center gap-1"><span style={{ fontSize: '11px' }}>$</span> Vendor</span>
        </button>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2">
        <div className="text-[10px] text-text-muted">Total owned</div>
        <div className="text-xs font-black text-amber">{totalOwned}</div>
      </div>

      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[10px] text-text-muted">
        These three slots are your belt. Boss fights start with your belt pre-loaded — one of
        each belted type you own — and you set the exact counts on the boss screen before the
        attempt; what the boss screen shows is what burns. While roaming, every roaming
        consumable you own activates automatically — the belt doesn't turn roaming effects
        on or off.
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
                    <PxIcon name={def.visual.icon} size={26} />
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
                      <PxIcon name={def.visual.icon} size={13} style={{ color: def.visual.accent === 'green' ? '#7CFC00' : '#FFB300' }} />
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

                  {/* Open full-height picker sheet */}
                  <button
                    type="button"
                    onClick={() => setPickerSlot(slot as ConsumableSlot)}
                    className="w-full px-2 py-2 text-left text-[10px] font-black text-amber hover:bg-amber/10"
                  >
                    {def ? 'Open swap picker →' : 'Open consumable picker →'}
                  </button>

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

      {/* Full-height consumable picker sheet */}
      <AnimatePresence>
        {pickerSlot && (
          <ConsumablePicker
            slot={pickerSlot}
            currentId={loadout.consumables[pickerSlot]}
            onClose={() => {
              setPickerSlot(null);
              setPickerError(null);
            }}
            onEquip={onPickerEquip}
            onUnequip={onPickerUnequip}
            busy={busy}
            error={pickerError}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
