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
