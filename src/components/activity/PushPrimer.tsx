/**
 * Push Primer — the one notification-permission ask (audit PERM-01).
 *
 * Rendered as a row inside the Offline Recap card ("While You Were
 * Away"): the first offline settlement is the first moment the
 * player can see what a notification would have told them, so the
 * ask rides that moment instead of firing unprimed at session
 * start. The row appears only when the OS permission is still
 * askable ('prompt'), the platform is native (web never renders
 * it), and the player hasn't answered the primer this session.
 * Either answer settles it for the session — "Not now" never
 * re-nags, and a granted/denied OS answer ends the offer too.
 */

import React, { useEffect, useState } from 'react';
import {
  checkPushPermission,
  requestPushNotifications,
  type PushPermissionState,
} from '@/lib/notifications/pushNotifications';
import { usePushPrimerStore } from '@/store/slices/pushPrimerSlice';

export function PushPrimerRow() {
  const settled = usePushPrimerStore((state) => state.settled);
  const settle = usePushPrimerStore((state) => state.settle);
  const [permission, setPermission] = useState<PushPermissionState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settled) return;
    let cancelled = false;
    checkPushPermission()
      .then((state) => {
        if (!cancelled) setPermission(state);
      })
      .catch(() => {
        if (!cancelled) setPermission('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [settled]);

  if (settled || permission !== 'prompt') return null;

  const notify = async () => {
    setBusy(true);
    try {
      await requestPushNotifications();
    } finally {
      // Granted, denied at the OS prompt, or unavailable — the
      // player answered the primer; it never re-nags this session.
      settle();
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-amber/10 px-5 py-3" data-testid="push-primer">
      <p className="text-xs leading-relaxed text-zinc-300">
        Get a ping when your offline earnings land — exactly what this card just showed you.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void notify()}
          disabled={busy}
          className="bl-primary min-h-11 flex-1 px-3 py-2 text-xs font-black disabled:opacity-50"
        >
          Notify me
        </button>
        <button
          type="button"
          onClick={settle}
          disabled={busy}
          className="bl-secondary min-h-11 flex-1 px-3 py-2 text-xs font-black disabled:opacity-50"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
