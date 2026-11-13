export type AccountType = 'guest' | 'registered_unverified' | 'verified';

export interface AccountState {
  userId: string | null;
  accountType: AccountType;
  username: string | null;
  hasUsername: boolean;
  email: string | null;
  emailVerifiedAt: string | null;
  verificationGraceExpiresAt: string | null;
  verificationReminderLastSeenAt: string | null;
  isAnonymous: boolean;
}

export type GatedFeature =
  | 'solo_play'
  | 'persistent_inventory'
  | 'market'
  | 'service_jobs'
  | 'escrow'
  | 'trading'
  | 'social'
  | 'leaderboards';

export interface GateDecision {
  allowed: boolean;
  reason?: string;
}

export function isVerifiedAccount(account: AccountState | null): boolean {
  return Boolean(account?.accountType === 'verified' && account.emailVerifiedAt);
}

export function isGuestAccount(account: AccountState | null): boolean {
  return Boolean(account?.accountType === 'guest' || account?.isAnonymous);
}

export function isRegisteredUnverifiedAccount(account: AccountState | null): boolean {
  return Boolean(account?.accountType === 'registered_unverified' && !account.emailVerifiedAt);
}

export function shouldShowVerificationReminder(account: AccountState | null, now = new Date()): boolean {
  if (!account || isVerifiedAccount(account) || isGuestAccount(account)) return false;

  const lastSeen = account.verificationReminderLastSeenAt
    ? new Date(account.verificationReminderLastSeenAt)
    : null;

  if (!lastSeen) return true;

  const elapsedMs = now.getTime() - lastSeen.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  return elapsedMs >= oneDayMs;
}

export function isVerificationGraceExpired(account: AccountState | null, now = new Date()): boolean {
  if (!account?.verificationGraceExpiresAt || isVerifiedAccount(account)) return false;
  return now.getTime() >= new Date(account.verificationGraceExpiresAt).getTime();
}

export function hasUsernameSet(account: AccountState | null): boolean {
  return Boolean(account?.hasUsername);
}

/**
 * The population the hunter-name prompt addresses (audit G-F5):
 * signed-in, non-anonymous accounts that have not claimed a name.
 * Guests are excluded — they receive an auto-generated handle and
 * are never asked.
 */
export function needsUsernamePrompt(account: AccountState | null): boolean {
  return Boolean(account && !account.hasUsername && !account.isAnonymous);
}

/**
 * Whether the boot-time name invitation may show (audit G-F5,
 * owner ruling 2026-11-12: play first — prompt for a name only
 * when it matters). Viewing is never username-gated (A-11);
 * appearing under a name is enforced per-op on the server, so
 * this prompt is an invitation, never a wall. Its cadence mirrors
 * the verification reminder: after a deferral it stays quiet for
 * 24 hours. The contextual re-ask at the Standings / Hunter
 * surfaces is governed separately (once per session) by
 * useUsernamePrompt.
 */
export function shouldShowUsernamePrompt(
  account: AccountState | null,
  lastDeferredAt: number | null,
  now = Date.now(),
): boolean {
  if (!needsUsernamePrompt(account)) return false;
  if (lastDeferredAt == null) return true;

  const oneDayMs = 24 * 60 * 60 * 1000;
  return now - lastDeferredAt >= oneDayMs;
}

export function canUseFeature(account: AccountState | null, feature: GatedFeature): GateDecision {
  if (feature === 'solo_play') return { allowed: true };

  if (!account) {
    return { allowed: false, reason: 'Sign in or continue as guest first.' };
  }

  if (feature === 'persistent_inventory') {
    return { allowed: true };
  }

  // Viewing is never gated (audit A-11): guests SEE everything with
  // real data — the server serves guests the real leaderboard and
  // the screens render it. Appearing on a board and transacting
  // socially are enforced per-op on the server, not by this table;
  // the old entries denied guests the view itself and contradicted
  // the law (the GUEST-01 failure mode, one import away from
  // re-walling a surface through FeatureGate).
  if (feature === 'leaderboards' || feature === 'social') {
    return { allowed: true };
  }

  if (isVerifiedAccount(account)) {
    return { allowed: true };
  }

  if (isGuestAccount(account)) {
    return {
      allowed: false,
      reason: 'Sign in with Google to use player economy features.',
    };
  }

  return {
    allowed: false,
    reason: 'Sign in with Google to unlock player economy features.',
  };
}
