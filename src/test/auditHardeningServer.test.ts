/**
 * Audit extraction — server hardening tests (2026-11-21).
 *
 * Live-HTTP coverage for the verified fixes extracted from PR #646:
 * the JWT payload guard, POST /api/reports (auth, self-report guard,
 * UUID validation, 24h dedup), POST /api/account/delete (JWT-only
 * identity, session revocation, other accounts untouched), and the
 * set-username profanity blocklist (Build 7 brief §C).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountAuthRoutes } from '../server/auth/routes';
import { InMemoryAuthStore } from '../server/auth/store';
import { verifyAccessToken } from '../server/auth/tokens';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, usernameBlocklistError, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';

const SECRET = 'audit-hardening-test-secret-32-chars';

describe('JWT payload guard', () => {
  it('rejects null/primitive JSON JWT payloads without throwing TypeError', () => {
    expect(verifyAccessToken(SECRET, 'bnVsbA.bnVsbA.sig').ok).toBe(false);
    expect(verifyAccessToken(SECRET, 'W10.W10.sig').ok).toBe(false);
    expect(verifyAccessToken(SECRET, 'NDI.NDI.sig').ok).toBe(false);
  });
});

describe('reports + account deletion (live HTTP, in-memory auth store)', () => {
  const store = new InMemoryAuthStore();
  let baseUrl = '';
  let server: ReturnType<express.Express['listen']>;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountAuthRoutes(app, store, { jwtSecret: SECRET });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function makeGuest() {
    const res = await fetch(`${baseUrl}/api/auth/guest`, { method: 'POST' });
    return (await res.json()) as { accessToken: string; refreshToken: string; account: { id: string } };
  }

  it('POST /api/reports requires auth, rejects self-reports and bad UUIDs, dedups within 24h', async () => {
    const u1 = await makeGuest();
    const u2 = await makeGuest();

    const noAuth = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportedAccountId: u2.account.id, context: 'leaderboard' }),
    });
    expect(noAuth.status).toBe(401);

    const selfRes = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u1.accessToken}` },
      body: JSON.stringify({ reportedAccountId: u1.account.id, context: 'leaderboard' }),
    });
    expect(selfRes.status).toBe(400);

    const badId = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u1.accessToken}` },
      body: JSON.stringify({ reportedAccountId: 'not-a-uuid', context: 'leaderboard' }),
    });
    expect(badId.status).toBe(400);

    const okRes = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u1.accessToken}` },
      body: JSON.stringify({ reportedAccountId: u2.account.id, context: 'leaderboard' }),
    });
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as { ok: boolean; deduplicated: boolean };
    expect(okBody.ok).toBe(true);
    expect(okBody.deduplicated).toBe(false);

    const dupRes = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u1.accessToken}` },
      body: JSON.stringify({ reportedAccountId: u2.account.id, context: 'leaderboard' }),
    });
    expect(dupRes.status).toBe(200);
    const dupBody = (await dupRes.json()) as { ok: boolean; deduplicated: boolean };
    expect(dupBody.ok).toBe(true);
    expect(dupBody.deduplicated).toBe(true);
  });

  it('POST /api/account/delete uses JWT identity, revokes sessions, leaves other accounts untouched', async () => {
    const g = await makeGuest();
    const other = await makeGuest();

    const unauth = await fetch(`${baseUrl}/api/account/delete`, { method: 'POST' });
    expect(unauth.status).toBe(401);

    const delRes = await fetch(`${baseUrl}/api/account/delete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${g.accessToken}` },
    });
    expect(delRes.status).toBe(200);
    expect(((await delRes.json()) as { ok: boolean }).ok).toBe(true);

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${g.accessToken}` },
    });
    expect(meRes.status).toBe(401);

    const refRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: g.refreshToken }),
    });
    expect(refRes.status).toBe(401);

    const otherMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${other.accessToken}` },
    });
    expect(otherMe.status).toBe(200);
  });
});

describe('username profanity blocklist (set-username, server layer)', () => {
  const PLAYER = '55555555-5555-4555-8555-555555555555';

  function makeStore(): InMemoryWriteStore {
    const seed: WriteSeed = emptyWriteSeed();
    const profile: ProfileRowData = {
      username: null, display_name: null, player_level: 1, player_xp: 0, credits: 0,
      scrap: 0, cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {},
      consumables: {}, skill_spends: {}, boss_state: {}, last_idle_claim_at: null,
      last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: '2026-06-14T00:00:00.000Z',
      account_type: 'verified', email: null, email_verified_at: null,
      verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
      last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: null,
      username_updated_at: null, username_change_count: 0,
      id: PLAYER,
    } as ProfileRowData;
    seed.profiles = [profile];
    return new InMemoryWriteStore(seed, { now: () => new Date('2026-11-21T12:00:00.000Z') });
  }

  it('rejects listed names, leetspeak folds, and digit-trailed variants', async () => {
    const store = makeStore();
    for (const name of ['fuck', 'Fuck', 'sh1thead', 'fuck99', 'motherfucker']) {
      const res = await store.setUsername(PLAYER, name);
      expect(res.ok, name).toBe(false);
      expect(res.error).toBe('That username is not allowed.');
    }
  });

  it('allows ordinary names, including ones containing listed substrings', async () => {
    const store = makeStore();
    expect((await store.setUsername(PLAYER, 'CacheHunter')).ok).toBe(true);
    const store2 = makeStore();
    expect((await store2.setUsername(PLAYER, 'classy')).ok).toBe(true);
    const store3 = makeStore();
    expect((await store3.setUsername(PLAYER, 'assassin')).ok).toBe(true);
  });

  it('helper folds case, leetspeak, and separators before matching', () => {
    expect(usernameBlocklistError('FUCK')).toBe('That username is not allowed.');
    expect(usernameBlocklistError('sh1thead')).toBe('That username is not allowed.');
    expect(usernameBlocklistError('CacheHunter')).toBeNull();
    expect(usernameBlocklistError('')).toBeNull();
    expect(usernameBlocklistError(null)).toBeNull();
  });
});
