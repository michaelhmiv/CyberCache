/**
 * ActionStage — the canvas component that renders the current activity
 * kind's stage. Lives inside the `ActiveActionHeader` (or anywhere
 * else that wants the visual). Owns:
 *
 *   - The hunter sprite (left)
 *   - The target / surface sprite (right or center, depending on kind)
 *   - The current beat animation (driven by `useActionStageOrchestrator`)
 *   - A "now happening" label below the canvas
 *
 * The stage is *pure presentation* — it doesn't know about store
 * state, ticks, or combat. It just renders the spec for the given
 * kind. Per-tick damage and kill-cycle are PR 4.
 *
 * Props:
 *   - `kind` — the activity kind. Drives the spec lookup and beat plan.
 *   - `targetOverride` — optional `targetSprite` to use in place of
 *     the spec's default. Used by the boss-prep kind to show the
 *     selected boss instead of the generic "boss_default" sprite.
 *   - `className` — optional extra classes on the outer container.
 *
 * Tests:
 *   - See `actionStageRenderer.test.tsx` for beat-renderer unit tests.
 *   - The orchestrator is tested in `useActionStageOrchestrator.test.ts`.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { useActionStageOrchestrator } from './useActionStageOrchestrator';
import { resolveBeat, getStageAssetsForKind, type BeatRender } from './actionStageRenderer';
import type { ActivityKind } from '@/types/activity';

const SPRITE_SIZE = 96;
const CANVAS_HEIGHT = 168;

export interface ActionStageProps {
  kind: ActivityKind;
  /** Optional override for the target sprite (e.g. selected boss). */
  targetOverride?: string;
  /** Optional override for the hunter sprite. */
  hunterOverride?: string;
  /** Optional className for the outer container. */
  className?: string;
}

/**
 * The stage canvas. Renders two sprites with a stage background and
 * a beat-driven animation. The beat's `target` field tells us which
 * element to animate (hunter, target, surface, or the whole stage).
 */
export const ActionStage: React.FC<ActionStageProps> = ({ kind, targetOverride, hunterOverride, className }) => {
  const assets = getStageAssetsForKind(kind, { targetSprite: targetOverride });
  const stage = useActionStageOrchestrator(kind);
  const beat = resolveBeat(stage.currentBeat, {
    kind,
    reducedMotion: stage.reducedMotion,
    accentColor: assets.accentColor,
  });

  return (
    <div
      data-testid="action-stage"
      data-current-beat={stage.currentBeat}
      className={`relative overflow-hidden border-2 border-border bg-bg/70 ${className ?? ''}`}
      style={{
        height: CANVAS_HEIGHT,
        // Subtle accent tint on the stage background.
        background: `linear-gradient(180deg, ${assets.accentColor}14 0%, transparent 100%)`,
      }}
    >
      {/* Stage label — small badge in the corner */}
      <div
        className="absolute right-1 top-1 border border-border bg-bg/85 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-amber"
        data-testid="action-stage-label"
      >
        {assets.stageLabel}
      </div>

      {/* Beat number indicator — small dots showing which beat in the
          sequence is playing. Useful for QA; can be hidden via CSS. */}
      <div
        className="absolute bottom-1 left-1 flex gap-0.5"
        data-testid="action-stage-beat-dots"
        aria-hidden
      >
        {Array.from({ length: stage.beatCount }).map((_, i) => (
          <span
            key={i}
            className={`h-1 w-1 rounded-full ${
              i === stage.beatIndex ? 'bg-amber' : 'bg-text-muted/40'
            }`}
          />
        ))}
      </div>

      {/* "Now happening" label */}
      <div
        className="absolute bottom-1 right-1 text-[8px] font-black uppercase tracking-widest text-text-muted"
        data-testid="action-stage-now-happening"
      >
        → {stage.currentBeat}
      </div>

      {/* The stage layer — receives stage-targeted beat animations. */}
      <BeatLayer beat={beat} target="stage" reducedMotion={stage.reducedMotion}>
        {/* The sprites, positioned absolutely on the stage. */}
        {/* Hunter: left third. Target/surface: right third (if present). */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2">
          <BeatLayer
            beat={beat}
            target="hunter"
            reducedMotion={stage.reducedMotion}
          >
            <StageSprite
              visualKey={hunterOverride ?? assets.hunterSprite}
              size={SPRITE_SIZE}
              accentColor={assets.accentColor}
            />
          </BeatLayer>
        </div>

        {assets.targetSprite && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <BeatLayer
              beat={beat}
              target="target"
              reducedMotion={stage.reducedMotion}
            >
              <StageSprite
                visualKey={assets.targetSprite}
                size={SPRITE_SIZE}
                accentColor={assets.accentColor}
              />
            </BeatLayer>
          </div>
        )}

        {assets.surfaceSprite && !assets.targetSprite && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <BeatLayer
              beat={beat}
              target="surface"
              reducedMotion={stage.reducedMotion}
            >
              <StageSprite
                visualKey={assets.surfaceSprite}
                size={SPRITE_SIZE}
                accentColor={assets.accentColor}
              />
            </BeatLayer>
          </div>
        )}

        {/* Center divider — a subtle vertical line between the two sprites. */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-px -translate-x-1/2 -translate-y-1/2"
          style={{ background: `${assets.accentColor}30` }}
          aria-hidden
        />
      </BeatLayer>
    </div>
  );
};

/**
 * BeatLayer — a wrapper that applies a beat's Framer Motion variants
 * to its children. The `target` filter ensures we only apply the beat
 * to the right element (so an `impact-flash` beat doesn't also flash
 * the surface sprite).
 */
const BeatLayer: React.FC<{
  beat: BeatRender;
  target: BeatRender['target'];
  reducedMotion: boolean;
  children: React.ReactNode;
}> = ({ beat, target, reducedMotion, children }) => {
  if (beat.target !== target) {
    // Wrong target — render children without animation.
    return <>{children}</>;
  }
  // Reduced motion: use the initial variant only (no animation).
  const variants = reducedMotion
    ? { initial: beat.variants.initial, animate: beat.variants.initial }
    : beat.variants;
  return (
    <motion.div
      data-beat-target={target}
      data-beat-name={beat.debugLabel}
      initial="initial"
      animate="animate"
      variants={variants as Parameters<typeof motion.div>[0]['variants']}
    >
      {children}
    </motion.div>
  );
};

/**
 * StageSprite — placeholder renderer for a sprite given a `visualKey`.
 * Real pixel-art integration is out of scope for PR 3 — when assets
 * land in `src/lib/pixelArt/`, swap this for the real renderer. The
 * component is intentionally dumb so tests can assert on it without
 * bringing in framer-motion state.
 */
interface StageSpriteProps {
  visualKey: string;
  size: number;
  accentColor?: string;
  className?: string;
}

export const StageSprite: React.FC<StageSpriteProps> = ({ visualKey, size, accentColor, className }) => (
  <div
    data-visual-key={visualKey}
    className={`flex items-center justify-center border-2 border-border bg-bg/80 text-center font-black text-text-muted ${className ?? ''}`}
    style={{
      width: size,
      height: size,
      boxShadow: accentColor ? `inset 0 0 0 1px ${accentColor}40` : undefined,
    }}
  >
    <div className="px-1 text-[8px] uppercase leading-tight tracking-tight">
      {visualKey.replace(/_/g, ' ')}
    </div>
  </div>
);
