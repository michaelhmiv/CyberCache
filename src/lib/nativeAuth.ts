import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import type { GoogleLoginResponseOnline } from '@capgo/capacitor-social-login';

export const GOOGLE_WEB_CLIENT_ID_ENV = 'VITE_GOOGLE_WEB_CLIENT_ID';
export const ANDROID_GOOGLE_SIGN_IN_BLOCKED_MESSAGE =
  'Google sign-in did not complete on Android. Verify the Google Cloud Android OAuth client uses package com.michaelhmiv.cybercache and the SHA-1 fingerprint for the exact installed build.';

export interface NativeAuthDiagnostic {
  stage: string;
  platform: string;
  isNative: boolean;
  webClientIdSuffix: string;
  packageName: string;
  expectedFirebaseSha1: string;
  rawError: Record<string, unknown>;
}

export interface NativeAuthDiagnosticError extends Error {
  nativeAuthDiagnostic?: NativeAuthDiagnostic;
}

const CYBERCACHE_ANDROID_PACKAGE = 'com.michaelhmiv.cybercache';
const FIREBASE_APP_DISTRIBUTION_SHA1 = '12:12:4F:DD:B8:5A:4D:9D:68:6B:09:58:05:1B:CB:9E:6C:0B:37:5B';

const SENSITIVE_KEY_PATTERN = /token|secret|credential|password|authorization|assertion/i;

let initialized = false;

function debugNativeAuth(stage: string, details?: unknown) {
  if (!import.meta.env.DEV && import.meta.env.VITE_DEBUG_NATIVE_AUTH !== 'true') return;
  const payload = typeof details === 'object' ? JSON.stringify(details) : String(details);
  console.debug(`[native-auth] ${stage}${details !== undefined ? ': ' + payload : ''}`);
}

function safeDiagnosticValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]';
  if (value instanceof Error) return serializeNativeAuthError(value);
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) return value.map((item, index) => safeDiagnosticValue(String(index), item));
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        safeDiagnosticValue(entryKey, entryValue),
      ]),
    );
  }
  return value;
}

export function serializeNativeAuthError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const ownEntries = Object.fromEntries(
      Object.getOwnPropertyNames(error)
        .filter((key) => key !== 'stack')
        .map((key) => [key, safeDiagnosticValue(key, (error as unknown as Record<string, unknown>)[key])]),
    );
    return {
      type: error.constructor.name,
      name: error.name,
      message: error.message,
      ...ownEntries,
    };
  }

  if (error && typeof error === 'object') {
    return Object.fromEntries(
      Object.entries(error as Record<string, unknown>).map(([key, value]) => [key, safeDiagnosticValue(key, value)]),
    );
  }

  return { value: String(error) };
}

function webClientIdSuffix(webClientId: string): string {
  const [clientPrefix, ...rest] = webClientId.split('-');
  return rest.length > 0 ? `${clientPrefix}-…` : 'unknown';
}

function createNativeAuthDiagnostic(stage: string, error: unknown): NativeAuthDiagnostic {
  let webClientId = 'missing';
  try {
    webClientId = getGoogleWebClientId();
  } catch {
    // The missing env itself will be surfaced by the thrown app error elsewhere.
  }

  return {
    stage,
    platform: Capacitor.getPlatform(),
    isNative: Capacitor.isNativePlatform(),
    webClientIdSuffix: webClientIdSuffix(webClientId),
    packageName: CYBERCACHE_ANDROID_PACKAGE,
    expectedFirebaseSha1: FIREBASE_APP_DISTRIBUTION_SHA1,
    rawError: serializeNativeAuthError(error),
  };
}

export function getGoogleWebClientId(env: ImportMetaEnv = import.meta.env): string {
  const webClientId = env.VITE_GOOGLE_WEB_CLIENT_ID?.trim();
  if (!webClientId) {
    throw new Error('Missing VITE_GOOGLE_WEB_CLIENT_ID. Use the Google Web OAuth client ID configured for the Chef.');
  }
  return webClientId;
}

export function toNativeGoogleSignInError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancelled by user/i.test(message)) {
    const diagnostic = createNativeAuthDiagnostic('SocialLogin.login', error);
    const wrapped = new Error(ANDROID_GOOGLE_SIGN_IN_BLOCKED_MESSAGE, { cause: error }) as NativeAuthDiagnosticError;
    wrapped.nativeAuthDiagnostic = diagnostic;
    return wrapped;
  }

  const normalized = (error instanceof Error ? error : new Error(message)) as NativeAuthDiagnosticError;
  normalized.nativeAuthDiagnostic = createNativeAuthDiagnostic('SocialLogin.login', error);
  return normalized;
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

/**
 * Obtain a Google ID token from the native sign-in flow (Route B,
 * slice B4). The token is verified server-side by the Chef
 * (POST /api/auth/google, B1.5) — the client no longer exchanges it
 * with Supabase. The hashed-nonce binding stays: Google binds the
 * token to this sign-in attempt via the nonce claim, and the Chef's
 * JWKS verification checks issuer/audience/expiry.
 *
 * Web has no equivalent flow: CyberCache is app-only (guest + Google
 * on Android, Apple later), and the old Supabase web-OAuth redirect
 * has no Chef counterpart, so non-native calls fail with a clear
 * message instead of a dead redirect.
 */
export async function getGoogleIdTokenNative(): Promise<string> {
  debugNativeAuth('getGoogleIdTokenNative called', { isNative: Capacitor.isNativePlatform() });

  if (!Capacitor.isNativePlatform()) {
    throw new Error('Google sign-in is only available in the CyberCache app.');
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
    throw toNativeGoogleSignInError(error);
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

  return idToken;
}
