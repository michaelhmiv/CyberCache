/**
 * Research routes (research slice, migration 0038).
 *
 *   GET  /api/research/me     — settle-then-read state view
 *   POST /api/research/enroll { nonce, courseId }
 *   POST /api/research/cancel { nonce }
 *
 * R1 made concrete: these routes never touch the activity system.
 * Enrolling, progressing, completing, or cancelling a course has
 * zero interaction with the personal action slot — a hunter roams,
 * crafts, fights, and dies exactly as before while the clock runs
 * on the education track. There is no start/switch semantics here
 * because Research is a commitment, not an action.
 *
 * Trust model (the #207 pattern): identity comes from the JWT
 * only. The body names a course id and a nonce — never a progress
 * value, a completion, a duration, or a price: terms come from the
 * catalog + levers inside the store, progress is the server's
 * clock, and completions are research_completions rows written by
 * the settler. NO player XP is granted by anything on this surface.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { EconomyConfig } from '../economy/config';
import type { ChefGameplayStore, Json } from '../gameplay/store';
import {
  researchStateView,
  resolveResearchLevers,
  type ResearchLeverValues,
  type ResearchStateView,
} from '../../content/research';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export type ResearchConfig = AuthConfig & { economyConfig?: EconomyConfig };

/** The research lever set from the live accessor (defaults when unwired). */
export async function researchLevers(config: ResearchConfig): Promise<ResearchLeverValues> {
  if (!config.economyConfig) return resolveResearchLevers();
  const values = await config.economyConfig.snapshot();
  return resolveResearchLevers(values);
}

/** Store refusal messages that are client-actionable (HTTP 400). */
const RESEARCH_REFUSALS = new Set([
  'unknown_course',
  'course_already_completed',
  'research_already_enrolled',
  'level_too_low',
  'prerequisite_not_met',
  'bench_too_low',
  'insufficient_credits',
  'cc_enroll_research requires a nonce',
  'cc_cancel_research requires a nonce',
]);

function sendStoreError(res: Response, fallback: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (RESEARCH_REFUSALS.has(message)) {
    res.status(400).json({ error: message });
    return;
  }
  if (message.includes('Profile not found') || message === 'profile_not_found') {
    res.status(404).json({ error: 'Profile not found', detail: message });
    return;
  }
  console.error(`[chef] ${fallback}:`, message);
  res.status(500).json({ error: fallback, detail: message });
}

async function readState(
  store: ChefGameplayStore,
  config: ResearchConfig,
  playerId: string,
): Promise<ResearchStateView | null> {
  const facts = await store.getResearchFacts(playerId);
  if (!facts) return null;
  return researchStateView(facts, await researchLevers(config));
}

export function createGetResearchHandler(store: ChefGameplayStore, config: ResearchConfig) {
  return async function handleGetResearch(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      const research = await readState(store, config, playerId);
      if (!research) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      res.json({ verified: true, research });
    } catch (err) {
      sendRouteError(res, 'Research state failed', err);
    }
  };
}

export function createEnrollResearchHandler(store: ChefGameplayStore, config: ResearchConfig) {
  return async function handleEnrollResearch(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      const body = (req.body ?? {}) as { nonce?: unknown; courseId?: unknown };
      const nonce = typeof body.nonce === 'string' ? body.nonce : '';
      const courseId = typeof body.courseId === 'string' ? body.courseId : '';
      let result: Json;
      try {
        result = await store.enrollResearch(playerId, nonce, courseId);
      } catch (err) {
        sendStoreError(res, 'Research enrollment failed', err);
        return;
      }
      const research = await readState(store, config, playerId);
      res.json({
        verified: true,
        enrolled: result,
        research,
        profile: (result as Record<string, unknown>).profile ?? null,
      });
    } catch (err) {
      sendRouteError(res, 'Research enrollment failed', err);
    }
  };
}

export function createCancelResearchHandler(store: ChefGameplayStore, config: ResearchConfig) {
  return async function handleCancelResearch(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      const body = (req.body ?? {}) as { nonce?: unknown };
      const nonce = typeof body.nonce === 'string' ? body.nonce : '';
      let result: Json;
      try {
        result = await store.cancelResearch(playerId, nonce);
      } catch (err) {
        sendStoreError(res, 'Research cancellation failed', err);
        return;
      }
      const research = await readState(store, config, playerId);
      res.json({ verified: true, cancelled: result, research });
    } catch (err) {
      sendRouteError(res, 'Research cancellation failed', err);
    }
  };
}
