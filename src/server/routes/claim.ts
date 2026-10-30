/**
 * Legacy Chef routes that remain live: /api/health, /api/verify-boss,
 * /api/salvage.
 *
 * The duplicate /api/claim and /api/settle-offline handlers that used to
 * live here were dead code — chefRoutes.ts registers the canonical
 * handlers (roamingHandler.handleClaim, settleOffline.handleSettleOffline)
 * before mounting this module, so Express never reached the copies. They
 * were removed in Route B slice B3; do not re-add them here.
 */
import { Express, Request, Response } from 'express';
import { processBossAttempt, type BossAttemptRequest } from '../chef';
import { getAuthenticatedSupabase, sendRouteError } from './chefRouteAuth';

async function handleVerifyBoss(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as BossAttemptRequest & { jwt?: string };
    if (!body.bossId) {
      res.status(400).json({ error: 'Missing required field: bossId' });
      return;
    }

    const { playerId, supabase } = await getAuthenticatedSupabase(req, body.jwt, body.playerId);

    // --- Read server-authoritative profile data ---
    // Boss fight economy (consumables, credits, level, pity) must be
    // verified against the database — the client cannot be trusted to
    // supply these values. This mirrors the roaming claim handler which
    // reads consumableInventory from profiles.consumables.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('player_level, credits, consumables, pity_counters')
      .eq('id', playerId)
      .single();

    if (profileError) {
      res.status(500).json({ error: 'Failed to read player profile', detail: profileError.message });
      return;
    }

    // --- Verify credit affordability for death fee ---
    // A player with insufficient credits cannot afford the death fee and
    // should not be allowed to attempt the boss fight. The client may
    // report any credit value; the server must use the DB value.
    const serverCredits: number = typeof profile?.credits === 'number' ? profile.credits : 0;
    const serverLevel: number = typeof profile?.player_level === 'number' ? profile.player_level : 1;

    // Consumable inventory from DB — prevents client from claiming
    // consumables they don't own.
    const serverConsumables: Record<string, number> =
      (profile?.consumables && typeof profile.consumables === 'object'
        ? (profile.consumables as Record<string, number>)
        : {});

    // Pity counters from DB — prevents pity manipulation.
    const serverPityCounters: Record<string, number> =
      (profile?.pity_counters && typeof profile.pity_counters === 'object'
        ? (profile.pity_counters as Record<string, number>)
        : {});
    const serverPityCount = serverPityCounters[body.bossId] ?? 0;

    const attemptNonce = body.attemptNonce || Date.now();

    // Build the request with server-authoritative economy fields
    // overridden. Gear objects (primary, secondary, etc.) are still
    // passed through from the client — a future pass will re-derive
    // DPS from DB-verified equipped items like the roaming handler does.
    const request: BossAttemptRequest = {
      ...body,
      playerId,
      attemptNonce,
      playerLevel: serverLevel,
      playerCredits: serverCredits,
      consumables: serverConsumables,
      pityCount: serverPityCount,
    };

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

    const { playerId, supabase } = await getAuthenticatedSupabase(req, body.jwt, body.playerId);
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
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', chef: 'ready' });
  });
  app.post('/api/verify-boss', handleVerifyBoss);
  app.post('/api/salvage', handleSalvage);
  console.log('[chef] routes mounted: GET /api/health, POST /api/verify-boss, POST /api/salvage');
}
