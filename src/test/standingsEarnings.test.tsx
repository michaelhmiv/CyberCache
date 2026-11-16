/**
 * Standings earnings — the record behind the Board Hub's
 * SETTLEMENT button (owner ruling 2026-11-16: past results are a
 * receipt, not a billboard — the readout left the Standings flow
 * and opens as the SettlementReadoutSheet). Pins:
 *
 *  - The sheet renders SETTLED earnings from the real weekly
 *    payload shape: per race, the finish and the reward with the
 *    hero number, plus the plain-words auto-pay note (race rewards
 *    are paid by settlement — there is no claim op, and the sheet
 *    must never imply one).
 *  - OPENING the sheet marks the week seen (localStorage marker +
 *    event), and the badge hook's unseen count clears in response:
 *    badge count semantics are settled-vs-claimable correct — the
 *    count is an unseen-earnings notice, never a claim count. A
 *    closed sheet marks nothing.
 *  - Placed-without-reward, unsettled (pending), and no-earnings
 *    states each render their honest line; the empty state carries
 *    the exact owner-facing copy and a door to the boards.
 *  - Loading and error states render (error with a working retry).
 *  - The hub itself: the deck's channels + period switch drive
 *    the board below (one state owner), and the SETTLEMENT button
 *    carries the one-glance headline (keys paid, or the drop-luck
 *    figure when no keys were paid).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/lib/api/leaderboardService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/leaderboardService')>();
  return {
    ...actual,
    getLeaderboard: vi.fn(async () => []),
    getWeeklyLeaderboards: vi.fn(),
  };
});

import {
  BoardHubPanel,
  SettlementReadoutSheet,
  type BoardHubSelection,
} from '@/components/leaderboard/WeeklyEarningsPanel';
import { BoardConsole } from '@/components/leaderboard/StandingsConsole';
import { deriveWeeklyEarnings } from '@/components/leaderboard/weeklyEarnings';
import {
  useStandingsBadge,
  readStandingsEarningsSeenWeek,
  STANDINGS_EARNINGS_SEEN_KEY,
} from '@/components/profile/standingsBadge';
import {
  getWeeklyLeaderboards,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type WeeklyLeaderboards,
  type WeeklyRaceBoard,
  type WeeklyRaceReward,
} from '@/lib/api/leaderboardService';

const reward = (over: Partial<WeeklyRaceReward> = {}): WeeklyRaceReward => ({
  rank: 1,
  cache_keys: 3,
  buff_bonus: 0.25,
  buff_hours: 48,
  buff_expires_at: null,
  ...over,
});

const race = (
  id: string,
  myReward: WeeklyRaceBoard['my_reward'],
  me: WeeklyRaceBoard['me'] = null,
): WeeklyRaceBoard => ({
  id,
  label: id,
  unit: 'kills',
  blurb: '',
  min_qualifying_value: 1,
  entries: [],
  participant_count: 5,
  me,
  my_reward: myReward,
});

function payload(overrides: Partial<WeeklyLeaderboards> = {}): WeeklyLeaderboards {
  return {
    week: { key: '2026-10-26', start: '2026-10-26T00:00:00.000Z', ends_at: '2026-11-02T00:00:00.000Z' },
    races: [],
    previous_week: {
      key: '2026-10-19',
      start: '2026-10-19T00:00:00.000Z',
      ends_at: '2026-10-26T00:00:00.000Z',
      settled: true,
      settled_at: '2026-10-27T00:00:00.000Z',
      races: [],
    },
    my_drop_buff: null,
    ...overrides,
  };
}

const settledWith = (races: WeeklyRaceBoard[]): WeeklyLeaderboards =>
  payload({
    previous_week: { ...payload().previous_week, races },
  });

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getWeeklyLeaderboards).mockReset();
});

describe('deriveWeeklyEarnings — state from the real payload', () => {
  it('earnings: settled week with rewards, totals summed', () => {
    const state = deriveWeeklyEarnings(
      settledWith([race('kills', reward()), race('bosses', reward({ rank: 2, cache_keys: 2 }))]),
    );
    expect(state.kind).toBe('earnings');
    if (state.kind === 'earnings') {
      expect(state.rows).toHaveLength(2);
      expect(state.totalCacheKeys).toBe(5);
    }
  });

  it('placed: settled, raced, no reward paid', () => {
    const state = deriveWeeklyEarnings(
      settledWith([race('kills', null, { rank: 14, value: 40 })]),
    );
    expect(state.kind).toBe('placed');
  });

  it('pending: raced week not settled yet', () => {
    const data = payload({
      previous_week: {
        ...payload().previous_week,
        settled: false,
        settled_at: null,
        races: [race('kills', null, { rank: 3, value: 90 })],
      },
    });
    expect(deriveWeeklyEarnings(data).kind).toBe('pending');
  });

  it('empty: no participation, and for a null payload', () => {
    expect(deriveWeeklyEarnings(settledWith([race('kills', null)])).kind).toBe('empty');
    expect(deriveWeeklyEarnings(null).kind).toBe('empty');
  });
});

describe('SettlementReadoutSheet — the settled record', () => {
  it('renders per-race finishes with hero reward numbers and the auto-pay note; no claim affordance', () => {
    render(
      <SettlementReadoutSheet
        open
        onClose={() => {}}
        data={settledWith([
          race('kills', reward()),
          race('bosses', reward({ rank: 4, cache_keys: 0, buff_bonus: 0.1, buff_hours: 12 })),
        ])}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId('weekly-earnings-autopay-note').textContent).toContain(
      'pay out automatically',
    );
    const kills = screen.getByTestId('weekly-earnings-row-kills');
    expect(kills.textContent).toContain('Finished #1');
    expect(kills.textContent).toContain('+3');
    expect(kills.textContent).toContain('Cache keys');
    expect(kills.textContent).toContain('+25% drop luck for 48h');
    // Buff-only finish (ranks 4–10): the buff itself is the hero.
    const bosses = screen.getByTestId('weekly-earnings-row-bosses');
    expect(bosses.textContent).toContain('Finished #4');
    expect(bosses.textContent).toContain('+10%');
    expect(bosses.textContent).toContain('Drop luck · 12h');
    // Nothing on this panel may offer a claim — settlement paid it.
    expect(screen.queryByRole('button', { name: /claim/i })).toBeNull();
  });

  it('opening the sheet marks the settled week seen', () => {
    render(
      <SettlementReadoutSheet
        open
        onClose={() => {}}
        data={settledWith([race('kills', reward())])}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    expect(readStandingsEarningsSeenWeek()).toBe('2026-10-19');
    expect(window.localStorage.getItem(STANDINGS_EARNINGS_SEEN_KEY)).toBe('2026-10-19');
  });

  it('a CLOSED sheet marks nothing seen — the receipt resolves only when opened', () => {
    render(
      <SettlementReadoutSheet
        open={false}
        onClose={() => {}}
        data={settledWith([race('kills', reward())])}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByTestId('weekly-earnings-autopay-note')).toBeNull();
    expect(readStandingsEarningsSeenWeek()).toBeNull();
  });

  it('the sheet closes through its chrome (close button fires onClose)', () => {
    const onClose = vi.fn();
    render(
      <SettlementReadoutSheet
        open
        onClose={onClose}
        data={settledWith([race('kills', reward())])}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close picker' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('placed state: honest line, no earnings rows', () => {
    render(
      <SettlementReadoutSheet
        open
        onClose={() => {}}
        data={settledWith([race('kills', null, { rank: 14, value: 40 })])}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId('weekly-earnings-placed').textContent).toContain(
      'finished outside the rewards',
    );
    expect(screen.queryByTestId('weekly-earnings-row-kills')).toBeNull();
  });

  it('pending state: names the heartbeat settlement, promises no button', () => {
    render(
      <SettlementReadoutSheet
        open
        onClose={() => {}}
        data={payload({
          previous_week: {
            ...payload().previous_week,
            settled: false,
            settled_at: null,
            races: [race('kills', null, { rank: 3, value: 90 })],
          },
        })}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId('weekly-earnings-pending').textContent).toContain(
      'settle at the next daily heartbeat',
    );
  });

  it('empty state: one honest line plus the door to the boards', () => {
    render(
      <SettlementReadoutSheet
        open
        onClose={() => {}}
        data={settledWith([])}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    const empty = screen.getByTestId('weekly-earnings-empty');
    expect(empty.textContent).toContain(
      'No weekly earnings yet — your best placements land here Mondays',
    );
    expect(screen.getByRole('button', { name: /see this week's races/i })).toBeTruthy();
    // An empty week must NOT mark anything seen.
    expect(readStandingsEarningsSeenWeek()).toBeNull();
  });

  it('loading and error states render; retry fires', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <SettlementReadoutSheet open onClose={() => {}} data={null} loading error={null} onRetry={onRetry} />,
    );
    expect(screen.getByTestId('weekly-earnings-loading')).toBeTruthy();
    rerender(
      <SettlementReadoutSheet open onClose={() => {}} data={null} loading={false} error="boom" onRetry={onRetry} />,
    );
    expect(screen.getByTestId('weekly-earnings-error')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('badge clears when the sheet is opened (settled ≠ claimable)', () => {
  const BadgeProbe: React.FC = () => {
    const badge = useStandingsBadge();
    return (
      <div>
        <span data-testid="probe-unseen">{badge.unseenEarningsCount}</span>
        <span data-testid="probe-earnings">{badge.earningsCount}</span>
      </div>
    );
  };

  it('unseen count drops to zero once the earnings sheet opens; earnings count stays truthful', async () => {
    const data = settledWith([race('kills', reward()), race('bosses', reward({ rank: 2 }))]);
    vi.mocked(getWeeklyLeaderboards).mockResolvedValue(data);

    render(
      <>
        <BadgeProbe />
        <SettlementReadoutSheet open onClose={() => {}} data={data} loading={false} error={null} onRetry={() => {}} />
      </>,
    );

    // The earnings themselves are a fact of the settled week…
    await waitFor(() => expect(screen.getByTestId('probe-earnings').textContent).toBe('2'));
    // …and once the sheet has been opened, the NOTICE clears.
    await waitFor(() => expect(screen.getByTestId('probe-unseen').textContent).toBe('0'));
  });
});

describe('BoardHubPanel — the control deck + settlement door (owner ruling 2026-11-16)', () => {
  const hubFor = (over: Partial<BoardHubSelection> = {}): BoardHubSelection => ({
    metric: 'level',
    period: 'all_time',
    onMetricChange: vi.fn(),
    onPeriodChange: vi.fn(),
    myRanks: { level: 14, total_kills: 3 },
    ...over,
  });

  it('renders all ten channels with the viewer rank, the period switch, and the selection readout in the panel label', () => {
    render(
      <BoardHubPanel hub={hubFor()} data={null} loading={false} onOpenSettlement={() => {}} />,
    );
    const panel = screen.getByTestId('standings-board-hub-panel');
    // The readout rides the PanelLabel datum line, in the deck's place.
    expect(panel.textContent).toContain('LV · ALL TIME · MY RK #14');
    expect(panel.textContent).toContain('THE GLOBAL BOARD BELOW READS THIS SELECTION');
    // Every channel is a button carrying the viewer's rank on it.
    expect(screen.getByTestId('standings-hub-channel-level').textContent).toContain('#14');
    expect(screen.getByTestId('standings-hub-channel-total_kills').textContent).toContain('#3');
    expect(screen.getByTestId('standings-hub-channel-xp').textContent).toContain('—');
    expect(screen.getByTestId('standings-hub-period-all_time').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('standings-hub-period-weekly').getAttribute('aria-selected')).toBe('false');
  });

  it('channel and period taps report to the one state owner', () => {
    const hub = hubFor();
    render(<BoardHubPanel hub={hub} data={null} loading={false} onOpenSettlement={() => {}} />);
    fireEvent.click(screen.getByTestId('standings-hub-channel-total_kills'));
    expect(hub.onMetricChange).toHaveBeenCalledWith('total_kills');
    fireEvent.click(screen.getByTestId('standings-hub-period-weekly'));
    expect(hub.onPeriodChange).toHaveBeenCalledWith('weekly');
  });

  it('the SETTLEMENT button carries the one-glance headline: keys paid over the window label', () => {
    render(
      <BoardHubPanel
        hub={hubFor()}
        data={settledWith([
          race('kills', reward()),
          race('bosses', reward({ rank: 2, cache_keys: 2 })),
        ])}
        loading={false}
        onOpenSettlement={() => {}}
      />,
    );
    const button = screen.getByTestId('standings-settlement-open');
    expect(button.textContent).toContain('SETTLEMENT');
    expect(button.textContent).toContain('LAST WEEK · OCT 19 – OCT 25');
    expect(button.textContent).toContain('+5');
    // Source case; the button's label renders uppercase via CSS.
    expect(button.textContent).toContain('Keys paid');
  });

  it('a keys-free week headlines the drop-luck figure instead', () => {
    render(
      <BoardHubPanel
        hub={hubFor()}
        data={settledWith([race('kills', reward({ cache_keys: 0 }))])}
        loading={false}
        onOpenSettlement={() => {}}
      />,
    );
    const button = screen.getByTestId('standings-settlement-open');
    expect(button.textContent).toContain('+25%');
    expect(button.textContent).toContain('Drop luck');
    expect(button.textContent).not.toContain('Keys paid');
  });

  it('while the weekly payload loads, the button shows no headline; tapping it opens the sheet', () => {
    const onOpenSettlement = vi.fn();
    render(
      <BoardHubPanel hub={hubFor()} data={null} loading onOpenSettlement={onOpenSettlement} />,
    );
    const button = screen.getByTestId('standings-settlement-open');
    expect(button.textContent).toContain('SETTLEMENT');
    expect(button.textContent).not.toContain('Keys paid');
    fireEvent.click(button);
    expect(onOpenSettlement).toHaveBeenCalledTimes(1);
  });
});

describe('hub selection drives the board (one state owner, console selectors hub-gated)', () => {
  const entry = (n: number): LeaderboardEntry => ({
    rank: n,
    player_id: `p-${n}`,
    username: `Hunter ${n}`,
    value: 1000 - n * 10,
    previous_value: null,
    trend: 0,
  });

  const HubAndBoard: React.FC = () => {
    const [metric, setMetric] = React.useState<LeaderboardMetric>('level');
    const [period, setPeriod] = React.useState<LeaderboardPeriod>('all_time');
    const myRanks: Partial<Record<LeaderboardMetric, number | null>> = {
      level: 14,
      total_kills: 3,
    };
    const rows = [entry(1), entry(2), entry(3)];
    return (
      <>
        <BoardHubPanel
          hub={{ metric, period, onMetricChange: setMetric, onPeriodChange: setPeriod, myRanks }}
          data={null}
          loading={false}
          onOpenSettlement={() => {}}
        />
        <BoardConsole
          metric={metric}
          period={period}
          onMetricChange={setMetric}
          onPeriodChange={setPeriod}
          entries={rows}
          loading={false}
          myPlayerId={null}
          myRank={null}
          myRanks={myRanks}
          looks={{}}
          totalPlayers={rows.length}
          hubControlled
        />
      </>
    );
  };

  it('the console renders no selector bank of its own; hub taps re-read the board in place', () => {
    render(<HubAndBoard />);
    // Hub mode: the console opens on its datum — no CHANNEL SELECT.
    expect(screen.queryByText('CHANNEL SELECT')).toBeNull();
    const console_ = screen.getByTestId('standings-board-console');
    expect(console_.textContent).toContain('OUTPUT · LV · VS LEADER');
    expect(screen.getAllByTestId(/^standings-row-p-/)).toHaveLength(3);
    expect(screen.getByTestId('standings-board-hub-panel').textContent).toContain(
      'LV · ALL TIME · MY RK #14',
    );

    // Tap KILLS in the hub: the board's datum and the hub readout
    // both follow the one selection state.
    fireEvent.click(screen.getByTestId('standings-hub-channel-total_kills'));
    expect(console_.textContent).toContain('OUTPUT · KILLS · VS LEADER');
    expect(screen.getByTestId('standings-board-hub-panel').textContent).toContain(
      'KILLS · ALL TIME · MY RK #3',
    );

    // Tap WEEK: the readout follows; the rows stay on the page.
    fireEvent.click(screen.getByTestId('standings-hub-period-weekly'));
    expect(screen.getByTestId('standings-board-hub-panel').textContent).toContain(
      'KILLS · WEEK · MY RK #3',
    );
    expect(screen.getAllByTestId(/^standings-row-p-/)).toHaveLength(3);
  });
});
