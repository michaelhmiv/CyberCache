/**
 * Standings board channel units — regression for the shipped
 * crash-on-tap from PR #408 (finding F4 in PR #411): the console's
 * local unit map keyed a retired metric vocabulary (xp_total,
 * kd_ratio, …), so 8 of the 10 channels read an undefined unit and
 * the board header's .toUpperCase() threw the moment those channels
 * were selected. Only the LV channel was exercised in the #408
 * verification captures, so it shipped.
 *
 * Pins:
 *  - Rendering the board with EACH of the 10 channels selected
 *    never throws, and the column header prints that channel's
 *    canonical unit from the service's LEADERBOARD_METRIC_UNITS.
 *  - Selecting each channel from the bank (the actual tap path)
 *    fires the metric change, and the re-rendered board — as the
 *    screen renders it once its state updates — carries the unit.
 *  - A board row on the selected channel prints the unit word
 *    beside its value.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { BoardConsole } from '@/components/leaderboard/StandingsConsole';
import { METRIC_SHORT } from '@/components/leaderboard/standingsConsoleTokens';
import {
  LEADERBOARD_METRIC_UNITS,
  type LeaderboardEntry,
  type LeaderboardMetric,
} from '@/lib/api/leaderboardService';

const CHANNELS = Object.keys(LEADERBOARD_METRIC_UNITS) as LeaderboardMetric[];

const leader = (over: Partial<LeaderboardEntry> = {}): LeaderboardEntry => ({
  rank: 1,
  player_id: 'p-leader',
  username: 'Leader',
  value: 100,
  previous_value: null,
  trend: 0,
  ...over,
});

const board = (metric: LeaderboardMetric, onMetricChange = vi.fn()) => (
  <BoardConsole
    metric={metric}
    period="all_time"
    onMetricChange={onMetricChange}
    onPeriodChange={vi.fn()}
    entries={[leader()]}
    loading={false}
    myPlayerId={null}
    myRank={null}
    myRanks={{}}
    looks={{}}
    totalPlayers={2}
  />
);

const headerText = () => screen.getByText(/^OUTPUT ·/).textContent;

describe('standings board — channel units (F4 regression)', () => {
  it('the canonical unit map covers exactly the 10 shipped channels', () => {
    expect(CHANNELS).toHaveLength(10);
    expect(Object.keys(METRIC_SHORT).sort()).toEqual([...CHANNELS].sort());
  });

  it.each(CHANNELS)(
    'renders channel %s with its canonical unit in the board header',
    (metric) => {
      render(board(metric));
      expect(headerText()).toBe(
        `OUTPUT · ${LEADERBOARD_METRIC_UNITS[metric].toUpperCase()} · VS LEADER`,
      );
    },
  );

  it.each(CHANNELS)('prints the unit word beside a row value on channel %s', (metric) => {
    render(board(metric));
    const row = screen.getByTestId('standings-row-p-leader');
    expect(row.textContent).toContain(LEADERBOARD_METRIC_UNITS[metric]);
  });

  it.each(CHANNELS)('selecting channel %s from the LV board never throws', (metric) => {
    const onMetricChange = vi.fn();
    const utils = render(board('level', onMetricChange));
    fireEvent.click(screen.getByText(METRIC_SHORT[metric]));
    expect(onMetricChange).toHaveBeenCalledWith(metric);
    // LeaderboardsScreen holds the metric in state; the re-render
    // with the tapped channel selected is the frame that crashed.
    utils.rerender(board(metric, onMetricChange));
    expect(headerText()).toBe(
      `OUTPUT · ${LEADERBOARD_METRIC_UNITS[metric].toUpperCase()} · VS LEADER`,
    );
  });
});
