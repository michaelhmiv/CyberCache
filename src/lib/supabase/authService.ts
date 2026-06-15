import type { Session, Subscription, User } from '@supabase/supabase-js';
import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
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

export async function signInWithGoogle(): Promise<void> {
  const redirects = getAuthRedirectConfig();
  if (Capacitor.isNativePlatform()) {
    await signInWithGoogleNative(redirects.nativeOAuthUrl);
    return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirects.confirmedUrl },
  });
  if (error) throw error;
}

async function signInWithGoogleNative(redirectTo: string): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Google sign-in did not return an OAuth URL.');

  let listener: { remove: () => Promise<void> } | null = null;
  let browserListener: { remove: () => Promise<void> } | null = null;
  const cleanup = async () => {
    await listener?.remove();
    await browserListener?.remove();
    listener = null;
    browserListener = null;
  };

  let resolveAuth: () => void = () => undefined;
  let rejectAuth: (error: unknown) => void = () => undefined;
  const authCompletion = new Promise<void>((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });

  listener = await App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
    if (!event.url.startsWith(redirectTo)) return;
    try {
      await completeNativeOAuth(event.url);
      await cleanup();
      resolveAuth();
    } catch (callbackError) {
      await cleanup();
      rejectAuth(callbackError);
    }
  });

  browserListener = await Browser.addListener('browserFinished', async () => {
    await cleanup();
    rejectAuth(new Error('Google sign-in was cancelled.'));
  });

  try {
    await Browser.open({ url: data.url });
    await authCompletion;
  } catch (openError) {
    await cleanup();
    throw openError;
  }
}

async function completeNativeOAuth(callbackUrl: string): Promise<void> {
  await Browser.close();

  const parsedUrl = new URL(callbackUrl);
  const authCode = parsedUrl.searchParams.get('code');
  if (authCode) {
    const { error } = await supabase.auth.exchangeCodeForSession(authCode);
    if (error) throw error;
    return;
  }

  const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
  const accessToken = hashParams.get('access_token') ?? parsedUrl.searchParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token') ?? parsedUrl.searchParams.get('refresh_token');
  if (!accessToken || !refreshToken) {
    throw new Error('Google sign-in returned without Supabase session tokens.');
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
