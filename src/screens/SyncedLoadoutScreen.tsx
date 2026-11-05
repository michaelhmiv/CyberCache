import React, { useState } from 'react';
import { ActionLoadout, type ActionLoadoutProps } from '@/components/action/ActionLoadout';
import { GaragePanel } from '@/components/gear/GaragePanel';
import { VehicleButton } from '@/components/gear/VehicleButton';

type SyncedLoadoutScreenProps = Pick<ActionLoadoutProps, 'requestedPickerSlot' | 'pickerRequest' | 'onOpenWardrobe'> & {
  /**
   * Garage deep-link signal (owner ruling 2026-11-02): the Garage
   * is folded into this stop (DESIGN.md §11 F1 as amended), so a
   * Garage door lands here carrying a fresh seq and the Garage
   * starts out expanded under the panel.
   */
  vehicleExpandSignal?: number | null;
  /** The Garage's "post it to the Repair Services board" door. */
  onRequestService?: () => void;
  /** App navigation, threaded to the Garage's remedy doors. */
  onNavigate?: (screen: string) => void;
};

/** Scroll the expanded Garage into view (guarded — some
 *  environments lack scrollIntoView; the scroll is an
 *  enhancement, never a gate). */
const scrollToGarage = () => {
  const el = document.getElementById('gear-garage-section');
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'start' });
  }
};

/**
 * The top of the merged Gear page (the Loadout stop since the
 * Exec C merge, 2026-11-03): the manage-mode mount of ActionLoadout
 * — the Slot Picker it hosts is the one place gear gets equipped
 * or unequipped — with the Garage directly under it.
 *
 * The vehicle slot (DESIGN.md §3: the loadout is 7 gear slots +
 * the vehicle slot) is a BUTTON in the panel header now (owner
 * ruling 2026-11-05, superseding the bottom status strip): the
 * VehicleButton in the header's top-right gap carries the equipped
 * vehicle, its yield, tank, and condition as glanceable numbers,
 * and toggles the full Garage open in place under the panel —
 * vehicles equip, refuel, and repair there (they are not GearItem,
 * so they keep their own verified ops in the Garage panel). The
 * expansion state lives here: the button that toggles it sits in
 * the panel header while the panel it opens mounts below, and the
 * expandSignal deep-link (a fresh seq from a Garage door
 * elsewhere) starts it expanded — the same render-phase
 * adjustment pattern the gear home uses for its tab intents. The
 * Inventory grid and Belt & Stacks sections follow on the same
 * page (InventoryScreen composes them).
 *
 * Drift-fix F5: the standalone intro sentence that used to sit above
 * the panel is gone (the proposal carries no page-title header here);
 * its two facts live in the panel itself — "Tap a slot to equip" in
 * the header, "changes verify server-side" behind the belt's "?"
 * hint (no-paragraphs law, 2026-11-05).
 */
export const SyncedLoadoutScreen: React.FC<SyncedLoadoutScreenProps> = ({
  vehicleExpandSignal = null,
  onRequestService,
  onNavigate,
  ...loadoutProps
}) => {
  const [garageExpanded, setGarageExpanded] = useState(false);
  const [appliedSignal, setAppliedSignal] = useState<number | null>(null);
  if (vehicleExpandSignal !== null && vehicleExpandSignal !== appliedSignal) {
    setAppliedSignal(vehicleExpandSignal);
    setGarageExpanded(true);
  }

  const toggleGarage = () => {
    if (!garageExpanded) {
      // The Garage unfolds under the whole panel — bring it into
      // view as it opens, or the tap reads as a no-op from the top.
      setGarageExpanded(true);
      requestAnimationFrame(scrollToGarage);
    } else {
      setGarageExpanded(false);
    }
  };

  return (
    <div className="space-y-4 px-4">
      <ActionLoadout
        {...loadoutProps}
        vehicleDoor={<VehicleButton expanded={garageExpanded} onToggle={toggleGarage} />}
      />
      <div id="gear-garage-section">
        {garageExpanded && <GaragePanel onRequestService={onRequestService} onNavigate={onNavigate} />}
      </div>
    </div>
  );
};
