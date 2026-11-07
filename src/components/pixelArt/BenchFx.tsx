import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
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
 *  vocabulary as a one-shot burst the strike envelope drives. */
const SPARK_RAYS = [4, 11, 7, 13, 5, 10, 6, 12];

const SparkBurst: React.FC<{ color: string }> = ({ color }) => (
  <svg viewBox="0 0 40 40" className="h-full w-full" aria-hidden="true">
    {SPARK_RAYS.map((len, i) => {
      const a = (i / SPARK_RAYS.length) * Math.PI * 2 - Math.PI / 2;
      const x1 = 20 + Math.cos(a) * 4;
      const y1 = 20 + Math.sin(a) * 4;
      const x2 = 20 + Math.cos(a) * (4 + len);
      const y2 = 20 + Math.sin(a) * (4 + len);
      return (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} strokeLinecap="round" />
      );
    })}
    <circle cx={20} cy={20} r={2.6} fill={color} />
  </svg>
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
