import type { Session, Subscription, User } from '@supabase/supabase-js';
import { getAuthRedirectConfig } from '../../auth/authTypes';
import { supabase } from './client';

export type AuthStateCallback = (session: Session | null) => void;

export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(callback: AuthStateCallback): Subscription {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return data.subscription;
}

export async function signInAsGuest(): Promise<User> {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error('Guest sign-in did not return a user.');
  return data.user;
}

export async function signInWithEmail(email: string, secret: string): Promise<User> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: secret });
  if (error) throw error;
  if (!data.user) throw new Error('Email sign-in did not return a user.');
  return data.user;
}

export async function registerWithEmail(email: string, secret: string, username: string): Promise<User | null> {
  const redirects = getAuthRedirectConfig();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: secret,
    options: { emailRedirectTo: redirects.confirmedUrl, data: { username } },
  });
  if (error) throw error;
  return data.user ?? null;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const redirects = getAuthRedirectConfig();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirects.resetPasswordUrl });
  if (error) throw error;
}

export async function updatePassword(secret: string): Promise<User> {
  const { data, error } = await supabase.auth.updateUser({ password: secret });
  if (error) throw error;
  if (!data.user) throw new Error('Credential update did not return a user.');
  return data.user;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
