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
import type { EconomyConfig } from '../economy/config';
import type { ChefGameplayStore, Json } from '../gameplay/store';
import { equippedWeaponManufacturer, skillBonusesFromRecords } from '../gameplay/serverLoadout';
import { ABSOLUTE_OFFLINE_CAP_HOURS, effectiveOfflineCapHours } from '../../content/offlineCap';
import { mergeResearchBonuses } from '../../content/research';
import { buildConsumableQualityProfile } from '../../lib/consumables/batchProfile';
import { HOT_AREA_MATERIAL_BONUS, isHotArea } from '../../content/hotArea';
import { resolveExtractionLevers } from '../../content/extraction';
import { cacheRankBonuses } from '../../content/cacheRank';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';
import { recordItemDiscoveries } from './roamingHandler';
import { eliteDiscovery } from '../../content/collections';

function formatTimeAway(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function createSettleOfflineHandler(
  store: ChefGameplayStore,
  config: AuthConfig & { economyConfig?: EconomyConfig; now?: () => Date },
) {
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

      // Crafting offline settlement (crafting §2.1 + flag F5): the
      // recorded action was crafting, so the away window advances the
      // player's craft jobs through the settler instead of the
      // roaming engine. The AFK cap governs craft progress exactly as
      // it governs roaming (effective = min(earned tier + keystone
      // bonus, the player's limiter, the levered ceiling)), and the
      // whole computed cap bounds the settler's advance. The settler
      // is itself idempotent — it rebases its settle watermark on
      // every run, so a repeated call settles ~nothing — and job
      // completions land in the response's crafting section for the
      // offline recap.
      if (activeAction && activeAction.active_action === 'crafting') {
        let craftProfile: Awaited<ReturnType<ChefGameplayStore['getSettlementProfile']>>;
        try {
          craftProfile = await store.getSettlementProfile(playerId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: 'Failed to read profile', detail: message });
          return;
        }
        if (!craftProfile) {
          res.json({ settled: false, reason: 'no_profile' });
          return;
        }
        let craftGear: Awaited<ReturnType<ChefGameplayStore['getEquippedGear']>>;
        try {
          craftGear = await store.getEquippedGear(playerId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: 'Failed to read loadout', detail: message });
          return;
        }
        const craftSkillBonuses = skillBonusesFromRecords(
          craftGear,
          (craftProfile.skill_spends ?? {}) as Record<string, number>,
        );
        // Research (0038): Supply Chains' +1h joins the cap's bonus
        // hours (settle-first derivation from completion rows).
        const craftResearchBonuses = await store.getResearchBonuses(playerId);
        const craftEconomy = config.economyConfig
          ? await config.economyConfig.snapshot()
          : undefined;
        const craftCapHours = effectiveOfflineCapHours({
          level: craftProfile.player_level || 1,
          bonusHours:
            Math.max(0, Math.floor(craftSkillBonuses.offlineCapBonus ?? 0))
            + craftResearchBonuses.offlineCapBonus,
          userCapHours: craftProfile.offline_cap_hours,
          ceilingHours: craftEconomy?.absoluteOfflineCapHours ?? ABSOLUTE_OFFLINE_CAP_HOURS,
        });
        let craftSettled: Json;
        try {
          craftSettled = await store.settleOfflineCraftJobs(
            playerId,
            craftCapHours * 60 * 60 * 1000,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: 'Craft settlement failed', detail: message });
          return;
        }
        const craftResult = (craftSettled ?? {}) as Record<string, unknown>;
        res.json({
          settled: true,
          crafting: {
            advancedMs: Number(craftResult.advanced_ms ?? 0),
            xpAwarded: Number(craftResult.xp_awarded ?? 0),
            jobsCompleted: Number(craftResult.jobs_completed ?? 0),
            completions: (craftResult.completions as unknown[]) ?? [],
            capHours: craftCapHours,
          },
        });
        return;
      }

      // Extraction offline settlement (0033): the recorded action
      // was extraction, so the away window advances the player's
      // extraction passes through the same settler family — the AFK
      // cap governs extraction exactly as it governs crafting
      // (effective = min(earned tier + keystone bonus, the player's
      // limiter, the levered ceiling)), passed in whole as the
      // settler's max advance. Lazier settles (transitions, reads)
      // use the internal no-keystone cap inside the settler itself;
      // only this explicit settlement carries the keystone bonus.
      // Passes finalize here, so the recap gains an extraction
      // section with the batch's finds + XP.
      if (activeAction && activeAction.active_action === 'extraction') {
        let extractProfile: Awaited<ReturnType<ChefGameplayStore['getSettlementProfile']>>;
        try {
          extractProfile = await store.getSettlementProfile(playerId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: 'Failed to read profile', detail: message });
          return;
        }
        if (!extractProfile) {
          res.json({ settled: false, reason: 'no_profile' });
          return;
        }
        let extractGear: Awaited<ReturnType<ChefGameplayStore['getEquippedGear']>>;
        try {
          extractGear = await store.getEquippedGear(playerId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: 'Failed to read loadout', detail: message });
          return;
        }
        const extractSkillBonuses = skillBonusesFromRecords(
          extractGear,
          (extractProfile.skill_spends ?? {}) as Record<string, number>,
        );
        const extractResearchBonuses = await store.getResearchBonuses(playerId);
        const extractEconomy = config.economyConfig
          ? await config.economyConfig.snapshot()
          : undefined;
        const extractCapHours = effectiveOfflineCapHours({
          level: extractProfile.player_level || 1,
          bonusHours:
            Math.max(0, Math.floor(extractSkillBonuses.offlineCapBonus ?? 0))
            + extractResearchBonuses.offlineCapBonus,
          userCapHours: extractProfile.offline_cap_hours,
          ceilingHours: extractEconomy?.absoluteOfflineCapHours ?? ABSOLUTE_OFFLINE_CAP_HOURS,
        });
        let extractSettled: Awaited<ReturnType<ChefGameplayStore['settleExtraction']>>;
        try {
          extractSettled = await store.settleExtraction(playerId, {
            levers: resolveExtractionLevers(extractEconomy as Partial<Record<string, unknown>> | undefined),
            hotAreaMaterialBonus:
              extractEconomy?.hotAreaMaterialBonus ?? HOT_AREA_MATERIAL_BONUS,
            maxAdvanceMs: extractCapHours * 60 * 60 * 1000,
            cacheRankXpFraction: cacheRankBonuses(extractProfile.cache_rank_spends, extractEconomy).xp,
            now: config.now?.() ?? new Date(),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: 'Extraction settlement failed', detail: message });
          return;
        }
        res.json({
          settled: true,
          extraction: {
            advancedMs: extractSettled.advancedMs,
            xpAwarded: extractSettled.xpAwarded,
            passesCompleted: extractSettled.passes.length,
            passes: extractSettled.passes,
            materials: extractSettled.materials,
            essences: extractSettled.essences,
            capHours: extractCapHours,
          },
        });
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
      // Research (0038): completion-derived bonuses merge onto the
      // one bonus record (Xenotech terms + Powertrain decay), and
      // Supply Chains' +1h joins the cap's bonus hours below.
      const researchBonuses = await store.getResearchBonuses(playerId);
      const skillBonuses = mergeResearchBonuses(
        skillBonusesFromRecords(
          equippedGear,
          (profile.skill_spends ?? {}) as Record<string, number>,
        ),
        researchBonuses,
      );

      // Vehicle parity (Phase 2b): offline settlement runs the SAME
      // engine with the SAME vehicle input a foreground claim would
      // carry — equipped instance + condition from item_instances,
      // tank fuel from the profile — so the yield/fuel/condition
      // math cannot drift between the two paths.
      let equippedVehicle: Awaited<ReturnType<ChefGameplayStore['getEquippedVehicle']>>;
      try {
        equippedVehicle = await store.getEquippedVehicle(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read vehicle', detail: message });
        return;
      }

      // Offline cap — the AFK limiter law (Michael's 2026-10-30
      // ruling, roaming-variance brief §2.6):
      //   effective = min(earned tier + keystone bonus,
      //                   the player's own limiter (if set),
      //                   the absolute ceiling — 24h, economy-levered)
      // Earned stays server-derived: earnedOfflineCapHours(player
      // level) + the Scavenger keystone's offlineCapBonus from the
      // server-rebuilt skill bonuses above. The stored
      // profiles.offline_cap_hours is the player's LIMITER (set in
      // Settings): it can only shorten a settlement, never extend it
      // past what was earned — effectiveOfflineCapHours enforces the
      // min() and the [1, 24] clamp. The same value is passed into
      // cc_settle_offline_roaming (0015's _cap_hours) so the atomic
      // settlement caps its own window identically.
      const economyValues = config.economyConfig
        ? await config.economyConfig.snapshot()
        : undefined;
      // Drop luck (0035): the player's active weekly-leaderboard
      // buff, from the server's own buff rows (engine parity: the
      // offline claim carries the same buff a foreground claim
      // would). A read failure is a 500 like the reads above.
      let dropLuckBonus = 0;
      try {
        dropLuckBonus = await store.getActiveDropBonus(playerId, config.now?.() ?? new Date());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read drop buff', detail: message });
        return;
      }
      const offlineCapBonus =
        Math.max(0, Math.floor(skillBonuses.offlineCapBonus ?? 0))
        + researchBonuses.offlineCapBonus;
      const capHours = effectiveOfflineCapHours({
        level: profile.player_level || 1,
        bonusHours: offlineCapBonus,
        userCapHours: profile.offline_cap_hours,
        ceilingHours: economyValues?.absoluteOfflineCapHours ?? ABSOLUTE_OFFLINE_CAP_HOURS,
      });
      const capMs = capHours * 60 * 60 * 1000;
      const rawElapsedMs = Math.max(0, Date.now() - new Date(settleFrom).getTime());
      const elapsedMs = Math.min(rawElapsedMs, capMs);
      const ticksRequested = Math.floor(elapsedMs / 3000);

      if (ticksRequested <= 0) {
        res.json({ settled: false, reason: 'no_elapsed' });
        return;
      }

      // Quality wiring (crafting §2.4): the offline claim carries the
      // SAME batch quality profile a foreground claim would — the
      // parity twin of the roaming route's read.
      let settlementBatches: Awaited<ReturnType<ChefGameplayStore['getConsumableBatches']>>;
      try {
        settlementBatches = await store.getConsumableBatches(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read consumable batches', detail: message });
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
        // Cache Rank bonuses (0031): from the profile's own
        // cache_rank_spends + live levers — settlement simulates the
        // same ticks a foreground claim would (engine parity).
        cacheRankBonuses: cacheRankBonuses(profile.cache_rank_spends, economyValues),
        consumableInventory: (profile.consumables ?? {}) as Record<string, number>,
        consumableQualityProfile: buildConsumableQualityProfile(
          settlementBatches,
          (profile.consumables ?? {}) as Record<string, number>,
        ),
        // Server-authoritative scrap bank (migration 0009).
        scrapRemainder: profile.scrap_remainder,
        creditsRemainder: profile.credits_remainder,
        xpRemainder: profile.xp_remainder,
        vehicle: equippedVehicle
          ? {
              vehicle: equippedVehicle.vehicle,
              conditionCurrent: equippedVehicle.conditionCurrent,
              conditionMax: equippedVehicle.conditionMax,
              fuelUnits: profile.vehicle_fuel,
            }
          : null,
        // Live economy levers (0018), resolved server-side. The
        // event base chance and the hot-area stamp apply offline too
        // (engine parity doctrine: settlement simulates the same
        // ticks a foreground claim would, so it must carry the same
        // inputs — the vehicles parity test pins this identity).
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
        hotArea: isHotArea(area.id, config.now?.() ?? new Date()),
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

      // Persist the vehicle outcome (Phase 2b): same treatment as
      // the store-items step below — the settlement itself is
      // already applied atomically, so a failure is logged, never
      // silently retried (the nonce forbids a second settlement).
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
          console.error('[chef] settlement vehicle usage failed:', message);
        }
      }

      if (result.items.length > 0) {
        try {
          await store.storeChefItems(playerId, result.items);
          await recordItemDiscoveries(store, playerId, result.items, 'offline_drop');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] settlement store items failed:', message);
        }
      }

      // Roaming-event telemetry (0023): same treatment as the vehicle
      // outcome above — the settlement is already applied atomically,
      // so a failure is logged, never retried (the nonce forbids a
      // second settlement) and never fails the response.
      if (result.eventsFired.length > 0 || result.eliteKills > 0) {
        try {
          await store.recordRoamingEvents(playerId, {
            events: result.eventsFired.map((e) => ({ eventId: e.eventId, family: e.family })),
            eliteKills: result.eliteKills,
            areaId: area.id,
            tickCount: (profile.last_claimed_tick || 0) + ticksRequested,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] settlement roaming-event record failed:', message);
        }
        if (result.eliteKills > 0) {
          const elite = eliteDiscovery(area.id);
          if (elite) {
            try {
              await store.recordDiscoveries(playerId, [elite]);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error('[chef] settlement elite discovery failed:', message);
            }
          }
        }
      }

      // Manufacturer Standing (0043): the use drip on the settled
      // kills — the brief's Q4 default pays the drip on offline
      // settlement too, from the same server-derived primary weapon.
      // Same treatment as telemetry: the settlement is applied
      // atomically and the nonce forbids a second one, so a failure
      // is logged, never retried, and never fails the response. A
      // replayed settlement returns above and never reaches this —
      // the drip pays exactly once per settlement.
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
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] settlement standing accrual failed:', message);
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
        vehicle: result.vehicle,
        items: result.items,
        feedEvents: result.feedEvents,
        consumedConsumables: result.consumedConsumables,
        ...(standingBlock ? { standing: standingBlock } : {}),
        idempotent: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[chef] settlement error:', message);
      sendRouteError(res, 'Offline settlement failed', err);
    }
  };
}
