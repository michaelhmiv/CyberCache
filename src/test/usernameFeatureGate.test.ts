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

  it('allows verified users without username (A-11: viewing is not username-gated)', () => {
    const account = makeAccount({ accountType: 'verified', username: null, hasUsername: false });
    expect(canUseFeature(account, 'leaderboards').allowed).toBe(true);
  });

  it('allows unverified users (A-11: viewing is not verification-gated)', () => {
    const account = makeAccount({ accountType: 'registered_unverified', emailVerifiedAt: null, username: 'cacheking', hasUsername: true });
    expect(canUseFeature(account, 'leaderboards').allowed).toBe(true);
  });

  it('allows guests (Guest Visibility Law: guests see everything)', () => {
    const account = makeAccount({ accountType: 'guest', isAnonymous: true, username: 'guest_1234ABCD', hasUsername: true });
    expect(canUseFeature(account, 'leaderboards').allowed).toBe(true);
  });
});

describe('social feature gate', () => {
  it('allows users with username', () => {
    const account = makeAccount({ username: 'cacheking', hasUsername: true });
    expect(canUseFeature(account, 'social').allowed).toBe(true);
  });

  it('allows users without username (A-11)', () => {
    const account = makeAccount({ username: null, hasUsername: false });
    expect(canUseFeature(account, 'social').allowed).toBe(true);
  });
});
