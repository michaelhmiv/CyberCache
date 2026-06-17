import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { CharacterStatSummary, StatTone } from '@/lib/stats/characterStats';
import { SourceRow } from './CharacterStatBar';

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const slashClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const tabToneClass: Record<StatTone, { text: string; border: string; bg: string }> = {
  amber:  { text: 'text-amber',  border: 'border-amber/60',  bg: 'bg-amber/15' },
  green:  { text: 'text-green',  border: 'border-green/60',  bg: 'bg-green/15' },
  red:    { text: 'text-red',    border: 'border-red/60',    bg: 'bg-red/15' },
  cyan:   { text: 'text-cyan',   border: 'border-cyan/60',   bg: 'bg-cyan/15' },
  purple: { text: 'text-purple', border: 'border-purple/60', bg: 'bg-purple/15' },
  muted:  { text: 'text-text-muted', border: 'border-border', bg: 'bg-surface' },
};

/**
 * The full source-breakdown modal: lists every StatMetric in the summary
 * with its contributions grouped by `bucket`. Extracted from
 * `CharacterStatBar` so the dashboard can mount it from a panel
 * `headerActions` button without dragging in the bar wrapper.
 *
 * Mounts at z-80 to match the existing bar variant. The `open` prop
 * drives AnimatePresence; when `false` the modal is unmounted entirely
 * (no DOM, no backdrop).
 */
export const CharacterStatBreakdownModal: React.FC<{
  summary: CharacterStatSummary;
  open: boolean;
  onClose: () => void;
}> = ({ summary, open, onClose }) => {
  const [activeMetric, setActiveMetric] = useState(0);
  const sourceMax = useMemo(
    () => Math.max(1, ...summary.all.flatMap((metric) => metric.contributions.map((entry) => Math.abs(entry.value)))),
    [summary],
  );
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="hunter-totals-breakdown-modal"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            id="hunter-totals-breakdown"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-3 shadow-[0_-12px_32px_rgba(0,0,0,0.7)]"
            style={panelClip}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="bl-title text-xl leading-none text-text-primary">Source Breakdown</div>
                <div className="mt-0.5 text-[9px] text-text-muted">
                  Tap a stat to see contributing gear, skills, and buffs.
                </div>
              </div>
              <button
                type="button"
                aria-label="Close source breakdown"
                onClick={onClose}
                className="bl-secondary shrink-0 p-2 text-text-muted"
              >
                <X size={15} />
              </button>
            </div>
            {/* Metric tab strip */}
            {summary.all.length > 1 && (
              <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
                {summary.all.map((metric, index) => {
                  const tone = tabToneClass[metric.tone];
                  const isActive = index === activeMetric;
                  return (
                    <button
                      key={metric.key}
                      type="button"
                      onClick={() => setActiveMetric(index)}
                      className={`shrink-0 border px-2 py-1 text-[9px] font-black uppercase tracking-wider transition-colors ${
                        isActive
                          ? `${tone.border} ${tone.bg} ${tone.text}`
                          : 'border-border bg-surface text-text-muted hover:text-text-primary'
                      }`}
                      style={slashClip}
                    >
                      {metric.label}
                      <span className="ml-1 opacity-60">{metric.contributions.length}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* Active metric's sources */}
            {summary.all.length > 0 && (
              <SourceRow
                metric={summary.all[activeMetric]}
                max={sourceMax}
                groupByBucket
                compact
              />
            )}
            {/* Empty state */}
            {summary.all.length === 0 && (
              <div className="border border-border bg-surface/80 p-3 text-[10px] text-text-muted">
                No stats available for the current loadout.
              </div>
            )}
            <div className="mt-2 text-[8px] font-black uppercase tracking-wider text-text-muted/60">
              Presentation HUD · server math is authoritative
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CharacterStatBreakdownModal;
