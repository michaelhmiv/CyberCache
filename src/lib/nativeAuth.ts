import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import type { GoogleLoginResponseOnline } from '@capgo/capacitor-social-login';
import { supabase } from './supabase/client';

const WEB_CLIENT_ID = '334041849865-rdq6nu915phnd2nccqr8skkf4hnnkae6.apps.googleusercontent.com';

let initialized = false;

function log(stage: string, details?: unknown) {
  const payload = typeof details === 'object' ? JSON.stringify(details) : String(details);
  console.log(`[native-auth] ${stage}${details !== undefined ? ': ' + payload : ''}`);
}

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export async function initializeNativeAuth(): Promise<void> {
  log('initializeNativeAuth called', { isNative: Capacitor.isNativePlatform(), initialized });
  if (!Capacitor.isNativePlatform()) return;
  if (initialized) return;

  try {
    await SocialLogin.initialize({
      google: {
        webClientId: WEB_CLIENT_ID,
        mode: 'online',
      },
    });
    initialized = true;
    log('SocialLogin.initialize succeeded');
  } catch (error) {
    log('SocialLogin.initialize failed', error);
    throw error;
  }
}

export async function signInWithGoogleNative(): Promise<void> {
  log('signInWithGoogleNative called', { isNative: Capacitor.isNativePlatform() });

  if (!Capacitor.isNativePlatform()) {
    log('falling back to web OAuth');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${globalThis.location.origin}/?auth=confirmed` },
    });
    if (error) throw error;
    return;
  }

  await initializeNativeAuth();
  log('calling SocialLogin.login');

  let result;
  try {
    result = await SocialLogin.login({
      provider: 'google',
      options: {},
    });
    log('SocialLogin.login succeeded', { provider: result.provider, responseType: result.result.responseType });
  } catch (error) {
    log('SocialLogin.login failed', error);
    throw error;
  }

  if (result.result.responseType !== 'online') {
    const message = 'Google native sign-in returned an unexpected response type.';
    log(message, { responseType: result.result.responseType });
    throw new Error(message);
  }

  const onlineResult = result.result as GoogleLoginResponseOnline;
  const idToken = onlineResult.idToken;
  log('idToken present', { hasIdToken: Boolean(idToken), profile: onlineResult.profile });

  if (!idToken) {
    throw new Error('Google native sign-in did not return an ID token.');
  }

  log('calling supabase.auth.signInWithIdToken');
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) {
    log('supabase signInWithIdToken failed', error);
    throw error;
  }

  log('supabase signInWithIdToken succeeded');
}
