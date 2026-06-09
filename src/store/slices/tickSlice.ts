import { create } from 'zustand';
import type { GearItem } from '@/types/items';
import type { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';

export type TickEventTone = 'xp' | 'loot' | 'cash' | 'cache' | 'level' | 'kill' | 'material' | 'essence' | 'fragment';

export type TickEvent = {
  id: string;
  /** Wall-clock timestamp of the tick that produced this event. */
  at: number;
  /** What kind of reward was produced by this tick. */
  tone: TickEventTone;
  /** Short headline (e.g. "+24 credits", "Vortex SMG"). */
  label: string;
  /** Secondary line (e.g. "raider patrol cleared"). */
  detail: string;
  /** Optional gear drop payload — the animation reads this to render the recent-drop card. */
  gear?: GearItem;
  /** Numeric value, if applicable (credits, scrap, XP, fragment count). */
  value?: number;
  /** Area id the tick ran in. */
  areaId?: string;
};

const MAX_EVENTS = 50;
const EVENT_TTL_MS = 90_000;

export interface TickFeedState {
  events: TickEvent[];
  push: (events: TickEvent[]) => void;
  clear: () => void;
}

const buildId = (): string => {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `tick:${random}`;
};

export const useTickFeedStore = create<TickFeedState>()((set) => ({
  events: [],
  push: (incoming) => set((state) => {
    if (!incoming.length) return state;
    const stamped = incoming.map((event) => ({ ...event, id: event.id || buildId() }));
    const next = [...stamped, ...state.events].slice(0, MAX_EVENTS);
    return { events: next };
  }),
  clear: () => set({ events: [] }),
}));

/** Selector that returns events newer than `ttlMs` ago. */
export const selectFreshEvents = (ttlMs: number = EVENT_TTL_MS) => (state: TickFeedState): TickEvent[] => {
  const cutoff = Date.now() - ttlMs;
  return state.events.filter((event) => event.at >= cutoff);
};

/** Selector that returns the single most recent event. */
export const selectLatestEvent = (state: TickFeedState): TickEvent | undefined => state.events[0];

/** Re-export of the gear item shape from the diorama, for typing. */
export type { GearItem };

/** Re-export of game enums (kept for downstream imports that prefer the slice as the source). */
export { Element, Manufacturer, Rarity, WeaponType };
