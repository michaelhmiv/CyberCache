import React from 'react';
import { motion } from 'framer-motion';
import { anchorPoint, requirePixelSprite } from '@/lib/pixel/manifest';

/**
 * PixelStage (P1) — the anchor-driven stage for pixel scenes.
 *
 * A stage is one background sprite (with slow engine drift, per the movement
 * spec) plus actors placed by their manifest anchors: an actor's FEET anchor
 * lands exactly on the stage position you give it, so ground contact never
 * drifts between sprites of different sizes. Choreography (P2) builds on
 * this; P1 ships placement + idle breathing only.
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
  children?: React.ReactNode;
  testId?: string;
}

export const PixelStage: React.FC<PixelStageProps> = ({ backgroundId, groundY, reduced = false, children, testId }) => {
  const background = requirePixelSprite(backgroundId);
  const ground = groundY ?? background.anchors.groundLine?.y ?? 0.86;
  return (
    <div className="absolute inset-0 overflow-hidden" data-testid={testId ?? 'pixel-stage'} data-ground-y={ground}>
      <motion.img
        src={background.url}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ imageRendering: 'pixelated' }}
        animate={reduced ? undefined : { scale: [1.04, 1.1, 1.04] }}
        transition={reduced ? undefined : { duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      {children}
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
  testId,
  children,
}) => {
  const sprite = requirePixelSprite(spriteId);
  const feet = anchorPoint(sprite, 'feet', 100, 100);
  // Outer box: its top-left sits at (xPct, groundY - height). The inner
  // wrapper shifts by -feet.x of the ACTOR's own width (translateX % is
  // element-relative), so the feet anchor lands exactly on xPct regardless
  // of sprite size. Breathing scales around the feet anchor.
  return (
    <div
      className="absolute"
      data-testid={testId}
      data-sprite={spriteId}
      style={{
        height: `${heightPct}%`,
        aspectRatio: `${sprite.width} / ${sprite.height}`,
        left: `${xPct}%`,
        top: `calc(${groundY * 100}% - ${heightPct}%)`,
        zIndex,
      }}
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
    </div>
  );
};
