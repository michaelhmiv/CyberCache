import { Request, Response } from 'express';
import { processRoamingClaim, type ClaimRequest } from '../chef';
import { getSupabase, requireAuthenticatedPlayerId, sendRouteError } from './chefRouteAuth';

export async function handleClaim(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as ClaimRequest & { jwt?: string };
    if (!body.areaId || !body.ticks || body.tickCount == null) {
      res.status(400).json({ error: 'Missing required fields: areaId, ticks, tickCount' });
      return;
    }

    const supabase = getSupabase();
    const playerId = await requireAuthenticatedPlayerId(supabase, req, body.jwt, body.playerId);
    const claim: ClaimRequest = { ...body, playerId };

    const { data: profile, error: profileError } = await supabase.from('profiles').select('last_claimed_tick').eq('id', playerId).single();
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
      const { error: storeError } = await supabase.rpc('cc_store_chef_items', { _player_id: playerId, _items: result.items });
      if (storeError) console.error('[chef] Failed to store items:', storeError.message);
    }

    res.json({ ...result, profile: rpcResult?.profile ?? rpcResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chef] claim error:', message);
    sendRouteError(res, 'Chef processing failed', err);
  }
}
