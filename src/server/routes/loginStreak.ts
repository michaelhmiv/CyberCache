/**
 * Login streak routes (login-streak slice, migration 0036).
 *
 *   GET /api/login-streak/me — observe-and-record the daily
 *   check-in, then return the streak state view.
 *
 * This is the shipped daily flow's player surface: there is no
 * daily claim button anywhere in the game — the player's daily
 * loop is session start → offline settlement → Dashboard — so the
 * streak rides that loop exactly like Cache Rank rides its read:
 * the GET first records today's check-in (cc_record_login_streak_day
 * — the first authenticated check-in of the UTC day grants the
 * ladder reward; the (player, day) claim row makes it exactly-once
 * and any replay returns the stored claim), then reads the facts
 * and renders the content module's state view.
 *
 * Trust model (the #207 pattern): identity comes from the JWT
 * only; there is no body and nothing in a query can name a day, a
 * streak length, or an amount — the day comes from the server's
 * clock inside the store. Guests earn identically: grants key on
 * the profile row, never on account state.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { EconomyConfig } from '../economy/config';
import type { ChefGameplayStore, Json, LoginStreakFacts } from '../gameplay/store';
import {
  loginStreakStateView,
  resolveLoginStreakLevers,
  type LoginStreakLeverValues,
  type LoginStreakStateView,
} from '../../content/loginStreak';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export type LoginStreakConfig = AuthConfig & { economyConfig?: EconomyConfig };

/** The login-streak lever set from the live accessor (defaults when unwired). */
export async function loginStreakLevers(config: LoginStreakConfig): Promise<LoginStreakLeverValues> {
  if (!config.economyConfig) return resolveLoginStreakLevers();
  const values = await config.economyConfig.snapshot();
  return resolveLoginStreakLevers(values);
}

/** The state view from a gameplay-store facts read. */
export function loginStreakStateFromFacts(
  facts: LoginStreakFacts,
  levers: LoginStreakLeverValues,
): LoginStreakStateView {
  return loginStreakStateView(
    {
      currentStreak: facts.current_streak,
      longestStreak: facts.longest_streak,
      lastClaimDay: facts.last_claim_day,
      todayClaim: facts.today_claim
        ? {
            day: facts.today_claim.day,
            streakLength: facts.today_claim.streak_length,
            cycleDay: facts.today_claim.cycle_day,
            tier: facts.today_claim.tier,
            creditsAwarded: facts.today_claim.credits_awarded,
            fragmentsAwarded: facts.today_claim.fragments_awarded,
            cacheKeysAwarded: facts.today_claim.cache_keys_awarded,
          }
        : null,
    },
    levers,
    facts.today,
  );
}

function sendStoreError(res: Response, fallback: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('Profile not found')) {
    res.status(404).json({ error: fallback, detail: message });
    return;
  }
  console.error(`[chef] ${fallback}:`, message);
  res.status(500).json({ error: fallback, detail: message });
}

export function createGetLoginStreakHandler(store: ChefGameplayStore, config: LoginStreakConfig) {
  return async function handleGetLoginStreak(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      // Observe-and-record: the first authenticated check-in of the
      // UTC day grants the ladder reward before the state is read,
      // so the view always shows today's claim as earned.
      let granted: Json;
      try {
        granted = await store.recordLoginStreakDay(playerId);
      } catch (err) {
        sendStoreError(res, 'Login streak check-in failed', err);
        return;
      }
      const facts = await store.getLoginStreakFacts(playerId);
      if (!facts) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      const record = granted as Record<string, unknown>;
      res.json({
        verified: true,
        loginStreak: loginStreakStateFromFacts(facts, await loginStreakLevers(config)),
        granted: {
          alreadyClaimed: record.already_claimed === true,
          streakLength: record.streak_length ?? null,
          cycleDay: record.cycle_day ?? null,
          tier: record.tier ?? null,
          creditsAwarded: record.credits_awarded ?? 0,
          fragmentsAwarded: record.fragments_awarded ?? 0,
          cacheKeysAwarded: record.cache_keys_awarded ?? 0,
        },
        profile: record.profile ?? null,
      });
    } catch (err) {
      sendRouteError(res, 'Login streak state failed', err);
    }
  };
}
