/**
 * Shared presentation step for BOTH rewarded lanes (cache-open,
 * rewardedCacheAd.ts; bench-time, rewardedBenchTimeAd.ts) — one
 * owner for how a prepared rewarded ad is shown to settlement.
 *
 * Why this exists: in @capacitor-community/admob 8.0.0 the
 * showRewardVideoAd() call resolves ONLY when the user earns the
 * reward. A dismissal or a fail-to-show never settles the call —
 * the native side emits the onRewardedVideoAdDismissed /
 * onRewardedVideoAdFailedToShow listener events instead — so
 * awaiting the show call alone can hang forever, and the
 * caller's failure notice (which fires on rejection) never runs
 * (owner device hit, 2026-11-19: the cache-open button looked
 * completely dead).
 *
 * presentRewardedAd races the show call against those two
 * terminal events plus an overall timeout backstop, so EVERY
 * presentation outcome settles: reward → resolve; dismiss /
 * fail-to-show / timeout → reject. Callers map any rejection to
 * their own player-facing notice — the error messages below are
 * internal and are never shown raw. Listeners are removed on
 * settlement: no leaks, no double-settle. (The Dismissed event
 * also fires after a rewarded view closes; by then the show
 * call has already resolved and the settle guard ignores it.)
 */
import {
  AdMob,
  RewardAdPluginEvents,
  type AdMobRewardItem,
  type RewardAdOptions,
} from '@capacitor-community/admob';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';

// Backstop only. A cold MobileAds init + first load + a full
// rewarded view completes well inside this; the timeout exists
// so a show attempt whose terminal event never arrives still
// settles instead of hanging the surface forever.
export const REWARDED_AD_ATTEMPT_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// App Tracking Transparency (Build 7 — Guideline 5.1.2(i)).
//
// Personalized ads stay ON with the player's consent (owner
// ruling, 2026-11-19); on iOS that consent is Apple's ATT prompt,
// so before the FIRST rewarded request of a session this path
// resolves the tracking status through the AdMob plugin's ATT
// API (@capacitor-community/admob 8.0.0, verified against the
// installed package):
//
//   trackingAuthorizationStatus(): Promise<{ status }> — reads
//     the current ATTrackingManager status without prompting;
//   requestTrackingAuthorization(): Promise<void> — presents
//     the system prompt while the status is 'notDetermined'
//     and resolves void, so the status is re-read afterwards.
//
// 'authorized' → the request goes out exactly as it did before
// (personalized). Anything else — denied, restricted, still
// notDetermined after the prompt, or the ATT call itself
// failing — fails closed to a non-personalized request for that
// call via the plugin's `npa` option (AdOptions.npa, which
// RewardAdOptions extends). An ATT failure never blocks the ad
// itself: the rewarded path still runs, just non-personalized.
//
// The determination is cached for the whole session (the latch
// below holds the in-flight promise, so concurrent first calls
// in the two lanes share one resolution): the prompt can appear
// at most once per launch, and later ads reuse the outcome.
// Android and web never enter this path — there is no ATT off
// iOS — and their options pass through untouched.
// ---------------------------------------------------------------------------

type TrackingOutcome = 'personalized' | 'non-personalized';

let trackingOutcomePromise: Promise<TrackingOutcome> | null = null;

async function determineTrackingOutcome(): Promise<TrackingOutcome> {
  try {
    let { status } = await AdMob.trackingAuthorizationStatus();
    if (status === 'notDetermined') {
      await AdMob.requestTrackingAuthorization();
      ({ status } = await AdMob.trackingAuthorizationStatus());
    }
    return status === 'authorized' ? 'personalized' : 'non-personalized';
  } catch {
    return 'non-personalized';
  }
}

/**
 * The options a rewarded request actually goes out with. Off
 * iOS the input is returned untouched (the same object). On iOS
 * the first call resolves ATT (prompting once if the status is
 * undetermined); a non-authorized outcome returns a copy
 * carrying `npa: true`, an authorized outcome returns the input
 * untouched.
 */
export async function withTrackingAuthorization(
  options: RewardAdOptions,
): Promise<RewardAdOptions> {
  if (Capacitor.getPlatform() !== 'ios') return options;
  trackingOutcomePromise ??= determineTrackingOutcome();
  const outcome = await trackingOutcomePromise;
  return outcome === 'personalized' ? options : { ...options, npa: true };
}

export async function presentRewardedAd(
  options: RewardAdOptions,
  timeoutMs: number = REWARDED_AD_ATTEMPT_TIMEOUT_MS,
): Promise<AdMobRewardItem> {
  await AdMob.prepareRewardVideoAd(await withTrackingAuthorization(options));

  const handles: PluginListenerHandle[] = [];
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Listener registration is async: a handle that lands after
  // settlement removes itself instead of joining the tracked
  // set, and a failed registration is not fatal — the show call
  // and the timeout still settle the attempt without it.
  const trackHandle = (pending: Promise<PluginListenerHandle>) => {
    void pending
      .then((handle) => {
        if (settled) void handle.remove().catch(() => {});
        else handles.push(handle);
      })
      .catch(() => {});
  };

  try {
    return await new Promise<AdMobRewardItem>((resolve, reject) => {
      const settle = (complete: () => void) => {
        if (settled) return;
        settled = true;
        complete();
      };
      timer = setTimeout(() => {
        settle(() => reject(new Error('Rewarded ad attempt timed out before the ad completed.')));
      }, timeoutMs);
      trackHandle(
        AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
          settle(() => reject(new Error('The ad was dismissed before the reward was earned.')));
        }),
      );
      trackHandle(
        AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => {
          settle(() => reject(new Error('The ad failed to show.')));
        }),
      );
      AdMob.showRewardVideoAd().then(
        (reward) => settle(() => resolve(reward)),
        (err: unknown) =>
          settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
      );
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    settled = true;
    await Promise.allSettled(handles.map((handle) => handle.remove()));
  }
}
