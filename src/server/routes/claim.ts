import { Express, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { processBossAttempt, processRoamingClaim, type BossAttemptRequest, type ClaimRequest } from '../chef';

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
      .select('last_claimed_tick')
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

    const result = processRoamingClaim(claim);
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
      if (storeError) console.error('[chef] Failed to store items:', storeError.message);
    }

    res.json({ ...result, profile: rpcResult?.profile ?? rpcResult });
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
      if (storeError) console.error('[chef] Failed to store boss loot:', storeError.message);
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

export function mountChefRoutes(app: Express): void {
  app.post('/api/claim', handleClaim);
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', chef: 'ready' });
  });
  app.post('/api/verify-boss', handleVerifyBoss);
  app.post('/api/salvage', handleSalvage);
  console.log('[chef] routes mounted: POST /api/claim, GET /api/health, POST /api/verify-boss, POST /api/salvage');
}
