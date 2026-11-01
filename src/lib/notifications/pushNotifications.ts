import { Capacitor } from '@capacitor/core';
import { PushNotifications, type Token } from '@capacitor/push-notifications';
import { verifiedOps } from '@/lib/api/verifiedOps';

/**
 * Push notifications (audit PERM-01).
 *
 * The permission ASK used to fire at the first authenticated
 * session mount — an unprimed system prompt before the player had
 * received any value from the game, which is exactly when players
 * deny it (and a denial is sticky). The ask now lives behind ONE
 * explicit in-game affordance: the primer row on the offline
 * settlement recap ("While You Were Away"), the first moment the
 * player can see what a notification would have told them. Only
 * `requestPushNotifications()` may call requestPermissions(), and
 * only the primer's "Notify me" button calls it.
 *
 * Session start calls `syncPushRegistration()` instead: it CHECKS
 * the permission (no prompt) and, only when the player already
 * granted it in an earlier session, re-attaches listeners and
 * re-registers the device token so delivery keeps working. Web is
 * a no-op throughout (native-only, as before).
 */

let listenersMounted = false;

function pushAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PushNotifications');
}

export type PushPermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable';

/** Read the current OS permission without ever prompting. */
export async function checkPushPermission(): Promise<PushPermissionState> {
  if (!pushAvailable()) return 'unavailable';
  try {
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'granted') return 'granted';
    if (permission.receive === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unavailable';
  }
}

async function attachListenersAndRegister(): Promise<void> {
  if (listenersMounted) {
    await PushNotifications.register();
    return;
  }
  listenersMounted = true;

  await PushNotifications.addListener('registration', async (token: Token) => {
    await verifiedOps.registerPushDevice({
      token: token.value,
      platform: Capacitor.getPlatform(),
      appVersion: import.meta.env.VITE_APP_VERSION ?? null,
    });
  });

  await PushNotifications.addListener('registrationError', (error) => {
    console.warn('[push] registration failed', error);
  });

  await PushNotifications.register();
}

/**
 * Session-start sync: keeps push delivery alive for players who
 * ALREADY granted permission. Never prompts — when permission is
 * not yet granted this does nothing at all.
 */
export async function syncPushRegistration(): Promise<void> {
  if (!pushAvailable()) return;
  const state = await checkPushPermission();
  if (state !== 'granted') return;
  await attachListenersAndRegister();
}

/**
 * The one permission ask. Called ONLY from the primer's explicit
 * "Notify me" tap. Returns true when permission is granted (and
 * the device registered); false otherwise. Web / unsupported
 * platforms return false without touching the OS.
 */
export async function requestPushNotifications(): Promise<boolean> {
  if (!pushAvailable()) return false;
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return false;
  await attachListenersAndRegister();
  return true;
}
