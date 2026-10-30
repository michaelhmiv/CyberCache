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

export function canUseFeature(account: AccountState | null, feature: GatedFeature): GateDecision {
  if (feature === 'solo_play') return { allowed: true };

  if (!account) {
    return { allowed: false, reason: 'Sign in or continue as guest first.' };
  }

  if (feature === 'persistent_inventory') {
    return { allowed: true };
  }

  if (feature === 'leaderboards') {
    if (!isVerifiedAccount(account)) {
      return { allowed: false, reason: 'Sign in with Google to unlock leaderboards.' };
    }
    if (!hasUsernameSet(account)) {
      return { allowed: false, reason: 'Set a username to appear on leaderboards.' };
    }
    return { allowed: true };
  }

  if (feature === 'social') {
    if (!hasUsernameSet(account)) {
      return { allowed: false, reason: 'Set a username to use social features.' };
    }
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
