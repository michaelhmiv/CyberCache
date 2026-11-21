/**
 * Chef auth routes (Route B, slice B1) — mounted at /api/auth/*.
 *
 * Identity only: guest sessions, email/password register + login (register
 * upgrades a guest session in place when called with its bearer token),
 * rotating refresh, logout, and /me. Game data routes keep using the
 * existing Supabase path until slices B2–B4 move them onto this identity;
 * nothing here changes current gameplay traffic.
 *
 * Responses never echo raw store errors; codes are stable for the client.
 */
import type { Express, Request, Response } from 'express';
import { AuthStoreError, type AuthStore, type Session } from './store';
import { issueAccessToken, verifyAccessToken } from './tokens';
import { GoogleTokenError, verifyGoogleIdToken, type JwksFetcher } from './google';
import { AppleTokenError, verifyAppleIdToken, type AppleJwksFetcher } from './apple';

export interface AuthConfig {
  jwtSecret: string;
  /** OAuth client ids accepted as Google ID-token audiences. Empty = Google route off. */
  googleClientIds?: string[];
  /** Injectable for tests; defaults to Google's live JWKS endpoint. */
  googleJwksFetcher?: JwksFetcher;
  /** Audiences accepted for Apple identity tokens (the iOS bundle id, plus any Services ids). Empty = Apple route off. */
  appleClientIds?: string[];
  /** Injectable for tests; defaults to Apple's live JWKS endpoint. */
  appleJwksFetcher?: AppleJwksFetcher;
  /** Override rate limit thresholds (or set 0 to disable in focused tests). */
  rateLimitPerMinute?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_REPORT_CONTEXTS = new Set(['leaderboard', 'profile', 'market']);

function sanitizeLogToken(value: unknown): string {
  const raw = String(value ?? '').slice(0, 120);
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    out += code < 0x20 || code === 0x7f ? ' ' : raw[i];
  }
  return out;
}

function createIpLimiter(maxPerMinute: number) {
  const buckets = new Map<string, number[]>();
  const windowMs = 60_000;
  return (req: Request, res: Response, keySuffix: string): boolean => {
    if (maxPerMinute <= 0) return true;
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${ip}:${keySuffix}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    const prev = (buckets.get(key) ?? []).filter((ts) => ts > cutoff);
    if (prev.length >= maxPerMinute) {
      res.status(429).json({ error: 'rate_limited', message: 'Too many requests — please wait a moment and try again.' });
      return false;
    }
    prev.push(now);
    buckets.set(key, prev);
    if (buckets.size > 5000) {
      for (const [k, v] of buckets.entries()) {
        if (v.every((ts) => ts <= cutoff)) buckets.delete(k);
      }
    }
    return true;
  };
}

function sessionBody(secret: string, session: Session) {
  return {
    accessToken: issueAccessToken(secret, session.account.id, session.account.isGuest),
    refreshToken: session.refreshToken,
    refreshExpiresAt: session.refreshExpiresAt.toISOString(),
    account: {
      id: session.account.id,
      email: session.account.email,
      isGuest: session.account.isGuest,
      emailVerified: session.account.emailVerifiedAt !== null,
    },
  };
}

function statusFor(code: AuthStoreError['code']): number {
  switch (code) {
    case 'email_taken': return 409;
    case 'identity_link_conflict': return 409;
    case 'invalid_credentials': return 401;
    case 'invalid_refresh': return 401;
    case 'refresh_reuse': return 401;
    case 'not_guest': return 409;
    case 'validation': return 400;
  }
}

function fail(res: Response, err: unknown): void {
  if (err instanceof AuthStoreError) {
    res.status(statusFor(err.code)).json({ error: err.code, message: err.message });
    return;
  }
  console.error('[chef-auth] unexpected error', err);
  res.status(500).json({ error: 'internal', message: 'Something went wrong' });
}

function bearer(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length).trim();
  }
  return undefined;
}

/** Resolve a Chef access token to an account id, or null. For new routes. */
export function chefPlayerId(config: AuthConfig, req: Request): string | null {
  const token = bearer(req);
  if (!token) return null;
  const result = verifyAccessToken(config.jwtSecret, token);
  return result.ok ? result.claims.sub : null;
}

export function mountAuthRoutes(app: Express, store: AuthStore, config: AuthConfig): void {
  const checkLimit = createIpLimiter(config.rateLimitPerMinute ?? 60);

  app.post('/api/auth/guest', async (req, res) => {
    if (!checkLimit(req, res, 'guest')) return;
    try {
      res.status(201).json(sessionBody(config.jwtSecret, await store.createGuest(new Date())));
    } catch (err) { fail(res, err); }
  });

  app.post('/api/auth/register', async (req, res) => {
    if (!checkLimit(req, res, 'register')) return;
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'validation', message: 'Email and password are required' });
        return;
      }
      // A guest upgrading keeps its account id, inventory, and progress.
      const upgradeId = chefPlayerId(config, req) ?? undefined;
      const session = await store.register(email, password, new Date(), upgradeId);
      res.status(201).json(sessionBody(config.jwtSecret, session));
    } catch (err) { fail(res, err); }
  });

  app.post('/api/auth/login', async (req, res) => {
    if (!checkLimit(req, res, 'login')) return;
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'validation', message: 'Email and password are required' });
        return;
      }
      res.json(sessionBody(config.jwtSecret, await store.login(email, password, new Date())));
    } catch (err) { fail(res, err); }
  });

  app.post('/api/auth/refresh', async (req, res) => {
    if (!checkLimit(req, res, 'refresh')) return;
    try {
      const { refreshToken } = req.body ?? {};
      if (typeof refreshToken !== 'string') {
        res.status(400).json({ error: 'validation', message: 'A refresh token is required' });
        return;
      }
      res.json(sessionBody(config.jwtSecret, await store.refresh(refreshToken, new Date())));
    } catch (err) { fail(res, err); }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const { refreshToken } = req.body ?? {};
      if (typeof refreshToken === 'string') await store.logout(refreshToken);
      res.status(204).end();
    } catch (err) { fail(res, err); }
  });

  // Build 7 — Apple Guideline 5.1.1(v) in-app account deletion.
  // Identity comes strictly from the verified Chef JWT — never the body.
  app.post('/api/account/delete', async (req, res) => {
    const id = chefPlayerId(config, req);
    if (!id) {
      res.status(401).json({ error: 'unauthorized', message: 'A valid Chef access token is required' });
      return;
    }
    try {
      const deleted = await store.deleteAccount(id);
      if (!deleted) {
        res.status(404).json({ error: 'not_found', message: 'Account not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // Build 7 — Apple Guideline 1.2 player reporting.
  // Reporter comes strictly from the verified Chef JWT; self-reports rejected;
  // duplicates within 24h fold server-side.
  app.post('/api/reports', async (req, res) => {
    const id = chefPlayerId(config, req);
    if (!id) {
      res.status(401).json({ error: 'unauthorized', message: 'A valid Chef access token is required' });
      return;
    }
    if (!checkLimit(req, res, 'reports')) return;
    try {
      const { reportedAccountId, context } = req.body ?? {};
      if (typeof reportedAccountId !== 'string' || !UUID_RE.test(reportedAccountId)) {
        res.status(400).json({ error: 'validation', message: 'A valid reportedAccountId is required' });
        return;
      }
      const cleanContext = typeof context === 'string' && ALLOWED_REPORT_CONTEXTS.has(context)
        ? context
        : 'leaderboard';
      const result = await store.createReport(id, reportedAccountId, cleanContext, new Date());
      res.json(result);
    } catch (err) { fail(res, err); }
  });

  if (config.googleClientIds && config.googleClientIds.length > 0) {
    const googleClientIds = config.googleClientIds;
    app.post('/api/auth/google', async (req, res) => {
      const { idToken } = req.body ?? {};
      try {
        if (typeof idToken !== 'string') {
          res.status(400).json({ error: 'validation', message: 'A Google ID token is required' });
          return;
        }
        const identity = await verifyGoogleIdToken(idToken, googleClientIds, config.googleJwksFetcher);
        const linkId = chefPlayerId(config, req) ?? undefined;
        const session = await store.loginWithIdentity('google', identity, new Date(), linkId);
        res.json(sessionBody(config.jwtSecret, session));
      } catch (err) {
        if (err instanceof GoogleTokenError) {
          let claims = 'unparseable';
          try {
            const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')) as { aud?: unknown; iss?: unknown };
            claims = `aud=${sanitizeLogToken(payload?.aud)} iss=${sanitizeLogToken(payload?.iss)}`;
          } catch { /* keep 'unparseable' */ }
          console.warn(`[chef-auth] google sign-in rejected: ${sanitizeLogToken(err.reason)} (${claims})`);
          res.status(401).json({ error: 'invalid_google_token', message: 'Google sign-in could not be verified' });
          return;
        }
        fail(res, err);
      }
    });
  }

  if (config.appleClientIds && config.appleClientIds.length > 0) {
    const appleClientIds = config.appleClientIds;
    app.post('/api/auth/apple', async (req, res) => {
      const { idToken } = req.body ?? {};
      try {
        if (typeof idToken !== 'string') {
          res.status(400).json({ error: 'validation', message: 'An Apple identity token is required' });
          return;
        }
        const identity = await verifyAppleIdToken(idToken, appleClientIds, config.appleJwksFetcher);
        const linkId = chefPlayerId(config, req) ?? undefined;
        const session = await store.loginWithIdentity('apple', identity, new Date(), linkId);
        res.json(sessionBody(config.jwtSecret, session));
      } catch (err) {
        if (err instanceof AppleTokenError) {
          let claims = 'unparseable';
          try {
            const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')) as { aud?: unknown; iss?: unknown };
            claims = `aud=${sanitizeLogToken(payload?.aud)} iss=${sanitizeLogToken(payload?.iss)}`;
          } catch { /* keep 'unparseable' */ }
          console.warn(`[chef-auth] apple sign-in rejected: ${sanitizeLogToken(err.reason)} (${claims})`);
          res.status(401).json({ error: 'invalid_apple_token', message: 'Apple sign-in could not be verified' });
          return;
        }
        fail(res, err);
      }
    });
  }

  app.get('/api/auth/me', async (req, res) => {
    const id = chefPlayerId(config, req);
    if (!id) {
      res.status(401).json({ error: 'unauthorized', message: 'A valid Chef access token is required' });
      return;
    }
    try {
      const account = await store.getAccount(id);
      if (!account) {
        res.status(401).json({ error: 'unauthorized', message: 'Account no longer exists' });
        return;
      }
      res.json({
        account: {
          id: account.id, email: account.email, isGuest: account.isGuest,
          emailVerified: account.emailVerifiedAt !== null, createdAt: account.createdAt.toISOString(),
        },
      });
    } catch (err) { fail(res, err); }
  });
}
