import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, TrendingUp, TrendingDown, Minus, Trophy } from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';
import { Sparkline } from '@/components/progression/Sparkline';
import { getMyProgressionSnapshots, type ProgressionMetric } from '@/lib/supabase/progressionService';
import { getMyLeaderboardRank, type LeaderboardMetric } from '@/lib/supabase/leaderboardService';

const panelClip = { clipPath: 'polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)' };

interface StatDetailPanelProps {
  open: boolean;
  onClose: () => void;
  metric: ProgressionMetric;
  leaderboardMetric?: LeaderboardMetric;
  label: string;
  value: number;
  color?: string;
  onViewLeaderboard?: (metric: LeaderboardMetric) => void;
}

export const StatDetailPanel: React.FC<StatDetailPanelProps> = ({
  open,
  onClose,
  metric,
  leaderboardMetric,
  label,
  value,
  color = '#FF9000',
  onViewLeaderboard,
}) => {
  const [snapshots, setSnapshots] = useState<Array<{ snapshot_at: string; [key: string]: unknown }>>([]);
  const [rank, setRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getMyProgressionSnapshots({ limit: 30 }),
      leaderboardMetric ? getMyLeaderboardRank(leaderboardMetric) : Promise.resolve(null),
    ]).then(([snapData, rankData]) => {
      if (cancelled) return;
      setSnapshots(snapData);
      setRank(rankData?.rank ?? null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, metric, leaderboardMetric]);

  const values = useMemo(() => {
    return snapshots.map((s) => {
      const v = s[metric];
      return typeof v === 'number' ? v : 0;
    });
  }, [snapshots, metric]);

  const start = values.length > 0 ? values[0] : value;
  const current = values.length > 0 ? values[values.length - 1] : value;
  const best = values.length > 0 ? Math.max(...values) : value;
  const delta = current - start;
  const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/85"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="max-h-[92vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-3 shadow-[0_-12px_32px_rgba(0,0,0,0.75)]"
            style={panelClip}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex justify-center"><div className="h-1.5 w-12 rounded-full bg-border" /></div>

            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">Stat Detail</div>
                <div className="bl-title text-2xl leading-none text-text-primary">{label}</div>
              </div>
              <button type="button" onClick={onClose} className="bl-secondary shrink-0 p-2 text-text-muted"><X size={15} /></button>
            </div>

            <MobileCard className="space-y-3" rarityColor={color}>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Current</div>
                  <div className="text-3xl font-black text-text-primary">{current.toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-1 text-sm font-black" style={{ color: trend === 'up' ? '#7CFC00' : trend === 'down' ? '#FF4B5C' : '#9CA3AF' }}>
                  <TrendIcon size={16} />
                  {delta !== 0 && <span>{delta > 0 ? '+' : ''}{delta.toLocaleString()}</span>}
                  {delta === 0 && <span>Flat</span>}
                </div>
              </div>

              {loading ? (
                <div className="h-16 animate-pulse rounded bg-bg" />
              ) : values.length < 2 ? (
                <div className="text-[10px] text-text-muted">Not enough snapshot history for a sparkline yet.</div>
              ) : (
                <Sparkline values={values} width={360} height={64} color={color} />
              )}

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="border border-border bg-bg p-2">
                  <div className="text-[9px] uppercase text-text-muted">Start</div>
                  <div className="text-sm font-black text-text-primary">{start.toLocaleString()}</div>
                </div>
                <div className="border border-border bg-bg p-2">
                  <div className="text-[9px] uppercase text-text-muted">Best</div>
                  <div className="text-sm font-black text-text-primary">{best.toLocaleString()}</div>
                </div>
                <div className="border border-border bg-bg p-2">
                  <div className="text-[9px] uppercase text-text-muted">Snapshots</div>
                  <div className="text-sm font-black text-text-primary">{values.length}</div>
                </div>
              </div>
            </MobileCard>

            {leaderboardMetric && (
              <MobileCard className="space-y-2" rarityColor="#FFD700">
                <div className="flex items-center gap-2">
                  <Trophy size={16} className="text-amber" />
                  <div className="text-xs font-black uppercase tracking-wide text-text-primary">Global Rank</div>
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-3xl font-black text-amber">{rank != null ? `#${rank}` : 'Unranked'}</div>
                  {rank != null && rank > 0 && (
                    <button
                      onClick={() => onViewLeaderboard?.(leaderboardMetric)}
                      className="bl-secondary px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-text-primary"
                    >
                      View Leaderboard
                    </button>
                  )}
                </div>
              </MobileCard>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default StatDetailPanel;
