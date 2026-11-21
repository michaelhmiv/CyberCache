/**
 * App Tracking Transparency in the shared rewarded presentation
 * path (Build 7 — Guideline 5.1.2(i); owner ruling 2026-11-19:
 * personalized ads stay ON with consent).
 *
 * The AdMob plugin + Capacitor are mocked; modules are
 * re-imported per test so the session latch in
 * rewardedAdPresentation starts open. The plugin mock models
 * the real @capacitor-community/admob 8.0.0 ATT surface:
 * trackingAuthorizationStatus() resolves { status } and
 * requestTrackingAuthorization() resolves VOID (the prompt) —
 * the outcome is learned by re-reading the status.
 *
 * Pins:
 *  - iOS, undetermined → prompt → authorized: the request goes
 *    out untouched (personalized, the same options object);
 *  - iOS, undetermined → prompt → denied: the request carries
 *    npa: true (non-personalized), other fields preserved;
 *  - iOS, already denied / restricted: NO prompt is shown and
 *    the request carries npa: true;
 *  - iOS, the ATT call itself fails: the ad still runs,
 *    non-personalized (fail closed, never blocked);
 *  - Android and web: no ATT call is ever made and the request
 *    is the exact object the lane built;
 *  - a second ad in the same session reuses the determination:
 *    no second prompt, no second status resolution;
 *  - both lanes inherit all of this through the shared path
 *    (one iOS denied pin per lane).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

const platformState = vi.hoisted(() => ({ value: 'ios' }));

const plugin = vi.hoisted(() => ({
  initialize: vi.fn(),
  requestConsentInfo: vi.fn(),
  showConsentForm: vi.fn(),
  prepareRewardVideoAd: vi.fn(),
  showRewardVideoAd: vi.fn(),
  addListener: vi.fn(),
  trackingAuthorizationStatus: vi.fn(),
  requestTrackingAuthorization: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platformState.value !== 'web',
    isPluginAvailable: () => true,
    getPlatform: () => platformState.value,
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

type AttStatus = 'authorized' | 'denied' | 'notDetermined' | 'restricted';

/** Status reads return `before` until the prompt runs, then `after`. */
function armAtt(before: AttStatus, after?: AttStatus) {
  plugin.trackingAuthorizationStatus.mockResolvedValue({ status: before });
  plugin.requestTrackingAuthorization.mockImplementation(async () => {
    if (after !== undefined) {
      plugin.trackingAuthorizationStatus.mockResolvedValue({ status: after });
    }
  });
}

function armPluginHappyPath() {
  plugin.initialize.mockResolvedValue(undefined);
  plugin.requestConsentInfo.mockResolvedValue({ canRequestAds: true, status: 'NOT_REQUIRED' });
  plugin.showConsentForm.mockResolvedValue(undefined);
  plugin.prepareRewardVideoAd.mockResolvedValue(undefined);
  plugin.showRewardVideoAd.mockResolvedValue({ amount: 1, type: 'cache_box' });
  plugin.addListener.mockImplementation(() =>
    Promise.resolve({ remove: vi.fn(async () => {}) }),
  );
}

function preparedOptions(): Record<string, unknown> {
  return plugin.prepareRewardVideoAd.mock.calls[0]?.[0] as Record<string, unknown>;
}

const BASE_OPTIONS = { adId: TEST_AD_UNIT_ID, isTesting: true, immersiveMode: true };

describe('rewarded ads — ATT (iOS) in the shared presentation path', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    platformState.value = 'ios';
    armPluginHappyPath();
    armAtt('authorized');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('granted after the prompt: the request goes out untouched (personalized)', async () => {
    armAtt('notDetermined', 'authorized');
    const { presentRewardedAd } = await import('@/lib/ads/rewardedAdPresentation');

    const options = { ...BASE_OPTIONS };
    await presentRewardedAd(options);

    expect(plugin.requestTrackingAuthorization).toHaveBeenCalledTimes(1);
    // The exact object the caller built — no npa, nothing added.
    expect(plugin.prepareRewardVideoAd).toHaveBeenCalledWith(options);
    expect(preparedOptions()).not.toHaveProperty('npa');
  });

  it('denied after the prompt: the request carries npa: true, other fields preserved', async () => {
    armAtt('notDetermined', 'denied');
    const { presentRewardedAd } = await import('@/lib/ads/rewardedAdPresentation');

    await presentRewardedAd({ ...BASE_OPTIONS });

    expect(plugin.requestTrackingAuthorization).toHaveBeenCalledTimes(1);
    expect(preparedOptions()).toEqual({ ...BASE_OPTIONS, npa: true });
  });

  it('already denied: no prompt is shown and the request is non-personalized', async () => {
    armAtt('denied');
    const { presentRewardedAd } = await import('@/lib/ads/rewardedAdPresentation');

    await presentRewardedAd({ ...BASE_OPTIONS });

    expect(plugin.requestTrackingAuthorization).not.toHaveBeenCalled();
    expect(preparedOptions()).toEqual({ ...BASE_OPTIONS, npa: true });
  });

  it('restricted: no prompt is shown and the request is non-personalized', async () => {
    armAtt('restricted');
    const { presentRewardedAd } = await import('@/lib/ads/rewardedAdPresentation');

    await presentRewardedAd({ ...BASE_OPTIONS });

    expect(plugin.requestTrackingAuthorization).not.toHaveBeenCalled();
    expect(preparedOptions()).toEqual({ ...BASE_OPTIONS, npa: true });
  });

  it('already authorized: no prompt, request untouched', async () => {
    armAtt('authorized');
    const { presentRewardedAd } = await import('@/lib/ads/rewardedAdPresentation');

    const options = { ...BASE_OPTIONS };
    await presentRewardedAd(options);

    expect(plugin.requestTrackingAuthorization).not.toHaveBeenCalled();
    expect(plugin.prepareRewardVideoAd).toHaveBeenCalledWith(options);
    expect(preparedOptions()).not.toHaveProperty('npa');
  });

  it('the ATT status call failing fails closed: the ad still runs, non-personalized', async () => {
    plugin.trackingAuthorizationStatus.mockRejectedValue(new Error('ATT unavailable'));
    const { presentRewardedAd } = await import('@/lib/ads/rewardedAdPresentation');

    const reward = await presentRewardedAd({ ...BASE_OPTIONS });

    expect(reward).toEqual({ amount: 1, type: 'cache_box' });
    expect(preparedOptions()).toEqual({ ...BASE_OPTIONS, npa: true });
  });

  it('a second ad in the same session reuses the determination — no second prompt', async () => {
    armAtt('notDetermined', 'denied');
    const { presentRewardedAd } = await import('@/lib/ads/rewardedAdPresentation');

    await presentRewardedAd({ ...BASE_OPTIONS });
    await presentRewardedAd({ ...BASE_OPTIONS });

    expect(plugin.prepareRewardVideoAd).toHaveBeenCalledTimes(2);
    expect(plugin.requestTrackingAuthorization).toHaveBeenCalledTimes(1);
    // Status resolution ran once: read, prompt, re-read. The
    // second ad added no ATT calls at all.
    expect(plugin.trackingAuthorizationStatus).toHaveBeenCalledTimes(2);
    expect(plugin.prepareRewardVideoAd.mock.calls[1]?.[0]).toEqual({
      ...BASE_OPTIONS,
      npa: true,
    });
  });

  it('cache lane on iOS (denied): the prepared request is non-personalized', async () => {
    armAtt('notDetermined', 'denied');
    const { showRewardedCacheAd } = await import('@/lib/ads/rewardedCacheAd');

    await showRewardedCacheAd('user-1');

    expect(plugin.requestTrackingAuthorization).toHaveBeenCalledTimes(1);
    expect(preparedOptions()).toMatchObject({ adId: TEST_AD_UNIT_ID, npa: true });
  });

  it('bench lane on iOS (granted): the prepared request stays personalized', async () => {
    armAtt('notDetermined', 'authorized');
    plugin.showRewardVideoAd.mockResolvedValue({ amount: 1, type: 'bench_time' });
    const { showRewardedBenchTimeAd } = await import('@/lib/ads/rewardedBenchTimeAd');

    await showRewardedBenchTimeAd('user-1');

    expect(plugin.requestTrackingAuthorization).toHaveBeenCalledTimes(1);
    expect(preparedOptions()).toMatchObject({ adId: TEST_AD_UNIT_ID });
    expect(preparedOptions()).not.toHaveProperty('npa');
  });
});

describe('rewarded ads — no ATT off iOS', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    armPluginHappyPath();
    armAtt('notDetermined', 'authorized');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Android: no ATT call is made and the request is the exact object the lane built', async () => {
    platformState.value = 'android';
    const { presentRewardedAd } = await import('@/lib/ads/rewardedAdPresentation');

    const options = { ...BASE_OPTIONS };
    await presentRewardedAd(options);

    expect(plugin.trackingAuthorizationStatus).not.toHaveBeenCalled();
    expect(plugin.requestTrackingAuthorization).not.toHaveBeenCalled();
    expect(plugin.prepareRewardVideoAd.mock.calls[0]?.[0]).toBe(options);
  });

  it('web: no ATT call is made and the request is unchanged', async () => {
    platformState.value = 'web';
    const { withTrackingAuthorization } = await import('@/lib/ads/rewardedAdPresentation');

    const options = { ...BASE_OPTIONS };
    await expect(withTrackingAuthorization(options)).resolves.toBe(options);
    expect(plugin.trackingAuthorizationStatus).not.toHaveBeenCalled();
    expect(plugin.requestTrackingAuthorization).not.toHaveBeenCalled();
  });
});
