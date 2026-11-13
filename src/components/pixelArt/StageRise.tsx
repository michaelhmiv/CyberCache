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
 * time is `lootRiseTotalMs()` (~2.95 s, one tick) — the pre-R2
 * rises cut at 0.95–1.6 s, which is why drops "weren't showing
 * up" on device (owner report, 2026-11-12).
 *
 * The chip's box BOTTOM sits on the origin point (an enemy's
 * feet, the sift rig, the bench seat): content stacks from the
 * ground up and the track carries it up off that point. Durations
 * all come from MOVEMENT; the pixel offsets are this component's
 * presentation geometry.
 *
 * `liftPx` is the hold height — how far the track carries the
 * chip's bottom off its origin. The default (38) suits the work
 * points (bench / crusher / sift rig), whose seats are already
 * elevated. The roam drop rises pass ROAM_DROP_LIFT_PX instead:
 * their origin is the corpse's feet, which is also the enemy name
 * plate's ground — the plate's top edge rides 18.5% of the stage
 * height above that line (≈49–59 px across phone widths), so a
 * chip holding at the default lift spends its readable window
 * inside the plate's box (fix round 1, 2026-11-13: the owner's
 * "I still don't see the actual item being dropped" — the chip
 * was behind the plate, its icon canvas unpainted, its label a
 * 4-letter tag straddling the plate's edge). At 74 px the whole
 * chip — icon + full item name — holds clear above the plate at
 * every phone width, still standing on the corpse beam.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { MOVEMENT, lootRiseTotalMs } from '@/lib/pixel/movement';

const TOTAL_MS = lootRiseTotalMs();
/** Rise segment ends (fraction of the total schedule). */
const RISE_END = MOVEMENT.LOOT_RISE_MS / TOTAL_MS;
/** Hold ends / fade begins (fraction of the total schedule). */
const HOLD_END = (MOVEMENT.LOOT_RISE_MS + MOVEMENT.LOOT_RISE_HOLD_MS) / TOTAL_MS;

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
      y: { duration: TOTAL_MS / 1000, delay: delayMs / 1000, times: [0, RISE_END, 0.55, HOLD_END, 1], ease: 'easeOut' },
      opacity: { duration: TOTAL_MS / 1000, delay: delayMs / 1000, times: [0, 0.085, HOLD_END, 1] },
      scale: { duration: TOTAL_MS / 1000, delay: delayMs / 1000, times: [0, 0.18, RISE_END, HOLD_END, 1] },
    }}
  >
    {children}
  </motion.div>
);
