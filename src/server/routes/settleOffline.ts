/**
 * POST /api/settle-offline — offline roaming settlement (legacy Chef
 * route).
 *
 * June flow, Route B plumbing (slice B6): Chef JWT auth and gameplay
 * store reads replace the Supabase token + PostgREST reads; the atomic
 * persistence goes through the ported cc_settle_offline_roaming
 * (db/migrations/0007_chef_gameplay_appliers.sql), which recomputes
 * elapsed time and ticks from database state — the route's own
 * elapsed/tick computation below only sizes the engine simulation,
 * exactly as in June. Request and response contracts are unchanged.
 */
import type { Request, Response } from 'express';
import { processRoamingClaim, type ClaimRequest } from '../chef';
import type { AuthConfig } from '../auth/routes';
import type { ChefGameplayStore, Json } from '../gameplay/store';
import { skillBonusesFromRecords } from '../gameplay/serverLoadout';
import { earnedOfflineCapHours } from '../../content/offlineCap';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

function formatTimeAway(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function createSettleOfflineHandler(store: ChefGameplayStore, config: AuthConfig) {
  return async function handleSettleOffline(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body as { playerId?: string; settlementNonce?: string; jwt?: string };
      if (!body.settlementNonce) {
        res.status(400).json({ error: 'Missing settlementNonce' });
        return;
      }

      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);

      let activeAction: Awaited<ReturnType<ChefGameplayStore['getActiveAction']>>;
      try {
        activeAction = await store.getActiveAction(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read active action', detail: message });
        return;
      }

      if (!activeAction || activeAction.active_action !== 'roaming_loot') {
        res.json({ settled: false, reason: 'not_roaming' });
        return;
      }

      let profile: Awaited<ReturnType<ChefGameplayStore['getSettlementProfile']>>;
      try {
        profile = await store.getSettlementProfile(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read profile', detail: message });
        return;
      }
      if (!profile) {
        res.status(500).json({ error: 'Failed to read profile', detail: 'Profile not found' });
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

      const area = await import('../../constants/roamingAreas').then((m) => m.getRoamingArea(activeAction.target_id));

      // Area level gate (same rule as the foreground claim route): a
      // stale above-gate selection settles nothing.
      if ((profile.player_level || 1) < area.unlockLevel) {
        res.json({ settled: false, reason: 'area_locked' });
        return;
      }

      // Offline parity: settle with the SAME claim inputs a foreground
      // claim carries. The loadout comes from the server's own records
      // (item_instances rows with runtime_state 'equipped') — never
      // the runtime display snapshot, which is hydration support only.
      // Skill bonuses are rebuilt from the server's records too
      // (profiles.skill_spends + the equipped class mod's boosts) via
      // skillBonusesFromRecords, the one derivation every Chef route
      // now shares. Before this, the claim was built with no gear and
      // no skills at all, so gear offline-earnings mods, the whole
      // Scavenger offline tree, scrap/rare mods, and Salvage Rights
      // paid zero offline.
      let equippedGear: Awaited<ReturnType<ChefGameplayStore['getEquippedGear']>>;
      try {
        equippedGear = await store.getEquippedGear(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read loadout', detail: message });
        return;
      }
      const skillBonuses = skillBonusesFromRecords(
        equippedGear,
        (profile.skill_spends ?? {}) as Record<string, number>,
      );

      // Offline cap — EARNED, server-derived (pacing-baseline tuning):
      // earnedOfflineCapHours(player level) + the Scavenger keystone's
      // offlineCapBonus from the server-rebuilt skill bonuses above
      // (that effect key's first consumer). The stored
      // profiles.offline_cap_hours preference no longer sizes the
      // settlement — a larger client/profile value is ignored here and
      // inside cc_settle_offline_roaming (0015's _cap_hours).
      const offlineCapBonus = Math.max(0, Math.floor(skillBonuses.offlineCapBonus ?? 0));
      const capHours = earnedOfflineCapHours(profile.player_level || 1) + offlineCapBonus;
      const capMs = capHours * 60 * 60 * 1000;
      const rawElapsedMs = Math.max(0, Date.now() - new Date(settleFrom).getTime());
      const elapsedMs = Math.min(rawElapsedMs, capMs);
      const ticksRequested = Math.floor(elapsedMs / 3000);

      if (ticksRequested <= 0) {
        res.json({ settled: false, reason: 'no_elapsed' });
        return;
      }

      const claim: ClaimRequest = {
        playerId,
        areaId: area.id,
        ticks: ticksRequested,
        tickCount: (profile.last_claimed_tick || 0) + ticksRequested,
        playerLevel: profile.player_level || 1,
        maxTicks: Infinity, // NO 20-TICK CLAMP for offline settlement
        effectiveDps: 0,
        equippedGear,
        skillBonuses,
        consumableInventory: (profile.consumables ?? {}) as Record<string, number>,
        // Server-authoritative scrap bank (migration 0009).
        scrapRemainder: profile.scrap_remainder,
        creditsRemainder: profile.credits_remainder,
        xpRemainder: profile.xp_remainder,
      };

      const result = processRoamingClaim(claim);

      let settlement: Record<string, unknown> | null;
      try {
        settlement = (await store.settleOfflineRoaming(playerId, body.settlementNonce, {
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
        // 0012: offline ticks run the same consumable engine as
        // foreground claims; the consumed set is applied atomically
        // inside the settlement instead of being discarded (offline
        // benefits used to be free forever).
        result.consumedConsumables as Json,
        // 0015: the earned cap derived above — the atomic function
        // caps its own elapsed window at the same value, so the
        // simulated rewards and the persisted settlement agree.
        capHours)) as Record<string, unknown> | null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Atomic settlement failed', detail: message });
        return;
      }

      if (!settlement || !settlement.settled) {
        res.json({ settled: false, reason: (settlement?.reason as string) || 'error', detail: settlement?.detail });
        return;
      }

      const atomicElapsedMs = Number(settlement.elapsed_ms ?? elapsedMs);
      const atomicCapMs = Number(settlement.capped_ms ?? capMs);
      const capReached = Boolean(settlement.cap_reached ?? rawElapsedMs > capMs);

      if (result.items.length > 0) {
        try {
          await store.storeChefItems(playerId, result.items);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] settlement store items failed:', message);
        }
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
        consumedConsumables: result.consumedConsumables,
        idempotent: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[chef] settlement error:', message);
      sendRouteError(res, 'Offline settlement failed', err);
    }
  };
}
