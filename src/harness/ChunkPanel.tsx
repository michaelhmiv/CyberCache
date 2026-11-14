import React from 'react';

/**
 * CHUNK & SEGMENT — shared display primitives (iter-05, harness only).
 *
 * The language: every bar is built from labeled segments. Damage
 * breaks off the enemy bar as chunks labeled by source (DMG / FIRE /
 * SPD / MOLTEN / ECHO) at the SAME px-per-point scale as the bar
 * itself, and piles up in a tray under the bar in tick order — after
 * three ticks the remaining segments vs the tray tell the whole
 * fight. Progress fills the same way: beat-blocks, hour-blocks,
 * draw-cells. A chunk that is promised but not yet resolved (a
 * telegraph threat, a shield recharge, a payout at settlement) is
 * drawn as an OUTLINE, never a solid — solid means settled.
 *
 * Colors are the program's shipped source coding (BuildAnalyzerBand
 * / GhostHpBar / craftbars chrome): DMG #FFD23C, CRIT #FF4D2E,
 * SPD #2DD4EE, FIRE #FF7A1A, MOLTEN #FFB300, ECHO #B18CFF,
 * SHLD #6EC1FF, enemy #F87171, loot green #4ADE80.
 * Panel chrome #07080B on 2px #232833 — the shipped harness grammar.
 */

export const SRC = {
  dmg: '#FFD23C',
  crit: '#FF4D2E',
  spd: '#2DD4EE',
  fire: '#FF7A1A',
  molten: '#FFB300',
  echo: '#B18CFF',
  shld: '#6EC1FF',
  enemy: '#F87171',
  loot: '#4ADE80',
  dim: '#5B6472',
  faint: '#8A93A3',
  empty: '#1A1E27',
};

export const panelStyle: React.CSSProperties = {
  background: '#07080B',
  border: '2px solid #232833',
  borderTop: 'none',
  padding: '10px 12px',
  boxSizing: 'border-box',
};

export const headStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.08em',
  color: SRC.faint,
  whiteSpace: 'nowrap',
};

export const numStyle: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

export interface ChunkDef {
  label: string;
  value: number;
  color: string;
  tag?: string;
}

/** The combat fixture's tick anatomy (INDEX, verbatim) — reused for
 *  roam (300 HP) and, per the INDEX boss row, for the boss take
 *  (Dune Tyrant, 800 HP def). Components sum to tick totals:
 *  96 / 104 / 156. Tick 3 DMG is the crit: 44 x2.0 = 88. */
export const TICKS: ChunkDef[][] = [
  [
    { label: 'DMG', value: 58, color: SRC.dmg },
    { label: 'FIRE', value: 22, color: SRC.fire },
    { label: 'SPD', value: 16, color: SRC.spd },
  ],
  [
    { label: 'DMG', value: 52, color: SRC.dmg },
    { label: 'FIRE', value: 18, color: SRC.fire },
    { label: 'SPD', value: 14, color: SRC.spd },
    { label: 'MOLTEN', value: 20, color: SRC.molten },
  ],
  [
    { label: 'DMG', value: 88, color: SRC.dmg, tag: 'CRIT ×2.0' },
    { label: 'FIRE', value: 24, color: SRC.fire },
    { label: 'SPD', value: 12, color: SRC.spd },
    { label: 'MOLTEN', value: 14, color: SRC.molten },
    { label: 'ECHO', value: 18, color: SRC.echo },
  ],
];
export const TICK_TOTALS = TICKS.map((t) => t.reduce((s, c) => s + c.value, 0));

/**
 * A remaining bar as discrete cells of `unit` points each. The
 * boundary cell carries the exact partial fill — a chipped cell is
 * still honest arithmetic. `ghostTo` (greater than remaining) draws
 * the promised-but-unresolved span as outline cells.
 */
export const SegCells: React.FC<{
  total: number;
  unit: number;
  remaining: number;
  color: string;
  height?: number;
  ghostTo?: number;
}> = ({ total, unit, remaining, color, height = 16, ghostTo }) => {
  const cells = Math.round(total / unit);
  return (
    <div style={{ display: 'flex', gap: 2, flex: 1 }}>
      {Array.from({ length: cells }, (_, i) => {
        const cellStart = i * unit;
        const fill = Math.max(0, Math.min(1, (remaining - cellStart) / unit));
        const ghost = ghostTo !== undefined && fill === 0 && cellStart < ghostTo;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height,
              background: SRC.empty,
              position: 'relative',
              overflow: 'hidden',
              boxShadow: ghost ? `inset 0 0 0 2px ${color}` : 'none',
              transition: 'box-shadow 300ms ease',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: `${fill * 100}%`,
                background: color,
                transition: 'width 450ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

/** One tick's broken-off chunks, laid on the bar's own scale:
 *  the block row is (tickTotal / maxHp) of the panel track wide and
 *  each chunk flexes by its value, so a chunk's width IS its share
 *  of the bar it came off. The label line above the blocks names
 *  every chunk in its source color — labels never cramp inside a
 *  narrow chunk, and the block row stays pure size language. */
export const TrayRow: React.FC<{
  tag: string;
  chunks: ChunkDef[];
  maxHp: number;
  trackW: number;
}> = ({ tag, chunks, maxHp, trackW }) => {
  const total = chunks.reduce((s, c) => s + c.value, 0);
  const rowW = Math.max(24, (total / maxHp) * trackW);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
        <span style={{ ...headStyle, width: 18, color: SRC.dim }}>{tag}</span>
        {chunks.map((c, i) => (
          <span key={i} style={{ fontSize: 11, fontWeight: 900, color: c.color, whiteSpace: 'nowrap', ...numStyle }}>
            {c.label} {c.value}
          </span>
        ))}
        {chunks.some((c) => c.tag) && (
          <span style={{ fontSize: 11, fontWeight: 900, color: SRC.crit }}>{chunks.find((c) => c.tag)?.tag}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 900, color: '#E8EAF0', ...numStyle }}>{total}</span>
      </div>
      <div style={{ display: 'flex', gap: 2, width: rowW, transition: 'width 450ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
        {chunks.map((c, i) => (
          <div
            key={i}
            style={{
              height: 14,
              flexGrow: c.value,
              flexBasis: 0,
              minWidth: 5,
              background: c.color,
              boxShadow: c.tag ? `inset 0 0 0 2px ${SRC.crit}` : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
};

/** A chunk chip: solid when settled, outline when pending. */
export const ChunkChip: React.FC<{ label: string; color: string; solid: boolean }> = ({ label, color, solid }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 20,
      padding: '0 8px',
      fontSize: 11,
      fontWeight: 900,
      letterSpacing: '0.04em',
      color: solid ? '#0B0D12' : color,
      background: solid ? color : 'transparent',
      boxShadow: solid ? 'none' : `inset 0 0 0 2px ${color}`,
      whiteSpace: 'nowrap',
      ...numStyle,
    }}
  >
    {label}
  </span>
);

/** Equal blocks that fill by fraction (craft job blocks, hour
 *  blocks): block i fills clamp(frac * n - i). */
export const BlockFill: React.FC<{
  blocks: number;
  frac: number;
  color: string;
  height?: number;
  blockLabels?: string[];
}> = ({ blocks, frac, color, height = 16, blockLabels }) => (
  <div style={{ display: 'flex', gap: 2, flex: 1 }}>
    {Array.from({ length: blocks }, (_, i) => {
      const fill = Math.max(0, Math.min(1, frac * blocks - i));
      return (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ height, background: SRC.empty, position: 'relative', overflow: 'hidden' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: `${fill * 100}%`,
                background: color,
                transition: 'width 450ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />
          </div>
          {blockLabels && (
            <span style={{ fontSize: 11, fontWeight: 800, color: fill > 0 ? color : SRC.dim, textAlign: 'center' }}>
              {blockLabels[i]}
            </span>
          )}
        </div>
      );
    })}
  </div>
);
