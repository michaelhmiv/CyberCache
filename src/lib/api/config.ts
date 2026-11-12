/**
 * Chef API config (Route B, slice B4).
 *
 * The client talks to exactly one backend now: the Chef. Base-URL
 * resolution has a single source of truth — `resolveChefBase` in
 * `src/lib/chef/chefClient.ts` (VITE_CHEF_URL wins; native builds go to
 * the Railway Chef service; hosted web uses its own origin). This module
 * is the api-layer seam over it so services never build URLs ad hoc.
 */
import { chefUrl, resolveChefBase } from '../chef/chefClient';

export interface ChefApiConfig {
  /** Base origin of the Chef service ('' = same origin / test env). */
  baseUrl: string;
}

export function getChefApiConfig(): ChefApiConfig {
  return { baseUrl: resolveChefBase() };
}

/** Full URL for a Chef API path such as '/profile/me' (no '/api' prefix). */
export function apiUrl(path: string): string {
  return chefUrl(path);
}

/**
 * Hard ceiling for every Chef request (decrypt-hang fix, 2026-11-11).
 *
 * Before this bound existed, the transport awaited `fetch` with no
 * timeout anywhere: a request whose response never arrived (a stalled
 * connection, a wedged server leg, a proxy that held the request)
 * produced a promise that never settled, and any UI flow awaiting it
 * froze forever — the cache decrypt overlay shook indefinitely
 * because `verifiedOps.makeItem` awaited first the make-item POST and
 * then the runtime snapshot PUT, either of which could hang this way.
 * Every request now aborts at this ceiling and surfaces as a
 * recoverable error instead. 15 s is far above the Chef's observed
 * response times (~0.1–0.7 s) while still ending a stall inside one
 * player-visible wait. Lives here (not http.ts) so session.ts's raw
 * refresh fetch can share it without an import cycle.
 */
export const API_REQUEST_TIMEOUT_MS = 15_000;
