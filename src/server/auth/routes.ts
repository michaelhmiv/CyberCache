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

export interface AuthConfig {
  jwtSecret: string;
  /** OAuth client ids accepted as Google ID-token audiences. Empty = Google route off. */
  googleClientIds?: string[];
  /** Injectable for tests; defaults to Google's live JWKS endpoint. */
  googleJwksFetcher?: JwksFetcher;
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
  app.post('/api/auth/guest', async (_req, res) => {
    try {
      res.status(201).json(sessionBody(config.jwtSecret, await store.createGuest(new Date())));
    } catch (err) { fail(res, err); }
  });

  app.post('/api/auth/register', async (req, res) => {
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

  if (config.googleClientIds && config.googleClientIds.length > 0) {
    app.post('/api/auth/google', async (req, res) => {
      try {
        const { idToken } = req.body ?? {};
        if (typeof idToken !== 'string') {
          res.status(400).json({ error: 'validation', message: 'A Google ID token is required' });
          return;
        }
        const identity = await verifyGoogleIdToken(idToken, config.googleClientIds, config.googleJwksFetcher);
        // Signed-in callers (e.g. a guest session) link the identity to
        // their existing account; anonymous callers get find-or-create.
        const linkId = chefPlayerId(config, req) ?? undefined;
        const session = await store.loginWithIdentity('google', identity, new Date(), linkId);
        res.json(sessionBody(config.jwtSecret, session));
      } catch (err) {
        if (err instanceof GoogleTokenError) {
          res.status(401).json({ error: 'invalid_google_token', message: 'Google sign-in could not be verified' });
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
  });
}
