/**
 * Pixi stage choreography math — the pure sampling core of the Pixi
 * boss stage (pilot, 2026-11-06). Everything here is a function of
 * (law constants, phase-local time): no Pixi imports, no DOM, no
 * clocks of its own, so the timing conformance tests can assert the
 * law directly against these samplers.
 *
 * The law itself lives in movement.ts and is EXECUTED here, never
 * restated: durations, delays, and keyframe values are read from
 * MOVEMENT / the same track tables the DOM stage animates. What this
 * module adds on top of the DOM execution:
 *
 *  - Hit-stop (owner ruling 2026-11-06): a brief freeze of the
 *    phase-local clock at the impact frame — 60 ms on a normal hit,
 *    100 ms on a crit, +120 ms at the death beat — ABSORBED inside
 *    the 1150 ms phase. The phase clock the card walks
 *    (runFightAnimation) is untouched; FIGHT_TOTAL_BUDGET_MS and the
 *    total fight duration do not change.
 *  - Pose tweens sample the PART_POSES rotations with the SEGMENT
 *    per-slot durations; the recoil entry gets a small easeOutBack
 *    overshoot (the "weapon overshoot and settle" of the pilot
 *    brief) — same duration, same endpoints.
 *
 * Pool discipline (brief S4): the Pixi stage pre-allocates every
 * particle sprite it will ever show. PIXI_POOL_CAPS is the cap in
 * code; the live animated-node count (actors' parts + pooled FX)
 * never exceeds MOVEMENT.SEGMENT.MAX_ANIMATED_NODES.
 */
import { MOVEMENT, type PhaseBeat } from './movement';

/** Hard cap on simultaneously live animated nodes in the Pixi stage
 *  (brief S4 — the MAX_ANIMATED_NODES discipline, in code). */
export const PIXI_MAX_ANIMATED_NODES = MOVEMENT.SEGMENT.MAX_ANIMATED_NODES;

/** Pre-allocated particle pools. Nothing spawns beyond these counts. */
export const PIXI_POOL_CAPS = {
  /** Impact sparks per burst (the DOM kit's fan size). */
  sparks: 6,
  /** Ambient embers (movement law EMBER_COUNT). */
  embers: MOVEMENT.EMBER_COUNT,
  /** One-shot FX sprites: muzzle, tracer, casing, hit flash,
   *  telegraph, dust puff (the landing puff reuses it), dust ring. */
  oneShots: 7,
} as const;

/** Animated nodes the stage holds for a parts actor with `partCount`
 *  visible parts (+1 weapon when armed). Used by the cap test. */
export function pixiAnimatedNodeCount(partCount: number, armed: boolean): number {
  const actors = partCount + (armed ? 1 : 0) + 1; // parts + weapon + boss sprite
  return actors + PIXI_POOL_CAPS.sparks + PIXI_POOL_CAPS.embers + PIXI_POOL_CAPS.oneShots;
}

// ── Easing ──────────────────────────────────────────────────────────

/** CSS cubic-bezier easing solver (Newton + bisection fallback). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 5; i += 1) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-4) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-4) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (hi - lo > 1e-4) {
      if (sampleX(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

export const EASE = {
  linear: (t: number) => t,
  /** Framer Motion's default ease ([0.25, 0.1, 0.25, 1]). */
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  easeOut: cubicBezier(0, 0, 0.58, 1),
  easeIn: cubicBezier(0.42, 0, 1, 1),
  easeInOut: cubicBezier(0.42, 0, 0.58, 1),
} as const;

/** easeOutBack — settles past the target and back (recoil overshoot). */
export function easeOutBack(t: number, overshoot = 1.4): number {
  const c = overshoot;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

// ── Keyframe track sampling ─────────────────────────────────────────

export interface TrackSpec {
  keys: number[];
  /** Segment boundaries (0..1); default: evenly spaced. */
  times?: number[];
  durationMs: number;
  delayMs?: number;
  ease?: (t: number) => number;
}

/**
 * Sample a framer-style keyframe track at phase-local time `tMs`.
 * Before the delay the first key holds; after the duration the last
 * key holds. A single ease applies per segment, matching framer's
 * keyframe semantics.
 */
export function sampleTrack(tMs: number, spec: TrackSpec): number {
  const { keys, durationMs } = spec;
  if (keys.length === 1) return keys[0];
  const delay = spec.delayMs ?? 0;
  if (tMs <= delay) return keys[0];
  if (tMs >= delay + durationMs) return keys[keys.length - 1];
  const p = (tMs - delay) / durationMs;
  const times = spec.times ?? keys.map((_, i) => i / (keys.length - 1));
  let seg = 0;
  while (seg < times.length - 2 && p > times[seg + 1]) seg += 1;
  const span = times[seg + 1] - times[seg];
  const local = span <= 0 ? 1 : (p - times[seg]) / span;
  const eased = (spec.ease ?? EASE.ease)(Math.max(0, Math.min(1, local)));
  return keys[seg] + (keys[seg + 1] - keys[seg]) * eased;
}

// ── Hit-stop ────────────────────────────────────────────────────────

export interface HitStopWindow {
  /** Phase-local time at which the clock freezes. */
  atMs: number;
  /** Freeze length. Absorbed: the phase still ends on schedule. */
  durationMs: number;
}

export const HIT_STOP_MS = {
  hit: 60,
  crit: 100,
  death: 120,
} as const;

/** The hit-stop windows a phase's beats produce. The shot lands at
 *  t=0; the death beat lands at HIT_REACTION_MS. */
export function hitStopWindows(beats: PhaseBeat[]): HitStopWindow[] {
  const windows: HitStopWindow[] = [];
  const hasShot = beats.some((b) => b.kind === 'shot' || b.kind === 'crit');
  const isCrit = beats.some((b) => b.kind === 'crit');
  const hasDeath = beats.some((b) => b.kind === 'death');
  if (hasShot) {
    windows.push({ atMs: 0, durationMs: isCrit ? HIT_STOP_MS.crit : HIT_STOP_MS.hit });
  }
  if (hasDeath) {
    windows.push({ atMs: MOVEMENT.HIT_REACTION_MS, durationMs: HIT_STOP_MS.death });
  }
  return windows;
}

/**
 * Map raw phase-local time to effective (choreography) time under
 * hit-stop: inside a window the effective clock holds at the
 * window's start; afterwards it trails raw time by the total frozen
 * duration. Total absorbed time is bounded well under the phase
 * interval, so the phase's beats all still land inside the phase.
 */
export function effectiveTime(rawMs: number, windows: HitStopWindow[]): number {
  let frozen = 0;
  for (const w of windows) {
    const freezeStart = w.atMs + frozen;
    if (rawMs < freezeStart) break;
    if (rawMs < freezeStart + w.durationMs) return w.atMs;
    frozen += w.durationMs;
  }
  return rawMs - frozen;
}

/** Total hit-stop a phase absorbs — asserted < PHASE_INTERVAL_MS. */
export function totalHitStopMs(beats: PhaseBeat[]): number {
  return hitStopWindows(beats).reduce((sum, w) => sum + w.durationMs, 0);
}
