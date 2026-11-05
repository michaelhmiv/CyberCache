/**
 * profileTelemetry — the Instrument Panel kit for the Hunter
 * Profile & Record stop (Register B, "Service Telemetry"; owner
 * pick from the Hunter sub-page review PDF, 2026-11-05).
 *
 * Ported from the approved prototype
 * (design/hunter-subpages-profile-b: telemetryKit/telemetryTokens)
 * and scoped to this page's components: squared rack panels with
 * steel bezels and corner screws, inset LCD readout wells, LED bar
 * meters, channel rows, and physical push-buttons. Every numeral
 * is a measurement the game itself keeps — the mono voice is used
 * for data only, never as decoration. Color lives in meter fills,
 * LED states, and readout numerals — never in a colored side bar.
 *
 * Sibling B builds (Standings, Collections, Cache Rank, Research,
 * Wardrobe) carry their own scoped kits; this file is Profile's.
 */
import React from 'react';
import {
  TM_FAINT,
  TM_GOLD,
  TM_INK,
  TM_MUT,
  TM_SEG_EMPTY,
  TM_STEEL_DARK,
  tmHeadStyle,
  tmMonoStyle,
} from './profileTelemetryTheme';

const panelShell: React.CSSProperties = {
  border: '2px solid #000',
  background: 'linear-gradient(180deg, #171310 0%, #100D09 58%, #0B0906 100%)',
  boxShadow:
    'inset 0 0 0 1px rgba(163,152,134,0.30), inset 0 1px 0 rgba(245,239,230,0.06), 4px 4px 0 rgba(0,0,0,0.6)',
};

/** Corner screws — 5px squares seated inside the squared corners. */
const TmScrews: React.FC = () => (
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
export const TmPanel: React.FC<{
  children: React.ReactNode;
  className?: string;
  testId?: string;
}> = ({ children, className = '', testId }) => (
  <section className={`relative ${className}`} style={panelShell} data-testid={testId}>
    <TmScrews />
    <div className="relative px-3.5 py-3">{children}</div>
  </section>
);

/**
 * Panel datum line: the measurement this panel reads, set as a
 * mono label with a ruled line and a short gold datum segment.
 */
export const TmPanelLabel: React.FC<{ label: string; right?: string; rightColor?: string }> = ({
  label,
  right,
  rightColor = TM_FAINT,
}) => (
  <div className="mb-2.5">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] font-black uppercase" style={{ ...tmMonoStyle, color: TM_FAINT, letterSpacing: '0.14em' }}>
        {label}
      </span>
      {right && (
        <span className="text-[11px] font-bold uppercase" style={{ ...tmMonoStyle, color: rightColor }}>
          {right}
        </span>
      )}
    </div>
    <div className="mt-1.5 flex" aria-hidden="true">
      <span style={{ width: 26, height: 2, backgroundColor: TM_GOLD }} />
      <span className="flex-1" style={{ height: 1, marginTop: 1, backgroundColor: TM_STEEL_DARK }} />
    </div>
  </div>
);

const wellShell: React.CSSProperties = {
  border: `1px solid ${TM_STEEL_DARK}`,
  background: 'linear-gradient(180deg, #050403 0%, #0A0806 100%)',
  boxShadow: 'inset 0 2px 7px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.6)',
};

const wellScanlines: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(0deg, rgba(245,239,230,0.035) 0px, rgba(245,239,230,0.035) 1px, transparent 1px, transparent 3px)',
};

/**
 * Inset LCD well: one measured value, scanlined dark glass. With
 * an onClick the well is a button (the per-metric Totals drill-down
 * rides the wells, as the retired stat cards carried it) and keeps
 * a ≥44px target.
 */
export const TmLcdWell: React.FC<{
  value: string;
  label: string;
  color?: string;
  valueSize?: number;
  className?: string;
  onClick?: () => void;
}> = ({ value, label, color = TM_INK, valueSize = 22, className = '', onClick }) => {
  const body = (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={wellScanlines}
      />
      <div className="relative text-center font-bold leading-none" style={{ ...tmMonoStyle, color, fontSize: valueSize }}>
        {value}
      </div>
      <div
        className="relative mt-1 text-center text-[11px] font-bold uppercase leading-none"
        style={{ ...tmMonoStyle, color: TM_FAINT, letterSpacing: '0.12em' }}
      >
        {label}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}: ${value}. Open the breakdown.`}
        className={`relative min-h-[44px] overflow-hidden px-2 py-1.5 text-center transition-transform active:scale-[0.98] ${className}`}
        style={wellShell}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={`relative overflow-hidden px-2 py-1.5 ${className}`} style={wellShell}>
      {body}
    </div>
  );
};

/** A single LED indicator: lit (glow) or dark. */
export const TmLed: React.FC<{ lit: boolean; color?: string; size?: number }> = ({
  lit,
  color = TM_GOLD,
  size = 9,
}) => (
  <span
    aria-hidden="true"
    className="inline-block shrink-0"
    style={{
      width: size,
      height: size,
      backgroundColor: lit ? color : TM_SEG_EMPTY,
      border: '1px solid rgba(0,0,0,0.8)',
      boxShadow: lit ? `0 0 7px ${color}AA, inset 0 0 0 1px rgba(0,0,0,0.35)` : 'inset 0 1px 2px rgba(0,0,0,0.8)',
    }}
  />
);

/** LED bar meter — the console's progress measure. */
export const TmLedMeter: React.FC<{
  filled: number;
  total: number;
  color: string;
  height?: number;
  label?: string;
}> = ({ filled, total, color, height = 14, label }) => (
  <div className="flex gap-[2px]" role="img" aria-label={label ?? `${filled} of ${total}`}>
    {Array.from({ length: total }, (_, i) => (
      <span
        key={i}
        className="flex-1"
        style={{
          height,
          backgroundColor: i < filled ? color : TM_SEG_EMPTY,
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
 * Channel row: one measured distribution channel — name, its LED
 * bar meter, and the exact count as a mono readout. The meter is
 * the share at a glance; the numeral is the fact.
 */
export const TmChannelRow: React.FC<{
  name: string;
  value: string;
  filled: number;
  total?: number;
  color: string;
}> = ({ name, value, filled, total = 20, color }) => (
  <div className="flex items-center gap-2.5 py-[5px]">
    <span
      className="w-[86px] shrink-0 truncate text-[11px] font-bold uppercase"
      style={{ ...tmMonoStyle, color: TM_MUT, letterSpacing: '0.08em' }}
    >
      {name}
    </span>
    <div className="min-w-0 flex-1">
      <TmLedMeter filled={filled} total={total} color={color} height={11} label={`${name}: ${value}`} />
    </div>
    <span className="w-[64px] shrink-0 text-right text-[13px] font-bold" style={{ ...tmMonoStyle, color: TM_INK }}>
      {value}
    </span>
  </div>
);

/**
 * Readout row: one lifetime total as a measured line — optional
 * LED state, mono label, optional detail, and the value
 * right-aligned in tabular mono. With an onClick the row is a
 * button carrying the per-metric Totals drill-down.
 */
export const TmReadoutRow: React.FC<{
  label: string;
  value: string;
  detail?: string;
  ledColor?: string;
  valueColor?: string;
  onClick?: () => void;
}> = ({ label, value, detail, ledColor, valueColor = TM_INK, onClick }) => {
  const body = (
    <>
      {ledColor && <TmLed lit color={ledColor} size={7} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-bold uppercase leading-tight" style={{ ...tmMonoStyle, color: TM_MUT, letterSpacing: '0.1em' }}>
          {label}
        </span>
        {detail && (
          <span className="block text-[11px] leading-tight [overflow-wrap:anywhere]" style={{ ...tmMonoStyle, color: TM_FAINT }}>
            {detail}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[15px] font-bold" style={{ ...tmMonoStyle, color: valueColor }}>
        {value}
      </span>
    </>
  );
  const rowStyle: React.CSSProperties = { borderBottom: '1px solid rgba(58,52,43,0.55)' };
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}: ${value}. Open the breakdown.`}
        className="flex min-h-[44px] w-full items-center gap-2.5 text-left"
        style={rowStyle}
      >
        {body}
      </button>
    );
  }
  return (
    <div className="flex min-h-[36px] items-center gap-2.5" style={rowStyle}>
      {body}
    </div>
  );
};

/** Group datum inside a bank: a quiet ruled sub-head for a channel group. */
export const TmGroupDatum: React.FC<{ label: string }> = ({ label }) => (
  <div className="mb-1 mt-3.5 flex items-center gap-2 first:mt-0">
    <span className="text-[11px] font-black uppercase" style={{ ...tmMonoStyle, color: TM_GOLD, letterSpacing: '0.16em' }}>
      {label}
    </span>
    <span className="flex-1" style={{ height: 1, backgroundColor: TM_STEEL_DARK }} aria-hidden="true" />
  </div>
);

/**
 * Console push-button: a physical key on the rack — deep face,
 * hard bottom edge that reads as travel, LED pip when armed.
 * Always ≥48px tall.
 */
export const TmPushButton: React.FC<{
  label: string;
  sub?: string;
  ledColor?: string;
  accent?: string;
  onClick?: () => void;
  testId?: string;
}> = ({ label, sub, ledColor, accent = TM_INK, onClick, testId }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="flex min-h-[48px] w-full items-center gap-3 px-3.5 text-left active:translate-y-[2px]"
    style={{
      border: '2px solid #000',
      background: 'linear-gradient(180deg, #241D15 0%, #171310 70%)',
      boxShadow:
        'inset 0 0 0 1px rgba(163,152,134,0.35), inset 0 1px 0 rgba(245,239,230,0.10), 0 3px 0 #000',
      color: accent,
    }}
  >
    {ledColor && <TmLed lit color={ledColor} size={10} />}
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[13px] font-black uppercase leading-tight" style={{ fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '0.08em' }}>
        {label}
      </span>
      {sub && (
        <span className="block text-[11px] leading-snug" style={{ ...tmMonoStyle, color: TM_FAINT }}>
          {sub}
        </span>
      )}
    </span>
  </button>
);

/** A small console key for the doors row (prototype door keys). */
export const TmDoorKey: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  testId?: string;
  children?: React.ReactNode;
}> = ({ label, icon, onClick, testId, children }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="flex min-h-[52px] flex-col items-center justify-center gap-1 px-1 py-1.5 active:translate-y-[2px]"
    style={{
      border: '2px solid #000',
      background: 'linear-gradient(180deg, #241D15 0%, #171310 70%)',
      boxShadow: 'inset 0 0 0 1px rgba(163,152,134,0.35), 0 3px 0 #000',
      color: TM_MUT,
    }}
  >
    {icon}
    <span className="text-[11px] font-black uppercase" style={{ ...tmHeadStyle, letterSpacing: '0.1em' }}>
      {label}
    </span>
    {children}
  </button>
);
