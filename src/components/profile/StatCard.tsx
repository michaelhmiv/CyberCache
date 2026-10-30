import React, { useMemo } from 'react';
import { Lock } from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';
import { Sparkline } from '@/components/progression/Sparkline';
import { ProgressionMetric } from '@/lib/api/progressionService';

interface StatCardProps {
  label: string;
  value: number | string;
  metric?: ProgressionMetric;
  color?: string;
  rank?: number | null;
  isPrivate?: boolean;
  sparklineValues?: number[];
  onClick?: () => void;
  suffix?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  color = '#FF9000',
  rank,
  isPrivate,
  sparklineValues,
  onClick,
  suffix,
}) => {
  const formatted = typeof value === 'number' ? value.toLocaleString() : value;
  const clickable = !isPrivate && !!onClick;

  const displaySparkline = useMemo(() => {
    if (!sparklineValues || sparklineValues.length < 2) return null;
    return <Sparkline values={sparklineValues} width={64} height={24} color={color} />;
  }, [sparklineValues, color]);

  return (
    <MobileCard
      className={`space-y-1 ${clickable ? 'cursor-pointer transition-transform active:scale-[0.98]' : ''}`}
      rarityColor={color}
      onClick={clickable ? onClick : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">{label}</div>
        {isPrivate && <Lock size={10} className="text-text-muted" />}
        {!isPrivate && rank != null && rank > 0 && (
          <div className="rounded px-1 text-[9px] font-bold text-text-primary" style={{ backgroundColor: `${color}30` }}>
            #{rank}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-lg font-black text-text-primary truncate">
            {formatted}
            {suffix && <span className="ml-0.5 text-xs text-text-muted">{suffix}</span>}
          </div>
        </div>
        {displaySparkline}
      </div>
    </MobileCard>
  );
};

export default StatCard;
