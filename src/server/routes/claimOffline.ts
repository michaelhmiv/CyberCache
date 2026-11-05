/**
 * POST /api/claim-offline — pay the held offline settlement
 * (migration 0083; the streak's true claim, 0079, carried to offline
 * earnings — owner decision 2026-11-05).
 *
 * The settle (POST /api/settle-offline) computes away windows and
 * HOLDS them unpaid. This route is the payment: the atomic claim
 * (cc_claim_offline_settlement) applies the held totals to the
 * profile exactly once — the hold row is the exactly-once anchor, a
 * second claim finds nothing held and pays nothing — and writes the
 * settle-shaped ledger row every consumer reads, so the economy
 * fold, mastery/stat triggers, contract stats and the Activity Log
 * all move at claim, not at settle.
 *
 * Trust model (the Phase-0 law): identity comes from the JWT only;
 * the body carries no amounts, no area, no nonce — the claim pays
 * what the server's hold record says, never what a request asks
 * for. Guests claim identically (grants key on the profile row).
 *
 * After the atomic payment, this route runs the post-steps the
 * settle route used to run at settle time, with the same posture
 * (log-and-continue — the claim already paid, and its anchor forbids
 * a re-claim): item storage + discoveries, the 0080 auto-salvage
 * pass over the just-stored drops (the hold id is the pass nonce, so
 * the derived recycle nonces are stable per claim), and the 0043
 * manufacturer-standing drip on the held kills.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { ChefGameplayStore } from '../gameplay/store';
import { equippedWeaponManufacturer } from '../gameplay/serverLoadout';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';
import { recordItemDiscoveries } from './roamingHandler';

function formatTimeAway(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function createClaimOfflineHandler(
  store: ChefGameplayStore,
  config: AuthConfig,
) {
  return async function handleClaimOffline(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body as { playerId?: string; jwt?: string };
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);

      let claim: Record<string, unknown> | null;
      try {
        claim = (await store.claimOfflineSettlement(playerId)) as Record<string, unknown> | null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Offline claim failed', detail: message });
        return;
      }

      if (!claim || !claim.claimed) {
        res.json({
          claimed: false,
          reason: (claim?.reason as string) || 'nothing_held',
          profile: claim?.profile ?? {},
        });
        return;
      }

      const rewards = (claim.rewards ?? {}) as Record<string, unknown>;
      const heldItems = (Array.isArray(claim.items) ? claim.items : []) as Array<Record<string, unknown>>;
      const feedEvents: Array<Record<string, unknown>> = [
        ...((claim.feed_events as Array<Record<string, unknown>>) ?? []),
      ];
      const areaId = typeof claim.area_id === 'string' ? claim.area_id : '';
      const area = await import('../../constants/roamingAreas').then((m) => m.getRoamingArea(areaId || undefined));

      // Item storage + discoveries: the held drops become real
      // inventory now (they were payloads in the hold until the
      // claim). Same posture as every post-settlement step: the
      // claim is already applied atomically, so a failure is logged,
      // never retried, and never fails the response.
      if (heldItems.length > 0) {
        try {
          await store.storeChefItems(playerId, heldItems);
          await recordItemDiscoveries(store, playerId, heldItems, 'offline_drop');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] offline claim store items failed:', message);
        }
      }

      // Auto-salvage (migration 0080) inside the claim: the profile's
      // Auto-Salvage Rule applies to the drops THIS claim just
      // stored — salvage happens as drops land in the computation's
      // payoff, exactly as it did at settle time before 0083 — each
      // matching item is recycled through cc_recycle_item, the
      // receipt's item list keeps only the unsalvaged drops, the
      // profile becomes the post-salvage snapshot, and one
      // auto_salvage feed event per salvaged drop rides the receipt.
      let autoSalvageBlock: Record<string, unknown> | null = null;
      let responseItems: Array<Record<string, unknown>> = heldItems;
      let responseProfile: unknown = claim.profile ?? {};
      if (heldItems.length > 0) {
        try {
          const salvage = (await store.applyAutoSalvage(
            playerId,
            `offline-claim:${String(claim.hold_id ?? '')}`,
            'offline',
            heldItems.map((item) => String((item as { id?: unknown }).id ?? '')),
          )) as Record<string, unknown>;
          const salvaged = Array.isArray(salvage.items) ? (salvage.items as Array<Record<string, unknown>>) : [];
          if (Number(salvage.salvaged_count ?? 0) > 0) {
            const { profile: salvageProfile, ...summary } = salvage;
            autoSalvageBlock = summary;
            if (salvageProfile) responseProfile = salvageProfile;
            const salvagedIds = new Set(salvaged.map((entry) => String(entry.id ?? '')));
            responseItems = heldItems.filter(
              (item) => !salvagedIds.has(String((item as { id?: unknown }).id ?? '')),
            );
            for (const entry of salvaged) {
              feedEvents.push({
                at: Date.now(),
                tone: 'auto_salvage',
                label: `Auto-salvaged ${String(entry.name || 'item')}`,
                detail:
                  typeof entry.converted_material === 'string'
                    ? `Broken down into ${entry.converted_material} while you were away — your Auto-Salvage Rules.`
                    : `+${Number(entry.scrap_award ?? 0)} scrap while you were away — your Auto-Salvage Rules.`,
                value: Number(entry.scrap_award ?? 0),
                areaId,
              });
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] offline claim auto-salvage failed:', message);
        }
      }

      // Manufacturer Standing (0043): the use drip on the held kills,
      // from the server-derived primary weapon — it pays at claim
      // with the rest of the settlement (pre-0083 it paid at settle;
      // the drip is part of what the window earned).
      let standingBlock: Record<string, unknown> | null = null;
      const killsRecorded = Number(rewards.kills_recorded ?? 0);
      if (killsRecorded > 0) {
        try {
          const equippedGear = await store.getEquippedGear(playerId);
          const dripManufacturer = equippedWeaponManufacturer(equippedGear);
          if (dripManufacturer) {
            const fact = (await store.accrueManufacturerStanding(
              playerId,
              dripManufacturer,
              killsRecorded,
            )) as Record<string, unknown>;
            standingBlock = {
              manufacturer: String(fact.manufacturer ?? dripManufacturer),
              points: Number(fact.points ?? 0),
              capRemaining: Number(fact.cap_remaining ?? 0),
              balance: Number(fact.balance ?? 0),
              rank: Number(fact.rank ?? 0),
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] offline claim standing accrual failed:', message);
        }
      }

      res.json({
        claimed: true,
        areaId,
        areaName: area.name,
        timeAway: formatTimeAway(Number(claim.elapsed_ms ?? 0)),
        elapsedMs: Number(claim.elapsed_ms ?? 0),
        capReached: Boolean(claim.cap_reached ?? false),
        capHours: Number(claim.cap_hours ?? 0),
        ticksSettled: Number(claim.ticks_settled ?? 0),
        startTick: Number(claim.start_tick ?? 0),
        endTick: Number(claim.end_tick ?? 0),
        windows: Number(claim.windows ?? 1),
        profile: responseProfile,
        rewards: {
          ticks: Number(claim.ticks_settled ?? 0),
          creditsAwarded: Number(rewards.credits_awarded ?? 0),
          scrapAwarded: Number(rewards.scrap_awarded ?? 0),
          xpAwarded: Number(rewards.xp_awarded ?? 0),
          cacheKeysAwarded: Number(rewards.cache_keys_awarded ?? 0),
          materials: (rewards.materials as Record<string, number>) ?? {},
          essences: (rewards.essences as Record<string, number>) ?? {},
          killsRecorded,
        },
        items: responseItems,
        feedEvents,
        consumedConsumables: (claim.consumed_consumables as Record<string, number>) ?? {},
        ...(autoSalvageBlock ? { autoSalvage: autoSalvageBlock } : {}),
        ...(standingBlock ? { standing: standingBlock } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[chef] offline claim error:', message);
      sendRouteError(res, 'Offline claim failed', err);
    }
  };
}
