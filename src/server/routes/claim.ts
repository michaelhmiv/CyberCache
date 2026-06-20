import { Express, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { processBossAttempt, processRoamingClaim, type BossAttemptRequest, type ClaimRequest, type ClaimResult } from '../chef';

let _supabase: SupabaseClient | null = null;

class ChefRouteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const key = process.env.VITE_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) {
      throw new Error('[chef] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    _supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supabase;
}

function requestJwt(req: Request, bodyJwt?: string): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice('bearer '.length).trim();
  }
  return bodyJwt;
}

async function applyJwt(supabase: SupabaseClient, jwt?: string): Promise<void> {
  if (!jwt) return;
  await supabase.auth.setSession({ access_token: jwt, refresh_token: '' });
}

async function requireAuthenticatedPlayerId(
  supabase: SupabaseClient,
  req: Request,
  bodyJwt?: string,
  claimedPlayerId?: string,
): Promise<string> {
  const jwt = requestJwt(req, bodyJwt);
  if (!jwt) {
    throw new ChefRouteError(401, 'Authentication required', 'Missing bearer token');
  }

  const { data, error } = await supabase.auth.getUser(jwt);
  const authedPlayerId = data.user?.id;
  if (error || !authedPlayerId) {
    throw new ChefRouteError(401, 'Authentication required', error?.message ?? 'Invalid bearer token');
  }

  if (claimedPlayerId && claimedPlayerId !== authedPlayerId) {
    throw new ChefRouteError(403, 'Player mismatch', 'Request playerId does not match the authenticated user');
  }

  await applyJwt(supabase, jwt);
  return authedPlayerId;
}

function sendRouteError(res: Response, fallback: string, err: unknown): void {
  if (err instanceof ChefRouteError) {
    res.status(err.status).json({ error: err.message, detail: err.detail });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: fallback, detail: message });
}

async function handleClaim(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as ClaimRequest & { jwt?: string };
    if (!body.areaId || !body.ticks || body.tickCount == null) {
      res.status(400).json({ error: 'Missing required fields: areaId, ticks, tickCount' });
      return;
    }

    const supabase = getSupabase();
    const playerId = await requireAuthenticatedPlayerId(supabase, req, body.jwt, body.playerId);
    const claim: ClaimRequest = { ...body, playerId };

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('last_claimed_tick, consumables')
      .eq('id', playerId)
      .single();

    if (profileError) {
      res.status(500).json({ error: 'Failed to read profile', detail: profileError.message });
      return;
    }

    if (profile && body.tickCount <= profile.last_claimed_tick) {
      res.status(409).json({ error: 'tick_count already claimed', lastClaimedTick: profile.last_claimed_tick });
      return;
    }

    // Read server-authoritative consumable inventory from profiles.consumables
    const consumableInventory = (profile?.consumables ?? {}) as Record<string, number>;

    // Merge inventory + roaming state into the claim
    const claimWithConsumables: ClaimRequest = {
      ...claim,
      consumableInventory,
      roamingConsumableState: body.roamingConsumableState,
      masteryLevels: body.masteryLevels,
    };

    const result = processRoamingClaim(claimWithConsumables);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('cc_apply_chef_rewards', {
      _player_id: playerId,
      _credits: result.rewards.creditsAwarded,
      _scrap: result.rewards.scrapAwarded,
      _xp: result.rewards.xpAwarded,
      _fragments: result.rewards.cacheFragmentsAwarded,
      _materials: result.rewards.materials,
      _essences: result.rewards.essences,
      _kills: result.rewards.killsRecorded,
      _tick_count: body.tickCount,
      _area_id: body.areaId,
    });

    if (rpcError) {
      res.status(500).json({ error: 'Failed to apply rewards', detail: rpcError.message });
      return;
    }

    if (result.items.length > 0) {
      const { error: storeError } = await supabase.rpc('cc_store_chef_items', {
        _player_id: playerId,
        _items: result.items,
      });
      if (storeError) {
        console.error('[chef] Failed to store items:', storeError.message);
        res.status(500).json({
          error: 'Failed to store generated items',
          detail: storeError.message,
          profile: rpcResult?.profile ?? rpcResult,
          rewards: result.rewards,
        });
        return;
      }
    }

    // Persist consumable consumption atomically (server-authoritative)
    const consumedConsumables = (result as ClaimResult).consumedConsumables;
    if (consumedConsumables && Object.keys(consumedConsumables).length > 0) {
      const { error: consumeError } = await supabase.rpc('cc_consume_roaming_consumables', {
        _player_id: playerId,
        _consumed: consumedConsumables,
        _area_id: body.areaId,
        _tick_count: body.tickCount,
      });
      if (consumeError) {
        console.error('[chef] Failed to consume roaming consumables:', consumeError.message);
      }
    }

    res.json({
      ...result,
      profile: rpcResult?.profile ?? rpcResult,
      consumedConsumables,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chef] claim error:', message);
    sendRouteError(res, 'Chef processing failed', err);
  }
}

async function handleVerifyBoss(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as BossAttemptRequest & { jwt?: string };
    if (!body.bossId) {
      res.status(400).json({ error: 'Missing required field: bossId' });
      return;
    }

    const supabase = getSupabase();
    const playerId = await requireAuthenticatedPlayerId(supabase, req, body.jwt, body.playerId);

    const attemptNonce = body.attemptNonce || Date.now();
    const request: BossAttemptRequest = { ...body, playerId, attemptNonce };
    const result = processBossAttempt(request);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('cc_apply_chef_boss_attempt', {
      _player_id: playerId,
      _boss_id: body.bossId,
      _attempt_nonce: attemptNonce,
      _victory: result.result.victory,
      _credits_delta: result.creditsDelta,
      _xp: result.xpAwarded,
      _consumables: result.consumedConsumables,
      _attempt: result.result,
      _unlocked_boss_id: result.unlockedBossId ?? null,
    });

    if (rpcError) {
      res.status(500).json({ error: 'Failed to apply boss attempt', detail: rpcError.message });
      return;
    }

    if (result.items.length > 0) {
      const { error: storeError } = await supabase.rpc('cc_store_chef_items', {
        _player_id: playerId,
        _items: result.items,
      });
      if (storeError) {
        console.error('[chef] Failed to store boss loot:', storeError.message);
        res.status(500).json({
          error: 'Failed to store boss loot items',
          detail: storeError.message,
          profile: rpcResult?.profile ?? rpcResult,
          victory: result.result.victory,
        });
        return;
      }
    }

    res.json({
      ...result,
      verified: true,
      victory: result.result.victory,
      pityIncremented: !result.result.victory,
      profile: rpcResult?.profile ?? rpcResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chef] boss verify error:', message);
    sendRouteError(res, 'Boss verification failed', err);
  }
}

async function handleSalvage(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { playerId?: string; itemId: string; jwt?: string; nonce?: string };
    if (!body.itemId) {
      res.status(400).json({ error: 'Missing itemId' });
      return;
    }

    const supabase = getSupabase();
    const playerId = await requireAuthenticatedPlayerId(supabase, req, body.jwt, body.playerId);
    const nonce = body.nonce || `salvage:${playerId}:${body.itemId}:${Date.now()}`;

    // Keep salvage on the same verified path as the rest of item mutation.
    // This fixes the stale `player_items` / `owner_id` route that no longer
    // matches the live Supabase schema (`item_instances.owner_user_id`).
    const { data: recycleResult, error: recycleError } = await supabase.rpc('cc_recycle_item', {
      nonce,
      item_id: body.itemId,
    });

    if (recycleError) {
      res.status(500).json({ error: 'Failed to recycle item', detail: recycleError.message });
      return;
    }

    const result = recycleResult as Record<string, unknown> | null;
    res.json({
      salvaged: true,
      verified: true,
      itemId: body.itemId,
      scrapValue: Number(result?.scrap_award ?? 0),
      materials: {},
      essences: {},
      profile: result?.profile,
      item: result?.item,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chef] salvage error:', message);
    sendRouteError(res, 'Salvage failed', err);
  }
}

/**
 * Format milliseconds as a human-readable time-away string.
 * e.g. 9240000 → "2h 34m"
 */
function formatTimeAway(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

async function handleSettleOffline(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { playerId?: string; settlementNonce?: string; jwt?: string };
    if (!body.settlementNonce) {
      res.status(400).json({ error: 'Missing settlementNonce' });
      return;
    }

    const supabase = getSupabase();
    const playerId = await requireAuthenticatedPlayerId(supabase, req, body.jwt, body.playerId);

    // --- Idempotency check ---
    const { data: idemProfile, error: idemError } = await supabase
      .from('profiles')
      .select('last_settlement_nonce, last_roaming_settled_at')
      .eq('id', playerId)
      .single();

    if (idemError && (idemError as { code?: string }).code !== 'PGRST116') {
      res.status(500).json({ error: 'Failed to read profile', detail: idemError.message });
      return;
    }

    if (idemProfile?.last_settlement_nonce === body.settlementNonce) {
      // Nonce already processed — return no-op (idempotent). The client
      // should have the cached result from the previous response.
      console.log('[chef] settlement idempotent — nonce already processed', {
        playerId, nonce: body.settlementNonce,
      });
      res.json({
        settled: false,
        reason: 'idempotent',
        detail: 'This settlement nonce was already processed. Refresh if you need updated rewards.',
      });
      return;
    }

    // --- Read active action ---
    // Live schema uses user_id (not player_id) and active_action (not kind).
    // These are the canonical column names as defined by the active_actions table
    // and the cc_set_active_action / cc_clear_active_action RPCs.
    const { data: activeAction, error: actionError } = await supabase
      .from('active_actions')
      .select('user_id, active_action, target_id, started_at, last_heartbeat_at, activity_payload')
      .eq('user_id', playerId)
      .maybeSingle();

    if (actionError) {
      res.status(500).json({ error: 'Failed to read active action', detail: actionError.message });
      return;
    }

    const activityKind = activeAction?.active_action;

    if (!activeAction || activityKind !== 'roaming_loot') {
      console.log('[chef] settlement no-op — not roaming', { playerId, active_action: activityKind });
      res.json({ settled: false, reason: 'not_roaming' });
      return;
    }

    // --- Read full profile for economy state ---
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', playerId)
      .single();

    if (profileError) {
      res.status(500).json({ error: 'Failed to read profile', detail: profileError.message });
      return;
    }

    // --- Compute elapsed time using server-authoritative timestamps ---
    const settleFrom = profile.last_roaming_settled_at || activeAction.started_at;
    if (!settleFrom) {
      res.json({ settled: false, reason: 'no_elapsed', detail: 'No settlement start timestamp' });
      return;
    }

    const settleFromMs = new Date(settleFrom).getTime();
    const nowMs = Date.now();
    const capHours = Number(profile.offline_cap_hours) || 2;
    const capMs = capHours * 60 * 60 * 1000;
    const rawElapsedMs = Math.max(0, nowMs - settleFromMs);
    const elapsedMs = Math.min(rawElapsedMs, capMs);
    const capReached = rawElapsedMs > capMs;

    const TICK_MS = 3000;
    const ticksRequested = Math.floor(elapsedMs / TICK_MS);

    if (ticksRequested <= 0) {
      console.log('[chef] settlement no-op — no elapsed ticks', { playerId, elapsedMs });
      res.json({ settled: false, reason: 'no_elapsed' });
      return;
    }

    // --- Process all eligible ticks (no 20-tick clamp!) ---
    const area = await import('../../constants/roamingAreas').then((m) => m.getRoamingArea(activeAction.target_id));
    const areaId = area.id;
    const areaName = area.name;

    // Read consumable inventory from profile (server-authoritative)
    const consumableInventory = (profile.consumables ?? {}) as Record<string, number>;
    const claim: ClaimRequest = {
      playerId,
      areaId,
      ticks: ticksRequested,
      tickCount: (profile.last_claimed_tick || 0) + ticksRequested,
      playerLevel: profile.player_level || 1,
      maxTicks: Infinity, // ← NO 20-TICK CLAMP for offline settlement
      effectiveDps: 0, // offline settlement skips combat simulation
      consumableInventory,
    };

    const result = processRoamingClaim(claim);

    // Persist consumable consumption for offline settlement
    const offlineConsumed = result.consumedConsumables;
    if (offlineConsumed && Object.keys(offlineConsumed).length > 0) {
      const { error: consumeError } = await supabase.rpc('cc_consume_roaming_consumables', {
        _player_id: playerId,
        _consumed: offlineConsumed,
        _area_id: areaId,
        _tick_count: (profile.last_claimed_tick || 0) + ticksRequested,
      });
      if (consumeError) console.error('[chef] settlement consume consumables failed:', consumeError.message);
    }

    // --- Persist rewards atomically via cc_settle_offline_roaming ---
    // This RPC locks the profile + active action, re-verifies roaming,
    // re-computes elapsed using DB now(), applies the offline cap,
    // applies rewards, and updates last_claimed_tick + last_roaming_settled_at
    // + last_settlement_nonce in a single atomic transaction.
    // Idempotency: sending the same nonce twice returns the cached result.
    const { data: atomicResult, error: atomicError } = await supabase.rpc(
      'cc_settle_offline_roaming',
      {
        _settlement_nonce: body.settlementNonce,
        _credits: result.rewards.creditsAwarded,
        _scrap: result.rewards.scrapAwarded,
        _xp: result.rewards.xpAwarded,
        _fragments: result.rewards.cacheFragmentsAwarded,
        _materials: result.rewards.materials,
        _essences: result.rewards.essences,
        _kills: result.rewards.killsRecorded,
      },
    );

    if (atomicError) {
      res.status(500).json({ error: 'Atomic settlement failed', detail: atomicError.message });
      return;
    }

    const settlement = atomicResult as Record<string, unknown> | null;

    // RPC may return no-op (not_roaming, no_elapsed, idempotent)
    if (!settlement || !settlement.settled) {
      const reason = (settlement?.reason as string) || 'error';
      console.log('[chef] settlement no-op from atomic RPC', { playerId, reason });
      res.json({
        settled: false,
        reason,
        detail: settlement?.detail,
      });
      return;
    }

    // Use the RPC's authoritative values (DB now() may differ from route's Date.now())
    const settledTicks = Number(settlement.ticks_settled ?? result.rewards.ticks);
    const settledStartTick = Number(settlement.start_tick ?? (profile.last_claimed_tick || 0));
    const settledEndTick = Number(settlement.end_tick ?? 0);
    const atomicElapsedMs = Number(settlement.elapsed_ms ?? elapsedMs);
    const atomicCappedMs = Number(settlement.capped_ms ?? capMs);
    const atomicCapReached = Boolean(settlement.cap_reached ?? capReached);
    const atomicCapHours = Number(settlement.cap_hours ?? capHours);
    const atomicSettledAt = String(settlement.settled_at ?? new Date().toISOString());

    // Store items (items generated by Chef, persisted separately)
    if (result.items.length > 0) {
      const { error: storeError } = await supabase.rpc('cc_store_chef_items', {
        _player_id: playerId,
        _items: result.items,
      });
      if (storeError) {
        console.error('[chef] settlement store items failed:', storeError.message);
        res.status(500).json({
          error: 'Failed to store settlement items',
          detail: storeError.message,
          profile: settlement.profile ?? {},
        });
        return;
      }
    }

    // Profile snapshot is already in the RPC result
    const profileSnapshot = settlement.profile ?? {};

    // --- Structured log ---
    console.log('[chef] settlement complete (atomic)', {
      userId: playerId,
      areaId,
      startedAt: settleFrom,
      settledAt: atomicSettledAt,
      elapsedMs: atomicElapsedMs,
      cappedMs: atomicCappedMs,
      capReached: atomicCapReached,
      ticksRequested,
      ticksSettled: settledTicks,
      startTick: settledStartTick,
      endTick: settledEndTick,
      xp: result.rewards.xpAwarded,
      credits: result.rewards.creditsAwarded,
      scrap: result.rewards.scrapAwarded,
      fragments: result.rewards.cacheFragmentsAwarded,
      gearCount: result.items.length,
      materialCount: Object.keys(result.rewards.materials).length,
    });

    // --- Return full settlement summary ---
    res.json({
      settled: true,
      areaId,
      areaName,
      timeAway: formatTimeAway(atomicElapsedMs),
      elapsedMs: atomicElapsedMs,
      cappedMs: atomicCappedMs,
      capReached: atomicCapReached,
      capHours: atomicCapHours,
      ticksSettled: settledTicks,
      startTick: settledStartTick,
      endTick: settledEndTick,
      profile: profileSnapshot,
      rewards: result.rewards,
      items: result.items,
      feedEvents: result.feedEvents,
      idempotent: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chef] settlement error:', message);
    sendRouteError(res, 'Offline settlement failed', err);
  }
}

export function mountChefRoutes(app: Express): void {
  app.post('/api/claim', handleClaim);
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', chef: 'ready' });
  });
  app.post('/api/verify-boss', handleVerifyBoss);
  app.post('/api/salvage', handleSalvage);
  app.post('/api/settle-offline', handleSettleOffline);
  console.log('[chef] routes mounted: POST /api/claim, GET /api/health, POST /api/verify-boss, POST /api/salvage, POST /api/settle-offline');
}
