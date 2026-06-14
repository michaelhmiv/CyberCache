import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import type { GoogleLoginResponseOnline } from '@capgo/capacitor-social-login';
import { supabase } from './supabase/client';

const WEB_CLIENT_ID = '334041849865-rdq6nu915phnd2nccqr8skkf4hnnkae6.apps.googleusercontent.com';

let initialized = false;

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export async function initializeNativeAuth(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (initialized) return;

  await SocialLogin.initialize({
    google: {
      webClientId: WEB_CLIENT_ID,
      mode: 'online',
    },
  });
  initialized = true;
}

export async function signInWithGoogleNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    // Fall back to the web-based OAuth flow on non-native platforms.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${globalThis.location.origin}/?auth=confirmed` },
    });
    if (error) throw error;
    return;
  }

  await initializeNativeAuth();

  const result = await SocialLogin.login({
    provider: 'google',
    options: {
      scopes: ['email', 'profile'],
    },
  });

  if (result.result.responseType !== 'online') {
    throw new Error('Google native sign-in returned an unexpected response type.');
  }

  const onlineResult = result.result as GoogleLoginResponseOnline;
  const idToken = onlineResult.idToken;
  if (!idToken) {
    throw new Error('Google native sign-in did not return an ID token.');
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) throw error;
}
