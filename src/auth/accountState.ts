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
  /**
   * The raw profiles.active_hunter_id (Cache Hunters slice (e)):
   * the hunter the account has actually fielded through the
   * server switch. Null means the account has NEVER fielded one —
   * its stage hunter is the resolved default (Vesper Cole) and
   * the starting-hunter pick is still pending. Optional because
   * account states built outside the profile read (older tests,
   * partial fixtures) do not carry it; absence means "unknown",
   * never "pending".
   */
  activeHunterId?: string | null;
  /**
   * True once the account has fielded a hunter at least once —
   * the starting-hunter pick is complete (slice (e)). Derived
   * from the raw column by the profile read; see needsHunterPick.
   */
  hasHunterPick?: boolean;
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

/**
 * The population the starting-hunter pick addresses (Cache
 * Hunters slice (e), brief §4(e) — the G-F5 deferral pattern
 * applied to hunter choice): any signed-in account that has
 * never fielded a hunter. Unlike the hunter-name prompt, guests
 * are INCLUDED — a fresh guest is exactly the account the pick
 * exists for (brief check E1 runs a fresh-guest case). "Never
 * fielded" is server truth, not a client flag: the profile's
 * raw active_hunter_id stays NULL from the bootstrap insert
 * until cc_set_active_hunter stamps it, and slice (a)'s
 * conversion backfilled every pre-reshape account — so a null
 * column can only mean the pick was never made. An account
 * state that does not carry the field (built outside the
 * profile read) is unknown, and unknown never prompts.
 */
export function needsHunterPick(account: AccountState | null): boolean {
  return Boolean(account && account.hasHunterPick === false);
}

/**
 * Whether the boot-time hunter-pick invitation may show. The
 * cadence mirrors the hunter-name invitation exactly (audit
 * G-F5): play first — after a "Not now" deferral the invitation
 * stays quiet for 24 hours. Completing the pick ends eligibility
 * through the account state itself (hasHunterPick), never
 * through this cadence. The deferred completion surface is the
 * Hunter tab's Roster stop, not another modal (brief §4(e):
 * no modal re-interrupts play).
 */
export function shouldShowHunterPick(
  account: AccountState | null,
  lastDeferredAt: number | null,
  now = Date.now(),
): boolean {
  if (!needsHunterPick(account)) return false;
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
      reason: 'Sign in to use player economy features.',
    };
  }

  return {
    allowed: false,
    reason: 'Verify your account to unlock player economy features.',
  };
}
