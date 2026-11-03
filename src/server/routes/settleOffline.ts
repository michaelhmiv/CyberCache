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
import { IMMEDIATE_DEATH_TICKS, assessAreaDanger } from '../../lib/combat/areaDanger';
import { computeHunterMaxHp } from '../../lib/combat/damageContract';
import { computeEffectiveDpsFromGear } from '../../lib/combat/loadoutSurvival';
import type { Shield, Weapon } from '../../types/items';

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
      // it governs roaming (effective = min(earned cap + keystone
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
        // Research: the Logistics track's offline-cap grants ARE
        // the cap's earned growth (gate-removal step 6 — settle-first
        // derivation from completion rows); the keystone stays a
        // skill bonus on top.
        const craftResearchBonuses = await store.getResearchBonuses(playerId);
        const craftEconomy = config.economyConfig
          ? await config.economyConfig.snapshot()
          : undefined;
        const craftCapHours = effectiveOfflineCapHours({
          researchCapHours: craftResearchBonuses.offlineCapBonus,
          bonusHours: Math.max(0, Math.floor(craftSkillBonuses.offlineCapBonus ?? 0)),
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
      // (effective = min(earned cap + keystone bonus, the player's
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
          researchCapHours: extractResearchBonuses.offlineCapBonus,
          bonusHours: Math.max(0, Math.floor(extractSkillBonuses.offlineCapBonus ?? 0)),
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

      // No area level gate (owner ruling 2026-11-02): a hunter parked
      // in any area settles. What replaced the gate is the overmatched
      // duel check further down — settlement runs the roaming engine,
      // which carries no survival input, so a hunter who would die
      // before killing the area's baseline fodder cannot be paid for
      // presence alone; their window is consumed at zero instead.

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
      // the Logistics track's offline-cap grants carry the cap's
      // earned hours below (gate-removal step 6).
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
      //   effective = min(earned + keystone bonus,
      //                   the player's own limiter (if set),
      //                   the absolute ceiling — 24h, economy-levered)
      // Earned stays server-derived: the 2h base + the Research
      // Logistics track's offline-cap grants (gate-removal step 6 —
      // level no longer carries the cap), plus the Scavenger
      // keystone's offlineCapBonus from the server-rebuilt skill
      // bonuses above. The stored profiles.offline_cap_hours is the
      // player's LIMITER (set in Settings): it can only shorten a
      // settlement, never extend it past what was earned —
      // effectiveOfflineCapHours enforces the min() and the [1, 24]
      // clamp. The same value is passed into
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
      const keystoneCapBonus = Math.max(0, Math.floor(skillBonuses.offlineCapBonus ?? 0));
      const capHours = effectiveOfflineCapHours({
        researchCapHours: researchBonuses.offlineCapBonus,
        bonusHours: keystoneCapBonus,
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

      // Overmatched settlement gate (the death-loop guard's offline
      // half, owner ruling 2026-11-02). Settlement simulates the away
      // window with the roaming engine, which takes NO survival input
      // — offline, a hunter parked in an area whose baseline fodder
      // kills them almost immediately would otherwise accrue the
      // full window's trickle + loot rolls for pure presence (the
      // audit's verified faucet: at HelixWorks rates that is 21
      // credits/min, 5 scrap/min, 2.4 XP/tick plus a 22%/tick gear
      // roll at player-level power, forever, at zero risk). The duel
      // is the warning module's own math (areaDanger) over
      // server-derived stats — the same DPS derivation the engine
      // runs, HP from the one formula. The trigger is a lethal duel
      // AND an immediate death (baseline ticks-to-die within
      // IMMEDIATE_DEATH_TICKS): a merely outmatched hunter — say an
      // unarmed one in the starter area, who survives for hours —
      // settles exactly as before; only the die-on-loop profile is
      // zeroed. Overmatched pairing: the window is consumed through
      // the atomic settler at zero rewards (nonce + watermark advance
      // exactly as a paid settlement, so the time cannot be banked
      // and re-settled later at strength) and the response says why.
      // Every other pairing settles byte-identically to before. No
      // death is recorded for offline time: death/respawn behavior
      // is unchanged.
      const gateCacheRank = cacheRankBonuses(profile.cache_rank_spends, economyValues);
      const gateShield = equippedGear.find((g): g is Shield => 'mitigation' in g);
      const gateClassMod = equippedGear.find((g) => 'treeBonus' in g) ?? null;
      const gateRelic =
        equippedGear.find(
          (g) =>
            'affixes' in g &&
            !('weaponType' in g) &&
            !('damage' in g) &&
            !('hp' in g) &&
            !('treeBonus' in g) &&
            !('vehicleClassId' in g),
        ) ?? null;
      const gateShieldCapacity = gateShield?.hp ?? 0;
      const gateAssessment = assessAreaDanger(area, {
        effectiveDps: computeEffectiveDpsFromGear({
          weapons: equippedGear.filter((g): g is Weapon => 'weaponType' in g),
          ordnance: equippedGear.find((g) => 'damage' in g && !('weaponType' in g)) ?? null,
          relic: gateRelic,
          classMod: gateClassMod,
          skillDpsMult: 1 + (skillBonuses.dps ?? 0) + (gateCacheRank.damage ?? 0),
          skillStatusChance: skillBonuses.statusChance ?? 0,
        }),
        maxHp: Math.round(
          computeHunterMaxHp(profile.player_level || 1, gateShieldCapacity) *
            (1 + (skillBonuses.survival ?? 0)),
        ),
        shieldCapacity: gateShieldCapacity,
        mitigation: gateShield?.mitigation ?? 0,
        dodgeChance: 0,
      });
      if (gateAssessment?.tier === 'lethal' && gateAssessment.baseline.ticksToDie <= IMMEDIATE_DEATH_TICKS) {
        let zeroSettlement: Record<string, unknown> | null;
        try {
          zeroSettlement = (await store.settleOfflineRoaming(playerId, body.settlementNonce, {
            credits: 0,
            scrap: 0,
            scrapRemainder: profile.scrap_remainder,
            creditsRemainder: profile.credits_remainder,
            xpRemainder: profile.xp_remainder,
            xp: 0,
            fragments: 0,
            materials: {},
            essences: {},
            kills: 0,
          }, {}, capHours)) as Record<string, unknown> | null;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: 'Atomic settlement failed', detail: message });
          return;
        }
        if (!zeroSettlement || !zeroSettlement.settled) {
          res.json({ settled: false, reason: (zeroSettlement?.reason as string) || 'error', detail: zeroSettlement?.detail });
          return;
        }
        const zeroElapsedMs = Number(zeroSettlement.elapsed_ms ?? elapsedMs);
        const zeroCappedMs = Number(zeroSettlement.capped_ms ?? capMs);
        res.json({
          settled: true,
          overmatched: true,
          areaId: area.id,
          areaName: area.name,
          timeAway: formatTimeAway(zeroElapsedMs),
          elapsedMs: zeroElapsedMs,
          cappedMs: zeroCappedMs,
          capReached: Boolean(zeroSettlement.cap_reached ?? rawElapsedMs > capMs),
          capHours: Number(zeroSettlement.cap_hours ?? capHours),
          ticksSettled: Number(zeroSettlement.ticks_settled ?? 0),
          startTick: Number(zeroSettlement.start_tick ?? profile.last_claimed_tick ?? 0),
          endTick: Number(zeroSettlement.end_tick ?? 0),
          profile: zeroSettlement.profile ?? {},
          rewards: {
            ticks: Number(zeroSettlement.ticks_settled ?? 0),
            creditsAwarded: 0,
            creditsRemainder: profile.credits_remainder,
            scrapAwarded: 0,
            scrapRemainder: profile.scrap_remainder,
            xpAwarded: 0,
            xpRemainder: profile.xp_remainder,
            cacheFragmentsAwarded: 0,
            materials: {},
            essences: {},
            killsRecorded: 0,
          },
          items: [],
          feedEvents: [],
          consumedConsumables: {},
          idempotent: false,
        });
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
        cacheRankBonuses: gateCacheRank,
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
