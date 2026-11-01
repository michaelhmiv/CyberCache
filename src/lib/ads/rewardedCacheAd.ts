/**
 * Rewarded ads for the cache box lane (0037). An ad completion
 * attests ONE cache box opening on the cache surface — it never
 * mints a key (the rewarded-key claim retired with 0037) and this
 * module is imported only by the cache surface: no ads on the play
 * screen, ever. Attestation is client-side by design (no SSV); the
 * server's hard daily cap is the control.
 */
import { AdMob, AdmobConsentStatus, type RewardAdOptions } from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';

const TEST_REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

let initialized = false;

export type RewardedCacheAdResult = {
  adUnitId: string;
  rewardAmount: number;
  rewardType: string;
};

export function canUseRewardedCacheAds(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AdMob');
}

function shouldUseTestAds(): boolean {
  const configured = import.meta.env.VITE_ADMOB_TEST_ADS;
  if (configured != null) return configured !== 'false';
  return import.meta.env.MODE !== 'production';
}

export function rewardedCacheAdUnitId(): string {
  const configured = import.meta.env.VITE_ADMOB_REWARDED_CACHE_KEY_AD_UNIT_ID;
  if (configured) return configured;
  return TEST_REWARDED_AD_UNIT_ID;
}

async function initializeAdMob(): Promise<void> {
  if (initialized) return;

  await AdMob.initialize();
  const consentInfo = await AdMob.requestConsentInfo();
  if (!consentInfo.canRequestAds && consentInfo.status === AdmobConsentStatus.REQUIRED) {
    await AdMob.showConsentForm();
  }

  initialized = true;
}

export async function showRewardedCacheAd(userId?: string): Promise<RewardedCacheAdResult> {
  if (!canUseRewardedCacheAds()) {
    throw new Error('Rewarded ads are available in the Android app.');
  }

  await initializeAdMob();

  const adUnitId = rewardedCacheAdUnitId();
  const options: RewardAdOptions = {
    adId: adUnitId,
    isTesting: shouldUseTestAds(),
    immersiveMode: true,
    ...(userId ? { ssv: { userId } } : {}),
  };

  await AdMob.prepareRewardVideoAd(options);
  const reward = await AdMob.showRewardVideoAd();

  return {
    adUnitId,
    rewardAmount: Number(reward.amount ?? 1),
    rewardType: String(reward.type ?? 'cache_box'),
  };
}
