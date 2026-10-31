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

// ── Loot moment FX (P3, spec §5) ───────────────────────────────────────
// The celebration kit for drops: a rarity beam at the loot point, the
// legendary treatment's god rays + shockwave, and twinkles for the risen
// weapon. All positioned from manifest anchors by the caller (stage-%
// coordinates), all timed from MOVEMENT. Reduced motion: the beam still
// renders (static), the rays/shockwave/twinkles do not.

interface LootPoint {
  /** Beam base X, % of the offset parent. */
  xPct: number;
  /** Beam base Y (the ground point), % of the offset parent. */
  groundYPct: number;
}

/**
 * A vertical rarity beam rising from a ground loot point: bright white
 * core, rarity-colored body, and a ground flare where it lands. Width
 * and flare scale with the celebration tier (lootCelebrationForRarity).
 */
export const LootBeam: React.FC<LootPoint & { color: string; widthPx: number; flareScale?: number; reduced?: boolean }> = ({
  xPct,
  groundYPct,
  color,
  widthPx,
  flareScale = 2.6,
  reduced = false,
}) => {
  const flareWidth = Math.round(widthPx * flareScale * 2.4);
  return (
    <div data-testid="fx-loot-beam" className="pointer-events-none absolute inset-0 z-20">
      {/* Beam column — grows up out of the ground point */}
      <motion.div
        className="absolute"
        style={{
          left: `${xPct}%`,
          bottom: `${100 - groundYPct}%`,
          width: widthPx,
          height: `${Math.min(97, groundYPct + 8)}%`,
          marginLeft: -widthPx / 2,
          transformOrigin: '50% 100%',
          background: `linear-gradient(90deg, transparent 0%, ${color}59 22%, ${color} 42%, #FFFFFF 50%, ${color} 58%, ${color}59 78%, transparent 100%)`,
          boxShadow: `0 0 ${Math.round(widthPx * 0.55)}px ${color}59`,
        }}
        initial={reduced ? { opacity: 0.9, scaleY: 1 } : { opacity: 0, scaleY: 0.06 }}
        animate={{ opacity: [0, 1, 0.92], scaleY: 1 }}
        transition={reduced ? { duration: 0 } : { duration: MOVEMENT.LOOT_BEAM_IN_MS / 1000, ease: 'easeOut', times: [0, 0.35, 1] }}
      />
      {/* Ground flare where the beam lands */}
      <motion.div
        className="absolute rounded-[50%]"
        style={{
          left: `${xPct}%`,
          top: `${groundYPct}%`,
          width: flareWidth,
          height: Math.max(10, flareWidth * 0.22),
          marginLeft: -flareWidth / 2,
          marginTop: -Math.max(5, flareWidth * 0.11),
          background: `radial-gradient(ellipse, #FFFFFF 0%, ${color}B3 42%, ${color}00 72%)`,
        }}
        initial={reduced ? { opacity: 0.85, scale: 1 } : { opacity: 0, scale: 0.3 }}
        animate={{ opacity: [0, 0.95, 0.8], scale: 1 }}
        transition={reduced ? { duration: 0 } : { duration: MOVEMENT.LOOT_BEAM_IN_MS / 1000, ease: 'easeOut', times: [0, 0.4, 1] }}
      />
    </div>
  );
};

/**
 * Rotating god-ray disc behind the risen legendary weapon. A conic fan
 * of gold wedges with a radial fade, turning one slow revolution per
 * LOOT_RAYS_SPIN_MS. Static (but present) under reduced motion.
 */
export const GodRays: React.FC<FxPoint & { size?: number; reduced?: boolean }> = ({ xPct, yPct, size = 360, reduced = false }) => (
  <motion.div
    data-testid="fx-god-rays"
    className="pointer-events-none absolute z-10 rounded-full"
    style={{
      left: `${xPct}%`,
      top: `${yPct}%`,
      width: size,
      height: size,
      marginLeft: -size / 2,
      marginTop: -size / 2,
      background:
        'repeating-conic-gradient(from 0deg, rgba(255,234,58,0.12) 0deg 9deg, rgba(255,234,58,0) 9deg 24deg)',
      maskImage: 'radial-gradient(circle, black 0%, transparent 68%)',
      WebkitMaskImage: 'radial-gradient(circle, black 0%, transparent 68%)',
    }}
    initial={{ rotate: 0, opacity: 0 }}
    animate={reduced ? { opacity: 0.9 } : { rotate: 360, opacity: [0, 1, 0.95] }}
    transition={
      reduced
        ? { duration: 0 }
        : {
            rotate: { duration: MOVEMENT.LOOT_RAYS_SPIN_MS / 1000, repeat: Infinity, ease: 'linear' },
            opacity: { duration: 0.5, ease: 'easeOut', times: [0, 0.3, 1] },
          }
    }
  />
);

/** A gold shockwave ring rolling across the ground from the loot point. */
export const ShockwaveRing: React.FC<LootPoint & { color?: string }> = ({ xPct, groundYPct, color = '#FFEA3A' }) => (
  <motion.div
    data-testid="fx-shockwave-ring"
    className="pointer-events-none absolute z-20 rounded-[50%]"
    style={{
      left: `${xPct}%`,
      top: `${groundYPct}%`,
      width: 380,
      height: 56,
      marginLeft: -190,
      marginTop: -28,
      border: `3px solid ${color}`,
      boxShadow: `0 0 18px ${color}88, inset 0 0 18px ${color}55`,
    }}
    initial={{ opacity: 0, scale: 0.12 }}
    animate={{ opacity: [0, 0.95, 0], scale: [0.12, 0.7, 1.12] }}
    transition={{ duration: MOVEMENT.LOOT_SHOCKWAVE_MS / 1000, ease: 'easeOut', times: [0, 0.25, 1] }}
  />
);

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
