import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Crosshair, HeartPulse, Radar, Shield, Sparkles, X } from 'lucide-react';
import type { CharacterStatSummary, StatMetric, StatTone } from '@/lib/stats/characterStats';

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

const iconFor = (key: string) => key === 'health' ? HeartPulse : key === 'dps' ? Crosshair : key === 'boss' ? Shield : key === 'rareFind' ? Sparkles : Radar;

function MiniMetric({ metric }: { metric: StatMetric }) {
  const tone = toneClass[metric.tone];
  const Icon = iconFor(metric.key);
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden border border-border bg-bg/90 px-2 py-1.5" style={slashClip}>
      <div className={`absolute left-0 top-0 h-full w-1 ${tone.rail}`} />
      <div className="flex items-center gap-1.5 pl-0.5">
        <Icon size={12} className={tone.text} />
        <div className="min-w-0 leading-none">
          <div className="truncate text-[8px] font-black uppercase tracking-wide text-text-muted">{metric.label}</div>
          <div className={`truncate text-[11px] font-black ${tone.text}`}>{metric.display}</div>
        </div>
      </div>
    </div>
  );
}

function SourceRow({ metric, max }: { metric: StatMetric; max: number }) {
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
}

export function CharacterStatBar({ summary }: { summary: CharacterStatSummary }) {
  const [open, setOpen] = useState(false);
  const sourceMax = useMemo(() => Math.max(1, ...summary.all.flatMap((metric) => metric.contributions.map((entry) => Math.abs(entry.value)))), [summary]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="pointer-events-auto absolute bottom-[43px] left-2 right-2 z-20 border-2 border-border bg-surface/95 p-1 shadow-[4px_4px_0_rgba(0,0,0,0.72)] active:scale-[0.99]" style={panelClip}>
        <div className="mb-1 flex items-center justify-between px-1 text-[8px] font-black uppercase tracking-[0.18em] text-text-muted"><span>Hunter Totals</span><span className="flex items-center gap-1 text-amber">sources <ChevronDown size={10} /></span></div>
        <div className="flex gap-1">{summary.headline.map((metric) => <MiniMetric key={metric.key} metric={metric} />)}</div>
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
}
