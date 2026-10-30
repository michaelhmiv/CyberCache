/**
 * useLeaveSignals — Best-Effort Leave Signal Hook
 *
 * On pagehide / visibilitychange to hidden, attempts to:
 *   1. Save the runtime display snapshot (so the display state is preserved)
 *   2. Send a keepalive heartbeat to the active_actions table
 *      (updates last_heartbeat_at so the settlement diagnostic can see it)
 *
 * CRITICAL: Mobile browsers frequently suspend JS without firing these
 * events (especially on iOS). This is a BEST-EFFORT optimization — the
 * system MUST work correctly even when these events NEVER fire.
 * The server-side timestamps (last_roaming_settled_at, started_at) are
 * the authoritative source of truth for elapsed time computation on resume.
 *
 * NEVER rely on these leave signals for correctness. They exist solely
 * to improve the diagnostic surface and reduce the chance of stale data.
 */

import { useEffect, useRef } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import { heartbeatActiveActivity } from '@/lib/api/activityService';

export function useLeaveSignals() {
  const { user } = useAuth();
  const savingRef = useRef(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleLeave = () => {
      if (!user || savingRef.current) return;
      savingRef.current = true;

      // Fire-and-forget: do not block the page transition.
      // If the browser kills the tab, these may not complete — that's OK.

      // 1. Save runtime display snapshot
      saveCurrentRuntimeStores(user.id).catch((err) => {
        console.warn('[LeaveSignals] snapshot save failed:', err instanceof Error ? err.message : err);
      });

      // 2. Send keepalive heartbeat to active_actions
      heartbeatActiveActivity().catch((err) => {
        console.warn('[LeaveSignals] heartbeat failed:', err instanceof Error ? err.message : err);
      });

      // Reset guard after 5s (in case the page doesn't actually unload)
      setTimeout(() => { savingRef.current = false; }, 5000);
    };

    // pagehide: best signal for mobile (fires more reliably than beforeunload)
    window.addEventListener('pagehide', handleLeave);

    // visibilitychange → hidden: backup signal for tab/app switching
    const handleVisibility = () => {
      if (document.hidden) {
        handleLeave();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('pagehide', handleLeave);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user]);
}
