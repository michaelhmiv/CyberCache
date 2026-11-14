import React from 'react';

/**
 * Floating Numbers layer — HOME edition (THROWAWAY rendering
 * prototype, 2026-11-14 — harness only). The numbers-forward
 * system from the strip take (FloatNumbers.tsx: color law, type
 * scale, rise + fade on exponential ease-out), transplanted onto
 * the REAL Home screen per the owner's correction: no invented
 * readout strip — every float is born at a seat that already
 * exists in the shipped grid (a HeroRundown cell, a stage plate)
 * or, for stats the grid does not seat (element, procs), at the
 * impact point on the enemy. The page resolves each birth anchor
 * from the live DOM at spawn time and hands this layer absolute
 * px coordinates relative to the overlay wrapper; the layer is
 * presentation only.
 *
 * COLOR LAW (owner-specified): stat losses RED negatives (the
 * damage total; HP damage when a hit reaches HP). Crit events
 * GREEN. Regen/healing GREEN +. Effects and components in their
 * own colors (DMG gold, SPD cyan, FIRE orange, MOLTEN deep
 * orange, ECHO violet). Shield absorb blue while the shield
 * holds; mitigation BLOCKED grey.
 *
 * Every float carries its stat's tag (≥11px, DESIGN §5 floor).
 * No bounce/overshoot easing anywhere (detector law).
 */

export type HomeFloatKind =
  | 'total'
  | 'critTotal'
  | 'satellite'
  | 'proc'
  | 'absorb'
  | 'blocked'
  | 'regen';

export interface HomeFloatSpec {
  id: number;
  /** Birth point, px relative to the overlay wrapper. Floats are
   *  anchored bottom-center here and rise from it. */
  x: number;
  y: number;
  kind: HomeFloatKind;
  text: string;
  tag?: string;
  color: string;
  /** Tag color when it differs from the number's (regen's SHLD tag). */
  tagColor?: string;
  /** Horizontal drift over the rise, px (toward the action). */
  driftPx?: number;
  /** Vertical travel over the rise, px (kind default if unset). */
  travelPx?: number;
  /** ms after the beat's spawn call. */
  delayMs?: number;
}

export const HOME_FLOAT_COLORS = {
  total: '#FF5566',
  crit: '#5FD95F',
  dmg: '#FFD23C',
  spd: '#2DD4EE',
  fire: '#FF7A1A',
  molten: '#FF8A00',
  echo: '#B18CFF',
  shield: '#6EC1FF',
  blocked: '#C7CBD4',
  regen: '#5FD95F',
} as const;

const LIFE_MS: Record<HomeFloatKind, number> = {
  total: 950,
  critTotal: 1100,
  satellite: 1000,
  proc: 1250,
  absorb: 1000,
  blocked: 900,
  regen: 1500,
};

const FONT_SIZE: Record<HomeFloatKind, number> = {
  total: 34,
  critTotal: 52,
  satellite: 15,
  proc: 17,
  absorb: 22,
  blocked: 15,
  regen: 24,
};

/** Default vertical travel: grid-born floats climb from the
 *  rundown (the stage's foot) up into the stage; plate-born
 *  floats climb their shorter arc over the enemy. */
const TRAVEL_PX: Record<HomeFloatKind, number> = {
  total: 118,
  critTotal: 126,
  satellite: 170,
  proc: 130,
  absorb: 165,
  blocked: 135,
  regen: 150,
};

const FLOAT_CSS = `
@keyframes nh-rise {
  0% { opacity: 0; transform: translate(-50%, -100%) translateY(8px) scale(var(--nh-pop, 0.8)); }
  12% { opacity: 1; transform: translate(-50%, -100%) translateY(0px) scale(1); }
  58% { opacity: 1; transform: translate(-50%, -100%) translateY(calc(var(--nh-travel) * -0.62)) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -100%) translateY(calc(var(--nh-travel) * -1)) scale(0.98); }
}
@keyframes nh-drift {
  0% { transform: translateX(0px); }
  100% { transform: translateX(var(--nh-drift, 0px)); }
}
@keyframes nh-burst {
  0% { opacity: 1; transform: translate(-50%, -50%) rotate(var(--nh-rot)) translateY(0) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--nh-rot)) translateY(-30px) scale(0.4); }
}
.nh-float { position: absolute; pointer-events: none; z-index: 70; }
.nh-float-inner { position: relative; text-align: center;
  font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1;
  text-shadow: 0 0 7px rgba(0,0,0,0.9), 2px 2px 0 #000; white-space: nowrap; }
.nh-tag { display: block; font-size: 11px; font-weight: 800; letter-spacing: 0.14em;
  line-height: 1.25; text-shadow: 0 0 6px rgba(0,0,0,0.9), 1px 1px 0 #000; }
.nh-burst-bit { position: absolute; left: 50%; top: 42%; width: 5px; height: 5px;
  pointer-events: none; z-index: 69; }
`;

const Burst: React.FC<{ color: string; bits: number }> = ({ color, bits }) => (
  <>
    {Array.from({ length: bits }, (_, i) => (
      <span
        key={i}
        className="nh-burst-bit"
        style={{
          background: color,
          ['--nh-rot' as string]: `${(360 / bits) * i + 18}deg`,
          animation: 'nh-burst 480ms cubic-bezier(.22,1,.36,1) forwards',
        }}
      />
    ))}
  </>
);

const FloatOne: React.FC<{ spec: HomeFloatSpec; onExpire: (id: number) => void }> = ({ spec, onExpire }) => {
  const life = LIFE_MS[spec.kind];
  const pop = spec.kind === 'critTotal' ? 0.55 : spec.kind === 'total' ? 0.7 : 0.8;
  return (
    <div
      className="nh-float"
      style={{
        left: spec.x,
        top: spec.y,
        ['--nh-drift' as string]: `${spec.driftPx ?? 0}px`,
        animation: `nh-drift ${life}ms cubic-bezier(.22,1,.36,1) ${spec.delayMs ?? 0}ms both`,
      }}
    >
      <div
        className="nh-float-inner"
        data-float-kind={spec.kind}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) onExpire(spec.id);
        }}
        style={{
          color: spec.color,
          fontSize: FONT_SIZE[spec.kind],
          ['--nh-pop' as string]: pop,
          ['--nh-travel' as string]: `${spec.travelPx ?? TRAVEL_PX[spec.kind]}px`,
          animation: `nh-rise ${life}ms cubic-bezier(.22,1,.36,1) ${spec.delayMs ?? 0}ms both`,
        }}
      >
        {spec.tag && (
          <span className="nh-tag" style={{ color: spec.tagColor ?? spec.color }}>
            {spec.tag}
          </span>
        )}
        {spec.text}
        {(spec.kind === 'critTotal' || spec.kind === 'proc') && (
          <Burst color={spec.color} bits={spec.kind === 'critTotal' ? 6 : 4} />
        )}
      </div>
    </div>
  );
};

export const FloatLayerHome: React.FC<{
  floats: HomeFloatSpec[];
  onExpire: (id: number) => void;
}> = ({ floats, onExpire }) => (
  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 70, overflow: 'visible' }}>
    <style>{FLOAT_CSS}</style>
    {floats.map((f) => (
      <FloatOne key={f.id} spec={f} onExpire={onExpire} />
    ))}
  </div>
);

/** Spawn helper: keeps float ids unique across a page's lifetime. */
let floatSeq = 0;
export const makeHomeFloats = (specs: Array<Omit<HomeFloatSpec, 'id'>>): HomeFloatSpec[] =>
  specs.map((s) => ({ ...s, id: (floatSeq += 1) }));
