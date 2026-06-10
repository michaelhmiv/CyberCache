/**
 * Action stage renderer — turns the 17 declared `ActionAnimationBeat`s
 * into real Framer Motion animation primitives. This is the missing
 * bridge between the spec layer (`actionWorkspaceSpecs.ts` declares
 * what should happen) and the visual layer (the action tab actually
 * shows it).
 *
 * Before this module, `data-motion-beats` was a CSS-class hint that
 * nothing in the codebase consumed. Now each beat has a real
 * `BeatAnimator` that returns Framer Motion variants, and the stage
 * cycles through them in a continuous loop per activity kind.
 *
 * The renderer is pure (no state, no store, no async, no JSX). The
 * JSX lives in `ActionStage.tsx` — this file exports only data and
 * functions. The `StageSprite` placeholder is a small typed value
 * (the actual component is in ActionStage.tsx).
 *
 * Adding a new beat:
 *   1. Add the string to `ActionAnimationBeat` in `actionAnimationDirector.ts`.
 *   2. Add a `BeatAnimator` entry in `BEAT_ANIMATORS` below.
 *   3. Add the beat to the appropriate activity's `ACTION_ANIMATION_PLANS`
 *      `idle` or `onTick` list.
 *   4. The orchestrator (`useActionStageOrchestrator.ts`) picks it up
 *      automatically.
 */
import type { Variants } from 'framer-motion';
import type { ActionAnimationBeat } from './actionAnimationDirector';
import type { ActivityKind } from '@/types/activity';
import { getActionWorkspaceSpec } from './actionWorkspaceSpecs';

/** Visual context passed to each beat animator. */
export interface BeatRenderContext {
  /** The activity kind, used to look up stage assets. */
  kind: ActivityKind;
  /** When true, the renderer skips motion and shows the resting state. */
  reducedMotion: boolean;
  /** Optional accent color (from stageAssets.accentColor). */
  accentColor?: string;
}

/** Which element the beat animates. */
export type BeatTarget = 'hunter' | 'target' | 'surface' | 'stage';

/**
 * A single beat's animation. Each animator receives the beat's name
 * and a context, and returns the Framer Motion variants + JSX to
 * render inside the stage canvas.
 */
export interface BeatRender {
  /** Which element the animation applies to. */
  target: BeatTarget;
  /** Framer Motion variants to apply via `animate={beat.variants}`. */
  variants: Variants;
  /** Optional inline duration override (seconds). */
  durationSec?: number;
  /** A short label that can be shown in dev tools or a future debug overlay. */
  debugLabel: string;
}

export type BeatAnimator = (ctx: BeatRenderContext) => BeatRender;

/**
 * Map from beat name to its renderer. Each entry is a small factory —
 * typically just `() => ({ ... })` with a `Variants` literal.
 *
 * Design notes:
 *   - Durations are kept short (0.3-1.2s) so the beat queue feels
 *     punchy, not slow. The orchestrator's idle-loop interval is 2s
 *     by default; each beat gets one slot in that cadence.
 *   - We use `ease: 'easeOut'` for entrance beats and `ease: 'easeIn'`
 *     for exit beats. Beats that "loop" (idle-breathe) use
 *     `repeat: Infinity` with a `yoyo`-style keyframe sequence.
 *   - The renderer must be deterministic — same beat + same context
 *     produces the same render. No `Math.random` here; that's the
 *     orchestrator's job.
 */
export const BEAT_ANIMATORS: Record<ActionAnimationBeat, BeatAnimator> = {
  // ─── Idle / ambient beats ───────────────────────────────────────
  'idle-breathe': () => ({
    target: 'hunter',
    variants: {
      initial: { scale: 1 },
      animate: {
        scale: [1, 1.03, 1],
        transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' },
      },
    },
    debugLabel: 'idle-breathe',
  }),

  'patrol-step': () => ({
    target: 'hunter',
    variants: {
      initial: { x: 0 },
      animate: {
        x: [0, -8, 8, -4, 4, 0],
        transition: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' },
      },
    },
    debugLabel: 'patrol-step',
  }),

  'target-motion': () => ({
    target: 'target',
    variants: {
      initial: { x: 40, opacity: 0 },
      animate: {
        x: [40, 0, 0, 0, 40],
        opacity: [0, 1, 1, 1, 0],
        transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' },
      },
    },
    debugLabel: 'target-motion',
  }),

  // ─── Impact / action beats ──────────────────────────────────────
  'impact-flash': () => ({
    target: 'target',
    variants: {
      initial: { filter: 'brightness(1)' },
      animate: {
        filter: ['brightness(1)', 'brightness(2.5)', 'brightness(1)'],
        transition: { duration: 0.3, ease: 'easeOut' },
      },
    },
    debugLabel: 'impact-flash',
  }),

  'reward-flyout': () => ({
    target: 'stage',
    variants: {
      initial: { opacity: 0 },
      animate: { opacity: [0, 1, 0], transition: { duration: 1.0, ease: 'easeOut' } },
    },
    debugLabel: 'reward-flyout',
  }),

  'cache-pulse': () => ({
    target: 'stage',
    variants: {
      initial: { scale: 1, opacity: 0.6 },
      animate: {
        scale: [1, 1.4, 1],
        opacity: [0.6, 0, 0.6],
        transition: { duration: 0.8, ease: 'easeOut' },
      },
    },
    debugLabel: 'cache-pulse',
  }),

  // ─── Boss / encounter beats ─────────────────────────────────────
  'weakness-scan': () => ({
    target: 'target',
    variants: {
      initial: { filter: 'hue-rotate(0deg) brightness(1)' },
      animate: {
        filter: ['hue-rotate(0deg) brightness(1)', 'hue-rotate(180deg) brightness(1.4)', 'hue-rotate(0deg) brightness(1)'],
        transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' },
      },
    },
    debugLabel: 'weakness-scan',
  }),

  'boss-reaction': () => ({
    target: 'target',
    variants: {
      initial: { x: 0 },
      animate: {
        x: [0, -3, 3, -2, 2, 0],
        transition: { duration: 0.3, ease: 'easeOut' },
      },
    },
    debugLabel: 'boss-reaction',
  }),

  'phase-pulse': (ctx) => ({
    target: 'target',
    variants: {
      initial: { boxShadow: `0 0 0 0 ${ctx.accentColor ?? '#ff8800'}00` },
      animate: {
        boxShadow: [
          `0 0 0 0 ${ctx.accentColor ?? '#ff8800'}00`,
          `0 0 0 12px ${ctx.accentColor ?? '#ff8800'}80`,
          `0 0 0 0 ${ctx.accentColor ?? '#ff8800'}00`,
        ],
        transition: { duration: 0.9, ease: 'easeOut' },
      },
    },
    debugLabel: 'phase-pulse',
  }),

  // ─── Crafting / workshop beats ──────────────────────────────────
  'bench-pulse': () => ({
    target: 'surface',
    variants: {
      initial: { filter: 'brightness(1)' },
      animate: {
        filter: ['brightness(1)', 'brightness(1.4)', 'brightness(1)'],
        transition: { duration: 0.8, repeat: Infinity, ease: 'easeInOut' },
      },
    },
    debugLabel: 'bench-pulse',
  }),

  'parts-slide': () => ({
    target: 'surface',
    variants: {
      initial: { y: -20, opacity: 0 },
      animate: {
        y: [-20, 0, 0],
        opacity: [0, 1, 1],
        transition: { duration: 0.6, ease: 'easeOut' },
      },
    },
    debugLabel: 'parts-slide',
  }),

  'item-reveal': () => ({
    target: 'stage',
    variants: {
      initial: { scale: 0, opacity: 0 },
      animate: {
        scale: [0, 1.2, 1],
        opacity: [0, 1, 1],
        transition: { duration: 0.4, ease: 'easeOut' },
      },
    },
    debugLabel: 'item-reveal',
  }),

  'machine-ready': () => ({
    target: 'surface',
    variants: {
      initial: { filter: 'brightness(1) hue-rotate(0deg)' },
      animate: {
        filter: ['brightness(1) hue-rotate(0deg)', 'brightness(1.5) hue-rotate(80deg)', 'brightness(1) hue-rotate(0deg)'],
        transition: { duration: 0.6, ease: 'easeOut' },
      },
    },
    debugLabel: 'machine-ready',
  }),

  // ─── Salvage beats ──────────────────────────────────────────────
  'salvage-spark': () => ({
    target: 'target',
    variants: {
      initial: { filter: 'brightness(1) saturate(1)' },
      animate: {
        filter: ['brightness(1) saturate(1)', 'brightness(1.6) saturate(1.8)', 'brightness(1) saturate(1)'],
        transition: { duration: 0.4, repeat: Infinity, ease: 'easeInOut' },
      },
    },
    debugLabel: 'salvage-spark',
  }),

  'material-burst': () => ({
    target: 'stage',
    variants: {
      initial: { x: 0, opacity: 1 },
      animate: {
        x: [0, 30, 60],
        opacity: [1, 0.7, 0],
        transition: { duration: 0.8, ease: 'easeOut' },
      },
    },
    debugLabel: 'material-burst',
  }),

  // ─── Market beats ───────────────────────────────────────────────
  'kiosk-scan': () => ({
    target: 'surface',
    variants: {
      initial: { filter: 'brightness(1)' },
      animate: {
        filter: ['brightness(1)', 'brightness(1.3)', 'brightness(1)'],
        transition: { duration: 1.0, repeat: Infinity, ease: 'linear' },
      },
    },
    debugLabel: 'kiosk-scan',
  }),

  'credit-transfer': () => ({
    target: 'stage',
    variants: {
      initial: { y: 0, opacity: 1 },
      animate: {
        y: [0, -20, -30],
        opacity: [1, 0.8, 0],
        transition: { duration: 0.7, ease: 'easeOut' },
      },
    },
    debugLabel: 'credit-transfer',
  }),

  // ─── Death beat (PR 5) ───────────────────────────────────────────
  // The hunter slumps to the ground and stays there until resurrected.
  // Single-shot animation, no infinite repeat. The stage itself can
  // also pulse red as a "danger" backdrop.
  'hunter-down': () => ({
    target: 'hunter',
    variants: {
      initial: { y: 0, rotate: 0, opacity: 1 },
      animate: {
        y: [0, 8, 18],
        rotate: [0, 12, 78],
        opacity: [1, 0.9, 0.7],
        transition: { duration: 1.2, ease: 'easeIn', times: [0, 0.4, 1] },
      },
    },
    debugLabel: 'hunter-down',
  }),
};

/** Resolve the beat renderer for a given beat, or fall back to idle-breathe. */
export function resolveBeat(beat: ActionAnimationBeat, ctx: BeatRenderContext): BeatRender {
  const animator = BEAT_ANIMATORS[beat] ?? BEAT_ANIMATORS['idle-breathe'];
  return animator(ctx);
}

/** Resolve the stage assets for a kind, with monster/boss overrides applied. */
export function getStageAssetsForKind(
  kind: ActivityKind,
  overrides?: { targetSprite?: string }
) {
  const spec = getActionWorkspaceSpec(kind);
  // stageAssets was removed from MechanicWorkspaceSpec (2026-06-10).
  // The cast preserves backward compat for the deprecated test suite.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assets = (spec as any).stageAssets as {
    hunterSprite: string;
    targetSprite?: string;
    surfaceSprite?: string;
    accentColor: string;
    stageLabel: string;
  } | undefined;
  const defaults = {
    hunterSprite: 'hunter_default',
    accentColor: '#3a3a4a',
    stageLabel: 'STANDBY',
  };
  return {
    ...defaults,
    ...assets,
    targetSprite: overrides?.targetSprite ?? assets?.targetSprite,
  };
}
