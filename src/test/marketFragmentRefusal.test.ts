/**
 * F2 — the fragment-listing refusal's error SHAPE (tsc-gate triage
 * finding F2, PR #411; fix approved 2026-11-05).
 *
 * Cache fragments are abolished (migration 0082), so both write
 * stores refuse `marketCreateFragment` before any state is touched.
 * The in-memory twin always routed the refusal through writeError()
 * and produced a real code ('validation') with the sentence as the
 * message. The Pg store passed the sentence as the WriteStoreError
 * CODE, so the API answered 400 with the sentence as `error` and an
 * empty `message`.
 *
 * Layer pinned: HTTP through the real write routes, mounted once per
 * store — the route layer is where {status, error, message} is
 * minted (STATUS_BY_CODE + fail() in writes/routes.ts), and it is
 * the closest layer that exercises the Pg path without a live
 * Postgres: the Pg refusal happens before any SQL, which the
 * tripwire pool proves by throwing if it is ever queried.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import {
  FRAGMENT_REFUSAL,
  PgWriteStore,
  WriteStoreError,
  type WriteStore,
} from '../server/writes/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const SELLER = '11111111-1111-4111-8111-111111111111';

interface Harness {
  base: string;
  token: string;
  close: () => Promise<void>;
}

async function mount(store: WriteStore): Promise<Harness> {
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolveListen) => server.on('listening', resolveListen));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    token: issueAccessToken(SECRET, SELLER, false),
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

async function postFragment(h: Harness) {
  const res = await fetch(`${h.base}/api/ops/market-create-fragment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${h.token}` },
    body: JSON.stringify({ nonce: 'frag-refusal-nonce-1', quantity: 1, price_credits: 100 }),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

describe('fragment refusal — error shape (F2)', () => {
  describe('Pg write store (the F2 path)', () => {
    let h: Harness;
    beforeAll(async () => {
      // Tripwire pool: the refusal must happen before any SQL. If a
      // query ever slips through, the response shape changes and the
      // assertions below fail on the distinctive message.
      const pool = {
        query: () => {
          throw new Error('tripwire: Pg pool queried by the fragment refusal');
        },
      } as unknown as Pool;
      h = await mount(new PgWriteStore(pool));
    });
    afterAll(async () => { await h.close(); });

    it('answers 400 with code validation and the sentence as the message', async () => {
      const res = await postFragment(h);
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: 'validation', message: FRAGMENT_REFUSAL });
    });

    it('the store error itself carries the code and the message', () => {
      const store = new PgWriteStore({ query: () => { throw new Error('tripwire'); } } as unknown as Pool);
      let caught: unknown;
      try {
        void store.marketCreateFragment(SELLER, 'frag-refusal-nonce-1', 1, 100);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(WriteStoreError);
      expect((caught as WriteStoreError).code).toBe('validation');
      expect((caught as WriteStoreError).message).toBe(FRAGMENT_REFUSAL);
    });
  });

  describe('in-memory twin (parity)', () => {
    let h: Harness;
    beforeAll(async () => { h = await mount(new InMemoryWriteStore()); });
    afterAll(async () => { await h.close(); });

    it('answers with the identical shape', async () => {
      const res = await postFragment(h);
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: 'validation', message: FRAGMENT_REFUSAL });
    });
  });
});
