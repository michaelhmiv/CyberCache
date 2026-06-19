import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { CharacterStatSummary, StatMetric } from '@/lib/stats/characterStats';
import { COMBAT_CORE_METRIC_KEYS, getBreakdownMetricKeys } from '@/lib/hud/headlineMetrics';
import { MetricCard } from './MetricCard';
import { PRODUCTIVE_ACTIVITY_LABELS, type ActivityKind } from '@/types/activity';

const COMBAT_CORE_KEYS = new Set(COMBAT_CORE_METRIC_KEYS);

/**
 * Filter the full metric list down to only those relevant to the player's
 * current activity. Uses `getBreakdownMetricKeys` for the key set, then
 * disambiguates duplicate keys (e.g. `droneAssistSpeed` exists in both
 * crafting and workshop modules) by matching `metric.sourceActivity`
 * against the current activity kind.
 */
function filterByActivity(summary: CharacterStatSummary, activityKind?: ActivityKind): StatMetric[] {
  const keys = getBreakdownMetricKeys(activityKind);
  const keySet = new Set(keys);

  return summary.all.filter((metric) => {
    if (!keySet.has(metric.key)) return false;
    if (metric.sourceActivity && activityKind && metric.sourceActivity !== activityKind) {
      return false;
    }
    return true;
  });
}

/**
 * Full-screen Source Breakdown overlay.
 *
 * Replaces the old bottom-sheet tabbed modal with a full-screen scrollable
 * grid of MetricCards. All activity-scoped metrics are visible at once —
 * no tabs, no clicking between stats. Cards are split into "Combat Core"
 * and activity-specific sections with labeled dividers.
 *
 * The header is sticky so the player always knows their activity context.
 */
export const CharacterStatBreakdownModal: React.FC<{
  summary: CharacterStatSummary;
  open: boolean;
  onClose: () => void;
  activityKind?: ActivityKind;
}> = ({ summary, open, onClose, activityKind }) => {
  const scopedMetrics = useMemo(
    () => filterByActivity(summary, activityKind),
    [summary, activityKind],
  );

  const sourceMax = useMemo(
    () => Math.max(1, ...summary.all.flatMap((metric) => metric.contributions.map((entry) => Math.abs(entry.value)))),
    [summary],
  );

  const activityLabel = activityKind && activityKind !== 'none'
    ? (PRODUCTIVE_ACTIVITY_LABELS[activityKind] ?? activityKind.replace(/_/g, ' '))
    : 'General';

  const activeSourceCount = useMemo(
    () => scopedMetrics.reduce((sum, m) => sum + m.contributions.filter((c) => c.value !== 0).length, 0),
    [scopedMetrics],
  );

  // Split metrics: combat core vs activity-specific
  const coreMetrics = scopedMetrics.filter((m) => COMBAT_CORE_KEYS.has(m.key));
  const activityMetrics = scopedMetrics.filter((m) => !COMBAT_CORE_KEYS.has(m.key));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="hunter-totals-breakdown-modal"
          className="fixed inset-0 z-[80] bg-bg"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            id="hunter-totals-breakdown"
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 380 }}
            className="flex h-full w-full flex-col bg-bg"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Sticky header */}
            <div
              className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b-2 border-border bg-bg/95 px-3 pb-2 pt-3 backdrop-blur-sm"
              data-testid="breakdown-header"
            >
              <div className="min-w-0">
                <div className="bl-title text-xl leading-none text-text-primary">Source Breakdown</div>
                <div className="mt-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-text-muted">
                  {activityLabel} · {scopedMetrics.length} stats · {activeSourceCount} sources
                </div>
              </div>
              <button
                type="button"
                aria-label="Close source breakdown"
                onClick={onClose}
                className="bl-secondary shrink-0 border-2 border-border bg-surface p-2 text-text-muted transition-colors hover:text-amber"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable metric grid */}
            <div className="flex-1 overflow-y-auto px-3 py-2 pb-8">
              {/* Combat Core section */}
              {coreMetrics.length > 0 && (
                <>
                  <div className="mb-1.5 mt-1 flex items-center gap-2">
                    <span className="h-px flex-1 bg-border-light" />
                    <span className="text-[8px] font-black uppercase tracking-[0.18em] text-text-muted/60">Combat Core</span>
                    <span className="h-px flex-1 bg-border-light" />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {coreMetrics.map((metric) => (
                      <MetricCard
                        key={`${metric.key}-${metric.sourceActivity ?? 'core'}`}
                        metric={metric}
                        max={sourceMax}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Activity-specific section */}
              {activityMetrics.length > 0 && (
                <>
                  <div className="mb-1.5 mt-3 flex items-center gap-2">
                    <span className="h-px flex-1 bg-border-light" />
                    <span className="text-[8px] font-black uppercase tracking-[0.18em] text-text-muted/60">
                      {activityLabel}
                    </span>
                    <span className="h-px flex-1 bg-border-light" />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {activityMetrics.map((metric) => (
                      <MetricCard
                        key={`${metric.key}-${metric.sourceActivity ?? 'activity'}`}
                        metric={metric}
                        max={sourceMax}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Empty state */}
              {scopedMetrics.length === 0 && (
                <div className="border border-border bg-surface/80 p-3 text-[10px] text-text-muted">
                  No stats available for the current loadout.
                </div>
              )}

              <div className="mt-3 text-center text-[8px] font-black uppercase tracking-wider text-text-muted/40">
                Presentation HUD · server math is authoritative
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CharacterStatBreakdownModal;
