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

    const profileSnapshot = settlement.profile ?? {};

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
