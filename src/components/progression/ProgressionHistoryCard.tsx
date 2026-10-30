import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';
import { Sparkline } from '@/components/progression/Sparkline';
import { extractMetricSeries, getMyProgressionSnapshots, type PlayerProgressionSnapshot, type ProgressionMetric } from '@/lib/api/progressionService';

interface ProgressionHistoryCardProps {
  metric?: ProgressionMetric;
  label?: string;
  color?: string;
  limit?: number;
}

const METRIC_LABELS: Record<ProgressionMetric, string> = {
  level: 'Level',
  xp: 'XP',
  credits: 'Credits',
  scrap: 'Scrap',
  total_kills: 'Kills',
  total_deaths: 'Deaths',
  net_worth: 'Net Worth',
  total_items: 'Items',
  weapons_owned: 'Weapons',
  legendary_items: 'Legendaries',
  highest_item_level: 'Highest IL',
  total_mastery_xp: 'Mastery XP',
  highest_mastery_level: 'Mastery Lv',
  highest_boss_tier: 'Boss Tier',
};

export const ProgressionHistoryCard: React.FC<ProgressionHistoryCardProps> = ({
  metric = 'level',
  label,
  color = '#FF9000',
  limit = 30,
}) => {
  const [snapshots, setSnapshots] = useState<PlayerProgressionSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getMyProgressionSnapshots({ limit }).then((data) => {
      if (cancelled) return;
      setSnapshots(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [limit]);

  const series = useMemo(() => extractMetricSeries(snapshots, metric), [snapshots, metric]);
  const values = useMemo(() => series.map((s) => s.value), [series]);
  const current = values.length > 0 ? values[values.length - 1] : 0;
  const previous = values.length > 1 ? values[values.length - 2] : current;
  const delta = current - previous;

  return (
    <MobileCard className="space-y-2" rarityColor={color}>
      <div className="flex items-center gap-2">
        <TrendingUp size={16} style={{ color }} />
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">{label ?? METRIC_LABELS[metric]} History</div>
        <div className="ml-auto text-[10px] text-text-muted">{snapshots.length} snapshots</div>
      </div>

      {loading ? (
        <div className="h-8 animate-pulse rounded bg-bg" />
      ) : snapshots.length < 2 ? (
        <div className="text-[10px] text-text-muted">Not enough history yet. Snapshots are recorded as you play.</div>
      ) : (
        <div className="flex items-center gap-3">
          <Sparkline values={values} width={120} height={32} color={color} />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-black text-text-primary">{current.toLocaleString()}</div>
            {delta !== 0 && (
              <div className={`text-[10px] font-bold ${delta > 0 ? 'text-green' : 'text-red'}`}>
                {delta > 0 ? '+' : ''}{delta.toLocaleString()} since last snapshot
              </div>
            )}
          </div>
        </div>
      )}
    </MobileCard>
  );
};

export default ProgressionHistoryCard;
