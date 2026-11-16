/**
 * All Time board collapse — owner ruling 2026-11-15: the global
 * All Time board ran to the fetch limit (100 rows) and buried the
 * weekly races below it under a long scroll. It now opens on the
 * top 10 with an in-place expand control revealing the full list.
 *
 * Pins:
 *  - Collapsed All Time renders exactly 10 rows; the control names
 *    the full count; expanding renders every row; collapsing again
 *    returns to 10.
 *  - The control exists only when there is more to show (10 or
 *    fewer rows: no control) and only on All Time (WEEK keeps its
 *    full list).
 *  - A viewer ranked below the cut still gets the pinned MY
 *    READING foot while collapsed, and loses it once expanded
 *    (their row is on the page).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { BoardConsole } from '@/components/leaderboard/StandingsConsole';
import type {
  LeaderboardEntry,
  LeaderboardPeriod,
  MyLeaderboardRank,
} from '@/lib/api/leaderboardService';

const entry = (n: number): LeaderboardEntry => ({
  rank: n,
  player_id: `p-${n}`,
  username: `Hunter ${n}`,
  value: 1000 - n * 10,
  previous_value: null,
  trend: 0,
});

const entries = (count: number): LeaderboardEntry[] =>
  Array.from({ length: count }, (_, i) => entry(i + 1));

const board = (
  period: LeaderboardPeriod,
  rows: LeaderboardEntry[],
  over: Partial<React.ComponentProps<typeof BoardConsole>> = {},
) => (
  <BoardConsole
    metric={over.metric ?? 'level'}
    period={period}
    onMetricChange={vi.fn()}
    onPeriodChange={vi.fn()}
    entries={rows}
    loading={false}
    myPlayerId={null}
    myRank={null}
    myRanks={{}}
    looks={{}}
    totalPlayers={rows.length}
    {...over}
  />
);

const rowCount = () => screen.getAllByTestId(/^standings-row-p-/).length;

describe('standings board — All Time top-10 collapse (owner ruling 2026-11-15)', () => {
  it('collapsed All Time renders exactly 10 rows and the control names the full count', () => {
    render(board('all_time', entries(15)));
    expect(rowCount()).toBe(10);
    const control = screen.getByTestId('standings-board-expand');
    expect(control.textContent).toContain('SHOW ALL 15 HUNTERS');
    expect(control.getAttribute('aria-expanded')).toBe('false');
  });

  it('expanding renders the full filtered list in place; collapsing returns to 10', () => {
    render(board('all_time', entries(15)));
    fireEvent.click(screen.getByTestId('standings-board-expand'));
    expect(rowCount()).toBe(15);
    const control = screen.getByTestId('standings-board-expand');
    expect(control.textContent).toContain('SHOW TOP 10');
    expect(control.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(control);
    expect(rowCount()).toBe(10);
  });

  it('no control when the board fits in 10 rows', () => {
    render(board('all_time', entries(10)));
    expect(rowCount()).toBe(10);
    expect(screen.queryByTestId('standings-board-expand')).toBeNull();
  });

  it('WEEK period keeps the full list with no control', () => {
    render(board('weekly', entries(15)));
    expect(rowCount()).toBe(15);
    expect(screen.queryByTestId('standings-board-expand')).toBeNull();
  });

  it('switching channel lands back on the collapsed top 10', () => {
    const utils = render(board('all_time', entries(15)));
    fireEvent.click(screen.getByTestId('standings-board-expand'));
    expect(rowCount()).toBe(15);
    utils.rerender(board('all_time', entries(15), { metric: 'xp' }));
    expect(rowCount()).toBe(10);
  });

  it('a viewer below the cut keeps the pinned MY READING while collapsed, and loses it expanded', () => {
    const myRank: MyLeaderboardRank = {
      rank: 12,
      value: 880,
      previous_value: null,
      trend: 0,
      total_players: 15,
    };
    render(board('all_time', entries(15), { myPlayerId: 'p-12', myRank }));
    expect(screen.getByTestId('standings-board-my-reading')).toBeTruthy();
    fireEvent.click(screen.getByTestId('standings-board-expand'));
    expect(screen.queryByTestId('standings-board-my-reading')).toBeNull();
    expect(screen.getByTestId('standings-row-p-12')).toBeTruthy();
  });
});
