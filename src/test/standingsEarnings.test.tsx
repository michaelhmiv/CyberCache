/**
 * Standings earnings panel — the destination for the Hunter
 * Standings badge. Pins:
 *
 *  - The panel renders SETTLED earnings from the real weekly
 *    payload shape: per race, the finish and the reward with the
 *    hero number, plus the plain-words auto-pay note (race rewards
 *    are paid by settlement — there is no claim op, and the panel
 *    must never imply one).
 *  - Viewing the panel marks the week seen (localStorage marker +
 *    event), and the badge hook's unseen count clears in response:
 *    badge count semantics are settled-vs-claimable correct — the
 *    count is an unseen-earnings notice, never a claim count.
 *  - Placed-without-reward, unsettled (pending), and no-earnings
 *    states each render their honest line; the empty state carries
 *    the exact owner-facing copy and a door to the boards.
 *  - Loading and error states render (error with a working retry).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/lib/api/leaderboardService', () => ({
  getLeaderboard: vi.fn(async () => []),
  getWeeklyLeaderboards: vi.fn(),
}));

import { WeeklyEarningsPanel } from '@/components/leaderboard/WeeklyEarningsPanel';
import { deriveWeeklyEarnings } from '@/components/leaderboard/weeklyEarnings';
import {
  useStandingsBadge,
  readStandingsEarningsSeenWeek,
  STANDINGS_EARNINGS_SEEN_KEY,
} from '@/components/profile/standingsBadge';
import {
  getWeeklyLeaderboards,
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

describe('WeeklyEarningsPanel — the settled record', () => {
  it('renders per-race finishes with hero reward numbers and the auto-pay note; no claim affordance', () => {
    render(
      <WeeklyEarningsPanel
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

  it('viewing the panel marks the settled week seen', () => {
    render(
      <WeeklyEarningsPanel
        data={settledWith([race('kills', reward())])}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    expect(readStandingsEarningsSeenWeek()).toBe('2026-10-19');
    expect(window.localStorage.getItem(STANDINGS_EARNINGS_SEEN_KEY)).toBe('2026-10-19');
  });

  it('placed state: honest line, no earnings rows', () => {
    render(
      <WeeklyEarningsPanel
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
      <WeeklyEarningsPanel
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
      <WeeklyEarningsPanel data={settledWith([])} loading={false} error={null} onRetry={() => {}} />,
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
      <WeeklyEarningsPanel data={null} loading error={null} onRetry={onRetry} />,
    );
    expect(screen.getByTestId('weekly-earnings-loading')).toBeTruthy();
    rerender(<WeeklyEarningsPanel data={null} loading={false} error="boom" onRetry={onRetry} />);
    expect(screen.getByTestId('weekly-earnings-error')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('badge clears when the panel is viewed (settled ≠ claimable)', () => {
  const BadgeProbe: React.FC = () => {
    const badge = useStandingsBadge();
    return (
      <div>
        <span data-testid="probe-unseen">{badge.unseenEarningsCount}</span>
        <span data-testid="probe-earnings">{badge.earningsCount}</span>
      </div>
    );
  };

  it('unseen count drops to zero once the earnings panel renders; earnings count stays truthful', async () => {
    const data = settledWith([race('kills', reward()), race('bosses', reward({ rank: 2 }))]);
    vi.mocked(getWeeklyLeaderboards).mockResolvedValue(data);

    render(
      <>
        <BadgeProbe />
        <WeeklyEarningsPanel data={data} loading={false} error={null} onRetry={() => {}} />
      </>,
    );

    // The earnings themselves are a fact of the settled week…
    await waitFor(() => expect(screen.getByTestId('probe-earnings').textContent).toBe('2'));
    // …and once the panel has been viewed, the NOTICE clears.
    await waitFor(() => expect(screen.getByTestId('probe-unseen').textContent).toBe('0'));
  });
});
