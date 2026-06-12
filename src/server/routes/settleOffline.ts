import { Request, Response } from 'express';
import { processRoamingClaim, type ClaimRequest } from '../chef';
import { getSupabase, requireAuthenticatedPlayerId, sendRouteError } from './chefRouteAuth';

function formatTimeAway(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export async function handleSettleOffline(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { playerId?: string; settlementNonce?: string; jwt?: string };
    if (!body.settlementNonce) {
      res.status(400).json({ error: 'Missing settlementNonce' });
      return;
    }

    const supabase = getSupabase();
    const playerId = await requireAuthenticatedPlayerId(supabase, req, body.jwt, body.playerId);

    const { data: activeAction, error: actionError } = await supabase
      .from('active_actions')
      .select('user_id, active_action, target_id, started_at, last_heartbeat_at, activity_payload')
      .eq('user_id', playerId)
      .maybeSingle();

    if (actionError) {
      res.status(500).json({ error: 'Failed to read active action', detail: actionError.message });
      return;
    }

    if (!activeAction || activeAction.active_action !== 'roaming_loot') {
      res.json({ settled: false, reason: 'not_roaming' });
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', playerId)
      .single();

    if (profileError) {
      res.status(500).json({ error: 'Failed to read profile', detail: profileError.message });
      return;
    }

    if (profile.last_settlement_nonce === body.settlementNonce) {
      res.json({ settled: false, reason: 'idempotent' });
      return;
    }

    const settleFrom = profile.last_roaming_settled_at || activeAction.started_at;
    if (!settleFrom) {
      res.json({ settled: false, reason: 'no_elapsed' });
      return;
    }

    const capHours = Number(profile.offline_cap_hours) || 2;
    const capMs = capHours * 60 * 60 * 1000;
    const rawElapsedMs = Math.max(0, Date.now() - new Date(settleFrom).getTime());
    const elapsedMs = Math.min(rawElapsedMs, capMs);
    const ticksRequested = Math.floor(elapsedMs / 3000);

    if (ticksRequested <= 0) {
      res.json({ settled: false, reason: 'no_elapsed' });
      return;
    }

    const area = await import('../../constants/roamingAreas').then((m) => m.getRoamingArea(activeAction.target_id));
    const claim: ClaimRequest = {
      playerId,
      areaId: area.id,
      ticks: ticksRequested,
      tickCount: (profile.last_claimed_tick || 0) + ticksRequested,
      playerLevel: profile.player_level || 1,
      maxTicks: Infinity,
      effectiveDps: 0,
    };

    const result = processRoamingClaim(claim);

    const { data: atomicResult, error: atomicError } = await supabase.rpc('cc_settle_offline_roaming', {
      _player_id: playerId,
      _settlement_nonce: body.settlementNonce,
      _credits: result.rewards.creditsAwarded,
      _scrap: result.rewards.scrapAwarded,
      _xp: result.rewards.xpAwarded,
      _fragments: result.rewards.cacheFragmentsAwarded,
      _materials: result.rewards.materials,
      _essences: result.rewards.essences,
      _kills: result.rewards.killsRecorded,
    });

    if (atomicError) {
      res.status(500).json({ error: 'Atomic settlement failed', detail: atomicError.message });
      return;
    }

    const settlement = atomicResult as Record<string, unknown> | null;
    if (!settlement || !settlement.settled) {
      res.json({ settled: false, reason: (settlement?.reason as string) || 'error', detail: settlement?.detail });
      return;
    }

    const atomicElapsedMs = Number(settlement.elapsed_ms ?? elapsedMs);
    const atomicCapMs = Number(settlement.capped_ms ?? capMs);
    const capReached = Boolean(settlement.cap_reached ?? rawElapsedMs > capMs);

    if (result.items.length > 0) {
      const { error: storeError } = await supabase.rpc('cc_store_chef_items', { _player_id: playerId, _items: result.items });
      if (storeError) console.error('[chef] settlement store items failed:', storeError.message);
    }

    res.json({
      settled: true,
      areaId: area.id,
      areaName: area.name,
      timeAway: formatTimeAway(atomicElapsedMs),
      elapsedMs: atomicElapsedMs,
      cappedMs: atomicCapMs,
      capReached,
      capHours: Number(settlement.cap_hours ?? capHours),
      ticksSettled: Number(settlement.ticks_settled ?? result.rewards.ticks),
      startTick: Number(settlement.start_tick ?? profile.last_claimed_tick ?? 0),
      endTick: Number(settlement.end_tick ?? 0),
      profile: settlement.profile ?? {},
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
