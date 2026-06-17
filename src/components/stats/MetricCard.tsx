import React, { memo, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { StatMetric, StatTone } from '@/lib/stats/characterStats';
import { CompositionBar, type CompositionSegment } from './CompositionBar';

const panelClip = { clipPath: 'polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)' };
const slashClip = { clipPath: 'polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%)' };

const toneText: Record<StatTone, string> = {
  amber: 'text-amber',
  green: 'text-green',
  red: 'text-red',
  cyan: 'text-cyan',
  purple: 'text-purple',
  muted: 'text-text-muted',
};

const toneRail: Record<StatTone, string> = {
  amber: 'bg-amber',
  green: 'bg-green',
  red: 'bg-red',
  cyan: 'bg-cyan',
  purple: 'bg-purple',
  muted: 'bg-text-muted',
};

// ── Bucket grouping (mirrors CharacterStatBar's BUCKET_ORDER) ──────────────

type Bucket = 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime';
const BUCKET_ORDER: readonly Bucket[] = ['base', 'gear', 'weapon', 'skill', 'activity', 'consumable', 'server', 'runtime'];

const BUCKET_BADGE: Record<Bucket, string> = {
  base: 'base', gear: 'gear', weapon: 'wpn', skill: 'skl',
  activity: 'act', consumable: 'cons', server: 'srv', runtime: 'run',
};

// ── Bar eligibility ────────────────────────────────────────────────────────

/**
 * Integer-count metrics that don't benefit from a proportional bar.
 * These show a stat chip instead.
 */
const INTEGER_METRICS = new Set(['parallelQueueSlots', 'bulkListingSlots']);

/**
 * Whether a metric should render a composition bar. The bar is shown when
 * the metric has either `stacked` segments or 2+ nonzero contributions.
 * Single-contribution metrics and integer counts skip the bar.
 */
function shouldShowBar(metric: StatMetric): boolean {
  if (INTEGER_METRICS.has(metric.key)) return false;
  if (metric.stacked && metric.stacked.length > 0) return true;
  const nonzero = metric.contributions.filter((c) => c.value !== 0);
  // Show bar for 0 contributions (empty state) or 2+ contributions.
  // A single contribution produces a 100% bar — not useful, so skip.
  return nonzero.length !== 1;
}

/**
 * Build composition segments from a metric. Prefers `stacked` (which is
 * pre-computed by the data layer for HP-type metrics), falls back to
 * `contributions` for additive stats.
 */
function buildSegments(metric: StatMetric): CompositionSegment[] {
  if (metric.stacked && metric.stacked.length > 0) {
    return metric.stacked.map((seg) => ({
      label: seg.label,
      detail: seg.display,
      value: seg.value,
      display: seg.display,
      tone: seg.tone,
      bucket: 'base',
    }));
  }
  return metric.contributions
    .filter((c) => c.value !== 0)
    .map((c) => ({
      label: c.source,
      detail: c.detail,
      value: c.value,
      display: c.display,
      tone: c.tone ?? metric.tone,
      bucket: c.bucket ?? 'gear',
      transient: c.bucket === 'consumable',
    }));
}

// ── Collapsible detail list ────────────────────────────────────────────────

const DetailList: React.FC<{ metric: StatMetric; max: number }> = memo(function DetailList({ metric, max }) {
  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    rows: metric.contributions.filter((c) => (c.bucket ?? 'gear') === bucket),
  })).filter((g) => g.rows.length > 0);

  if (grouped.length === 0) {
    return <div className="border border-border bg-surface/80 p-2 text-[10px] text-text-muted">No slotted source is currently contributing to this metric.</div>;
  }

  return (
    <div className="space-y-2">
      {grouped.map(({ bucket, rows }) => (
        <div key={bucket} data-testid={`metric-card-bucket-${bucket}`}>
          <div className="mb-0.5 text-[7px] font-black uppercase tracking-[0.16em] text-text-muted/50">{BUCKET_BADGE[bucket]}</div>
          <div className="space-y-1">
            {rows.map((source, i) => {
              const sourceTone = toneText[source.tone ?? metric.tone];
              const sourceRail = toneRail[source.tone ?? metric.tone];
              const width = Math.max(4, Math.min(100, Math.abs(source.value) / Math.max(1, max) * 100));
              const transient = bucket === 'consumable';
              return (
                <div
                  key={`${source.source}-${source.detail}-${i}`}
                  data-testid={`metric-card-source-row`}
                  className={`relative overflow-hidden border bg-surface/80 p-1.5 ${transient ? 'border-amber/60 animate-pulse' : 'border-border'}`}
                  style={slashClip}
                >
                  <div className={`absolute bottom-0 left-0 h-1 ${sourceRail}`} style={{ width: `${width}%` }} />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[10px] font-black text-text-primary">{source.source}</div>
                      <div className="truncate text-[8px] text-text-muted">{source.detail}</div>
                    </div>
                    <div className={`shrink-0 text-[11px] font-black ${sourceTone}`}>{source.display}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});

// ── MetricCard ────────────────────────────────────────────────────────────

/**
 * Per-metric card for the Source Breakdown modal. Replaces the old
 * `SourceRow` with a visual-first layout:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ Max HP  1,247  (combat HP: chassis + shield)  │  ← header
 *   │ [████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]  │  ← composition bar
 *   │  67% chassis  33% shield                     │  ← legend
 *   │ ▾ Sources (2)                                │  ← collapsible
 *   └─────────────────────────────────────────────┘
 *
 * The composition bar is the hero element: thick, colored, gapless.
 * The detail list is collapsed by default and expands on tap.
 */
export const MetricCard: React.FC<{
  metric: StatMetric;
  max?: number;
}> = memo(function MetricCard({ metric, max }) {
  const [expanded, setExpanded] = useState(false);
  const tone = toneText[metric.tone];
  const showBar = shouldShowBar(metric);
  const segments = useMemo(() => buildSegments(metric), [metric]);
  const sourceCount = metric.contributions.filter((c) => c.value !== 0).length;
  // Each card computes its own max from its own contributions when not
  // provided. This keeps grid cards self-contained.
  const effectiveMax = useMemo(
    () => max ?? Math.max(1, ...metric.contributions.map((c) => Math.abs(c.value))),
    [max, metric.contributions],
  );

  return (
    <div
      className="border-2 border-border bg-bg/80 p-2"
      style={panelClip}
      data-testid={`metric-card-${metric.key}`}
    >
      {/* Header */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-sm font-black uppercase tracking-wide ${tone}`}>
            {metric.label} <span className="ml-1">{metric.display}</span>
          </div>
          <div className="truncate text-[9px] text-text-muted">{metric.detail}</div>
        </div>
        {sourceCount > 0 && (
          <div className="shrink-0 text-[9px] font-black uppercase text-text-muted">
            {sourceCount} {sourceCount === 1 ? 'source' : 'sources'}
          </div>
        )}
      </div>

      {/* Composition bar */}
      {showBar && (
        <div className="mt-2">
          <CompositionBar segments={segments} />
        </div>
      )}

      {/* Collapsible detail list */}
      {sourceCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 flex w-full items-center justify-center gap-1 border border-dashed border-border bg-surface/60 py-1 text-[9px] font-black uppercase tracking-wider text-text-muted transition-colors hover:text-amber"
          style={slashClip}
          aria-expanded={expanded}
        >
          <ChevronDown size={10} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? 'Hide' : `Show ${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}`}
        </button>
      )}
      {expanded && sourceCount > 0 && (
        <div className="mt-2">
          <DetailList metric={metric} max={effectiveMax} />
        </div>
      )}
    </div>
  );
});

export default MetricCard;
