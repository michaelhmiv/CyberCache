/**
 * Chef background-job routes (Route B, slice B5) — HTTP + InMemoryJobStore
 * tests, plus the FCM sender port with an injected fetcher.
 *
 * Covered: job-secret auth (missing/wrong → 401, player JWT not accepted),
 * heartbeat + prune idempotency and window semantics, NPC seed end-state
 * (run twice → exactly one batch of active listings), push-test auth
 * (no JWT → 401), push no-op when FCM is unconfigured (503, nothing sent
 * or logged), push delivery to the caller's devices only with per-device
 * notification events, and the June no-devices 404 shape.
 *
 * The PgJobStore + 0006 SQL functions are verified against real Postgres
 * by the embedded-Postgres harness (same pattern as B1–B4).
 */
import express from 'express';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { mountJobRoutes } from '../server/jobs/routes';
import { InMemoryJobStore } from '../server/jobs/memory';
import { emptyJobSeed, type JobSeed } from '../server/jobs/memory';
import {
  createFcmSender,
  parseFirebaseAdminConfig,
  type FetchFn,
} from '../server/jobs/fcm';
import { NPC_MARKET_USER_ID } from '../server/lib/npcMarket';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const JOB_SECRET = 'test-job-secret';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const NOW = Date.parse('2026-10-29T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

interface FakeSender {
  calls: Array<{ token: string; title: string; body: string }>;
  failTokens: Set<string>;
  sendToDevice(token: string, title: string, body: string): Promise<{ ok: boolean; response?: unknown; error?: string }>;
  projectId: string;
}

function fakeSender(): FakeSender {
  const sender: FakeSender = {
    calls: [],
    failTokens: new Set(),
    projectId: 'test-project',
    async sendToDevice(token, title, body) {
      sender.calls.push({ token, title, body });
      if (sender.failTokens.has(token)) return { ok: false, error: 'fcm_rejected' };
      return { ok: true, response: { name: 'projects/test-project/messages/1' } };
    },
  };
  return sender;
}

interface Harness {
  store: InMemoryJobStore;
  seed: JobSeed;
  base: string;
  close: () => Promise<void>;
  tokenA: string;
  tokenB: string;
  sender: FakeSender;
}

const openServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openServers.length) await openServers.pop()?.();
});

async function makeServer(
  seed: JobSeed = emptyJobSeed(),
  opts: { jobSecret?: string; fcmSender?: FakeSender | null; now?: number } = {},
): Promise<Harness> {
  const store = new InMemoryJobStore(seed, { now: () => opts.now ?? NOW });
  const sender = opts.fcmSender === undefined ? fakeSender() : opts.fcmSender;
  const app = express();
  app.use(express.json());
  mountJobRoutes(app, store, {
    jwtSecret: SECRET,
    jobSecret: opts.jobSecret ?? JOB_SECRET,
    fcmSender: sender,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  openServers.push(close);
  return {
    store,
    seed,
    base: `http://127.0.0.1:${port}`,
    close,
    tokenA: issueAccessToken(SECRET, A, false),
    tokenB: issueAccessToken(SECRET, B, false),
    sender: sender as FakeSender,
  };
}

interface Reply {
  status: number;
  json: Record<string, unknown>;
}

async function call(
  h: Harness,
  path: string,
  headers: Record<string, string>,
  payload?: unknown,
): Promise<Reply> {
  const res = await fetch(`${h.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Express's default 404 is HTML; the status is what the test asserts.
  }
  return { status: res.status, json };
}

const jobHeaders = { 'x-chef-job-secret': JOB_SECRET };

describe('job route auth', () => {
  it('rejects missing and wrong job secrets with 401 on every job route', async () => {
    const h = await makeServer();
    for (const path of ['/api/jobs/daily-heartbeat', '/api/jobs/prune-snapshots', '/api/jobs/seed-npc-market']) {
      const missing = await call(h, path, {}, {});
      expect(missing.status).toBe(401);
      expect(missing.json.error).toBe('unauthorized');
      const wrong = await call(h, path, { 'x-chef-job-secret': 'nope' }, {});
      expect(wrong.status).toBe(401);
    }
  });

  it('does not accept a player JWT as a job credential', async () => {
    const h = await makeServer();
    const res = await call(h, '/api/jobs/daily-heartbeat', { authorization: `Bearer ${h.tokenA}` }, {});
    expect(res.status).toBe(401);
  });

  it('mounts no job routes when CHEF_JOB_SECRET is unset', async () => {
    const h = await makeServer(emptyJobSeed(), { jobSecret: '' });
    const res = await call(h, '/api/jobs/daily-heartbeat', jobHeaders, {});
    expect(res.status).toBe(404);
  });
});

describe('daily heartbeat job', () => {
  function heartbeatSeed(): JobSeed {
    const seed = emptyJobSeed();
    seed.profiles = [
      { id: A, updated_at: iso(NOW - 1 * DAY) }, // active, no heartbeat yet
      { id: B, updated_at: iso(NOW - 2 * DAY) }, // active, heartbeat 21h ago
      { id: '33333333-3333-4333-8333-333333333333', updated_at: iso(NOW - 30 * DAY) }, // stale profile
      { id: '44444444-4444-4444-8444-444444444444', updated_at: iso(NOW - 1 * HOUR) }, // heartbeat 1h ago
    ];
    seed.snapshots = [
      { player_id: B, source: 'daily_heartbeat', snapshot_at: iso(NOW - 21 * HOUR) },
      { player_id: '44444444-4444-4444-8444-444444444444', source: 'daily_heartbeat', snapshot_at: iso(NOW - 1 * HOUR) },
    ];
    return seed;
  }

  it('records heartbeats only for active players outside the 20h guard', async () => {
    const h = await makeServer(heartbeatSeed());
    const res = await call(h, '/api/jobs/daily-heartbeat', jobHeaders, {});
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, job: 'daily-heartbeat', recorded: 2 });
    const heartbeats = h.seed.snapshots.filter((s) => s.source === 'daily_heartbeat');
    expect(heartbeats.map((s) => s.player_id).sort()).toEqual([
      A,
      B,
      '44444444-4444-4444-8444-444444444444',
      B,
    ].sort());
  });

  it('is idempotent: an immediate second run records nothing new', async () => {
    const h = await makeServer(heartbeatSeed());
    await call(h, '/api/jobs/daily-heartbeat', jobHeaders, {});
    const second = await call(h, '/api/jobs/daily-heartbeat', jobHeaders, {});
    expect(second.json.recorded).toBe(0);
    expect(h.seed.snapshots.filter((s) => s.source === 'daily_heartbeat')).toHaveLength(4);
  });
});

describe('prune snapshots job', () => {
  it('deletes only throttled sources older than 30 days, and is idempotent', async () => {
    const seed = emptyJobSeed();
    seed.snapshots = [
      { player_id: A, source: 'daily_heartbeat', snapshot_at: iso(NOW - 31 * DAY) },
      { player_id: A, source: 'chef_claim', snapshot_at: iso(NOW - 45 * DAY) },
      { player_id: A, source: 'settlement', snapshot_at: iso(NOW - 90 * DAY) },
      { player_id: A, source: 'boss_defeat', snapshot_at: iso(NOW - 90 * DAY) }, // milestone: kept
      { player_id: A, source: 'daily_heartbeat', snapshot_at: iso(NOW - 5 * DAY) }, // recent: kept
    ];
    const h = await makeServer(seed);
    const res = await call(h, '/api/jobs/prune-snapshots', jobHeaders, {});
    expect(res.json).toMatchObject({ ok: true, job: 'prune-snapshots', pruned: 3 });
    expect(h.seed.snapshots.map((s) => s.source).sort()).toEqual(['boss_defeat', 'daily_heartbeat']);
    const second = await call(h, '/api/jobs/prune-snapshots', jobHeaders, {});
    expect(second.json.pruned).toBe(0);
  });
});

describe('NPC market seed job', () => {
  it('seeds the requested batch under the NPC account', async () => {
    const h = await makeServer();
    const res = await call(h, '/api/jobs/seed-npc-market', jobHeaders, { count: 5, level: 10 });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, job: 'seed-npc-market', seeded: 5, level: 10 });
    const active = h.seed.listings.filter((l) => l.status === 'active');
    expect(active).toHaveLength(5);
    expect(active.every((l) => l.seller_user_id === NPC_MARKET_USER_ID)).toBe(true);
    expect(h.seed.items).toHaveLength(5);
    expect(active.every((l) => l.price_credits >= 100)).toBe(true);
  });

  it('is safe to run twice: the second run replaces, not duplicates, the stock', async () => {
    const h = await makeServer();
    await call(h, '/api/jobs/seed-npc-market', jobHeaders, { count: 4, level: 10 });
    const res = await call(h, '/api/jobs/seed-npc-market', jobHeaders, { count: 6, level: 20 });
    expect(res.json.seeded).toBe(6);
    const active = h.seed.listings.filter((l) => l.status === 'active');
    expect(active).toHaveLength(6);
    expect(h.seed.listings.filter((l) => l.status === 'cancelled')).toHaveLength(4);
  });

  it('clamps count and level to the June ranges', async () => {
    const h = await makeServer();
    const res = await call(h, '/api/jobs/seed-npc-market', jobHeaders, { count: 500, level: 0 });
    expect(res.json.seeded).toBe(50);
    expect(res.json.level).toBe(1);
  });
});

describe('test push route', () => {
  function pushSeed(): JobSeed {
    const seed = emptyJobSeed();
    seed.pushDevices = [
      { user_id: A, token: 'token-alpha-one-123456', enabled: true },
      { user_id: A, token: 'token-alpha-two-123456', enabled: true },
      { user_id: A, token: 'token-alpha-off-123456', enabled: false },
      { user_id: B, token: 'token-bravo-one-123456', enabled: true },
    ];
    return seed;
  }

  it('requires a player JWT (401 without one)', async () => {
    const h = await makeServer(pushSeed());
    const res = await call(h, '/api/push/test', {}, {});
    expect(res.status).toBe(401);
    expect(h.sender.calls).toHaveLength(0);
  });

  it('no-ops safely when FCM is not configured: 503, nothing sent or logged', async () => {
    const h = await makeServer(pushSeed(), { fcmSender: null });
    const res = await call(h, '/api/push/test', { authorization: `Bearer ${h.tokenA}` }, {});
    expect(res.status).toBe(503);
    expect(res.json.error).toBe('push_not_configured');
    expect(h.seed.notificationEvents).toHaveLength(0);
  });

  it('sends only to the caller’s enabled devices and logs one event per device', async () => {
    const h = await makeServer(pushSeed());
    const res = await call(h, '/api/push/test', { authorization: `Bearer ${h.tokenA}` }, { title: 'Hi', message: 'There' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, sent: 2, failed: 0 });
    expect(h.sender.calls.map((c) => c.token).sort()).toEqual([
      'token-alpha-one-123456',
      'token-alpha-two-123456',
    ]);
    expect(h.sender.calls[0]).toMatchObject({ title: 'Hi', body: 'There' });
    expect(h.seed.notificationEvents).toHaveLength(2);
    expect(h.seed.notificationEvents.every((e) => e.user_id === A && e.status === 'sent')).toBe(true);
  });

  it('records failures per device and reports the June response shape', async () => {
    const h = await makeServer(pushSeed());
    h.sender.failTokens.add('token-alpha-two-123456');
    const res = await call(h, '/api/push/test', { authorization: `Bearer ${h.tokenA}` }, {});
    expect(res.json).toMatchObject({ ok: true, sent: 1, failed: 1 });
    expect((res.json.failures as Array<{ tokenSuffix: string }>)[0].tokenSuffix).toBe('o-123456');
    const failedEvent = h.seed.notificationEvents.find((e) => e.status === 'failed');
    expect(failedEvent?.sent_at).toBeNull();
  });

  it('returns the June 404 shape when the caller has no active devices', async () => {
    const h = await makeServer(emptyJobSeed());
    const res = await call(h, '/api/push/test', { authorization: `Bearer ${h.tokenB}` }, {});
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ ok: false, sent: 0, failed: 0, error: 'no_active_push_tokens' });
  });

  it('applies the Edge Function text hygiene (defaults, whitespace, caps)', async () => {
    const h = await makeServer(pushSeed());
    await call(h, '/api/push/test', { authorization: `Bearer ${h.tokenA}` }, {
      title: '  many   spaces  ',
      message: '',
    });
    expect(h.sender.calls[0].title).toBe('many spaces');
    expect(h.sender.calls[0].body).toBe('Push delivery is wired.');
  });
});

describe('FCM sender port', () => {
  it('parses the admin JSON and rejects unset/invalid config', () => {
    expect(parseFirebaseAdminConfig(undefined)).toBeNull();
    expect(parseFirebaseAdminConfig('not json')).toBeNull();
    expect(parseFirebaseAdminConfig('{"project_id":"p"}')).toBeNull();
    const ok = parseFirebaseAdminConfig(JSON.stringify({
      project_id: 'p', client_email: 'a@b.c', private_key: 'k',
    }));
    expect(ok).toMatchObject({ projectId: 'p', clientEmail: 'a@b.c', privateKey: 'k' });
    expect(ok?.tokenUri).toBe('https://oauth2.googleapis.com/token');
  });

  it('mints an OAuth token and posts to the FCM v1 endpoint', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const seen: Array<{ url: string; body: string }> = [];
    const fetcher: FetchFn = async (url, init) => {
      seen.push({ url, body: init.body });
      if (url === 'https://oauth2.googleapis.com/token') {
        return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test' }) };
      }
      return { ok: true, status: 200, json: async () => ({ name: 'projects/demo/messages/9' }) };
    };
    const sender = createFcmSender(
      { projectId: 'demo', clientEmail: 'svc@demo.iam.gserviceaccount.com', privateKey, tokenUri: 'https://oauth2.googleapis.com/token' },
      fetcher,
    );
    const result = await sender.sendToDevice('device-token', 'Title', 'Body');
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1].url).toBe('https://fcm.googleapis.com/v1/projects/demo/messages:send');
    const message = JSON.parse(seen[1].body) as { message: { token: string; notification: { title: string } } };
    expect(message.message.token).toBe('device-token');
    expect(message.message.notification.title).toBe('Title');
  });
});
