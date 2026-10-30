/**
 * POST /api/claim — foreground roaming claim (legacy Chef route).
 *
 * June flow, Route B plumbing (slice B6): the handler verifies the
 * Chef JWT (was: Supabase token), reads the profile through the
 * gameplay store (was: PostgREST), runs the shared engine
 * (processRoamingClaim — unchanged), and persists through the ported
 * cc_apply_chef_rewards / cc_store_chef_items /
 * cc_consume_roaming_consumables functions
 * (db/migrations/0007_chef_gameplay_appliers.sql). Request and
 * response contracts are the June ones.
 */
import type { Request, Response } from 'express';
import { processRoamingClaim, type ClaimRequest } from '../chef';
import type { AuthConfig } from '../auth/routes';
import type { ChefGameplayStore, Json } from '../gameplay/store';
import { getRoamingArea } from '../../constants/roamingAreas';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export function createClaimHandler(store: ChefGameplayStore, config: AuthConfig) {
  return async function handleClaim(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body as ClaimRequest & {
        jwt?: string;
        roamingConsumableState?: unknown;
        masteryLevels?: Record<string, number>;
      };
      if (!body.areaId || !body.ticks || body.tickCount == null) {
        res.status(400).json({ error: 'Missing required fields: areaId, ticks, tickCount' });
        return;
      }

      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      const claim: ClaimRequest = { ...body, playerId };

      let profile: Awaited<ReturnType<ChefGameplayStore['getRoamingProfile']>>;
      try {
        profile = await store.getRoamingProfile(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read profile', detail: message });
        return;
      }
      if (!profile) {
        res.status(500).json({ error: 'Failed to read profile', detail: 'Profile not found' });
        return;
      }

      // Area level gate, enforced server-side against the DB level.
      // unlockLevel used to be UI-only (disabled picker buttons), so a
      // stale or forged area selection farmed the top area at level 1.
      const area = getRoamingArea(body.areaId);
      if (profile.player_level < area.unlockLevel) {
        res.status(403).json({
          error: 'Area locked for your level',
          areaId: area.id,
          requiredLevel: area.unlockLevel,
          playerLevel: profile.player_level,
        });
        return;
      }

      if (body.tickCount <= profile.last_claimed_tick) {
        res.status(409).json({ error: 'tick_count already claimed', lastClaimedTick: profile.last_claimed_tick });
        return;
      }

      // Read server-authoritative consumable inventory from profiles.consumables
      const consumableInventory = (profile.consumables ?? {}) as Record<string, number>;

      // Merge inventory + roaming state into the claim
      const claimWithConsumables: ClaimRequest = {
        ...claim,
        // The DB level is authoritative (same precedent as the
        // verify-boss route): it drives the area gate above and item
        // generation levels, never the client body's playerLevel.
        playerLevel: profile.player_level,
        // Server-authoritative scrap bank (migration 0009): read from the
        // profile, never from the client body spread above.
        scrapRemainder: profile.scrap_remainder,
        creditsRemainder: profile.credits_remainder,
        xpRemainder: profile.xp_remainder,
        consumableInventory,
        roamingConsumableState: body.roamingConsumableState,
        masteryLevels: body.masteryLevels,
      };

      const result = processRoamingClaim(claimWithConsumables);

      let rpcResult: Json;
      try {
        rpcResult = await store.applyChefRewards(
          playerId,
          {
            credits: result.rewards.creditsAwarded,
            scrap: result.rewards.scrapAwarded,
            scrapRemainder: result.rewards.scrapRemainder,
            creditsRemainder: result.rewards.creditsRemainder,
            xpRemainder: result.rewards.xpRemainder,
            xp: result.rewards.xpAwarded,
            fragments: result.rewards.cacheFragmentsAwarded,
            materials: result.rewards.materials as Json,
            essences: result.rewards.essences as Json,
            kills: result.rewards.killsRecorded,
          },
          body.tickCount,
          body.areaId,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to apply rewards', detail: message });
        return;
      }

      if (result.items.length > 0) {
        try {
          await store.storeChefItems(playerId, result.items);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] Failed to store items:', message);
          res.status(500).json({
            error: 'Failed to store generated items',
            detail: message,
            profile: (rpcResult as Record<string, unknown>)?.profile ?? rpcResult,
            rewards: result.rewards,
          });
          return;
        }
      }

      // Persist consumable consumption atomically (server-authoritative).
      // A persistence failure here must NOT be swallowed: the claim has
      // already paid rewards computed with those consumables active, so
      // silently succeeding would make the claim's consumables free.
      // Surface it exactly like the store-items failure above (500 with
      // the applied profile + rewards attached); the tick guard makes a
      // client retry safe (409, no double-apply).
      const consumedConsumables = result.consumedConsumables;
      if (consumedConsumables && Object.keys(consumedConsumables).length > 0) {
        try {
          await store.consumeRoamingConsumables(playerId, consumedConsumables as Json, body.areaId, body.tickCount);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] Failed to consume roaming consumables:', message);
          res.status(500).json({
            error: 'Failed to persist consumable consumption',
            detail: message,
            profile: (rpcResult as Record<string, unknown>)?.profile ?? rpcResult,
            rewards: result.rewards,
          });
          return;
        }
      }

      res.json({
        ...result,
        profile: (rpcResult as Record<string, unknown>)?.profile ?? rpcResult,
        consumedConsumables,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[chef] claim error:', message);
      sendRouteError(res, 'Chef processing failed', err);
    }
  };
}
