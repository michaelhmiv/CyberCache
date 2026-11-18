/**
 * Sign in with Apple — client half (iOS launch, Track 3).
 *
 * The Apple twin of the Google native flow: iOS-only, one shared
 * SocialLogin surface, the identity token handed to the Chef
 * (POST /api/auth/apple) for verification. Android and web refuse
 * with a clear message — Apple sign-in is offered nowhere else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ value: 'ios' as string, native: true }));
const socialLogin = vi.hoisted(() => ({
  initialize: vi.fn(async (_opts: unknown) => undefined),
  login: vi.fn(async (_opts: unknown) => ({
    provider: 'apple' as const,
    result: {
      idToken: 'apple-identity-token',
      accessToken: null,
      profile: { user: 'apple-sub-001', email: 'player@icloud.com', givenName: null, familyName: null },
    },
  })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platform.value,
    isNativePlatform: () => platform.native,
  },
}));

vi.mock('@capgo/capacitor-social-login', () => ({
  SocialLogin: socialLogin,
}));

async function loadNativeAuth() {
  vi.resetModules();
  return import('../lib/nativeAuth');
}

describe('getAppleIdTokenNative', () => {
  beforeEach(() => {
    platform.value = 'ios';
    platform.native = true;
    socialLogin.initialize.mockClear();
    socialLogin.login.mockClear();
    vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', 'test-web-client-id.apps.googleusercontent.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the identity token on iOS and initializes the Apple provider', async () => {
    const { getAppleIdTokenNative } = await loadNativeAuth();
    await expect(getAppleIdTokenNative()).resolves.toBe('apple-identity-token');
    expect(socialLogin.initialize).toHaveBeenCalledTimes(1);
    const initArg = socialLogin.initialize.mock.calls[0]?.[0] as {
      google?: unknown;
      apple?: { redirectUrl?: string };
    };
    expect(initArg.google).toMatchObject({ mode: 'online' });
    expect(initArg.apple).toEqual({ redirectUrl: '' });
    const loginArg = socialLogin.login.mock.calls[0]?.[0] as {
      provider: string;
      options: { nonce?: string; scopes?: string[] };
    };
    expect(loginArg.provider).toBe('apple');
    expect(loginArg.options.scopes).toEqual(['name', 'email']);
    expect(typeof loginArg.options.nonce).toBe('string');
    expect(loginArg.options.nonce?.length).toBeGreaterThan(0);
  });

  it('refuses on Android — Google only there — without touching the plugin', async () => {
    platform.value = 'android';
    const { getAppleIdTokenNative } = await loadNativeAuth();
    await expect(getAppleIdTokenNative()).rejects.toThrow('only available in the CyberCache app on iOS');
    expect(socialLogin.login).not.toHaveBeenCalled();
  });

  it('refuses on web (guest preview) without touching the plugin', async () => {
    platform.value = 'web';
    platform.native = false;
    const { getAppleIdTokenNative } = await loadNativeAuth();
    await expect(getAppleIdTokenNative()).rejects.toThrow('only available in the CyberCache app on iOS');
    expect(socialLogin.login).not.toHaveBeenCalled();
  });

  it('maps a user cancellation to a plain message with the diagnostic attached', async () => {
    socialLogin.login.mockRejectedValueOnce(new Error('The user canceled the sign-in flow'));
    const { getAppleIdTokenNative } = await loadNativeAuth();
    const err = await getAppleIdTokenNative().catch((e: unknown) => e) as Error & {
      nativeAuthDiagnostic?: { stage: string };
    };
    expect(err.message).toBe('Sign in with Apple was cancelled.');
    expect(err.nativeAuthDiagnostic?.stage).toBe('SocialLogin.login.apple');
  });

  it('fails clearly when the plugin returns no identity token', async () => {
    socialLogin.login.mockResolvedValueOnce({
      provider: 'apple' as const,
      result: {
        idToken: null,
        accessToken: null,
        profile: { user: 'apple-sub-001', email: null, givenName: null, familyName: null },
      },
    } as never);
    const { getAppleIdTokenNative } = await loadNativeAuth();
    await expect(getAppleIdTokenNative()).rejects.toThrow('did not return an identity token');
  });
});
