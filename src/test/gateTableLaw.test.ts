/**
 * A-11 — the shared gate table contradicted the guest-visibility
 * law: canUseFeature denied guests 'leaderboards' (verified +
 * username required) and 'social' (username required), while the
 * server serves guests the real leaderboard and the screens render
 * it. No screen imports FeatureGate today, so the table was a false
 * statement of the law sitting in the auth core — one import away
 * from re-walling a surface.
 *
 * The audit's CI assertion: "canUseFeature(guestAccount,
 * 'leaderboards') should be {allowed:true} for viewing
 * (transacting/appearing rules live elsewhere, as the server fold
 * does)." The economy entries are untouched — the live transact
 * lock (useEconomyTransactLock reads 'market') still denies
 * guests, pinned here too so the alignment cannot over-open.
 */
import { describe, expect, it } from 'vitest';
import { canUseFeature, type AccountState } from '../auth/accountState';

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

const guest: AccountState = { ...baseAccount, accountType: 'guest', isAnonymous: true, email: null, hasUsername: false };

describe('the gate table agrees with the guest-visibility law (audit A-11)', () => {
  it('a guest may VIEW leaderboards', () => {
    expect(canUseFeature(guest, 'leaderboards')).toEqual({ allowed: true });
  });

  it('a guest may VIEW social surfaces', () => {
    expect(canUseFeature(guest, 'social')).toEqual({ allowed: true });
  });

  it('an unverified account without a username may also view both', () => {
    expect(canUseFeature(baseAccount, 'leaderboards').allowed).toBe(true);
    expect(canUseFeature(baseAccount, 'social').allowed).toBe(true);
  });

  it('signed-out still cannot use the view features (an account context is required)', () => {
    expect(canUseFeature(null, 'leaderboards').allowed).toBe(false);
    expect(canUseFeature(null, 'social').allowed).toBe(false);
  });

  it('the economy entries did NOT move: guests still cannot transact', () => {
    expect(canUseFeature(guest, 'market').allowed).toBe(false);
    expect(canUseFeature(guest, 'trading').allowed).toBe(false);
    expect(canUseFeature(guest, 'escrow').allowed).toBe(false);
    expect(canUseFeature(guest, 'service_jobs').allowed).toBe(false);
  });
});
