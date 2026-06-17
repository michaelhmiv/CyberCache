import React, { memo, useMemo, useState } from 'react';
import { ChevronDown, Crosshair, HeartPulse, Radar, RefreshCw, Shield, Sparkles, X } from 'lucide-react';
import type { CharacterStatSummary, StatMetric, StatTone } from '@/lib/stats/characterStats';
import { pickTopContributions } from '@/lib/stats/topContribs';
import { getHeadlineMetricKeys } from '@/lib/hud/headlineMetrics';
import type { ActivityKind } from '@/types/activity';
import { CharacterStatBreakdownModal } from './CharacterStatBreakdownModal';

const panelClip = { clipPath: 'polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)' };
const slashClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const toneClass: Record<StatTone, { text: string; rail: string; bg: string }> = {
  amber: { text: 'text-amber', rail: 'bg-amber', bg: 'bg-amber/10' },
  green: { text: 'text-green', rail: 'bg-green', bg: 'bg-green/10' },
  red: { text: 'text-red', rail: 'bg-red', bg: 'bg-red/10' },
  cyan: { text: 'text-cyan', rail: 'bg-cyan', bg: 'bg-cyan/10' },
  purple: { text: 'text-purple', rail: 'bg-purple', bg: 'bg-purple/10' },
  muted: { text: 'text-text-muted', rail: 'bg-text-muted', bg: 'bg-surface' },
};

/**
 * Canonical bucket order, mirrored from
 * `MechanicsContributionBucket` in the mechanics module. Declared
 * locally so this file does not import from the mechanics module
 * (that would create a circular type dependency through
 * `characterStats.ts`).
 */
type Bucket = 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime';
const BUCKET_ORDER: readonly Bucket[] = ['base', 'gear', 'weapon', 'skill', 'activity', 'consumable', 'server', 'runtime'];

/**
 * Human-readable label for each contribution bucket, used as a section
 * header when `SourceRow` is in `groupByBucket` mode. Keys mirror the
 * `BUCKET_ORDER` entries above.
 */
const _BUCKET_LABEL: Record<Bucket, string> = {
  base: 'Base chassis',
  gear: 'Gear (shield / ordnance / relic / class mod)',
  weapon: 'Weapons',
  skill: 'Skill tree',
  activity: 'Activity modules',
  consumable: 'Consumables (transient)',
  server: 'Server override',
  runtime: 'Runtime modifier',
};

/** Short badge labels for inline bucket chips on source rows. */
const BUCKET_BADGE: Record<Bucket, string> = {
  base: 'base',
  gear: 'gear',
  weapon: 'wpn',
  skill: 'skl',
  activity: 'act',
  consumable: 'cons',
  server: 'srv',
  runtime: 'run',
};

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
          const tone = toneClass[segment.tone];
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

const MiniMetric = memo(function MiniMetric({ metric, currentHp, maxHp, ...rest }: { metric: StatMetric; currentHp?: number; maxHp?: number } & React.HTMLAttributes<HTMLDivElement>) {
  const tone = toneClass[metric.tone];
  const { key } = metric;
  const display = (key === 'health' && currentHp != null && maxHp != null)
    ? `${Math.round(currentHp)}/${Math.round(maxHp)}`
    : metric.display;
  return (
    <div {...rest} className={`relative min-w-0 flex-1 overflow-hidden border border-border bg-bg/90 px-2 py-1.5 ${rest.className ?? ''}`} style={slashClip}>
      <div className={`absolute left-0 top-0 h-full w-1 ${tone.rail}`} />
      <div className="flex items-center gap-1.5 pl-0.5">
        {key === 'health' ? <HeartPulse size={12} className={tone.text} /> : key === 'dps' ? <Crosshair size={12} className={tone.text} /> : key === 'boss' ? <Shield size={12} className={tone.text} /> : key === 'rareFind' ? <Sparkles size={12} className={tone.text} /> : <Radar size={12} className={tone.text} />}
        <div className="min-w-0 leading-none">
          <div className="truncate text-[8px] font-black uppercase tracking-wide text-text-muted">{metric.label}</div>
          <div className={`truncate text-[11px] font-black ${tone.text}`}>{display}</div>
        </div>
      </div>
      {metric.stacked && metric.stacked.length > 0 && <StackedBar segments={metric.stacked} total={metric.value} />}
    </div>
  );
});

export const SourceRow = memo(function SourceRow({ metric, max, groupByBucket = false, compact = false }: { metric: StatMetric; max: number; groupByBucket?: boolean; compact?: boolean }) {
  const tone = toneClass[metric.tone];
  const [expanded, setExpanded] = useState(false);
  if (!groupByBucket) {
    return (
      <div className="border-2 border-border bg-bg/80 p-2" style={panelClip}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className={`text-sm font-black uppercase tracking-wide ${tone.text}`}>{metric.label} {metric.display}</div>
            <div className="text-[9px] text-text-muted">{metric.detail}</div>
          </div>
          <div className="text-[9px] font-black uppercase text-text-muted">{metric.contributions.length} sources</div>
        </div>
        <div className="mt-2 space-y-1.5">
          {metric.contributions.length === 0 && <div className="border border-border bg-surface/80 p-2 text-[10px] text-text-muted">No slotted source is currently contributing to this metric.</div>}
          {metric.contributions.map((source) => {
            const sourceTone = toneClass[source.tone ?? metric.tone];
            const width = Math.max(4, Math.min(100, Math.abs(source.value) / Math.max(1, max) * 100));
            return (
              <div key={`${metric.key}-${source.source}-${source.detail}`} className="relative overflow-hidden border border-border bg-surface/80 p-2" style={slashClip}>
                <div className={`absolute bottom-0 left-0 h-1 ${sourceTone.rail}`} style={{ width: `${width}%` }} />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-black text-text-primary">{source.source}</div>
                    <div className="text-[9px] text-text-muted">{source.detail}</div>
                  </div>
                  <div className={`shrink-0 text-xs font-black ${sourceTone.text}`}>{source.display}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  // Bucketed view: group contributions by `bucket` in the canonical
  // order. The "consumable" bucket is marked transient (amber border
  // + pulse animation) because its modifiers are time-limited and the
  // player should be able to see at a glance which rows will disappear
  // when the buff expires. Un-tagged contributions (no `bucket` field)
  // are bucketed as 'gear' so they don't disappear from the grouped
  // view — defense in depth while existing call sites migrate.
  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    rows: metric.contributions.filter((c) => (c.bucket ?? 'gear') === bucket),
  })).filter((g) => g.rows.length > 0);
  // Compact top-N: sort by absolute value, take top 3
  const topN = 3;
  const topContribs = [...metric.contributions]
    .filter((c) => c.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, topN);
  const restCount = metric.contributions.filter((c) => c.value !== 0).length - topContribs.length;
  const showExpand = compact && restCount > 0;
  const showBucketed = !compact || expanded || restCount === 0;
  return (
    <div className="border-2 border-border bg-bg/80 p-2" style={panelClip}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={`text-sm font-black uppercase tracking-wide ${tone.text}`}>{metric.label} {metric.display}</div>
          <div className="text-[9px] text-text-muted">{metric.detail}</div>
        </div>
        <div className="text-[9px] font-black uppercase text-text-muted">{metric.contributions.length} sources</div>
      </div>
      {compact && topContribs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {topContribs.map((source) => {
            const sourceTone = toneClass[source.tone ?? metric.tone];
            return (
              <div
                key={`${metric.key}-${source.source}-${source.detail}`}
                className={`flex items-center gap-1 border border-border bg-surface/80 px-1.5 py-0.5 text-[9px] ${source.bucket === 'consumable' ? 'border-amber/60' : ''}`}
                style={slashClip}
              >
                <div className={`h-1.5 w-1.5 shrink-0 ${sourceTone.rail}`} />
                <span className="truncate max-w-[120px] font-black text-text-primary">{source.source}</span>
                <span className={`shrink-0 font-black ${sourceTone.text}`}>{source.display}</span>
              </div>
            );
          })}
        </div>
      )}
      {showExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex w-full items-center justify-center gap-1 border border-dashed border-border bg-surface/60 py-1 text-[9px] font-black uppercase tracking-wider text-text-muted transition-colors hover:text-amber"
          style={slashClip}
        >
          {expanded ? '▴' : '▾'} Show {expanded ? 'less' : `all ${metric.contributions.length} sources`}
        </button>
      )}
      {showBucketed && (
        <div className="mt-2 space-y-2">
          {grouped.length === 0 && <div className="border border-border bg-surface/80 p-2 text-[10px] text-text-muted">No slotted source is currently contributing to this metric.</div>}
          {grouped.map(({ bucket, rows }) => (
            <div key={bucket} data-testid={`source-bucket-${bucket}`}>
              <div className="space-y-1">
                {rows.map((source) => {
                  const sourceTone = toneClass[source.tone ?? metric.tone];
                  const width = Math.max(4, Math.min(100, Math.abs(source.value) / Math.max(1, max) * 100));
                  const transient = bucket === 'consumable';
                  return (
                    <div
                      key={`${metric.key}-${source.source}-${source.detail}`}
                      data-testid={`source-row-${source.source}-${source.detail}`}
                      data-transient={transient ? 'true' : 'false'}
                      className={`relative overflow-hidden border bg-surface/80 p-2 ${transient ? 'border-amber/60 animate-pulse' : 'border-border'}`}
                      style={slashClip}
                    >
                      <div className={`absolute bottom-0 left-0 h-1 ${sourceTone.rail}`} style={{ width: `${width}%` }} />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-black text-text-primary">{source.source}</div>
                          <div className="text-[9px] text-text-muted">{source.detail}</div>
                        </div>
                        <div className={`shrink-0 text-xs font-black ${sourceTone.text}`}>{source.display}</div>
                      </div>
                      {BUCKET_BADGE[bucket] && (
                        <span className={`absolute right-1 top-0.5 text-[7px] font-black uppercase tracking-wider ${
                          transient ? 'text-amber/70' : 'text-text-muted/40'
                        }`}>
                          {BUCKET_BADGE[bucket]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
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
    return <div className="mt-1 px-1 text-[9px] text-text-muted" data-testid="top-contribs-empty">No slotted sources contributing</div>;
  }
  return (
    <div className="mt-1 flex gap-1 overflow-hidden" data-testid="top-contribs-strip">
      {top.map((c, index) => {
        const tone = toneClass[c.tone ?? 'muted'];
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
  const keys = getHeadlineMetricKeys(effectiveKind);
  const headline = keys
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
