/**
 * Offline-cap limiter service (roaming-variance overhaul) — the
 * Settings control for the player's own AFK limiter. The limiter is
 * one input to the settlement law (src/content/offlineCap.ts):
 * effective cap = min(earned tier + keystone bonus, limiter, 24h).
 * It can only shorten a settlement, never extend one past earned.
 * Like setUsername, validation reports as data ({ ok: false, error }).
 */
import { apiRequest } from './http';

export interface SetOfflineCapLimiterResult {
  ok: boolean;
  error?: string;
  offlineCapHours?: number | null;
}

/** Set the limiter (integer hours 1..24), or clear it with null. */
export async function setOfflineCapLimiter(capHours: number | null): Promise<SetOfflineCapLimiterResult> {
  try {
    const data = await apiRequest<SetOfflineCapLimiterResult>('/profile/offline-cap', {
      method: 'POST',
      body: { cap_hours: capHours },
    });
    return data ?? { ok: false, error: 'Unknown error.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    console.error('setOfflineCapLimiter failed:', message);
    return { ok: false, error: message };
  }
}
