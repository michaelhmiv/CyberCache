import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { MOVEMENT, particleField, tracerGeometry } from '@/lib/pixel/movement';

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

/** A single tracer streak between two stage points (anchor → anchor). */
export const Tracer: React.FC<{ from: FxPoint; to: FxPoint; color?: string; stageAspect?: number }> = ({ from, to, color = '#FFD76A', stageAspect }) => {
  const geo = tracerGeometry({ xPct: from.xPct, yPct: from.yPct }, { xPct: to.xPct, yPct: to.yPct }, stageAspect);
  return (
    <motion.div
      data-testid="fx-tracer"
      className="pointer-events-none absolute z-20"
      style={{
        left: `${geo.leftPct}%`,
        top: `${geo.topPct}%`,
        width: `${geo.widthPct}%`,
        height: 3,
        marginTop: -1.5,
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
