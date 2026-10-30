/**
 * Legacy Chef routes: /api/verify-boss, /api/salvage.
 *
 * June flow, Route B plumbing (slice B6): Chef JWT auth and gameplay
 * store reads replace the Supabase token + PostgREST reads; persistence
 * goes through the ported cc_apply_chef_boss_attempt /
 * cc_store_chef_items (db/migrations/0007_chef_gameplay_appliers.sql)
 * and cc_recycle_item (db/migrations/0004_write_apis.sql, ported in
 * B3). Request and response contracts are the June ones.
 *
 * One deliberate repair: the June boss handler selected a
 * `pity_counters` column from profiles — no such column ever existed
 * in the June schema (pity lives in the boss_state jsonb, key
 * `pityCounters`, maintained by cc_apply_chef_boss_attempt itself), so
 * the PostgREST read errored and every boss verification failed with
 * 500 'Failed to read player profile'. The port reads boss_state and
 * derives the server pity count from it — the value the June design
 * intended and the applier consumes.
 *
 * The duplicate /api/claim and /api/settle-offline handlers that used
 * to live here were dead code (the canonical handlers in
 * roamingHandler.ts / settleOffline.ts won on mount order) and were
 * removed in B3; the canonical copies are mounted by
 * src/server/gameplay/routes.ts.
 */
import type { Request, Response } from 'express';
import { processBossAttempt, type BossAttemptRequest } from '../chef';
import type { AuthConfig } from '../auth/routes';
import type { ChefGameplayStore, Json } from '../gameplay/store';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export function createVerifyBossHandler(store: ChefGameplayStore, config: AuthConfig) {
  return async function handleVerifyBoss(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body as BossAttemptRequest & { jwt?: string };
      if (!body.bossId) {
        res.status(400).json({ error: 'Missing required field: bossId' });
        return;
      }

      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);

      // --- Read server-authoritative profile data ---
      // Boss fight economy (consumables, credits, level, pity) must be
      // verified against the database — the client cannot be trusted to
      // supply these values. This mirrors the roaming claim handler which
      // reads consumableInventory from profiles.consumables.
      let profile: Awaited<ReturnType<ChefGameplayStore['getBossProfile']>>;
      try {
        profile = await store.getBossProfile(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read player profile', detail: message });
        return;
      }
      if (!profile) {
        res.status(500).json({ error: 'Failed to read player profile', detail: 'Profile not found' });
        return;
      }

      // --- Verify credit affordability for death fee ---
      // A player with insufficient credits cannot afford the death fee and
      // should not be allowed to attempt the boss fight. The client may
      // report any credit value; the server must use the DB value.
      const serverCredits: number = typeof profile.credits === 'number' ? profile.credits : 0;
      const serverLevel: number = typeof profile.player_level === 'number' ? profile.player_level : 1;

      // Consumable inventory from DB — prevents client from claiming
      // consumables they don't own.
      const serverConsumables: Record<string, number> =
        profile.consumables && typeof profile.consumables === 'object'
          ? (profile.consumables as Record<string, number>)
          : {};

      // Pity counters from DB — prevents pity manipulation. They live in
      // boss_state.pityCounters (see the file header: the June
      // `pity_counters` column this used to select never existed).
      const serverBossState: Record<string, unknown> =
        profile.boss_state && typeof profile.boss_state === 'object'
          ? (profile.boss_state as Record<string, unknown>)
          : {};
      const serverPityCounters: Record<string, number> =
        serverBossState.pityCounters && typeof serverBossState.pityCounters === 'object'
          ? (serverBossState.pityCounters as Record<string, number>)
          : {};
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

      let rpcResult: Json;
      try {
        rpcResult = await store.applyChefBossAttempt(playerId, {
          bossId: body.bossId,
          attemptNonce,
          victory: result.result.victory,
          creditsDelta: result.creditsDelta,
          xp: result.xpAwarded,
          consumables: result.consumedConsumables as Json,
          attempt: result.result as unknown as Json,
          unlockedBossId: result.unlockedBossId ?? null,
          scrap: result.scrapAwarded,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to apply boss attempt', detail: message });
        return;
      }

      if (result.items.length > 0) {
        try {
          await store.storeChefItems(playerId, result.items);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] Failed to store boss loot:', message);
          res.status(500).json({
            error: 'Failed to store boss loot items',
            detail: message,
            profile: (rpcResult as Record<string, unknown>)?.profile ?? rpcResult,
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
        profile: (rpcResult as Record<string, unknown>)?.profile ?? rpcResult,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[chef] boss verify error:', message);
      sendRouteError(res, 'Boss verification failed', err);
    }
  };
}

export function createSalvageHandler(store: ChefGameplayStore, config: AuthConfig) {
  return async function handleSalvage(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body as { playerId?: string; itemId: string; jwt?: string; nonce?: string };
      if (!body.itemId) {
        res.status(400).json({ error: 'Missing itemId' });
        return;
      }

      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      const nonce = body.nonce || `salvage:${playerId}:${body.itemId}:${Date.now()}`;

      // Keep salvage on the same verified path as the rest of item mutation.
      // This fixes the stale `player_items` / `owner_id` route that no longer
      // matches the live schema (`item_instances.owner_user_id`).
      let result: Record<string, unknown> | null;
      try {
        result = (await store.recycleItem(playerId, nonce, body.itemId)) as Record<string, unknown> | null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to recycle item', detail: message });
        return;
      }

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
  };
}
