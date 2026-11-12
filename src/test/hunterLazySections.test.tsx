/**
 * Hunter lazy sections (tab-switch latency fix, 2026-11-12):
 * ProfileScreen renders ONLY the active stop. Unselected stops
 * must be absent from the DOM entirely (not CSS-hidden), so the
 * HUNTER tab no longer carries every section's subtree (~2,485
 * nodes) on every tab switch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'user-1' } as { id: string } | null,
    account: null as import('@/auth/accountState').AccountState | null,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false as boolean,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: { recycleItem: vi.fn(), equipItem: vi.fn() },
  fetchProfileLifetime: vi.fn(async () => null),
  fetchCollections: vi.fn(async () => ({ legendary_cores: 0, discoveries: [] })),
}));

vi.mock('@/lib/api/leaderboardService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/leaderboardService')>()),
  getLeaderboard: vi.fn(async () => []),
  getWeeklyLeaderboards: vi.fn(async () => null),
}));

vi.mock('@/lib/api/publicProfileService', () => ({ getPublicProfile: vi.fn(async () => null) }));

vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getCacheRankState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getResearchState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/api/statsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/statsService')>()),
  getMyStatsSummary: vi.fn(async () => null),
}));

vi.mock('@/lib/api/usernameService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/usernameService')>()),
  getMyProfileSummary: vi.fn(async () => null),
}));

vi.mock('@/lib/api/progressionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/progressionService')>()),
  getMyProgressionSnapshots: vi.fn(async () => []),
}));

vi.mock('@/lib/api/masteryService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/masteryService')>()),
  getMyMasterySummary: vi.fn(async () => []),
}));

import { ProfileScreen } from '@/screens/ProfileScreen';
import type { AccountState } from '@/auth/accountState';

const verifiedAccount: AccountState = {
  userId: 'user-1',
  accountType: 'verified',
  username: 'hunter',
  hasUsername: true,
  email: 'hunter@example.com',
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  verificationGraceExpiresAt: null,
  verificationReminderLastSeenAt: null,
  isAnonymous: false,
};

const ALL_STOPS = ['hub', 'profile', 'collections', 'cacheRank', 'research', 'trees', 'standings', 'account', 'wardrobe'] as const;

beforeEach(() => {
  hoisted.auth.account = verifiedAccount;
});

describe('Hunter lazy sections — only the active stop is in the DOM', () => {
  it('on the hub, every other stop section is absent (not hidden)', () => {
    render(<ProfileScreen onNavigate={() => {}} />);
    expect(screen.getByTestId('hunter-section-hub')).toBeTruthy();
    for (const id of ALL_STOPS) {
      if (id === 'hub') continue;
      expect(screen.queryByTestId(`hunter-section-${id}`), `hunter-section-${id} must be absent`).toBeNull();
    }
    // Heavy per-stop anchors ride their sections out of the DOM too.
    expect(screen.queryByTestId('profile-skill-trees')).toBeNull();
    expect(screen.queryByTestId('profile-wardrobe-anchor')).toBeNull();
  });

  it('opening a stop mounts only that stop; back returns to the hub alone', () => {
    render(<ProfileScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId('hub-door-wardrobe'));
    expect(screen.getByTestId('hunter-section-wardrobe')).toBeTruthy();
    expect(screen.getByTestId('profile-wardrobe-anchor')).toBeTruthy();
    expect(screen.queryByTestId('hunter-section-hub')).toBeNull();

    fireEvent.click(screen.getAllByTestId('hunter-back-menu')[0]);
    expect(screen.getByTestId('hunter-section-hub')).toBeTruthy();
    expect(screen.queryByTestId('hunter-section-wardrobe')).toBeNull();
  });

  it('focusSection deep-link mounts the focused stop and nothing else', () => {
    render(<ProfileScreen focusSection="skills" />);
    expect(screen.getByTestId('hunter-section-trees')).toBeTruthy();
    expect(screen.getByTestId('profile-skill-trees')).toBeTruthy();
    expect(screen.queryByTestId('hunter-section-hub')).toBeNull();
  });
});
