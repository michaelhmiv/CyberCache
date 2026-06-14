import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { LeaderboardEntry } from '@/lib/supabase/leaderboardService';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  isMe?: boolean;
  onClick?: (playerId: string) => void;
  compact?: boolean;
}

export const LeaderboardRow: React.FC<LeaderboardRowProps> = ({ entry, isMe, onClick, compact }) => {
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
      <div className="min-w-0 flex-1">
        <div className={`truncate text-xs font-bold ${isMe ? 'text-amber' : 'text-text-primary'}`}>
          {entry.username ?? `Player ${entry.player_id.slice(0, 6)}`}
        </div>
        {!compact && (
          <div className="text-[9px] text-text-muted">
            {entry.previous_value != null ? `${Math.round(entry.trend * 100)}% vs prior` : 'No prior data'}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <TrendIcon size={10} className={trend === 'up' ? 'text-green' : trend === 'down' ? 'text-red' : 'text-text-muted'} />
        <div className="text-sm font-black text-text-primary">{Math.round(entry.value).toLocaleString()}</div>
      </div>
    </button>
  );
};

export default LeaderboardRow;
