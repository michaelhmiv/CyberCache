import { describe, expect, it } from 'vitest';
import {
  canUseFeature,
  isVerificationGraceExpired,
  shouldShowVerificationReminder,
  type AccountState,
} from '../auth/accountState';

const baseAccount: AccountState = {
  userId: 'user-1',
  accountType: 'registered_unverified',
  username: null,
  hasUsername: false,
  email: 'player@example.com',
  emailVerifiedAt: null,
  verificationGraceExpiresAt: '2026-06-15T00:00:00.000Z',
  verificationReminderLastSeenAt: null,
  isAnonymous: false,
};

describe('account state gates', () => {
  it('allows solo play without an account', () => {
    expect(canUseFeature(null, 'solo_play').allowed).toBe(true);
  });

  it('blocks guest accounts from player economy features', () => {
    const guest: AccountState = { ...baseAccount, accountType: 'guest', isAnonymous: true, email: null };
    expect(canUseFeature(guest, 'market')).toEqual({
      allowed: false,
      reason: 'Sign in with Google to use player economy features.',
    });
  });

  it('blocks registered but unverified users from player economy features', () => {
    expect(canUseFeature(baseAccount, 'service_jobs')).toEqual({
      allowed: false,
      reason: 'Sign in with Google to unlock player economy features.',
    });
  });

  it('allows verified users to use player economy features', () => {
    const verified: AccountState = {
      ...baseAccount,
      accountType: 'verified',
      emailVerifiedAt: '2026-06-08T00:00:00.000Z',
    };
    expect(canUseFeature(verified, 'market').allowed).toBe(true);
    expect(canUseFeature(verified, 'service_jobs').allowed).toBe(true);
  });

  it('shows verification reminders at most daily', () => {
    expect(shouldShowVerificationReminder(baseAccount, new Date('2026-06-08T12:00:00.000Z'))).toBe(true);

    const remindedRecently: AccountState = {
      ...baseAccount,
      verificationReminderLastSeenAt: '2026-06-08T08:00:00.000Z',
    };
    expect(shouldShowVerificationReminder(remindedRecently, new Date('2026-06-08T12:00:00.000Z'))).toBe(false);
    expect(shouldShowVerificationReminder(remindedRecently, new Date('2026-06-09T09:00:00.000Z'))).toBe(true);
  });

  it('treats the grace date as a reminder deadline, not a solo-play blocker', () => {
    const expired: AccountState = {
      ...baseAccount,
      verificationGraceExpiresAt: '2026-06-01T00:00:00.000Z',
    };

    expect(isVerificationGraceExpired(expired, new Date('2026-06-08T00:00:00.000Z'))).toBe(true);
    expect(canUseFeature(expired, 'solo_play').allowed).toBe(true);
    expect(canUseFeature(expired, 'market').allowed).toBe(false);
  });
});
