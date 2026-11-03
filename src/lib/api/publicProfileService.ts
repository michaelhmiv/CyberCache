/**
 * Public profile service (Route B, slice B4) — transport swap onto the
 * Chef read route. The RPC returned a row set and the client took the
 * first row; the Chef route returns the projection object directly
 * (404 when the player does not exist), which maps to the same
 * `| null` contract.
 */
import { apiRequest } from './http';
import type { ShowcaseItemPayload } from './verifiedOps';

/**
 * The public shelf (0058): the same showcase block the owner's own
 * Trophy Shelf renders — top weapons (hand-pinned first, in pin
 * order), best depth, Cache Rank standing, collection count. All
 * of it is brag data the game already shows on leaderboards.
 * Optional on the type because an older Chef (pre-0058 rollout)
 * omits it; surfaces fall back to no shelf rather than failing.
 */
export interface PlayerShowcaseData {
  top_weapons: ShowcaseItemPayload[];
  pinned_item_ids: string[];
  best_endless_depth: number;
  cache_rank_tokens: number;
  cache_rank_total_ranks: number;
  collections_discovered: number;
}

export interface PlayerPublicProfile {
  player_id: string;
  username: string | null;
  display_name: string | null;
  level: number;
  xp: number;
  net_worth: number;
  total_kills: number;
  total_deaths: number;
  // The Chef projection (PublicProfileData) sends null whenever the
  // hunter has zero recorded deaths — the ratio does not exist yet.
  kill_death_ratio: number | null;
  highest_boss_tier: number;
  total_mastery_xp: number;
  highest_mastery_level: number;
  legendary_items: number;
  total_items: number;
  weapons_owned: number;
  highest_item_level: number;
  joined_at: string;
  last_active_at: string;
  showcase?: PlayerShowcaseData;
}

export async function getPublicProfile(playerId: string): Promise<PlayerPublicProfile | null> {
  try {
    return (await apiRequest<PlayerPublicProfile | null>(`/players/${playerId}/public-profile`)) ?? null;
  } catch (error) {
    console.error('getPublicProfile error:', error);
    return null;
  }
}
