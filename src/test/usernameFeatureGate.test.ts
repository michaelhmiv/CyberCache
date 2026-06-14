import { describe, expect, it } from 'vitest';
import { canUseFeature, type AccountState } from '../auth/accountState';

function makeAccount(overrides: Partial<AccountState> = {}): AccountState {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    accountType: 'verified',
    username: null,
    hasUsername: false,
    email: 'hunter@example.com',
    emailVerifiedAt: new Date().toISOString(),
    verificationGraceExpiresAt: null,
    verificationReminderLastSeenAt: null,
    isAnonymous: false,
    ...overrides,
  };
}

describe('leaderboards feature gate', () => {
  it('allows verified users with username', () => {
    const account = makeAccount({ username: 'cacheking', hasUsername: true });
    expect(canUseFeature(account, 'leaderboards').allowed).toBe(true);
  });

  it('blocks verified users without username', () => {
    const account = makeAccount({ accountType: 'verified', username: null, hasUsername: false });
    expect(canUseFeature(account, 'leaderboards').allowed).toBe(false);
  });

  it('blocks unverified users even with username', () => {
    const account = makeAccount({ accountType: 'registered_unverified', emailVerifiedAt: null, username: 'cacheking', hasUsername: true });
    expect(canUseFeature(account, 'leaderboards').allowed).toBe(false);
  });

  it('blocks guests', () => {
    const account = makeAccount({ accountType: 'guest', isAnonymous: true, username: 'guest_1234ABCD', hasUsername: true });
    expect(canUseFeature(account, 'leaderboards').allowed).toBe(false);
  });
});

describe('social feature gate', () => {
  it('allows users with username', () => {
    const account = makeAccount({ username: 'cacheking', hasUsername: true });
    expect(canUseFeature(account, 'social').allowed).toBe(true);
  });

  it('blocks users without username', () => {
    const account = makeAccount({ username: null, hasUsername: false });
    expect(canUseFeature(account, 'social').allowed).toBe(false);
  });
});
