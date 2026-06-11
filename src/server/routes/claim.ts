import { Express, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { processBossAttempt, processRoamingClaim, type BossAttemptRequest, type ClaimRequest } from '../chef';

let _supabase: SupabaseClient | null = null;

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

async function applyJwt(supabase: SupabaseClient, jwt?: string): Promise<void> {
  if (!jwt) return;
  await supabase.auth.setSession({ access_token: jwt, refresh_token: '' });
}

async function handleClaim(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as ClaimRequest & { jwt?: string };
    if (!body.playerId || !body.areaId || !body.ticks || body.tickCount == null) {
      res.status(400).json({ error: 'Missing required fields: playerId, areaId, ticks, tickCount' });
      return;
    }

    const supabase = getSupabase();
    await applyJwt(supabase, body.jwt);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('last_claimed_tick')
      .eq('id', body.playerId)
      .single();

    if (profileError) {
      res.status(500).json({ error: 'Failed to read profile', detail: profileError.message });
      return;
    }

    if (profile && body.tickCount <= profile.last_claimed_tick) {
      res.status(409).json({ error: 'tick_count already claimed', lastClaimedTick: profile.last_claimed_tick });
      return;
    }

    const result = processRoamingClaim(body);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('cc_apply_chef_rewards', {
      _player_id: body.playerId,
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
        _player_id: body.playerId,
        _items: result.items,
      });
      if (storeError) console.error('[chef] Failed to store items:', storeError.message);
    }

    res.json({ ...result, profile: rpcResult?.profile ?? rpcResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chef] claim error:', message);
    res.status(500).json({ error: 'Chef processing failed', detail: message });
  }
}

async function handleVerifyBoss(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as BossAttemptRequest & { jwt?: string };
    if (!body.playerId || !body.bossId) {
      res.status(400).json({ error: 'Missing required fields: playerId, bossId' });
      return;
    }

    const supabase = getSupabase();
    await applyJwt(supabase, body.jwt);

    const attemptNonce = body.attemptNonce || Date.now();
    const result = processBossAttempt({ ...body, attemptNonce });
    const { data: rpcResult, error: rpcError } = await supabase.rpc('cc_apply_chef_boss_attempt', {
      _player_id: body.playerId,
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
        _player_id: body.playerId,
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
    res.status(500).json({ error: 'Boss verification failed', detail: message });
  }
}

async function handleSalvage(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { playerId: string; itemId: string; jwt?: string };
    if (!body.playerId || !body.itemId) {
      res.status(400).json({ error: 'Missing playerId or itemId' });
      return;
    }

    const supabase = getSupabase();
    await applyJwt(supabase, body.jwt);

    const { data: item, error: itemError } = await supabase
      .from('player_items')
      .select('*')
      .eq('id', body.itemId)
      .eq('owner_id', body.playerId)
      .single();

    if (itemError || !item) {
      res.status(404).json({ error: 'Item not found in your inventory' });
      return;
    }

    const { calculateSalvageYield } = await import('../../constants/salvageRules');
    const yield_ = calculateSalvageYield(item);
    const { error: deleteError } = await supabase
      .from('player_items')
      .delete()
      .eq('id', body.itemId)
      .eq('owner_id', body.playerId);

    if (deleteError) {
      res.status(500).json({ error: 'Failed to remove item', detail: deleteError.message });
      return;
    }

    const { error: rpcError } = await supabase.rpc('cc_apply_chef_rewards', {
      _player_id: body.playerId,
      _scrap: yield_.scrapValue,
      _materials: yield_.materials,
      _essences: yield_.essences,
      _credits: 0,
      _xp: 0,
      _fragments: 0,
      _kills: 0,
      _tick_count: 0,
      _area_id: 'salvage',
    });
    if (rpcError) console.error('[chef] salvage reward apply failed:', rpcError.message);

    res.json({
      salvaged: true,
      itemId: body.itemId,
      scrapValue: yield_.scrapValue,
      materials: yield_.materials,
      essences: yield_.essences,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chef] salvage error:', message);
    res.status(500).json({ error: 'Salvage failed', detail: message });
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
