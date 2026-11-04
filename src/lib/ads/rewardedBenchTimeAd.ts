/**
 * Rewarded ads for bench time (economy slice 10, brief §8.2/§8.7).
 * A completed ad attests ONE bench-time grant (+1 hour banked,
 * op cc_bank_bench_time) from the Workshop surface — this module is
 * imported only there: no ads on the play screen, ever. Attestation
 * is client-side by design (no SSV), exactly mirroring the cache
 * lane (rewardedCacheAd.ts); the server's controls are the nonce
 * and the 24 h bank cap.
 *
 * Ad unit: a dedicated bench-time unit can be pointed at deploy
 * time via VITE_ADMOB_REWARDED_BENCH_TIME_AD_UNIT_ID. Until one
 * exists, the lane falls back to the Cache Reward unit — the only
 * rewarded placement the account carries — and, in dev/test
 * builds, to Google's public test unit via that module's resolver.
 * The unit actually shown is the unit the op attests.
 */
import { AdMob, AdmobConsentStatus, type RewardAdOptions } from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';
import { rewardedCacheAdUnitId } from './rewardedCacheAd';

let initialized = false;

export type RewardedBenchTimeAdResult = {
  adUnitId: string;
  rewardAmount: number;
  rewardType: string;
};

export function canUseRewardedBenchTimeAds(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AdMob');
}

export function rewardedBenchTimeAdUnitId(): string {
  const configured = import.meta.env.VITE_ADMOB_REWARDED_BENCH_TIME_AD_UNIT_ID;
  if (configured) return configured;
  return rewardedCacheAdUnitId();
}

function shouldUseTestAds(): boolean {
  const configured = import.meta.env.VITE_ADMOB_TEST_ADS;
  if (configured != null) return configured !== 'false';
  return import.meta.env.MODE !== 'production';
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

export async function showRewardedBenchTimeAd(userId?: string): Promise<RewardedBenchTimeAdResult> {
  if (!canUseRewardedBenchTimeAds()) {
    throw new Error('Rewarded ads are available in the Android app.');
  }

  await initializeAdMob();

  const adUnitId = rewardedBenchTimeAdUnitId();
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
    rewardType: String(reward.type ?? 'bench_time'),
  };
}
