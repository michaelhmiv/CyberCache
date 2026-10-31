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

import { Capacitor } from '@capacitor/core';
import type { GearItem } from '@/types/items';
import type { BossAttemptResult } from '@/types/boss';
import type { RiskSetting } from '@/types/game';

export const CYBERCACHE_PRODUCTION_API_BASE = 'https://chef-production.up.railway.app';

interface ChefBaseResolutionInput {
  viteChefUrl?: string;
  isNativePlatform?: boolean;
  windowOrigin?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function resolveChefBase({
  viteChefUrl = import.meta.env.VITE_CHEF_URL,
  isNativePlatform = Capacitor.isNativePlatform(),
  windowOrigin = typeof window !== 'undefined' ? window.location.origin : '',
}: ChefBaseResolutionInput = {}): string {
  // Explicit env var takes priority (should be full base URL, e.g. 'https://app.up.railway.app').
  if (viteChefUrl) return normalizeBaseUrl(viteChefUrl);

  // Capacitor serves the native WebView from a local app origin. That origin is
  // correct for static assets but cannot serve Chef routes like /api/settle-offline.
  // Keep all economy-changing calls server-authoritative by sending native builds
  // to the Railway Chef service instead of inventing any client-side fallback.
  if (isNativePlatform) return CYBERCACHE_PRODUCTION_API_BASE;

  // Local Vite dev serves the UI on 5173. Use the Railway Chef service so
  // browser/dev builds can still exercise the authoritative server paths.
  const originUrl = windowOrigin ? new URL(windowOrigin) : null;
  if (originUrl && (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') && originUrl.port && originUrl.port !== '3000') {
    return CYBERCACHE_PRODUCTION_API_BASE;
  }

  // In hosted web production, use the same origin — the Express server handles /api/*.
  if (windowOrigin) return normalizeBaseUrl(windowOrigin);

  // Fallback for SSR / test environments.
  return '';
}

const CHEF_BASE = resolveChefBase();

/** Full API path builder. Express mounts Chef at /api/*, not root. */
export const chefUrl = (path: string) => `${CHEF_BASE}/api${path}`;

export interface ChefClaimRequest {
  playerId: string;
  areaId: string;
  ticks: number;
  tickCount: number;
  playerLevel: number;
  /** Max ticks to process. Omit for default (20); use Infinity for offline settlement. */
  maxTicks?: number;
  /**
   * NOTE (trust hardening, Phase 0 Slice 6): this request deliberately
   * carries NO equippedGear / skillBonuses / idle or activity mods.
   * The Chef derives the loadout and skill bonuses from its own
   * records (equipped item_instances + profiles.skill_spends) and
   * ignores body copies — sending them only invited a forged body to
   * fabricate payouts. What remains is intent + the client-carried
   * simulation state (kill cycle, survival, consumable state) the
   * engine simulates forward from.
   */
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
  /** Prior roaming consumable state (carried from previous claim). */
  roamingConsumableState?: unknown;
  /** Mastery levels for interval reductions. */
  masteryLevels?: Record<string, number>;
  jwt?: string;
}

/**
 * Vehicle outcome of a claim/settlement (0021) — mirrors the Chef's
 * ClaimResult.vehicle. The roaming surface renders status from it:
 * active bonus ticks, fuel, condition, and why the bonus was off.
 */
export interface ChefVehicleStatus {
  equipped: boolean;
  vehicleClassId: string | null;
  activeTicks: number;
  ticks: number;
  fuelUnitsStart: number;
  fuelUnitsRemaining: number;
  fuelConsumed: number;
  conditionStart: number;
  conditionCurrent: number;
  conditionMax: number;
  inactiveReason: 'no_vehicle' | 'out_of_fuel' | null;
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
    /** Killer attribution when THIS claim killed the hunter (else null). */
    killedBy?: { monsterId: string; monsterName: string; areaId: string } | null;
    /** Epoch ms of the killing tick when killedBy is set (else null). */
    diedAt?: number | null;
    medKitBuffer?: number;
    nanoSwarmTicksRemaining?: number;
    adrenalineActive?: boolean;
    shieldCellResistance?: number;
  };
  /**
   * The standing server death record (migration 0013), present when
   * the claim left the hunter dead. Client DeathLogEntry shape plus
   * the server-anchored free-recovery timestamp.
   */
  death?: {
    monsterId: string;
    monsterName: string;
    areaId: string;
    at: number;
    diedAtMs: number;
    freeReadyAtMs: number;
  };
  /** Vehicle outcome for this claim (0021). */
  vehicle?: ChefVehicleStatus;
  /** Consumables consumed during this claim batch. */
  consumedConsumables?: Record<string, number>;
  /** Updated roaming consumable state for next claim's input. */
  roamingConsumableState?: unknown;
  /** Active buff display data for client UI. */
  activeBuffs?: Array<{
    consumableId: string;
    slot: string;
    remainingMs: number;
    remainingBuffer?: number;
    remainingTicks?: number;
    armed?: boolean;
    remainingBurstSeconds?: number;
    ordnanceNextFireSeconds?: number;
  }>;
}

/**
 * Boss attempt INTENT (trust hardening, Phase 0 Slice 6). The client
 * sends only what it legitimately owns: which boss, the idempotency
 * nonce, the prepared consumable counts it chose (the Chef validates
 * them against owned inventory), and its risk setting. Gear slots,
 * skill bonuses, level, credits, and pity are NOT sent — the Chef
 * derives all of them from its own records, because the old
 * pass-through let a forged body fabricate victories.
 */
export interface ChefVerifyBossRequest {
  playerId: string;
  bossId: string;
  attemptNonce: number;
  /** Prepared consumable counts chosen in boss prep (type -> count). */
  consumables: Record<string, number>;
  /** The player's chosen risk setting for this attempt. */
  risk: RiskSetting;
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
  /** Entry fee charged for this attempt (def base fee × today's rematch escalation). */
  entryFee: number;
  /** Victories against this boss on the current UTC day, after this attempt. */
  bossVictoriesToday?: number;
  /** True when the guaranteed victory roll landed on a dedicated drop. */
  dedicatedDropAwarded: boolean;
  unlockedBossId?: string;
  /** True when the attempt nonce was a replay — nothing was applied twice. */
  idempotentReplay?: boolean;
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

/** Idempotency nonce for one resurrection attempt (verifiedOps requestId pattern). */
export function newResurrectNonce(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `resurrect:${random}`;
}

export interface ChefResurrectRequest {
  playerId: string;
  /** 'free' = the 5-minute recovery (server-clock validated); 'paid' = skip it for the area-priced fee (server-charged). */
  method: 'free' | 'paid';
  /** Idempotency nonce (min 8 chars); a replay returns the stored result and never double-charges. */
  nonce: string;
  jwt?: string;
}

export interface ChefResurrectResult {
  resurrected: true;
  verified: true;
  method: 'free' | 'paid';
  /** Credits the server actually charged (0 on the free path). */
  creditsCharged: number;
  /** The death record this resurrection cleared (DeathLogEntry shape). */
  death: { monsterId: string; monsterName: string; areaId: string; at: number } | null;
  /** Canonical server death log (newest first) after the resurrection. */
  deathLog: Array<{ monsterId: string; monsterName: string; areaId: string; at: number }>;
  /** Canonical profile snapshot after the resurrection (paid charge applied). */
  profile: Record<string, unknown> | null;
  /** True when the nonce was a replay — nothing was applied twice. */
  idempotentReplay?: boolean;
}

/**
 * Resurrect via the Chef server — the ONLY resurrection path. The
 * server requires its own recorded death, validates the free timer
 * against its own clock, and charges the paid path itself; the
 * client sends intent (method + nonce) and syncs the returned
 * canonical state. Throws with the server's error message on
 * rejection (no death recorded, timer not ready, insufficient
 * credits).
 */
export async function resurrectViaChef(request: ChefResurrectRequest): Promise<ChefResurrectResult> {
  const jwt = request.jwt || (await getSessionJwt());

  const response = await fetch(chefUrl('/resurrect'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ ...request, jwt }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const body = errorBody as { error?: string; detail?: string };
    const detail = body.detail || body.error || response.statusText;
    throw new Error(`Chef resurrection failed (${response.status}): ${detail}`);
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

// --- Offline Settlement ---

export interface OfflineSettlementRequest {
  playerId: string;
  /** Client-generated idempotency nonce (UUID). */
  settlementNonce: string;
  jwt?: string;
}

export interface OfflineSettlementResult {
  settled: true;
  areaId: string;
  areaName: string;
  /** Human-readable time away (e.g. "2h 34m"). */
  timeAway: string;
  /** Milliseconds of elapsed time used for settlement. */
  elapsedMs: number;
  /** Milliseconds of elapsed time before cap was applied. */
  cappedMs: number;
  /** Whether the offline cap was reached. */
  capReached: boolean;
  /** Offline cap in hours. */
  capHours: number;
  /** Number of ticks settled. */
  ticksSettled: number;
  /** Starting tick (last_claimed_tick before settlement). */
  startTick: number;
  /** Ending tick (last_claimed_tick after settlement). */
  endTick: number;
  /** Server-authoritative profile snapshot after settlement. */
  profile: Record<string, unknown>;
  /** Rewards earned. */
  rewards: {
    creditsAwarded: number;
    scrapAwarded: number;
    xpAwarded: number;
    cacheFragmentsAwarded: number;
    materials: Record<string, number>;
    essences: Record<string, number>;
    killsRecorded: number;
    ticks: number;
  };
  /** Items generated during settlement. */
  items: GearItem[];
  /** Vehicle outcome for this settlement (0021) — same math as live claims. */
  vehicle?: ChefVehicleStatus;
  /** Feed events for UI display. */
  feedEvents: ChefClaimResult['feedEvents'];
  /** Whether this is a cached (idempotent) result. */
  idempotent: boolean;
}

export type OfflineSettlementNoOp = {
  settled: false;
  reason: 'not_roaming' | 'no_elapsed' | 'error';
  detail?: string;
};

/**
 * Request server-authoritative offline settlement.
 *
 * The server computes elapsed time using DB timestamps (not client
 * Date.now()), processes all eligible ticks (capped by offline_cap_hours,
 * NOT by the 20-tick foreground limit), and returns a full settlement
 * summary. Idempotent — sending the same nonce twice returns the cached
 * result without double-awarding rewards.
 */
export async function settleOffline(
  request: OfflineSettlementRequest,
): Promise<OfflineSettlementResult | OfflineSettlementNoOp> {
  const jwt = request.jwt || (await getSessionJwt());

  const response = await fetch(chefUrl('/settle-offline'), {
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
    throw new Error(`Chef offline settlement failed (${response.status}): ${detail}`);
  }

  return response.json();
}

/**
 * Check if the Chef is available. Returns false if the server is
 * unreachable, in which case the client falls back to the verified
 * ops API surface (src/lib/api/verifiedOps).
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
    // Route B (B4): the session is the Chef's own token now, owned by
    // the api session store. Hydrate from durable storage if the
    // in-memory copy has not been loaded yet this run.
    const { getAccessTokenSync, loadStoredSession } = await import('@/lib/api/session');
    return getAccessTokenSync() ?? (await loadStoredSession())?.accessToken ?? undefined;
  } catch {
    return undefined;
  }
}
