/**
 * Combat stats routes (Route B, slice B4) — GET/PUT /api/stats/combat.
 *
 * B4 adds this pair because combatStatsSupabaseSync used to read and
 * upsert the combat_stats row directly through PostgREST and B2/B3
 * exposed no equivalent. The routes keep the row contract: own row
 * only, identity from the JWT, a body user_id can never redirect the
 * write, and GET returns null (not 404) when no row exists yet —
 * the client's "fresh user" signal.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed } from '../server/writes/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

interface Harness {
  base: string;
  close: () => Promise<void>;
  tokenA: string;
  tokenB: string;
}

let harness: Harness;

beforeAll(async () => {
  const store = new InMemoryWriteStore(emptyWriteSeed(), { now: () => new Date(), rng: () => 0.5, uuid: () => A });
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const { port } = server.address() as AddressInfo;
  harness = {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    tokenA: issueAccessToken(SECRET, A, false),
    tokenB: issueAccessToken(SECRET, B, true),
  };
});

afterAll(async () => {
  await harness.close();
});

async function call(method: string, path: string, token: string | null, payload?: unknown) {
  const res = await fetch(`${harness.base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const rowFor = (userId: string) => ({
  user_id: userId,
  total_kills: 42,
  total_deaths: 3,
  longest_kill_streak: 9,
  last_kill_at: '2026-10-29T11:00:00.000Z',
  run_started_at: '2026-10-29T10:00:00.000Z',
  kills_by_area: { dustwaste_frontier: 40 },
  kills_by_weapon_type: { Pistol: 42 },
  kills_by_boss: {},
  kills_by_element: { Kinetic: 42 },
  highest_boss_tier: 2,
  active_play_seconds: 600,
  idle_play_seconds: 1200,
  updated_at: '2026-10-29T11:30:00.000Z',
});

describe('/api/stats/combat', () => {
  it('requires a Chef JWT', async () => {
    expect((await call('GET', '/api/stats/combat', null)).status).toBe(401);
    expect((await call('PUT', '/api/stats/combat', null, rowFor(A))).status).toBe(401);
  });

  it('returns null for a player with no row yet (fresh user signal)', async () => {
    const res = await call('GET', '/api/stats/combat', harness.tokenA);
    expect(res.status).toBe(200);
    expect(res.json).toBeNull();
  });

  it('round-trips a saved row', async () => {
    const put = await call('PUT', '/api/stats/combat', harness.tokenA, rowFor(A));
    expect(put.status).toBe(204);

    const res = await call('GET', '/api/stats/combat', harness.tokenA);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ user_id: A, total_kills: 42, kills_by_area: { dustwaste_frontier: 40 } });
  });

  it('ignores a body user_id — the JWT owns the row', async () => {
    const put = await call('PUT', '/api/stats/combat', harness.tokenB, { ...rowFor(A), total_kills: 7 });
    expect(put.status).toBe(204);

    const asB = await call('GET', '/api/stats/combat', harness.tokenB);
    expect(asB.json).toMatchObject({ user_id: B, total_kills: 7 });
    // A's row is untouched by B's write.
    const asA = await call('GET', '/api/stats/combat', harness.tokenA);
    expect(asA.json).toMatchObject({ user_id: A, total_kills: 42 });
  });
});
