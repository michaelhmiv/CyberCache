import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import type { GoogleLoginResponseOnline } from '@capgo/capacitor-social-login';
import { supabase } from './supabase/client';

export const GOOGLE_WEB_CLIENT_ID_ENV = 'VITE_GOOGLE_WEB_CLIENT_ID';

let initialized = false;

function debugNativeAuth(stage: string, details?: unknown) {
  if (!import.meta.env.DEV && import.meta.env.VITE_DEBUG_NATIVE_AUTH !== 'true') return;
  const payload = typeof details === 'object' ? JSON.stringify(details) : String(details);
  console.debug(`[native-auth] ${stage}${details !== undefined ? ': ' + payload : ''}`);
}

export function getGoogleWebClientId(env: ImportMetaEnv = import.meta.env): string {
  const webClientId = env.VITE_GOOGLE_WEB_CLIENT_ID?.trim();
  if (!webClientId) {
    throw new Error('Missing VITE_GOOGLE_WEB_CLIENT_ID. Use the Google Web OAuth client ID configured in Supabase.');
  }
  return webClientId;
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
  debugNativeAuth('initializeNativeAuth called', { isNative: Capacitor.isNativePlatform(), initialized });
  if (!Capacitor.isNativePlatform()) return;
  if (initialized) return;

  try {
    await SocialLogin.initialize({
      google: {
        webClientId: getGoogleWebClientId(),
        mode: 'online',
      },
    });
    initialized = true;
    debugNativeAuth('SocialLogin.initialize succeeded');
  } catch (error) {
    debugNativeAuth('SocialLogin.initialize failed', error);
    throw error;
  }
}

export async function signInWithGoogleNative(): Promise<void> {
  debugNativeAuth('signInWithGoogleNative called', { isNative: Capacitor.isNativePlatform() });

  if (!Capacitor.isNativePlatform()) {
    debugNativeAuth('falling back to web OAuth');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${globalThis.location.origin}/?auth=confirmed` },
    });
    if (error) throw error;
    return;
  }

  await initializeNativeAuth();
  debugNativeAuth('calling SocialLogin.login');

  let result;
  const rawNonce = generateNonce();
  const nonceDigest = await sha256Hex(rawNonce);
  debugNativeAuth('generated nonce', { rawNonceLength: rawNonce.length, nonceDigestLength: nonceDigest.length });

  try {
    result = await SocialLogin.login({
      provider: 'google',
      options: {
        nonce: nonceDigest,
      },
    });
    debugNativeAuth('SocialLogin.login succeeded', { provider: result.provider, responseType: result.result.responseType });
  } catch (error) {
    debugNativeAuth('SocialLogin.login failed', error);
    throw error;
  }

  if (result.result.responseType !== 'online') {
    const message = 'Google native sign-in returned an unexpected response type.';
    debugNativeAuth(message, { responseType: result.result.responseType });
    throw new Error(message);
  }

  const onlineResult = result.result as GoogleLoginResponseOnline;
  const idToken = onlineResult.idToken;
  debugNativeAuth('idToken present', { hasIdToken: Boolean(idToken) });

  if (!idToken) {
    throw new Error('Google native sign-in did not return an ID token.');
  }

  debugNativeAuth('calling supabase.auth.signInWithIdToken');
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    nonce: rawNonce,
  });

  if (error) {
    debugNativeAuth('supabase signInWithIdToken failed', error);
    throw error;
  }

  debugNativeAuth('supabase signInWithIdToken succeeded');
}
