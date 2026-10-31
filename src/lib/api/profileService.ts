/**
 * Profile service (Route B, slice B4) — transport swap onto the Chef
 * read/write routes. Signatures and result shapes are unchanged from
 * the Supabase version; identity comes from the Chef JWT (the routes
 * scope to the token subject), so the userId arguments are retained
 * for call-site compatibility and are not sent.
 */
import type { AccountState, AccountType } from '../../auth/accountState';
import { apiRequest, isNotFoundError } from './http';
import type { ApiUser } from './session';

export interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  player_level: number;
  player_xp: number;
  credits: number;
  scrap: number;
  cache_tokens: number;
  cache_token_parts: number;
  /** Legendary core balance (migration 0026). */
  legendary_cores?: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
  consumables: Record<string, number>;
  skill_spends: Record<string, number>;
  boss_state: Record<string, unknown>;
  last_idle_claim_at: string;
  last_claimed_tick: number;
  created_at: string;
  updated_at: string;
  account_type: AccountType;
  email: string | null;
  email_verified_at: string | null;
  verification_grace_expires_at: string | null;
  verification_reminder_last_seen_at: string | null;
}

export interface EnsureProfileOptions {
  username?: string;
}

export function profileRowToAccountState(profile: ProfileRow, user?: ApiUser | null): AccountState {
  return {
    userId: profile.id,
    accountType: profile.account_type,
    username: profile.username,
    hasUsername: profile.username !== null && profile.username.trim() !== '',
    email: profile.email,
    emailVerifiedAt: profile.email_verified_at,
    verificationGraceExpiresAt: profile.verification_grace_expires_at,
    verificationReminderLastSeenAt: profile.verification_reminder_last_seen_at,
    isAnonymous: user ? user.isAnonymous : profile.account_type === 'guest',
  };
}

export async function getProfile(_userId: string): Promise<ProfileRow | null> {
  try {
    return await apiRequest<ProfileRow>('/profile/me');
  } catch (error) {
    // The Chef answers 404 for a missing own row; Supabase answered
    // null. Everything else still throws, as before.
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function ensureProfile(user: ApiUser, _options: EnsureProfileOptions = {}): Promise<ProfileRow> {
  const existing = await getProfile(user.id);
  if (!existing) {
    throw new Error('Profile row is missing. Sign out and sign back in so the server can create the account profile.');
  }
  return existing;
}

export async function getAccountState(user: ApiUser): Promise<AccountState> {
  const profile = await ensureProfile(user);
  return profileRowToAccountState(profile, user);
}

export async function markVerificationReminderSeen(_userId: string): Promise<ProfileRow> {
  return apiRequest<ProfileRow>('/profile/mark-reminder-seen', { method: 'POST' });
}
