/**
 * POST /api/resurrect — server-side resurrection (Phase 0 Slice 4).
 *
 * Death was already server-real (the Chef claim sim kills the hunter;
 * the claim route records it in profiles.death_state, migration
 * 0013), but resurrection used to be pure client theater: the Paid
 * path deducted credits from the local display store only, and the
 * Free timer was enforced by the client's own clock. This route is
 * the authority the death screen now calls:
 *
 * - Identity comes from the Chef JWT (never a body playerId).
 * - The op REQUIRES a standing server death record — no record, no
 *   resurrection (409).
 * - 'paid' charges exactly the price the death screen displays: the
 *   route derives it here from the shared resurrectionCostForArea()
 *   over the RECORDED death area (the same function the overlay
 *   renders with), and cc_resurrect balance-checks and deducts it
 *   atomically with clearing the death state. The client never
 *   supplies an area or a price.
 * - 'free' is validated by cc_resurrect against the server clock:
 *   recorded diedAtMs + RESURRECTION_FREE_TIMER_MS (the shared
 *   constant, passed through) must have elapsed.
 * - The nonce makes the op idempotent (verified_action_ledger): a
 *   replay returns the stored result and never double-charges.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { ChefGameplayStore } from '../gameplay/store';
import { RESURRECTION_FREE_TIMER_MS, resurrectionCostForArea } from '../../lib/combat/resurrectionCost';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export function createResurrectHandler(store: ChefGameplayStore, config: AuthConfig) {
  return async function handleResurrect(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body as {
        playerId?: string;
        jwt?: string;
        method?: unknown;
        nonce?: unknown;
      };
      if (body.method !== 'free' && body.method !== 'paid') {
        res.status(400).json({
          error: 'Missing or invalid method',
          detail: "method must be 'free' or 'paid'",
        });
        return;
      }
      if (typeof body.nonce !== 'string' || body.nonce.trim().length < 8) {
        res.status(400).json({
          error: 'Missing nonce',
          detail: 'nonce is required (min 8 chars)',
        });
        return;
      }

      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      const method = body.method;

      // The standing death record anchors the paid price (derived
      // here from the recorded area — the death screen displays the
      // same rule over the same area, so display and charge cannot
      // drift). The read must NOT gate the call: after a successful
      // resurrection the record is gone, and a nonce replay has to
      // reach cc_resurrect's ledger check to return its stored
      // result instead of a spurious 409. When no death stands, the
      // op itself answers no_death_recorded (mapped below) — the
      // price is irrelevant on that path.
      let death: Awaited<ReturnType<ChefGameplayStore['getDeathRecord']>>;
      try {
        death = await store.getDeathRecord(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to read death record', detail: message });
        return;
      }

      const paidCost = method === 'paid' && death ? resurrectionCostForArea(death.areaId) : 0;

      let result: Record<string, unknown>;
      try {
        result = (await store.resurrect(playerId, {
          nonce: body.nonce,
          method,
          paidCost,
          freeTimerMs: RESURRECTION_FREE_TIMER_MS,
        })) as Record<string, unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: 'Failed to resurrect', detail: message });
        return;
      }

      if (result.resurrected !== true) {
        const reason = typeof result.reason === 'string' ? result.reason : 'rejected';
        if (reason === 'no_death_recorded') {
          res.status(409).json({ error: 'No death recorded', reason });
          return;
        }
        if (reason === 'free_not_ready') {
          res.status(400).json({
            error: 'Free recovery is not ready yet',
            reason,
            diedAtMs: result.diedAtMs,
            freeReadyAtMs: result.freeReadyAtMs,
          });
          return;
        }
        if (reason === 'insufficient_credits') {
          res.status(400).json({
            error: 'Insufficient credits',
            reason,
            cost: result.cost,
            credits: result.credits,
          });
          return;
        }
        res.status(400).json({ error: 'Resurrection rejected', reason });
        return;
      }

      res.json({
        resurrected: true,
        verified: true,
        method,
        creditsCharged: typeof result.creditsCharged === 'number' ? result.creditsCharged : 0,
        death: result.death ?? null,
        deathLog: Array.isArray(result.deathLog) ? result.deathLog : [],
        profile: result.profile ?? null,
        ...(result.idempotent_replay === true ? { idempotentReplay: true } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[chef] resurrect error:', message);
      sendRouteError(res, 'Resurrection failed', err);
    }
  };
}
