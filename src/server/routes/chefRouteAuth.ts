import type { Request, Response } from 'express';
import { verifyAccessToken } from '../auth/tokens';
import type { AuthConfig } from '../auth/routes';

export class ChefRouteError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Player identity for the legacy Chef gameplay routes.
 *
 * June shape, Route B credentials: the June handlers resolved the
 * caller from a Supabase-issued bearer token; since B1 the Chef issues
 * its own access tokens, and these routes verify those instead. The
 * contract is unchanged — token from the Authorization header or the
 * request body's `jwt` field, a body `playerId` that disagrees with
 * the token is a 403, and identity only ever comes from the verified
 * token, never from the request body. Verification is stateless: no
 * client object is constructed per request and nothing is cached
 * between requests.
 */
export function getAuthenticatedChefPlayer(
  config: AuthConfig,
  req: Request,
  bodyJwt?: string,
  claimedPlayerId?: string,
): string {
  const header = req.header('authorization') ?? req.header('Authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  const token = bearer || (typeof bodyJwt === 'string' ? bodyJwt.trim() : '');

  if (!token) {
    throw new ChefRouteError(401, 'Authentication required', 'Missing bearer token');
  }

  const verified = verifyAccessToken(config.jwtSecret, token);
  if (!verified.ok) {
    throw new ChefRouteError(401, 'Authentication required', verified.error);
  }

  const playerId = verified.claims.sub;
  if (claimedPlayerId && claimedPlayerId !== playerId) {
    throw new ChefRouteError(
      403,
      'Player mismatch',
      'Request playerId does not match the authenticated user',
    );
  }

  return playerId;
}

export function sendRouteError(res: Response, fallback: string, err: unknown): void {
  if (err instanceof ChefRouteError) {
    res.status(err.status).json({ error: err.message, detail: err.detail });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: fallback, detail: message });
}
