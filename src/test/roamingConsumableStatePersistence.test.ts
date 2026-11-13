import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import type { Json } from '../server/gameplay/store';
import { issueAccessToken } from '../server/auth/tokens';

/**
 * Roaming consumable state persistence (migration 0096) — the ammo
 * economy regression suite.
 *
 * Coverage consumables are charged when their coverage window ENDS
 * (one Q100 Ammo Pack = 200 roaming ticks). Before 0096 the window
 * state lived only in the claim round-trip: the server kept no copy
 * and the shipped client kept it in page memory, so every app restart
 * reset every open window for free and packs were effectively never
 * charged in real play (staging probe, 2026-11-13: 240 ticks claimed
 * without a carried state consumed 0 packs; the same span with a
 * continuous state consumed exactly 1, at the 200-tick boundary).
 *
 * These tests pin the fixed behavior: the server persists the state
 * on the profile and resumes it, whether or not the request carries
 * one — and a client-carried blob can never override the stored copy.
 */

const PLAYER_A = '22222222-2222-4222-8222-222222222222';
const SECRET = 'test-secret-at-least-32-chars-long!!';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function makeClaimServer(store: InMemoryChefGameplayStore) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, { store, authSecret: SECRET });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function tokenFor(playerId: string): string {
  return issueAccessToken({ sub: playerId, email: 'a@test.dev' }, SECRET, 600);
}

function claimBody(tickCount: number, roamingConsumableState?: unknown) {
  return {
    playerId: PLAYER_A,
    areaId: 'dustwaste_frontier',
    ticks: 20,
    tickCount,
    playerLevel: 10,
    equippedGear: [],
    survival: { currentHp: 100000, shieldHp: 10000, maxHp: 100000, mitigation: 0 },
    ...(roamingConsumableState !== undefined ? { roamingConsumableState } : {}),
  };
}

async function postClaim(
  base: string,
  tickCount: number,
  roamingConsumableState?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenFor(PLAYER_A)}`,
    },
    body: JSON.stringify(claimBody(tickCount, roamingConsumableState)),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** A never-expiring Ammo Pack slot a dishonest client would love. */
function forgedAmmoState(tickIndex: number) {
  return {
    slots: [
      {
        slot: 0,
        consumableId: 'AmmoPack',
        family: 'ammo',
        activatedAtTick: 0,
        expiresAtTick: 999_999_999,
        remainingBuffer: 0,
        remainingRegenTicks: 0,
        armed: false,
        remainingBurstTicks: 0,
        ordnanceNextFireTick: null,
      },
    ],
    tickIndex,
  };
}

describe('roaming consumable state persistence (0096)', () => {
  it('charges the Ammo Pack when its 200-tick window ends across stateless claims (app restarts)', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: PLAYER_A, player_level: 10, consumables: { AmmoPack: 3 } });
    const base = await makeClaimServer(store);

    // Eleven claims of 20 ticks each, NONE carrying a state — the
    // post-restart client. The pack activated on claim 1 covers ticks
    // [0, 200); the charge lands when the window ends, on claim 11.
    for (let claim = 1; claim <= 11; claim += 1) {
      const res = await postClaim(base, claim * 20);
      expect(res.status).toBe(200);
      if (claim < 11) {
        expect(res.body.consumedConsumables).toEqual({});
      } else {
        expect(res.body.consumedConsumables).toEqual({ AmmoPack: 1 });
      }
    }
    expect(store.profiles.get(PLAYER_A)?.consumables).toEqual({ AmmoPack: 2 });
    expect(store.consumableEvents).toEqual([
      expect.objectContaining({
        user_id: PLAYER_A,
        consumable_type: 'AmmoPack',
        quantity_delta: -1,
        event_type: 'used',
        activity_type: 'roaming_loot',
      }),
    ]);

    // The renewed window [200, 400) is open: claim 12 charges nothing.
    const twelfth = await postClaim(base, 240);
    expect(twelfth.status).toBe(200);
    expect(twelfth.body.consumedConsumables).toEqual({});
    expect(store.profiles.get(PLAYER_A)?.consumables).toEqual({ AmmoPack: 2 });
  });

  it('never lets a client-carried state override the stored window', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: PLAYER_A, player_level: 10, consumables: { AmmoPack: 3 } });
    const base = await makeClaimServer(store);

    const first = await postClaim(base, 20);
    expect(first.status).toBe(200);

    // Every later claim carries a forged never-expiring slot. The
    // server resumes its OWN stored state, so the real window still
    // ends — and charges — on claim 11.
    for (let claim = 2; claim <= 11; claim += 1) {
      const res = await postClaim(base, claim * 20, forgedAmmoState(claim * 20 - 1));
      expect(res.status).toBe(200);
      if (claim < 11) {
        expect(res.body.consumedConsumables).toEqual({});
      } else {
        expect(res.body.consumedConsumables).toEqual({ AmmoPack: 1 });
      }
    }
    expect(store.profiles.get(PLAYER_A)?.consumables).toEqual({ AmmoPack: 2 });
  });

  it('fails the claim loudly when the state cannot be persisted', async () => {
    class FailingStateStore extends InMemoryChefGameplayStore {
      override async saveRoamingConsumableState(
        _playerId: string,
        _state: Json,
      ): Promise<void> {
        throw new Error('state store unavailable');
      }
    }
    const store = new FailingStateStore();
    store.seedProfile({ id: PLAYER_A, player_level: 10, consumables: { AmmoPack: 1 } });
    const base = await makeClaimServer(store);

    // A silent failure here would resurrect the free-window bug: the
    // claim must surface it exactly like a consumption failure does.
    const res = await postClaim(base, 20);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to persist roaming consumable state');
  });

  it('offline settlement resumes the stored window instead of opening a fresh one', async () => {
    const store = new InMemoryChefGameplayStore();
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    store.seedProfile({
      id: PLAYER_A,
      player_level: 10,
      consumables: { AmmoPack: 5 },
      last_claimed_tick: 200,
      last_roaming_settled_at: fifteenMinutesAgo,
      roaming_consumable_state: {
        slots: [
          {
            slot: 0,
            consumableId: 'AmmoPack',
            family: 'ammo',
            activatedAtTick: 0,
            expiresAtTick: 200,
            remainingBuffer: 0,
            remainingRegenTicks: 0,
            armed: false,
            remainingBurstTicks: 0,
            ordnanceNextFireTick: null,
          },
        ],
        tickIndex: 199,
      },
    });
    store.seedActiveAction({
      user_id: PLAYER_A,
      active_action: 'roaming_loot',
      target_id: 'dustwaste_frontier',
      started_at: fifteenMinutesAgo,
      last_heartbeat_at: fifteenMinutesAgo,
      activity_payload: {},
    });
    const base = await makeClaimServer(store);

    const res = await fetch(`${base}/api/settle-offline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenFor(PLAYER_A)}`,
      },
      body: JSON.stringify({ playerId: PLAYER_A, settlementNonce: 'ammo-state-settle-1' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.settled).toBe(true);

    // 15 minutes = 300 ticks over [200, 500). The stored window ends
    // at 200 (charge 1, renew to 400) and the renewal ends at 400
    // (charge 2). A fresh activation at the settle start would cover
    // [200, 400) and charge only once.
    expect(body.consumedConsumables).toEqual({ AmmoPack: 2 });
    expect(store.profiles.get(PLAYER_A)?.consumables).toEqual({ AmmoPack: 3 });
    const saved = store.profiles.get(PLAYER_A)?.roaming_consumable_state as {
      tickIndex?: number;
    } | null;
    expect(saved?.tickIndex).toBeGreaterThanOrEqual(400);
  });
});
