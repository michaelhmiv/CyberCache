/**
 * cacheRankConsoleKit — primitives for the Cache Rank console
 * register (Instrument Panel, owner pick B for this page,
 * 2026-11-05).
 *
 * The register is a telemetry console: squared rack panels with
 * steel bezels and corner screws, inset LCD readout wells, LED
 * bar meters, and a tick-arc charge gauge. Every numeral on the
 * page is a measurement the game itself derives — the mono voice
 * is used for data only, never as decoration. Color lives in
 * meter fills, LED states, and readout numerals — never in a
 * colored side bar.
 */
import React from 'react';
import {
  AMBER,
  AMBER_GLOW,
  FAINT,
  GOLD,
  INK,
  monoStyle,
  SEG_EMPTY,
  STEEL_DARK,
} from './cacheRankConsoleTokens';

const panelShell: React.CSSProperties = {
  border: '2px solid #000',
  background: 'linear-gradient(180deg, #171310 0%, #100D09 58%, #0B0906 100%)',
  boxShadow:
    'inset 0 0 0 1px rgba(163,152,134,0.30), inset 0 1px 0 rgba(245,239,230,0.06), 4px 4px 0 rgba(0,0,0,0.6)',
};

/** Corner screws — 5px squares seated inside the squared corners. */
const Screws: React.FC = () => (
  <>
    {['left-[5px] top-[5px]', 'right-[5px] top-[5px]', 'bottom-[5px] left-[5px]', 'bottom-[5px] right-[5px]'].map(
      (pos) => (
        <span
          key={pos}
          aria-hidden="true"
          className={`absolute ${pos} h-[5px] w-[5px]`}
          style={{ backgroundColor: '#060504', boxShadow: 'inset 0 1px 0 rgba(201,187,166,0.55)' }}
        />
      ),
    )}
  </>
);

/** A squared rack panel: bezel + screws, content padded clear. */
export const Panel: React.FC<{
  children: React.ReactNode;
  className?: string;
  testId?: string;
}> = ({ children, className = '', testId }) => (
  <section className={`relative ${className}`} style={panelShell} data-testid={testId}>
    <Screws />
    <div className="relative px-3.5 py-3">{children}</div>
  </section>
);

/**
 * Panel datum line: the measurement this panel reads, set as a
 * mono label with a ruled line and a short gold datum segment.
 */
export const PanelLabel: React.FC<{ label: string; right?: string; rightColor?: string }> = ({
  label,
  right,
  rightColor = FAINT,
}) => (
  <div className="mb-2.5">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] font-black uppercase" style={{ ...monoStyle, color: FAINT, letterSpacing: '0.14em' }}>
        {label}
      </span>
      {right && (
        <span className="text-[11px] font-bold" style={{ ...monoStyle, color: rightColor }}>
          {right}
        </span>
      )}
    </div>
    <div className="mt-1.5 flex" aria-hidden="true">
      <span style={{ width: 26, height: 2, backgroundColor: GOLD }} />
      <span className="flex-1" style={{ height: 1, marginTop: 1, backgroundColor: STEEL_DARK }} />
    </div>
  </div>
);

/** Inset LCD well: one measured value, scanlined dark glass. */
export const LcdWell: React.FC<{
  value: string;
  label: string;
  color?: string;
  valueSize?: number;
  className?: string;
}> = ({ value, label, color = INK, valueSize = 22, className = '' }) => (
  <div
    className={`relative overflow-hidden px-2 py-1.5 ${className}`}
    style={{
      border: `1px solid ${STEEL_DARK}`,
      background: 'linear-gradient(180deg, #050403 0%, #0A0806 100%)',
      boxShadow: 'inset 0 2px 7px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.6)',
    }}
  >
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(245,239,230,0.035) 0px, rgba(245,239,230,0.035) 1px, transparent 1px, transparent 3px)',
      }}
    />
    <div className="relative text-center font-bold leading-none" style={{ ...monoStyle, color, fontSize: valueSize }}>
      {value}
    </div>
    <div
      className="relative mt-1 text-center text-[11px] font-bold uppercase leading-none"
      style={{ ...monoStyle, color: FAINT, letterSpacing: '0.12em' }}
    >
      {label}
    </div>
  </div>
);

/** A single LED indicator: lit (glow) or dark. */
export const Led: React.FC<{ lit: boolean; color?: string; size?: number }> = ({
  lit,
  color = GOLD,
  size = 9,
}) => (
  <span
    aria-hidden="true"
    className="inline-block shrink-0"
    style={{
      width: size,
      height: size,
      backgroundColor: lit ? color : SEG_EMPTY,
      border: '1px solid rgba(0,0,0,0.8)',
      boxShadow: lit ? `0 0 7px ${color}AA, inset 0 0 0 1px rgba(0,0,0,0.35)` : 'inset 0 1px 2px rgba(0,0,0,0.8)',
    }}
  />
);

/** LED bar meter — the console's progress measure. */
export const LedMeter: React.FC<{
  filled: number;
  total: number;
  color: string;
  height?: number;
}> = ({ filled, total, color, height = 14 }) => (
  <div className="flex gap-[2px]" role="img" aria-label={`${filled} of ${total}`}>
    {Array.from({ length: total }, (_, i) => (
      <span
        key={i}
        className="flex-1"
        style={{
          height,
          backgroundColor: i < filled ? color : SEG_EMPTY,
          border: '1px solid rgba(0,0,0,0.65)',
          boxShadow:
            i < filled
              ? `0 0 5px ${color}59, inset 0 1px 0 rgba(255,255,255,0.22)`
              : 'inset 0 1px 3px rgba(0,0,0,0.75)',
        }}
      />
    ))}
  </div>
);

/**
 * Tick-arc charge gauge: 41 machined ticks swept over 180°, the
 * filled sweep in token gold, a needle at the measured fraction.
 * Built from rotated divs — no SVG, per the game's icon law.
 */
export const TickGauge: React.FC<{ pct: number; radius?: number }> = ({ pct, radius = 142 }) => {
  const TICKS = 41;
  const clamped = Math.max(0, Math.min(100, pct));
  const needleAngle = -90 + (clamped / 100) * 180;
  return (
    <div className="relative mx-auto" style={{ width: radius * 2 + 24, height: radius + 40 }}>
      {/* scale labels */}
      <span className="absolute left-0 top-1 text-[11px] font-bold" style={{ ...monoStyle, color: FAINT }}>
        0%
      </span>
      <span
        className="absolute left-1/2 top-1 -translate-x-1/2 text-[11px] font-bold"
        style={{ ...monoStyle, color: FAINT }}
      >
        50%
      </span>
      <span className="absolute right-0 top-1 text-[11px] font-bold" style={{ ...monoStyle, color: FAINT }}>
        100%
      </span>
      {/* ticks */}
      {Array.from({ length: TICKS }, (_, i) => {
        const angle = -90 + i * (180 / (TICKS - 1));
        const major = i % 5 === 0;
        const filled = (i / (TICKS - 1)) * 100 <= clamped;
        const w = major ? 3 : 2;
        const len = major ? 17 : 10;
        return (
          <span
            key={i}
            aria-hidden="true"
            className="absolute"
            style={{
              left: '50%',
              bottom: 14,
              width: 0,
              height: radius,
              transform: `rotate(${angle}deg)`,
              transformOrigin: '0 100%',
            }}
          >
            <span
              className="absolute top-0"
              style={{
                left: -w / 2,
                width: w,
                height: len,
                backgroundColor: filled ? GOLD : '#2C2417',
                boxShadow: filled ? `0 0 4px ${GOLD}55` : undefined,
              }}
            />
          </span>
        );
      })}
      {/* needle */}
      <span
        aria-hidden="true"
        className="absolute"
        style={{
          left: '50%',
          bottom: 14,
          width: 0,
          height: radius - 24,
          transform: `rotate(${needleAngle}deg)`,
          transformOrigin: '0 100%',
        }}
      >
        <span
          className="absolute top-0"
          style={{
            left: -1.5,
            width: 3,
            height: '100%',
            background: `linear-gradient(180deg, ${AMBER_GLOW} 0%, ${GOLD} 55%, rgba(242,192,99,0.2) 100%)`,
          }}
        />
      </span>
      {/* hub */}
      <span
        aria-hidden="true"
        className="absolute rounded-full"
        style={{
          left: '50%',
          bottom: 14,
          width: 19,
          height: 19,
          transform: 'translate(-50%, 50%)',
          background: 'radial-gradient(circle at 38% 32%, #8A7D68 0%, #4A4234 58%, #241D13 100%)',
          border: '2px solid #000',
          boxShadow: 'inset 0 0 0 1px rgba(245,239,230,0.25)',
        }}
      />
      {/* base line */}
      <span
        aria-hidden="true"
        className="absolute"
        style={{ left: 4, right: 4, bottom: 13, height: 1, backgroundColor: STEEL_DARK }}
      />
    </div>
  );
};

/**
 * Console push-button: a physical spend control. Amber and lit
 * when the spend is armed (affordable); a dark socket with the
 * shortfall printed when it is not.
 */
export const PushButton: React.FC<{
  children: React.ReactNode;
  armed: boolean;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
}> = ({ children, armed, disabled = false, onClick, testId }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    disabled={disabled}
    className="flex min-h-[44px] w-full items-center justify-center gap-2 px-3 transition-transform active:translate-y-[2px]"
    style={
      armed
        ? {
            background: `linear-gradient(180deg, #FFB03A 0%, ${AMBER} 100%)`,
            color: '#140B02',
            border: '2px solid #000',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 3px 3px 0 rgba(0,0,0,0.7)',
          }
        : {
            background: 'linear-gradient(180deg, #14100B 0%, #0A0806 100%)',
            color: FAINT,
            border: `2px solid ${STEEL_DARK}`,
            boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.8)',
          }
    }
  >
    <Led lit={armed} color={AMBER_GLOW} size={8} />
    <span className="text-[13px] font-black uppercase tracking-wide">{children}</span>
  </button>
);
