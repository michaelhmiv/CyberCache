import React, { useState } from 'react';
import { useLoadoutStore, usePlayerStore } from '@/store';
import { ActiveBuffPills } from '@/components/stats/ActiveBuffPills';
import { ConsumableLedger } from '@/components/stats/ConsumableLedger';
import { VehicleBeltChip } from '@/components/dashboard/VehicleBeltChip';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';

/**
 * Consumable belt (redesign Wave C, DESIGN.md §4) — the active
 * consumable slots, lifted out of the deck into the above-fold
 * band: composition step 5 sits it directly under the lit
 * workspace on Home, so a hunter sees what is loaded and what
 * is burning before the fold. Same pills + ledger as the deck
 * carried (one implementation, moved — the ledger's slot focus
 * state lives here now), and the Gear rail keeps its own
 * Loadout Bench surface for editing the loadout itself.
 */
export const ConsumableBelt: React.FC<{
  /** Routes the vehicle chip's remedy doors (Garage / Vendor). */
  onNavigate?: (target: string) => void;
}> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const [focusedSlot, setFocusedSlot] = useState<keyof LoadoutConsumables | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  return (
    <section
      data-testid="consumable-belt"
      className="relative overflow-hidden border-2 border-border bg-surface/95 p-2 shadow-[0_8px_18px_rgba(0,0,0,0.55)]"
    >
      <div className="relative mb-1.5 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">
        <span className="h-px flex-1 bg-border-light" />
        <span>Consumables</span>
        <span className="h-px flex-1 bg-border-light" />
      </div>
      <ActiveBuffPills
        consumables={loadout.consumables}
        inventory={player.consumables}
        onSlotClick={(slot) => {
          setFocusedSlot(slot);
          setLedgerOpen(true);
        }}
        trailingCell={onNavigate ? <VehicleBeltChip onNavigate={onNavigate} /> : undefined}
      />
      {ledgerOpen && (
        <ConsumableLedger
          consumables={loadout.consumables}
          inventory={player.consumables}
          focusedSlot={focusedSlot}
          onClose={() => {
            setLedgerOpen(false);
            setFocusedSlot(null);
          }}
        />
      )}
    </section>
  );
};
