import { useEffect, useRef } from 'react';

type IdleCallbackHandle = number;
interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining: () => number;
}
type RequestIdleCallbackLike = (
  cb: (deadline: IdleDeadlineLike) => void,
  opts?: { timeout: number },
) => IdleCallbackHandle;

/**
 * useIdleWarmOnce — run `warm` exactly once, during browser idle
 * time, the first time `enabled` is true.
 *
 * Built for tab warming (audit #569): work that must be paid before
 * the player reaches for it, but must never compete with the boot
 * or the first interactive paint. The idle callback carries a
 * timeout so the warm still lands on a busy main thread; browsers
 * without requestIdleCallback (Safari) fall back to a plain timer.
 * Unmounting (or `enabled` dropping) before the warm fires cancels
 * it — a warm that never fired is simply paid later, on use.
 */
export function useIdleWarmOnce(enabled: boolean, warm: () => void): void {
  const warmRef = useRef(warm);
  // Track the latest closure without letting caller re-renders
  // (a fresh inline callback every render) reschedule the warm.
  useEffect(() => {
    warmRef.current = warm;
  });
  const firedRef = useRef(false);

  useEffect(() => {
    if (!enabled || firedRef.current) return undefined;
    let cancelled = false;
    const fire = () => {
      if (cancelled || firedRef.current) return;
      firedRef.current = true;
      warmRef.current();
    };
    const ric = (window as unknown as { requestIdleCallback?: RequestIdleCallbackLike })
      .requestIdleCallback;
    if (typeof ric === 'function') {
      const id = ric(fire, { timeout: 2500 });
      return () => {
        cancelled = true;
        const cic = (
          window as unknown as { cancelIdleCallback?: (id: IdleCallbackHandle) => void }
        ).cancelIdleCallback;
        if (typeof cic === 'function') cic(id);
      };
    }
    const id = setTimeout(fire, 1200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [enabled]);
}
