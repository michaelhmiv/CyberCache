/**
 * Data Slots service (0049) — the client's read of the slot
 * machine's display state from the Chef reads family
 * (GET /api/slots/me, identity from the JWT only): levered bet
 * tiers, pulls used / remaining today, and the cache budget a key
 * prize would charge. Failures return null: the panel falls back to
 * the content defaults and lets the pull op's own response (which
 * carries the same counters) correct it.
 */
import { apiRequest } from './http';
import type { SlotStateView } from '@/content/slots';

export type SlotState = SlotStateView;

export async function fetchSlotState(): Promise<SlotState | null> {
  try {
    return await apiRequest<SlotState | null>('/slots/me');
  } catch (error) {
    console.error('fetchSlotState error:', error);
    return null;
  }
}
