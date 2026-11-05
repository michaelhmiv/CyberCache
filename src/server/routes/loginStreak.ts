/**
 * Login streak routes (login-streak slice, migration 0036; the
 * TRUE CLAIM, migration 0079 — owner decision 2026-11-04).
 *
 *   GET  /api/login-streak/me    — observe-and-record the daily
 *   check-in, then return the streak state view.
 *   POST /api/login-streak/claim — pay today's held reward.
 *
 * The streak rides the daily loop exactly like Cache Rank rides
 * its read: the GET first records today's check-in
 * (cc_record_login_streak_day — the first authenticated check-in
 * of the UTC day records the day and stamps the ladder reward on
 * the claim row; the (player, day) row makes the record
 * exactly-once and any replay returns the stored row), then
 * reads the facts and renders the content module's state view.
 * Recording pays NOTHING (0079): the reward sits on the row,
 * claimable, until the player taps Claim — the POST pays it
 * exactly once (cc_claim_login_streak_day; the row's paid_at
 * stamp is the anchor). Only today's row can be paid, so an
 * unclaimed reward expires at the 00:00 UTC rollover while the
 * streak day itself still counts.
 *
 * Trust model (the #207 pattern): identity comes from the JWT
 * only; there is no body and nothing in a query can name a day, a
 * streak length, or an amount — the day comes from the server's
 * clock inside the store. Guests claim identically: grants key
 * on the profile row, never on account state.
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
            cacheKeysAwarded: facts.today_claim.cache_keys_awarded,
            paid: facts.today_claim.paid,
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
  if (message.includes('No streak reward recorded today')) {
    // Claiming before any check-in recorded today (or after the
    // held reward expired at the rollover): a conflict with the
    // current state, not a server fault.
    res.status(409).json({ error: fallback, detail: message });
    return;
  }
  console.error(`[chef] ${fallback}:`, message);
  res.status(500).json({ error: fallback, detail: message });
}

/** The response's `granted` block, shaped from a record/claim op
 *  result — one shape for both routes so the client never cares
 *  which op produced the state it holds. */
function grantedBlock(record: Record<string, unknown>): Record<string, unknown> {
  return {
    alreadyClaimed: record.already_claimed === true,
    claimable: record.claimable === true,
    streakLength: record.streak_length ?? null,
    cycleDay: record.cycle_day ?? null,
    tier: record.tier ?? null,
    creditsAwarded: record.credits_awarded ?? 0,
    cacheKeysAwarded: record.cache_keys_awarded ?? 0,
  };
}

export function createGetLoginStreakHandler(store: ChefGameplayStore, config: LoginStreakConfig) {
  return async function handleGetLoginStreak(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      // Observe-and-record: the first authenticated check-in of the
      // UTC day records the day (and its held reward) before the
      // state is read, so the view always shows today's day as
      // earned and its reward as claimable until claimed.
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
        granted: grantedBlock(record),
        profile: record.profile ?? null,
      });
    } catch (err) {
      sendRouteError(res, 'Login streak state failed', err);
    }
  };
}

/**
 * POST /api/login-streak/claim — pay today's held reward
 * (cc_claim_login_streak_day, 0079). JWT identity only, no body:
 * the store pays the server's own today's row, exactly once; a
 * replay returns the stored claim with alreadyClaimed and pays
 * nothing. The response mirrors the GET's shape — fresh state
 * view, the claim's granted block (claimable now false), and the
 * post-payment profile snapshot the client syncs its wallet from.
 */
export function createClaimLoginStreakHandler(store: ChefGameplayStore, config: LoginStreakConfig) {
  return async function handleClaimLoginStreak(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      let paid: Json;
      try {
        paid = await store.claimLoginStreakDay(playerId);
      } catch (err) {
        sendStoreError(res, 'Login streak claim failed', err);
        return;
      }
      const facts = await store.getLoginStreakFacts(playerId);
      if (!facts) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      const record = paid as Record<string, unknown>;
      res.json({
        verified: true,
        loginStreak: loginStreakStateFromFacts(facts, await loginStreakLevers(config)),
        granted: grantedBlock(record),
        profile: record.profile ?? null,
      });
    } catch (err) {
      sendRouteError(res, 'Login streak claim failed', err);
    }
  };
}
