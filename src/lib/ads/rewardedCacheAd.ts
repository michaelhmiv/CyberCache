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
import { presentRewardedAd } from './rewardedAdPresentation';

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

  // Consent is best-effort, never a gate on the ad attempt. The
  // UMP info request fails outright when the publisher account
  // has no form configured for the app, and that failure used to
  // reject the whole flow before an ad was even attempted — with
  // the SDK's raw error text landing on the cache screen (owner
  // hit it live, 2026-11-18). Per the UMP pattern, a failed
  // consent step is not a precondition failure for requesting an
  // ad: log it and proceed. Only a failed ad itself is a
  // player-facing event, and the surface maps that to the game's
  // own notice.
  try {
    const consentInfo = await AdMob.requestConsentInfo();
    if (!consentInfo.canRequestAds && consentInfo.status === AdmobConsentStatus.REQUIRED) {
      await AdMob.showConsentForm();
    }
  } catch (err) {
    console.warn('[ads] consent step failed; continuing to the ad attempt', err);
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

  // Presentation settles on EVERY outcome (reward, dismiss,
  // fail-to-show, timeout) via the shared helper — the plugin's
  // raw show call alone never settles on dismiss/fail-to-show,
  // which hung this lane's button with no notice (2026-11-19).
  const reward = await presentRewardedAd(options);

  return {
    adUnitId,
    rewardAmount: Number(reward.amount ?? 1),
    rewardType: String(reward.type ?? 'cache_box'),
  };
}
