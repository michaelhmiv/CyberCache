import React, { useState } from 'react';
import type { StatTone } from '@/lib/stats/characterStats';
import { statToneRailClass, statToneTextClass } from './statToneStyles';

const slashClip = { clipPath: 'polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%)' };

export interface CompositionSegment {
  label: string;
  detail: string;
  value: number;
  display: string;
  tone: StatTone;
  bucket: string;
  transient?: boolean;
}

/**
 * Composition bar — a thick, gapless horizontal bar split into colored
 * segments proportional to each source's absolute contribution. Designed
 * to be the hero visual in the Source Breakdown modal: the player sees
 * at a glance which source type is driving the metric.
 *
 * Below the bar sits a compact legend (dot + source name + value). Tapping
 * a legend row or a bar segment highlights the corresponding segment.
 *
 * Zero/empty state: a single muted placeholder bar with "No active sources".
 */
export const CompositionBar: React.FC<{
  segments: CompositionSegment[];
}> = ({ segments }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const nonzero = segments.filter((s) => s.value !== 0);
  const sumAbs = nonzero.reduce((acc, s) => acc + Math.abs(s.value), 0);

  if (nonzero.length === 0 || sumAbs === 0) {
    return (
      <div
        className="flex h-3 items-center justify-center border border-border bg-surface/60"
        style={slashClip}
        data-testid="composition-bar-empty"
      >
        <span className="text-[8px] font-black uppercase tracking-wider text-text-muted/60">
          No active sources
        </span>
      </div>
    );
  }

  return (
    <div data-testid="composition-bar">
      {/* Bar */}
      <div
        className="relative flex h-3 w-full overflow-hidden border border-border bg-surface/40"
        style={slashClip}
      >
        {nonzero.map((seg, i) => {
          const pct = (Math.abs(seg.value) / sumAbs) * 100;
          const isActive = activeIndex === i;
          return (
            <div
              key={`${seg.label}-${i}`}
              className={`h-full ${statToneRailClass[seg.tone]} ${seg.transient ? 'animate-pulse' : ''} transition-all ${isActive ? 'brightness-125' : 'brightness-100'}`}
              style={{ width: `${pct}%` }}
              data-testid={`composition-segment-${i}`}
              data-segment-label={seg.label}
              data-segment-pct={pct.toFixed(1)}
              onClick={() => setActiveIndex(isActive ? null : i)}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        {nonzero.map((seg, i) => {
          const pct = (Math.abs(seg.value) / sumAbs) * 100;
          const isActive = activeIndex === i;
          return (
            <button
              type="button"
              key={`legend-${seg.label}-${i}`}
              onClick={() => setActiveIndex(isActive ? null : i)}
              className={`flex items-center gap-1 transition-opacity ${isActive ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 ${statToneRailClass[seg.tone]} ${seg.transient ? 'animate-pulse' : ''}`} />
              <span className="truncate max-w-[80px] text-[8px] font-black text-text-primary">{seg.label}</span>
              <span className={`shrink-0 text-[8px] font-black ${statToneTextClass[seg.tone]}`}>
                {pct < 1 ? '<1' : Math.round(pct)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CompositionBar;
