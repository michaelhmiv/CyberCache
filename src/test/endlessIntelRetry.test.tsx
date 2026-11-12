/**
 * X-09 — Endless intel's failure message was the only data panel
 * in the app with no Retry control: when the Chamber facts load
 * failed, the error strip printed and the player could only leave
 * the tab and come back.
 *
 * The audit's CI assertion: render with the intel fetch rejecting;
 * assert Retry exists and re-fetches. Scaffolding mirrors
 * endlessStageHome.test.tsx's chef mock.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getCacheRankState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  verifyBossFight: vi.fn(),
  getEndlessMe: vi.fn(),
  advanceEndlessEncounter: vi.fn(),
  startEndlessRun: vi.fn(),
  bankEndlessRun: vi.fn(),
  getActionSkillState: vi.fn(async () => ({
    verified: true,
    actionSkill: {
      charge: 0,
      chargeMax: 100,
      charged: false,
      selection: null,
      selected: null,
      qualified: [],
      signatures: [],
      noKeystoneNote: 'No action skill yet.',
    },
  })),
}));

import { EndlessPanel } from '@/components/fight/EndlessPanel';
import { getEndlessMe, type ChefEndlessMeResult } from '@/lib/chef/chefClient';
import { endlessIntel } from '@/content/endless';

const mockGetEndlessMe = vi.mocked(getEndlessMe);

const meFixture: ChefEndlessMeResult = {
  verified: true,
  intel: endlessIntel(20, 1),
  bestDepth: 0,
  runsStartedToday: 0,
  recentRuns: [],
  activeRun: null,
};

describe('Endless intel failure carries a Retry (audit X-09)', () => {
  beforeEach(() => {
    mockGetEndlessMe.mockReset();
  });

  it('a rejected intel load shows the error WITH a Retry, and Retry re-fetches to the intel', async () => {
    mockGetEndlessMe
      .mockRejectedValueOnce(new Error('Chef endless facts failed'))
      .mockResolvedValue(meFixture);
    render(<EndlessPanel onLeave={() => {}} />);

    const retry = await screen.findByTestId('endless-retry');
    expect(screen.getByText(/Chef endless facts failed/)).toBeTruthy();
    expect(mockGetEndlessMe).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);
    await waitFor(() => expect(mockGetEndlessMe).toHaveBeenCalledTimes(2));
    // The intel landed: the prep section renders the first encounter
    // and the error strip (with its Retry) is gone.
    await screen.findByText(/Depth 1 —/);
    expect(screen.queryByTestId('endless-retry')).toBeNull();
  });

  it('a successful first load shows no Retry', async () => {
    mockGetEndlessMe.mockResolvedValue(meFixture);
    render(<EndlessPanel onLeave={() => {}} />);
    await screen.findByText(/Depth 1 —/);
    expect(screen.queryByTestId('endless-retry')).toBeNull();
  });
});
