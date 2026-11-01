/**
 * Cache lane service (0037) — the client's read of the daily cache
 * box budget from the Chef reads family (GET /api/caches/me,
 * identity from the JWT only). Failures return null: the cache
 * surface falls back to the profile's key count and lets the open
 * op's own response (which carries the lane view) correct it.
 */
import { apiRequest } from './http';

export interface CacheLaneState {
  day: string;
  cap: number;
  freePerDay: number;
  openedToday: number;
  remaining: number;
  freeAvailable: boolean;
  keys: number;
  byPayment: { free: number; ad: number; key: number };
  resetsAt: string;
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
