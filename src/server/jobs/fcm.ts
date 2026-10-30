/**
 * FCM push sender (Route B, slice B5) — the Chef port of the Supabase Edge
 * Function `supabase/functions/send-test-push`.
 *
 * June behavior, preserved: a Google service-account credential comes from
 * the FIREBASE_ADMIN_JSON env var (never from source), an OAuth2 access
 * token is minted with a signed JWT bearer grant, and each message is
 * posted to the FCM v1 API. When FIREBASE_ADMIN_JSON is unset or invalid,
 * `fcmSenderFromEnv` returns null and callers no-op safely — a Chef
 * instance without push credentials simply does not send.
 *
 * The HTTP layer is injectable (same pattern as the B1.5 Google verifier)
 * so tests exercise the full flow without network access.
 */
import { createSign } from 'node:crypto';

export interface FirebaseAdminConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

export type FetchFn = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: FetchFn = async (url, init) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, json: () => res.json().catch(() => ({})) };
};

/** Parse FIREBASE_ADMIN_JSON; returns null when unset or malformed. */
export function parseFirebaseAdminConfig(raw: string | undefined): FirebaseAdminConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projectId = parsed.project_id;
    const clientEmail = parsed.client_email;
    const privateKey = parsed.private_key;
    if (typeof projectId !== 'string' || !projectId) return null;
    if (typeof clientEmail !== 'string' || !clientEmail) return null;
    if (typeof privateKey !== 'string' || !privateKey) return null;
    const tokenUri = typeof parsed.token_uri === 'string' && parsed.token_uri
      ? parsed.token_uri
      : 'https://oauth2.googleapis.com/token';
    return { projectId, clientEmail, privateKey, tokenUri };
  } catch {
    return null;
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export interface FcmSendResult {
  ok: boolean;
  response?: unknown;
  error?: string;
}

export interface FcmSender {
  readonly projectId: string;
  sendToDevice(token: string, title: string, body: string): Promise<FcmSendResult>;
}

export function createFcmSender(config: FirebaseAdminConfig, fetcher: FetchFn = defaultFetch): FcmSender {
  let cached: { token: string; expiresAtMs: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAtMs > Date.now() + 30_000) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claimSet = {
      iss: config.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: config.tokenUri,
      iat: now,
      exp: now + 3600,
    };
    const unsigned = `${base64UrlJson(header)}.${base64UrlJson(claimSet)}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    const signature = signer.sign(config.privateKey).toString('base64url');
    const assertion = `${unsigned}.${signature}`;

    const res = await fetcher(config.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    const payload = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !payload.access_token) {
      throw new Error(payload.error_description ?? payload.error ?? 'Unable to get Firebase access token');
    }
    cached = { token: payload.access_token, expiresAtMs: Date.now() + 55 * 60_000 };
    return payload.access_token;
  }

  return {
    projectId: config.projectId,
    async sendToDevice(token: string, title: string, body: string): Promise<FcmSendResult> {
      const access = await accessToken();
      const res = await fetcher(`https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${access}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data: {
              category: 'system',
              source: 'send-test-push',
            },
            android: {
              priority: 'HIGH',
              notification: {
                channel_id: 'cybercache_system',
              },
            },
          },
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: JSON.stringify(payload) };
      return { ok: true, response: payload };
    },
  };
}

/** Build a sender from the environment; null when push is not configured. */
export function fcmSenderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: FetchFn = defaultFetch,
): FcmSender | null {
  const config = parseFirebaseAdminConfig(env.FIREBASE_ADMIN_JSON);
  if (!config) return null;
  return createFcmSender(config, fetcher);
}

/** The Edge Function's text hygiene: trim, collapse whitespace, cap length. */
export function cleanPushText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}
