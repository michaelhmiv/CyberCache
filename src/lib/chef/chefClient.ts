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
    /** Nova arm state round-trip (Phase 2c). */
    shieldNovaArmed?: boolean;
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
    /** Roaming-event fields (overhaul): present on event/event_major beats. */
    eventId?: string;
    family?: string;
    propId?: string;
    hint?: boolean;
  }>;
  /** Roaming events fired during the claim (overhaul), for telemetry/debug surfaces. */
  eventsFired?: Array<{ eventId: string; name: string; family: string; tick: number }>;
  /** Escalated named-elite kills during the claim (overhaul). */
  eliteKills?: number;
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
    /** Nova arm state at claim end (Phase 2c). */
    shieldNovaArmed?: boolean;
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
  /**
   * Action skill fire INTENT (0030): true arms the attempt to spend
   * the player's charged signature inside this resolution. The tree,
   * qualification, and charge all come from server records — the
   * client never names them.
   */
  fireActionSkill?: boolean;
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
  /** Action skill state echo (0030): the server's record after this attempt. */
  actionSkill?: ChefActionSkillEcho;
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
 * Offline CRAFT settlement (crafting-as-occupation, 0024): when the
 * recorded action was crafting, settle-offline advances the player's
 * craft jobs through the settler under the same effective offline cap
 * (flag F5) and returns the completions for the recap's crafting
 * section instead of a roaming result.
 */
export interface OfflineCraftSettlementResult {
  settled: true;
  crafting: {
    advancedMs: number;
    xpAwarded: number;
    jobsCompleted: number;
    completions: Array<Record<string, unknown>>;
    capHours: number;
  };
}

/**
 * Offline EXTRACTION settlement (0033): when the recorded action
 * was extraction, settle-offline advances the player's passes under
 * the same effective offline cap and returns the finalized batch
 * for the recap's extraction section.
 */
export interface OfflineExtractionSettlementResult {
  settled: true;
  extraction: {
    advancedMs: number;
    xpAwarded: number;
    passesCompleted: number;
    passes: ChefExtractionPass[];
    materials: Record<string, number>;
    essences: Record<string, number>;
    capHours: number;
  };
}

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
): Promise<OfflineSettlementResult | OfflineCraftSettlementResult | OfflineExtractionSettlementResult | OfflineSettlementNoOp> {
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

  return response.json() as Promise<OfflineSettlementResult | OfflineCraftSettlementResult | OfflineExtractionSettlementResult | OfflineSettlementNoOp>;
}

/**
 * Endless mode (0028) — the Chaos Chamber. The client sends INTENT
 * only: a nonce and, at entry, the prepared belt choice. Depth,
 * rewards, and payouts are server facts in every response; the run
 * object below is the server's own row snapshot.
 */
export interface ChefEndlessRun {
  id: string;
  status: 'active' | 'banked' | 'died' | 'abandoned';
  started_at: string;
  ended_at: string | null;
  start_level: number;
  risk: string;
  prepared_consumables: Record<string, number>;
  depth_reached: number;
  escrow_credits: number;
  escrow_xp: number;
  escrow_scrap: number;
  entry_fee: number;
  milestone_drops: Array<{ depth: number; rarity: string; kind: string; name: string }>;
  paid_credits: number;
  paid_xp: number;
  paid_scrap: number;
  payout_fraction: number | null;
}

export interface ChefEndlessPayout {
  credits: number;
  xp: number;
  scrap: number;
  fraction: number;
}

export interface ChefStartEndlessResult {
  verified: true;
  run: ChefEndlessRun;
  entryFee: number;
  runsStartedToday: number;
  abandonedSettlement: {
    run_id: string;
    depth_reached: number;
    payout: ChefEndlessPayout;
  } | null;
  profile?: Record<string, unknown>;
  idempotentReplay?: boolean;
}

export interface ChefEndlessEncounterResult {
  verified: true;
  encounter?: {
    depth: number;
    kind: 'pack' | 'boss';
    id: string;
    name: string;
    areaId: string;
    level: number;
    health: number;
    shield: number;
    armor: number;
    dps: number;
    weaknesses: string[];
    resistances: string[];
    mechanicName: string;
  };
  result?: {
    id: string;
    depth: number;
    bossId: string;
    victory: boolean;
    winChance: number;
    phaseFailed?: string;
    bossHpRemaining?: number;
    reasons: string[];
    recommendations: string[];
    /** Action skill fire facts (0030), present when a signature fired. */
    actionSkill?: {
      tree: string;
      name: string;
      fired: boolean;
      surgeRolls?: number;
      surgeLoot?: string[];
      qualityMultiplier?: number;
    };
  };
  victory: boolean;
  rewards: { xp: number; credits: number; scrap: number };
  milestone?: boolean;
  capReached?: boolean;
  items: GearItem[];
  escrow: { credits: number; xp: number; scrap: number };
  runStatus: ChefEndlessRun['status'];
  payout: ChefEndlessPayout | null;
  profile?: Record<string, unknown>;
  run: ChefEndlessRun;
  /** Action skill state echo (0030): charge after this encounter. */
  actionSkill?: ChefActionSkillEcho;
  idempotentReplay?: boolean;
  telemetry?: { serverRolled: true; adjustedWinChance: number; effectiveDps: number; timeToKill: number };
}

export interface ChefBankEndlessResult {
  verified: true;
  ended: true;
  runId: string;
  depthReached: number;
  payout: ChefEndlessPayout;
  profile?: Record<string, unknown>;
  run: ChefEndlessRun;
  /** Action skill state echo (0030): banking resets the pool to 0. */
  actionSkill?: ChefActionSkillEcho;
  idempotentReplay?: boolean;
}

export interface ChefEndlessMeResult {
  verified: true;
  intel: import('@/content/endless').EndlessIntel;
  bestDepth: number;
  runsStartedToday: number;
  recentRuns: ChefEndlessRun[];
  activeRun: ChefEndlessRun | null;
  /** The player's action skill state view (0030). */
  actionSkill?: import('@/content/actionSkills').ActionSkillStateView;
}

/** Idempotency nonce for one endless call — unique per tap, stable per send. */
export function newEndlessNonce(kind: 'start' | 'encounter' | 'bank'): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `endless-${kind}:${random}`;
}

async function endlessFetch<T>(path: string, init: RequestInit, failureLabel: string): Promise<T> {
  const jwt = await getSessionJwt();
  const response = await fetch(chefUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const detail =
      (errorBody as { detail?: string }).detail ||
      (errorBody as { error?: string }).error ||
      response.statusText;
    throw new Error(`${failureLabel} (${response.status}): ${detail}`);
  }
  return response.json() as Promise<T>;
}

export async function startEndlessRun(request: {
  nonce: string;
  consumables: Record<string, number>;
  risk: RiskSetting;
}): Promise<ChefStartEndlessResult> {
  return endlessFetch<ChefStartEndlessResult>(
    '/endless/start',
    { method: 'POST', body: JSON.stringify(request) },
    'Chef endless start failed',
  );
}

export async function advanceEndlessEncounter(request: {
  nonce: string;
  /** Action skill fire INTENT (0030) — see ChefVerifyBossRequest. */
  fireActionSkill?: boolean;
}): Promise<ChefEndlessEncounterResult> {
  return endlessFetch<ChefEndlessEncounterResult>(
    '/endless/encounter',
    { method: 'POST', body: JSON.stringify(request) },
    'Chef endless encounter failed',
  );
}

export async function bankEndlessRun(request: { nonce: string }): Promise<ChefBankEndlessResult> {
  return endlessFetch<ChefBankEndlessResult>(
    '/endless/bank',
    { method: 'POST', body: JSON.stringify(request) },
    'Chef endless bank failed',
  );
}

export async function getEndlessMe(): Promise<ChefEndlessMeResult> {
  return endlessFetch<ChefEndlessMeResult>('/endless/me', { method: 'GET' }, 'Chef endless facts failed');
}

/**
 * Action skills (0030). One signature charged ability per skill
 * tree. The client only ever sends intent (select a tree, arm a
 * fire, fire the workshop) — qualification, charge, and effects are
 * server facts in every response.
 */
export interface ChefActionSkillEcho {
  selection: string | null;
  charge: number;
}

export interface ChefActionSkillStateResult {
  verified: true;
  actionSkill: import('@/content/actionSkills').ActionSkillStateView;
}

export interface ChefSelectActionSkillResult {
  verified: true;
  selection: string | null;
  actionSkill: import('@/content/actionSkills').ActionSkillStateView;
  idempotentReplay?: boolean;
}

export interface ChefFireOverclockWorkshopResult {
  fired: true;
  completions: Array<Record<string, unknown>>;
  jobsCompleted: number;
  /** True when the nonce was a replay — nothing fired twice. */
  idempotentReplay?: boolean;
}

export interface ChefCacheRankStateResult {
  verified: true;
  cacheRank: import('@/content/cacheRank').CacheRankStateView;
}

export interface ChefSpendCacheRankResult {
  verified: true;
  spent: { bonusId: string; rankAfter: number | null; cost: number | null };
  cacheRank: import('@/content/cacheRank').CacheRankStateView | null;
}

/** Idempotency nonce for one Cache Rank spend — unique per tap, stable per send. */
export function newCacheRankNonce(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `cache-rank-spend:${random}`;
}

export async function getCacheRankState(): Promise<ChefCacheRankStateResult> {
  return endlessFetch<ChefCacheRankStateResult>(
    '/cache-rank/me',
    { method: 'GET' },
    'Chef cache rank facts failed',
  );
}

export async function spendCacheRankBonus(request: {
  nonce: string;
  bonusId: string;
}): Promise<ChefSpendCacheRankResult> {
  return endlessFetch<ChefSpendCacheRankResult>(
    '/cache-rank/spend',
    { method: 'POST', body: JSON.stringify(request) },
    'Chef cache rank spend failed',
  );
}

/**
 * Login streak (0036). The daily check-in is an observe-and-record
 * read: the first authenticated call of a UTC day grants the
 * ladder reward server-side (exactly-once per day); the response
 * carries the state view, what the check-in granted, and the
 * profile snapshot to sync.
 */
export interface ChefLoginStreakResult {
  verified: true;
  loginStreak: import('@/content/loginStreak').LoginStreakStateView;
  granted: {
    alreadyClaimed: boolean;
    streakLength: number | null;
    cycleDay: number | null;
    tier: number | null;
    creditsAwarded: number;
    fragmentsAwarded: number;
    cacheKeysAwarded: number;
  };
  profile: Record<string, unknown> | null;
}

export async function getLoginStreakState(): Promise<ChefLoginStreakResult> {
  return endlessFetch<ChefLoginStreakResult>(
    '/login-streak/me',
    { method: 'GET' },
    'Chef login streak failed',
  );
}

/**
 * Dispatch (0032). Timed contracts for spare loadouts (foot) and
 * spare vehicles (courier). The client sends intent only — an offer
 * id, item/vehicle ids, a nonce; every term (payouts, fuel, wear,
 * breakdown) is computed server-side from server records and comes
 * back in the responses below.
 */
export interface ChefDispatchOffer {
  id: string;
  family: 'foot' | 'courier';
  areaId: string;
  durationHours: number;
  areaName: string;
  dangerRating: string;
  areaUnlockLevel: number;
  areaLocked: boolean;
}

export interface ChefDispatchMission {
  id: string;
  contract_family: string;
  offer_id: string;
  destination_area_id: string;
  duration_hours: number;
  status: string;
  loadout_item_ids: string[];
  payout_credits: number;
  payout_scrap: number;
  payout_material_id: string | null;
  payout_material_units: number;
  vehicle_item_id: string | null;
  vehicle_class_id: string | null;
  fuel_charged_units: number;
  fuel_refunded_units: number;
  wear_projected: number | null;
  wear_applied: number | null;
  breakdown_fraction: number | null;
  payout_fraction: number | null;
  departed_at: string;
  ends_at: string;
  settled_at: string | null;
}

export interface ChefDispatchCandidate {
  id: string;
  kind: string;
  name: string;
  itemLevel: number;
  rarity: string | null;
  runtimeState: string;
  equippedSlot: string | null;
  isLocked: boolean;
  vehicleClassId: string | null;
  conditionCurrent: number | null;
  conditionMax: number | null;
}

export interface ChefDispatchState {
  slots: number;
  slotsUsed: number;
  playerLevel: number;
  vehicleFuel: number;
  offers: ChefDispatchOffer[];
  missions: ChefDispatchMission[];
  candidates: ChefDispatchCandidate[];
}

export interface ChefDispatchStateResult {
  verified: true;
  dispatch: ChefDispatchState;
}

export interface ChefDispatchPreviewResult {
  verified: true;
  eligible: boolean;
  reasons: string[];
  preview: Record<string, unknown>;
}

export interface ChefDispatchStartResult {
  verified: true;
  departed: Record<string, unknown>;
  dispatch: ChefDispatchState | null;
}

export interface ChefDispatchRecallResult {
  verified: true;
  settlement: Record<string, unknown>;
  dispatch: ChefDispatchState | null;
}

/** Idempotency nonce for one dispatch call — unique per tap, stable per send. */
export function newDispatchNonce(kind: 'start' | 'recall'): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `dispatch-${kind}:${random}`;
}

export async function getDispatchState(): Promise<ChefDispatchStateResult> {
  return endlessFetch<ChefDispatchStateResult>(
    '/dispatch/me',
    { method: 'GET' },
    'Chef dispatch facts failed',
  );
}

export async function previewDispatch(request: {
  offerId: string;
  itemIds?: string[];
  vehicleItemId?: string | null;
}): Promise<ChefDispatchPreviewResult> {
  return endlessFetch<ChefDispatchPreviewResult>(
    '/dispatch/preview',
    { method: 'POST', body: JSON.stringify(request) },
    'Chef dispatch preview failed',
  );
}

export async function startDispatch(request: {
  nonce: string;
  offerId: string;
  itemIds?: string[];
  vehicleItemId?: string | null;
}): Promise<ChefDispatchStartResult> {
  return endlessFetch<ChefDispatchStartResult>(
    '/dispatch/start',
    { method: 'POST', body: JSON.stringify(request) },
    'Chef dispatch start failed',
  );
}

export async function recallDispatch(request: {
  nonce: string;
  missionId: string;
}): Promise<ChefDispatchRecallResult> {
  return endlessFetch<ChefDispatchRecallResult>(
    '/dispatch/recall',
    { method: 'POST', body: JSON.stringify(request) },
    'Chef dispatch recall failed',
  );
}

/**
 * Extraction (0033). The gathering occupation's one read: it settles
 * first (accrual + finalization of completed passes), then returns
 * the state row, the mastery facts, a content-owner preview priced
 * from the current loadout, and the batch this read just settled.
 * Starting/switching rides the ordinary activity path
 * (activityService.startActiveActivity with kind 'extraction').
 */
export interface ChefExtractionPass {
  index: number;
  areaId: string;
  method: 'surface' | 'deep' | string;
  draws: number;
  gearFactor: number;
  deepDegraded: boolean;
  xpAwarded: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
  signatureUnits: number;
}

export interface ChefExtractionPreview {
  areaId: string;
  areaName: string;
  method: 'surface' | 'deep' | string;
  gearFactor: number;
  survivalPool: number;
  expectedPassDamage: number;
  drawsPerPass: number;
  xpPerPass: number;
  deepDegraded: boolean;
  deepUnlocked: boolean;
  isHot: boolean;
}

export interface ChefExtractionState {
  active: boolean;
  hasState: boolean;
  areaId: string | null;
  method: 'surface' | 'deep' | string;
  passAreaId: string | null;
  passMethod: 'surface' | 'deep' | string;
  accruedMs: number;
  passMs: number;
  pendingPasses: number;
  finalizedPasses: number;
  totalXpAwarded: number;
  mastery: { level: number; xp: number };
  preview: ChefExtractionPreview | null;
  settled: {
    advancedMs: number;
    xpAwarded: number;
    materials: Record<string, number>;
    essences: Record<string, number>;
    passes: ChefExtractionPass[];
  };
}

export interface ChefExtractionStateResult {
  verified: true;
  extraction: ChefExtractionState;
}

export async function getExtractionState(): Promise<ChefExtractionStateResult> {
  return endlessFetch<ChefExtractionStateResult>(
    '/extraction/state',
    { method: 'GET' },
    'Chef extraction state failed',
  );
}

/** Idempotency nonce for one action-skill call — unique per tap, stable per send. */
export function newActionSkillNonce(kind: 'select' | 'workshop'): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `action-skill-${kind}:${random}`;
}

export async function getActionSkillState(): Promise<ChefActionSkillStateResult> {
  return endlessFetch<ChefActionSkillStateResult>(
    '/action-skill/me',
    { method: 'GET' },
    'Chef action skill facts failed',
  );
}

export async function selectActionSkill(request: {
  nonce: string;
  /** One of the four trees, or null to clear the selection. */
  tree: string | null;
}): Promise<ChefSelectActionSkillResult> {
  return endlessFetch<ChefSelectActionSkillResult>(
    '/action-skill/select',
    { method: 'POST', body: JSON.stringify(request) },
    'Chef action skill selection failed',
  );
}

export async function fireOverclockWorkshop(request: { nonce: string }): Promise<ChefFireOverclockWorkshopResult> {
  return endlessFetch<ChefFireOverclockWorkshopResult>(
    '/action-skill/fire-workshop',
    { method: 'POST', body: JSON.stringify(request) },
    'Chef Overclock workshop fire failed',
  );
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
