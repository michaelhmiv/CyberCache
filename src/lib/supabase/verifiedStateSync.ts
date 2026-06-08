import { usePlayerStore } from '@/store/slices/playerSlice';

export type RuntimeProfilePayload = {
  id?: string;
  player_level?: number | string;
  player_xp?: number | string;
  credits?: number | string;
  scrap?: number | string;
  cache_tokens?: number | string;
  cache_token_parts?: number | string;
  materials?: Record<string, number>;
  essences?: Record<string, number>;
  consumables?: Record<string, number>;
};

function numberValue(value: number | string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function syncRuntimeProfile(profile: RuntimeProfilePayload | undefined): void {
  if (!profile) return;

  usePlayerStore.getState().setPlayer({
    id: profile.id ?? usePlayerStore.getState().id,
    level: numberValue(profile.player_level, usePlayerStore.getState().level),
    xp: numberValue(profile.player_xp, usePlayerStore.getState().xp),
    credits: numberValue(profile.credits, usePlayerStore.getState().credits),
    scrap: numberValue(profile.scrap, usePlayerStore.getState().scrap),
    cacheKeys: numberValue(profile.cache_tokens, usePlayerStore.getState().cacheKeys),
    cacheKeyFragments: numberValue(profile.cache_token_parts, usePlayerStore.getState().cacheKeyFragments),
    materials: profile.materials ?? usePlayerStore.getState().materials,
    essences: profile.essences ?? usePlayerStore.getState().essences,
    consumables: profile.consumables ?? usePlayerStore.getState().consumables,
  });
}

export function syncVerifiedResult(result: Record<string, unknown>): void {
  syncRuntimeProfile(result.profile as RuntimeProfilePayload | undefined);
}
