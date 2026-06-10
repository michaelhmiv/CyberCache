/**
 * Chef API Client
 *
 * Calls the Chef worker (src/server/chef.ts) running on the Railway
 * server. The Chef is the authoritative gameplay engine — it owns
 * probabilities, item generation, resource awards, and boss verification.
 *
 * The client sends claims; the Chef processes them and returns
 * canonical results. The client NEVER generates items or awards
 * resources independently.
 */

import type { GearItem } from '@/types/items';

const CHEF_URL = (() => {
  // Explicit env var takes priority
  if (import.meta.env.VITE_CHEF_URL) return import.meta.env.VITE_CHEF_URL;
  // In production, use the same origin — the Express server handles /api/*
  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }
  // Fallback for SSR / test environments
  return '/api';
})();

export interface ChefClaimRequest {
  playerId: string;
  areaId: string;
  ticks: number;
  tickCount: number;
  playerLevel: number;
  /** Idle economy modifiers from equipped weapons/relics (Phase 2d). */
  idleMods?: {
    offlineEarningsMod: number;
    scrapYieldMod: number;
    rareDropChanceMod: number;
  };
  jwt?: string;
}

export interface ChefClaimResult {
  actionType: string;
  profile: Record<string, unknown>;
  rewards: {
    ticks: number;
    creditsAwarded: number;
    scrapAwarded: number;
    xpAwarded: number;
    cacheFragmentsAwarded: number;
    materials: Record<string, number>;
    essences: Record<string, number>;
    killsRecorded: number;
  };
  items: GearItem[];
  feedEvents: Array<{
    at: number;
    tone: string;
    label: string;
    detail: string;
    areaId: string;
    value?: number;
    gear?: GearItem;
  }>;
}

export interface ChefVerifyBossRequest {
  playerId: string;
  bossId: string;
  damageDealt: number;
  damageTaken: number;
  medkitsConsumed: number;
  fightDurationMs: number;
  loadoutDps: number;
  victory: boolean;
  jwt?: string;
}

export interface ChefVerifyBossResult {
  verified: boolean;
  victory: boolean;
  rewards?: {
    xp: number;
    credits: number;
    loot: GearItem[];
  };
  pityIncremented: boolean;
  reason?: string;
}

/**
 * Submit a roaming tick claim to the Chef.
 */
export async function submitClaim(request: ChefClaimRequest): Promise<ChefClaimResult> {
  const jwt = request.jwt || (await getSessionJwt());

  const response = await fetch(`${CHEF_URL}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ ...request, jwt }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const detail = (errorBody as { detail?: string }).detail || response.statusText;
    throw new Error(`Chef claim failed (${response.status}): ${detail}`);
  }

  return response.json();
}

/**
 * Verify a boss fight result with the Chef.
 */
export async function verifyBossFight(request: ChefVerifyBossRequest): Promise<ChefVerifyBossResult> {
  const jwt = request.jwt || (await getSessionJwt());

  const response = await fetch(`${CHEF_URL}/verify-boss`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ ...request, jwt }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const detail = (errorBody as { detail?: string }).detail || response.statusText;
    throw new Error(`Chef boss verification failed (${response.status}): ${detail}`);
  }

  return response.json();
}

/**
 * Salvage an item via the Chef server.
 * The client does optimistic removal; the Chef verifies and awards resources.
 */
export async function salvageItem(request: { playerId: string; itemId: string; jwt?: string }): Promise<{
  salvaged: boolean;
  scrapValue: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
}> {
  const jwt = request.jwt || (await getSessionJwt());

  const response = await fetch(`${CHEF_URL}/salvage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ ...request, jwt }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const detail = (errorBody as { detail?: string }).detail || response.statusText;
    throw new Error(`Chef salvage failed (${response.status}): ${detail}`);
  }

  return response.json();
}

/**
 * Check if the Chef is available. Returns false if the server is
 * unreachable, in which case the client falls back to direct
 * Supabase RPC calls.
 */
let _chefAvailable: boolean | null = null;

export async function isChefAvailable(): Promise<boolean> {
  if (_chefAvailable !== null) return _chefAvailable;

  try {
    const response = await fetch(`${CHEF_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    _chefAvailable = response.ok;
  } catch {
    _chefAvailable = false;
  }

  return _chefAvailable;
}

async function getSessionJwt(): Promise<string | undefined> {
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  } catch {
    return undefined;
  }
}
