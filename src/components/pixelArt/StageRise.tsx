/**
 * StageRise — the shared stage rise chip (Stage Iteration R2).
 *
 * Every "something was gained" rise on the stages — a roaming
 * material drop, a crate, a settled extraction pass's finds, the
 * bench's completion yield, the crusher's salvage yield — rides
 * ONE schedule so the game's reward grammar reads the same
 * everywhere: the rise MOTION keeps its Sample-B law length
 * (MOVEMENT.LOOT_RISE_MS), then the chip HOLDS at its apex, icon
 * and label fully readable, before a short fade. Total on-stage
 * time is STAGE_RISE_TOTAL_MS (~3.15 s, one tick).
 *
 * The chip's box BOTTOM sits on the origin point (the fallen
 * enemy's feet): content stacks from the ground up and the track
 * carries it up off that point. Durations all come from MOVEMENT;
 * the pixel offsets are this component's presentation geometry.
 *
 * `liftPx` is the hold height — how far the track carries the
 * chip's bottom off its origin. The default (38) suits the work
 * points (bench / crusher / sift rig). The roam drop rises pass
 * ROAM_DROP_LIFT_PX instead: their origin is the corpse's feet,
 * which is also the enemy name plate's ground — the plate's top
 * edge rides 18.5% of the stage height above that line, so a chip
 * holding at the default lift sits inside the plate's box. At
 * 74 px the whole chip — icon + full item name — holds clear of
 * the plate at every phone width.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { MOVEMENT } from '@/lib/pixel/movement';

/** Fade tail after the hold (reference: 300 ms). */
export const STAGE_RISE_FADE_MS = 300;
/** Total on-stage time: rise + hold + fade. */
export const STAGE_RISE_TOTAL_MS =
  MOVEMENT.LOOT_RISE_MS + MOVEMENT.LOOT_RISE_HOLD_MS + STAGE_RISE_FADE_MS;
/** Rise segment ends (fraction of the total schedule). */
const RISE_END = MOVEMENT.LOOT_RISE_MS / STAGE_RISE_TOTAL_MS;
/** Hold ends / fade begins (fraction of the total schedule). */
const HOLD_END = (MOVEMENT.LOOT_RISE_MS + MOVEMENT.LOOT_RISE_HOLD_MS) / STAGE_RISE_TOTAL_MS;

export interface StageRiseProps {
  /** Origin point, % of the stage box (the feet / work point). */
  xPct: number;
  yPct: number;
  width?: number;
  height?: number;
  /** Hold height (px the chip's bottom rises off its origin).
   *  Default 38 — the work-point travel. The roam drop rises pass
   *  ROAM_DROP_LIFT_PX so the chip holds clear of the name plate. */
  liftPx?: number;
  /** Presentation stagger inside a beat (extraction fan), ms. */
  delayMs?: number;
  testId?: string;
  dataTone?: string;
  /** Extra data-* attributes (rise kind/qty bookkeeping for tests). */
  dataAttrs?: Record<string, string | number>;
  children: React.ReactNode;
}

/** Hold height for the roam drop rises (material + crate), whose
 *  origin — the fallen enemy's feet — is shared with the enemy
 *  name plate. Clears the plate's top edge (≈18.5% of stage
 *  height above the ground line) with margin at every phone
 *  width; see the header note. */
export const ROAM_DROP_LIFT_PX = 74;

export const StageRise: React.FC<StageRiseProps> = ({
  xPct,
  yPct,
  width = 46,
  height = 58,
  liftPx = 38,
  delayMs = 0,
  testId,
  dataTone,
  dataAttrs,
  children,
}) => (
  <motion.div
    data-testid={testId}
    data-tone={dataTone}
    {...(dataAttrs
      ? Object.fromEntries(Object.entries(dataAttrs).map(([k, v]) => [`data-${k}`, v]))
      : {})}
    className="pointer-events-none absolute z-30 flex flex-col items-center justify-end"
    style={{
      left: `${xPct}%`,
      top: `${yPct}%`,
      width,
      height,
      marginLeft: -width / 2,
      marginTop: -height,
    }}
    initial={{ y: 10, opacity: 0, scale: 0.6 }}
    animate={{
      y: [10, -liftPx, -(liftPx - 3), -liftPx, -(liftPx + 6)],
      opacity: [0, 1, 1, 0],
      scale: [0.6, 1.12, 1, 1, 0.92],
    }}
    transition={{
      y: { duration: STAGE_RISE_TOTAL_MS / 1000, delay: delayMs / 1000, times: [0, RISE_END, 0.55, HOLD_END, 1], ease: 'easeOut' },
      opacity: { duration: STAGE_RISE_TOTAL_MS / 1000, delay: delayMs / 1000, times: [0, 0.085, HOLD_END, 1] },
      scale: { duration: STAGE_RISE_TOTAL_MS / 1000, delay: delayMs / 1000, times: [0, 0.18, RISE_END, HOLD_END, 1] },
    }}
  >
    {children}
  </motion.div>
);
