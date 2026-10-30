import React from 'react';
import { ActionLoadout, type ActionLoadoutProps } from '@/components/action/ActionLoadout';

type SyncedLoadoutScreenProps = Pick<ActionLoadoutProps, 'requestedPickerSlot'>;

/**
 * The Loadout tab of the gear home (Inventory). This is the manage-mode
 * mount of ActionLoadout: the Slot Picker it hosts is the one place
 * gear gets equipped or unequipped.
 */
export const SyncedLoadoutScreen: React.FC<SyncedLoadoutScreenProps> = (props) => {
  return (
    <div className="p-4 space-y-4 pb-20">
      <div>
        <div className="text-lg font-black text-text-primary">Loadout</div>
        <div className="text-xs text-text-muted">Your seven gear slots. Tap a slot to equip from your inventory — every change is verified server-side.</div>
      </div>
      <ActionLoadout {...props} />
    </div>
  );
};
