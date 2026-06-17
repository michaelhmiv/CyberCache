import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { CharacterStatSummary } from '@/lib/stats/characterStats';
import { SourceRow } from './CharacterStatBar';

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const slashClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

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
            className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-4 shadow-[0_-12px_32px_rgba(0,0,0,0.7)]"
            style={panelClip}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">Character Math</div>
                <div className="bl-title text-3xl leading-none text-text-primary">Source Breakdown</div>
                <div className="mt-1 text-[10px] text-text-muted">
                  Every total below is split by base hunter values, slotted weapons, shield, ordnance, relic/class mod affixes, and skill nodes.
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
            <div
              className="mb-3 border-2 border-amber/40 bg-amber/10 p-2 text-[10px] font-bold text-amber"
              style={slashClip}
            >
              This is a presentation HUD for the current loadout. It makes hidden modifiers visible without replacing server-verified combat math.
            </div>
            <div className="space-y-2">
              {summary.all.map((metric) => (
                <SourceRow key={metric.key} metric={metric} max={sourceMax} groupByBucket />
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CharacterStatBreakdownModal;
