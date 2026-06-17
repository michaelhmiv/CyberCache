import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { CharacterStatSummary, StatMetric, StatTone } from '@/lib/stats/characterStats';
import { getBreakdownMetricKeys } from '@/lib/hud/headlineMetrics';
import { MetricCard } from './MetricCard';
import type { ActivityKind } from '@/types/activity';

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
 * Filter the full metric list down to only those relevant to the player's
 * current activity. Uses `getBreakdownMetricKeys` for the key set, then
 * disambiguates duplicate keys (e.g. `droneAssistSpeed` exists in both
 * crafting and workshop modules) by matching `metric.sourceActivity`
 * against the current activity kind.
 *
 * Core combat metrics (health, effectiveHp, dps, shieldBreak) have no
 * `sourceActivity` and are always included via the key set.
 */
function filterByActivity(summary: CharacterStatSummary, activityKind?: ActivityKind): StatMetric[] {
  const keys = getBreakdownMetricKeys(activityKind);
  const keySet = new Set(keys);

  return summary.all.filter((metric) => {
    if (!keySet.has(metric.key)) return false;
    // If the key is in the set, check whether the metric's sourceActivity
    // matches the current activity. Core metrics have no sourceActivity
    // and always pass. Activity-module metrics must match.
    if (metric.sourceActivity && activityKind && metric.sourceActivity !== activityKind) {
      // Allow through only if the key set explicitly includes this key
      // for this activity — prevents workshop's droneAssistSpeed from
      // showing when the player is crafting.
      return false;
    }
    return true;
  });
}

/**
 * The full source-breakdown modal: lists every relevant StatMetric for the
 * player's current activity, each rendered as a MetricCard with a
 * composition bar and collapsible detail list.
 *
 * Activity-scoped: pass `activityKind` to filter the metric list down to
 * only the stats that matter for what the player is currently doing. This
 * replaces the old 44-tab flat list with 8–14 tabs per activity.
 *
 * Mounts at z-80. The `open` prop drives AnimatePresence.
 */
export const CharacterStatBreakdownModal: React.FC<{
  summary: CharacterStatSummary;
  open: boolean;
  onClose: () => void;
  activityKind?: ActivityKind;
}> = ({ summary, open, onClose, activityKind }) => {
  const [activeMetric, setActiveMetric] = useState(0);

  const scopedMetrics = useMemo(
    () => filterByActivity(summary, activityKind),
    [summary, activityKind],
  );

  // Clamp activeMetric when the scoped set changes (e.g. activity switch)
  const safeActiveIndex = Math.min(activeMetric, Math.max(0, scopedMetrics.length - 1));

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
                  {activityKind && activityKind !== 'none'
                    ? `Stats for ${activityKind.replace(/_/g, ' ')} · tap a stat to see sources`
                    : 'Tap a stat to see contributing gear, skills, and buffs.'}
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

            {/* Metric tab strip (activity-scoped) */}
            {scopedMetrics.length > 1 && (
              <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
                {scopedMetrics.map((metric, index) => {
                  const tone = tabToneClass[metric.tone];
                  const isActive = index === safeActiveIndex;
                  return (
                    <button
                      key={`${metric.key}-${metric.sourceActivity ?? 'core'}`}
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
                      {metric.contributions.filter((c) => c.value !== 0).length > 0 && (
                        <span className="ml-1 opacity-60">{metric.contributions.filter((c) => c.value !== 0).length}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Active metric's MetricCard */}
            {scopedMetrics.length > 0 && (
              <MetricCard
                metric={scopedMetrics[safeActiveIndex]}
                max={sourceMax}
              />
            )}

            {/* Empty state */}
            {scopedMetrics.length === 0 && (
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
