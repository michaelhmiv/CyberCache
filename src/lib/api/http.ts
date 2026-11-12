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
 * - Every request is bounded by API_REQUEST_TIMEOUT_MS (config.ts):
 *   a response that never arrives aborts and surfaces as a 'timeout'
 *   ApiError instead of a promise that never settles (the 2026-11-11
 *   decrypt hang: the cache overlay shook forever awaiting a stalled
 *   make-item / snapshot request).
 */
import { API_REQUEST_TIMEOUT_MS, apiUrl } from './config';
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
const TIMEOUT_ERROR_MESSAGE = 'The server took too long to respond. Try again.';

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  /** Attach the session access token and enable the 401 refresh-retry. Default true. */
  auth?: boolean;
  /** Per-request timeout override (tests, long reads). Default API_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

async function rawRequest<T>(path: string, options: ApiRequestOptions, accessToken: string | null): Promise<T> {
  // Bounded fetch: abort at the timeout ceiling so a stalled request
  // rejects (code 'timeout') instead of never settling. The timer
  // covers the body read too — a response that starts but never
  // finishes is the same hang from the caller's side.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? API_REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(apiUrl(path), {
        method: options.method ?? 'GET',
        headers: {
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });
    } catch {
      if (timedOut) throw new ApiError(0, 'timeout', TIMEOUT_ERROR_MESSAGE);
      throw new ApiError(0, 'network', NETWORK_ERROR_MESSAGE);
    }

    if (response.status === 204) return undefined as T;

    let text: string;
    try {
      text = await response.text();
    } catch {
      if (timedOut) throw new ApiError(0, 'timeout', TIMEOUT_ERROR_MESSAGE);
      throw new ApiError(0, 'network', NETWORK_ERROR_MESSAGE);
    }
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
  } finally {
    clearTimeout(timer);
  }
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
