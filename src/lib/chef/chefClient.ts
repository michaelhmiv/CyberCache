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
import type { BossAttemptResult } from '@/types/boss';
import type { BossSimulationInput } from '@/lib/simulation/bossSimulator';

const CHEF_BASE = (() => {
  // Explicit env var takes priority (should be full base URL, e.g. 'https://app.up.railway.app')
  if (import.meta.env.VITE_CHEF_URL) return import.meta.env.VITE_CHEF_URL;
  // In production, use the same origin — the Express server handles /api/*
  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }
  // Fallback for SSR / test environments
  return '';
})();

/** Full API path builder. Express mounts Chef at /api/*, not root. */
const chefUrl = (path: string) => `${CHEF_BASE}/api${path}`;

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
  skillBonuses?: Record<string, number>;
  activityMods?: Record<string, number>;
  equippedGear?: GearItem[];
  /** Effective DPS from the client's loadout (for kill cycle simulation). */
  effectiveDps?: number;
  /** Current kill cycle state from the client. */
  killCycle?: {
    currentTargetId: string | null;
    currentTargetHp: number;
    currentTargetHpMax: number;
    monstersKilledCount: number;
    totalKills: number;
    lastKilledMonsterId: string | null;
  };
  /** Current survival HP and shield from the client. */
  survival?: {
    currentHp: number;
    shieldHp: number;
    maxHp: number;
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
  /** Server-authoritative kill cycle state for client synchronization. */
  killCycle?: {
    currentTargetId: string | null;
    currentTargetHp: number;
    currentTargetHpMax: number;
    monstersKilledCount: number;
    totalKills: number;
    lastKilledMonsterId: string | null;
  };
  /** Server-authoritative survival HP for client synchronization. */
  survival?: {
    currentHp: number;
    shieldHp: number;
    isDead?: boolean;
  };
}

export interface ChefVerifyBossRequest extends Omit<BossSimulationInput, 'boss'> {
  playerId: string;
  bossId: string;
  attemptNonce: number;
  jwt?: string;
}

export interface ChefVerifyBossResult {
  actionType: 'cc_apply_boss_attempt';
  verified: boolean;
  victory: boolean;
  result: BossAttemptResult;
  creditsDelta: number;
  xpAwarded: number;
  loot: GearItem[];
  items: GearItem[];
  consumedConsumables: Record<string, number>;
  extraLoot: boolean;
  bonusLootRolls: number;
  profile?: Record<string, unknown>;
  pityIncremented: boolean;
  telemetry: {
    serverRolled: true;
    adjustedWinChance: number;
    effectiveDps: number;
    timeToKill: number;
  };
  reason?: string;
}

/**
 * Submit a roaming tick claim to the Chef.
 */
export async function submitClaim(request: ChefClaimRequest): Promise<ChefClaimResult> {
  const jwt = request.jwt || (await getSessionJwt());

  const response = await fetch(chefUrl('/claim'), {
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

  const response = await fetch(chefUrl('/verify-boss'), {
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

  const response = await fetch(chefUrl('/salvage'), {
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
    const response = await fetch(chefUrl('/health'), {
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
