import React, { useEffect } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { anchorPoint, requirePixelSprite } from '@/lib/pixel/manifest';
import { MOVEMENT, shakeKeyframes } from '@/lib/pixel/movement';
import { PixelEmbers } from './PixelFx';

/**
 * PixelStage (P1, movement system P2) — the anchor-driven stage for pixel
 * scenes.
 *
 * A stage is one background sprite (with slow engine drift, per the movement
 * spec) plus actors placed by their manifest anchors: an actor's FEET anchor
 * lands exactly on the stage position you give it, so ground contact never
 * drifts between sprites of different sizes.
 *
 * P2 adds the stage-level movement kit: ambient embers, and screen shake —
 * pass a fresh `shakeKey` (e.g. the beat's event id) with an intensity and
 * the whole scene (background + actors) shakes on the deterministic
 * keyframes from the movement module. Reduced motion disables drift,
 * embers, and shake; the scene state stays fully readable.
 *
 * Presentation only — the stage reads props/state and renders. It produces
 * no gameplay outcomes.
 */

interface PixelStageProps {
  backgroundId: string;
  /** Ground line as a fraction of stage height (0..1). Default: the
   *  background sprite's groundLine anchor, else 0.86. */
  groundY?: number;
  reduced?: boolean;
  /** Ambient rising embers over the scene (idle life). */
  embers?: boolean;
  /** Changing this value triggers one screen shake. */
  shakeKey?: string;
  /** Peak shake offset in px (hits ~3, crits ~7, kills ~5). */
  shakeIntensity?: number;
  shakeDurationMs?: number;
  children?: React.ReactNode;
  testId?: string;
}

export const PixelStage: React.FC<PixelStageProps> = ({
  backgroundId,
  groundY,
  reduced = false,
  embers = false,
  shakeKey,
  shakeIntensity = 0,
  shakeDurationMs,
  children,
  testId,
}) => {
  const background = requirePixelSprite(backgroundId);
  const ground = groundY ?? background.anchors.groundLine?.y ?? 0.86;
  const shakeControls = useAnimationControls();
  // A fresh shakeKey plays one deterministic shake over the whole scene.
  // Controls (not a remount) so actors/entrances are never restarted.
  useEffect(() => {
    if (reduced || !shakeKey || shakeIntensity <= 0) return;
    const frames = shakeKeyframes(shakeKey, shakeIntensity);
    void shakeControls.start({
      x: frames.x,
      y: frames.y,
      transition: { duration: (shakeDurationMs ?? MOVEMENT.SHAKE_MS + 140) / 1000, ease: 'easeOut' },
    });
  }, [shakeKey, shakeIntensity, shakeDurationMs, reduced, shakeControls]);
  return (
    <div className="absolute inset-0 overflow-hidden" data-testid={testId ?? 'pixel-stage'} data-ground-y={ground}>
      <motion.div className="absolute inset-0" data-testid="pixel-stage-shake" animate={shakeControls}>
        <motion.img
          src={background.url}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ imageRendering: 'pixelated' }}
          animate={reduced ? undefined : { scale: [1.04, 1.1, 1.04] }}
          transition={reduced ? undefined : { duration: (MOVEMENT.BG_DRIFT_HALF_MS * 2) / 1000, repeat: Infinity, ease: 'easeInOut' }}
        />
        {children}
        {embers && <PixelEmbers seed={backgroundId} reduced={reduced} />}
      </motion.div>
    </div>
  );
};

interface PixelActorProps {
  spriteId: string;
  /** Stage position of the actor's feet anchor, as % of stage width. */
  xPct: number;
  /** Actor height as % of stage height. Width follows the sprite aspect. */
  heightPct: number;
  groundY: number;
  flip?: boolean;
  zIndex?: number;
  reduced?: boolean;
  /** Breathing idle (movement spec: scale 1<->1.015, 2.3-3.2s loops). */
  breathe?: boolean;
  breatheDuration?: number;
  /**
   * Entrance choreography (P2): 'walk' = walk-in with step-bob from the
   * `enterFrom` side; 'drop' = heavy landing from above (pair with a
   * DustPuff at DROP_IN_MS via onLanded). Skipped under reduced motion.
   */
  entrance?: 'none' | 'walk' | 'drop';
  enterFrom?: 'left' | 'right';
  onLanded?: () => void;
  testId?: string;
  children?: React.ReactNode;
}

/**
 * Places a sprite so its feet anchor sits at (xPct, groundY) of the stage.
 * Children render inside the actor box (e.g. a held weapon at the grip
 * anchor) and inherit flip/breathing.
 */
export const PixelActor: React.FC<PixelActorProps> = ({
  spriteId,
  xPct,
  heightPct,
  groundY,
  flip = false,
  zIndex = 10,
  reduced = false,
  breathe = true,
  breatheDuration = 2.7,
  entrance = 'none',
  enterFrom = 'left',
  onLanded,
  testId,
  children,
}) => {
  const sprite = requirePixelSprite(spriteId);
  const feet = anchorPoint(sprite, 'feet', 100, 100);
  const playEntrance = !reduced && entrance !== 'none';
  // Outer box: its top-left sits at (xPct, groundY - height). The inner
  // wrapper shifts by -feet.x of the ACTOR's own width (translateX % is
  // element-relative), so the feet anchor lands exactly on xPct regardless
  // of sprite size. Breathing scales around the feet anchor. The entrance
  // animates the outer box in element-relative offsets, so the anchor
  // math is untouched once the actor arrives.
  return (
    <motion.div
      className="absolute"
      data-testid={testId}
      data-sprite={spriteId}
      data-entrance={playEntrance ? entrance : 'none'}
      style={{
        height: `${heightPct}%`,
        aspectRatio: `${sprite.width} / ${sprite.height}`,
        left: `${xPct}%`,
        top: `calc(${groundY * 100}% - ${heightPct}%)`,
        zIndex,
      }}
      initial={
        !playEntrance
          ? false
          : entrance === 'walk'
            ? { x: enterFrom === 'left' ? '-190%' : '190%', opacity: 0 }
            : { x: 0, y: '-55%', opacity: 0 }
      }
      animate={
        !playEntrance
          ? { x: 0, y: 0, opacity: 1 }
          : entrance === 'walk'
            ? { x: '0%', opacity: 1 }
            : { x: 0, y: '0%', opacity: 1 }
      }
      transition={
        !playEntrance
          ? { duration: 0.1 }
          : entrance === 'walk'
            ? { duration: MOVEMENT.WALK_IN_MS / 1000, ease: 'easeOut' }
            : { duration: MOVEMENT.DROP_IN_MS / 1000, ease: 'easeIn' }
      }
      onAnimationComplete={() => {
        if (playEntrance && entrance === 'drop') onLanded?.();
      }}
    >
      {/* Step-bob rides its own wrapper: framer needs matching keyframe /
          times counts per animate object, so the bob never mixes with
          the outer slide's scalar targets. */}
      <motion.div
        className="h-full w-full"
        animate={playEntrance && entrance === 'walk' ? { y: [0, -5, 0, -5, 0] } : { y: 0 }}
        transition={playEntrance && entrance === 'walk' ? { duration: MOVEMENT.WALK_IN_MS / 1000, ease: 'easeInOut' } : { duration: 0.1 }}
        initial={false}
      >
        <motion.div
          className="h-full w-full"
          style={{ x: `${-feet.x}%`, transformOrigin: `${feet.x}% 100%` }}
          animate={reduced || !breathe ? undefined : { scaleY: [1, 1.015, 1] }}
          transition={reduced || !breathe ? undefined : { duration: breatheDuration, repeat: Infinity, ease: 'easeInOut' }}
          initial={false}
        >
          <img
            src={sprite.url}
            alt=""
            draggable={false}
            className="h-full w-full"
            style={{ imageRendering: 'pixelated', transform: flip ? 'scaleX(-1)' : undefined }}
          />
          {children}
        </motion.div>
      </motion.div>
    </motion.div>
  );
};
