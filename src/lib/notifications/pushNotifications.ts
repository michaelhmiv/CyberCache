import { Capacitor } from '@capacitor/core';
import { PushNotifications, type Token } from '@capacitor/push-notifications';
import { verifiedOps } from '@/lib/api/verifiedOps';

let mounted = false;

export async function registerPushNotifications(): Promise<void> {
  if (mounted || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PushNotifications')) return;
  mounted = true;

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return;

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
