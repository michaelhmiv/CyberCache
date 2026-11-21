/**
 * Leaderboard Report action (Build 7 — App Review hardening,
 * Guideline 1.2 insurance). Pins:
 *
 *  - Every board row except the viewer's own carries a Report
 *    action; the viewer's own row never does.
 *  - The action is two-tap: arm ("Confirm?"), then post.
 *  - The post is POST /api/reports with the row's account id — the
 *    `player_id` the board payload already carries — and the
 *    leaderboard context, and it does NOT open the row's profile.
 *  - A landed report shows the "Reported — thanks." toast.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { BoardConsole } from '@/components/leaderboard/StandingsConsole';
import type { LeaderboardEntry } from '@/lib/api/leaderboardService';

const entry = (n: number): LeaderboardEntry => ({
  rank: n,
  player_id: `p-${n}`,
  username: `Hunter ${n}`,
  value: 1000 - n * 10,
  previous_value: null,
  trend: 0,
});

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('leaderboard Report action', () => {
  it('posts the report for another hunter and toasts; own row has no action', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const onRowClick = vi.fn();

    render(
      <BoardConsole
        metric="level"
        period="all_time"
        onMetricChange={vi.fn()}
        onPeriodChange={vi.fn()}
        entries={[entry(1), entry(2)]}
        loading={false}
        myPlayerId="p-1"
        myRank={null}
        myRanks={{}}
        looks={{}}
        totalPlayers={2}
        onRowClick={onRowClick}
        hubControlled
      />,
    );

    // Own row: no Report action. Other row: exactly one.
    expect(screen.queryByTestId('standings-report-p-1')).toBeNull();
    const report = screen.getByTestId('standings-report-p-2');
    expect(report.textContent).toContain('Report');

    // First tap only arms the control — nothing is posted yet.
    fireEvent.click(report);
    expect(screen.getByTestId('standings-report-p-2').textContent).toContain('Confirm?');
    expect(fetchMock).not.toHaveBeenCalled();

    // Second tap posts and toasts.
    fireEvent.click(screen.getByTestId('standings-report-p-2'));
    const toast = await screen.findByTestId('report-toast');
    expect(toast.textContent).toBe('Reported — thanks.');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/reports');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      reportedAccountId: 'p-2',
      context: 'leaderboard',
    });
    // Reporting never opens the reported hunter's profile.
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
