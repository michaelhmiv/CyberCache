/**
 * Dispatch face payout (first-screen pass, 2026-11-17, census
 * item 10) — the offer payload carries the pay.
 *
 * The board used to show family / destination / duration / danger
 * and price every offer only inside the preview behind a pick
 * (verified by trace: DispatchOffer carried no payout and the
 * state view added only areaName + dangerRating). The state view
 * now attaches `payout` per offer, computed by
 * dispatchOfferFacePayout — the preview's own formula at its
 * baseline. These pins hold the payload to that formula exactly:
 *
 *  - every presentable offer carries a payout;
 *  - a foot offer's payout IS footPayoutLines(area, hours, strength
 *    1.0, levers, `${playerId}:${offer.id}`) — the departure seed;
 *  - a courier offer's payout is those same foot lines with the
 *    credit premium applied and NO cargo bonus (the bonus belongs
 *    to the vehicle the player commits, not the offer).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  dispatchOfferFacePayout,
  footPayoutLines,
  resolveDispatchLevers,
  roamingAreaById,
  type DispatchLeverValues,
} from '@/content/dispatch';
import { mountDispatchRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
type Json = Record<string, unknown>;

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface RouteHarness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
}

async function makeRouteServer(startNow: Date): Promise<RouteHarness> {
  const nowFn = () => startNow;
  const store = new InMemoryChefGameplayStore(nowFn);
  const app = express();
  app.use(express.json());
  mountDispatchRoutes(app, store, { jwtSecret: SECRET, now: nowFn });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return { store, base: `http://127.0.0.1:${port}`, tokenA: issueAccessToken(SECRET, A, false) };
}

type OfferView = {
  id: string;
  family: 'foot' | 'courier';
  areaId: string;
  durationHours: number;
  payout: { credits: number; scrap: number; materialId: string | null; materialUnits: number } | null;
};

describe('dispatch state view — face payout on every offer', () => {
  it('attaches the preview-baseline payout to all six offers, per family', async () => {
    const h = await makeRouteServer(new Date('2026-11-03T12:00:00.000Z'));
    h.store.seedProfile({ id: A, player_level: 50 });
    const res = await fetch(`${h.base}/api/dispatch/me`, {
      headers: { authorization: `Bearer ${h.tokenA}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Json;
    const offers = (json.dispatch as { offers: OfferView[] }).offers;
    expect(offers).toHaveLength(6);

    const levers: DispatchLeverValues = resolveDispatchLevers();
    for (const offer of offers) {
      expect(offer.payout, `payout missing on ${offer.id}`).not.toBeNull();
      const area = roamingAreaById(offer.areaId)!;
      const seed = `${A}:${offer.id}`;
      // The payload number IS the content formula's number.
      expect(offer.payout).toEqual(dispatchOfferFacePayout(offer, area, levers, seed));

      const foot = footPayoutLines(area, offer.durationHours, 1, levers, seed);
      if (offer.family === 'foot') {
        expect(offer.payout).toEqual({
          credits: foot.credits,
          scrap: foot.scrap,
          materialId: foot.materialId,
          materialUnits: foot.materialUnits,
        });
      } else {
        // Courier: premium on credits, foot scrap/materials, and
        // crucially NO vehicle cargo bonus in the units.
        expect(offer.payout!.credits).toBe(Math.round(foot.credits * levers.courierPremiumMultiplier));
        expect(offer.payout!.scrap).toBe(foot.scrap);
        expect(offer.payout!.materialId).toBe(foot.materialId);
        expect(offer.payout!.materialUnits).toBe(foot.materialUnits);
      }
    }
  });
});
