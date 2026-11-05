/**
 * wardrobeConsoleKit — primitives + tokens for the Wardrobe's
 * "Fitting Console" (Instrument Panel register, owner pick B,
 * 2026-11-05). Scoped to the Wardrobe page: the register is a
 * telemetry console — squared rack panels with steel bezels and
 * corner screws, inset LCD readout wells, LED bar meters. Every
 * numeral is a measurement the game itself derives — the mono
 * voice carries data only, never decoration. Color lives in meter
 * fills, LED states, and readout numerals — never in a colored
 * side bar.
 */
import React from 'react';
import {
  AMBER,
  AMBER_GLOW,
  FAINT,
  GOLD,
  INK,
  monoStyle,
  MUT,
  SEG_EMPTY,
  STEEL_DARK,
  WELL_BG,
} from './wardrobeConsoleTokens';

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
      background: `linear-gradient(180deg, #050403 0%, ${WELL_BG} 100%)`,
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
 * Console push-button: a physical action control. Amber and lit
 * when the action is armed (the commit that is waiting); a dark
 * socket with its state printed when it is not.
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
    className="flex min-h-[44px] w-full items-center justify-center gap-2 px-3 transition-transform active:translate-y-[2px] disabled:opacity-50"
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
    <Led lit={armed && !disabled} color={AMBER_GLOW} size={8} />
    <span className="text-[13px] font-black uppercase tracking-wide">{children}</span>
  </button>
);

/** Compact steel control for bay rows (Preview / Remove). */
export const BayButton: React.FC<{
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
}> = ({ children, disabled = false, onClick, testId }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    disabled={disabled}
    className="flex min-h-[44px] shrink-0 items-center justify-center px-3.5 text-[11px] font-black uppercase tracking-wide disabled:opacity-40"
    style={{
      border: `2px solid ${STEEL_DARK}`,
      background: 'linear-gradient(180deg, #171310 0%, #0C0A07 100%)',
      color: MUT,
      boxShadow: 'inset 0 1px 0 rgba(245,239,230,0.07)',
    }}
  >
    {children}
  </button>
);

/** One mono readout pair in the rig panel: label left, value right. */
export const Readout: React.FC<{ label: string; value: string; valueColor?: string }> = ({
  label,
  value,
  valueColor = INK,
}) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-[11px] font-bold uppercase" style={{ ...monoStyle, color: FAINT, letterSpacing: '0.12em' }}>
      {label}
    </span>
    <span className="text-right text-[12px] font-bold uppercase" style={{ ...monoStyle, color: valueColor }}>
      {value}
    </span>
  </div>
);
