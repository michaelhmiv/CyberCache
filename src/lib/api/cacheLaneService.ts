/**
 * Cache lane service (0037, rebuilt 0082) — the client's read of
 * the cache lane from the Chef reads family (GET /api/caches/me,
 * identity from the JWT only). The lane state is just the player's
 * cache key stock + the rule line: openings are uncapped and every
 * one is paid (1 key or one rewarded-ad attestation), so there is
 * no day, count, or budget left to read. Failures return null: the
 * cache surface falls back to the profile's key count and lets the
 * open op's own response (which carries the lane view) correct it.
 */
import { apiRequest } from './http';

export interface CacheLaneState {
  keys: number;
  rule: string;
}

export async function fetchCacheLane(): Promise<CacheLaneState | null> {
  try {
    return await apiRequest<CacheLaneState | null>('/caches/me');
  } catch (error) {
    console.error('fetchCacheLane error:', error);
    return null;
  }
}
