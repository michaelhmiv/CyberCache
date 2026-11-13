import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaimHandler } from '@/server/routes/roamingHandler';
import { InMemoryChefGameplayStore } from '@/server/gameplay/memory';
import { issueAccessToken } from '@/server/auth/tokens';

const secret = 'local-audit-test-secret-at-least-32-characters';
const playerId = '11111111-1111-4111-8111-111111111111';
const close: Array<() => Promise<void>> = [];
afterEach(async () => { while (close.length) await close.pop()!(); });

async function server() {
  const store = new InMemoryChefGameplayStore();
  store.seedProfile({ id: playerId, player_level: 20 });
  const app = express();
  app.use(express.json());
  app.post('/api/claim', createClaimHandler(store, { jwtSecret: secret, now: () => new Date('2026-11-04T12:00:00Z') }));
  const http = app.listen(0);
  await new Promise<void>((resolve) => http.once('listening', resolve));
  close.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api/claim`;
  return (body: Record<string, unknown>) => fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${issueAccessToken(secret, playerId, false)}` },
    body: JSON.stringify({ playerId, areaId: 'dustwaste_frontier', playerLevel: 20, ticks: 1, tickCount: 1,
      survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0 }, ...body }),
  });
}

describe('foreground claim bounds', () => {
  it('never accepts the internal offline maxTicks override from a foreground body', async () => {
    const post = await server();
    const response = await post({ ticks: 100, tickCount: 100, maxTicks: 100 });
    expect(response.status).toBe(200);
    expect((await response.json()).rewards.ticks).toBe(20);
  });

  it.each([{ ticks: '100' }, { ticks: -1 }, { ticks: 1.5 }, { tickCount: '100' }, { tickCount: 1.5 }])('rejects malformed tick counters before running the engine (%j)', async (body) => {
    const post = await server();
    expect((await post(body)).status).toBe(400);
  });
});
