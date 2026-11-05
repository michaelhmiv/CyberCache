import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  LEADERBOARD_METRIC_UNITS,
  formatLeaderboardValue,
  type LeaderboardEntry,
  type LeaderboardMetric,
} from '@/lib/api/leaderboardService';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { resolveLookView } from '@/lib/pixel/lookResolution';
import type { HunterLookView } from '@/content/skins';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  /** Which board this row belongs to — labels and formats the value. */
  metric: LeaderboardMetric;
  isMe?: boolean;
  onClick?: (playerId: string) => void;
  compact?: boolean;
  /** The hunter's worn look (0053) — rendered as a mini portrait. */
  look?: HunterLookView | null;
}

export const LeaderboardRow: React.FC<LeaderboardRowProps> = ({ entry, metric, isMe, onClick, compact, look }) => {
  const trend = entry.trend > 0 ? 'up' : entry.trend < 0 ? 'down' : 'flat';
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  return (
    <button
      onClick={() => onClick?.(entry.player_id)}
      className={`flex w-full items-center gap-2 p-2 text-left transition-colors ${isMe ? 'bg-amber/15' : 'hover:bg-surface/50'} ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className={`w-8 text-center text-sm font-black ${entry.rank <= 3 ? 'text-amber' : 'text-text-muted'}`}>
        {entry.rank}
      </div>
      {look && (
        <div className="w-8 shrink-0" data-testid={`standings-portrait-${entry.player_id}`}>
          <HunterPortrait look={resolveLookView(look)} className="h-10" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-xs font-bold ${isMe ? 'text-amber' : 'text-text-primary'}`}>
          {/* No username yet: the game's generic hunter name ("Vault
              Runner", the same fallback sellerDisplay uses) — never a
              slice of the raw player id (QC 2026-11-02, A3:
              "Player 000000"). */}
          {entry.username ?? 'Vault Runner'}
        </div>
        {!compact && (
          <div className="text-[9px] text-text-muted">
            {entry.previous_value != null ? `${Math.round(entry.trend * 100)}% vs prior` : 'No prior data'}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <TrendIcon size={10} className={trend === 'up' ? 'text-green' : trend === 'down' ? 'text-red' : 'text-text-muted'} />
        <div className="text-sm font-black text-text-primary">
          {formatLeaderboardValue(metric, entry.value)}{' '}
          <span className="text-[10px] font-bold uppercase text-text-muted">
            {LEADERBOARD_METRIC_UNITS[metric]}
          </span>
        </div>
      </div>
    </button>
  );
};

export default LeaderboardRow;
