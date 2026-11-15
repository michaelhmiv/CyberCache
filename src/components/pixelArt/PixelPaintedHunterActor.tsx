import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { PixelSprite } from '@/lib/pixel/manifest';
import { SKELETON } from '@/lib/pixel/parts';
import { paintedPlacement } from '@/lib/pixel/paintedStage';
import {
  STRIDE_PERIOD_MS,
  sampleStride,
  strideEnvelopeAt,
  strideEnvelopeStartMs,
  type StrideSpec,
} from '@/lib/pixel/strideCycle';
import { usePresentationActive } from '@/hooks/usePresentationActive';

/**
 * The painted hunter (Cache Hunters slice (c); owner ruling
 * 2026-11-15 — PAINTINGS ONLY ON STAGE). One whole painting is the
 * stage figure: no part layers, no compositor weapon (the
 * painting's signature weapon is part of the character; the
 * equipped weapon keeps displaying on Gear / cards / loadouts,
 * never here).
 *
 * Seating mirrors PixelActor's flat-actor math: the box's bottom
 * sits on the ground line, the inner wrapper shifts by the feet
 * anchor so the anchor lands exactly on the placement mark, and
 * breathing scales around the feet. The height runs through the
 * painting width law (paintedStage.ts) so the figure can never
 * paint past the stage edge. Reactions (dodge, recoil, hops) stay
 * with the caller's wrapper — this actor only seats the painting.
 *
 * The travel stride cannot articulate a painting's legs; it
 * survives as the stride spec's torso bob, whole-figure, driven by
 * the same envelope bookkeeping PixelPartsActor runs (engage ramp
 * from the spec, one-period decay on disengage).
 */
export interface PixelPaintedHunterActorProps {
  sprite: PixelSprite;
  xPct: number;
  heightPct: number;
  groundY: number;
  reduced?: boolean;
  breathe?: boolean;
  breatheDuration?: number;
  strideCycle?: { spec: StrideSpec; active: boolean };
  zIndex?: number;
  testId?: string;
}

export const PixelPaintedHunterActor: React.FC<PixelPaintedHunterActorProps> = ({
  sprite,
  xPct,
  heightPct,
  groundY,
  reduced = false,
  breathe = true,
  breatheDuration = 2.7,
  strideCycle,
  zIndex = 10,
  testId,
}) => {
  const presentationActive = usePresentationActive();
  const placement = paintedPlacement(sprite, { xPct, heightPct, groundY });
  const feet = sprite.anchors.feet ?? { x: 0.5, y: 1 };
  const boxRef = useRef<HTMLDivElement | null>(null);
  const bobRef = useRef<HTMLDivElement | null>(null);

  const strideSpec = strideCycle?.spec;
  const strideActive = strideCycle?.active ?? false;
  const strideRunRef = useRef<{ start: number | null; stopAt: number | null; ampAtStop: number }>({
    start: null,
    stopAt: null,
    ampAtStop: 0,
  });
  useEffect(() => {
    const bobEl = bobRef.current;
    if (!presentationActive || !bobEl) return;
    if (!strideSpec || reduced) {
      strideRunRef.current = { start: null, stopAt: null, ampAtStop: 0 };
      bobEl.style.transform = '';
      return;
    }
    let raf = 0;
    const run = strideRunRef.current;
    const applyBob = (torsoY: number) => {
      const boxH = boxRef.current?.clientHeight ?? 0;
      const bobPx = (torsoY * boxH) / SKELETON.frameHeight;
      bobEl.style.transform = bobPx ? `translateY(${bobPx.toFixed(2)}px)` : '';
    };
    const tick = (now: number) => {
      if (strideActive) {
        run.stopAt = null;
        if (run.start === null) run.start = now;
        const localMs = now - run.start;
        const phaseMs = localMs - strideEnvelopeStartMs(strideSpec);
        if (phaseMs >= 0) {
          const amp = strideEnvelopeAt(strideSpec, localMs);
          applyBob(sampleStride(strideSpec, phaseMs, amp).poseDelta.torso?.y ?? 0);
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      if (run.start === null || now - run.start < strideEnvelopeStartMs(strideSpec)) {
        run.start = null;
        bobEl.style.transform = '';
        return;
      }
      if (run.stopAt === null) {
        run.stopAt = now;
        run.ampAtStop = strideEnvelopeAt(strideSpec, now - run.start);
      }
      const amp = run.ampAtStop * Math.max(0, 1 - (now - run.stopAt) / STRIDE_PERIOD_MS);
      if (amp <= 0) {
        run.start = null;
        run.stopAt = null;
        bobEl.style.transform = '';
        return;
      }
      applyBob(
        sampleStride(strideSpec, now - run.start - strideEnvelopeStartMs(strideSpec), amp).poseDelta.torso?.y ?? 0,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [strideSpec, strideActive, reduced, presentationActive]);

  return (
    <div
      ref={boxRef}
      className="absolute"
      data-testid={testId}
      data-sprite={sprite.id}
      data-painted-hunter={sprite.id}
      style={{
        height: `${placement.heightPct}%`,
        aspectRatio: `${sprite.width} / ${sprite.height}`,
        left: `${placement.xPct}%`,
        top: `calc(${groundY * 100}% - ${placement.heightPct * feet.y}%)`,
        zIndex,
      }}
    >
      <div ref={bobRef} className="h-full w-full">
        <motion.div
          className="h-full w-full"
          style={{ x: `${-feet.x * 100}%`, transformOrigin: `${feet.x * 100}% 100%` }}
          animate={reduced || !breathe ? undefined : { scaleY: [1, 1.015, 1] }}
          transition={reduced || !breathe ? undefined : { duration: breatheDuration, repeat: Infinity, ease: 'easeInOut' }}
          initial={false}
        >
          <img
            src={sprite.url}
            alt=""
            draggable={false}
            className="h-full w-full"
            style={{ imageRendering: 'pixelated' }}
          />
        </motion.div>
      </div>
    </div>
  );
};
