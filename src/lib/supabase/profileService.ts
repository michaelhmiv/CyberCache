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

function getConfirmedAt(user: User): string | null {
  const candidate = user as User & { email_confirmed_at?: string | null; confirmed_at?: string | null };
  return candidate.email_confirmed_at ?? candidate.confirmed_at ?? null;
}

function resolveAccountType(user: User): AccountType {
  if (isAnonymousUser(user)) return 'guest';
  return getConfirmedAt(user) ? 'verified' : 'registered_unverified';
}

function plusSevenDays(date: string | Date): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  return new Date(value.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
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

export async function ensureProfile(user: User, options: EnsureProfileOptions = {}): Promise<ProfileRow> {
  const existing = await getProfile(user.id);
  const accountType = resolveAccountType(user);
  const email = user.email ?? null;
  const emailVerifiedAt = getConfirmedAt(user);
  const createdAt = existing?.created_at ?? new Date().toISOString();

  const nextProfile: Partial<ProfileRow> & { id: string } = {
    id: user.id,
    account_type: accountType,
    email,
    email_verified_at: emailVerifiedAt,
    verification_grace_expires_at: existing?.verification_grace_expires_at ?? plusSevenDays(createdAt),
  };

  if (!existing?.username && options.username) {
    nextProfile.username = options.username;
  } else if (!existing?.username && typeof user.user_metadata?.username === 'string') {
    nextProfile.username = user.user_metadata.username;
  }

  if (!existing) {
    nextProfile.player_level = 1;
    nextProfile.player_xp = 0;
    nextProfile.credits = 0;
    nextProfile.created_at = createdAt;
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert(nextProfile, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) throw error;
  return data as ProfileRow;
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
