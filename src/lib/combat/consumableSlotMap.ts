/**
 * consumableSlotMap — pure helpers that map the loadout's three
 * consumable slots (PreFight / MidFight / Emergency) to the consumable
 * type they're holding, and look up the current count for each slot
 * in the player store.
 *
 * This is what the action tab's "Consumables Chips" component reads
 * to render the three little chips showing MedKit ×N / ShieldCell ×N
 * / ReviveToken ×N. The chips let the player see at a glance whether
 * their auto-eat triggers have anything to fire.
 *
 * The slot→type mapping is read from `useLoadoutStore`; the count is
 * read from `usePlayerStore`. Both reads are pure (no state mutation).
 */

import { useLoadoutStore } from '@/store/slices/loadoutSlice';
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
  /** Icon hint (emoji) for the chip. */
  icon: string;
}

/** Map consumable type ID → emoji chip icon. */
const CONSUMABLE_ICONS: Record<string, string> = {
  MedKit: '🧪',
  ShieldCell: '🛡',
  ReviveToken: '🎟',
  NanoSwarm: '🐝',
  AdrenalineShot: '💉',
};

function consumableLabel(typeId: string | null): string {
  if (!typeId) return 'Empty';
  return CONSUMABLES[typeId]?.name ?? typeId;
}

function consumableIcon(typeId: string | null): string {
  if (!typeId) return '—';
  return CONSUMABLE_ICONS[typeId] ?? '📦';
}

/**
 * Read the three consumable slots and resolve them to display views.
 * Each view carries the slot name, the consumable type it holds, the
 * player's current count of that consumable, and a label/icon.
 *
 * Cheap to call (no store subscriptions, just `.getState()` reads).
 * The ConsumablesChips component should call this in a `useMemo` or
 * via a stable selector to avoid re-rendering on every tick.
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

/**
 * Read the player's current revive token count. Used by the death
 * overlay to enable/disable the "Use Revive Token" option.
 */
export function readReviveTokenCount(): number {
  return usePlayerStore.getState().getConsumableCount('ReviveToken');
}
