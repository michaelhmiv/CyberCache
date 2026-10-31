/**
 * Endless mode routes (migration 0028) — the Chaos Chamber.
 *
 *   POST /api/endless/start     — enter: fee + belt burn + slot, atomically
 *   POST /api/endless/encounter — resolve the next depth (server-owned)
 *   POST /api/endless/bank      — voluntary exit, escrow paid in full
 *   GET  /api/endless/me        — facts: intel, best depth, run state
 *
 * Trust model (the #207 pattern, same as verify-boss): identity comes
 * from the JWT only; the body carries INTENT — a nonce, the prepared
 * belt choice at entry, nothing else is read. Depth is derived from
 * the server run row, gear/skills/consumables are derived from
 * server records per encounter, rewards come from the engine, and
 * payouts come from the appliers' escrow math. A body claiming a
 * depth, a reward, or a payout is simply never read.
 *
 * The prep payload is INTEL ONLY (Boss Intel Law): the run's scaling
 * facts from src/content/endless.ts — never a readiness figure.
 */
import type { Request, Response } from 'express';
import { processEndlessEncounter } from '../chef';
import type { AuthConfig } from '../auth/routes';
import type { EconomyConfig, EconomyConfigValues } from '../economy/config';
import type { ChefGameplayStore, Json } from '../gameplay/store';
import { bossSlotsFromEquipped, skillBonusesFromRecords } from '../gameplay/serverLoadout';
import { utcDayStartIso } from '../../lib/bossFees';
import {
  buildConsumableQualityProfile,
  weightedQualityForUnits,
} from '../../lib/consumables/batchProfile';
import {
  ENDLESS_LEVER_DEFAULTS,
  endlessEncounterForDepth,
  endlessEntryFeeFor,
  endlessIntel,
  type EndlessLeverValues,
} from '../../content/endless';
import { RiskSetting, SkillTreeType } from '../../types/game';
import type { GearItem } from '../../types/items';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';
import { resolvePreparedConsumables } from './claim';
import { recordItemDiscoveries } from './roamingHandler';
import {
  scaleConsumableQuality,
  type ActionSkillFirePlan,
} from '../../content/actionSkills';
import { classModBoostsFromGear } from '../gameplay/serverLoadout';
import {
  actionSkillEcho,
  actionSkillLevers,
  actionSkillStateFor,
  planActionSkillFire,
} from './actionSkill';

type EndlessConfig = AuthConfig & { economyConfig?: EconomyConfig };

const RISK_VALUES = new Set<string>(Object.values(RiskSetting));

function resolveRisk(raw: unknown): RiskSetting {
  return typeof raw === 'string' && RISK_VALUES.has(raw) ? (raw as RiskSetting) : RiskSetting.Balanced;
}

/** The endless lever set from the live accessor (defaults when unwired). */
async function endlessLevers(config: EndlessConfig): Promise<EndlessLeverValues> {
  if (!config.economyConfig) return { ...ENDLESS_LEVER_DEFAULTS };
  const values: EconomyConfigValues = await config.economyConfig.snapshot();
  return {
    endlessHpGrowth: values.endlessHpGrowth,
    endlessDpsGrowth: values.endlessDpsGrowth,
    endlessXpPerLevel: values.endlessXpPerLevel,
    endlessCreditsPerLevel: values.endlessCreditsPerLevel,
    endlessScrapPerLevel: values.endlessScrapPerLevel,
    endlessRewardDepthGrowth: values.endlessRewardDepthGrowth,
    endlessDeathPayoutFraction: values.endlessDeathPayoutFraction,
    endlessEntryFeePerLevel: values.endlessEntryFeePerLevel,
    endlessFeeEscalationCap: values.endlessFeeEscalationCap,
    endlessMilestoneLegendaryPerDepth: values.endlessMilestoneLegendaryPerDepth,
    endlessMilestoneEpicPerDepth: values.endlessMilestoneEpicPerDepth,
    endlessMaxDepth: values.endlessMaxDepth,
  };
}

/** Applier error → HTTP status (the messages are the appliers' own). */
function endlessErrorStatus(message: string): number {
  if (message.includes('Insufficient credits') || message.includes('Insufficient consumable')) return 400;
  // 0030: applier-side action skill fire refusals are client-visible.
  if (
    message.includes('Action skill is not charged') ||
    message.includes('Action skill selection mismatch') ||
    message.includes('Action skill not qualified')
  ) {
    return 400;
  }
  if (
    message.includes('Hunter is dead') ||
    message.includes('not active') ||
    message.includes('does not hold the action slot') ||
    message.includes('depth mismatch') ||
    message.includes('Endless run not found')
  ) {
    return 409;
  }
  return 500;
}

function sendStoreError(res: Response, fallback: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = endlessErrorStatus(message);
  if (status === 500) console.error(`[chef] ${fallback}:`, message);
  res.status(status).json({ error: fallback, detail: message });
}

/** Item kind for milestone-drop facts (the cc_store_chef_items cascade). */
function milestoneKind(item: GearItem): string {
  if ('weaponType' in item) return 'weapon';
  if ('mitigation' in item) return 'shield';
  if ('treeBonus' in item) return 'classMod';
  if ('damage' in item) return 'ordnance';
  return 'relic';
}

export function createStartEndlessRunHandler(store: ChefGameplayStore, config: EndlessConfig) {
  return async function handleStartEndlessRun(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as {
        playerId?: string;
        jwt?: string;
        nonce?: string;
        consumables?: unknown;
        risk?: unknown;
      };
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      const nonce =
        typeof body.nonce === 'string' && body.nonce.trim().length >= 8
          ? body.nonce
          : `endless-start:${playerId}:${Date.now()}`;
      const risk = resolveRisk(body.risk);

      const profile = await store.getBossProfile(playerId);
      if (!profile) {
        res.status(500).json({ error: 'Failed to read player profile', detail: 'Profile not found' });
        return;
      }
      const death = await store.getDeathRecord(playerId);
      if (death) {
        res.status(409).json({
          error: 'Hunter is dead',
          detail: 'Resurrect before entering the Chamber — endless deaths are contained and never write the roaming death record, but the Chamber takes living hunters only.',
        });
        return;
      }
      const ownedConsumables: Record<string, number> =
        profile.consumables && typeof profile.consumables === 'object'
          ? (profile.consumables as Record<string, number>)
          : {};
      const resolved = resolvePreparedConsumables(body.consumables, ownedConsumables);
      if ('error' in resolved) {
        res.status(400).json({ error: 'Invalid prepared consumables', detail: resolved.error });
        return;
      }

      const levers = await endlessLevers(config);
      const facts = await store.getEndlessFacts(playerId, utcDayStartIso());
      const fee = endlessEntryFeeFor(profile.player_level, facts.runsStartedToday, levers);
      // Affordability mirrors the applier's ordering: a still-active
      // run is carried out first, and its payout can fund this entry.
      const activeRun = await store.getActiveEndlessRun(playerId);
      const carryOut = activeRun
        ? Math.floor(activeRun.escrow_credits * levers.endlessDeathPayoutFraction)
        : 0;
      if (profile.credits + carryOut < fee.fee) {
        res.status(400).json({
          error: 'Insufficient credits for endless entry fee',
          detail: `Entry fee is ${fee.fee}cr; the server profile holds ${profile.credits}cr.`,
        });
        return;
      }

      let applied: Json;
      try {
        applied = await store.startEndlessRun(playerId, {
          nonce,
          risk,
          preparedConsumables: resolved.prepared,
          entryFee: fee.fee,
          deathPayoutFraction: levers.endlessDeathPayoutFraction,
        });
      } catch (err) {
        sendStoreError(res, 'Failed to start endless run', err);
        return;
      }
      const record = applied as Record<string, unknown>;
      res.json({
        verified: true,
        run: record.run,
        entryFee: record.entry_fee,
        runsStartedToday: record.runs_started_today,
        abandonedSettlement: record.abandoned_settlement ?? null,
        profile: record.profile,
        idempotentReplay: record.idempotent_replay === true,
      });
    } catch (err) {
      console.error('[chef] endless start error:', err instanceof Error ? err.message : err);
      sendRouteError(res, 'Endless start failed', err);
    }
  };
}

export function createAdvanceEndlessHandler(store: ChefGameplayStore, config: EndlessConfig) {
  return async function handleAdvanceEndless(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as {
        playerId?: string;
        jwt?: string;
        nonce?: string;
        fireActionSkill?: unknown;
      };
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      const nonce =
        typeof body.nonce === 'string' && body.nonce.trim().length >= 8
          ? body.nonce
          : `endless-encounter:${playerId}:${Date.now()}`;

      // The run, the depth, and the slot all come from server state.
      // Any depth/reward fields in the body are never read.
      // Replay contract: encounter nonces replay through the store
      // while the run is active. Once the run has closed, the facts
      // read (GET /api/endless/me) is the recovery surface — it
      // carries the run's status, depth, and payout — so a late
      // replay of the closing encounter answers 409 here rather than
      // re-deriving an engine outcome for a run that no longer exists.
      const run = await store.getActiveEndlessRun(playerId);
      if (!run) {
        res.status(409).json({ error: 'No active endless run', detail: 'Start a run before resolving encounters.' });
        return;
      }
      const action = await store.getActiveAction(playerId);
      if (!action || action.active_action !== 'endless_run' || action.target_id !== run.id) {
        res.status(409).json({
          error: 'Endless run does not hold the action slot',
          detail: 'The Chamber is paused while another action holds the slot. Switch back to the run to continue, or bank it.',
        });
        return;
      }
      const profile = await store.getBossProfile(playerId);
      if (!profile) {
        res.status(500).json({ error: 'Failed to read player profile', detail: 'Profile not found' });
        return;
      }
      const levers = await endlessLevers(config);
      const depth = run.depth_reached + 1;
      if (depth > levers.endlessMaxDepth) {
        res.status(409).json({ error: 'Endless depth cap reached', detail: 'The run should already have banked at the cap.' });
        return;
      }

      // Gear + skills from server records (trust hardening, #207) —
      // each encounter prices the loadout the player currently holds.
      const equippedItems = await store.getEquippedItems(playerId);
      const serverGear = equippedItems.map((entry) => entry.item);
      const serverSlots = bossSlotsFromEquipped(equippedItems);
      const serverSkillBonuses = skillBonusesFromRecords(
        serverGear,
        (profile.skill_spends ?? {}) as Record<string, number>,
      );

      // The belt burned at entry still prices into every encounter:
      // quality from the server's batch rows against owned counts.
      const ownedConsumables: Record<string, number> =
        profile.consumables && typeof profile.consumables === 'object'
          ? (profile.consumables as Record<string, number>)
          : {};
      const batches = await store.getConsumableBatches(playerId);
      const qualityProfile = buildConsumableQualityProfile(batches, ownedConsumables);
      const consumableQuality: Record<string, number> = {};
      for (const [type, count] of Object.entries(run.prepared_consumables)) {
        if (count > 0 && qualityProfile[type]) {
          consumableQuality[type] = weightedQualityForUnits(qualityProfile[type], count);
        }
      }

      // --- Action skill fire (0030) ---
      // Boolean intent only; the plan resolves from server records +
      // levers against THIS depth's encounter def. Charge carries
      // across encounters inside the run (the pool lives on the
      // profile) and resets when the run ends (the appliers' rule).
      const fireIntent = body.fireActionSkill === true;
      const actionSkillLeverValues = await actionSkillLevers(config);
      let actionSkillPlan: ActionSkillFirePlan | null = null;
      let actionSkillTree: SkillTreeType | null = null;
      let effectiveConsumableQuality = consumableQuality;
      if (fireIntent) {
        const encounterDef = endlessEncounterForDepth(depth, run.start_level, levers).def;
        const planned = planActionSkillFire({
          spent: (profile.skill_spends ?? {}) as Record<string, number>,
          classModBoosts: classModBoostsFromGear(serverGear),
          selection: profile.action_skill_selection,
          charge: profile.action_skill_charge,
          target: encounterDef,
          levers: actionSkillLeverValues,
        });
        if ('error' in planned) {
          res.status(400).json({ error: 'Action skill cannot fire', detail: planned.error });
          return;
        }
        actionSkillPlan = planned.plan;
        actionSkillTree = planned.tree;
        if (actionSkillTree === SkillTreeType.Fixer && actionSkillPlan.qualityMultiplier) {
          effectiveConsumableQuality = scaleConsumableQuality(
            consumableQuality,
            Object.keys(run.prepared_consumables),
            actionSkillPlan.qualityMultiplier,
          );
        }
      }

      const outcome = processEndlessEncounter({
        playerId,
        runId: run.id,
        startLevel: run.start_level,
        depth,
        playerLevel: profile.player_level,
        playerCredits: profile.credits,
        consumables: run.prepared_consumables,
        consumableQuality: effectiveConsumableQuality,
        risk: resolveRisk(run.risk),
        pityCount: 0,
        economy: levers,
        actionSkillFire: actionSkillPlan,
        ...serverSlots,
        skillBonuses: serverSkillBonuses,
      });

      const milestoneItem = outcome.items[0];
      let applied: Json;
      try {
        applied = await store.applyEndlessEncounter(playerId, {
          nonce,
          runId: run.id,
          depth,
          victory: outcome.result.victory,
          rewards: outcome.rewards,
          encounter: {
            ...outcome.encounter,
            result: outcome.result,
            telemetry: outcome.telemetry,
          } as unknown as Json,
          milestoneDrop: milestoneItem
            ? { rarity: milestoneItem.rarity, kind: milestoneKind(milestoneItem), name: milestoneItem.name }
            : null,
          capReached: outcome.capReached,
          deathPayoutFraction: levers.endlessDeathPayoutFraction,
          actionSkillTree,
          actionSkillChargeRate: actionSkillLeverValues.actionSkillChargePerEndlessEncounter,
        });
      } catch (err) {
        sendStoreError(res, 'Failed to apply endless encounter', err);
        return;
      }
      const record = applied as Record<string, unknown>;

      // Nonce replay: report the stored resolution; the freshly
      // rolled outcome above is discarded (its milestone item id was
      // never stored — storing it would duplicate the first drop).
      if (record.idempotent_replay === true) {
        res.json({
          verified: true,
          idempotentReplay: true,
          victory: record.victory,
          depth: record.depth,
          rewards: record.rewards,
          escrow: record.escrow,
          runStatus: record.run_status,
          payout: record.payout ?? null,
          items: [],
          profile: record.profile,
          run: record.run,
          actionSkill: actionSkillEcho(record.profile),
        });
        return;
      }

      // Milestone + Cache Surge drops store through the same path —
      // both are ordinary server-generated Chamber items by the time
      // they reach here.
      const droppedItems = [...outcome.items, ...outcome.surgeItems];
      if (droppedItems.length > 0) {
        try {
          await store.storeChefItems(playerId, droppedItems);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chef] Failed to store endless milestone loot:', message);
          res.status(500).json({
            error: 'Failed to store milestone loot items',
            detail: message,
            profile: record.profile,
            victory: outcome.result.victory,
          });
          return;
        }
        await recordItemDiscoveries(store, playerId, droppedItems, 'endless_milestone');
      }

      res.json({
        verified: true,
        encounter: outcome.encounter,
        result: outcome.result,
        victory: outcome.result.victory,
        rewards: outcome.rewards,
        milestone: outcome.milestone,
        capReached: outcome.capReached,
        telemetry: outcome.telemetry,
        items: droppedItems,
        escrow: record.escrow,
        runStatus: record.run_status,
        payout: record.payout ?? null,
        profile: record.profile,
        run: record.run,
        actionSkill: actionSkillEcho(record.profile),
      });
    } catch (err) {
      console.error('[chef] endless encounter error:', err instanceof Error ? err.message : err);
      sendRouteError(res, 'Endless encounter failed', err);
    }
  };
}

export function createBankEndlessHandler(store: ChefGameplayStore, config: EndlessConfig) {
  return async function handleBankEndless(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as { playerId?: string; jwt?: string; nonce?: string };
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      const nonce =
        typeof body.nonce === 'string' && body.nonce.trim().length >= 8
          ? body.nonce
          : `endless-bank:${playerId}:${Date.now()}`;
      const levers = await endlessLevers(config);

      let applied: Json;
      try {
        applied = await store.endEndlessRun(playerId, {
          nonce,
          deathPayoutFraction: levers.endlessDeathPayoutFraction,
        });
      } catch (err) {
        sendStoreError(res, 'Failed to bank endless run', err);
        return;
      }
      const record = applied as Record<string, unknown>;
      if (record.ended !== true) {
        res.status(409).json({ error: 'No active endless run', detail: 'There is no run to bank.' });
        return;
      }
      res.json({
        verified: true,
        ended: true,
        runId: record.run_id,
        depthReached: record.depth_reached,
        payout: record.payout,
        profile: record.profile,
        run: record.run,
        idempotentReplay: record.idempotent_replay === true,
        // The run's end reset the charge pool — echo the new state.
        actionSkill: actionSkillEcho(record.profile),
      });
    } catch (err) {
      console.error('[chef] endless bank error:', err instanceof Error ? err.message : err);
      sendRouteError(res, 'Endless bank failed', err);
    }
  };
}

export function createGetEndlessHandler(store: ChefGameplayStore, config: EndlessConfig) {
  return async function handleGetEndless(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      const profile = await store.getBossProfile(playerId);
      if (!profile) {
        res.status(500).json({ error: 'Failed to read player profile', detail: 'Profile not found' });
        return;
      }
      const levers = await endlessLevers(config);
      const facts = await store.getEndlessFacts(playerId, utcDayStartIso());
      const activeRun = await store.getActiveEndlessRun(playerId);
      res.json({
        verified: true,
        intel: endlessIntel(profile.player_level, facts.runsStartedToday, levers),
        bestDepth: facts.bestDepth,
        runsStartedToday: facts.runsStartedToday,
        recentRuns: facts.recentRuns,
        activeRun,
        // The player's OWN signature state (intel law: own data only).
        actionSkill: await actionSkillStateFor(store, playerId),
      });
    } catch (err) {
      console.error('[chef] endless facts error:', err instanceof Error ? err.message : err);
      sendRouteError(res, 'Endless facts failed', err);
    }
  };
}
