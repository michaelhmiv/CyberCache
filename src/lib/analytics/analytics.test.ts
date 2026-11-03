/**
 * Analytics wrapper tests. The Firebase SDK is fully mocked — no
 * network, no real SDK calls — and the suite proves:
 *  - config resolution and the off states (unconfigured / disabled /
 *    unsupported / failed) are silent no-ops;
 *  - pre-init events queue and flush in order once ready;
 *  - every taxonomy function's event name + params;
 *  - the level / craft-completion / endless dedupe observers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({})),
  getAnalytics: vi.fn(() => ({})),
  logEvent: vi.fn(),
  setUserProperties: vi.fn(),
  setAnalyticsCollectionEnabled: vi.fn(),
  isSupported: vi.fn(async () => true),
}));

vi.mock('firebase/app', () => ({ initializeApp: sdk.initializeApp }));
vi.mock('firebase/analytics', () => ({
  getAnalytics: sdk.getAnalytics,
  logEvent: sdk.logEvent,
  setUserProperties: sdk.setUserProperties,
  setAnalyticsCollectionEnabled: sdk.setAnalyticsCollectionEnabled,
  isSupported: sdk.isSupported,
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

import {
  __resetAnalyticsForTests,
  analyticsStatus,
  initAnalytics,
  isAnalyticsDebugEnabled,
  isAnalyticsDisabledByConfig,
  levelBandFor,
  observePlayerLevel,
  resolveAnalyticsConfig,
  setAccountTypeProperty,
  trackBossAttempt,
  trackCacheOpen,
  trackCraftCompletions,
  trackCraftComplete,
  trackCraftQueue,
  trackEndlessRunEnd,
  trackEquip,
  trackGuestStart,
  trackMarketBuy,
  trackMarketList,
  trackRoamStart,
  trackRoamStop,
  trackSalvage,
  trackScreen,
  trackSignIn,
} from './analytics';

const FULL_ENV = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_PROJECT_ID: 'cybercache-29881',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
  VITE_FIREBASE_MEASUREMENT_ID: 'G-TEST123456',
} as unknown as ImportMetaEnv;

function stubFullEnv(extra: Record<string, string> = {}): void {
  for (const [key, value] of Object.entries({ ...FULL_ENV, ...extra } as Record<string, string>)) {
    vi.stubEnv(key, value);
  }
}

function stubEmptyEnv(): void {
  for (const key of Object.keys(FULL_ENV)) vi.stubEnv(key, '');
}

async function initToReady(): Promise<void> {
  initAnalytics();
  await vi.waitFor(() => expect(analyticsStatus()).toBe('ready'));
}

function loggedEvents(): Array<{ name: string; params: unknown }> {
  return sdk.logEvent.mock.calls.map((call) => ({ name: call[1] as string, params: call[2] }));
}

beforeEach(() => {
  __resetAnalyticsForTests();
  vi.clearAllMocks();
  sdk.isSupported.mockResolvedValue(true);
  sdk.initializeApp.mockImplementation(() => ({}));
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetAnalyticsForTests();
});

describe('config resolution', () => {
  it('returns the full config when every required value is present', () => {
    expect(resolveAnalyticsConfig(FULL_ENV)).toEqual({
      apiKey: 'test-api-key',
      projectId: 'cybercache-29881',
      appId: '1:123:web:abc',
      measurementId: 'G-TEST123456',
    });
  });

  it('includes optional values only when set', () => {
    const env = { ...FULL_ENV, VITE_FIREBASE_AUTH_DOMAIN: 'x.firebaseapp.com' } as unknown as ImportMetaEnv;
    expect(resolveAnalyticsConfig(env)?.authDomain).toBe('x.firebaseapp.com');
  });

  it('returns null when any required value is missing or blank', () => {
    for (const key of Object.keys(FULL_ENV)) {
      const env = { ...FULL_ENV, [key]: '  ' } as unknown as ImportMetaEnv;
      expect(resolveAnalyticsConfig(env)).toBeNull();
    }
    expect(resolveAnalyticsConfig({} as ImportMetaEnv)).toBeNull();
  });

  it('reads the kill switch case-insensitively', () => {
    expect(isAnalyticsDisabledByConfig({ VITE_ANALYTICS_ENABLED: 'false' } as unknown as ImportMetaEnv)).toBe(true);
    expect(isAnalyticsDisabledByConfig({ VITE_ANALYTICS_ENABLED: 'FALSE' } as unknown as ImportMetaEnv)).toBe(true);
    expect(isAnalyticsDisabledByConfig({ VITE_ANALYTICS_ENABLED: 'true' } as unknown as ImportMetaEnv)).toBe(false);
    expect(isAnalyticsDisabledByConfig({} as unknown as ImportMetaEnv)).toBe(false);
  });

  it('resolves the debug flag from env, dev mode, or the URL param', () => {
    expect(isAnalyticsDebugEnabled({ VITE_ANALYTICS_DEBUG: 'true' } as unknown as ImportMetaEnv, '')).toBe(true);
    expect(isAnalyticsDebugEnabled({ DEV: true } as unknown as ImportMetaEnv, '')).toBe(true);
    expect(isAnalyticsDebugEnabled({} as unknown as ImportMetaEnv, '?analytics_debug=1')).toBe(true);
    expect(isAnalyticsDebugEnabled({} as unknown as ImportMetaEnv, '?x=1&analytics_debug')).toBe(true);
    expect(isAnalyticsDebugEnabled({} as unknown as ImportMetaEnv, '?other=1')).toBe(false);
    expect(isAnalyticsDebugEnabled({} as unknown as ImportMetaEnv, '')).toBe(false);
  });

  it('bands levels at the documented boundaries', () => {
    expect(levelBandFor(1)).toBe('1-9');
    expect(levelBandFor(9)).toBe('1-9');
    expect(levelBandFor(10)).toBe('10-24');
    expect(levelBandFor(24)).toBe('10-24');
    expect(levelBandFor(25)).toBe('25-49');
    expect(levelBandFor(50)).toBe('50-74');
    expect(levelBandFor(75)).toBe('75-99');
    expect(levelBandFor(99)).toBe('75-99');
    expect(levelBandFor(100)).toBe('100+');
    expect(levelBandFor(140)).toBe('100+');
  });
});

describe('off states are silent no-ops', () => {
  it('unconfigured: init never touches the SDK and every event drops', () => {
    stubEmptyEnv();
    initAnalytics();
    expect(analyticsStatus()).toBe('unconfigured');
    trackGuestStart();
    trackSignIn('google');
    trackScreen('Home');
    trackSalvage(2);
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    expect(sdk.logEvent).not.toHaveBeenCalled();
  });

  it('disabled by config: init never touches the SDK even with a full config', () => {
    stubFullEnv({ VITE_ANALYTICS_ENABLED: 'false' });
    initAnalytics();
    expect(analyticsStatus()).toBe('disabled');
    trackRoamStart('rust_flats');
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    expect(sdk.logEvent).not.toHaveBeenCalled();
  });

  it('unsupported environment: SDK loads, reports unsupported, sends nothing', async () => {
    stubFullEnv();
    sdk.isSupported.mockResolvedValue(false);
    initAnalytics();
    await vi.waitFor(() => expect(analyticsStatus()).toBe('unsupported'));
    trackGuestStart();
    expect(sdk.getAnalytics).not.toHaveBeenCalled();
    expect(sdk.logEvent).not.toHaveBeenCalled();
  });

  it('init failure: status failed, a console warning, and no throw into callers', async () => {
    stubFullEnv();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sdk.initializeApp.mockImplementation(() => { throw new Error('boom'); });
    expect(() => initAnalytics()).not.toThrow();
    await vi.waitFor(() => expect(analyticsStatus()).toBe('failed'));
    expect(warn).toHaveBeenCalled();
    expect(() => trackGuestStart()).not.toThrow();
    expect(sdk.logEvent).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ready path', () => {
  it('initializes the SDK once with the resolved config and sets the platform property', async () => {
    stubFullEnv();
    await initToReady();
    initAnalytics();
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.initializeApp).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'test-api-key',
      projectId: 'cybercache-29881',
      appId: '1:123:web:abc',
      measurementId: 'G-TEST123456',
    }));
    expect(sdk.setUserProperties).toHaveBeenCalledWith(expect.anything(), { platform: 'web' });
  });

  it('queues pre-init events and flushes them in order once ready', async () => {
    stubFullEnv();
    trackGuestStart();
    trackSignIn('google');
    trackScreen('Home');
    await initToReady();
    const names = loggedEvents().map((e) => e.name);
    expect(names).toEqual(['guest_start', 'sign_in', 'screen_view']);
    expect(loggedEvents()[1].params).toEqual(expect.objectContaining({ method: 'google' }));
  });

  it('applies user properties set before init once ready', async () => {
    stubFullEnv();
    setAccountTypeProperty('guest');
    await initToReady();
    expect(sdk.setUserProperties).toHaveBeenCalledWith(expect.anything(), { account_type: 'guest' });
    setAccountTypeProperty('linked');
    expect(sdk.setUserProperties).toHaveBeenCalledWith(expect.anything(), { account_type: 'linked' });
  });
});

describe('taxonomy mapping', () => {
  beforeEach(async () => {
    stubFullEnv();
    await initToReady();
    sdk.logEvent.mockClear();
  });

  it('maps every event function to its snake_case name and typed params', () => {
    trackSignIn('email');
    trackGuestStart();
    trackRoamStart('rust_flats');
    trackRoamStop();
    trackBossAttempt('scrap_bishop', 'victory');
    trackCraftQueue('med_kit');
    trackCraftComplete('med_kit');
    trackMarketBuy('consumable');
    trackMarketList('material');
    trackCacheOpen('ad');
    trackSalvage(4);
    trackEquip('weapon');

    const events = loggedEvents();
    expect(events.map((e) => e.name)).toEqual([
      'sign_in', 'guest_start', 'roam_start', 'roam_stop', 'boss_attempt',
      'craft_queue', 'craft_complete', 'market_buy', 'market_list',
      'cache_open', 'salvage', 'equip',
    ]);
    const byName = Object.fromEntries(events.map((e) => [e.name, e.params]));
    expect(byName.sign_in).toEqual(expect.objectContaining({ method: 'email' }));
    expect(byName.roam_start).toEqual(expect.objectContaining({ area: 'rust_flats' }));
    expect(byName.boss_attempt).toEqual(expect.objectContaining({ boss: 'scrap_bishop', result: 'victory' }));
    expect(byName.craft_queue).toEqual(expect.objectContaining({ recipe: 'med_kit' }));
    expect(byName.craft_complete).toEqual(expect.objectContaining({ recipe: 'med_kit' }));
    expect(byName.market_buy).toEqual(expect.objectContaining({ kind: 'consumable' }));
    expect(byName.market_list).toEqual(expect.objectContaining({ kind: 'material' }));
    expect(byName.cache_open).toEqual(expect.objectContaining({ source: 'ad' }));
    expect(byName.salvage).toEqual(expect.objectContaining({ count: 4 }));
    expect(byName.equip).toEqual(expect.objectContaining({ slot: 'weapon' }));
  });

  it('suppresses non-positive salvage counts', () => {
    trackSalvage(0);
    trackSalvage(-2);
    expect(sdk.logEvent).not.toHaveBeenCalled();
  });

  it('dedupes consecutive screen views but not a return visit', () => {
    trackScreen('Workshop');
    trackScreen('Workshop');
    trackScreen('Gear');
    trackScreen('Workshop');
    const screens = loggedEvents().filter((e) => e.name === 'screen_view')
      .map((e) => (e.params as { screen_name: string }).screen_name);
    expect(screens).toEqual(['Workshop', 'Gear', 'Workshop']);
    expect(loggedEvents()[0].params).toEqual(expect.objectContaining({
      firebase_screen_name: 'Workshop',
      screen_name: 'Workshop',
    }));
  });
});

describe('level observer', () => {
  beforeEach(async () => {
    stubFullEnv();
    await initToReady();
    sdk.logEvent.mockClear();
    sdk.setUserProperties.mockClear();
  });

  it('treats the first observation as the baseline — no level_up for a restored account', () => {
    observePlayerLevel(40);
    expect(sdk.logEvent).not.toHaveBeenCalled();
    expect(sdk.setUserProperties).toHaveBeenCalledWith(expect.anything(), { level_band: '25-49' });
  });

  it('fires level_up once per increase and keeps the band current', () => {
    observePlayerLevel(12);
    observePlayerLevel(13);
    observePlayerLevel(13);
    observePlayerLevel(30);
    const ups = loggedEvents().filter((e) => e.name === 'level_up');
    expect(ups).toHaveLength(2);
    expect(ups[0].params).toEqual(expect.objectContaining({ level: 13 }));
    expect(ups[1].params).toEqual(expect.objectContaining({ level: 30 }));
    expect(sdk.setUserProperties).toHaveBeenCalledWith(expect.anything(), { level_band: '25-49' });
  });

  it('never fires level_up on a decrease', () => {
    observePlayerLevel(20);
    observePlayerLevel(5);
    expect(loggedEvents().filter((e) => e.name === 'level_up')).toHaveLength(0);
  });
});

describe('endless run observer', () => {
  beforeEach(async () => {
    stubFullEnv();
    await initToReady();
    sdk.logEvent.mockClear();
  });

  it('fires once per run id, however many settlement paths report it', () => {
    trackEndlessRunEnd('run-1', 12);
    trackEndlessRunEnd('run-1', 12);
    trackEndlessRunEnd('run-2', 3);
    const runs = loggedEvents().filter((e) => e.name === 'endless_run');
    expect(runs).toHaveLength(2);
    expect(runs[0].params).toEqual(expect.objectContaining({ depth: 12 }));
    expect(runs[1].params).toEqual(expect.objectContaining({ depth: 3 }));
  });

  it('ignores missing run ids and invalid depths', () => {
    trackEndlessRunEnd('', 5);
    trackEndlessRunEnd('run-x', -1);
    trackEndlessRunEnd('run-y', Number.NaN);
    expect(sdk.logEvent).not.toHaveBeenCalled();
  });
});

describe('craft completion observer', () => {
  const NOW = 1_730_000_000_000;

  beforeEach(async () => {
    stubFullEnv();
    await initToReady();
    sdk.logEvent.mockClear();
  });

  const job = (id: string, recipeId: string, state: 'running' | 'complete', completedAtMs: number | null = null) => ({
    id, recipeId, state, completedAtMs,
  });

  it('fires for a job seen active that later completes — exactly once', () => {
    trackCraftCompletions({ jobs: [job('a', 'med_kit', 'running')] }, NOW);
    trackCraftCompletions({ jobs: [job('a', 'med_kit', 'complete', NOW - 3_600_000)] }, NOW);
    trackCraftCompletions({ jobs: [job('a', 'med_kit', 'complete', NOW - 3_600_000)] }, NOW);
    const done = loggedEvents().filter((e) => e.name === 'craft_complete');
    expect(done).toHaveLength(1);
    expect(done[0].params).toEqual(expect.objectContaining({ recipe: 'med_kit' }));
  });

  it('fires for a first-seen completion inside the freshness window', () => {
    trackCraftCompletions({ jobs: [job('b', 'patch_kit', 'complete', NOW - 30_000)] }, NOW);
    expect(loggedEvents().filter((e) => e.name === 'craft_complete')).toHaveLength(1);
  });

  it('absorbs old first-seen completions silently (no login backlog replay)', () => {
    trackCraftCompletions({ jobs: [job('c', 'ammo_pack', 'complete', NOW - 7_200_000)] }, NOW);
    trackCraftCompletions({ jobs: [job('c', 'ammo_pack', 'complete', NOW - 7_200_000)] }, NOW);
    expect(loggedEvents().filter((e) => e.name === 'craft_complete')).toHaveLength(0);
  });

  it('fires for a seen-active job that only reappears in recentCompletions', () => {
    trackCraftCompletions({ jobs: [job('d', 'shield_cell', 'running')] }, NOW);
    trackCraftCompletions({ jobs: [], recentCompletions: [{ jobId: 'd', recipeId: 'shield_cell' }] }, NOW);
    trackCraftCompletions({ jobs: [], recentCompletions: [{ jobId: 'e', recipeId: 'horse' }] }, NOW);
    const done = loggedEvents().filter((e) => e.name === 'craft_complete');
    expect(done).toHaveLength(1);
    expect(done[0].params).toEqual(expect.objectContaining({ recipe: 'shield_cell' }));
  });
});
