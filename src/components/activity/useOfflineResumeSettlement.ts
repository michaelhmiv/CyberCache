/**
 * useOfflineResumeSettlement — Mobile Resume Settlement Hook
 *
 * AuthProvider settles only during session/user load and refreshAccount.
 * That does NOT cover mobile app switching — the page remains mounted
 * and no auth state change fires when the user returns from another app.
 *
 * This hook uses THREE detection paths (ordered by reliability on mobile):
 *
 *   PATH A (native): Capacitor App plugin resume/pause events.
 *     @capacitor/app fires 'resume' on every Activity.onResume() and
 *     'pause' on every Activity.onPause(). These are more reliable than
 *     appStateChange, which only fires from BridgeActivity.onStart/onStop
 *     — a onPause→onResume cycle (e.g. Home→return) may skip onStop/onStart
 *     entirely, causing appStateChange to never fire.
 *
 *   PATH B (native): Capacitor App plugin appStateChange event.
 *     Redundant with PATH A, kept as defense-in-depth. Fires from
 *     BridgeActivity.onStart/onStop via bridge.getApp().fireStatusChange().
 *
 *   PATH C (web): document visibilitychange + window focus/pageshow.
 *     Fallback for browser dev and non-Capacitor environments.
 *
 * When the app becomes visible again after being hidden:
 *   1. Hydrates active activity from server
 *   2. Calls settleActiveActivityRewards for server-authoritative catch-up
 *   3. Saves runtime snapshot after authoritative state is applied
 *   4. Settlement result is written to useOfflineRecapStore for UI display
 *
 * Throttle: ignores hidden durations < MIN_HIDDEN_MS (15s) unless
 *           the debug flag is active.
 * Debounce: overlapping events (resume + appStateChange + visibilitychange
 *           + focus + pageshow) within 2 seconds are coalesced into a
 *           single settlement call.
 *
 * Mobile browsers frequently suspend JS without firing reliable unload
 * events. This hook makes resume the universal catch-up path — even if
 * pagehide/leave signals never fire, the server-side timestamps ensure
 * correct elapsed-time computation.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { useAuth } from '@/auth/AuthProvider';
import { useActivityStore } from '@/store';
import { settleActiveActivityRewards } from '@/lib/activity/activitySettlement';
import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';

/** Minimum hidden duration (ms) to trigger settlement. */
const MIN_HIDDEN_MS = 15_000;

/** Debounce window (ms) — coalesce rapid focus/visibility events. */
const DEBOUNCE_MS = 2_000;

/**
 * Development-only debug settlement hook.
 * When VITE_DEBUG_SETTLEMENT is set, reduces MIN_HIDDEN_MS to 0
 * and logs verbose diagnostics.
 */
const isDebugSettlement =
  typeof import.meta !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).env?.VITE_DEBUG_SETTLEMENT === 'true';

const effectiveMinHiddenMs = isDebugSettlement ? 0 : MIN_HIDDEN_MS;

export function useOfflineResumeSettlement() {
  const { user, loading } = useAuth();

  // Track when the page was hidden so we can compute hidden duration.
  const hiddenSinceRef = useRef<number | null>(null);
  // Debounce guard: true while a settlement is in-flight.
  const settlingRef = useRef(false);
  // Timestamp of last settlement attempt (for debounce).
  const lastSettleAttemptRef = useRef<number>(0);

  const maybeSettle = useCallback(async () => {
    const now = Date.now();

    // Debounce: skip if we settled within the debounce window.
    if (now - lastSettleAttemptRef.current < DEBOUNCE_MS) {
      if (isDebugSettlement) {
        console.log('[useOfflineResumeSettlement] debounced — last attempt', now - lastSettleAttemptRef.current, 'ms ago');
      }
      return;
    }

    // Prevent overlapping settlements.
    if (settlingRef.current) {
      if (isDebugSettlement) {
        console.log('[useOfflineResumeSettlement] skipping — settlement already in flight');
      }
      return;
    }

    // Must be authenticated.
    if (!user || loading) {
      if (isDebugSettlement) {
        console.log('[useOfflineResumeSettlement] skipping — not authenticated', { user: !!user, loading });
      }
      return;
    }

    // Check hidden duration.
    const hiddenDuration = hiddenSinceRef.current ? now - hiddenSinceRef.current : 0;
    if (hiddenDuration < effectiveMinHiddenMs) {
      if (isDebugSettlement) {
        console.log('[useOfflineResumeSettlement] hidden duration', hiddenDuration, 'ms < threshold', effectiveMinHiddenMs);
      }
      return;
    }

    settlingRef.current = true;
    lastSettleAttemptRef.current = now;

    try {
      if (isDebugSettlement) {
        console.log('[useOfflineResumeSettlement] settling after', hiddenDuration, 'ms hidden');
      }

      // Hydrate active activity so settleActiveActivityRewards has fresh state.
      await useActivityStore.getState().hydrate();

      // Run server-authoritative settlement.
      const result = await settleActiveActivityRewards({
        userId: user.id,
        saveSnapshot: true,
      });

      // Save runtime display snapshot for next resume.
      await saveCurrentRuntimeStores(user.id);

      if (isDebugSettlement) {
        if (result) {
          console.log('[useOfflineResumeSettlement] settlement complete', {
            ticksSettled: result.ticksSettled,
            timeAway: result.timeAway,
            rewards: result.rewards,
          });
        } else {
          console.log('[useOfflineResumeSettlement] settlement returned null (no-op)');
        }
      }
    } catch (error) {
      console.warn(
        '[useOfflineResumeSettlement] settlement failed:',
        error instanceof Error ? error.message : error,
      );
    } finally {
      // Clear the resume window after any attempted settlement so a stale
      // hiddenSince value cannot retrigger from follow-up focus/pageshow events.
      hiddenSinceRef.current = null;
      settlingRef.current = false;
    }
  }, [user, loading]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const isNative = Capacitor.isNativePlatform();

    const handleHidden = () => {
      hiddenSinceRef.current = Date.now();
      if (isDebugSettlement) {
        console.log('[useOfflineResumeSettlement] app hidden at', hiddenSinceRef.current);
      }
    };

    const handleVisible = () => {
      if (isDebugSettlement) {
        const hiddenDuration = hiddenSinceRef.current
          ? Date.now() - hiddenSinceRef.current
          : 0;
        console.log('[useOfflineResumeSettlement] app visible — hidden', hiddenDuration, 'ms');
      }
      maybeSettle();
    };

    // Collect Capacitor listener handles for cleanup.
    const pluginHandles: PluginListenerHandle[] = [];

    // PATH A (native): resume/pause events — fire on EVERY Activity.onResume()
    // and Activity.onPause(). More reliable than appStateChange, which fires
    // from onStart/onStop and can be skipped in a simple Home→return cycle.
    // PATH B (native): appStateChange — defense-in-depth, fires from
    // BridgeActivity.onStart/onStop.
    if (isNative) {
      const registerCapacitorListeners = async () => {
        try {
          const [resumeHandle, pauseHandle, stateHandle] = await Promise.all([
            App.addListener('resume', handleVisible),
            App.addListener('pause', handleHidden),
            App.addListener('appStateChange', ({ isActive }) => {
              if (isDebugSettlement) {
                console.log('[useOfflineResumeSettlement] appStateChange isActive =', isActive);
              }
              if (isActive) {
                handleVisible();
              } else {
                handleHidden();
              }
            }),
          ]);
          pluginHandles.push(resumeHandle, pauseHandle, stateHandle);
        } catch (error) {
          console.warn(
            '[useOfflineResumeSettlement] Capacitor listener registration failed:',
            error instanceof Error ? error.message : error,
          );
        }
      };
      void registerCapacitorListeners();
    }

    // PATH C (web): visibilitychange, focus, pageshow — primary signals for
    // browser dev and fallback for native if the Capacitor bridge isn't ready.
    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleHidden();
      } else {
        handleVisible();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // focus: backup signal for desktop/mobile browser tab switching.
    const handleFocus = () => {
      if (isDebugSettlement) {
        console.log('[useOfflineResumeSettlement] window focus');
      }
      maybeSettle();
    };

    window.addEventListener('focus', handleFocus);

    // pageshow: fires after bfcache restore on mobile Safari, Chrome.
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        if (isDebugSettlement) {
          console.log('[useOfflineResumeSettlement] pageshow (bfcache restore)');
        }
        maybeSettle();
      }
    };

    window.addEventListener('pageshow', handlePageShow);

    // pagehide: mark hidden timestamp for duration calculation.
    const handlePageHide = () => {
      handleHidden();
    };

    window.addEventListener('pagehide', handlePageHide);

    return () => {
      // Remove all Capacitor plugin listeners.
      for (const handle of pluginHandles) {
        try {
          void handle.remove();
        } catch (error) {
          console.warn('[useOfflineResumeSettlement] handle.remove() failed:', error);
        }
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [maybeSettle]);
}
