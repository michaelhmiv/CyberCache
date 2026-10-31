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
import { REGION_1_BOSSES } from '../../constants/bosses';
import { CONSUMABLES } from '../../constants/consumables';
import type { AuthConfig } from '../auth/routes';
import type { EconomyConfig } from '../economy/config';
import type { ChefGameplayStore, Json } from '../gameplay/store';
import { bossSlotsFromEquipped, classModBoostsFromGear, skillBonusesFromRecords } from '../gameplay/serverLoadout';
import {
  scaleConsumableQuality,
  type ActionSkillFirePlan,
} from '../../content/actionSkills';
import { SkillTreeType } from '../../types/game';
import { actionSkillEcho, actionSkillLevers, planActionSkillFire } from './actionSkill';
import { escalatedBossFee, utcDayStartIso } from '../../lib/bossFees';
import {
  buildConsumableQualityProfile,
  weightedQualityForUnits,
} from '../../lib/consumables/batchProfile';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';
import { recordItemDiscoveries } from './roamingHandler';
import { bossDiscovery } from '../../content/collections';

/**
 * Validate the client's PREPARED consumable set against DB-owned
 * inventory (Phase 0 boss loop). Boss prep is the strategic layer: the
 * player chooses exactly which consumables to bring, and the Chef
 * honors that choice — the June handler instead discarded the body's
 * consumables and substituted the player's ENTIRE inventory, so prep
 * could never matter and full stacks burned. The prepared set is
 * still never trusted beyond ownership: unknown types are rejected
 * and no type may be prepared beyond the owned count.
 */
export function resolvePreparedConsumables(
  requested: unknown,
  owned: Record<string, number>,
): { prepared: Record<string, number> } | { error: string } {
  if (requested === undefined || requested === null) return { prepared: {} };
  if (typeof requested !== 'object' || Array.isArray(requested)) {
    return { error: 'consumables must be an object of type -> count' };
  }
  const prepared: Record<string, number> = {};
  for (const [type, rawCount] of Object.entries(requested as Record<string, unknown>)) {
    if (!CONSUMABLES[type]) return { error: `Unknown consumable type: ${type}` };
    const count = typeof rawCount === 'number' ? Math.floor(rawCount) : NaN;
    if (!Number.isFinite(count) || count < 0) return { error: `Invalid prepared count for ${type}` };
    if (count === 0) continue;
    const ownedCount = Math.max(0, Math.trunc(owned[type] ?? 0));
    if (count > ownedCount) {
      return { error: `Prepared consumables exceed owned inventory for ${type}: prepared ${count}, owned ${ownedCount}` };
    }
    prepared[type] = count;
  }
  return { prepared };
}

export function createVerifyBossHandler(
  store: ChefGameplayStore,
  config: AuthConfig & { economyConfig?: EconomyConfig },
) {
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

      // The client may report any credit value; the server must use
      // the DB value.
      const serverCredits: number = typeof profile.credits === 'number' ? profile.credits : 0;
      const serverLevel: number = typeof profile.player_level === 'number' ? profile.player_level : 1;

      // Consumable inventory from DB — the ownership bound for the
      // player's prepared set (see resolvePreparedConsumables).
      const ownedConsumables: Record<string, number> =
        profile.consumables && typeof profile.consumables === 'object'
          ? (profile.consumables as Record<string, number>)
          : {};

      // Boss progression from DB — unlocks, defeated list, and pity
      // counters all live in boss_state (see the file header: the June
      // `pity_counters` column this used to select never existed). The
      // applier maintains all three; the route enforces them.
      const serverBossState: Record<string, unknown> =
        profile.boss_state && typeof profile.boss_state === 'object'
          ? (profile.boss_state as Record<string, unknown>)
          : {};
      const serverPityCounters: Record<string, number> =
        serverBossState.pityCounters && typeof serverBossState.pityCounters === 'object'
          ? (serverBossState.pityCounters as Record<string, number>)
          : {};
      const serverPityCount = serverPityCounters[body.bossId] ?? 0;
      const unlockedBossIds: string[] = Array.isArray(serverBossState.unlockedBossIds)
        ? (serverBossState.unlockedBossIds as string[])
        : ['dune_tyrant'];
      const defeatedBossIds: string[] = Array.isArray(serverBossState.defeatedBossIds)
        ? (serverBossState.defeatedBossIds as string[])
        : [];

      const bossDef = REGION_1_BOSSES.find((entry) => entry.id === body.bossId);

      // --- Unlock gate (Phase 0 boss loop) ---
      // A boss may only be attempted once a prior victory unlocked it
      // (boss_state.unlockedBossIds, advanced by the applier). The
      // June path never checked — any authenticated player could
      // attempt any bossId directly.
      if (bossDef && !unlockedBossIds.includes(body.bossId) && !defeatedBossIds.includes(body.bossId)) {
        res.status(403).json({
          error: 'Boss locked',
          detail: `${bossDef.name} has not been unlocked yet. Defeat the previous boss to unlock it.`,
        });
        return;
      }

      // --- Entry fee (Phase 0 boss loop) ---
      // Charged on every resolved attempt: entryCost for a first
      // attempt, rematchCost for a boss the player has already
      // defeated (both fields exist on the boss def; they were
      // display-only before this slice). Derived here from the def +
      // server boss_state — never from the request body.
      const baseEntryFee = bossDef
        ? defeatedBossIds.includes(body.bossId)
          ? bossDef.rematchCost
          : bossDef.entryCost
        : 0;

      // --- Rematch escalation (pacing-baseline tuning) ---
      // The base fee doubles per victory already banked against this
      // boss today (UTC day), capped at ×8 — see src/lib/bossFees.ts.
      // Today's victories are counted from the verified action ledger
      // through the store seam, never from the request body. The
      // response reports the post-attempt count so the prep panel's
      // displayed fee tracks the charged fee exactly.
      let victoriesToday = 0;
      if (bossDef) {
        try {
          victoriesToday = await store.countBossVictoriesToday(playerId, body.bossId, utcDayStartIso());
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: 'Failed to count boss victories', detail: message });
          return;
        }
      }
      // Live economy levers (0018): the escalation cap and dedicated
      // drop chance resolve server-side from the accessor — the
      // charged fee and the roll below are the truth; the prep
      // panel's client-side display uses the shipped defaults and
      // stays advisory.
      const economyValues = config.economyConfig
        ? await config.economyConfig.snapshot()
        : undefined;
      const entryFee = escalatedBossFee(
        baseEntryFee,
        victoriesToday,
        economyValues?.rematchEscalationCap,
      );
      if (serverCredits < entryFee) {
        res.status(400).json({
          error: 'Insufficient credits for boss entry fee',
          detail: `Entry fee is ${entryFee}cr; the server profile holds ${serverCredits}cr.`,
        });
        return;
      }

      // --- Prepared consumables (Phase 0 boss loop) ---
      // The player's chosen set, validated against owned inventory.
      const resolved = resolvePreparedConsumables(body.consumables, ownedConsumables);
      if ('error' in resolved) {
        res.status(400).json({ error: 'Invalid prepared consumables', detail: resolved.error });
        return;
      }

      // Quality wiring (crafting §2.4): the sim's consumable effects
      // price at the quantity-weighted average quality of the batches
      // this attempt will actually burn — the FIFO head of each
      // prepared type — read from the server's own batch rows against
      // the authoritative owned counts. Types with no batch record
      // stay absent from the map, so the sim falls back to the flat
      // 100-quality table for them (shipped behavior).
      let bossBatches: Awaited<ReturnType<ChefGameplayStore['getConsumableBatches']>>;
      try {
        bossBatches = await store.getConsumableBatches(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read consumable batches', detail: message });
        return;
      }
      const bossQualityProfile = buildConsumableQualityProfile(bossBatches, ownedConsumables);
      const consumableQuality: Record<string, number> = {};
      for (const [type, count] of Object.entries(resolved.prepared)) {
        if (count > 0 && bossQualityProfile[type]) {
          consumableQuality[type] = weightedQualityForUnits(bossQualityProfile[type], count);
        }
      }

      const attemptNonce = body.attemptNonce || Date.now();

      // --- Gear + skills from server records (trust hardening) ---
      // Phase 0 Slice 6 closes the last body-trust gap on this route:
      // the sim's gear slots and skillBonuses are derived from the
      // server's own records — equipped item_instances rows (slot
      // identity from equipped_slot, not array position) and
      // profiles.skill_spends — never from the request body. The audit
      // proved the old pass-through made victories fabricable: forged
      // gear objects + a forged {dps: 10} skill record pushed
      // winChance to ~0.98 and the Chef minted genuine loot for it.
      let equippedItems: Awaited<ReturnType<ChefGameplayStore['getEquippedItems']>>;
      try {
        equippedItems = await store.getEquippedItems(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read loadout', detail: message });
        return;
      }
      const serverGear = equippedItems.map((entry) => entry.item);
      const serverSlots = bossSlotsFromEquipped(equippedItems);
      const serverSkillBonuses = skillBonusesFromRecords(
        serverGear,
        (profile.skill_spends ?? {}) as Record<string, number>,
      );

      // --- Action skill fire (0030) ---
      // The body carries only the boolean intent. The plan — which
      // signature, what effect — is resolved HERE from server records
      // (recorded selection + keystone qualification from spends and
      // the equipped class mod + the profile's charge) and the live
      // levers. A forged tree or charge claim in the body is never
      // read. The applier re-validates everything under the row lock.
      const fireIntent = (body as { fireActionSkill?: unknown }).fireActionSkill === true;
      const actionSkillLeverValues = await actionSkillLevers(config);
      let actionSkillPlan: ActionSkillFirePlan | null = null;
      let actionSkillTree: SkillTreeType | null = null;
      let effectiveConsumableQuality = consumableQuality;
      if (fireIntent) {
        if (!bossDef) {
          res.status(400).json({ error: 'Unknown boss', detail: String(body.bossId) });
          return;
        }
        const planned = planActionSkillFire({
          spent: (profile.skill_spends ?? {}) as Record<string, number>,
          classModBoosts: classModBoostsFromGear(serverGear),
          selection: profile.action_skill_selection,
          charge: profile.action_skill_charge,
          target: bossDef,
          levers: actionSkillLeverValues,
        });
        if ('error' in planned) {
          res.status(400).json({ error: 'Action skill cannot fire', detail: planned.error });
          return;
        }
        actionSkillPlan = planned.plan;
        actionSkillTree = planned.tree;
        // Overclock combat fire (Fixer brief §3.7): the attempt's
        // prepared consumables read at quality × the levered
        // multiplier for this attempt only.
        if (actionSkillTree === SkillTreeType.Fixer && actionSkillPlan.qualityMultiplier) {
          effectiveConsumableQuality = scaleConsumableQuality(
            consumableQuality,
            Object.keys(resolved.prepared),
            actionSkillPlan.qualityMultiplier,
          );
        }
      }

      // Build the request with every economy field server-derived.
      // The body contributes intent only: bossId, attemptNonce, the
      // prepared consumable counts (ownership-validated above), the
      // risk setting, and the action skill fire intent.
      const request: BossAttemptRequest = {
        ...body,
        playerId,
        attemptNonce,
        playerLevel: serverLevel,
        playerCredits: serverCredits,
        consumables: resolved.prepared,
        consumableQuality: effectiveConsumableQuality,
        pityCount: serverPityCount,
        entryFee,
        economy: economyValues
          ? { bossDedicatedChance: economyValues.bossDedicatedChance }
          : undefined,
        actionSkillFire: actionSkillPlan,
        ...serverSlots,
        skillBonuses: serverSkillBonuses,
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
          entryFee: result.entryFee,
          actionSkillTree,
          actionSkillChargeRate: actionSkillLeverValues.actionSkillChargePerBossAttempt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // 0030: an applier-side fire refusal (charge spent by a
        // concurrent resolution, selection changed mid-flight) is a
        // client-visible 400, not a server fault.
        if (
          message.includes('Action skill is not charged') ||
          message.includes('Action skill selection mismatch') ||
          message.includes('Action skill not qualified')
        ) {
          res.status(400).json({ error: 'Action skill cannot fire', detail: message });
          return;
        }
        res.status(500).json({ error: 'Failed to apply boss attempt', detail: message });
        return;
      }

      // Nonce replay: the applier returned the stored ledger result
      // and applied nothing twice. The freshly rolled `result` above
      // must NOT be stored or reported — its items carry new random
      // ids, so storing them would duplicate the first call's loot.
      // Report the stored attempt instead; its items are already in
      // the player's inventory from the first application.
      const rpcRecord = rpcResult as Record<string, unknown>;
      if (rpcRecord?.idempotent_replay === true) {
        const storedAttempt = rpcRecord.attempt as Record<string, unknown> | undefined;
        res.json({
          ...result,
          items: [],
          loot: [],
          verified: true,
          victory: storedAttempt?.victory ?? result.result.victory,
          result: storedAttempt ?? result.result,
          pityIncremented: storedAttempt ? storedAttempt.victory !== true : !result.result.victory,
          profile: rpcRecord?.profile ?? rpcResult,
          idempotentReplay: true,
          actionSkill: actionSkillEcho(rpcRecord?.profile),
          // The pre-attempt count on a replay already includes the
          // original application's victory — it IS the current count.
          bossVictoriesToday: victoriesToday,
        });
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
        await recordItemDiscoveries(store, playerId, result.items, 'boss_loot');
      }

      // Collection discovery (0026): the victory was applied by the
      // Chef applier above — record the boss entry from that settled
      // fact. Log-and-continue; the attempt is already paid.
      if (result.result.victory) {
        const boss = bossDiscovery(body.bossId);
        if (boss) {
          try {
            await store.recordDiscoveries(playerId, [boss]);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[chef] Failed to record boss discovery:', message);
          }
        }
      }

      res.json({
        ...result,
        verified: true,
        victory: result.result.victory,
        pityIncremented: !result.result.victory,
        profile: (rpcResult as Record<string, unknown>)?.profile ?? rpcResult,
        // 0030: the player's own signature state after this attempt
        // (charge spent or accrued) — from the applier snapshot.
        actionSkill: actionSkillEcho((rpcResult as Record<string, unknown>)?.profile),
        // Post-attempt victory count for the panel's fee display.
        bossVictoriesToday: victoriesToday + (result.result.victory ? 1 : 0),
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

      // Salvaging proves the item was held — record it in the
      // collection log too (idempotent; the drop usually logged it).
      await recordItemDiscoveries(store, playerId, [result?.item], 'salvage');

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
