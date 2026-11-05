import React from 'react';
import type { LeaderboardMetric } from '@/lib/api/leaderboardService';

const METRICS: { value: LeaderboardMetric; label: string; color: string }[] = [
  { value: 'level', label: 'Level', color: '#FF9000' },
  { value: 'xp', label: 'XP', color: '#FF9000' },
  { value: 'net_worth', label: 'Net Worth', color: '#7CFC00' },
  { value: 'total_kills', label: 'Kills', color: '#FF4B5C' },
  { value: 'kdr', label: 'K/D', color: '#FF4B5C' },
  { value: 'highest_boss_tier', label: 'Boss Tier', color: '#FF4B5C' },
  { value: 'total_mastery_xp', label: 'Mastery XP', color: '#7CFC00' },
  { value: 'highest_mastery_level', label: 'Mastery Lv', color: '#7CFC00' },
  { value: 'legendary_items', label: 'Legendaries', color: '#FFEA3A' },
  { value: 'total_items', label: 'Items', color: '#FFEA3A' },
];

const PERIODS: { value: 'all_time' | 'weekly' | 'daily'; label: string }[] = [
  { value: 'all_time', label: 'All Time' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
];

interface LeaderboardMetricPickerProps {
  metric: LeaderboardMetric;
  period: 'all_time' | 'weekly' | 'daily';
  onMetricChange: (metric: LeaderboardMetric) => void;
  onPeriodChange: (period: 'all_time' | 'weekly' | 'daily') => void;
}

export const LeaderboardMetricPicker: React.FC<LeaderboardMetricPickerProps> = ({
  metric,
  period,
  onMetricChange,
  onPeriodChange,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {METRICS.map((m) => (
          <button
            key={m.value}
            onClick={() => onMetricChange(m.value)}
            className={`shrink-0 rounded px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
              metric === m.value ? '' : 'text-text-muted hover:text-text-primary'
            }`}
            style={{
              backgroundColor: metric === m.value ? `${m.color}55` : 'rgba(0,0,0,0.3)',
              // The active board must read as SELECTED at a glance
              // (papercut): the metric's own color as text + a ring in
              // the same color, not just a faint tint behind white text.
              color: metric === m.value ? m.color : undefined,
              boxShadow: metric === m.value ? `inset 0 0 0 1.5px ${m.color}` : undefined,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => onPeriodChange(p.value)}
            className={`shrink-0 rounded px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
              period === p.value ? 'text-amber' : 'text-text-muted hover:text-text-primary'
            }`}
            style={{ backgroundColor: period === p.value ? 'rgba(255,144,0,0.2)' : 'rgba(0,0,0,0.3)' }}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default LeaderboardMetricPicker;
