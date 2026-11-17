import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
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
import {
  WORK_CYCLE_PERIOD_MS,
  WORK_CYCLE_START_DELAY_MS,
  sampleWorkCycle,
  type WorkCycleSpec,
} from '@/lib/pixel/workCycle';
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
 * from the spec, one-period decay on disengage). The root carries
 * the same data-stride-cycle / data-stride-active observability
 * PixelPartsActor exposes — the M2b travel-beat tests pin that
 * contract on whichever actor seats the hunter. The active flag
 * mirrors the parts actor's strideDrives semantics: 'true' while
 * the stride is actually driving the figure (bob applied, through
 * the settle tail), tracked as state in the bob loop — mirroring
 * the raw travelActive prop instead proved unobservable, because
 * the 850 ms window can open and close inside one batched render
 * in the test environment while the pose state the parts actor
 * exposed always committed.
 *
 * The work cycle (bench / extraction / stall modes) gets the same
 * treatment: a painting has no arm to articulate, so the cycle
 * survives as the sampled spec's torso channel driving the same
 * bob element — wind-up rise, strike sink — on the parts actor's
 * own engagement shape (start delay, one-period ramp, one-period
 * decay on disengage). BenchFx carries the strike read at the
 * work point; the rig's pose system is NOT recreated (device-pass
 * fix round, 2026-11-17). The root carries data-work-cycle /
 * data-cycle-active with the parts actor's semantics, and a bound
 * work cycle suppresses the stride, exactly as on the rig.
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
  workCycle?: { spec: WorkCycleSpec; active: boolean };
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
  workCycle,
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
  // Whether the stride is actually driving the figure right now
  // (envelope engaged, bob being applied, through the settle
  // tail) — the exact analogue of PixelPartsActor's strideDrives
  // (!!stridePose), held in state so the root's data-stride-active
  // observability commits like the parts actor's does.
  const [strideDriving, setStrideDriving] = useState(false);
  const strideDrivingRef = useRef(false);
  const wcSpec = workCycle?.spec;
  const wcActive = workCycle?.active ?? false;
  useEffect(() => {
    const bobEl = bobRef.current;
    if (!presentationActive || !bobEl) return;
    const markDriving = (v: boolean) => {
      if (strideDrivingRef.current !== v) {
        strideDrivingRef.current = v;
        setStrideDriving(v);
      }
    };
    // A bound work cycle suppresses the stride entirely (the
    // parts actor's law: bench modes own the figure; the two
    // choreographies never stack).
    if (!strideSpec || wcSpec || reduced) {
      strideRunRef.current = { start: null, stopAt: null, ampAtStop: 0 };
      bobEl.style.transform = '';
      markDriving(false);
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
          markDriving(true);
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      if (run.start === null || now - run.start < strideEnvelopeStartMs(strideSpec)) {
        run.start = null;
        bobEl.style.transform = '';
        markDriving(false);
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
        markDriving(false);
        return;
      }
      applyBob(
        sampleStride(strideSpec, now - run.start - strideEnvelopeStartMs(strideSpec), amp).poseDelta.torso?.y ?? 0,
      );
      markDriving(true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [strideSpec, strideActive, wcSpec, reduced, presentationActive]);

  // ── Work cycle ──────────────────────────────────────────────
  // The parts actor's engagement shape, sampled onto the bob:
  // start delay while the figure settles at the station, a
  // one-period amplitude ramp in, a one-period decay out on
  // disengage (the held stance between jobs is the painting at
  // rest — BenchFx and the bench seat carry the work read).
  const cycleRunRef = useRef<{ start: number | null; stopAt: number | null; ampAtStop: number }>({
    start: null,
    stopAt: null,
    ampAtStop: 0,
  });
  const [cycleDriving, setCycleDriving] = useState(false);
  const cycleDrivingRef = useRef(false);
  useEffect(() => {
    const bobEl = bobRef.current;
    if (!presentationActive || !bobEl) return;
    const markDriving = (v: boolean) => {
      if (cycleDrivingRef.current !== v) {
        cycleDrivingRef.current = v;
        setCycleDriving(v);
      }
    };
    if (!wcSpec || reduced) {
      cycleRunRef.current = { start: null, stopAt: null, ampAtStop: 0 };
      if (!strideSpec) bobEl.style.transform = '';
      markDriving(false);
      return;
    }
    let raf = 0;
    const run = cycleRunRef.current;
    const applyBob = (torsoY: number) => {
      const boxH = boxRef.current?.clientHeight ?? 0;
      const bobPx = (torsoY * boxH) / SKELETON.frameHeight;
      bobEl.style.transform = bobPx ? `translateY(${bobPx.toFixed(2)}px)` : '';
    };
    const tick = (now: number) => {
      if (wcActive) {
        run.stopAt = null;
        if (run.start === null) run.start = now + WORK_CYCLE_START_DELAY_MS;
        if (now >= run.start) {
          const elapsed = now - run.start;
          const amp = Math.min(1, elapsed / WORK_CYCLE_PERIOD_MS);
          applyBob(sampleWorkCycle(wcSpec, elapsed, amp).poseDelta.torso?.y ?? 0);
          markDriving(true);
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      if (run.start === null || now < run.start) {
        run.start = null;
        bobEl.style.transform = '';
        markDriving(false);
        return;
      }
      if (run.stopAt === null) {
        run.stopAt = now;
        run.ampAtStop = Math.min(1, (now - run.start) / WORK_CYCLE_PERIOD_MS);
      }
      const amp = run.ampAtStop * Math.max(0, 1 - (now - run.stopAt) / WORK_CYCLE_PERIOD_MS);
      if (amp <= 0) {
        run.start = null;
        run.stopAt = null;
        bobEl.style.transform = '';
        markDriving(false);
        return;
      }
      applyBob(sampleWorkCycle(wcSpec, now - run.start, amp).poseDelta.torso?.y ?? 0);
      markDriving(true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [wcSpec, wcActive, strideSpec, reduced, presentationActive]);

  return (
    <div
      ref={boxRef}
      className="absolute"
      data-testid={testId}
      data-sprite={sprite.id}
      data-painted-hunter={sprite.id}
      data-stride-cycle={strideSpec?.id}
      data-stride-active={strideDriving && !reduced ? 'true' : undefined}
      data-work-cycle={wcSpec?.id}
      data-cycle-active={cycleDriving && !reduced ? 'true' : undefined}
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
