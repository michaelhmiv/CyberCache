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
import type { EconomyConfig } from '../economy/config';
import type { ChefGameplayStore, DeathRecord, Json } from '../gameplay/store';
import { equippedWeaponManufacturer, skillBonusesFromRecords } from '../gameplay/serverLoadout';
import { getRoamingArea } from '../../constants/roamingAreas';
import { buildConsumableQualityProfile } from '../../lib/consumables/batchProfile';
import { isHotArea } from '../../content/hotArea';
import { cacheRankBonuses } from '../../content/cacheRank';
import { mergeResearchBonuses } from '../../content/research';
import { RESURRECTION_FREE_TIMER_MS } from '../../lib/combat/resurrectionCost';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';
import {
  discoveryEntriesForItem,
  eliteDiscovery,
  type DiscoveryItemLike,
  type DiscoveryRecord,
} from '../../content/collections';

/**
 * Collection discovery (0026): the items are stored and the claim is
 * paid — record what the settled drop proves, derived from the Chef's
 * own output. Log-and-continue (the 0023 telemetry precedent): a
 * recording failure must never fail a paid claim.
 */
export async function recordItemDiscoveries(
  store: ChefGameplayStore,
  playerId: string,
  items: readonly unknown[],
  source: string,
): Promise<void> {
  try {
    const entries: DiscoveryRecord[] = [];
    for (const item of items) {
      entries.push(...discoveryEntriesForItem(item as DiscoveryItemLike, source));
    }
    if (entries.length > 0) await store.recordDiscoveries(playerId, entries);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chef] Failed to record collection discoveries:', message);
  }
}

export function createClaimHandler(
  store: ChefGameplayStore,
  config: AuthConfig & { economyConfig?: EconomyConfig; now?: () => Date },
) {
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

      // Quality wiring (crafting §2.4): price this claim's consumable
      // effects from the player's own batch rows, derived against the
      // authoritative owned counts above — never from the body. A
      // batch read failure is a 500 like the loadout read: pricing
      // effects at flat 100% silently would underpay crafted quality
      // with no signal.
      let consumableBatches: Awaited<ReturnType<ChefGameplayStore['getConsumableBatches']>>;
      try {
        consumableBatches = await store.getConsumableBatches(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read consumable batches', detail: message });
        return;
      }
      const consumableQualityProfile = buildConsumableQualityProfile(
        consumableBatches,
        consumableInventory,
      );

      // Trust hardening (Phase 0 Slice 6): the claim's gear and skill
      // inputs are derived from the server's OWN records — the
      // equipped item_instances rows and profiles.skill_spends — via
      // the same derivation offline settlement uses. The body's
      // equippedGear / skillBonuses copies (spread in via `claim`
      // above) are overridden here and never reach the engine: the
      // engine's re-derivation from handed gear was only internal
      // consistency, and a forged body with god-tier gear fabricated
      // payouts. A loadout read failure is a 500, not a silent
      // baseline claim — paying without the player's real gear would
      // underpay honest play with no signal.
      let equippedGear: Awaited<ReturnType<ChefGameplayStore['getEquippedGear']>>;
      try {
        equippedGear = await store.getEquippedGear(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read loadout', detail: message });
        return;
      }
      const skillBonuses = mergeResearchBonuses(
        skillBonusesFromRecords(
          equippedGear,
          (profile.skill_spends ?? {}) as Record<string, number>,
        ),
        // Research (0038): Xenotech weapon damage / shield capacity
        // + Powertrain's decay term merge onto the one bonus record
        // (settle-first, from research_completions rows).
        await store.getResearchBonuses(playerId),
      );

      // Vehicle (Phase 2b): the equipped vehicle instance + tank
      // fuel, from the server's own records — the body never carries
      // them. A read failure is a 500 like the loadout read: paying
      // a claim without the player's real vehicle state would
      // silently drop (or fabricate) the yield bonus.
      let equippedVehicle: Awaited<ReturnType<ChefGameplayStore['getEquippedVehicle']>>;
      try {
        equippedVehicle = await store.getEquippedVehicle(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read vehicle', detail: message });
        return;
      }

      // Live economy levers (0018): resolved server-side from the
      // EconomyConfig accessor and stamped over anything the body
      // claimed — the body can never set them (same trust rule as
      // the loadout above).
      const economyValues = config.economyConfig
        ? await config.economyConfig.snapshot()
        : undefined;

      // Drop luck (0035): the player's active weekly-leaderboard
      // buff, read from the server's own buff rows — never the body.
      // A read failure is a 500 like the loadout/vehicle reads above:
      // paying a claim without the player's real buff state would
      // silently drop a bonus they earned.
      let dropLuckBonus = 0;
      try {
        dropLuckBonus = await store.getActiveDropBonus(playerId, config.now?.() ?? new Date());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read drop buff', detail: message });
        return;
      }

      // Merge inventory + roaming state into the claim
      const claimWithConsumables: ClaimRequest = {
        ...claim,
        // The DB level is authoritative (same precedent as the
        // verify-boss route): it drives the area gate above and item
        // generation levels, never the client body's playerLevel.
        playerLevel: profile.player_level,
        // Server-derived loadout + skills (trust hardening, above).
        equippedGear,
        skillBonuses,
        // Cache Rank bonuses (0031): resolved from the profile's own
        // cache_rank_spends + the live levers — the body's copy
        // (spread in via `claim`) is overridden here and never
        // reaches the engine.
        cacheRankBonuses: cacheRankBonuses(profile.cache_rank_spends, economyValues),
        // Server-authoritative scrap bank (migration 0009): read from the
        // profile, never from the client body spread above.
        scrapRemainder: profile.scrap_remainder,
        creditsRemainder: profile.credits_remainder,
        xpRemainder: profile.xp_remainder,
        consumableInventory,
        consumableQualityProfile,
        roamingConsumableState: body.roamingConsumableState,
        masteryLevels: body.masteryLevels,
        vehicle: equippedVehicle
          ? {
              vehicle: equippedVehicle.vehicle,
              conditionCurrent: equippedVehicle.conditionCurrent,
              conditionMax: equippedVehicle.conditionMax,
              fuelUnits: profile.vehicle_fuel,
            }
          : null,
        economy: economyValues
          ? {
              fragmentChance: economyValues.fragmentChance,
              roamingLegendaryScalar: economyValues.roamingLegendaryScalar,
              vehicleYieldScalar: economyValues.vehicleYieldScalar,
              eventChanceBase: economyValues.eventChanceBase,
              eliteEscalationChance: economyValues.eliteEscalationChance,
              hotAreaMaterialBonus: economyValues.hotAreaMaterialBonus,
              hotAreaYieldBonus: economyValues.hotAreaYieldBonus,
              ...(dropLuckBonus > 0 ? { dropLuckBonus } : {}),
            }
          : dropLuckBonus > 0
            ? { dropLuckBonus }
            : undefined,
        // Daily hot area (overhaul): derived from the SERVER's UTC
        // date at claim time — never cron, never the body. The
        // engine applies the yield/material bonuses and the danger
        // multiplier when this is set.
        hotArea: isHotArea(body.areaId, config.now?.() ?? new Date()),
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

      // Persist the vehicle outcome (Phase 2b): tank fuel + the
      // equipped instance's condition after this claim. Like the
      // consumable consumption below, a failure here must surface —
      // silently succeeding would make fuel/condition free — and the
      // tick guard makes a client retry safe (409, no double-apply).
      if (
        equippedVehicle &&
        (result.vehicle.fuelConsumed > 0 || result.vehicle.conditionCurrent !== result.vehicle.conditionStart)
      ) {
        try {
          await store.applyVehicleUsage(playerId, {
            instanceId: equippedVehicle.instanceId,
            fuelUnits: result.vehicle.fuelUnitsRemaining,
            conditionCurrent: result.vehicle.conditionCurrent,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] Failed to persist vehicle usage:', message);
          res.status(500).json({
            error: 'Failed to persist vehicle usage',
            detail: message,
            profile: (rpcResult as Record<string, unknown>)?.profile ?? rpcResult,
            rewards: result.rewards,
          });
          return;
        }
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
        await recordItemDiscoveries(store, playerId, result.items, 'roaming_drop');
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

      // Death recording (migration 0013): when the sim killed the
      // hunter during this claim, persist the server death record —
      // the authority POST /api/resurrect validates against — and
      // return it so the client feeds the real killer/area/time to
      // the death log. First death wins inside cc_record_death, so a
      // hunter who was already dead keeps the original record. A
      // persistence failure surfaces like the consume failure above:
      // silently succeeding would leave a death the server never
      // recorded, and the resurrection op would then refuse the
      // player the overlay is showing.
      let deathPayload: Record<string, unknown> | null = null;
      if (result.survival.isDead) {
        try {
          let record: DeathRecord | null = null;
          if (result.survival.killedBy && result.survival.diedAt != null) {
            const recorded = await store.recordDeath(playerId, {
              diedAtMs: result.survival.diedAt,
              areaId: result.survival.killedBy.areaId,
              monsterId: result.survival.killedBy.monsterId,
              monsterName: result.survival.killedBy.monsterName,
            });
            record = recorded.death;
          } else {
            record = await store.getDeathRecord(playerId);
          }
          if (record) {
            deathPayload = {
              monsterId: record.monsterId,
              monsterName: record.monsterName,
              areaId: record.areaId,
              at: record.diedAtMs,
              diedAtMs: record.diedAtMs,
              freeReadyAtMs: record.diedAtMs + RESURRECTION_FREE_TIMER_MS,
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] Failed to record death:', message);
          res.status(500).json({
            error: 'Failed to record death',
            detail: message,
            profile: (rpcResult as Record<string, unknown>)?.profile ?? rpcResult,
            rewards: result.rewards,
          });
          return;
        }
      }

      // Roaming-event telemetry (0023): the claim is fully paid at
      // this point; the ledger rows feed economy observability
      // (realized event EV) and elite-kill mastery. Log-and-continue —
      // telemetry must never fail a paid claim.
      if (result.eventsFired.length > 0 || result.eliteKills > 0) {
        try {
          await store.recordRoamingEvents(playerId, {
            events: result.eventsFired.map((e) => ({ eventId: e.eventId, family: e.family })),
            eliteKills: result.eliteKills,
            areaId: body.areaId,
            tickCount: body.tickCount,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] Failed to record roaming events:', message);
        }
        // The area's named elite fell in this claim (0026): the
        // escalated elite kill IS the collection fact.
        if (result.eliteKills > 0) {
          const elite = eliteDiscovery(body.areaId);
          if (elite) {
            try {
              await store.recordDiscoveries(playerId, [elite]);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error('[chef] Failed to record elite discovery:', message);
            }
          }
        }
      }

      // Manufacturer Standing (0043): the use drip. Kills recorded
      // by this claim accrue standing for the SERVER-DERIVED primary
      // weapon's manufacturer (never a body field — the loadout above
      // is the server's own), capped per manufacturer per UTC day.
      // Log-and-continue like the telemetry above: the claim is fully
      // paid at this point, and the daily counter table is the meter
      // of record either way.
      let standingBlock: Record<string, unknown> | null = null;
      const dripManufacturer = equippedWeaponManufacturer(equippedGear);
      if (dripManufacturer && result.rewards.killsRecorded > 0) {
        try {
          const fact = (await store.accrueManufacturerStanding(
            playerId,
            dripManufacturer,
            result.rewards.killsRecorded,
          )) as Record<string, unknown>;
          standingBlock = {
            manufacturer: String(fact.manufacturer ?? dripManufacturer),
            points: Number(fact.points ?? 0),
            capRemaining: Number(fact.cap_remaining ?? 0),
            balance: Number(fact.balance ?? 0),
            rank: Number(fact.rank ?? 0),
          };
          if (Number(standingBlock.points) > 0) {
            result.feedEvents.push({
              at: Date.now(),
              tone: 'standing',
              label: `+${standingBlock.points} ${dripManufacturer} standing`,
              detail: `Kills with a ${dripManufacturer} weapon earn its maker's regard. ${standingBlock.capRemaining} drip points left today.`,
              manufacturer: dripManufacturer,
              value: standingBlock.points,
              areaId: body.areaId,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] Failed to accrue manufacturer standing:', message);
        }
      }

      res.json({
        ...result,
        profile: (rpcResult as Record<string, unknown>)?.profile ?? rpcResult,
        consumedConsumables,
        ...(deathPayload ? { death: deathPayload } : {}),
        ...(standingBlock ? { standing: standingBlock } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[chef] claim error:', message);
      sendRouteError(res, 'Chef processing failed', err);
    }
  };
}
