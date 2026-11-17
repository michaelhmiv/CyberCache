/**
 * Cosmetics routes (skins slice, migration 0053).
 *
 *   GET  /api/cosmetics/me           — selection + owned parts + wearable variants
 *   GET  /api/cosmetics/looks?ids=a,b — public hunter looks (Standings)
 *
 * READ-ONLY since the 2026-11-17 retirements (device-pass
 * Batch 4): the equip/unequip/head-variant POST routes are gone —
 * no surface wears parts anymore (the hunters are paintings; the
 * Wardrobe wears whole skins device-locally), and nothing called
 * them. The selection record still reads back through the state
 * view (it feeds the market's worn-part marker and the look
 * record); it simply has no writer left on this surface.
 *
 * Trust model (the research pattern): identity comes from the JWT
 * only. Cosmetics are pure display: nothing on this surface
 * touches a mechanics path.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { ChefGameplayStore } from '../gameplay/store';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export type CosmeticsConfig = AuthConfig;

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
