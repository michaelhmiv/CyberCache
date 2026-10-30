/**
 * Death & resurrection truth (Phase 0 Slice 4) — HTTP tests over the
 * real shipped paths: POST /api/claim (whose sim kills the hunter and
 * whose route records the death server-side, migration 0013) and
 * POST /api/resurrect (the resurrection op), express +
 * InMemoryChefGameplayStore, same harness shape as chefGameplay.test.ts.
 *
 * The lethal-claim fixture: 1 HP, no shield, no gear, 20 ticks in the
 * highest-tier area. Any landed hit kills (monster attack far exceeds
 * 1 HP after the 0.85 variance floor); the chance all 20 ticks miss
 * is <= 0.15^20. The free-timer boundary tests seed the death through
 * the store's recordDeath (the same seam the claim route calls —
 * claim-driven recording is proven by the first tests) so the store's
 * injectable clock can sit exactly on the timer boundary without
 * real sleeps.
 *
 * PgChefGameplayStore + the 0013 SQL functions are verified against
 * real Postgres by the embedded-Postgres harness (same pattern as
 * the prior slices' migration verifications).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { RESURRECTION_FREE_TIMER_MS, resurrectionCostForArea } from '@/lib/combat/resurrectionCost';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';

// Highest-tier area: hardest hitters, highest resurrection price.
const TOP_AREA = ROAMING_AREAS.reduce((best, area) => (area.unlockLevel > best.unlockLevel ? area : best), ROAMING_AREAS[0]);
const TOP_PRICE = resurrectionCostForArea(TOP_AREA.id);

interface Harness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
}

const openServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openServers.length) await openServers.pop()?.();
});

async function makeServer(store = new InMemoryChefGameplayStore()): Promise<Harness> {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  openServers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return { store, base: `http://127.0.0.1:${port}`, tokenA: issueAccessToken(SECRET, A, false) };
}

async function post(base: string, path: string, body: unknown, token?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** A claim engineered to kill: 1 HP, no shield, top-tier area. */
function lethalClaim(tickCount = 20) {
  return {
    playerId: A,
    areaId: TOP_AREA.id,
    ticks: 20,
    tickCount,
    playerLevel: 60,
    survival: { currentHp: 1, shieldHp: 0, maxHp: 700 },
  };
}

async function killViaClaim(h: Harness, credits: number) {
  h.store.seedProfile({ id: A, player_level: 60, credits });
  const res = await post(h.base, '/api/claim', lethalClaim(), h.tokenA);
  expect(res.status).toBe(200);
  const survival = res.json.survival as Record<string, unknown>;
  expect(survival.isDead).toBe(true);
  return res;
}

describe('death & resurrection (Phase 0 Slice 4)', () => {
  it('a lethal claim records the death server-side and returns the record', async () => {
    const h = await makeServer();
    const res = await killViaClaim(h, 10_000);

    // Engine attribution rides the survival payload...
    const survival = res.json.survival as Record<string, unknown>;
    const killedBy = survival.killedBy as Record<string, unknown>;
    expect(typeof killedBy.monsterId).toBe('string');
    expect((killedBy.monsterId as string).length).toBeGreaterThan(0);
    expect(typeof killedBy.monsterName).toBe('string');
    expect(killedBy.areaId).toBe(TOP_AREA.id);
    expect(survival.diedAt).toBeGreaterThan(0);

    // ...and the route's death record is in the response, in the
    // client's DeathLogEntry shape plus the free-ready timestamp.
    const death = res.json.death as Record<string, unknown>;
    expect(death.monsterId).toBe(killedBy.monsterId);
    expect(death.monsterName).toBe(killedBy.monsterName);
    expect(death.areaId).toBe(TOP_AREA.id);
    expect(death.at).toBe(survival.diedAt);
    expect(death.diedAtMs).toBe(survival.diedAt);
    expect(death.freeReadyAtMs).toBe((survival.diedAt as number) + RESURRECTION_FREE_TIMER_MS);

    // The server record + log are the same death.
    const record = await h.store.getDeathRecord(A);
    expect(record).not.toBeNull();
    expect(record!.monsterId).toBe(killedBy.monsterId);
    expect(record!.areaId).toBe(TOP_AREA.id);
    expect(record!.diedAtMs).toBe(survival.diedAt);
    const profile = h.store.profiles.get(A)!;
    expect(profile.death_log).toHaveLength(1);
    expect(profile.death_log[0].monsterId).toBe(killedBy.monsterId);
    expect(profile.death_log[0].areaId).toBe(TOP_AREA.id);
    expect(profile.death_log[0].at).toBe(survival.diedAt);
  });

  it('a later claim does not move the recorded death (first death wins)', async () => {
    const h = await makeServer();
    await killViaClaim(h, 10_000);
    const first = await h.store.getDeathRecord(A);

    const res = await post(h.base, '/api/claim', {
      ...lethalClaim(40),
      survival: { currentHp: 0, shieldHp: 0, maxHp: 700 },
    }, h.tokenA);
    expect(res.status).toBe(200);
    const second = await h.store.getDeathRecord(A);
    expect(second).toEqual(first);
    // The standing record is what the response re-syncs.
    expect((res.json.death as Record<string, unknown>).diedAtMs).toBe(first!.diedAtMs);
    expect(h.store.profiles.get(A)!.death_log).toHaveLength(1);
  });

  it('paid revive charges exactly the displayed price and clears the death', async () => {
    const h = await makeServer();
    await killViaClaim(h, 10_000);
    const balanceBefore = h.store.profiles.get(A)!.credits;
    expect(balanceBefore).toBeGreaterThan(TOP_PRICE);

    const res = await post(h.base, '/api/resurrect', {
      playerId: A,
      method: 'paid',
      nonce: 'resurrect:test-paid-1',
    }, h.tokenA);

    expect(res.status).toBe(200);
    expect(res.json.resurrected).toBe(true);
    expect(res.json.method).toBe('paid');
    // The charge is the shared rule over the death area — the exact
    // number the death screen displays for that area.
    expect(res.json.creditsCharged).toBe(TOP_PRICE);
    expect(res.json.creditsCharged).toBe(resurrectionCostForArea(TOP_AREA.id));
    expect(h.store.profiles.get(A)!.credits).toBe(balanceBefore - TOP_PRICE);
    expect((res.json.profile as Record<string, unknown>).credits).toBe(balanceBefore - TOP_PRICE);
    // Death cleared server-side; the cleared death + log come back.
    expect(await h.store.getDeathRecord(A)).toBeNull();
    expect(h.store.profiles.get(A)!.death_state).toEqual({});
    const deathLog = res.json.deathLog as Array<Record<string, unknown>>;
    expect(deathLog).toHaveLength(1);
    expect(deathLog[0].areaId).toBe(TOP_AREA.id);
    expect(typeof deathLog[0].monsterName).toBe('string');
  });

  it('a nonce replay does not double-charge; a fresh revive after resurrection is refused', async () => {
    const h = await makeServer();
    await killViaClaim(h, 10_000);
    const body = { playerId: A, method: 'paid', nonce: 'resurrect:test-replay-1' };

    const first = await post(h.base, '/api/resurrect', body, h.tokenA);
    expect(first.status).toBe(200);
    const balanceAfterFirst = h.store.profiles.get(A)!.credits;

    const replay = await post(h.base, '/api/resurrect', body, h.tokenA);
    expect(replay.status).toBe(200);
    expect(replay.json.idempotentReplay).toBe(true);
    expect(replay.json.creditsCharged).toBe(TOP_PRICE);
    expect(h.store.profiles.get(A)!.credits).toBe(balanceAfterFirst);

    const second = await post(h.base, '/api/resurrect', {
      playerId: A,
      method: 'paid',
      nonce: 'resurrect:test-replay-2',
    }, h.tokenA);
    expect(second.status).toBe(409);
    expect(second.json.reason).toBe('no_death_recorded');
    expect(h.store.profiles.get(A)!.credits).toBe(balanceAfterFirst);
  });

  it('free revive before the timer is rejected server-side and the death stands', async () => {
    const h = await makeServer();
    const claim = await killViaClaim(h, 10_000);
    const diedAtMs = (claim.json.death as Record<string, unknown>).diedAtMs as number;
    const balanceBefore = h.store.profiles.get(A)!.credits;

    const res = await post(h.base, '/api/resurrect', {
      playerId: A,
      method: 'free',
      nonce: 'resurrect:test-free-early',
    }, h.tokenA);

    expect(res.status).toBe(400);
    expect(res.json.reason).toBe('free_not_ready');
    expect(res.json.freeReadyAtMs).toBe(diedAtMs + RESURRECTION_FREE_TIMER_MS);
    expect(await h.store.getDeathRecord(A)).not.toBeNull();
    expect(h.store.profiles.get(A)!.credits).toBe(balanceBefore);
  });

  it('free revive succeeds once the server-side timer has elapsed', async () => {
    let clockMs = 1_700_000_000_000;
    const store = new InMemoryChefGameplayStore(() => new Date(clockMs));
    const h = await makeServer(store);
    store.seedProfile({ id: A, player_level: 60, credits: 500 });
    await store.recordDeath(A, {
      diedAtMs: clockMs,
      areaId: TOP_AREA.id,
      monsterId: 'helix_revenant',
      monsterName: 'Helix Revenant',
    });

    clockMs += RESURRECTION_FREE_TIMER_MS - 1;
    const early = await post(h.base, '/api/resurrect', {
      playerId: A,
      method: 'free',
      nonce: 'resurrect:test-free-boundary',
    }, h.tokenA);
    expect(early.status).toBe(400);
    expect(early.json.reason).toBe('free_not_ready');

    clockMs += 1; // exactly at the boundary: diedAt + 5 min
    const ready = await post(h.base, '/api/resurrect', {
      playerId: A,
      method: 'free',
      nonce: 'resurrect:test-free-boundary',
    }, h.tokenA);
    expect(ready.status).toBe(200);
    expect(ready.json.resurrected).toBe(true);
    expect(ready.json.creditsCharged).toBe(0);
    expect(store.profiles.get(A)!.credits).toBe(500);
    expect(await store.getDeathRecord(A)).toBeNull();
    const deathLog = ready.json.deathLog as Array<Record<string, unknown>>;
    expect(deathLog[0].monsterId).toBe('helix_revenant');
    expect(deathLog[0].areaId).toBe(TOP_AREA.id);
  });

  it('revive without a recorded death is rejected and charges nothing', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 60, credits: 10_000 });

    for (const method of ['paid', 'free'] as const) {
      const res = await post(h.base, '/api/resurrect', {
        playerId: A,
        method,
        nonce: `resurrect:test-nodeath-${method}`,
      }, h.tokenA);
      expect(res.status).toBe(409);
      expect(res.json.reason).toBe('no_death_recorded');
    }
    expect(h.store.profiles.get(A)!.credits).toBe(10_000);
  });

  it('paid revive with insufficient credits is rejected; the death stands', async () => {
    const h = await makeServer();
    await killViaClaim(h, 0);
    const balance = h.store.profiles.get(A)!.credits;
    // The claim's own rewards are the only credits — far below the
    // top-tier price. Guard the premise so a balance change fails
    // loudly here instead of flipping the test's meaning.
    expect(balance).toBeLessThan(TOP_PRICE);

    const res = await post(h.base, '/api/resurrect', {
      playerId: A,
      method: 'paid',
      nonce: 'resurrect:test-broke-1',
    }, h.tokenA);
    expect(res.status).toBe(400);
    expect(res.json.reason).toBe('insufficient_credits');
    expect(res.json.cost).toBe(TOP_PRICE);
    expect(h.store.profiles.get(A)!.credits).toBe(balance);
    expect(await h.store.getDeathRecord(A)).not.toBeNull();
  });

  it('resurrect rejects unauthenticated calls and invalid bodies', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 60, credits: 10_000 });

    const unauth = await post(h.base, '/api/resurrect', {
      playerId: A,
      method: 'paid',
      nonce: 'resurrect:test-unauth-1',
    });
    expect(unauth.status).toBe(401);

    const badMethod = await post(h.base, '/api/resurrect', {
      playerId: A,
      method: 'token',
      nonce: 'resurrect:test-bad-method',
    }, h.tokenA);
    expect(badMethod.status).toBe(400);

    const badNonce = await post(h.base, '/api/resurrect', {
      playerId: A,
      method: 'paid',
      nonce: 'short',
    }, h.tokenA);
    expect(badNonce.status).toBe(400);
  });
});
