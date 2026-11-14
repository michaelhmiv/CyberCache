import React from 'react';

/**
 * Floating Numbers layer (THROWAWAY rendering prototype, 2026-11-13 —
 * harness only). The numbers-forward combat display, refined by the
 * owner's 23:15 ET direction:
 *
 *  GEOMETRY — every float is born LOW and RISES toward the stage:
 *  a slim readout strip under the stage holds the build's stats as
 *  quiet seats (DMG · CRIT · SPD · FIRE · MOLTEN · ECHO · SHLD).
 *  When a stat changes or fires, its number pops at its seat and
 *  floats up into the stage action as it fades. HP floats are born
 *  at the plates (HP's seat): the damage total at the enemy plate,
 *  absorb/regen low over the hunter. Totals get the biggest type —
 *  but they rise like everything else; nothing sits static.
 *
 *  COLOR LAW (owner-specified): stat losses are RED negatives
 *  (the damage total; HP damage when a hit reaches HP). Crit
 *  events are GREEN. Regen/healing positives are GREEN +. Effects
 *  and components pop in their own colors (DMG gold, SPD cyan,
 *  FIRE orange, MOLTEN deep orange, ECHO violet). Shield absorb
 *  stays blue-family while the shield holds — it is the shield's
 *  number, not HP's; damage that breaks through to HP pops red.
 *
 *  Every float carries its stat's tag (≥11px, DESIGN §5 floor).
 *  Motion: rise + fade on exponential ease-out curves, ~950ms
 *  enemy side, regen slower (1500ms). No bounce/overshoot easing
 *  (detector law from the bars pass). Figures hold their marks —
 *  this layer is the show. This layer REPLACES the shipped
 *  DamageNumber presentation; the harness page hides the shipped
 *  number so the replacement reads clean (README discloses).
 */

export type FloatKind =
  | 'total'
  | 'critTotal'
  | 'satellite'
  | 'proc'
  | 'absorb'
  | 'blocked'
  | 'regen';

/** Where a float is born: a strip seat, or a combatant's plate. */
export type FloatSeat =
  | 'dmg'
  | 'crit'
  | 'spd'
  | 'fire'
  | 'molten'
  | 'echo'
  | 'enemy'
  | 'hunter';

export interface FloatSpec {
  id: number;
  seat: FloatSeat;
  kind: FloatKind;
  text: string;
  tag?: string;
  color: string;
  /** Tag color when it differs from the number's (regen's SHLD tag). */
  tagColor?: string;
  /** px offsets from the birth point. */
  dx?: number;
  dy?: number;
  /** Horizontal drift toward the action over the rise, px. */
  driftPx?: number;
  /** ms after the beat's spawn call. */
  delayMs?: number;
}

export const FLOAT_COLORS = {
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

const LIFE_MS: Record<FloatKind, number> = {
  total: 950,
  critTotal: 1100,
  satellite: 900,
  proc: 1250,
  absorb: 900,
  blocked: 850,
  regen: 1500,
};

const FONT_SIZE: Record<FloatKind, number> = {
  total: 34,
  critTotal: 52,
  satellite: 15,
  proc: 17,
  absorb: 22,
  blocked: 15,
  regen: 24,
};

/** Vertical travel over the rise, px — the climb toward the stage. */
const TRAVEL_PX: Record<FloatKind, number> = {
  total: 118,
  critTotal: 126,
  satellite: 106,
  proc: 110,
  absorb: 92,
  blocked: 78,
  regen: 98,
};

/**
 * Birth points, % of the stage+strip wrapper. Strip seats are the
 * seven equal columns of the readout strip (centers (i+½)/7) at
 * the strip's mid-line; the plates sit at the scene's lower edge.
 */
export const FLOAT_SEATS: Record<FloatSeat, { left: string; top: string }> = {
  dmg: { left: '7.1%', top: '94%' },
  crit: { left: '21.4%', top: '94%' },
  spd: { left: '35.7%', top: '94%' },
  fire: { left: '50%', top: '94%' },
  molten: { left: '64.3%', top: '94%' },
  echo: { left: '78.6%', top: '94%' },
  enemy: { left: '76%', top: '75%' },
  hunter: { left: '21%', top: '72.5%' },
};

const FLOAT_CSS = `
@keyframes fn-rise {
  0% { opacity: 0; transform: translate(-50%, -100%) translateY(8px) scale(var(--fn-pop, 0.8)); }
  12% { opacity: 1; transform: translate(-50%, -100%) translateY(0px) scale(1); }
  58% { opacity: 1; transform: translate(-50%, -100%) translateY(calc(var(--fn-travel) * -0.62)) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -100%) translateY(calc(var(--fn-travel) * -1)) scale(0.98); }
}
@keyframes fn-drift {
  0% { transform: translateX(0px); }
  100% { transform: translateX(var(--fn-drift, 0px)); }
}
@keyframes fn-burst {
  0% { opacity: 1; transform: translate(-50%, -50%) rotate(var(--fn-rot)) translateY(0) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--fn-rot)) translateY(-30px) scale(0.4); }
}
.fn-float { position: absolute; pointer-events: none; z-index: 46; }
.fn-float-inner { position: relative; text-align: center;
  font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1;
  text-shadow: 0 0 7px rgba(0,0,0,0.9), 2px 2px 0 #000; white-space: nowrap; }
.fn-tag { display: block; font-size: 11px; font-weight: 800; letter-spacing: 0.14em;
  line-height: 1.25; text-shadow: 0 0 6px rgba(0,0,0,0.9), 1px 1px 0 #000; }
.fn-burst-bit { position: absolute; left: 50%; top: 42%; width: 5px; height: 5px;
  pointer-events: none; z-index: 45; }
`;

const Burst: React.FC<{ color: string; bits: number }> = ({ color, bits }) => (
  <>
    {Array.from({ length: bits }, (_, i) => (
      <span
        key={i}
        className="fn-burst-bit"
        style={{
          background: color,
          ['--fn-rot' as string]: `${(360 / bits) * i + 18}deg`,
          animation: 'fn-burst 480ms cubic-bezier(.22,1,.36,1) forwards',
        }}
      />
    ))}
  </>
);

const FloatOne: React.FC<{ spec: FloatSpec; onExpire: (id: number) => void }> = ({ spec, onExpire }) => {
  const seat = FLOAT_SEATS[spec.seat];
  const life = LIFE_MS[spec.kind];
  const pop = spec.kind === 'critTotal' ? 0.55 : spec.kind === 'total' ? 0.7 : 0.8;
  return (
    <div
      className="fn-float"
      style={{
        left: `calc(${seat.left} + ${spec.dx ?? 0}px)`,
        top: `calc(${seat.top} + ${spec.dy ?? 0}px)`,
        ['--fn-drift' as string]: `${spec.driftPx ?? 0}px`,
        animation: `fn-drift ${life}ms cubic-bezier(.22,1,.36,1) ${spec.delayMs ?? 0}ms both`,
      }}
    >
      <div
        className="fn-float-inner"
        data-float-kind={spec.kind}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) onExpire(spec.id);
        }}
        style={{
          color: spec.color,
          fontSize: FONT_SIZE[spec.kind],
          ['--fn-pop' as string]: pop,
          ['--fn-travel' as string]: `${TRAVEL_PX[spec.kind]}px`,
          animation: `fn-rise ${life}ms cubic-bezier(.22,1,.36,1) ${spec.delayMs ?? 0}ms both`,
        }}
      >
        {spec.tag && (
          <span className="fn-tag" style={{ color: spec.tagColor ?? spec.color }}>
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

export const FloatLayer: React.FC<{
  floats: FloatSpec[];
  onExpire: (id: number) => void;
}> = ({ floats, onExpire }) => (
  <>
    <style>{FLOAT_CSS}</style>
    {floats.map((f) => (
      <FloatOne key={f.id} spec={f} onExpire={onExpire} />
    ))}
  </>
);

/** Spawn helper: keeps float ids unique across a page's lifetime. */
let floatSeq = 0;
export const makeFloats = (specs: Array<Omit<FloatSpec, 'id'>>): FloatSpec[] =>
  specs.map((s) => ({ ...s, id: (floatSeq += 1) }));

/* ── The readout strip ──────────────────────────────────────── */

export interface StripSeat {
  key: string;
  label: string;
  color: string;
  value: string;
}

const STRIP_SEATS: Array<{ key: string; label: string; color: string }> = [
  { key: 'dmg', label: 'DMG', color: FLOAT_COLORS.dmg },
  { key: 'crit', label: 'CRIT', color: FLOAT_COLORS.crit },
  { key: 'spd', label: 'SPD', color: FLOAT_COLORS.spd },
  { key: 'fire', label: 'FIRE', color: FLOAT_COLORS.fire },
  { key: 'molten', label: 'MOLTEN', color: FLOAT_COLORS.molten },
  { key: 'echo', label: 'ECHO', color: FLOAT_COLORS.echo },
  { key: 'shld', label: 'SHLD', color: FLOAT_COLORS.shield },
];

/**
 * The slim readout strip under the stage: the build's stats as
 * quiet seats. A seat's value prints dim at rest and in its stat
 * color while its float is in the air — the strip announces the
 * change, the float carries it up into the stage. The SHLD seat
 * also carries the shield's slim charge bar (drains on absorb,
 * refills on regen). Labels at the 11px floor, values tabular.
 */
export const ReadoutStrip: React.FC<{
  values: Record<string, string>;
  active: ReadonlySet<string>;
  shield: number;
}> = ({ values, active, shield }) => (
  <div
    data-testid="numbers-readout-strip"
    style={{
      display: 'flex',
      background: '#07080B',
      border: '2px solid #232833',
      borderTop: 'none',
      boxSizing: 'border-box',
    }}
  >
    {STRIP_SEATS.map((seat) => {
      const isActive = active.has(seat.key);
      return (
        <div
          key={seat.key}
          data-strip-seat={seat.key}
          style={{
            flex: '1 1 0',
            textAlign: 'center',
            padding: '4px 0 5px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.12em',
              lineHeight: 1.25,
              color: isActive ? seat.color : '#9A8A6E',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {seat.label}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 900,
              lineHeight: 1.3,
              color: isActive ? seat.color : '#F5ECDA',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {values[seat.key] ?? '—'}
          </div>
          {seat.key === 'shld' && (
            <div style={{ height: 4, background: '#10131A', margin: '2px 10px 0' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(0, Math.min(100, shield))}%`,
                  background: FLOAT_COLORS.shield,
                  transition: 'width 700ms cubic-bezier(.22,1,.36,1)',
                }}
              />
            </div>
          )}
        </div>
      );
    })}
  </div>
);
