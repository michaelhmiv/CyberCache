/**
 * UI display events for the action feed — lifecycle transitions, cache operations,
 * and cosmetic feed labels. These are NOT gameplay reward events.
 *
 * For gameplay reward events (XP, loot, materials, damage, heal, death, etc.),
 * use `TickEvent` / `TickEventTone` from `@/store/slices/tickSlice`.
 *
 * Rule: `RunVisualEvent` and `makeRunEvent` must NEVER carry gameplay mutations.
 * They are display-only. If you need to show a reward, read it from
 * `useTickFeedStore` like `DashboardScreen` does.
 */

import type { TickEventTone } from '@/store/slices/tickSlice';

export type RunEventKind =
  | 'run_started'
  | 'run_stopped'
  | 'enemy_sweep'
  | 'gear_drop'
  | 'cache_fragment'
  | 'material_find'
  | 'credits_scrap'
  | 'auto_salvage'
  | 'level_up'
  | 'boss_prep'
  | 'boss_fight'
  | 'boss_phase'
  | 'boss_victory'
  | 'boss_defeat'
  | 'crafting'
  | 'salvaging'
  | 'market_listing'
  | 'workshop_service'
  | 'idle'
  | 'cache_locked'
  | 'cache_opening'
  | 'cache_opened'
  | 'cache_failed';

/**
 * Display tone for lifecycle events in the action feed.
 * Uses a subset of `TickEventTone` plus `'patrol'` for activity transitions.
 * This is a DISPLAY type — it does not represent gameplay rewards.
 */
export type RunEventTone = TickEventTone | 'patrol';

export type RunVisualEvent = {
  id: string;
  label: string;
  detail: string;
  tone: RunEventTone;
  eventType: RunEventKind;
};

const priority: Record<RunEventKind, number> = {
  boss_victory: 100,
  boss_defeat: 95,
  level_up: 90,
  gear_drop: 80,
  auto_salvage: 78,
  cache_fragment: 75,
  boss_phase: 70,
  boss_fight: 65,
  material_find: 60,
  enemy_sweep: 40,
  credits_scrap: 20,
  boss_prep: 15,
  run_started: 10,
  run_stopped: 10,
  crafting: 10,
  salvaging: 10,
  market_listing: 10,
  workshop_service: 8,
  cache_opened: 50,
  cache_opening: 15,
  cache_locked: 10,
  cache_failed: 10,
  idle: 0,
};

export const makeRunEvent = (
  label: string,
  detail: string,
  tone: RunEventTone,
  eventType: RunEventKind,
): RunVisualEvent => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  label,
  detail,
  tone,
  eventType,
});

export const sortRunEventsByVisualPriority = (events: RunVisualEvent[]) =>
  [...events].sort((a, b) => (priority[b.eventType] ?? 0) - (priority[a.eventType] ?? 0));
