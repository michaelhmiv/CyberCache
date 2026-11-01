import React, { useEffect } from 'react';
import { ActionLoadout, type ActionLoadoutProps } from '@/components/action/ActionLoadout';
import { GaragePanel } from '@/components/gear/GaragePanel';

type SyncedLoadoutScreenProps = Pick<ActionLoadoutProps, 'requestedPickerSlot'> & {
  /** Jump to the Market's Repair Services board (0025). */
  onRequestService?: () => void;
  /**
   * Garage deep link (audit UX-06): when the player arrives via a
   * "Garage" door (the Action banner's), the intent carries this seq;
   * on a fresh seq the labeled Garage section scrolls into view —
   * the same focus pattern Profile uses for its Skill Trees door.
   */
  focusGarageSeq?: number | null;
};

/**
 * The Loadout tab of the gear home (Inventory). This is the manage-mode
 * mount of ActionLoadout: the Slot Picker it hosts is the one place
 * gear gets equipped or unequipped. The Garage below manages the
 * vehicle slot (0021) — vehicles are not GearItem, so they equip from
 * their own list, through the same verified ops.
 */
export const SyncedLoadoutScreen: React.FC<SyncedLoadoutScreenProps> = (props) => {
  const { focusGarageSeq } = props;
  useEffect(() => {
    if (focusGarageSeq == null) return;
    const el = document.getElementById('garage-panel');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [focusGarageSeq]);

  return (
    <div className="p-4 space-y-4 pb-20">
      <div>
        <div className="text-lg font-black text-text-primary">Loadout</div>
        <div className="text-xs text-text-muted">Your seven gear slots. Tap a slot to equip from your inventory — every change is verified server-side.</div>
      </div>
      <ActionLoadout {...props} />
      <GaragePanel onRequestService={props.onRequestService} />
    </div>
  );
};
