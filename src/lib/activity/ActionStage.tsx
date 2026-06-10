/**
 * ActionStage — secondary beat canvas for the current activity kind.
 *
 * The main combat HUD belongs in LiveTurfDiorama. This component intentionally
 * renders beat/sprite motion only so the Action tab does not duplicate enemy HP
 * or hunter totals in a second animated area.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { useActionStageOrchestrator } from './useActionStageOrchestrator';
import { resolveBeat, getStageAssetsForKind, type BeatRender } from './actionStageRenderer';
import type { ActionAnimationBeat } from './actionAnimationDirector';
import type { ActivityKind } from '@/types/activity';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { MONSTERS } from '@/constants/monsters';

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
 * a beat-driven animation. It is pure presentation and intentionally
 * has no combat HUD; target HP is rendered in the primary diorama.
 */
export const ActionStage: React.FC<ActionStageProps> = ({ kind, targetOverride, hunterOverride, className }) => {
  const liveTargetId = useKillCycleStore((s) => s.currentTargetId);
  const liveTargetSprite = (() => {
    if (kind !== 'roaming_loot') return undefined;
    if (targetOverride) return targetOverride;
    if (!liveTargetId) return undefined;
    return MONSTERS.find((m) => m.id === liveTargetId)?.visualKey;
  })();

  const assets = getStageAssetsForKind(kind, { targetSprite: liveTargetSprite ?? targetOverride });
  const stage = useActionStageOrchestrator(kind);
  const isDead = useSurvivalStore((s) => s.isDead);
  const effectiveBeat: ActionAnimationBeat = isDead ? 'hunter-down' : stage.currentBeat;

  const beat = resolveBeat(effectiveBeat, {
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
        background: `linear-gradient(180deg, ${assets.accentColor}14 0%, transparent 100%)`,
      }}
    >
      <div
        className="absolute right-1 top-1 border border-border bg-bg/85 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-amber"
        data-testid="action-stage-label"
      >
        {assets.stageLabel}
      </div>

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

      <div
        className="absolute bottom-1 right-1 text-[8px] font-black uppercase tracking-widest text-text-muted"
        data-testid="action-stage-now-happening"
      >
        → {stage.currentBeat}
      </div>

      <BeatLayer beat={beat} target="stage" reducedMotion={stage.reducedMotion}>
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

        {assets.targetSprite && !isDead && (
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

        {assets.surfaceSprite && !assets.targetSprite && !isDead && (
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

        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-px -translate-x-1/2 -translate-y-1/2"
          style={{ background: `${assets.accentColor}30` }}
          aria-hidden
        />
      </BeatLayer>
    </div>
  );
};

const BeatLayer: React.FC<{
  beat: BeatRender;
  target: BeatRender['target'];
  reducedMotion: boolean;
  children: React.ReactNode;
}> = ({ beat, target, reducedMotion, children }) => {
  if (beat.target !== target) {
    return <>{children}</>;
  }

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

/** StageSprite — placeholder renderer for a sprite given a visualKey. */
export const StageSprite: React.FC<{
  visualKey: string;
  size: number;
  accentColor?: string;
  className?: string;
}> = ({ visualKey, size, accentColor, className }) => (
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
