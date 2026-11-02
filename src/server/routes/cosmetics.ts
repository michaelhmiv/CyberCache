/**
 * Cosmetics routes (skins slice, migration 0053).
 *
 *   GET  /api/cosmetics/me           — selection + owned parts + wearable variants
 *   POST /api/cosmetics/equip        { nonce, itemId }
 *   POST /api/cosmetics/unequip      { nonce, slot }
 *   POST /api/cosmetics/head-variant { nonce, variant }
 *   GET  /api/cosmetics/looks?ids=a,b — public hunter looks (Standings)
 *
 * Trust model (the research pattern): identity comes from the JWT
 * only. The body names an item id / slot / variant and a nonce —
 * never a part definition, a quality, or a price: ownership and
 * entitlements are validated inside the store from server records,
 * and renders derive from the catalog client-side. Cosmetics are
 * pure display: nothing on this surface touches a mechanics path.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { ChefGameplayStore, Json } from '../gameplay/store';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export type CosmeticsConfig = AuthConfig;

/** Store refusal messages that are client-actionable (HTTP 400). */
const COSMETIC_REFUSALS = new Set([
  'Item not found',
  'Item is not a cosmetic part',
  'Part is not available to equip',
  'Part is being tinted',
  'Part has no wearable slot',
  'Unknown cosmetic slot',
  'Unknown head variant',
  'cc_cosmetic_equip requires a nonce',
  'cc_cosmetic_unequip requires a nonce',
  'cc_cosmetic_set_head_variant requires a nonce',
]);

function sendStoreError(res: Response, fallback: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (COSMETIC_REFUSALS.has(message) || message.startsWith('That head is earned at ')) {
    res.status(400).json({ error: message });
    return;
  }
  if (message.includes('Profile not found') || message === 'profile_not_found') {
    res.status(404).json({ error: 'Profile not found', detail: message });
    return;
  }
  console.error(`[chef] ${fallback}:`, message);
  res.status(500).json({ error: fallback, detail: message });
}

function strField(req: Request, field: string): string {
  const value = ((req.body ?? {}) as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

export function createGetCosmeticsHandler(store: ChefGameplayStore, config: CosmeticsConfig) {
  return async function handleGetCosmetics(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      const state = await store.getCosmeticsState(playerId);
      if (!state) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      res.json({ verified: true, cosmetics: state });
    } catch (err) {
      sendRouteError(res, 'Cosmetics state failed', err);
    }
  };
}

export function createEquipCosmeticHandler(store: ChefGameplayStore, config: CosmeticsConfig) {
  return async function handleEquipCosmetic(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      let result: Json;
      try {
        result = await store.equipCosmetic(playerId, strField(req, 'nonce'), strField(req, 'itemId'));
      } catch (err) {
        sendStoreError(res, 'Cosmetic equip failed', err);
        return;
      }
      res.json({ verified: true, result });
    } catch (err) {
      sendRouteError(res, 'Cosmetic equip failed', err);
    }
  };
}

export function createUnequipCosmeticHandler(store: ChefGameplayStore, config: CosmeticsConfig) {
  return async function handleUnequipCosmetic(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      let result: Json;
      try {
        result = await store.unequipCosmetic(playerId, strField(req, 'nonce'), strField(req, 'slot'));
      } catch (err) {
        sendStoreError(res, 'Cosmetic unequip failed', err);
        return;
      }
      res.json({ verified: true, result });
    } catch (err) {
      sendRouteError(res, 'Cosmetic unequip failed', err);
    }
  };
}

export function createSetHeadVariantHandler(store: ChefGameplayStore, config: CosmeticsConfig) {
  return async function handleSetHeadVariant(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      let result: Json;
      try {
        result = await store.setCosmeticHeadVariant(
          playerId,
          strField(req, 'nonce'),
          strField(req, 'variant'),
        );
      } catch (err) {
        sendStoreError(res, 'Head variant failed', err);
        return;
      }
      res.json({ verified: true, result });
    } catch (err) {
      sendRouteError(res, 'Head variant failed', err);
    }
  };
}

export function createGetHunterLooksHandler(store: ChefGameplayStore, config: CosmeticsConfig) {
  return async function handleGetHunterLooks(req: Request, res: Response): Promise<void> {
    try {
      getAuthenticatedChefPlayer(config, req);
      const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
      const ids = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
      const looks = await store.getHunterLooks(ids);
      res.json({ verified: true, looks });
    } catch (err) {
      sendRouteError(res, 'Hunter looks failed', err);
    }
  };
}
