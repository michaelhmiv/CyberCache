import { Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export class ChefRouteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

function supabaseConfig(): { url: string; key: string } {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.VITE_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('[chef] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return { url, key };
}

function createSupabaseClient(jwt?: string): SupabaseClient {
  const { url, key } = supabaseConfig();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: jwt
      ? {
          headers: {
            Authorization: `Bearer ${jwt}`,
          },
        }
      : undefined,
  });
}

export function getSupabase(): SupabaseClient {
  return createSupabaseClient();
}

function requestJwt(req: Request, bodyJwt?: string): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice('bearer '.length).trim();
  }
  return bodyJwt;
}

export async function getAuthenticatedSupabase(
  req: Request,
  bodyJwt?: string,
  claimedPlayerId?: string,
): Promise<{ playerId: string; supabase: SupabaseClient }> {
  const jwt = requestJwt(req, bodyJwt);
  if (!jwt) {
    throw new ChefRouteError(401, 'Authentication required', 'Missing bearer token');
  }

  const verifier = createSupabaseClient();
  const { data, error } = await verifier.auth.getUser(jwt);
  const authedPlayerId = data.user?.id;
  if (error || !authedPlayerId) {
    throw new ChefRouteError(401, 'Authentication required', error?.message ?? 'Invalid bearer token');
  }

  if (claimedPlayerId && claimedPlayerId !== authedPlayerId) {
    throw new ChefRouteError(403, 'Player mismatch', 'Request playerId does not match the authenticated user');
  }

  return { playerId: authedPlayerId, supabase: createSupabaseClient(jwt) };
}

export async function requireAuthenticatedPlayerId(
  supabase: SupabaseClient,
  req: Request,
  bodyJwt?: string,
  claimedPlayerId?: string,
): Promise<string> {
  const { playerId } = await getAuthenticatedSupabase(req, bodyJwt, claimedPlayerId);
  void supabase;
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
