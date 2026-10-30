/**
 * Chef HTTP transport (Route B, slice B4).
 *
 * The one fetch wrapper every api service goes through:
 * - Attaches the Chef access token from the session store.
 * - On 401, rotates the session once via /api/auth/refresh and retries
 *   the request once with the new token. If the refresh is rejected the
 *   session is already cleared (signed-out state) and the 401 surfaces.
 * - Maps the Chef error envelope ({ error: code, message }) onto
 *   ApiError with a stable `code` + HTTP `status`, so services keep the
 *   error semantics they had with Supabase errors ({ message, code }).
 * - Network failures become a readable ApiError — raw fetch errors
 *   ("Failed to fetch") must never reach the UI (visual-audit A1).
 */
import { apiUrl } from './config';
import { getAccessTokenSync, refreshSession } from './session';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Check your connection and try again.';

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  /** Attach the session access token and enable the 401 refresh-retry. Default true. */
  auth?: boolean;
}

async function rawRequest<T>(path: string, options: ApiRequestOptions, accessToken: string | null): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'network', NETWORK_ERROR_MESSAGE);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? safeJson(text) : null;

  if (!response.ok) {
    const envelope = (parsed ?? {}) as { error?: string; message?: string };
    throw new ApiError(
      response.status,
      envelope.error ?? 'http_error',
      envelope.message ?? `Request failed (${response.status}).`,
    );
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const auth = options.auth ?? true;
  const token = auth ? getAccessTokenSync() : null;
  try {
    return await rawRequest<T>(path, options, token);
  } catch (error) {
    if (auth && error instanceof ApiError && error.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) {
        return rawRequest<T>(path, options, refreshed.accessToken);
      }
    }
    throw error;
  }
}
