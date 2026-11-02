/**
 * consumableSlotMap — pure helpers that map the loadout's three
 * consumable slots (Slot 1 / Slot 2 / Slot 3) to the consumable
 * type they're holding, and look up the current count for each slot
 * in the player store.
 *
 * Visual identity is resolved from `src/constants/consumables.ts` so
 * every chip uses the same consumable glyph as inspect, vendor, crafting,
 * and future market surfaces.
 */

import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import type { PxIconName } from '@/lib/pixel/icons';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { CONSUMABLES } from '@/constants/consumables';

export type ConsumableSlotName = 'PreFight' | 'MidFight' | 'Emergency';

export interface ConsumableSlotView {
  /** The loadout slot name. */
  slot: ConsumableSlotName;
  /** The consumable type ID stored in that slot (e.g. 'MedKit'), or null if empty. */
  consumableType: string | null;
  /** Human-readable label (e.g. 'MedKit', 'Shield Cell'). */
  label: string;
  /** How many the player currently has. 0 if slot is empty. */
  count: number;
  /** Pixel icon for the chip (PxIcon name). */
  icon: PxIconName;
}

function consumableLabel(typeId: string | null): string {
  if (!typeId) return 'Empty';
  return CONSUMABLES[typeId]?.name ?? typeId;
}

function consumableIcon(typeId: string | null): PxIconName {
  if (!typeId) return 'crate';
  return CONSUMABLES[typeId]?.visual.icon ?? 'crate';
}

/**
 * Read the three consumable slots and resolve them to display views.
 * Each view carries the slot name, the consumable type it holds, the
 * player's current count of that consumable, and a source-of-truth visual.
 */
export function readConsumableSlots(): ConsumableSlotView[] {
  const loadout = useLoadoutStore.getState();
  const player = usePlayerStore.getState();
  const slots: ConsumableSlotName[] = ['PreFight', 'MidFight', 'Emergency'];
  return slots.map((slot) => {
    const consumableType = loadout.consumables[slot] ?? null;
    const count = consumableType ? player.getConsumableCount(consumableType) : 0;
    return {
      slot,
      consumableType,
      label: consumableLabel(consumableType),
      count,
      icon: consumableIcon(consumableType),
    };
  });
}
