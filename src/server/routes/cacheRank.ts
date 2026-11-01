/**
 * Cache Rank routes (Cache Rank slice, migration 0031).
 *
 *   GET  /api/cache-rank/me     — the player's OWN Cache Rank state
 *   POST /api/cache-rank/spend  — buy one rank on a bonus track
 *
 * Trust model (the #207 pattern): identity comes from the JWT only;
 * bodies carry intent — a nonce and a bonus id, nothing else. Token
 * earning derives from the SERVER's level record: the GET observes
 * the profile and pays any ungranted entitlement first
 * (cc_grant_cache_rank_tokens — idempotent by the grant watermark),
 * so a pre-existing profile is granted retroactively exactly once,
 * on first touch. Forged level/token/spend fields in a body change
 * nothing: nothing in the body is read except the nonce and the
 * bonus id.
 *
 * Guests earn and spend identically — grants key on the profile
 * row, never on account state.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { EconomyConfig } from '../economy/config';
import type { ChefGameplayStore, Json } from '../gameplay/store';
import {
  cacheRankStateView,
  isCacheRankBonusId,
  resolveCacheRankLevers,
  type CacheRankLeverValues,
  type CacheRankStateView,
} from '../../content/cacheRank';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export type CacheRankConfig = AuthConfig & { economyConfig?: EconomyConfig };

/** The Cache Rank lever set from the live accessor (defaults when unwired). */
export async function cacheRankLevers(config: CacheRankConfig): Promise<CacheRankLeverValues> {
  if (!config.economyConfig) return resolveCacheRankLevers();
  const values = await config.economyConfig.snapshot();
  return resolveCacheRankLevers(values);
}

/** The state view from a gameplay-store facts read (null = no profile). */
export function cacheRankStateFromFacts(
  facts: {
    player_level: number;
    player_xp: number;
    cache_rank_tokens: number;
    cache_rank_grant_level: number;
    cache_rank_spends: unknown;
  },
  levers: CacheRankLeverValues,
): CacheRankStateView {
  return cacheRankStateView({
    level: facts.player_level,
    playerXp: facts.player_xp,
    tokens: facts.cache_rank_tokens,
    grantLevel: facts.cache_rank_grant_level,
    spends: facts.cache_rank_spends,
    levers,
  });
}

/** Spend applier error → HTTP status. */
function cacheRankErrorStatus(message: string): number {
  if (
    message.includes('Unknown Cache Rank bonus') ||
    message.includes('Cache Rank bonus maxed') ||
    message.includes('Not enough Cache Rank tokens') ||
    message.includes('nonce is required')
  ) {
    return 400;
  }
  if (message.includes('Profile not found')) return 404;
  return 500;
}

function sendStoreError(res: Response, fallback: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = cacheRankErrorStatus(message);
  if (status === 500) console.error(`[chef] ${fallback}:`, message);
  res.status(status).json({ error: fallback, detail: message });
}

export function createGetCacheRankHandler(store: ChefGameplayStore, config: CacheRankConfig) {
  return async function handleGetCacheRank(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      // Observe-and-grant: the read pays any ungranted entitlement
      // first (retroactive grants land here, exactly once).
      try {
        await store.grantCacheRankTokens(playerId);
      } catch (err) {
        sendStoreError(res, 'Cache Rank grant failed', err);
        return;
      }
      const facts = await store.getCacheRankFacts(playerId);
      if (!facts) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      res.json({ verified: true, cacheRank: cacheRankStateFromFacts(facts, await cacheRankLevers(config)) });
    } catch (err) {
      sendRouteError(res, 'Cache Rank state failed', err);
    }
  };
}

export function createSpendCacheRankHandler(store: ChefGameplayStore, config: CacheRankConfig) {
  return async function handleSpendCacheRank(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as {
        playerId?: string;
        jwt?: string;
        nonce?: string;
        bonusId?: unknown;
      };
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      if (!isCacheRankBonusId(body.bonusId)) {
        res.status(400).json({ error: 'Unknown Cache Rank bonus', detail: String(body.bonusId ?? '') });
        return;
      }
      const nonce =
        typeof body.nonce === 'string' && body.nonce.trim().length >= 8
          ? body.nonce
          : `cache-rank-spend:${playerId}:${Date.now()}`;
      let applied: Json;
      try {
        applied = await store.spendCacheRankBonus(playerId, nonce, body.bonusId);
      } catch (err) {
        sendStoreError(res, 'Failed to spend Cache Rank tokens', err);
        return;
      }
      const record = applied as Record<string, unknown>;
      const facts = await store.getCacheRankFacts(playerId);
      res.json({
        verified: true,
        spent: {
          bonusId: record.bonus_id ?? body.bonusId,
          rankAfter: record.rank_after ?? null,
          cost: record.cost ?? null,
        },
        cacheRank: facts ? cacheRankStateFromFacts(facts, await cacheRankLevers(config)) : null,
        profile: record.profile,
      });
    } catch (err) {
      sendRouteError(res, 'Cache Rank spend failed', err);
    }
  };
}
