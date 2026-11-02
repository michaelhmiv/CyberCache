import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';

import { LeaderboardRow } from './LeaderboardRow';
import { MobileCard } from '@/components/layout/MobileCard';
import type { LeaderboardEntry } from '@/lib/api/leaderboardService';

interface LeaderboardListProps {
  entries: LeaderboardEntry[];
  myPlayerId?: string | null;
  loading?: boolean;
  onRowClick?: (playerId: string) => void;
}

export const LeaderboardList: React.FC<LeaderboardListProps> = ({
  entries,
  myPlayerId,
  loading,
  onRowClick,
}) => {
  if (loading) {
    return (
      <MobileCard className="space-y-2" rarityColor="#FF9000">
        <div className="h-4 w-1/3 animate-pulse rounded bg-bg" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <div className="h-6 w-6 animate-pulse rounded bg-bg" />
            <div className="h-4 flex-1 animate-pulse rounded bg-bg" />
            <div className="h-4 w-16 animate-pulse rounded bg-bg" />
          </div>
        ))}
      </MobileCard>
    );
  }

  if (entries.length === 0) {
    return (
      <MobileCard className="space-y-2 py-6 text-center" rarityColor="#9CA3AF">
        <PxIcon name="crown" size={26} className="mx-auto text-text-muted" />
        <div className="text-sm font-bold text-text-muted">No leaderboard data yet.</div>
        <div className="text-[10px] text-text-muted">Check back after the next daily snapshot.</div>
      </MobileCard>
    );
  }

  const topEntries = entries.slice(0, 100);
  const myEntry = myPlayerId ? entries.find((e) => e.player_id === myPlayerId) : undefined;
  const myInTop = myEntry && topEntries.some((e) => e.player_id === myPlayerId);

  return (
    <MobileCard className="space-y-1 overflow-hidden p-0" rarityColor="#FF9000">
      <div className="border-b border-border bg-surface/50 p-2">
        <div className="flex items-center gap-2">
          <PxIcon name="crown" size={13} className="text-amber" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Global Rankings</div>
          <div className="ml-auto text-[10px] text-text-muted">{entries.length} players</div>
        </div>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {topEntries.map((entry) => (
          <LeaderboardRow
            key={entry.player_id}
            entry={entry}
            isMe={entry.player_id === myPlayerId}
            onClick={onRowClick}
          />
        ))}
        {!myInTop && myEntry && (
          <div className="border-t-2 border-amber/50 bg-amber/10">
            <LeaderboardRow entry={myEntry} isMe compact />
          </div>
        )}
      </div>
    </MobileCard>
  );
};

export default LeaderboardList;
