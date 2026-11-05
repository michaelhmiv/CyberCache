/**
 * Standings board — defensive floor for the channel-unit read.
 *
 * Screen tests elsewhere mock the leaderboard service with a bare
 * factory (the shape that pushed #408 into keeping a local unit
 * map — which then crashed on 8 of 10 channels, finding F4 in
 * PR #411). The console reads the canonical unit map defensively:
 * if the map is ever unavailable at runtime, selecting a channel
 * must still render — the board header prints without a unit word
 * and rows print bare values. Nothing throws, and nothing prints
 * "undefined". (Vitest itself throws on a wholly absent mock
 * export, so the floor is pinned with the export present but
 * undefined — the runtime shape the defensive read guards.)
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/leaderboardService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/leaderboardService')>()),
  LEADERBOARD_METRIC_UNITS: undefined,
}));

import { BoardConsole } from '@/components/leaderboard/StandingsConsole';
import type { LeaderboardEntry } from '@/lib/api/leaderboardService';

const leader: LeaderboardEntry = {
  rank: 1,
  player_id: 'p-leader',
  username: 'Leader',
  value: 100,
  previous_value: null,
  trend: 0,
};

describe('standings board — missing unit map never throws', () => {
  it('renders the XP channel header without a unit word', () => {
    render(
      <BoardConsole
        metric="xp"
        period="all_time"
        onMetricChange={vi.fn()}
        onPeriodChange={vi.fn()}
        entries={[leader]}
        loading={false}
        myPlayerId={null}
        myRank={null}
        myRanks={{}}
        looks={{}}
        totalPlayers={2}
      />,
    );
    expect(screen.getByText(/^OUTPUT ·/).textContent).toBe('OUTPUT · VS LEADER');
    const row = screen.getByTestId('standings-row-p-leader');
    expect(row.textContent).toContain('100');
    expect(row.textContent).not.toContain('undefined');
  });
});
