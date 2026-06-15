import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import type { GoogleLoginResponseOnline } from '@capgo/capacitor-social-login';
import type { LoginOptions } from '@capgo/capacitor-social-login/dist/esm/definitions';
import { supabase } from './supabase/client';

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
    throw new Error('Missing VITE_GOOGLE_WEB_CLIENT_ID. Use the Google Web OAuth client ID configured in Supabase.');
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

export function isGoogleAccountReauthFailure(error: unknown): boolean {
  const serialized = serializeNativeAuthError(error);
  const message = String(serialized.message ?? serialized.value ?? '');
  return /Account reauth failed/i.test(message) || /\[16\]/.test(message);
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

  const rawNonce = generateNonce();
  const nonceDigest = await sha256Hex(rawNonce);
  debugNativeAuth('generated nonce', { rawNonceLength: rawNonce.length, nonceDigestLength: nonceDigest.length });

  async function loginWithGoogleCredentialManager(style: 'bottom' | 'standard') {
    // Capgo's Android implementation reads nonce from the top-level PluginCall data
    // (`config.optString("nonce")`), but its TypeScript definition only exposes
    // GoogleLoginOptions under `options`. Keep this narrow cast until upstream types
    // include the Android nonce shape.
    const loginPayload = {
      provider: 'google',
      nonce: nonceDigest,
      options:
        style === 'bottom'
          ? {
              style: 'bottom',
              filterByAuthorizedAccounts: false,
              autoSelectEnabled: false,
              forcePrompt: true,
            }
          : {},
    } as unknown as Extract<LoginOptions, { provider: 'google' }>;
    return SocialLogin.login(loginPayload);
  }

  let result;

  try {
    result = await loginWithGoogleCredentialManager('bottom');
    debugNativeAuth('SocialLogin.login succeeded', { provider: result.provider, responseType: result.result.responseType });
  } catch (error) {
    if (!isGoogleAccountReauthFailure(error)) {
      debugNativeAuth('SocialLogin.login failed', error);
      throw toNativeGoogleSignInError(error);
    }

    debugNativeAuth('Google account reauth failed; clearing credential state and retrying standard UI', error);
    try {
      await SocialLogin.logout({ provider: 'google' });
    } catch (logoutError) {
      debugNativeAuth('SocialLogin.logout before retry failed; continuing with standard retry', logoutError);
    }

    try {
      result = await loginWithGoogleCredentialManager('standard');
      debugNativeAuth('SocialLogin.login standard retry succeeded', {
        provider: result.provider,
        responseType: result.result.responseType,
      });
    } catch (retryError) {
      debugNativeAuth('SocialLogin.login standard retry failed', retryError);
      throw toNativeGoogleSignInError(retryError);
    }
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
