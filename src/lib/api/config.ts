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
