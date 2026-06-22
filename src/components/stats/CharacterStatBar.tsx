import React, { memo, useMemo, useState } from 'react';
import { ChevronDown, RefreshCw, X } from 'lucide-react';
import type { CharacterStatSummary, StatMetric } from '@/lib/stats/characterStats';
import { pickTopContributions } from '@/lib/stats/topContribs';
import { COMBAT_CORE_METRIC_KEYS } from '@/lib/hud/headlineMetrics';
import type { ActivityKind } from '@/types/activity';
import { CharacterStatBreakdownModal } from './CharacterStatBreakdownModal';
import { statToneBgClass, statToneRailClass, statToneTextClass } from './statToneStyles';

const panelClip = { clipPath: 'polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)' };
const slashClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const toneClass = (tone: StatMetric['tone']) => ({
  text: statToneTextClass[tone],
  rail: statToneRailClass[tone],
  bg: statToneBgClass[tone],
});

/**
 * Stacked horizontal bar — splits a single metric into N segments
 * side-by-side, with the segment widths proportional to their values
 * and the segment color from the source tone. Idle-game convention:
 * always one continuous bar (no gaps between segments), with a thin
 * outline. Used for the Health metric (chassis + shield + mitigation)
 * and reusable for any future metric that has a `stacked` breakdown.
 */
const StackedBar = memo(function StackedBar({ segments, total }: { segments: NonNullable<StatMetric['stacked']>; total: number }) {
  const safeTotal = Math.max(1, total);
  return (
    <div className="relative h-1 w-full overflow-hidden border border-border bg-surface" aria-hidden="true">
      <div className="absolute inset-0 flex">
        {segments.map((segment, index) => {
          const widthPct = Math.max(0, Math.min(100, (segment.value / safeTotal) * 100));
          const tone = toneClass(segment.tone);
          return (
            <div
              key={`${segment.label}-${index}`}
              className={`h-full ${tone.rail}`}
              style={{ width: `${widthPct}%` }}
              data-segment={segment.label}
              data-width={widthPct.toFixed(2)}
            />
          );
        })}
      </div>
    </div>
  );
});

const MiniMetric = memo(function MiniMetric({ metric, currentHp: _currentHp, maxHp: _maxHp, ...rest }: { metric: StatMetric; currentHp?: number; maxHp?: number } & React.HTMLAttributes<HTMLDivElement>) {
  const tone = toneClass(metric.tone);
  const { key } = metric;
  const display = metric.display;
  return (
    <div {...rest} className={`relative min-w-0 flex-1 overflow-hidden border border-border bg-bg/90 px-2 py-1.5 ${rest.className ?? ''}`} style={slashClip}>
      <div className={`absolute left-0 top-0 h-full w-1 ${tone.rail}`} />
      <div className="flex items-center gap-1.5 pl-0.5">
        {key === 'health' ? <span className={tone.text} style={{ fontSize: '12px' }}>♥</span> : key === 'dps' ? <span className={tone.text} style={{ fontSize: '12px' }}>◎</span> : key === 'boss' ? <span className={tone.text} style={{ fontSize: '12px' }}>◈</span> : key === 'rareFind' ? <span className={tone.text} style={{ fontSize: '12px' }}>✦</span> : <span className={tone.text} style={{ fontSize: '12px' }}>📡</span>}
        <div className="min-w-0 leading-none">
          <div className="truncate text-[8px] font-black uppercase tracking-wide text-text-muted">{metric.label}</div>
          <div className={`truncate text-[11px] font-black ${tone.text}`}>{display}</div>
        </div>
      </div>
      {metric.stacked && metric.stacked.length > 0 && <StackedBar segments={metric.stacked} total={metric.value} />}
    </div>
  );
});

/**
 * TopContribsStrip — a single dense row of the N largest source
 * contributions across all metrics. Sits under the HUNTER TOTALS
 * headline chips and shows, at a glance, "this is where your damage
 * is coming from". Renders the source name (truncated), a tone
 * color dot, and the display value.
 *
 * Empty state: when no contributions are slotted, shows a muted
 * "no sources" line so the row is never just empty space.
 *
 * The pure data layer lives in `src/lib/stats/topContribs.ts` (not
 * here) so React Fast Refresh isn't broken by a non-component export
 * in a components file.
 */
const TopContribsStrip = memo(function TopContribsStrip({ summary, n = 3 }: { summary: CharacterStatSummary; n?: number }) {
  const top = useMemo(() => pickTopContributions(summary, n), [summary, n]);
  if (top.length === 0) {
    return <div className="mt-1 px-1 text-[9px] text-text-muted" data-testid="top-contribs-empty">No percentage modifiers active</div>;
  }
  return (
    <div className="mt-1 flex gap-1 overflow-hidden" data-testid="top-contribs-strip">
      {top.map((c, index) => {
        const tone = toneClass(c.tone ?? 'muted');
        return (
          <div
            key={`${c.source}-${c.detail}-${index}`}
            className="flex min-w-0 flex-1 items-center gap-1 border border-border bg-bg/75 px-1.5 py-0.5"
            style={slashClip}
            data-contrib-source={c.source}
          >
            <div className={`h-1 w-1 shrink-0 ${tone.rail}`} />
            <span className="truncate text-[8px] font-black text-text-primary">{c.source}</span>
            <span className="shrink-0 text-[9px] font-black text-amber">{c.display}</span>
          </div>
        );
      })}
    </div>
  );
});

export const CharacterStatBarBody = memo(function CharacterStatBarBody({
  summary,
  currentHp,
  maxHp,
  activityKind,
  overrideActivity,
  onChangeOverride,
  onCycleActivity,
}: {
  summary: CharacterStatSummary;
  currentHp?: number;
  maxHp?: number;
  activityKind?: ActivityKind;
  overrideActivity?: ActivityKind | null;
  onChangeOverride?: (next: ActivityKind | null) => void;
  onCycleActivity?: () => void;
}) {
  const effectiveKind = overrideActivity ?? activityKind;
  const headline = COMBAT_CORE_METRIC_KEYS
    .map((k) => summary.all.find((m) => m.key === k))
    .filter((m): m is StatMetric => Boolean(m));
  const showOverride = Boolean(overrideActivity) && Boolean(onChangeOverride);
  // Cycle affordance is only available in "follow current activity" mode —
  // when the override indicator is up the X-button owns the title-row
  // affordance and cycling would be confusing (the player is already pinned).
  const showCycle = !showOverride && Boolean(onCycleActivity);
  return (
    <>
      <div className="mb-1 flex items-center justify-between px-1 text-[8px] font-black uppercase tracking-[0.18em] text-text-muted">
        {showCycle ? (
          <button
            type="button"
            data-testid="hud-cycle-activity"
            aria-label="Cycle activity override"
            onClick={(e) => { e.stopPropagation(); onCycleActivity!(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onCycleActivity!(); } }}
            className="flex cursor-pointer items-center gap-1 uppercase tracking-[0.18em] text-text-muted transition-colors hover:text-amber focus:outline-none focus-visible:text-amber"
          >
            Hunter Totals
            <RefreshCw size={10} className="text-text-muted" />
          </button>
        ) : (
          <span>Hunter Totals</span>
        )}
        {showOverride ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear activity override (currently viewing ${effectiveKind}) and follow current activity`}
            data-testid="hud-activity-override"
            onClick={(e) => { e.stopPropagation(); onChangeOverride(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onChangeOverride(null); } }}
            className="flex cursor-pointer items-center gap-1 text-amber"
          >
            <span>viewing: {effectiveKind}</span>
            <X size={10} />
          </span>
        ) : (
          <span className="flex items-center gap-1 text-amber">sources <ChevronDown size={10} /></span>
        )}
      </div>
      <div className="flex gap-1">{headline.map((metric) => <MiniMetric key={metric.key} metric={metric} currentHp={metric.key === 'health' ? currentHp : undefined} maxHp={metric.key === 'health' ? maxHp : undefined} data-testid={`hud-metric-${metric.key}`} />)}</div>
      <TopContribsStrip summary={summary} n={3} />
    </>
  );
});

export const CharacterStatBar = memo(function CharacterStatBar({
  summary,
  currentHp,
  maxHp,
  activityKind,
  overrideActivity,
  onChangeOverride,
}: {
  summary: CharacterStatSummary;
  currentHp?: number;
  maxHp?: number;
  activityKind?: ActivityKind;
  overrideActivity?: ActivityKind | null;
  onChangeOverride?: (next: ActivityKind | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="pointer-events-auto absolute bottom-[43px] left-2 right-2 z-20 will-change-transform border-2 border-border bg-surface/95 p-1 shadow-[4px_4px_0_rgba(0,0,0,0.72)] active:scale-[0.99]" style={panelClip} aria-label="Open hunter totals source breakdown" aria-expanded={open} aria-controls="hunter-totals-breakdown">
        <CharacterStatBarBody
          summary={summary}
          currentHp={currentHp}
          maxHp={maxHp}
          activityKind={activityKind}
          overrideActivity={overrideActivity}
          onChangeOverride={onChangeOverride}
        />
      </button>
      <CharacterStatBreakdownModal summary={summary} open={open} onClose={() => setOpen(false)} activityKind={activityKind} />
    </>
  );
});
