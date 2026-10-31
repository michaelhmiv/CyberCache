import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { getPixelSprite, requirePixelSprite } from '@/lib/pixel/manifest';
import { MOVEMENT } from '@/lib/pixel/movement';
import type { RigDef, RigPose } from '@/lib/pixel/rig';
import { paletteSpriteUrl, type PaletteSpec } from '@/lib/pixel/paletteSwap';

interface PixelRigActorProps {
  rig: RigDef;
  /** Stage position of the rig's feet anchor, as % of stage width. */
  xPct: number;
  /** Actor height as % of stage height. */
  heightPct: number;
  groundY: number;
  /** Feet anchor x as a fraction of the rig frame width. */
  feetX?: number;
  flip?: boolean;
  zIndex?: number;
  reduced?: boolean;
  /** Current pose; transitions run on SEGMENT timings. */
  pose?: RigPose;
  /** Per-segment sprite URL overrides (palette swaps, head variants
   *  are baked into the RigDef instead — this is for async swaps). */
  palette?: { paletteId: string; spec: PaletteSpec };
  testId?: string;
  children?: React.ReactNode;
}

/**
 * A segmented actor (overhaul §4): the shipped sprite, cut into jointed
 * segments by scripts/pixel-segments.py and posed by code. At the idle
 * pose the segments reassemble into the exact original sprite; poses
 * rotate segments around their manifest pivots with transform only.
 */
export const PixelRigActor: React.FC<PixelRigActorProps> = ({
  rig,
  xPct,
  heightPct,
  groundY,
  feetX = 0.5,
  flip = false,
  zIndex = 10,
  reduced = false,
  pose,
  palette,
  testId,
  children,
}) => {
  const [, setSwapTick] = useState(0);
  // Preload palette swaps; when they land in the cache, re-render so
  // the segments pick up the swapped data URLs.
  useEffect(() => {
    if (!palette) return;
    let cancelled = false;
    let pending = rig.segments.length;
    for (const seg of rig.segments) {
      const sprite = getPixelSprite(seg.spriteId);
      if (!sprite) {
        pending -= 1;
        continue;
      }
      const img = new Image();
      img.onload = () => {
        paletteSpriteUrl(seg.spriteId, sprite.url, palette.paletteId, palette.spec);
        pending -= 1;
        if (!cancelled && pending <= 0) setSwapTick((t) => t + 1);
      };
      img.onerror = () => {
        pending -= 1;
      };
      img.src = sprite.url;
    }
    return () => {
      cancelled = true;
    };
  }, [palette, rig]);

  const segments = useMemo(
    () =>
      rig.segments.map((seg) => {
        const sprite = requirePixelSprite(seg.spriteId);
        const src = palette
          ? paletteSpriteUrl(seg.spriteId, sprite.url, palette.paletteId, palette.spec)
          : sprite.url;
        const pivot = sprite.anchors.pivot ?? { x: 0.5, y: 0.5 };
        const segPose = pose?.[seg.id] ?? {};
        const isArm = seg.id.startsWith('arm');
        const isHead = seg.id === 'head';
        const duration = reduced
          ? 0
          : (isArm
              ? MOVEMENT.SEGMENT.ARM_RAISE_MS
              : isHead
                ? MOVEMENT.SEGMENT.HEAD_TRACK_MS
                : MOVEMENT.SEGMENT.STEP_BOB_MS) / 1000;
        return { seg, src, pivot, segPose, duration };
      }),
    [rig, pose, palette, reduced],
  );

  return (
    <div
      className="absolute"
      data-testid={testId}
      data-rig={rig.id}
      style={{
        height: `${heightPct}%`,
        aspectRatio: `${rig.frameWidth} / ${rig.frameHeight}`,
        left: `${xPct}%`,
        top: `calc(${groundY * 100}% - ${heightPct}%)`,
        zIndex,
      }}
    >
      <div
        className="relative h-full w-full"
        style={{ transform: `translateX(${-feetX * 100}%) ${flip ? 'scaleX(-1)' : ''}` }}
      >
        {segments.map(({ seg, src, pivot, segPose, duration }) => (
          <motion.img
            key={seg.id}
            src={src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute"
            style={{
              left: `${(seg.frameX / rig.frameWidth) * 100}%`,
              top: `${(seg.frameY / rig.frameHeight) * 100}%`,
              width: `${(seg.width / rig.frameWidth) * 100}%`,
              height: `${(seg.height / rig.frameHeight) * 100}%`,
              imageRendering: 'pixelated',
              zIndex: seg.z,
              transformOrigin: `${pivot.x * 100}% ${pivot.y * 100}%`,
            }}
            initial={false}
            animate={{
              rotate: segPose.rotate ?? 0,
              // Pose offsets are frame pixels; framer percentages are
              // element-relative, which keeps them scale-correct.
              x: segPose.x ? `${(segPose.x / seg.width) * 100}%` : 0,
              y: segPose.y ? `${(segPose.y / seg.height) * 100}%` : 0,
              opacity: segPose.opacity ?? 1,
            }}
            transition={{ duration, ease: 'easeOut' }}
          />
        ))}
        {children}
      </div>
    </div>
  );
};
