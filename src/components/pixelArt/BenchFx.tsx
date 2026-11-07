import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { PixelGridCanvas } from '@/components/pixelArt/PixelGridCanvas';
import {
  workCycleFxTracks,
  WORK_CYCLE_PERIOD_MS,
  WORK_CYCLE_START_DELAY_MS,
  type WorkCycleSpec,
} from '@/lib/pixel/workCycle';

interface BenchFxProps {
  /** The choreography spec (data) this FX executes — glow color,
   *  spark presence/color, and sweep steps all come from the row,
   *  so a new family gets its FX by adding data, never code. */
  spec: WorkCycleSpec;
  /** Cycle running. Inactive (or reduced motion) renders nothing:
   *  the reduced-motion bench is today's exact picture — a held
   *  pose at a plain set piece. */
  active: boolean;
  reduced?: boolean;
  /** Work point as % of the stage box (the bench face, the crusher
   *  mouth, the rig's arc center — the caller's set piece decides
   *  where work happens; the FX kit only executes the spec). */
  xPct: number;
  yPct: number;
  testId?: string;
}

/** Spark burst geometry (static): eight radiating strokes of
 *  varying length around the impact point — the ActivityProp
 *  vocabulary as a one-shot burst the strike envelope drives.
 *
 *  Pixel conversion (2026-11-07, SVG closure): the burst was the
 *  one FX kit still drawn as smooth SVG strokes inside the texel
 *  FX world. It is now a 20×20 texel grid (the old 40-unit box at
 *  texel 2) painted on canvas — same rays, same lengths, same
 *  center mass; the strike envelope that drives it is untouched. */
const SPARK_RAYS = [4, 11, 7, 13, 5, 10, 6, 12];

/** Rasterize the burst to a 20×20 grid ('S' = spark cell).
 *  Exported so the lint test verifies the shipped rasterizer. */
export function buildSparkBurstGrid(): string[] {
  const grid: string[][] = Array.from({ length: 20 }, () => Array(20).fill('.'));
  const plot = (x: number, y: number) => {
    if (x >= 0 && x < 20 && y >= 0 && y < 20) grid[y][x] = 'S';
  };
  SPARK_RAYS.forEach((len, i) => {
    const a = (i / SPARK_RAYS.length) * Math.PI * 2 - Math.PI / 2;
    const r0 = 2; // was 4 units from center
    const r1 = 2 + len / 2;
    const steps = Math.ceil((r1 - r0) * 4);
    for (let s = 0; s <= steps; s++) {
      const r = r0 + ((r1 - r0) * s) / steps;
      plot(Math.round(10 + Math.cos(a) * r), Math.round(10 + Math.sin(a) * r));
    }
  });
  // Center mass (was an r=2.6 circle): a plus of texels.
  plot(10, 10); plot(9, 10); plot(11, 10); plot(10, 9); plot(10, 11);
  return grid.map((r) => r.join(''));
}

const SPARK_BURST_GRID = buildSparkBurstGrid();

const SparkBurst: React.FC<{ color: string }> = ({ color }) => (
  <PixelGridCanvas
    rows={SPARK_BURST_GRID}
    palette={{ S: { color } }}
    className="h-full w-full"
    aria-hidden="true"
  />
);

/**
 * Work-cycle set-piece FX (Motion Reboot M1) — the bench's half of
 * the choreography: a work-point glow that brightens into the
 * strike, a spark burst on families whose spec carries one, and
 * sweep dots walking the arc on sweep families. Every track is
 * DERIVED from the work-cycle sampler (workCycleFxTracks), looped
 * at the law period on the same start delay the actor observes,
 * so FX and figure can never drift apart. Node cost is counted by
 * workCycleFxNodeCount against MAX_ANIMATED_NODES.
 */
export const BenchFx: React.FC<BenchFxProps> = React.memo(({ spec, active, reduced = false, xPct, yPct, testId }) => {
  const tracks = useMemo(() => workCycleFxTracks(spec), [spec]);
  if (!active || reduced) return null;
  const loop = {
    duration: WORK_CYCLE_PERIOD_MS / 1000,
    repeat: Infinity,
    ease: 'linear' as const,
    times: tracks.times,
    delay: WORK_CYCLE_START_DELAY_MS / 1000,
  };
  return (
    <motion.div
      data-testid={testId}
      data-bench-fx={spec.id}
      className="pointer-events-none absolute z-20"
      style={{ left: `${xPct}%`, top: `${yPct}%`, width: 0, height: 0 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: WORK_CYCLE_PERIOD_MS / 1000, delay: WORK_CYCLE_START_DELAY_MS / 1000 }}
    >
      {/* Work-point glow: an ellipse seated on the set piece. */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 64,
          height: 30,
          left: -32,
          top: -15,
          background: `radial-gradient(ellipse at center, ${spec.glowColor} 0%, transparent 70%)`,
          filter: 'blur(2px)',
        }}
        initial={false}
        animate={{ opacity: tracks.glow }}
        transition={loop}
      />
      {spec.sparks && (
        <motion.div
          className="absolute"
          style={{ width: 40, height: 40, left: -20, top: -26 }}
          initial={false}
          animate={{ opacity: tracks.sparkOpacity, scale: tracks.sparkScale }}
          transition={loop}
        >
          <SparkBurst color={spec.sparks.color} />
        </motion.div>
      )}
      {tracks.sweepOpacity.map((keys, s) => {
        const n = tracks.sweepOpacity.length;
        const angle = ((-50 + (n > 1 ? (100 / (n - 1)) * s : 0)) * Math.PI) / 180;
        const dx = Math.sin(angle) * 30;
        const dy = -Math.cos(angle) * 24;
        return (
          <motion.div
            key={s}
            className="absolute rounded-full"
            style={{
              width: 6,
              height: 6,
              left: dx - 3,
              top: dy - 3,
              background: spec.glowColor,
              boxShadow: `0 0 6px ${spec.glowColor}`,
            }}
            initial={false}
            animate={{ opacity: keys }}
            transition={loop}
          />
        );
      })}
    </motion.div>
  );
});
