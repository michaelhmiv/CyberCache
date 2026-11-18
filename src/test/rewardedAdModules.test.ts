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
}));

function armPluginHappyPath() {
  plugin.initialize.mockResolvedValue(undefined);
  plugin.requestConsentInfo.mockResolvedValue({ canRequestAds: true, status: 'NOT_REQUIRED' });
  plugin.showConsentForm.mockResolvedValue(undefined);
  plugin.prepareRewardVideoAd.mockResolvedValue(undefined);
  plugin.showRewardVideoAd.mockResolvedValue({ amount: 1, type: 'cache_box' });
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

  it('cache lane: an ad show failure still rejects', async () => {
    plugin.showRewardVideoAd.mockRejectedValue(new Error('The ad was dismissed before the reward was earned.'));
    const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');

    await expect(showRewardedCacheAd('user-1')).rejects.toThrow();
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

