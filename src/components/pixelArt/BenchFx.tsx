import React, { useEffect, useRef } from 'react';
import { fiveToneRamp } from '@/lib/pixel/gearCardCompositor';
import {
  sampleWorkCycle,
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
   *  where work happens; the FX kit only executes the spec). In the
   *  bench scenes this point IS the seated item's center (M4b):
   *  the sparks land on the work, not near it. */
  xPct: number;
  yPct: number;
  testId?: string;
}

/** Quarter-resolution canvas, the loot light kit's texel (PixelFx):
 *  FX paint in texels and scale with image-rendering: pixelated, so
 *  light speaks the same stepped language as the sprites it plays
 *  over. The canvas spans 112×96 CSS px around the work point —
 *  the footprint the retired DOM kit (64×30 glow + 40px burst +
 *  sweep arc) already occupied. */
const TEXEL_PX = 4;
const CANVAS_W_PX = 112;
const CANVAS_H_PX = 96;
/** Work point inside the canvas, texel coords. */
const POINT = { x: 14, y: 13 };
/** Spark burst center rides a breath above the point, where the
 *  retired SVG burst sat. */
const BURST = { x: 14, y: 11.5 };
/** Spark ray lengths in texels, the retired burst's proportions. */
const SPARK_RAYS = [1, 3, 2, 3, 1, 3, 2, 3];

function tryGet2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null; // jsdom / unsupported — the element still renders inert
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Fill a stepped ellipse of texels (texel-center sampling — the
 *  light kit's concentric-step shape, never a smooth gradient). */
function fillSteppedEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
) {
  const x0 = Math.floor(cx - rx);
  const x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry);
  const y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) ctx.fillRect(x, y, 1, 1);
    }
  }
}

/**
 * Work-cycle set-piece FX (Motion Reboot M1; vehicle replaced in
 * M4b) — the bench's half of the choreography: a work-point glow
 * that brightens into the strike, a spark burst on families whose
 * spec carries one, and sweep dots walking the arc on sweep
 * families. Every frame is DERIVED from the work-cycle sampler
 * (sampleWorkCycle) on the same start delay the actor observes,
 * so FX and figure can never drift apart.
 *
 * The vehicle is a quarter-res canvas in the loot light kit's
 * grammar (stepped shapes, flat five-tone ramps — the FX register
 * is flat by law, DESIGN.md §8), replacing M1's SVG-stroke burst
 * and blurred gradient divs, which spoke a different visual
 * language than the texel world they played over. One canvas node
 * total — the animated-node accounting only shrinks.
 */
export const BenchFx: React.FC<BenchFxProps> = React.memo(({ spec, active, reduced = false, xPct, yPct, testId }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active || reduced) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = tryGet2dContext(canvas);
    if (!ctx) return undefined;
    const wCells = CANVAS_W_PX / TEXEL_PX;
    const hCells = CANVAS_H_PX / TEXEL_PX;
    if (canvas.width !== wCells) canvas.width = wCells;
    if (canvas.height !== hCells) canvas.height = hCells;
    const glowRamp = fiveToneRamp(spec.glowColor, 'straight');
    const sparkRamp = spec.sparks ? fiveToneRamp(spec.sparks.color, 'straight') : null;
    let raf = 0;
    let stopped = false;
    const startedAt = performance.now();

    const paint = () => {
      if (stopped) return;
      const elapsed = performance.now() - startedAt;
      ctx.clearRect(0, 0, wCells, hCells);
      const local = elapsed - WORK_CYCLE_START_DELAY_MS;
      if (local >= 0) {
        // Engagement ramp: the container fade M1 ran over one
        // period after the start delay, folded into the sampler's
        // own amplitude so glow, sparks, and the actor's pose all
        // breathe in together.
        const amplitude = clamp01(local / WORK_CYCLE_PERIOD_MS);
        const frame = sampleWorkCycle(spec, local, amplitude);

        // Work-point glow: concentric stepped ellipses, tones from
        // the spec color's flat ramp, alpha on the sampler's glow.
        const rings: Array<[number, number, string, number]> = [
          [8, 4, glowRamp.dark, 0.5],
          [6, 3, glowRamp.base, 0.75],
          [3.5, 2, glowRamp.light, 1],
        ];
        for (const [rx, ry, tone, weight] of rings) {
          ctx.globalAlpha = clamp01(frame.glow * 1.5 * weight);
          ctx.fillStyle = tone;
          fillSteppedEllipse(ctx, POINT.x, POINT.y, rx, ry);
        }

        // Spark burst at the strike envelope.
        if (sparkRamp && frame.strike > 0.01) {
          ctx.globalAlpha = frame.strike;
          ctx.fillStyle = sparkRamp.pale;
          ctx.fillRect(BURST.x, Math.round(BURST.y), 1, 1);
          ctx.fillStyle = sparkRamp.base;
          for (let i = 0; i < SPARK_RAYS.length; i++) {
            const a = (i / SPARK_RAYS.length) * Math.PI * 2 - Math.PI / 2;
            const steps = Math.max(0, Math.round(SPARK_RAYS[i] * frame.strike));
            const drawn = new Set<string>();
            for (let sIdx = 1; sIdx <= steps; sIdx++) {
              const x = Math.round(BURST.x + Math.cos(a) * (0.75 + sIdx * 0.75));
              const y = Math.round(BURST.y + Math.sin(a) * (0.75 + sIdx * 0.75));
              const key = `${x},${y}`;
              if (drawn.has(key)) continue;
              drawn.add(key);
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }

        // Calibration sweep: every step's dot ghosts on the arc;
        // the sampler's active step burns.
        if (spec.sweepSteps > 0 && frame.sweepStep >= 0) {
          const n = spec.sweepSteps;
          for (let s = 0; s < n; s++) {
            const angle = ((-50 + (n > 1 ? (100 / (n - 1)) * s : 0)) * Math.PI) / 180;
            const x = Math.round(POINT.x + (Math.sin(angle) * 30) / TEXEL_PX);
            const y = Math.round(POINT.y - (Math.cos(angle) * 24) / TEXEL_PX);
            if (s === frame.sweepStep) {
              ctx.globalAlpha = 0.95;
              ctx.fillStyle = glowRamp.light;
              ctx.fillRect(x - 1, y - 1, 2, 2);
              ctx.fillStyle = glowRamp.pale;
              ctx.fillRect(x, y, 1, 1);
            } else {
              ctx.globalAlpha = 0.22;
              ctx.fillStyle = glowRamp.base;
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [spec, active, reduced]);

  if (!active || reduced) return null;
  return (
    <div
      data-testid={testId}
      data-bench-fx={spec.id}
      data-fx-vehicle="canvas"
      className="pointer-events-none absolute z-20"
      style={{ left: `${xPct}%`, top: `${yPct}%`, width: 0, height: 0 }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_W_PX / TEXEL_PX}
        height={CANVAS_H_PX / TEXEL_PX}
        className="absolute"
        style={{
          width: CANVAS_W_PX,
          height: CANVAS_H_PX,
          left: -CANVAS_W_PX / 2,
          top: -CANVAS_H_PX / 2,
          imageRendering: 'pixelated',
        }}
        aria-hidden="true"
      />
    </div>
  );
});
