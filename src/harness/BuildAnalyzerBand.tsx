import React from 'react';

/**
 * Build Analyzer band (THROWAWAY rendering prototype, 2026-11-13 —
 * harness only, never shipped). A row of vertical stat bars seated
 * under the roam stage: one bar per stat/effect of the hunter's
 * build. On each tick the bars surge to the height of that stat's
 * share of the tick's claim, hold, then drain back to a quiet rest
 * level before the next tick. Purely presentational: the harness
 * page feeds it frames; it owns no game state.
 */

export type BarKey = 'dmg' | 'crit' | 'spd' | 'fire' | 'molten' | 'echo' | 'shield';
export type BandPhase = 'rest' | 'surge' | 'drain' | 'slam';
export type ShieldPhase = 'hold' | 'drain' | 'recharge';

export interface BandFrame {
  /** Fill height per bar, % of the 64px track (crit may exceed 100). */
  levels: Record<BarKey, number>;
  phase: BandPhase;
  shieldPhase: ShieldPhase;
  /** Contribution readout shown above a bar while it speaks. */
  values: Partial<Record<BarKey, string>>;
  critFlare: boolean;
  flashMolten: boolean;
  flashEcho: boolean;
}

export const BAND_REST: Record<BarKey, number> = {
  dmg: 6,
  crit: 25,
  spd: 10,
  fire: 6,
  molten: 5,
  echo: 5,
  shield: 64,
};

export const bandRestFrame = (): BandFrame => ({
  levels: { ...BAND_REST },
  phase: 'rest',
  shieldPhase: 'hold',
  values: {},
  critFlare: false,
  flashMolten: false,
  flashEcho: false,
});

interface BarSpec {
  key: BarKey;
  label: string;
  color: string;
  marker?: number; // crit threshold line, % of track height
}

const BARS: BarSpec[] = [
  { key: 'dmg', label: 'DMG', color: '#FFD23C' },
  { key: 'crit', label: 'CRIT', color: '#FF4D2E', marker: 75 },
  { key: 'spd', label: 'SPD', color: '#2DD4EE' },
  { key: 'fire', label: 'FIRE', color: '#FF7A1A' },
  { key: 'molten', label: 'MOLTEN', color: '#FFB300' },
  { key: 'echo', label: 'ECHO', color: '#B18CFF' },
  { key: 'shield', label: 'SHLD', color: '#6EC1FF' },
];

const TRACK_H = 64;
const STEP = 4; // fills snap to 4px steps — the light kit's texel language

const fillPx = (pct: number): number => {
  const raw = (Math.max(0, pct) / 100) * TRACK_H;
  return Math.round(raw / STEP) * STEP;
};

const transitionFor = (bar: BarKey, frame: BandFrame): string => {
  if (bar === 'shield') {
    if (frame.shieldPhase === 'drain') return 'height 300ms ease-in';
    if (frame.shieldPhase === 'recharge') return 'height 2600ms linear';
    return 'height 800ms ease-out';
  }
  switch (frame.phase) {
    case 'surge':
      return 'height 550ms cubic-bezier(.22,1,.36,1)';
    case 'slam':
      return 'height 240ms cubic-bezier(.22,1,.36,1)';
    case 'drain':
      return 'height 1700ms ease-out';
    default:
      return 'height 800ms ease-out';
  }
};

const BarColumn: React.FC<{ spec: BarSpec; frame: BandFrame }> = ({ spec, frame }) => {
  const level = frame.levels[spec.key];
  const px = fillPx(level);
  const speaking = frame.phase === 'surge' || frame.phase === 'slam';
  const flash = (spec.key === 'molten' && frame.flashMolten) || (spec.key === 'echo' && frame.flashEcho);
  const flare = spec.key === 'crit' && frame.critFlare;
  const active = speaking || level > BAND_REST[spec.key] + 3 || spec.key === 'shield';
  const value = frame.values[spec.key];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        style={{
          height: 14,
          fontSize: 11,
          fontWeight: 900,
          lineHeight: '14px',
          color: spec.color,
          fontVariantNumeric: 'tabular-nums',
          opacity: value ? (speaking ? 1 : 0.45) : 0,
          transition: 'opacity 300ms ease',
          whiteSpace: 'nowrap',
        }}
      >
        {value ?? '·'}
      </div>
      <div
        style={{
          position: 'relative',
          width: 30,
          height: TRACK_H,
          background: '#10131A',
          border: '2px solid #262B36',
          boxSizing: 'border-box',
          overflow: 'visible',
          boxShadow: flare ? '0 0 22px rgba(255,77,46,.55)' : flash ? `0 0 16px ${spec.color}66` : 'none',
          transition: 'box-shadow 200ms ease',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: px,
            background: spec.color,
            opacity: spec.key === 'crit' && frame.phase === 'rest' ? 0.45 : 1,
            filter: flash || flare ? 'brightness(1.7)' : 'none',
            transition: `${transitionFor(spec.key, frame)}, filter 150ms ease, opacity 300ms ease`,
          }}
        />
        {(speaking || flash) && px > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: Math.min(px, TRACK_H + 8) - 4,
              height: 4,
              background: 'rgba(255,255,255,.85)',
              transition: `bottom ${frame.phase === 'slam' ? 240 : 550}ms cubic-bezier(.22,1,.36,1)`,
            }}
      />
        )}
        {spec.marker != null && (
          <div
            style={{
              position: 'absolute',
              left: -4,
              right: -4,
              bottom: `${spec.marker}%`,
              height: 2,
              background: '#FFE9A8',
              opacity: 0.9,
              zIndex: 3,
            }}
          />
        )}
      </div>
      <div
        style={{
          marginTop: 5,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.08em',
          lineHeight: '13px',
          color: active ? spec.color : '#5B6472',
          transition: 'color 300ms ease',
          whiteSpace: 'nowrap',
        }}
      >
        {spec.label}
      </div>
    </div>
  );
};

export const BuildAnalyzerBand: React.FC<{ frame: BandFrame }> = ({ frame }) => (
  <div
    data-testid="build-analyzer-band"
    style={{
      background: '#07080B',
      border: '2px solid #232833',
      borderTop: 'none',
      padding: '12px 12px 8px',
      boxSizing: 'border-box',
    }}
  >
    <div style={{ display: 'flex', gap: 6 }}>
      {BARS.map((spec) => (
        <BarColumn key={spec.key} spec={spec} frame={frame} />
      ))}
    </div>
  </div>
);
