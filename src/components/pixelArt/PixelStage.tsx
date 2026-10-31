import React, { useEffect } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { anchorPoint, getPixelSprite, requirePixelSprite } from '@/lib/pixel/manifest';
import { MOVEMENT, shakeKeyframes } from '@/lib/pixel/movement';
import { areaVisuals } from '@/content/areaPalettes';
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
  /** Overhaul §4.5: when set (and the zone's layer re-cuts exist), the
   *  stage renders far/mid/near parallax layers over the base plate,
   *  plus the area's animated props and weather tint. */
  areaId?: string;
  /** Hot-area treatment (§3.5): sky shift + pennant + ember color. */
  hot?: boolean;
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
  areaId,
  hot = false,
}) => {
  const background = requirePixelSprite(backgroundId);
  const ground = groundY ?? background.anchors.groundLine?.y ?? 0.86;
  // Parallax layers exist for zone backgrounds (zone-<slug>-bg); the
  // re-cuts are zone-<slug>-far/-mid/-near in the manifest.
  const zoneSlug = backgroundId.startsWith('zone-') && backgroundId.endsWith('-bg')
    ? backgroundId.slice('zone-'.length, -'-bg'.length)
    : undefined;
  const farLayer = zoneSlug && areaId ? getPixelSprite(`zone-${zoneSlug}-far`) : undefined;
  const midLayer = zoneSlug && areaId ? getPixelSprite(`zone-${zoneSlug}-mid`) : undefined;
  const nearLayer = zoneSlug && areaId ? getPixelSprite(`zone-${zoneSlug}-near`) : undefined;
  const visuals = areaId ? areaVisuals(areaId) : undefined;
  const pennant = hot ? getPixelSprite('prop-hot-pennant') : undefined;
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
        {/* Parallax re-cuts (overhaul §4.5): far drifts least, near
            most; all motion is transform-only. The base plate stays
            underneath so bands can never gap. */}
        {farLayer && (
          <motion.img
            src={farLayer.url}
            alt=""
            draggable={false}
            data-testid="pixel-layer-far"
            className="pointer-events-none absolute left-0 top-0 w-full object-cover"
            style={{ height: '62%', imageRendering: 'pixelated' }}
            animate={reduced ? undefined : { x: [0, -6, 0], scale: [1.02, 1.05, 1.02] }}
            transition={reduced ? undefined : { duration: 26, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        {midLayer && (
          <motion.img
            src={midLayer.url}
            alt=""
            draggable={false}
            data-testid="pixel-layer-mid"
            className="pointer-events-none absolute left-0 w-full object-cover"
            style={{ top: '36%', height: '52%', imageRendering: 'pixelated' }}
            animate={reduced ? undefined : { x: [0, -14, 0] }}
            transition={reduced ? undefined : { duration: 19, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        {nearLayer && (
          <motion.img
            src={nearLayer.url}
            alt=""
            draggable={false}
            data-testid="pixel-layer-near"
            className="pointer-events-none absolute left-0 w-full object-cover"
            style={{
              top: '70%',
              height: '32%',
              imageRendering: 'pixelated',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 30%)',
              maskImage: 'linear-gradient(to bottom, transparent, black 30%)',
            }}
            animate={reduced ? undefined : { x: [0, -22, 0] }}
            transition={reduced ? undefined : { duration: 13, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        {/* Weather tint + hot-area sky shift (color/opacity only). */}
        {visuals && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0"
            data-testid="pixel-weather"
            data-weather={visuals.weather}
            style={{
              height: '46%',
              background: `linear-gradient(to bottom, ${visuals.skyTint}${hot ? '55' : '2e'}, transparent)`,
            }}
          />
        )}
        {/* The area's animated props drift across the mid band. */}
        {visuals &&
          !reduced &&
          visuals.animatedProps.map((propId, i) => {
            const prop = getPixelSprite(propId);
            if (!prop) return null;
            return (
              <motion.img
                key={propId}
                src={prop.url}
                alt=""
                draggable={false}
                data-testid={`pixel-aprop-${propId}`}
                className="pointer-events-none absolute"
                style={{
                  top: `${18 + i * 16}%`,
                  width: 44,
                  imageRendering: 'pixelated',
                  opacity: 0.85,
                }}
                initial={{ left: '-8%' }}
                animate={{ left: '104%' }}
                transition={{ duration: 34 + i * 17, repeat: Infinity, ease: 'linear', delay: i * 9 }}
              />
            );
          })}
        {hot && pennant && (
          <img
            src={pennant.url}
            alt=""
            draggable={false}
            data-testid="pixel-hot-pennant"
            className="pointer-events-none absolute right-2 top-2"
            style={{ width: 40, imageRendering: 'pixelated' }}
          />
        )}
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
