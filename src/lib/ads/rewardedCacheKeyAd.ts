import { AdMob, AdmobConsentStatus, type RewardAdOptions } from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';

const TEST_REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

let initialized = false;

export type RewardedCacheKeyAdResult = {
  adUnitId: string;
  rewardAmount: number;
  rewardType: string;
};

export function canUseRewardedCacheKeyAds(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AdMob');
}

function shouldUseTestAds(): boolean {
  const configured = import.meta.env.VITE_ADMOB_TEST_ADS;
  if (configured != null) return configured !== 'false';
  return import.meta.env.MODE !== 'production';
}

export function rewardedCacheKeyAdUnitId(): string {
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

export async function showRewardedCacheKeyAd(userId?: string): Promise<RewardedCacheKeyAdResult> {
  if (!canUseRewardedCacheKeyAds()) {
    throw new Error('Rewarded ads are available in the Android app.');
  }

  await initializeAdMob();

  const adUnitId = rewardedCacheKeyAdUnitId();
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
    rewardType: String(reward.type ?? 'cache_key'),
  };
}
