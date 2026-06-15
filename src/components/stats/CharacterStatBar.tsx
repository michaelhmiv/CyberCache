import React, { useMemo, useState, memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Crosshair, HeartPulse, Radar, Shield, Sparkles, X } from 'lucide-react';
import type { CharacterStatSummary, StatMetric, StatTone } from '@/lib/stats/characterStats';
import { pickTopContributions } from '@/lib/stats/topContribs';

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
 * Stacked horizontal bar — splits a single metric into N segments
 * side-by-side, with the segment widths proportional to their values
 * and the segment color from the source tone. Idle-game convention:
 * always one continuous bar (no gaps between segments), with a thin
 * outline. Used for the Health metric (chassis + shield + mitigation)
 * and reusable for any future metric that has a `stacked` breakdown.
 */
function StackedBar({ segments, total }: { segments: NonNullable<StatMetric['stacked']>; total: number }) {
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
}

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

const SourceRow = memo(function SourceRow({ metric, max }: { metric: StatMetric; max: number }) {
  const tone = toneClass[metric.tone];
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

export const CharacterStatBar = memo(function CharacterStatBar({ summary, currentHp, maxHp }: { summary: CharacterStatSummary; currentHp?: number; maxHp?: number }) {
  const [open, setOpen] = useState(false);
  const sourceMax = useMemo(() => Math.max(1, ...summary.all.flatMap((metric) => metric.contributions.map((entry) => Math.abs(entry.value)))), [summary]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="pointer-events-auto absolute bottom-[43px] left-2 right-2 z-20 border-2 border-border bg-surface/95 p-1 shadow-[4px_4px_0_rgba(0,0,0,0.72)] active:scale-[0.99]" style={panelClip}>
        <div className="mb-1 flex items-center justify-between px-1 text-[8px] font-black uppercase tracking-[0.18em] text-text-muted"><span>Hunter Totals</span><span className="flex items-center gap-1 text-amber">sources <ChevronDown size={10} /></span></div>
        <div className="flex gap-1">{summary.headline.map((metric) => <MiniMetric key={metric.key} metric={metric} currentHp={metric.key === 'health' ? currentHp : undefined} maxHp={metric.key === 'health' ? maxHp : undefined} data-testid={`hud-metric-${metric.key}`} />)}</div>
        <TopContribsStrip summary={summary} n={3} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 320 }} className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-4 shadow-[0_-12px_32px_rgba(0,0,0,0.7)]" style={panelClip} onClick={(event) => event.stopPropagation()}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">Character Math</div>
                  <div className="bl-title text-3xl leading-none text-text-primary">Source Breakdown</div>
                  <div className="mt-1 text-[10px] text-text-muted">Every total below is split by base hunter values, slotted weapons, shield, ordnance, relic/class mod affixes, and skill nodes.</div>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="bl-secondary shrink-0 p-2 text-text-muted"><X size={15} /></button>
              </div>
              <div className="mb-3 border-2 border-amber/40 bg-amber/10 p-2 text-[10px] font-bold text-amber" style={slashClip}>This is a presentation HUD for the current loadout. It makes hidden modifiers visible without replacing server-verified combat math.</div>
              <div className="space-y-2">{summary.all.map((metric) => <SourceRow key={metric.key} metric={metric} max={sourceMax} />)}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
