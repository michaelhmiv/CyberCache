import React, { useEffect, useRef } from 'react';

/**
 * TICKER LEDGER (iter-04, harness-only display language).
 *
 * The action streams as an event tape: short timestamped ledger
 * lines — components first, then the TOTAL line they sum to, with a
 * running BALANCE on every total. The fight reads like a ledger you
 * can audit at a glance: components sum to totals, totals walk the
 * balance down (or up), and the closing entry settles the account.
 *
 * Display only. Every number is supplied by the calling harness
 * page from the program fixtures / real defs; this component does
 * no math beyond rendering what it is handed. Numbers land exact —
 * no count-up tweens through false intermediate values; emphasis is
 * a one-shot flash on the newest line, never a moving number.
 */

export type LedgerKind =
  | 'open' // engagement / job opening line
  | 'hit' // a plain component line
  | 'proc' // a named proc component line (tinted label)
  | 'crit' // the crit component line (gold, bold)
  | 'total' // the line the components sum to (double rule)
  | 'hurt' // damage taken (red amount)
  | 'tele' // telegraph — full-bleed danger band, unmistakable
  | 'step' // a step / state line (recharge, cycle settled, hour done)
  | 'pace' // a pace line (amber)
  | 'yield' // a yield / drop line (green amount)
  | 'mile' // a milestone line (amber, bold)
  | 'close'; // the closing entry — settles the account

export interface LedgerEntry {
  id: number;
  /** Timestamp label, e.g. "T+0:03" / "00:37" / "H1". */
  t: string;
  kind: LedgerKind;
  label: string;
  /** Right-aligned amount column, e.g. "−58". */
  amount?: string;
  /** Running balance after this line, e.g. "HP 204". */
  balance?: string;
  /** Label tint override (proc colors ride the shipped palette). */
  tint?: string;
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const rowStyle = (kind: LedgerKind): React.CSSProperties => {
  switch (kind) {
    case 'tele':
      return {
        background: '#F87171',
        color: '#16090A',
        fontWeight: 900,
        letterSpacing: '0.04em',
        margin: '5px -12px',
        padding: '5px 12px',
        borderTop: '2px solid #16090A',
        borderBottom: '2px solid #16090A',
      };
    case 'close':
      return {
        background: '#FFA01F',
        color: '#14100A',
        fontWeight: 900,
        margin: '5px -12px',
        padding: '5px 12px',
      };
    case 'total':
      return {
        borderTop: '2px solid #3A4152',
        boxShadow: '0 -5px 0 -4px #3A4152',
        marginTop: 5,
        paddingTop: 4,
        fontWeight: 900,
        color: '#FFFFFF',
      };
    case 'open':
      return { color: '#8A93A3', fontWeight: 800, letterSpacing: '0.05em' };
    case 'mile':
      return { color: '#F5B83D', fontWeight: 900, letterSpacing: '0.05em' };
    case 'pace':
      return { color: '#FFA01F', fontWeight: 800 };
    case 'crit':
      return { color: '#F5B83D', fontWeight: 900 };
    case 'hurt':
      return { color: '#C9A0A0' };
    default:
      return { color: '#D7DBE4' };
  }
};

const amountColor = (kind: LedgerKind): string => {
  switch (kind) {
    case 'crit':
    case 'total':
      return kind === 'crit' ? '#F5B83D' : '#FFFFFF';
    case 'hurt':
      return '#F87171';
    case 'yield':
      return '#4ADE80';
    case 'tele':
    case 'close':
      return 'inherit';
    default:
      return '#D7DBE4';
  }
};

export const TickerLedger: React.FC<{
  title: string;
  /** Pinned balance line at the foot of the tape. */
  footLeft: string;
  footRight: string;
  entries: LedgerEntry[];
  /** Visible tape height in px. */
  height?: number;
  testId?: string;
}> = ({ title, footLeft, footRight, entries, height = 318, testId = 'ticker-ledger' }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div
      data-testid={testId}
      style={{
        background: '#07080B',
        border: '2px solid #232833',
        borderTop: 'none',
        boxSizing: 'border-box',
        fontFamily: MONO,
      }}
    >
      <style>{`
        @keyframes ledger-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes tele-pulse { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.22); } }
        .ledger-row { animation: ledger-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        .ledger-tele { animation: ledger-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both, tele-pulse 700ms ease-in-out infinite; }
      `}</style>
      {/* Tape header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          padding: '8px 12px 6px',
          borderBottom: '2px solid #232833',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.14em', color: '#E8EAF0' }}>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A93A3' }}>TICKER</span>
      </div>
      {/* Column heads */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '5px 12px 3px',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: '#5C6472',
        }}
      >
        <span style={{ width: 52, flex: 'none' }}>TIME</span>
        <span style={{ flex: 1 }}>ENTRY</span>
        <span style={{ width: 64, flex: 'none', textAlign: 'right' }}>AMOUNT</span>
        <span style={{ width: 76, flex: 'none', textAlign: 'right' }}>BALANCE</span>
      </div>
      {/* The tape */}
      <div ref={scrollRef} style={{ height, overflow: 'hidden', padding: '2px 12px 6px' }}>
        {entries.map((e) => (
          <div
            key={e.id}
            className={e.kind === 'tele' ? 'ledger-tele' : 'ledger-row'}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
              fontSize: 12,
              lineHeight: '19px',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              ...rowStyle(e.kind),
            }}
          >
            <span style={{ width: 52, flex: 'none', color: e.kind === 'tele' || e.kind === 'close' ? 'inherit' : '#5C6472', fontWeight: 700 }}>
              {e.t}
            </span>
            <span style={{ flex: 'none', ...(e.tint ? { color: e.tint } : {}) }}>{e.label}</span>
            <span
              aria-hidden
              style={{ flex: 1, borderBottom: '1px dotted #2C3242', transform: 'translateY(-3px)', minWidth: 8 }}
            />
            <span style={{ width: 64, flex: 'none', textAlign: 'right', fontWeight: 800, color: amountColor(e.kind) }}>
              {e.amount ?? ''}
            </span>
            <span
              style={{
                width: 76,
                flex: 'none',
                textAlign: 'right',
                fontWeight: 700,
                color: e.kind === 'tele' || e.kind === 'close' ? 'inherit' : '#8A93A3',
              }}
            >
              {e.balance ?? ''}
            </span>
          </div>
        ))}
      </div>
      {/* Pinned balance line */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          padding: '7px 12px',
          borderTop: '2px solid #232833',
          background: '#0A0C11',
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: '0.06em',
          color: '#F5B83D',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        <span>{footLeft}</span>
        <span style={{ color: '#E8EAF0' }}>{footRight}</span>
      </div>
    </div>
  );
};

/** Tape state helper: an append-only entry list with stable ids. */
export function tapePush(set: React.Dispatch<React.SetStateAction<LedgerEntry[]>>, rows: Array<Omit<LedgerEntry, 'id'>>) {
  set((prev) => {
    const base = prev.length ? prev[prev.length - 1].id : 0;
    return [...prev, ...rows.map((r, i) => ({ ...r, id: base + i + 1 }))];
  });
}
