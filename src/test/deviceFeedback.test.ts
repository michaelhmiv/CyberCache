/**
 * Device-feedback fixes (2026-10-30, from Michael's first hands-on
 * pass on the Route B build):
 *
 *  1. Google sign-in 404 — covered in apiTransport.test.ts (exact
 *     pathname pin). Here: the auth UI and market/persistence shapes.
 *  2. Auth screen is Google + guest only — no email/password forms
 *     anywhere in the sign-in UI.
 *  3. Market: the NPC Vendor is open to guests; the player-market
 *     tabs stay behind the 'market' feature gate.
 *  4. Guest persistence: runtime display snapshots are mirrored to
 *     on-device storage on every save, flushed on the native pause
 *     lifecycle, and restored from the mirror when the server has
 *     no snapshot — so progress survives on the device itself.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const REPO = resolve(__dirname, '../..');
function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('device feedback — auth screen is Google + guest only', () => {
  const screen = readSource('src/screens/AuthScreen.tsx');

  it('offers Google and guest, and nothing else', () => {
    expect(screen).toContain('Continue with Google');
    expect(screen).toContain('Continue as Guest');
    expect(screen).not.toContain('authMode');
    expect(screen).not.toContain('registerWithEmail');
    expect(screen).not.toContain('signInWithEmail');
    expect(screen).not.toContain('type="password"');
    expect(screen).not.toContain('type="email"');
  });

  it('feature gates send guests to Google sign-in, not a register form', () => {
    // FeatureGate renders the shared SignInLockPrompt; the Google
    // upgrade path lives there now.
    const gate = readSource('src/auth/FeatureGate.tsx');
    const prompt = readSource('src/auth/SignInLockPrompt.tsx');
    expect(gate).toContain('SignInLockPrompt');
    expect(prompt).toContain('signInWithGoogle');
    expect(prompt).not.toContain("setAuthMode('register')");
    expect(prompt).not.toContain('Create Account');
  });
});

describe('device feedback — market vendor open to guests', () => {
  it('App no longer wraps the whole Market tab in the market gate', () => {
    const app = readSource('src/App.tsx');
    expect(app).not.toContain('<FeatureGate feature="market">');
  });

  it('MarketScreen renders every tab ungated; the lock sits on the transact actions', () => {
    const market = readSource('src/screens/MarketScreen.tsx');
    // Guest-visibility law (2026-11-01): no full-surface gate remains
    // in the market — guests see every tab with real data.
    expect(market).not.toContain('<FeatureGate');
    expect(market).toContain("market.activeTab === 'vendor' && <VendorScreen />");
    expect(market).toContain("activeTab === 'buy'");
    expect(market).toContain("activeTab === 'sell'");
    expect(market).toContain("activeTab === 'mylistings'");
    expect(market).toContain("activeTab === 'history'");
    // The transact lock is consulted at the actions, not the tabs.
    expect(market).toContain('useEconomyTransactLock');
    expect(market).toContain("guardTransact('buy'");
    expect(market).toContain("guardTransact('sell'");
    // No mount redirect bounces guests back to the vendor tab.
    expect(market).not.toContain("user.isAnonymous && market.activeTab !== 'vendor'");
  });
});

// --- persistence behavior -------------------------------------------------

const prefStore = vi.hoisted(() => new Map<string, string>());
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefStore.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { prefStore.set(key, value); },
    remove: async ({ key }: { key: string }) => { prefStore.delete(key); },
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: async () => ({ remove: async () => undefined }) },
}));

const serverSnapshot = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
const serverSave = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/api/runtimeStoreService', () => ({
  getRuntimeStoreSnapshot: async () => serverSnapshot.value,
  saveRuntimeStoreSnapshot: serverSave,
  clearRuntimeStoreSnapshot: async () => undefined,
}));

import {
  restoreRuntimeStoresFromSupabase,
  saveCurrentRuntimeStores,
  startRuntimeStorePersistence,
  stopRuntimeStorePersistence,
} from '@/store/runtimeSupabaseSync';
import { useIdleStore } from '@/store/slices/idleSlice';

const MIRROR_KEY = 'cybercache.runtime.snapshot.v1.user-local-1';

function snapshotWithArea(areaId: string): Record<string, unknown> {
  return {
    schemaVersion: 2,
    authority: 'display_hydration_only',
    idle: { selectedRoamingAreaId: areaId },
  };
}

describe('device feedback — local runtime snapshot mirror', () => {
  beforeEach(() => {
    prefStore.clear();
    serverSnapshot.value = null;
    serverSave.mockClear();
    stopRuntimeStorePersistence();
    useIdleStore.setState({ selectedRoamingAreaId: 'dustwaste' });
  });

  it('every save also writes the on-device mirror', async () => {
    startRuntimeStorePersistence('user-local-1');
    useIdleStore.setState({ selectedRoamingAreaId: 'emberfall' });
    await saveCurrentRuntimeStores('user-local-1');
    const raw = prefStore.get(MIRROR_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as { authority: string; idle: { selectedRoamingAreaId: string } };
    expect(parsed.authority).toBe('display_hydration_only');
    expect(parsed.idle.selectedRoamingAreaId).toBe('emberfall');
    expect(serverSave).toHaveBeenCalledTimes(1);
  });

  it('restore falls back to the device mirror when the server has none', async () => {
    prefStore.set(MIRROR_KEY, JSON.stringify(snapshotWithArea('voidmarket')));
    serverSnapshot.value = null;
    const restored = await restoreRuntimeStoresFromSupabase('user-local-1');
    expect(restored).toBe(true);
    expect(useIdleStore.getState().selectedRoamingAreaId).toBe('voidmarket');
  });

  it('server snapshot wins over the mirror and refreshes it', async () => {
    prefStore.set(MIRROR_KEY, JSON.stringify(snapshotWithArea('voidmarket')));
    serverSnapshot.value = snapshotWithArea('sunkenrelay');
    const restored = await restoreRuntimeStoresFromSupabase('user-local-1');
    expect(restored).toBe(true);
    expect(useIdleStore.getState().selectedRoamingAreaId).toBe('sunkenrelay');
    const parsed = JSON.parse(prefStore.get(MIRROR_KEY) as string) as { idle: { selectedRoamingAreaId: string } };
    expect(parsed.idle.selectedRoamingAreaId).toBe('sunkenrelay');
  });

  it('the pause-lifecycle flush is wired in the persistence starter', () => {
    const sync = readSource('src/store/runtimeSupabaseSync.ts');
    expect(sync).toContain("App.addListener('pause'");
    expect(sync).toContain("App.addListener('appStateChange'");
    expect(sync).toContain('cybercache.runtime.snapshot.v1.');
  });
});
