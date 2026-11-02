import React from 'react';
import { ActionLoadout, type ActionLoadoutProps } from '@/components/action/ActionLoadout';
import { VehicleStatusLine } from '@/components/gear/VehicleStatusLine';

type SyncedLoadoutScreenProps = Pick<ActionLoadoutProps, 'requestedPickerSlot'> & {
  /**
   * Door to the Garage stop (redesign Wave D): the vehicle slot's
   * management home is the Gear → Garage rail stop (DESIGN.md §11
   * F1), so the Loadout stop carries the slot's status line and
   * this door — the Garage panel itself no longer renders here.
   */
  onOpenGarage?: () => void;
};

/**
 * The Loadout stop of the gear home (Inventory). This is the
 * manage-mode mount of ActionLoadout: the Slot Picker it hosts is
 * the one place gear gets equipped or unequipped. The vehicle slot
 * (DESIGN.md §3: the loadout is 7 gear slots + the vehicle slot)
 * renders as its status line under the doll — equipped vehicle,
 * yield, fuel, condition — with the Open Garage door to the Garage
 * stop, where vehicles actually equip and repair (they are not
 * GearItem, so they keep their own verified ops there).
 */
export const SyncedLoadoutScreen: React.FC<SyncedLoadoutScreenProps> = ({ onOpenGarage, ...loadoutProps }) => {
  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="text-xs text-text-muted">Your seven gear slots. Tap a slot to equip from your inventory — every change is verified server-side.</div>
      <ActionLoadout {...loadoutProps} />
      <VehicleStatusLine onOpenGarage={onOpenGarage} />
    </div>
  );
};
