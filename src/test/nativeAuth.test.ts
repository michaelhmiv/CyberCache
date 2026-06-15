import { describe, expect, it } from 'vitest';
import {
  ANDROID_GOOGLE_SIGN_IN_BLOCKED_MESSAGE,
  getGoogleWebClientId,
  GOOGLE_WEB_CLIENT_ID_ENV,
  toNativeGoogleSignInError,
} from '../lib/nativeAuth';

describe('native auth config', () => {
  it('reads the Google web client id from Vite env', () => {
    const clientId = '123-example.apps.googleusercontent.com';
    expect(getGoogleWebClientId({ VITE_GOOGLE_WEB_CLIENT_ID: ` ${clientId} ` } as ImportMetaEnv)).toBe(clientId);
  });

  it('throws an actionable error when the Google web client id is missing', () => {
    expect(() => getGoogleWebClientId({} as ImportMetaEnv)).toThrow(GOOGLE_WEB_CLIENT_ID_ENV);
    expect(() => getGoogleWebClientId({ VITE_GOOGLE_WEB_CLIENT_ID: ' ' } as ImportMetaEnv)).toThrow(
      'Google Web OAuth client ID',
    );
  });

  it('rewrites Android cancellation errors to package and SHA setup guidance', () => {
    const original = new Error('Google Sign-In cancelled by user');
    const result = toNativeGoogleSignInError(original);

    expect(result.message).toBe(ANDROID_GOOGLE_SIGN_IN_BLOCKED_MESSAGE);
    expect(result.cause).toBe(original);
  });

  it('preserves non-cancellation Google sign-in errors', () => {
    const original = new Error('Google Sign-In failed: Client ID is not set');
    expect(toNativeGoogleSignInError(original)).toBe(original);
  });
});
