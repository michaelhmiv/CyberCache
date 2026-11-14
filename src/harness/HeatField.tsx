import React, { useEffect, useState } from 'react';

/** Locate the real stage element ([data-testid="pixel-diorama-stage"])
 *  inside a wrapper and return its box relative to the wrapper, so
 *  heat spots seat on the STAGE's coordinate frame (xPct / yPct of
 *  the stage itself), not the whole diorama incl. its title plate. */
export const useStageBox = (wrapRef: React.RefObject<HTMLDivElement | null>) => {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const measure = () => {
      const wrap = wrapRef.current;
      const stage = wrap?.querySelector('[data-testid="pixel-diorama-stage"]') as HTMLElement | null;
      if (!wrap || !stage) return;
      const wr = wrap.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      if (sr.width > 0) setBox({ x: sr.left - wr.left, y: sr.top - wr.top, w: sr.width, h: sr.height });
    };
    measure();
    const iv = window.setInterval(measure, 400);
    const stop = window.setTimeout(() => window.clearInterval(iv), 6000);
    return () => {
      alive = false;
      window.clearInterval(iv);
      window.clearTimeout(stop);
      void alive;
    };
  }, [wrapRef]);
  return box;
};

export const StageHeat: React.FC<{
  wrapRef: React.RefObject<HTMLDivElement | null>;
  spots: HeatSpot[];
  hold: boolean;
  tauMs?: number;
}> = ({ wrapRef, spots, hold, tauMs }) => {
  const box = useStageBox(wrapRef);
  if (!box) return null;
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, pointerEvents: 'none' }}>
      <HeatOverlay spots={spots} hold={hold} tauMs={tauMs} />
    </div>
  );
};


/**
 * HEAT FIELD (iter-09, THROWAWAY harness prototype, 2026-11-13).
 *
 * One display grammar for every activity: an intensity field seated
 * over the real stage at the action point. A hotspot's intensity is
 * a pure function of a real number (the mapping is stated per page
 * and in the iteration README):
 *
 *   combat / boss  intensity = value / 156   (156 = the fixture's
 *                                             largest tick = FULL)
 *   shield         intensity = shield lost / shield max (28 / 64)
 *   telegraph      intensity = windup elapsed / windup total
 *   craft          intensity = pace per min / 9
 *   extraction     intensity = finds settled / draws in the pass
 *   research       intensity = elapsed / duration
 *
 * Radius encodes by AREA: r = R * sqrt(intensity), so a component
 * worth half the tick takes half the impact point's area. Between
 * events heat COOLS exponentially (tau per surface) toward zero —
 * at rest there is no glow at all.
 *
 * Colors are the game's own fire register (the shipped craft/roam
 * tones #F5B83D amber and #FF7A1A orange, whitening at the core as
 * intensity passes 0.85). No new palette is introduced; the field
 * is a data encoding laid over the shipped scene.
 */

export interface HeatSpot {
  id: string;
  /** Position inside the stage wrapper, % of width / height. */
  xPct: number;
  yPct: number;
  /** Mapped intensity at the event instant, 0..1 (may exceed 1
   *  for a crit satellite sum — clamped at render). */
  peak: number;
  /** Radius in px at intensity 1. */
  radius: number;
  /** Event instant on the performance clock (live mode). */
  bornAt: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Current intensity of a spot: held peaks render exact; live
 *  spots cool exponentially from their event instant. */
export const spotIntensity = (spot: HeatSpot, now: number, hold: boolean, tauMs: number): number => {
  if (hold) return clamp01(spot.peak);
  const age = Math.max(0, now - spot.bornAt);
  return clamp01(spot.peak * Math.exp(-age / tauMs));
};

const coreColor = (i: number): string => {
  if (i >= 0.85) return 'rgba(255,241,207,0.95)';
  if (i >= 0.5) return 'rgba(255,196,96,0.92)';
  return 'rgba(245,184,61,0.88)';
};

export const HeatOverlay: React.FC<{
  spots: HeatSpot[];
  hold: boolean;
  tauMs?: number;
}> = ({ spots, hold, tauMs = 1100 }) => {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (hold) return undefined;
    let raf = 0;
    const loop = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [hold]);

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 26 }} data-testid="heat-overlay">
      {spots.map((s) => {
        const i = spotIntensity(s, now, hold, tauMs);
        if (i < 0.012) return null;
        const d = 2 * s.radius * Math.sqrt(Math.max(i, 0.001));
        return (
          <div
            key={s.id}
            style={{
              position: 'absolute',
              left: `${s.xPct}%`,
              top: `${s.yPct}%`,
              width: d,
              height: d,
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background: `radial-gradient(circle, ${coreColor(i)} 0%, rgba(255,122,26,0.55) 38%, rgba(255,90,20,0) 70%)`,
              opacity: 0.22 + 0.78 * i,
            }}
          />
        );
      })}
    </div>
  );
};

/** Satellite positions around an impact point: one per damage
 *  component, fanned at fixed angles so the breakdown is spatial
 *  and stable across ticks. */
export const satellite = (
  id: string,
  cx: number,
  cy: number,
  distPct: number,
  angleDeg: number,
  peak: number,
  radius: number,
  bornAt: number,
): HeatSpot => {
  const a = (angleDeg * Math.PI) / 180;
  return {
    id,
    xPct: cx + distPct * Math.cos(a),
    yPct: cy + distPct * 1.35 * Math.sin(a),
    peak,
    radius,
    bornAt,
  };
};

export const HeatChip: React.FC<{ label: string; value: string; hot?: boolean }> = ({ label, value, hot }) => (
  <span style={{ display: 'inline-flex', gap: 5, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.07em', color: hot ? '#FF7A1A' : '#8A93A3' }}>
      {label}
    </span>
    <span
      style={{
        fontSize: 12,
        fontWeight: 900,
        color: hot ? '#FFF1CF' : '#EDEFF4',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </span>
  </span>
);

/**
 * The strip seated under a stage: HEAT label, the cold→hot scale
 * track with a marker at the current intensity, the scale's full
 * point stated in words, and the exact numbers as chips.
 */
export const HeatStrip: React.FC<{
  intensity: number;
  scaleLabel: string;
  children?: React.ReactNode;
}> = ({ intensity, scaleLabel, children }) => {
  const i = clamp01(intensity);
  return (
    <div
      data-testid="heat-strip"
      style={{
        background: '#07080B',
        border: '2px solid #232833',
        borderTop: 'none',
        padding: '10px 12px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: '#8A93A3' }}>HEAT</span>
        <div style={{ flex: 1, position: 'relative', height: 10, background: '#1A1E27' }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, #3A2A12 0%, #F5B83D 45%, #FF7A1A 75%, #FFF1CF 100%)',
              opacity: 0.28 + 0.72 * i,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: -3,
              bottom: -3,
              width: 3,
              left: `calc(${(i * 100).toFixed(1)}% - 1px)`,
              background: '#FFF1CF',
            }}
          />
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 900,
            color: i > 0.02 ? '#FFF1CF' : '#8A93A3',
            fontVariantNumeric: 'tabular-nums',
            minWidth: 38,
            textAlign: 'right',
          }}
        >
          {Math.round(i * 100)}%
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#8A93A3', whiteSpace: 'nowrap' }}>{scaleLabel}</span>
      </div>
      {children && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8 }}>{children}</div>
      )}
    </div>
  );
};
