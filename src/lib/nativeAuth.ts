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

function generateNonce(): string {
  const array = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // Fallback for environments without crypto.subtle (unlikely in Capacitor webview)
  throw new Error('SHA-256 not available in this environment.');
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
  const rawNonce = generateNonce();
  const nonceDigest = await sha256Hex(rawNonce);
  log('generated nonce', { rawNonceLength: rawNonce.length, nonceDigestLength: nonceDigest.length });

  try {
    result = await SocialLogin.login({
      provider: 'google',
      options: {
        nonce: nonceDigest,
      },
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
    nonce: rawNonce,
  });

  if (error) {
    log('supabase signInWithIdToken failed', error);
    throw error;
  }

  log('supabase signInWithIdToken succeeded');
}
