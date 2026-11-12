import { describe, expect, it } from 'vitest';
import {
  CYBERCACHE_PRODUCTION_API_BASE,
  resolveChefBase,
} from '@/lib/chef/chefClient';

describe('Chef API base resolution', () => {
  it('uses explicit VITE_CHEF_URL first and normalizes trailing slashes', () => {
    expect(resolveChefBase({
      viteChefUrl: 'https://custom-chef.example.com///',
      isNativePlatform: true,
      windowOrigin: 'http://localhost',
    })).toBe('https://custom-chef.example.com');
  });

  it('routes native Capacitor builds to the Railway Chef service, not the local WebView origin', () => {
    expect(resolveChefBase({
      viteChefUrl: '',
      isNativePlatform: true,
      windowOrigin: 'http://localhost',
    })).toBe(CYBERCACHE_PRODUCTION_API_BASE);

    expect(resolveChefBase({
      viteChefUrl: '',
      isNativePlatform: true,
      windowOrigin: 'capacitor://localhost',
    })).toBe(CYBERCACHE_PRODUCTION_API_BASE);
  });

  it('resolves localhost previews same-origin on every port — never to the production Chef (audit H-01)', () => {
    // The audit played a local preview on port 4731 whose guest sign-in
    // POSTed straight to the production Chef. The tripwire: for any
    // localhost origin without an explicit VITE_CHEF_URL, the resolved base
    // is the served origin itself, so /api/* lands on whatever serves the
    // preview (relay/stub/local server) — never the live economy.
    for (const origin of ['http://127.0.0.1:5173', 'http://localhost:4731', 'http://127.0.0.1:3000', 'http://localhost:3000']) {
      expect(resolveChefBase({
        viteChefUrl: '',
        isNativePlatform: false,
        windowOrigin: origin,
      })).toBe(origin);
    }
    // The deliberate way to aim a local UI at a real Chef still exists:
    // the explicit env override wins over the localhost origin.
    expect(resolveChefBase({
      viteChefUrl: 'https://cybercache-staging-chef-production.up.railway.app',
      isNativePlatform: false,
      windowOrigin: 'http://127.0.0.1:5173',
    })).toBe('https://cybercache-staging-chef-production.up.railway.app');
  });

  it('keeps hosted browser builds same-origin so Railway serves /api routes', () => {
    expect(resolveChefBase({
      viteChefUrl: '',
      isNativePlatform: false,
      windowOrigin: 'https://cybercache-production.up.railway.app/',
    })).toBe('https://cybercache-production.up.railway.app');
  });

  it('returns an empty base only for non-native SSR/test contexts with no origin', () => {
    expect(resolveChefBase({
      viteChefUrl: '',
      isNativePlatform: false,
      windowOrigin: '',
    })).toBe('');
  });
});
