import { describe, expect, it } from 'vitest';
import {
  ANDROID_GOOGLE_SIGN_IN_BLOCKED_MESSAGE,
  getGoogleWebClientId,
  GOOGLE_WEB_CLIENT_ID_ENV,
  type NativeAuthDiagnosticError,
  serializeNativeAuthError,
  toNativeGoogleSignInError,
} from '../lib/nativeAuth';

describe('native auth config', () => {
  it('reads the Google web client id from Vite env', () => {
    const clientId = '123-example.apps.googleusercontent.com';
    expect(getGoogleWebClientId({ VITE_GOOGLE_WEB_CLIENT_ID: ` ${clientId} ` } as unknown as ImportMetaEnv)).toBe(clientId);
  });

  it('throws an actionable error when the Google web client id is missing', () => {
    expect(() => getGoogleWebClientId({} as ImportMetaEnv)).toThrow(GOOGLE_WEB_CLIENT_ID_ENV);
    expect(() => getGoogleWebClientId({ VITE_GOOGLE_WEB_CLIENT_ID: ' ' } as unknown as ImportMetaEnv)).toThrow(
      'Google Web OAuth client ID',
    );
  });

  it('rewrites Android cancellation errors to package and SHA setup guidance', () => {
    const original = new Error('Google Sign-In cancelled by user');
    const result = toNativeGoogleSignInError(original) as NativeAuthDiagnosticError;

    expect(result.message).toBe(ANDROID_GOOGLE_SIGN_IN_BLOCKED_MESSAGE);
    expect(result.cause).toBe(original);
    expect(result.nativeAuthDiagnostic).toMatchObject({
      stage: 'SocialLogin.login',
      packageName: 'com.michaelhmiv.cybercache',
      expectedFirebaseSha1: '12:12:4F:DD:B8:5A:4D:9D:68:6B:09:58:05:1B:CB:9E:6C:0B:37:5B',
      rawError: {
        message: 'Google Sign-In cancelled by user',
      },
    });
  });

  it('preserves non-cancellation Google sign-in errors', () => {
    const original = new Error('Google Sign-In failed: Client ID is not set');
    expect(toNativeGoogleSignInError(original)).toBe(original);
    expect((toNativeGoogleSignInError(original) as NativeAuthDiagnosticError).nativeAuthDiagnostic?.rawError).toMatchObject({
      message: 'Google Sign-In failed: Client ID is not set',
    });
  });

  it('redacts token-like fields from native auth diagnostics', () => {
    const serialized = serializeNativeAuthError({
      message: 'failed',
      idToken: 'secret-id-token',
      nested: { credential: 'secret-credential', statusCode: 10 },
    });

    expect(serialized).toEqual({
      message: 'failed',
      idToken: '[redacted]',
      nested: { credential: '[redacted]', statusCode: 10 },
    });
  });
});
