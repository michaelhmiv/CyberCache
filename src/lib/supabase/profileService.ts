import type { User } from '@supabase/supabase-js';
import type { AccountState, AccountType } from '../../auth/accountState';
import { supabase } from './client';

export interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  player_level: number;
  player_xp: number;
  credits: number;
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

function isAnonymousUser(user: User): boolean {
  const candidate = user as User & { is_anonymous?: boolean };
  return Boolean(candidate.is_anonymous ?? !user.email);
}

export function profileRowToAccountState(profile: ProfileRow, user?: User | null): AccountState {
  return {
    userId: profile.id,
    accountType: profile.account_type,
    email: profile.email,
    emailVerifiedAt: profile.email_verified_at,
    verificationGraceExpiresAt: profile.verification_grace_expires_at,
    verificationReminderLastSeenAt: profile.verification_reminder_last_seen_at,
    isAnonymous: user ? isAnonymousUser(user) : profile.account_type === 'guest',
  };
}

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data as ProfileRow | null;
}

export async function ensureProfile(user: User, _options: EnsureProfileOptions = {}): Promise<ProfileRow> {
  const existing = await getProfile(user.id);
  if (!existing) {
    throw new Error('Profile row is missing. Sign out and sign back in so Supabase Auth can create the account profile.');
  }
  return existing;
}

export async function getAccountState(user: User): Promise<AccountState> {
  const profile = await ensureProfile(user);
  return profileRowToAccountState(profile, user);
}

export async function markVerificationReminderSeen(userId: string): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ verification_reminder_last_seen_at: new Date().toISOString() })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data as ProfileRow;
}
