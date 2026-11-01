/**
 * Manufacturer Standing routes (standing slice, migration 0043).
 *
 *   GET  /api/standing/me       — the six ladders (facts -> view)
 *   POST /api/standing/turn-in  — destroy an item for standing
 *   POST /api/standing/rank-up  — threshold + tribute rank grant
 *   POST /api/standing/buy      — Rep Shelf / Parts Crate purchase
 *   POST /api/standing/order    — Signature Order (rank 5, weekly)
 *
 * The Rep Desk lives inside the Vendor screen; this read is its one
 * source (collections-read discipline: facts only, the view derived
 * in src/content/manufacturerStanding.ts). The ops are thin doors
 * onto the cc_* ops: every term (award, threshold, tribute, price,
 * cadence, rank gate) is re-derived server-side under the player's
 * row lock; bodies carry only a nonce and the one selector the op
 * needs (item id / manufacturer / offer key), so there is nothing
 * to forge — the equipped weapon's drip is not routed here at all:
 * it accrues inside the claim and settlement paths from the
 * server-derived loadout.
 *
 * Trust model (the #207 pattern): identity comes from the JWT only.
 * Guests read the desk (read-only); every op refuses server-side
 * until the account is verified (can_use_player_economy). Ladders
 * are independent (R6): no op names a second manufacturer.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { EconomyConfig } from '../economy/config';
import type { ChefGameplayStore, Json } from '../gameplay/store';
import {
  buildStandingStateView,
  resolveStandingLevers,
  type StandingLeverValues,
  type StandingStateView,
} from '../../content/manufacturerStanding';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export type StandingConfig = AuthConfig & { economyConfig?: EconomyConfig };

/** The standing lever set from the live accessor (defaults when unwired). */
export async function standingLevers(config: StandingConfig): Promise<StandingLeverValues> {
  if (!config.economyConfig) return resolveStandingLevers();
  const values = await config.economyConfig.snapshot();
  return resolveStandingLevers(values);
}

/** The desk view from a gameplay-store facts read. */
export async function standingViewFromStore(
  store: ChefGameplayStore,
  config: StandingConfig,
  playerId: string,
): Promise<StandingStateView | null> {
  const facts = await store.getStandingFacts(playerId);
  if (!facts) return null;
  return buildStandingStateView(facts, await standingLevers(config));
}

const NOT_FOUND_MARKERS = ['Profile not found', 'Item not found', 'Tribute item not found'];

const REFUSAL_MARKERS = [
  'Verified account required',
  'Locked item',
  'not available',
  'Unequip',
  'Vehicles cannot',
  'no manufacturer',
  'Already at maximum rank',
  'Requires rank',
  'Requires ',
  'Insufficient credits',
  'Unknown manufacturer',
  'Unknown standing offer',
  'already claimed this week',
  'already placed this week',
  'Signature Orders are disabled',
  'Rare or Epic',
  'manufacturer mismatch',
  'must be made by',
  'must be standing_order',
  'never carry a legendary effect',
  'is not a weapon',
  'requires no tribute item',
  'requires a tribute item',
  'nonce is required',
];

function sendStoreError(res: Response, fallback: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (NOT_FOUND_MARKERS.some((marker) => message.includes(marker))) {
    res.status(404).json({ error: fallback, detail: message });
    return;
  }
  if (REFUSAL_MARKERS.some((marker) => message.includes(marker))) {
    res.status(409).json({ error: fallback, detail: message });
    return;
  }
  console.error(`[chef] ${fallback}:`, message);
  res.status(500).json({ error: fallback, detail: message });
}

interface StandingOpBody {
  playerId?: string;
  jwt?: string;
  nonce?: string;
  itemId?: unknown;
  manufacturer?: unknown;
  tributeItemId?: unknown;
  offerKey?: unknown;
  quantity?: unknown;
}

function opNonce(body: StandingOpBody, playerId: string, label: string): string {
  return typeof body.nonce === 'string' && body.nonce.trim().length >= 8
    ? body.nonce
    : `standing-${label}:${playerId}:${Date.now()}`;
}

export function createGetStandingHandler(store: ChefGameplayStore, config: StandingConfig) {
  return async function handleGetStanding(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      const view = await standingViewFromStore(store, config, playerId);
      if (!view) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      res.json({ verified: true, standing: view, profile: null });
    } catch (err) {
      sendRouteError(res, 'Standing read failed', err);
    }
  };
}

export function createTurnInItemHandler(store: ChefGameplayStore, config: StandingConfig) {
  return async function handleTurnInItem(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as StandingOpBody;
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      if (typeof body.itemId !== 'string' || body.itemId.length === 0) {
        res.status(400).json({ error: 'An item id is required' });
        return;
      }
      let applied: Json;
      try {
        applied = await store.turnInItem(playerId, opNonce(body, playerId, 'turn-in'), body.itemId);
      } catch (err) {
        sendStoreError(res, 'Turn-in failed', err);
        return;
      }
      const record = applied as Record<string, unknown>;
      const view = await standingViewFromStore(store, config, playerId);
      res.json({
        verified: true,
        turnedIn: {
          itemId: body.itemId,
          manufacturer: record.manufacturer ?? null,
          standingAwarded: record.standing_awarded ?? 0,
          scrapValue: record.scrap_value ?? 0,
          newBalance: record.new_balance ?? 0,
          rank: record.rank ?? 0,
        },
        standing: view,
        profile: record.profile ?? null,
        item: record.item ?? null,
        loadout: record.loadout ?? null,
      });
    } catch (err) {
      sendRouteError(res, 'Turn-in failed', err);
    }
  };
}

export function createRankUpManufacturerHandler(store: ChefGameplayStore, config: StandingConfig) {
  return async function handleRankUpManufacturer(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as StandingOpBody;
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      if (typeof body.manufacturer !== 'string' || body.manufacturer.length === 0) {
        res.status(400).json({ error: 'A manufacturer is required' });
        return;
      }
      const tributeItemId =
        typeof body.tributeItemId === 'string' && body.tributeItemId.length > 0
          ? body.tributeItemId
          : null;
      let applied: Json;
      try {
        applied = await store.rankUpManufacturer(
          playerId, opNonce(body, playerId, 'rank-up'), body.manufacturer, tributeItemId);
      } catch (err) {
        sendStoreError(res, 'Rank up failed', err);
        return;
      }
      const record = applied as Record<string, unknown>;
      const view = await standingViewFromStore(store, config, playerId);
      res.json({
        verified: true,
        rankedUp: {
          manufacturer: record.manufacturer ?? body.manufacturer,
          newRank: record.new_rank ?? 0,
          tributeCredits: record.tribute_credits ?? 0,
          tributeItemId: record.tribute_item_id ?? null,
          standingBalance: record.standing_balance ?? 0,
        },
        standing: view,
        profile: record.profile ?? null,
        item: record.item ?? null,
        loadout: record.loadout ?? null,
      });
    } catch (err) {
      sendRouteError(res, 'Rank up failed', err);
    }
  };
}

export function createStandingBuyHandler(store: ChefGameplayStore, config: StandingConfig) {
  return async function handleStandingBuy(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as StandingOpBody;
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      if (typeof body.offerKey !== 'string' || body.offerKey.length === 0) {
        res.status(400).json({ error: 'An offer key is required' });
        return;
      }
      const quantity =
        typeof body.quantity === 'number' && Number.isFinite(body.quantity)
          ? Math.max(1, Math.trunc(body.quantity))
          : 1;
      let applied: Json;
      try {
        applied = await store.standingBuy(
          playerId, opNonce(body, playerId, 'buy'), body.offerKey, quantity);
      } catch (err) {
        sendStoreError(res, 'Standing purchase failed', err);
        return;
      }
      const record = applied as Record<string, unknown>;
      const view = await standingViewFromStore(store, config, playerId);
      res.json({
        verified: true,
        bought: {
          offerKey: record.offer_key ?? body.offerKey,
          manufacturer: record.manufacturer ?? null,
          kind: record.kind ?? null,
          quantity: record.quantity ?? quantity,
          consumableType: record.consumable_type ?? null,
          totalPrice: record.total_price ?? 0,
        },
        standing: view,
        profile: record.profile ?? null,
      });
    } catch (err) {
      sendRouteError(res, 'Standing purchase failed', err);
    }
  };
}

export function createStandingOrderHandler(store: ChefGameplayStore, config: StandingConfig) {
  return async function handleStandingOrder(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as StandingOpBody;
      const playerId = getAuthenticatedChefPlayer(config, req, body.jwt, body.playerId);
      if (typeof body.manufacturer !== 'string' || body.manufacturer.length === 0) {
        res.status(400).json({ error: 'A manufacturer is required' });
        return;
      }
      let applied: Json;
      try {
        applied = await store.standingOrderWeapon(
          playerId, opNonce(body, playerId, 'order'), body.manufacturer);
      } catch (err) {
        sendStoreError(res, 'Signature Order failed', err);
        return;
      }
      const record = applied as Record<string, unknown>;
      const view = await standingViewFromStore(store, config, playerId);
      res.json({
        verified: true,
        ordered: {
          manufacturer: record.manufacturer ?? body.manufacturer,
          item: record.item ?? null,
          totalPrice: record.total_price ?? 0,
        },
        standing: view,
        profile: record.profile ?? null,
        item: record.item ?? null,
      });
    } catch (err) {
      sendRouteError(res, 'Signature Order failed', err);
    }
  };
}
