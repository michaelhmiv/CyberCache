/**
 * manualConsoleKit — the B-register ("Instrument panel") material
 * kit for the Field Manual: squared rack modules with corner
 * screws, scanlined LCD readout wells, status lamps, and
 * push-buttons. Where Arena Plates is a bound book, B is the rig's
 * own service terminal — everything is measured, labelled like a
 * unit, and read off a well.
 *
 * Color law (DESIGN.md §1): amber marks the one primary action or
 * the live state only; green is a completed/positive state; bone is
 * data. Nothing here paints a section.
 */
import React from 'react';
import { CK } from './manualConsoleTokens';

const SCANLINES =
  'repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px)';

/** One-time keyframes for the console (lamp pulse, caret blink). */
export const ConsoleStyles: React.FC = () => (
  <style>{`
    @keyframes ck-lamp-pulse { 0%, 58% { opacity: 1; } 59%, 100% { opacity: 0.5; } }
    .ck-lamp-live { animation: ck-lamp-pulse 1.15s steps(1) infinite; }
    .ck-num { font-variant-numeric: tabular-nums; }
  `}</style>
);

/** Four corner screw heads — the rack module's fasteners. */
export const Screws: React.FC = () => (
  <>
    {(['left-1 top-1', 'right-1 top-1', 'bottom-1 left-1', 'bottom-1 right-1'] as const).map((pos, i) => (
      <span
        key={pos}
        aria-hidden
        className={`pointer-events-none absolute ${pos} block h-[7px] w-[7px]`}
        style={{
          background: 'linear-gradient(145deg, #43404E, #1D2029)',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.14)',
        }}
      >
        <span
          className="absolute left-1/2 top-1/2 block h-[1.5px] w-[5px] -translate-x-1/2 -translate-y-1/2 bg-black/70"
          style={{ transform: `translate(-50%,-50%) rotate(${i % 2 === 0 ? 38 : -24}deg)` }}
        />
      </span>
    ))}
  </>
);

/** A squared rack module: black outer rule, steel bezel, panel face. */
export const Rack: React.FC<{
  children: React.ReactNode;
  inner?: boolean;
  className?: string;
  testId?: string;
}> = ({ children, inner, className = '', testId }) => (
  <section
    data-testid={testId}
    className={`relative ${className}`}
    style={{
      background: inner ? CK.panelInner : CK.panel,
      border: '2px solid #000',
      boxShadow: `inset 0 0 0 1px ${CK.bezel}, inset 0 1px 0 ${CK.seam}, 4px 4px 0 rgba(0,0,0,0.55)`,
    }}
  >
    <Screws />
    {children}
  </section>
);

/** Module header strip: label left, readout right, ruled off by a seam. */
export const RackHead: React.FC<{
  icon?: React.ReactNode;
  label: string;
  readout?: React.ReactNode;
}> = ({ icon, label, readout }) => (
  <div
    className="flex min-h-[36px] items-center gap-2 px-3"
    style={{ borderBottom: `1px solid ${CK.bezel}`, boxShadow: `0 1px 0 rgba(0,0,0,0.6)` }}
  >
    {icon}
    <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: CK.boneDim }}>
      {label}
    </span>
    {readout}
  </div>
);

/** An LCD readout well: sunken glass, scanlines, one label + one value. */
export const Lcd: React.FC<{
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  className?: string;
}> = ({ label, value, valueColor, className = '' }) => (
  <div
    className={`px-2.5 py-2 ${className}`}
    style={{
      background: `${SCANLINES}, ${CK.lcd}`,
      boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.05)',
    }}
  >
    <div className="text-[11px] font-semibold uppercase leading-none tracking-[0.14em]" style={{ color: CK.label }}>
      {label}
    </div>
    <div
      className="ck-num mt-1.5 text-[19px] font-bold leading-none"
      style={{ color: valueColor ?? CK.bone, textShadow: '0 0 7px rgba(234,227,209,0.22)' }}
    >
      {value}
    </div>
  </div>
);

/** Status lamp: ok = lit green, live = pulsing amber, off = dark socket. */
export const Lamp: React.FC<{ state: 'ok' | 'live' | 'off'; size?: number }> = ({ state, size = 10 }) => (
  <span
    aria-hidden
    className={state === 'live' ? 'ck-lamp-live block shrink-0' : 'block shrink-0'}
    style={{
      width: size,
      height: size,
      background:
        state === 'ok'
          ? `radial-gradient(circle at 35% 32%, #D9FFB0 0%, ${CK.green} 55%, #3E7D00 100%)`
          : state === 'live'
            ? `radial-gradient(circle at 35% 32%, #FFD9A0 0%, ${CK.amber} 55%, #8A4D00 100%)`
            : CK.lampOff,
      boxShadow:
        state === 'ok'
          ? `0 0 8px rgba(124,252,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.55)`
          : state === 'live'
            ? `0 0 9px rgba(255,144,0,0.6), inset 0 0 0 1px rgba(0,0,0,0.55)`
            : 'inset 0 1px 2px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(0,0,0,0.6)',
    }}
  />
);

/** A physical push-button: steel face, black rule, 3px base edge. */
export const PushBtn: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}> = ({ children, onClick, primary, disabled, className = '', ariaLabel }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    className={`flex min-h-[44px] items-center justify-center gap-2 px-3 text-[12px] font-bold uppercase tracking-[0.14em] transition-transform active:translate-y-[2px] disabled:opacity-35 ${className}`}
    style={
      primary
        ? {
            background: 'linear-gradient(180deg, #FFAA2E 0%, #FF9000 60%, #E07B00 100%)',
            color: '#14100A',
            border: '2px solid #000',
            boxShadow: '0 3px 0 #000, inset 0 1px 0 rgba(255,255,255,0.45)',
          }
        : {
            background: 'linear-gradient(180deg, #262B38 0%, #181C25 100%)',
            color: CK.bone,
            border: '2px solid #000',
            boxShadow: `0 3px 0 #000, inset 0 0 0 1px ${CK.bezel}, inset 0 1px 0 ${CK.seam}`,
          }
    }
  >
    {children}
  </button>
);

/** Small readout word (right-aligned instrument annotation). */
export const Readout: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
  <span className="ck-num text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: color ?? CK.label }}>
    {children}
  </span>
);
