import React from 'react';
import { ActionLoadout, type ActionLoadoutProps } from '@/components/action/ActionLoadout';
import { VehicleGarageSection } from '@/components/gear/VehicleGarageSection';

type SyncedLoadoutScreenProps = Pick<ActionLoadoutProps, 'requestedPickerSlot' | 'pickerRequest' | 'onOpenWardrobe'> & {
  /**
   * Garage deep-link signal (owner ruling 2026-11-02): the Garage
   * is folded into this stop (DESIGN.md §11 F1 as amended), so a
   * Garage door lands here carrying a fresh seq and the vehicle
   * section below opens already expanded.
   */
  vehicleExpandSignal?: number | null;
  /** The Garage's "post it to the Repair Services board" door. */
  onRequestService?: () => void;
  /** App navigation, threaded to the Garage's remedy doors. */
  onNavigate?: (screen: string) => void;
};

/**
 * The top of the merged Gear page (the Loadout stop since the
 * Exec C merge, 2026-11-03): the manage-mode mount of ActionLoadout
 * — the Slot Picker it hosts is the one place gear gets equipped
 * or unequipped — with the vehicle section directly under it. The
 * vehicle slot (DESIGN.md §3: the loadout is 7 gear slots + the
 * vehicle slot) renders as the status line (equipped vehicle,
 * yield, fuel, condition) with the full Garage expanding in place
 * under it: vehicles equip, refuel, and repair there (they are not
 * GearItem, so they keep their own verified ops in the Garage
 * panel). The Inventory grid and Belt & Stacks sections follow on
 * the same page (InventoryScreen composes them).
 *
 * Drift-fix F5: the standalone intro sentence that used to sit above
 * the panel is gone (the proposal carries no page-title header here);
 * its two facts live in the panel itself — "Tap a slot to equip" in
 * the header, "changes verify server-side" in the belt caption.
 */
export const SyncedLoadoutScreen: React.FC<SyncedLoadoutScreenProps> = ({
  vehicleExpandSignal = null,
  onRequestService,
  onNavigate,
  ...loadoutProps
}) => {
  return (
    <div className="space-y-4 px-4">
      <ActionLoadout {...loadoutProps} />
      <VehicleGarageSection expandSignal={vehicleExpandSignal} onRequestService={onRequestService} onNavigate={onNavigate} />
    </div>
  );
};
