/**
 * useActionStageOrchestrator — the hook that drives the action stage
 * canvas. Picks the next beat from the activity's idle beat list,
 * plays it for one slot, then advances.
 *
 * Lifecycle:
 *   - Mounts: reads the current activity kind, resolves the beat plan
 *     from `ACTION_ANIMATION_PLANS[kind]`, and starts a 2-second
 *     cadence that picks the next beat in the list.
 *   - Updates: when the kind changes (user switches activity), the
 *     hook resets the cadence to the new plan.
 *   - Cleanup: clears the interval on unmount.
 *
 * Design notes:
 *   - The cadence is 2s by default, tunable per beat. Each beat gets
 *     one slot; the next beat is picked when the slot ends. This
 *     mirrors the spec layer's `visualLoop` arrays.
 *   - We DO NOT randomize the order — the spec layer is the source of
 *     truth. The orchestrator just walks the list.
 *   - When `prefers-reduced-motion` is on, the cadence slows to one
 *     beat per 6s and the rendered animations are static variants.
 *
 * Returning a small object so the stage can render with no extra
 * store subscriptions — the hook owns the beat state, the stage just
 * reads it on each render.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ActivityKind } from '@/types/activity';
import { ACTION_ANIMATION_PLANS, type ActionAnimationBeat } from './actionAnimationDirector';

const DEFAULT_SLOT_MS = 2000;
const REDUCED_MOTION_SLOT_MS = 6000;

export interface ActionStageState {
  /** The beat currently playing. */
  currentBeat: ActionAnimationBeat;
  /** The accent color from the activity's stage assets. */
  accentColor: string;
  /** True when prefers-reduced-motion is on. */
  reducedMotion: boolean;
  /** Index into the beat list — for dev tools / debug overlays. */
  beatIndex: number;
  /** Total beat count in the current plan. */
  beatCount: number;
}

/**
 * Detect prefers-reduced-motion. SSR-safe: returns false on the
 * server / first render, then upgrades if the user has it set.
 */
const detectReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export function useActionStageOrchestrator(kind: ActivityKind): ActionStageState {
  const plan = ACTION_ANIMATION_PLANS[kind] ?? ACTION_ANIMATION_PLANS.idle_standby;
  // Stable beats list — useMemo so the effect dep doesn't churn.
  const beats = useMemo<ActionAnimationBeat[]>(
    () => (plan.idle.length > 0 ? plan.idle : ['idle-breathe']),
    [plan]
  );
  // Lazy initializers: no setState in effects.
  // `kindForIndex` lets us detect kind changes during render and
  // reset `beatIndex` without a setState-in-effect (which the React
  // 19 lint rule flags). When `kindForIndex` differs from `kind`,
  // we render with index 0 and queue the state update for the next
  // commit via the standard "store previous value in state" pattern.
  const [tick, setTick] = useState<{ kindForIndex: ActivityKind; beatIndex: number }>(() => ({
    kindForIndex: kind,
    beatIndex: 0,
  }));
  if (tick.kindForIndex !== kind) {
    // Render-phase reset: this is the documented React pattern for
    // "reset state when a prop changes." It runs during render, not
    // in an effect, so it doesn't trigger the cascading-renders rule.
    setTick({ kindForIndex: kind, beatIndex: 0 });
  }
  const beatIndex = tick.beatIndex;
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => detectReducedMotion());

  // Subscribe to reduced-motion changes (this is a legitimate effect —
  // the alternative is useSyncExternalStore which is heavier for one media query).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Reset the index when the kind changes. Handled in the
  // `tick` state above (render-phase reset, no effect needed).

  // Advance the index on a slot interval.
  useEffect(() => {
    if (beats.length <= 1) return undefined; // single-beat plans don't need a timer
    const slotMs = reducedMotion ? REDUCED_MOTION_SLOT_MS : DEFAULT_SLOT_MS;
    const id = setInterval(() => {
      setTick((prev) => ({ kindForIndex: prev.kindForIndex, beatIndex: (prev.beatIndex + 1) % beats.length }));
    }, slotMs);
    return () => clearInterval(id);
  }, [beats, reducedMotion]);

  return {
    currentBeat: beats[beatIndex] ?? 'idle-breathe',
    accentColor: '#3a3a4a', // resolved at the ActionStage level (the spec owns the color)
    reducedMotion,
    beatIndex,
    beatCount: beats.length,
  };
}
