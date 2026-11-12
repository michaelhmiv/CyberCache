import React, { useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { MOVEMENT, particleField, tracerGeometry } from '@/lib/pixel/movement';
import { fiveToneRamp, type FiveToneRamp } from '@/lib/pixel/gearCardCompositor';

/**
 * Pixel combat FX kit (P2) — the reusable presentation effects of the
 * movement system: muzzle flash, tracer, shell casing, impact sparks,
 * dust, screen flash, damage numbers, ambient embers, weapon sway, and
 * the ghost HP bar.
 *
 * Every effect is positioned from manifest anchors by its caller (either
 * as stage-% coordinates computed via actorAnchorPoint, or as % inside an
 * actor box, which maps 1:1 onto anchor fractions) and timed from
 * MOVEMENT — no per-screen hand-tuned durations. All effects are pure
 * presentation: mount them keyed by a beat id and they play once.
 *
 * Reduced motion: callers simply don't mount the transient FX (the kit
 * also self-suppresses when `reduced` is passed where it loops, e.g.
 * embers/sway), and bars snap instantly.
 */

const STAR_CLIP = {
  clipPath:
    'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
};

interface FxPoint {
  /** Left, % of the offset parent. */
  xPct: number;
  /** Top, % of the offset parent. */
  yPct: number;
}

/** Star-burst muzzle flash at a weapon muzzle anchor point. */
export const MuzzleFlash: React.FC<FxPoint & { color?: string; size?: number }> = ({ xPct, yPct, color = '#FFE9A8', size = 34 }) => (
  <motion.div
    data-testid="fx-muzzle-flash"
    className="pointer-events-none absolute z-30"
    style={{ left: `${xPct}%`, top: `${yPct}%`, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, background: color, ...STAR_CLIP }}
    initial={{ opacity: 0, scale: 0.4, rotate: -12 }}
    animate={{ opacity: [0, 1, 0], scale: [0.4, 1.15, 0.8], rotate: [-12, 8, 20] }}
    transition={{ duration: MOVEMENT.MUZZLE_FLASH_MS / 1000, ease: 'easeOut' }}
  />
);

/** A single tracer streak between two stage points (anchor → anchor).
 *  `heightPx` carries the element dialect's tracer weight (§4.6). */
export const Tracer: React.FC<{ from: FxPoint; to: FxPoint; color?: string; stageAspect?: number; heightPx?: number }> = ({ from, to, color = '#FFD76A', stageAspect, heightPx = 3 }) => {
  const geo = tracerGeometry({ xPct: from.xPct, yPct: from.yPct }, { xPct: to.xPct, yPct: to.yPct }, stageAspect);
  return (
    <motion.div
      data-testid="fx-tracer"
      className="pointer-events-none absolute z-20"
      style={{
        left: `${geo.leftPct}%`,
        top: `${geo.topPct}%`,
        width: `${geo.widthPct}%`,
        height: heightPx,
        marginTop: -heightPx / 2,
        transformOrigin: '0 50%',
        rotate: geo.angleDeg,
        background: `linear-gradient(90deg, ${color}00, ${color}, #FFFFFF)`,
        boxShadow: `0 0 8px ${color}`,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration: MOVEMENT.TRACER_MS / 1000, ease: 'linear' }}
    />
  );
};

/** Spent casing ejecting from the grip anchor, arcing down. */
export const ShellCasing: React.FC<FxPoint> = ({ xPct, yPct }) => (
  <motion.div
    data-testid="fx-shell-casing"
    className="pointer-events-none absolute z-20 bg-[#E8B33C]"
    style={{ left: `${xPct}%`, top: `${yPct}%`, width: 5, height: 8, boxShadow: '0 0 4px #000' }}
    initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
    animate={{ x: [-2, -14, -22], y: [-6, 2, 16], opacity: [1, 1, 0], rotate: [0, -140, -260] }}
    transition={{ duration: MOVEMENT.SHELL_CASING_MS / 1000, ease: 'easeOut', times: [0, 0.45, 1] }}
  />
);

/** Fan of impact sparks bursting from a hit point. Deterministic per seed. */
export const ImpactSparks: React.FC<FxPoint & { seed: string; color?: string }> = ({ xPct, yPct, seed, color = '#FFC65C' }) => {
  const sparks = useMemo(() => particleField(`sparks-${seed}`, 6), [seed]);
  return (
    <div data-testid="fx-impact-sparks" className="pointer-events-none absolute z-30" style={{ left: `${xPct}%`, top: `${yPct}%` }}>
      {sparks.map((s, i) => {
        const angle = (i / sparks.length) * Math.PI * 1.5 - Math.PI * 0.9;
        const dist = 16 + s.swayPx + 18;
        return (
          <motion.div
            key={i}
            className="absolute"
            style={{ width: 7, height: 2.5, marginLeft: -3.5, marginTop: -1.25, background: color, boxShadow: `0 0 5px ${color}` }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: (angle * 180) / Math.PI }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist + 6, opacity: 0 }}
            transition={{ duration: MOVEMENT.IMPACT_SPARKS_MS / 1000, ease: 'easeOut' }}
          />
        );
      })}
    </div>
  );
};

/** Soft dust puff at a ground point (landings, steps, death settle). */
export const DustPuff: React.FC<FxPoint & { delayMs?: number; width?: number }> = ({ xPct, yPct, delayMs = 0, width = 64 }) => (
  <motion.div
    data-testid="fx-dust-puff"
    className="pointer-events-none absolute z-10 rounded-[50%] bg-[#C9A876]"
    style={{ left: `${xPct}%`, top: `${yPct}%`, width, height: width * 0.32, marginLeft: -width / 2, marginTop: -width * 0.16 }}
    initial={{ opacity: 0, scale: 0.4 }}
    animate={{ opacity: [0, 0.4, 0], scale: [0.4, 1.15, 1.45] }}
    transition={{ duration: MOVEMENT.DUST_PUFF_MS / 1000, delay: delayMs / 1000, ease: 'easeOut' }}
  />
);

/** Expanding ground ring on a kill — the death beat's punctuation. */
export const DustRing: React.FC<FxPoint & { delayMs?: number }> = ({ xPct, yPct, delayMs = 0 }) => (
  <motion.div
    data-testid="fx-dust-ring"
    className="pointer-events-none absolute z-10 rounded-[50%] border-4 border-[#D8B988]"
    style={{ left: `${xPct}%`, top: `${yPct}%`, width: 30, height: 12, marginLeft: -15, marginTop: -6 }}
    initial={{ opacity: 0, scale: 0.3 }}
    animate={{ opacity: [0, 0.75, 0], scale: [0.3, 2.6, 3.6] }}
    transition={{ duration: MOVEMENT.DUST_RING_MS / 1000, delay: delayMs / 1000, ease: 'easeOut' }}
  />
);

/** Full-stage flash frame for crits (60–180 ms per the spec window). */
export const CritFlash: React.FC = () => (
  <motion.div
    data-testid="fx-crit-flash"
    className="pointer-events-none absolute inset-0 z-40 bg-white"
    initial={{ opacity: 0 }}
    animate={{ opacity: [0, 0.38, 0] }}
    transition={{ duration: MOVEMENT.CRIT_FLASH_MS / 1000, ease: 'linear' }}
  />
);

/** Telegraph glow — an enemy winding up, centered on its center-mass. */
export const TelegraphGlow: React.FC<FxPoint & { delayMs?: number; color?: string }> = ({ xPct, yPct, delayMs = 0, color = '#FF4B5C' }) => (
  <motion.div
    data-testid="fx-telegraph"
    className="pointer-events-none absolute z-10 rounded-full"
    style={{
      left: `${xPct}%`,
      top: `${yPct}%`,
      width: 110,
      height: 110,
      marginLeft: -55,
      marginTop: -55,
      background: `radial-gradient(circle, ${color}66 0%, ${color}00 70%)`,
    }}
    initial={{ opacity: 0, scale: 0.7 }}
    animate={{ opacity: [0, 0.9, 0.55, 1], scale: [0.7, 1.05, 0.95, 1.15] }}
    transition={{ duration: MOVEMENT.TELEGRAPH_MS / 1000, delay: delayMs / 1000, ease: 'easeInOut' }}
  />
);

/**
 * Special telegraph (boss cadence slice C3) — the wind-up warning
 * for a boss's BIG attack, staged identically by both boss stages.
 * Three pieces, all keyed to the one scheduled wind-up window the
 * caller passes in (startMs → landsAtMs inside the phase — the
 * window `derivePhaseBeats` already schedules between its telegraph
 * and lunge beats; see lib/pixel/bossTelegraph.ts):
 *
 *  - a large amber charge-up glow building on the boss,
 *  - a red ground danger ring at the impact zone (the hunter's
 *    feet, where the lunge lands),
 *  - the special's name as a callout chip above the boss.
 *
 * Everything is invisible before the window opens and gone just
 * after the attack lands — the warning exists exactly while the
 * boss is winding up, never longer. Regular hits never mount this;
 * they keep the small TelegraphGlow above.
 */
export const SpecialTelegraphFx: React.FC<{
  /** Boss center-mass point (charge glow + callout anchor). */
  boss: FxPoint;
  /** Impact-zone center: the hunter's stage x, % of the stage. */
  hunterXPct: number;
  /** Ground line, % of the stage height (the marker's y). */
  groundYPct: number;
  specialName: string;
  startMs: number;
  landsAtMs: number;
}> = ({ boss, hunterXPct, groundYPct, specialName, startMs, landsAtMs }) => {
  const total = MOVEMENT.PHASE_INTERVAL_MS;
  const t0 = startMs / total;
  const t1 = landsAtMs / total;
  const t2 = Math.min(1, (landsAtMs + 110) / total);
  const times = [0, t0, (t0 + t1) / 2, t1, t2];
  return (
    <>
      <motion.div
        data-testid="boss-special-charge"
        className="pointer-events-none absolute z-10 rounded-full"
        style={{
          left: `${boss.xPct}%`,
          top: `${boss.yPct}%`,
          width: 190,
          height: 190,
          marginLeft: -95,
          marginTop: -95,
          background: 'radial-gradient(circle, rgba(255,160,31,0.55) 0%, rgba(255,75,92,0.28) 45%, rgba(255,75,92,0) 70%)',
        }}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: [0, 0, 1, 1, 0], scale: [0.7, 0.8, 1.05, 1.2, 1.3] }}
        transition={{ duration: total / 1000, times, ease: 'easeInOut' }}
      />
      <motion.div
        data-testid="boss-special-danger"
        className="pointer-events-none absolute z-20 rounded-[50%] border-[3px] border-[#FF4B5C]"
        style={{
          left: `${hunterXPct}%`,
          top: `${groundYPct}%`,
          width: 104,
          height: 34,
          marginLeft: -52,
          marginTop: -17,
          boxShadow: '0 0 14px rgba(255,75,92,0.65), inset 0 0 12px rgba(255,75,92,0.4)',
        }}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: [0, 0, 1, 1, 0], scale: [0.7, 0.8, 1, 1.08, 1.16] }}
        transition={{ duration: total / 1000, times, ease: 'easeInOut' }}
      />
      <motion.div
        data-testid="boss-special-telegraph"
        className="pointer-events-none absolute z-30 -translate-x-1/2 border-2 border-[#FF4B5C] bg-[#050608]/85 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-[#FF8A94]"
        style={{ left: `${boss.xPct}%`, top: `${Math.max(4, boss.yPct - 24)}%`, textShadow: '0 0 7px #000' }}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: [0, 0, 1, 1, 0], y: [4, 4, 0, 0, -2] }}
        transition={{ duration: total / 1000, times, ease: 'easeOut' }}
      >
        {specialName}
      </motion.div>
    </>
  );
};

/** Floating damage number. Crits render oversized in amber (spec §4). */
export const DamageNumber: React.FC<FxPoint & { value: number; crit?: boolean; delayMs?: number; tone?: 'enemy' | 'player' }> = ({
  xPct,
  yPct,
  value,
  crit = false,
  delayMs = 0,
  tone = 'enemy',
}) => (
  <motion.div
    data-testid={crit ? 'fx-damage-number-crit' : 'fx-damage-number'}
    className="pointer-events-none absolute z-40 font-black"
    style={{
      left: `${xPct}%`,
      top: `${yPct}%`,
      transform: 'translate(-50%, -100%)',
      fontSize: crit ? 30 : 19,
      color: tone === 'player' ? '#FF6B6B' : crit ? '#FFC93C' : '#FFE9A8',
      textShadow: '0 0 7px #000, 2px 2px 0 #000',
    }}
    initial={{ opacity: 0, y: 6, scale: crit ? 0.6 : 0.85 }}
    animate={{ opacity: [0, 1, 1, 0], y: [6, -14, -26, -34], scale: crit ? [0.6, 1.25, 1.1, 1] : [0.85, 1, 1, 0.95] }}
    transition={{ duration: MOVEMENT.DAMAGE_NUMBER_MS / 1000, delay: delayMs / 1000, ease: 'easeOut', times: [0, 0.18, 0.7, 1] }}
  >
    -{value.toLocaleString()}
  </motion.div>
);

/**
 * Ambient embers — always-on rising particles over a pixel stage
 * (spec §4 idle life). Deterministic field per seed; renders nothing
 * under reduced motion.
 */
export const PixelEmbers: React.FC<{ seed: string; reduced?: boolean }> = ({ seed, reduced = false }) => {
  const embers = useMemo(() => particleField(`embers-${seed}`, MOVEMENT.EMBER_COUNT), [seed]);
  if (reduced) return null;
  return (
    <div data-testid="fx-embers" className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {embers.map((e, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-[#FFB35C]"
          style={{ left: `${e.xPct}%`, bottom: -6, width: e.size, height: e.size }}
          initial={{ y: 0, x: 0, opacity: 0 }}
          animate={{ y: [-0, -320], x: [0, e.swayPx], opacity: [0, e.opacity, 0] }}
          transition={{
            duration: e.durationMs / 1000,
            delay: e.delayMs / 1000,
            repeat: Infinity,
            ease: 'linear',
            times: [0, 0.25, 1],
          }}
        />
      ))}
    </div>
  );
};

/** Subtle held-weapon sway wrapper (idle life for the hunter's gun). */
export const PixelSway: React.FC<{ reduced?: boolean; children: React.ReactNode }> = ({ reduced = false, children }) => (
  <motion.div
    data-testid="fx-weapon-sway"
    animate={reduced ? undefined : { rotate: [-1.1, 1.1, -1.1] }}
    transition={reduced ? undefined : { duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
    style={{ transformOrigin: '18% 60%' }}
  >
    {children}
  </motion.div>
);

/**
 * HP bar with a ghost trail: the pale fill drains behind the real fill
 * over GHOST_HP_DRAIN_MS (Sample B), so damage reads as a visible loss
 * instead of an instant jump. Reduced motion snaps both fills.
 */
export const GhostHpBar: React.FC<{
  pct: number;
  color: string;
  reduced?: boolean;
  className?: string;
  barClassName?: string;
  testId?: string;
}> = ({ pct, color, reduced = false, className = '', barClassName = 'h-4', testId }) => {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`relative overflow-hidden border-2 border-border bg-bg ${barClassName} ${className}`} data-testid={testId}>
      {/* Ghost fill — drains behind over ~480 ms */}
      <motion.div
        data-testid={testId ? `${testId}-ghost` : undefined}
        className="absolute inset-y-0 left-0 bg-white/45"
        initial={false}
        animate={{ width: `${clamped}%` }}
        transition={reduced ? { duration: 0 } : { duration: MOVEMENT.GHOST_HP_DRAIN_MS / 1000, ease: 'easeOut', delay: 0.06 }}
      />
      {/* Real fill — settles fast */}
      <motion.div
        data-testid={testId ? `${testId}-real` : undefined}
        className="absolute inset-y-0 left-0"
        style={{ background: color }}
        initial={false}
        animate={{ width: `${clamped}%` }}
        transition={reduced ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
      />
    </div>
  );
};

// ── Loot moment FX (P3, spec §5; item-moment reveal 2026-11-03) ───────
// The celebration kit for drops: a rarity beam at the loot point, the
// legendary treatment's god rays + shockwave, and twinkles for the risen
// item. All positioned from manifest anchors by the caller (stage-%
// coordinates), all timed from MOVEMENT.
//
// DESIGN.md §8 governs the light itself: glow is hard-edged texel
// shapes, never gradients. The beam/rays/shockwave therefore paint on
// quarter-resolution canvases (texel = 4 CSS px) upscaled with
// image-rendering: pixelated — the construction the approved reveal
// exploration used (five-tone ramp bands, concentric stepped ellipses,
// texel fan rays). The pre-redesign DOM versions used linear/radial/
// conic gradients — a smooth column the owner rejected on sight
// ("looks like a dividing bar"): the beam now RADIATES, with rays
// fanning and pulsing outward from behind the rising item.
//
// Owner-approved exception (2026-11-10, the Top-Choice light kit):
// INSIDE the cache loot moment (data-testid="cache-loot-moment") the
// beam and god-ray canvases back at full CSS resolution and paint
// smooth — continuous tapered fan shafts, a smooth three-stop god-ray
// falloff, the beam's three bands feathered at their edges, and a
// gold sparks/embers particulate riding the beam — because on that
// one surface the stepped dashes read as noise against the reveal.
// This is a change of DRAWING only: every timing quantity (the
// MOVEMENT envelopes, the ignite stagger, the tone-chase cadence, the
// spin period) is the shipped formula, bit for bit. Everywhere else —
// combat FX, the bench kit, and the shockwave ring even inside the
// moment — the stepped texel grid stands exactly as shipped.
//
// Corona grammar (2026-11-11, owner-approved Impeccable direction A —
// DESIGN.md §8): on that same scoped surface the flat-shape grammar
// is retired. The banded-ellipse glow field and ground flare read as
// stamped discs next to the painted item art, so the in-moment
// painters now draw physical light instead: a layered radial corona
// (white-hot core → gold → amber wash, every edge a gradient falloff,
// composited additively), ~50 fine irregular rays in place of the
// nine fan shafts, a slimmer feathered beam landing in a soft ground
// BLOOM, and the gold embers the kit already flies. The header law
// rides with it: where a host header crosses the beam (the cache
// reveal's CACHE DECRYPTED), the beam's luminance is notched to ~30%
// behind the header band over the host's soft dark underlay, and the
// header text stays an unmodified top layer above every canvas.

interface LootPoint {
  /** Beam base X, % of the offset parent. */
  xPct: number;
  /** Beam base Y (the ground point), % of the offset parent. */
  groundYPct: number;
}

/** One game texel in CSS px (DESIGN.md §8). FX canvases are authored
 *  at 1/4 CSS resolution and upscaled NEAREST, so every painted edge
 *  lands on the texel grid. */
const TEXEL_PX = 4;

type SteppedDraw = (ctx: CanvasRenderingContext2D, wCells: number, hCells: number, tMs: number) => void;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const easeOutCubic = (p: number): number => 1 - Math.pow(1 - clamp01(p), 3);

function paintEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  alpha: number,
): void {
  if (rx <= 0 || ry <= 0 || alpha <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Drives a stepped canvas. The canvas fills its offset parent;
 * `drawRef.current` paints one frame in CELL coordinates at tMs since
 * mount. Animated on a rAF loop unless `reduced` (one settled frame
 * at `staticMs`) or the loop's `runMs` budget is spent (one-shot
 * effects). Silently inert where a 2d context is unavailable (jsdom)
 * — the element and its testid render regardless.
 *
 * Backing resolution is scoped (the light kit's one carve-out): a
 * beam or god-ray canvas inside the loot moment
 * ([data-testid="cache-loot-moment"]) backs at FULL CSS resolution so
 * its smooth painters draw continuous light; every other canvas this
 * driver runs — the shockwave ring inside the moment included —
 * backs on the shipped quarter-resolution texel grid. The draw
 * callback always receives CELL counts; smooth painters scale to CSS
 * px internally.
 */
/** The canvas 2d context, or null where unavailable (jsdom, or a
 *  context the browser refuses) — one try/catch so callers branch on
 *  the value, not on assignment order. */
function tryGet2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

function useSteppedCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  drawRef: React.RefObject<SteppedDraw>,
  opts: { reduced: boolean; staticMs: number; runMs?: number },
): void {
  const { reduced, staticMs, runMs } = opts;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = tryGet2dContext(canvas);
    if (!context) return undefined;
    let raf = 0;
    let stopped = false;
    const startedAt = performance.now();
    let lastT = reduced ? staticMs : 0;

    const paint = (tMs: number) => {
      const wCells = Math.max(1, Math.ceil(canvas.clientWidth / TEXEL_PX));
      const hCells = Math.max(1, Math.ceil(canvas.clientHeight / TEXEL_PX));
      // Scoped smooth backing (light kit): only the beam and god-ray
      // canvases, only inside the loot moment. The shockwave ring and
      // every canvas anywhere else keep the texel grid.
      const inMoment = !!canvas.closest('[data-testid="cache-loot-moment"]');
      const smooth = inMoment && (canvas.dataset.testid === 'fx-loot-beam' || canvas.dataset.testid === 'fx-god-rays');
      const bw = smooth ? Math.max(1, canvas.clientWidth) : wCells;
      const bh = smooth ? Math.max(1, canvas.clientHeight) : hCells;
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      context.clearRect(0, 0, bw, bh);
      drawRef.current(context, wCells, hCells, tMs);
      context.globalAlpha = 1;
    };

    paint(lastT);
    if (reduced) return undefined;

    const tick = () => {
      if (stopped) return;
      lastT = performance.now() - startedAt;
      paint(lastT);
      if (runMs !== undefined && lastT > runMs) {
        paint(runMs + 1); // settle on the effect's empty final frame
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => paint(lastT);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      observer = new ResizeObserver(onResize);
      observer.observe(canvas.parentElement);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', onResize);
    }
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
    };
  }, [canvasRef, drawRef, reduced, staticMs, runMs]);
}

/** Texel fan-ray angles, degrees from straight up. The ±108° pair is
 *  the low ground spill — shorter, so the fan reads as light bursting
 *  upward off the ground point, not a halo. */
const FAN_RAY_ANGLES: readonly { deg: number; lenF: number }[] = [
  { deg: -108, lenF: 0.55 },
  { deg: -78, lenF: 1 },
  { deg: -52, lenF: 1 },
  { deg: -26, lenF: 1 },
  { deg: 0, lenF: 1 },
  { deg: 26, lenF: 1 },
  { deg: 52, lenF: 1 },
  { deg: 78, lenF: 1 },
  { deg: 108, lenF: 0.55 },
];

/**
 * The radiating fan on the STEPPED grid: texel rays spreading outward
 * from the glow center behind the risen item. This painter serves the
 * beam wherever it renders outside the loot moment — and stays as the
 * record of the shipped construction. Rays ignite staggered inside
 * the beam-in window (each a few frames after its neighbour), then
 * keep pulsing — length breathing on the twinkle period, tone chasing
 * base → light → pale — for the rest of the step.
 */
function paintFanRays(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ramp: FiveToneRamp,
  tMs: number,
  baseLenCells: number,
): void {
  const tones = [ramp.base, ramp.light, ramp.pale];
  FAN_RAY_ANGLES.forEach((ray, i) => {
    const ignite = easeOutCubic((tMs - 60 - i * 28) / Math.max(1, MOVEMENT.LOOT_BEAM_IN_MS - 60));
    if (ignite <= 0) return;
    const pulse = 1 + 0.13 * Math.sin((tMs / MOVEMENT.LOOT_TWINKLE_MS) * Math.PI * 2 + i * 1.7);
    const len = baseLenCells * ray.lenF * ignite * pulse;
    const rad = ((ray.deg - 90) * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    ctx.fillStyle = tones[(Math.floor(tMs / 280) + i) % tones.length];
    ctx.globalAlpha = 0.5;
    const steps = Math.floor(len);
    for (let d = 2; d < steps; d += 1) {
      const size = d < steps * 0.35 ? 2 : 1;
      ctx.fillRect(Math.round(cx + dx * d) - (size - 1), Math.round(cy + dy * d) - (size - 1), size, size);
    }
  });
  ctx.globalAlpha = 1;
}

/** '#RRGGBB' + alpha → rgba() string for gradient stops. */
function hexToRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

interface CoronaRay {
  /** Degrees from straight up, clockwise. */
  deg: number;
  /** Length as a fraction of the field's base length. */
  lenF: number;
  /** Half-width at the ray's base, CSS px. */
  halfPx: number;
  /** Peak alpha of the ray's root segment. */
  alpha: number;
  /** Ramp tone index: 0 base, 1 light, 2 pale. */
  tone: number;
  /** Pulse phase on the twinkle period. */
  phase: number;
}

/**
 * The Corona ray field (2026-11-11): ~50 fine irregular rays in place
 * of the nine shipped fan shafts. Deterministic — one fixed-seed LCG
 * table at module scope, so every frame, mount and test sees the same
 * sky. Angles cover the full circle (downward rays run short: the
 * deck and ground bloom own that space), lengths and alphas jitter,
 * and a handful of hero rays carry the old fan's reach.
 */
const CORONA_RAYS: readonly CoronaRay[] = (() => {
  let state = 0xC0FFEE;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const rays: CoronaRay[] = [];
  const COUNT = 50;
  for (let i = 0; i < COUNT; i += 1) {
    const deg = (i / COUNT) * 360 + (next() - 0.5) * 9;
    const down = Math.abs(((deg + 180) % 360) - 180) < 55; // pointing at the ground
    const hero = i % 9 === 0;
    rays.push({
      deg,
      lenF: down ? 0.3 + next() * 0.25 : hero ? 0.92 + next() * 0.14 : 0.42 + next() * 0.5,
      halfPx: 0.7 + next() * 1.1,
      alpha: 0.13 + next() * 0.22,
      tone: Math.floor(next() * 3),
      phase: next() * Math.PI * 2,
    });
  }
  return rays;
})();

/**
 * The Corona's ray layer — fine tapered light, in-moment only. The
 * envelope is the shipped fan's: rays ignite staggered inside the
 * beam-in window (60ms + a per-ray share of the same ~225ms spread),
 * then pulse on the twinkle period for the rest of the step. Each ray
 * is one tapered quadrilateral in two lengthwise segments (root
 * bright, tip faint), composited additively over the corona so the
 * roots melt into the core instead of stamping on top of it.
 * Coordinates arrive in CSS px from the full-resolution caller.
 */
function paintCoronaRays(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ramp: FiveToneRamp,
  tMs: number,
  baseLenPx: number,
): void {
  const tones = [ramp.base, ramp.light, ramp.pale];
  const start = 6; // CSS px — rays leave the corona's hot core
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  CORONA_RAYS.forEach((ray, i) => {
    const ignite = easeOutCubic((tMs - 60 - i * 4.5) / Math.max(1, MOVEMENT.LOOT_BEAM_IN_MS - 60));
    if (ignite <= 0) return;
    const pulse = 1 + 0.13 * Math.sin((tMs / MOVEMENT.LOOT_TWINKLE_MS) * Math.PI * 2 + ray.phase);
    const len = baseLenPx * ray.lenF * ignite * pulse;
    if (len <= start + 2) return;
    const rad = ((ray.deg - 90) * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const px = -dy;
    const py = dx;
    ctx.fillStyle = tones[ray.tone];
    const segs: readonly (readonly [number, number, number])[] = [
      [0, 0.55, ray.alpha],
      [0.55, 1, ray.alpha * 0.38],
    ];
    for (const [f0, f1, alpha] of segs) {
      const d0 = start + (len - start) * f0;
      const d1 = start + (len - start) * f1;
      const w0 = ray.halfPx * (1 - f0 * 0.8);
      const w1 = Math.max(0.12, ray.halfPx * (1 - f1 * 0.8));
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(cx + dx * d0 + px * w0, cy + dy * d0 + py * w0);
      ctx.lineTo(cx + dx * d1 + px * w1, cy + dy * d1 + py * w1);
      ctx.lineTo(cx + dx * d1 - px * w1, cy + dy * d1 - py * w1);
      ctx.lineTo(cx + dx * d0 - px * w0, cy + dy * d0 - py * w0);
      ctx.closePath();
      ctx.fill();
    }
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * The Corona glow field — a layered radial corona in place of the
 * shipped banded ellipses: white-hot core → gold → amber wash, every
 * edge a gradient falloff, composited additively so the layers read
 * as one body of light. Elliptical (the field's shipped 0.52 squash)
 * via a scaled radial gradient.
 */
function paintCoronaGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ramp: FiveToneRamp,
  strength: number,
): void {
  if (rx <= 0 || strength <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.translate(-cx, -cy);
  const layer = (radius: number, stops: readonly (readonly [number, string, number])[]) => {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    for (const [at, color, a] of stops) grad.addColorStop(at, hexToRgba(color, a * strength));
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  // Amber wash — the field's full reach.
  layer(rx, [
    [0, ramp.base, 0.3],
    [0.4, ramp.dark, 0.2],
    [0.72, ramp.deep, 0.1],
    [1, ramp.deep, 0],
  ]);
  // Gold body.
  layer(rx * 0.58, [
    [0, ramp.light, 0.42],
    [0.55, ramp.base, 0.22],
    [1, ramp.base, 0],
  ]);
  // White-hot core.
  layer(rx * 0.27, [
    [0, '#FFFFFF', 0.8],
    [0.5, ramp.pale, 0.5],
    [1, ramp.pale, 0],
  ]);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * The ground BLOOM — the shipped concentric flare discs, drawn as
 * light instead: one elliptical radial gradient (white heart → pale →
 * rarity tone → nothing) over a wide faint wash, composited
 * additively. Same footprint formula as the discs it replaces.
 */
function paintGroundBloom(
  ctx: CanvasRenderingContext2D,
  cx: number,
  ground: number,
  rx: number,
  ramp: FiveToneRamp,
  strength: number,
): void {
  if (rx <= 0 || strength <= 0) return;
  const ry = rx * 0.26;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, ground);
  ctx.scale(1, ry / rx);
  ctx.translate(-cx, -ground);
  const layer = (radius: number, stops: readonly (readonly [number, string, number])[]) => {
    const grad = ctx.createRadialGradient(cx, ground, 0, cx, ground, radius);
    for (const [at, color, a] of stops) grad.addColorStop(at, hexToRgba(color, a * strength));
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, ground, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  layer(rx * 1.6, [
    [0, ramp.base, 0.1],
    [1, ramp.base, 0],
  ]);
  layer(rx, [
    [0, '#FFFFFF', 0.62],
    [0.3, ramp.pale, 0.45],
    [0.62, ramp.light, 0.22],
    [1, ramp.light, 0],
  ]);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** The beam's luminance multiplier behind the header band — the
 *  header law's notch (DESIGN.md §8): the beam keeps ~30% of its
 *  light where the host's header crosses it. */
const HEADER_NOTCH_KEEP = 0.3;

/**
 * Applies the header notch: an erase pass (destination-out) over the
 * beam column where it crosses the header band, feathered at the
 * band's edges. Runs after the beam paints and before the sparks, so
 * only the beam (and any corona spill behind it) is dimmed; the
 * header text itself is a DOM layer above the canvas and is never
 * touched. `band` is the header's span in CSS px from the host top.
 */
function paintHeaderNotch(
  ctx: CanvasRenderingContext2D,
  cx: number,
  halfSpanPx: number,
  band: { top: number; bottom: number },
): void {
  const feather = 14;
  const y0 = Math.max(0, band.top - feather);
  const y1 = band.bottom + feather;
  if (y1 <= y0 || halfSpanPx <= 0) return;
  const grad = ctx.createLinearGradient(0, y0, 0, y1);
  const cut = 1 - HEADER_NOTCH_KEEP;
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(Math.min(1, feather / (y1 - y0)), `rgba(0, 0, 0, ${cut})`);
  grad.addColorStop(Math.max(0, 1 - feather / (y1 - y0)), `rgba(0, 0, 0, ${cut})`);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 1;
  ctx.fillStyle = grad;
  ctx.fillRect(cx - halfSpanPx, y0, halfSpanPx * 2, y1 - y0);
  ctx.restore();
  ctx.globalAlpha = 1;
}

interface GoldSparksSpec {
  /** Fraction across the beam's ground span (−1..1). */
  fx: number;
  sizePx: number;
  delayMs: number;
  durationMs: number;
  swayPx: number;
  opacity: number;
  ember: boolean;
}

const GOLD_SPARK_TONES = ['#FFEA3A', '#FFC65C', '#FFF3A0'] as const;

/**
 * The gold sparks/embers particulate (light kit, owner-approved
 * 2026-11-10). Deterministic field from the kit's own particleField:
 * bright sparks burst radially out of the ground junction inside the
 * beam-in window and settle fast; warm embers then rise out of the
 * beam column, swaying, on the shipped ember cadence (particleField
 * delay/duration fractions of EMBER_RISE_MS), with every lifetime
 * CLAMPED into the owning step's duration so no particle outlives its
 * celebration. Count scales with the tier's beam width (14 sparks +
 * 10 embers at the 68px legendary beam; fewer, dimmer at lower
 * tiers). Pure presentation.
 */
function paintGoldSparks(
  ctx: CanvasRenderingContext2D,
  cxPx: number,
  groundPx: number,
  topPx: number,
  tMs: number,
  opts: { widthPx: number; durationMs: number },
): void {
  const legendary = opts.widthPx >= 68;
  const sparkN = Math.max(5, Math.round(opts.widthPx / 5));
  const emberN = Math.max(3, Math.round(opts.widthPx / 7));
  const dur = Math.max(600, opts.durationMs);
  const field = particleField('cache-gold-sparks', sparkN + emberN);
  const span = opts.widthPx * (legendary ? 3.4 : 2.2);
  for (let i = 0; i < field.length; i += 1) {
    const p = field[i];
    const spec: GoldSparksSpec = {
      fx: (p.xPct / 100) * 2 - 1,
      sizePx: p.size,
      delayMs: p.delayMs,
      durationMs: p.durationMs,
      swayPx: p.swayPx,
      opacity: p.opacity,
      ember: i >= sparkN,
    };
    if (!spec.ember) {
      // Burst spark: radial out of the junction, beam-in-fast.
      const life = Math.min(420, dur * 0.35);
      const lt = tMs - (spec.delayMs % 160);
      if (lt < 0 || lt > life) continue;
      const lp = lt / life;
      const ang = spec.fx * 1.15 + Math.PI / 2;
      const dist = easeOutCubic(lp) * span * (0.35 + 0.65 * Math.abs(spec.fx));
      const x = cxPx + spec.fx * dist * 0.9;
      const y = groundPx - Math.abs(Math.sin(ang)) * dist * 0.82 + lp * lp * 26;
      const a = spec.opacity * (1 - lp) * (legendary ? 0.95 : 0.6);
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = GOLD_SPARK_TONES[i % GOLD_SPARK_TONES.length];
      const s = Math.max(1.4, spec.sizePx * (1 - lp * 0.5));
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    } else {
      // Rising ember: born at the junction after the burst, climbs
      // the beam column on the shipped ember cadence, clamped to the
      // step's own duration.
      const delay = Math.min(300 + (spec.delayMs % Math.max(1, dur - 700)), dur * 0.5);
      const life = Math.min(spec.durationMs, dur - delay);
      const lt = tMs - delay;
      if (lt < 0 || lt > life || life <= 0) continue;
      const lp = lt / life;
      const rise = easeOutCubic(lp) * (groundPx - topPx) * 0.85;
      const x = cxPx + spec.fx * opts.widthPx * 0.42 + Math.sin(lp * 5 + i * 1.3) * spec.swayPx * 0.5;
      const y = groundPx - 4 - rise;
      const fade = Math.sin(Math.PI * Math.min(1, lp)) * spec.opacity * (legendary ? 0.9 : 0.55);
      if (fade <= 0.02) continue;
      ctx.globalAlpha = fade;
      ctx.fillStyle = GOLD_SPARK_TONES[(i + 1) % GOLD_SPARK_TONES.length];
      const s = Math.max(1.2, spec.sizePx * 0.8);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }
  ctx.globalAlpha = 1;
}

interface LootBeamPaintOpts {
  xPct: number;
  groundYPct: number;
  color: string;
  widthPx: number;
  flareScale: number;
  durationMs: number;
  /** Hover center of the risen item, % of host height — the glow
   *  field's home once the rise completes. */
  glowYPct?: number;
  /** Full celebrations radiate (glow field + fan rays). Light mode
   *  (ordinary feed drops) paints the stepped beam + flare only —
   *  escalation stays scale, never a busier idle scene. */
  radiant: boolean;
  /** The host header's span (CSS px from the host top) where it
   *  crosses the beam — the smooth painter notches the beam's
   *  luminance to ~30% behind it (the header law, DESIGN.md §8).
   *  Only the in-moment smooth painter honors it; hosts without a
   *  header over the beam omit it. */
  headerBandPx?: { top: number; bottom: number };
}

/** True when the beam's canvas is one of the light kit's scoped
 *  smooth surfaces: a beam canvas with the loot moment in its
 *  ancestry. The driver makes the same decision for the backing
 *  resolution; the painter must agree with it, so both read the one
 *  rule. jsdom hosts and ctx-less mounts fall back to the grid. */
function beamCanvasIsSmooth(ctx: CanvasRenderingContext2D): boolean {
  const canvas = (ctx as CanvasRenderingContext2D & { canvas?: HTMLCanvasElement }).canvas;
  return !!canvas?.closest?.('[data-testid="cache-loot-moment"]');
}

function paintLootBeamFrameSmooth(
  ctx: CanvasRenderingContext2D,
  wCells: number,
  hCells: number,
  tMs: number,
  opts: LootBeamPaintOpts,
): void {
  // FX register is flat by law (DESIGN.md §8): the beam keeps the legacy
  // straight ramp — the S1 hue training is item-art only.
  const ramp = fiveToneRamp(opts.color, 'straight');
  const W = wCells * TEXEL_PX;
  const H = hCells * TEXEL_PX;
  const cx = (opts.xPct / 100) * W;
  const ground = (opts.groundYPct / 100) * H;
  const ignition = easeOutCubic(tMs / MOVEMENT.LOOT_BEAM_IN_MS);
  const strength = 0.55 + 0.45 * easeOutCubic(tMs / 700);

  // The glow center rides the rise: it starts at the ground junction
  // and travels to the item's hover point on the rise's own budget.
  const riseMs = Math.max(200, Math.min(MOVEMENT.LOOT_RISE_MS, opts.durationMs - 300));
  const riseP = easeOutCubic((tMs - 120) / riseMs);
  const glowHome = opts.glowYPct !== undefined ? (opts.glowYPct / 100) * H : ground - H * 0.24;
  const glowY = ground - 2 * TEXEL_PX + (glowHome - (ground - 2 * TEXEL_PX)) * riseP;
  const glowStrength = tMs < 120 ? 0 : 0.7 + 0.3 * riseP;
  const glowRxCells = opts.widthPx >= 68 ? 47 : opts.widthPx >= 34 ? 40 : opts.widthPx >= 22 ? 34 : 26;
  const glowRx = glowRxCells * TEXEL_PX;

  // The Corona glow field — layered radial light, no discs (the
  // Corona grammar, DESIGN.md §8).
  if (opts.radiant && glowStrength > 0) {
    paintCoronaGlow(ctx, cx, glowY, glowRx, glowRx * 0.52, ramp, glowStrength);
  }

  // The Corona's fine ray field — behind the item, over the backdrop.
  if (opts.radiant && tMs > 60) paintCoronaRays(ctx, cx, glowY, ramp, tMs, glowRx * 1.9);

  // Beam — slimmer than the shipped column (the Corona's feathered
  // shaft), same three-band identity (base / light / white core over
  // the same width fractions and peak alphas) with deeper soft
  // lateral falloff: nested soft-edged rects per band so the edges
  // feather into the scene instead of cutting it.
  const topMargin = H * 0.02;
  const beamTop = ground - (ground - topMargin) * (0.45 + 0.55 * ignition);
  const beamPx = Math.max(5, opts.widthPx * 0.7);
  const beamBands: readonly (readonly [number, keyof FiveToneRamp | null, number])[] = [
    [1, 'base', 165],
    [0.55, 'light', 175],
    [0.26, null, 215],
  ];
  for (const [wf, tone, a] of beamBands) {
    const w = beamPx * wf;
    const feather = Math.max(3, w * 0.3);
    for (let s = 4; s >= 1; s -= 1) {
      const ww = w + feather * (s - 1) * 0.7;
      ctx.globalAlpha = ((a / 255) * strength) / s;
      ctx.fillStyle = tone ? ramp[tone] : '#FFFFFF';
      ctx.fillRect(cx - ww / 2, beamTop, ww, ground - beamTop);
    }
  }
  // Hot junction where the beam meets the ground (shipped 3-cell bar,
  // same span and alpha, on the slimmer column).
  ctx.globalAlpha = (120 / 255) * strength;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(cx - beamPx / 2, ground - 3 * TEXEL_PX, beamPx, 3 * TEXEL_PX);
  ctx.globalAlpha = 1;

  // Header law: notch the beam's luminance behind the host's header
  // band (over the host's own soft dark underlay), so the header text
  // — a DOM layer above this canvas — reads clean at every frame.
  if (opts.headerBandPx) {
    paintHeaderNotch(ctx, cx, beamPx * 1.1, opts.headerBandPx);
  }

  // Ground bloom — the flare's footprint (the incumbent's own width
  // formula) drawn as a soft body of light instead of stacked discs.
  const flareRx = (opts.widthPx * opts.flareScale * 2.4) / 2;
  paintGroundBloom(ctx, cx, ground, flareRx, ramp, strength);

  // Gold sparks/embers particulate — the light kit's added layer,
  // riding the beam's own step (see paintGoldSparks).
  paintGoldSparks(ctx, cx, ground, beamTop, tMs, { widthPx: opts.widthPx, durationMs: opts.durationMs });
}

/** One frame of the loot light. On the light kit's scoped surface
 *  (the beam inside the cache loot moment) the frame paints smooth at
 *  full canvas resolution — since the Corona grammar (2026-11-11), as
 *  physical light: radial corona, fine rays, feathered beam, ground
 *  bloom; everywhere else it paints stepped: glow field (concentric
 *  stepped ellipses travelling with the rise), the radiating fan, the
 *  beam's three ramp bands with their hot ground junction, and the
 *  stepped ground flare — the approved exploration's construction,
 *  live. Both painters share every timing envelope. */
function paintLootBeamFrame(
  ctx: CanvasRenderingContext2D,
  wCells: number,
  hCells: number,
  tMs: number,
  opts: LootBeamPaintOpts,
): void {
  if (beamCanvasIsSmooth(ctx)) {
    paintLootBeamFrameSmooth(ctx, wCells, hCells, tMs, opts);
    return;
  }
  // FX register is flat by law (DESIGN.md §8): the beam keeps the legacy
  // straight ramp — the S1 hue training is item-art only.
  const ramp = fiveToneRamp(opts.color, 'straight');
  const cx = (opts.xPct / 100) * wCells;
  const ground = (opts.groundYPct / 100) * hCells;
  const ignition = easeOutCubic(tMs / MOVEMENT.LOOT_BEAM_IN_MS);
  const strength = 0.55 + 0.45 * easeOutCubic(tMs / 700);

  // The glow center rides the rise: it starts at the ground junction
  // and travels to the item's hover point on the rise's own budget.
  const riseMs = Math.max(200, Math.min(MOVEMENT.LOOT_RISE_MS, opts.durationMs - 300));
  const riseP = easeOutCubic((tMs - 120) / riseMs);
  const glowHome = opts.glowYPct !== undefined ? (opts.glowYPct / 100) * hCells : ground - hCells * 0.24;
  const glowY = ground - 2 + (glowHome - (ground - 2)) * riseP;
  const glowStrength = tMs < 120 ? 0 : 0.7 + 0.3 * riseP;
  const glowRx = opts.widthPx >= 68 ? 47 : opts.widthPx >= 34 ? 40 : opts.widthPx >= 22 ? 34 : 26;

  if (opts.radiant && glowStrength > 0) {
    const glowRy = glowRx * 0.52;
    const bands: readonly (readonly [number, keyof FiveToneRamp, number])[] = [
      [1, 'deep', 76],
      [0.8, 'dark', 96],
      [0.6, 'base', 116],
      [0.4, 'light', 136],
    ];
    for (const [f, tone, a] of bands) {
      paintEllipse(ctx, cx, glowY, glowRx * f, glowRy * f, ramp[tone], (a / 255) * glowStrength);
    }
    paintEllipse(ctx, cx, glowY, glowRx * 0.22, glowRy * 0.22, ramp.pale, (122 / 255) * glowStrength);
  }

  // The radiating fan — behind the item, over the backdrop.
  if (opts.radiant && tMs > 60) paintFanRays(ctx, cx, glowY, ramp, tMs, glowRx * 1.9);

  // Beam bands — brightest at the ground junction; the top grows from
  // 45% of the span to the frame top inside the beam-in window.
  const topMargin = hCells * 0.02;
  const beamTop = ground - (ground - topMargin) * (0.45 + 0.55 * ignition);
  const beamCells = Math.max(1.5, opts.widthPx / TEXEL_PX);
  const beamBands: readonly (readonly [number, keyof FiveToneRamp | null, number])[] = [
    [1, 'base', 165],
    [0.55, 'light', 175],
    [0.26, null, 215],
  ];
  for (const [wf, tone, a] of beamBands) {
    const w = Math.max(0.5, beamCells * wf);
    ctx.globalAlpha = (a / 255) * strength;
    ctx.fillStyle = tone ? ramp[tone] : '#FFFFFF';
    ctx.fillRect(cx - w / 2, beamTop, w, ground - beamTop);
  }
  // Hot junction where the beam meets the ground.
  ctx.globalAlpha = (120 / 255) * strength;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(cx - beamCells / 2, ground - 3, beamCells, 3);
  ctx.globalAlpha = 1;

  // Ground flare — concentric stepped ellipses, white heart outward
  // (the incumbent's own width formula, stepped).
  const flareRx = (opts.widthPx * opts.flareScale * 2.4) / (TEXEL_PX * 2);
  const flareRy = flareRx * 0.22;
  const flareBands: readonly (readonly [number, keyof FiveToneRamp | null, number])[] = [
    [1, 'dark', 60],
    [0.78, 'base', 95],
    [0.55, 'light', 130],
    [0.32, null, 170],
  ];
  for (const [f, tone, a] of flareBands) {
    paintEllipse(ctx, cx, ground, flareRx * f, flareRy * f, tone ? ramp[tone] : '#FFFFFF', (a / 255) * strength);
  }
  ctx.globalAlpha = 1;
}

/**
 * The rarity light at a ground loot point: five-tone beam, radiating
 * fan, glow field, and ground flare, all composited on one canvas.
 * Inside the cache loot moment the canvas backs at full resolution
 * and presents smooth (the light kit); anywhere else it backs on the
 * quarter-resolution texel grid and presents pixelated. Width and
 * flare scale with the celebration tier (lootCelebrationForRarity).
 */
export const LootBeam: React.FC<
  LootPoint & {
    color: string;
    widthPx: number;
    flareScale?: number;
    reduced?: boolean;
    /** The owning step's duration — sizes the rise the glow rides. */
    durationMs?: number;
    /** Hover center of the risen item, % of host height. */
    glowYPct?: number;
    /** Glow field + radiating fan (full celebrations only). */
    radiant?: boolean;
    /** Host header span (CSS px from the host top) crossing the
     *  beam — the header-law notch (in-moment painter only). */
    headerBandPx?: { top: number; bottom: number };
  }
> = ({ xPct, groundYPct, color, widthPx, flareScale = 2.6, reduced = false, durationMs, glowYPct, radiant = true, headerBandPx }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef<SteppedDraw>(() => {});
  // Latest-closure draw for the stepped-canvas loop: assigned in an
  // effect (every render), never during render itself.
  useEffect(() => {
    drawRef.current = (ctx, wCells, hCells, tMs) =>
      paintLootBeamFrame(ctx, wCells, hCells, tMs, {
        xPct,
        groundYPct,
        color,
        widthPx,
        flareScale,
        durationMs: durationMs ?? MOVEMENT.LOOT_LEGENDARY_MS,
        glowYPct,
        radiant,
        headerBandPx,
      });
  });
  useSteppedCanvas(canvasRef, drawRef, { reduced, staticMs: 1400 });
  return (
    <canvas
      ref={canvasRef}
      data-testid="fx-loot-beam"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
      // The light kit presents this canvas smoothly — inside the loot
      // moment it backs at full resolution (see useSteppedCanvas);
      // outside it, the stepped backing upscales softly instead of on
      // the hard texel grid. The ring keeps its stepped identity.
      style={{ imageRendering: 'auto' }}
    />
  );
};

/**
 * Rotating god-ray disc behind the risen legendary weapon, turning
 * one slow revolution per LOOT_RAYS_SPIN_MS. Static (but present)
 * under reduced motion. Two painters share the geometry (9 wedges,
 * 40° spacing, 11° width, 500ms fade-in): inside the loot moment the
 * light kit's smooth three-stop radial falloff at full resolution;
 * anywhere else the shipped stepped wedges on the texel grid with
 * their two-band stepped falloff.
 */
export const GodRays: React.FC<FxPoint & { size?: number; reduced?: boolean }> = ({ xPct, yPct, size = 360, reduced = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef<SteppedDraw>(() => {});
  useEffect(() => {
    drawRef.current = (ctx, wCells, hCells, tMs) => {
    const ramp = fiveToneRamp('#FFEA3A', 'straight'); // legacy flat ramp — see paintLootBeamFrame
    const fadeIn = reduced ? 0.9 : Math.min(1, tMs / 500);
    const rotDeg = ((tMs / MOVEMENT.LOOT_RAYS_SPIN_MS) * 360) % 360;
    const smooth = beamCanvasIsSmooth(ctx);
    const cx = smooth ? (wCells * TEXEL_PX) / 2 : wCells / 2;
    const cy = smooth ? (hCells * TEXEL_PX) / 2 : hCells / 2;
    const radius = smooth ? (Math.min(wCells, hCells) / 2) * TEXEL_PX : Math.min(wCells, hCells) / 2;
    // Smooth: a three-stop per-wedge radial falloff (rim → mid →
    // core). Stepped: the shipped two falloff bands — the inner disc
    // of each wedge burns brighter than its rim (the exploration's
    // masked-fan falloff, quantized to texel rings).
    const passes: readonly (readonly [number, number, string])[] = smooth
      ? [
          [0.5, 0.2, ramp.pale],
          [0.78, 0.13, ramp.light],
          [1, 0.055, ramp.light],
        ]
      : [
          [1, 0.13, ramp.light],
          [0.5, 0.2, ramp.pale],
        ];
    for (const [rF, alpha, tone] of passes) {
      ctx.globalAlpha = alpha * fadeIn;
      ctx.fillStyle = tone;
      for (let i = 0; i < 9; i += 1) {
        const a0 = ((rotDeg + i * 40) * Math.PI) / 180;
        const a1 = ((rotDeg + i * 40 + 11) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius * rF, a0, a1);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    };
  });
  useSteppedCanvas(canvasRef, drawRef, { reduced, staticMs: 1200 });
  return (
    <canvas
      ref={canvasRef}
      data-testid="fx-god-rays"
      className="pointer-events-none absolute z-10"
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        // Light-kit smooth presentation (see LootBeam).
        imageRendering: 'auto',
      }}
    />
  );
};

/** Stepped shockwave rings rolling across the ground from the loot
 *  point — two concentric texel ellipse outlines (ramp base + pale)
 *  expanding and fading over LOOT_SHOCKWAVE_MS. */
export const ShockwaveRing: React.FC<LootPoint & { color?: string }> = ({ xPct, groundYPct, color = '#FFEA3A' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef<SteppedDraw>(() => {});
  useEffect(() => {
    drawRef.current = (ctx, wCells, hCells, tMs) => {
    const p = tMs / MOVEMENT.LOOT_SHOCKWAVE_MS;
    if (p >= 1) return;
    const ramp = fiveToneRamp(color, 'straight'); // legacy flat ramp — see paintLootBeamFrame
    const cx = wCells / 2;
    const cy = hCells / 2;
    const rx = 6 + (46 - 6) * easeOutCubic(p);
    const rings: readonly (readonly [number, string, number])[] = [
      [1, ramp.base, 190],
      [0.82, ramp.pale, 120],
    ];
    for (const [f, tone, a] of rings) {
      ctx.globalAlpha = (a / 255) * (1 - p);
      ctx.strokeStyle = tone;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * f, rx * f * (11 / 46), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    };
  });
  useSteppedCanvas(canvasRef, drawRef, { reduced: false, staticMs: 0, runMs: MOVEMENT.LOOT_SHOCKWAVE_MS });
  return (
    <canvas
      ref={canvasRef}
      data-testid="fx-shockwave-ring"
      className="pointer-events-none absolute z-20"
      style={{
        left: `${xPct}%`,
        top: `${groundYPct}%`,
        width: 380,
        height: 96,
        marginLeft: -190,
        marginTop: -48,
        imageRendering: 'pixelated',
      }}
    />
  );
};

/** Twinkle sparkles hovering around the risen legendary weapon. */
export const Twinkles: React.FC<FxPoint & { seed: string; width?: number }> = ({ xPct, yPct, seed, width = 210 }) => {
  const field = useMemo(() => particleField(`twinkles-${seed}`, 7), [seed]);
  return (
    <div data-testid="fx-twinkles" className="pointer-events-none absolute z-30" style={{ left: `${xPct}%`, top: `${yPct}%` }}>
      {field.map((p, i) => {
        const left = ((p.xPct - 50) / 50) * (width / 2);
        const top = ((i % 3) - 1) * 17 + (p.swayPx % 7);
        return (
          <motion.span
            key={i}
            className="absolute bg-[#FFF3A0]"
            style={{ left, top, width: p.size + 3, height: p.size + 3, ...STAR_CLIP, boxShadow: '0 0 6px #FFEA3A' }}
            initial={{ opacity: 0, scale: 0.3, rotate: 0 }}
            animate={{ opacity: [0, 1, 0], scale: [0.3, 1, 0.4], rotate: [0, 70, 130] }}
            transition={{
              duration: MOVEMENT.LOOT_TWINKLE_MS / 1000,
              delay: (p.delayMs % 900) / 1000,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        );
      })}
    </div>
  );
};
