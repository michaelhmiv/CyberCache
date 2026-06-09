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
  | 'boss_phase'
  | 'boss_victory'
  | 'boss_defeat'
  | 'crafting'
  | 'salvaging'
  | 'market_listing'
  | 'idle';

export type RunEventTone = 'xp' | 'loot' | 'cache' | 'cash' | 'level' | 'patrol';

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
  material_find: 60,
  enemy_sweep: 40,
  credits_scrap: 20,
  boss_prep: 15,
  run_started: 10,
  run_stopped: 10,
  crafting: 10,
  salvaging: 10,
  market_listing: 10,
  idle: 0,
};

export const makeRunEvent = (label: string, detail: string, tone: RunEventTone, eventType: RunEventKind): RunVisualEvent => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  label,
  detail,
  tone,
  eventType,
});

export const sortRunEventsByVisualPriority = (events: RunVisualEvent[]) => (
  [...events].sort((a, b) => priority[b.eventType] - priority[a.eventType])
);
