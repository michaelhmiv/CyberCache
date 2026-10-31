/**
 * Action skill routes (Action Skill slice, migration 0030).
 *
 *   GET  /api/action-skill/me            — the player's OWN signature state
 *   POST /api/action-skill/select        — record the active signature
 *   POST /api/action-skill/fire-workshop — the Fixer's Overclock workshop fire
 *
 * Trust model (the #207 pattern): identity comes from the JWT only;
 * bodies carry intent — a nonce, a tree NAME for the selection, and
 * nothing else. Qualification, selection, and charge are always
 * derived from server records (profiles.skill_spends + the equipped
 * class mod + the profile's charge/selection columns) through
 * src/content/actionSkills.ts, the one content owner. The combat fire
 * itself is not a route: it rides the verify-boss / endless encounter
 * resolutions as a boolean intent, planned here via
 * planActionSkillFire and validated again by the appliers under the
 * profile row lock.
 *
 * Intel law: everything these routes return is the player's OWN
 * signature state. No boss odds, no readiness figures.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { EconomyConfig } from '../economy/config';
import type { ChefGameplayStore, Json } from '../gameplay/store';
import type { WriteStore } from '../writes/store';
import { classModBoostsFromGear } from '../gameplay/serverLoadout';
import type { ClassModBoosts } from '../../lib/skills/skillBonuses';
import {
  ACTION_SKILL_CHARGE_MAX,
  actionSkillStateView,
  buildActionSkillFirePlan,
  isActionSkillTree,
  resolveActionSkill,
  resolveActionSkillLevers,
  type ActionSkillFirePlan,
  type ActionSkillLeverValues,
  type ActionSkillStateView,
} from '../../content/actionSkills';
import { SkillTreeType } from '../../types/game';
import type { GearItem } from '../../types/items';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export type ActionSkillConfig = AuthConfig & { economyConfig?: EconomyConfig };

/** The action-skill lever set from the live accessor (defaults when unwired). */
export async function actionSkillLevers(config: ActionSkillConfig): Promise<ActionSkillLeverValues> {
  if (!config.economyConfig) return resolveActionSkillLevers();
  const values = await config.economyConfig.snapshot();
  return resolveActionSkillLevers(values);
}

/** Boosts from a stored class mod payload ({} when none equipped). */
export function boostsFromModPayload(payload: unknown): ClassModBoosts {
  if (!payload || typeof payload !== 'object' || !('treeBonus' in (payload as Record<string, unknown>))) {
    return { nodeBoosts: {} };
  }
  return classModBoostsFromGear([payload as unknown as GearItem]);
}

/** The state view from a gameplay-store facts read (null = no profile). */
export async function actionSkillStateFor(
  store: ChefGameplayStore,
  playerId: string,
): Promise<ActionSkillStateView | null> {
  const facts = await store.getActionSkillFacts(playerId);
  if (!facts) return null;
  return actionSkillStateView({
    spent: (facts.skill_spends ?? {}) as Record<string, number>,
    classModBoosts: boostsFromModPayload(facts.class_mod_payload),
    selection: facts.action_skill_selection,
    charge: facts.action_skill_charge,
  });
}

/** The compact post-resolution echo the attempt/encounter responses carry. */
export function actionSkillEcho(profile: unknown): { selection: string | null; charge: number } | null {
  if (!profile || typeof profile !== 'object') return null;
  const record = profile as Record<string, unknown>;
  if (typeof record.action_skill_charge !== 'number' && record.action_skill_charge === undefined) {
    return null;
  }
  return {
    selection:
      typeof record.action_skill_selection === 'string' ? record.action_skill_selection : null,
    charge: typeof record.action_skill_charge === 'number' ? record.action_skill_charge : 0,
  };
}

/**
 * Plan a combat fire from server records. Returns an error string for
 * the route to 400 on: no recorded selection, a selection the player
 * no longer qualifies for, or a pool that is not full. The applier
 * re-validates all three under the row lock — this plan only decides
 * the EFFECT; it can never mint a fire the applier would refuse.
 */
export function planActionSkillFire(input: {
  spent: Record<string, number>;
  classModBoosts: ClassModBoosts;
  selection: string | null | undefined;
  charge: number;
  target: { health: number; shield: number; armor: number };
  levers: ActionSkillLeverValues;
}): { plan: ActionSkillFirePlan; tree: SkillTreeType } | { error: string } {
  const { selected } = resolveActionSkill(input.spent, input.classModBoosts, input.selection);
  if (!selected) {
    return {
      error:
        'No active action skill: qualify for a signature by owning a skill tree keystone, then select it.',
    };
  }
  if (input.charge < ACTION_SKILL_CHARGE_MAX) {
    return {
      error: `Action skill is not charged (${Math.floor(input.charge)}/${ACTION_SKILL_CHARGE_MAX}).`,
    };
  }
  return {
    plan: buildActionSkillFirePlan(selected, input.target, input.levers),
    tree: selected,
  };
}

/** Applier error → HTTP status for the selection + workshop ops. */
function actionSkillErrorStatus(message: string): number {
  if (
    message.includes('not charged') ||
    message.includes('not qualified') ||
    message.includes('Unknown action skill tree') ||
    message.includes('requires the Fixer signature') ||
    message.includes('No craft unit in progress') ||
    message.includes('nonce is required')
  ) {
    return 400;
  }
  if (message.includes('Profile not found')) return 404;
  return 500;
}

function sendStoreError(res: Response, fallback: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = actionSkillErrorStatus(message);
  if (status === 500) console.error(`[chef] ${fallback}:`, message);
  res.status(status).json({ error: fallback, detail: message });
}

export function createGetActionSkillHandler(store: ChefGameplayStore, _config: ActionSkillConfig) {
  return async function handleGetActionSkill(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(_config, req);
      const state = await actionSkillStateFor(store, playerId);
      if (!state) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      res.json({ verified: true, actionSkill: state });
    } catch (err) {
      sendRouteError(res, 'Action skill state failed', err);
    }
  };
}

export function createSelectActionSkillHandler(store: ChefGameplayStore, _config: ActionSkillConfig) {
  return async function handleSelectActionSkill(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as {
        playerId?: string;
        jwt?: string;
        nonce?: string;
        tree?: unknown;
      };
      const playerId = getAuthenticatedChefPlayer(_config, req, body.jwt, body.playerId);
      const nonce =
        typeof body.nonce === 'string' && body.nonce.trim().length >= 8
          ? body.nonce
          : `action-skill-select:${playerId}:${Date.now()}`;
      // The body names a tree (or null to clear); qualification is
      // validated by the applier from server records, never here.
      let tree: SkillTreeType | null;
      if (body.tree === null || body.tree === undefined) {
        tree = null;
      } else if (isActionSkillTree(body.tree)) {
        tree = body.tree;
      } else {
        res.status(400).json({ error: 'Unknown action skill tree', detail: String(body.tree) });
        return;
      }
      let applied: Json;
      try {
        applied = await store.setActionSkillSelection(playerId, nonce, tree);
      } catch (err) {
        sendStoreError(res, 'Failed to set action skill selection', err);
        return;
      }
      const record = applied as Record<string, unknown>;
      const state = await actionSkillStateFor(store, playerId);
      res.json({
        verified: true,
        selection: record.selection ?? tree,
        actionSkill: state,
        profile: record.profile,
        idempotentReplay: record.idempotent_replay === true,
      });
    } catch (err) {
      sendRouteError(res, 'Action skill selection failed', err);
    }
  };
}

export function createFireOverclockWorkshopHandler(writes: WriteStore, _config: ActionSkillConfig) {
  return async function handleFireOverclockWorkshop(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as { playerId?: string; jwt?: string; nonce?: string };
      const playerId = getAuthenticatedChefPlayer(_config, req, body.jwt, body.playerId);
      const nonce =
        typeof body.nonce === 'string' && body.nonce.trim().length >= 8
          ? body.nonce
          : `overclock-workshop:${playerId}:${Date.now()}`;
      let applied: Json;
      try {
        applied = await writes.fireOverclockWorkshop(playerId, nonce);
      } catch (err) {
        sendStoreError(res, 'Failed to fire Overclock', err);
        return;
      }
      const record = applied as Record<string, unknown>;
      res.json({
        verified: true,
        fired: true,
        completions: record.completions ?? [],
        jobsCompleted: record.jobs_completed ?? 0,
        xpAwarded: record.xp_awarded ?? 0,
        profile: record.profile,
        idempotentReplay: record.idempotent_replay === true,
      });
    } catch (err) {
      sendRouteError(res, 'Overclock workshop fire failed', err);
    }
  };
}
