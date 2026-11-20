/**
 * Rewarded ad modules — consent failure is not fatal (owner
 * device hit, 2026-11-18; see rewardedAdErrorSurface.test.tsx
 * for the full story and the surface-level pins).
 *
 * The AdMob plugin + Capacitor are mocked; the ad modules are
 * re-imported per test so their `initialized` latch starts
 * closed. Pins:
 *  - the UMP consent step is best-effort in BOTH modules: its
 *    failure (e.g. the publisher-misconfiguration error a
 *    form-less account produces) is logged and the ad attempt
 *    still runs;
 *  - the consent success path is unchanged (REQUIRED shows the
 *    form once, then the ad);
 *  - an ad-step failure (prepare / show) still rejects — the
 *    surface, not the module, owns the player-facing wording.
 *
 * Show-settlement pins (owner device hit, 2026-11-19 — the
 * cache-open button looked completely dead): the real plugin's
 * showRewardVideoAd() resolves ONLY on reward-earned and NEVER
 * rejects on dismissal — dismiss / fail-to-show arrive as the
 * onRewardedVideoAdDismissed / onRewardedVideoAdFailedToShow
 * listener events, and without a listener the show call hangs
 * forever. The mocks below therefore model the plugin as it
 * actually behaves (a listener registry + a show call that can
 * stay pending), and the pins are:
 *  - dismiss settles the attempt as a failure (both lanes);
 *  - fail-to-show settles the attempt as a failure (both lanes);
 *  - a reward still resolves as success, and a dismissal that
 *    arrives after it (the rewarded view closing) changes
 *    nothing; a reward arriving after a dismissal likewise
 *    cannot unsettle the failure;
 *  - every registered listener is removed on settlement;
 *  - a show attempt that never settles is failed by the
 *    presentation timeout backstop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The exact string the owner was shown on device.
const SDK_ERROR_MESSAGE =
  "Publisher misconfiguration: Failed to read publisher's account configuration; no form(s) configured for the input app ID. Verify that you have configured one or more forms for this application and try again. Received app ID: ca-app-pub-2708638041809482~7527406300";

const TEST_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

// ---------------------------------------------------------------------------
// Module level: the AdMob plugin + Capacitor are mocked; the ad
// modules are re-imported per test so their `initialized` latch
// starts closed.
// ---------------------------------------------------------------------------

const plugin = vi.hoisted(() => ({
  initialize: vi.fn(),
  requestConsentInfo: vi.fn(),
  showConsentForm: vi.fn(),
  prepareRewardVideoAd: vi.fn(),
  showRewardVideoAd: vi.fn(),
  addListener: vi.fn(),
  // The plugin's listener registry, as the native side keeps it:
  // addListener registers, the handle's remove() unregisters, and
  // terminal outcomes arrive via emitPluginEvent below.
  listeners: new Map<string, Set<() => void>>(),
  handles: [] as Array<{ remove: ReturnType<typeof vi.fn> }>,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
  },
}));

vi.mock('@capacitor-community/admob', () => ({
  AdMob: plugin,
  AdmobConsentStatus: {
    NOT_REQUIRED: 'NOT_REQUIRED',
    OBTAINED: 'OBTAINED',
    REQUIRED: 'REQUIRED',
    UNKNOWN: 'UNKNOWN',
  },
  RewardAdPluginEvents: {
    Loaded: 'onRewardedVideoAdLoaded',
    FailedToLoad: 'onRewardedVideoAdFailedToLoad',
    Showed: 'onRewardedVideoAdShowed',
    FailedToShow: 'onRewardedVideoAdFailedToShow',
    Dismissed: 'onRewardedVideoAdDismissed',
    Rewarded: 'onRewardedVideoAdReward',
  },
}));

function armPluginHappyPath() {
  plugin.initialize.mockResolvedValue(undefined);
  plugin.requestConsentInfo.mockResolvedValue({ canRequestAds: true, status: 'NOT_REQUIRED' });
  plugin.showConsentForm.mockResolvedValue(undefined);
  plugin.prepareRewardVideoAd.mockResolvedValue(undefined);
  plugin.showRewardVideoAd.mockResolvedValue({ amount: 1, type: 'cache_box' });
  plugin.listeners.clear();
  plugin.handles.length = 0;
  plugin.addListener.mockImplementation((eventName: string, listener: () => void) => {
    const handle = {
      remove: vi.fn(async () => {
        plugin.listeners.get(eventName)?.delete(listener);
      }),
    };
    plugin.handles.push(handle);
    const set = plugin.listeners.get(eventName) ?? new Set<() => void>();
    set.add(listener);
    plugin.listeners.set(eventName, set);
    return Promise.resolve(handle);
  });
}

/** Fire a plugin listener event the way the native side does. */
function emitPluginEvent(eventName: string) {
  plugin.listeners.get(eventName)?.forEach((listener) => listener());
}

/** Every listener the attempt registered was removed exactly once. */
function expectAllListenersRemoved() {
  expect(plugin.handles.length).toBeGreaterThan(0);
  for (const handle of plugin.handles) {
    expect(handle.remove).toHaveBeenCalledTimes(1);
  }
  expect(plugin.listeners.get('onRewardedVideoAdDismissed')?.size ?? 0).toBe(0);
  expect(plugin.listeners.get('onRewardedVideoAdFailedToShow')?.size ?? 0).toBe(0);
}

describe('rewarded ad modules — consent failure is not fatal', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    armPluginHappyPath();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cache lane: a rejected consent-info request (the publisher-misconfiguration error) still runs the ad', async () => {
    plugin.requestConsentInfo.mockRejectedValue(new Error(SDK_ERROR_MESSAGE));
    const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');

    const result = await showRewardedCacheAd('user-1');

    expect(plugin.prepareRewardVideoAd).toHaveBeenCalledTimes(1);
    expect(plugin.showRewardVideoAd).toHaveBeenCalledTimes(1);
    expect(plugin.showConsentForm).not.toHaveBeenCalled();
    expect(result).toEqual({ adUnitId: TEST_AD_UNIT_ID, rewardAmount: 1, rewardType: 'cache_box' });
  });

  it('cache lane: a rejected consent form (status REQUIRED) still runs the ad', async () => {
    plugin.requestConsentInfo.mockResolvedValue({ canRequestAds: false, status: 'REQUIRED' });
    plugin.showConsentForm.mockRejectedValue(new Error(SDK_ERROR_MESSAGE));
    const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');

    const result = await showRewardedCacheAd('user-1');

    expect(plugin.showConsentForm).toHaveBeenCalledTimes(1);
    expect(plugin.showRewardVideoAd).toHaveBeenCalledTimes(1);
    expect(result.adUnitId).toBe(TEST_AD_UNIT_ID);
  });

  it('cache lane: consent success path unchanged — REQUIRED shows the form once, then the ad', async () => {
    plugin.requestConsentInfo.mockResolvedValue({ canRequestAds: false, status: 'REQUIRED' });
    const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');

    await showRewardedCacheAd('user-1');

    expect(plugin.showConsentForm).toHaveBeenCalledTimes(1);
    expect(plugin.showRewardVideoAd).toHaveBeenCalledTimes(1);
  });

  it('cache lane: an ad load failure still rejects (the surface owns the wording)', async () => {
    plugin.prepareRewardVideoAd.mockRejectedValue(new Error(SDK_ERROR_MESSAGE));
    const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');

    await expect(showRewardedCacheAd('user-1')).rejects.toThrow();
    expect(plugin.showRewardVideoAd).not.toHaveBeenCalled();
  });

  it('cache lane: a rejection from the show call itself still rejects (the settlement race forwards it)', async () => {
    // Defensive only: the real plugin never rejects the show
    // call (dismissal is an event, pinned in the settlement
    // suite below) — but if it ever did, the attempt must still
    // reject rather than hang or swallow it.
    plugin.showRewardVideoAd.mockRejectedValue(new Error('show call blew up'));
    const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');

    await expect(showRewardedCacheAd('user-1')).rejects.toThrow('show call blew up');
    expectAllListenersRemoved();
  });

  it('bench lane: a rejected consent-info request still runs the ad', async () => {
    plugin.requestConsentInfo.mockRejectedValue(new Error(SDK_ERROR_MESSAGE));
    plugin.showRewardVideoAd.mockResolvedValue({ amount: 1, type: 'bench_time' });
    const { showRewardedBenchTimeAd } = await import('@/lib/ads/rewardedBenchTimeAd');

    const result = await showRewardedBenchTimeAd('user-1');

    expect(plugin.showRewardVideoAd).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ adUnitId: TEST_AD_UNIT_ID, rewardAmount: 1, rewardType: 'bench_time' });
  });
});

describe('rewarded ad modules — every show outcome settles', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    armPluginHappyPath();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cache lane: dismissal settles the attempt as a failure — the show call itself never settles', async () => {
    // The real plugin on dismissal: the show call stays pending
    // forever and only the Dismissed event fires. Before the
    // settlement race, this await hung forever and the surface's
    // notice never appeared.
    plugin.showRewardVideoAd.mockReturnValue(new Promise(() => {}));
    const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');

    const attempt = showRewardedCacheAd('user-1');
    const rejection = expect(attempt).rejects.toThrow('dismissed');
    await vi.waitFor(() => expect(plugin.showRewardVideoAd).toHaveBeenCalledTimes(1));
    emitPluginEvent('onRewardedVideoAdDismissed');

    await rejection;
    expectAllListenersRemoved();
  });

  it('cache lane: fail-to-show settles the attempt as a failure', async () => {
    plugin.showRewardVideoAd.mockReturnValue(new Promise(() => {}));
    const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');

    const attempt = showRewardedCacheAd('user-1');
    const rejection = expect(attempt).rejects.toThrow('failed to show');
    await vi.waitFor(() => expect(plugin.showRewardVideoAd).toHaveBeenCalledTimes(1));
    emitPluginEvent('onRewardedVideoAdFailedToShow');

    await rejection;
    expectAllListenersRemoved();
  });

  it('bench lane: dismissal settles the attempt as a failure', async () => {
    plugin.showRewardVideoAd.mockReturnValue(new Promise(() => {}));
    const { showRewardedBenchTimeAd } = await import('@/lib/ads/rewardedBenchTimeAd');

    const attempt = showRewardedBenchTimeAd('user-1');
    const rejection = expect(attempt).rejects.toThrow('dismissed');
    await vi.waitFor(() => expect(plugin.showRewardVideoAd).toHaveBeenCalledTimes(1));
    emitPluginEvent('onRewardedVideoAdDismissed');

    await rejection;
    expectAllListenersRemoved();
  });

  it('bench lane: fail-to-show settles the attempt as a failure', async () => {
    plugin.showRewardVideoAd.mockReturnValue(new Promise(() => {}));
    const { showRewardedBenchTimeAd } = await import('@/lib/ads/rewardedBenchTimeAd');

    const attempt = showRewardedBenchTimeAd('user-1');
    const rejection = expect(attempt).rejects.toThrow('failed to show');
    await vi.waitFor(() => expect(plugin.showRewardVideoAd).toHaveBeenCalledTimes(1));
    emitPluginEvent('onRewardedVideoAdFailedToShow');

    await rejection;
    expectAllListenersRemoved();
  });

  it('cache lane: a reward resolves as success, and the dismissal that follows the rewarded view closing changes nothing', async () => {
    // Real plugin ordering: the show call resolves at reward
    // time; Dismissed fires afterwards when the view closes.
    // By then the listeners are already removed, so the late
    // event is inert.
    const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');

    const result = await showRewardedCacheAd('user-1');
    emitPluginEvent('onRewardedVideoAdDismissed');

    expect(result).toEqual({ adUnitId: TEST_AD_UNIT_ID, rewardAmount: 1, rewardType: 'cache_box' });
    expectAllListenersRemoved();
  });

  it('cache lane: a reward arriving after a dismissal cannot unsettle the failure', async () => {
    let resolveShow: (reward: { amount: number; type: string }) => void = () => {};
    plugin.showRewardVideoAd.mockReturnValue(
      new Promise((resolve) => {
        resolveShow = resolve;
      }),
    );
    const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');

    const attempt = showRewardedCacheAd('user-1');
    const rejection = expect(attempt).rejects.toThrow('dismissed');
    await vi.waitFor(() => expect(plugin.showRewardVideoAd).toHaveBeenCalledTimes(1));
    emitPluginEvent('onRewardedVideoAdDismissed');
    resolveShow({ amount: 1, type: 'cache_box' });

    await rejection;
    expectAllListenersRemoved();
  });

  it('cache lane: a show attempt that never settles is failed by the timeout backstop', async () => {
    vi.useFakeTimers();
    try {
      plugin.showRewardVideoAd.mockReturnValue(new Promise(() => {}));
      const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');
      const { REWARDED_AD_ATTEMPT_TIMEOUT_MS } = await import('@/lib/ads/rewardedAdPresentation');

      const attempt = showRewardedCacheAd('user-1');
      const rejection = expect(attempt).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(REWARDED_AD_ATTEMPT_TIMEOUT_MS);

      await rejection;
      expectAllListenersRemoved();
    } finally {
      vi.useRealTimers();
    }
  });
});

