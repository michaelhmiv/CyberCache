import { createClient } from 'npm:@supabase/supabase-js@2';

type FirebaseAdminJson = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type PushDevice = {
  token: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json({ error: 'missing_authorization' }, 401);

    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const serviceKey = getSupabaseServiceKey();
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userResult, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userResult.user) return json({ error: 'invalid_authorization' }, 401);

    const body = await readJson(req);
    const title = cleanText(body.title, 'CyberCache test push', 80);
    const message = cleanText(body.message, 'Push delivery is wired.', 180);

    const { data: devices, error: devicesError } = await admin
      .from('user_push_devices')
      .select('token')
      .eq('user_id', userResult.user.id)
      .eq('is_active', true);

    if (devicesError) throw devicesError;
    const tokens = ((devices ?? []) as PushDevice[]).map((device) => device.token).filter(Boolean);
    if (tokens.length === 0) return json({ ok: false, sent: 0, failed: 0, error: 'no_active_push_tokens' }, 404);

    const firebase = parseFirebaseAdminJson();
    const accessToken = await getFirebaseAccessToken(firebase);

    let sent = 0;
    let failed = 0;
    const failures: Array<{ tokenSuffix: string; error: string }> = [];

    for (const token of tokens) {
      const result = await sendFcmMessage(firebase.project_id, accessToken, token, title, message);
      if (result.ok) {
        sent += 1;
        await insertNotificationEvent(admin, userResult.user.id, token, title, message, 'sent', result.response);
      } else {
        failed += 1;
        failures.push({ tokenSuffix: token.slice(-8), error: result.error });
        await insertNotificationEvent(admin, userResult.user.id, token, title, message, 'failed', { error: result.error });
      }
    }

    return json({ ok: sent > 0, sent, failed, failures });
  } catch (error) {
    console.error('[send-test-push]', error);
    return json({ error: 'internal_error' }, 500);
  }
});

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const value = await req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function getSupabaseServiceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;

  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    const parsed = JSON.parse(secretKeys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }

  throw new Error('Missing Supabase service key');
}

function parseFirebaseAdminJson(): FirebaseAdminJson {
  const raw = requiredEnv('FIREBASE_ADMIN_JSON');
  const parsed = JSON.parse(raw) as FirebaseAdminJson;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('Invalid FIREBASE_ADMIN_JSON');
  }
  return parsed;
}

async function getFirebaseAccessToken(firebase: FirebaseAdminJson): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: firebase.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: firebase.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const unsignedJwt = `${base64UrlJson(header)}.${base64UrlJson(claimSet)}`;
  const key = await importPrivateKey(firebase.private_key);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(unsignedJwt),
  );
  const assertion = `${unsignedJwt}.${base64UrlBytes(new Uint8Array(signature))}`;

  const response = await fetch(firebase.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const payload = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? 'Unable to get Firebase access token');
  }

  return payload.access_token;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binary,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function base64UrlJson(value: unknown): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sendFcmMessage(
  projectId: string,
  accessToken: string,
  token: string,
  title: string,
  body: string,
): Promise<{ ok: true; response: unknown } | { ok: false; error: string }> {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
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

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: JSON.stringify(payload) };
  }
  return { ok: true, response: payload };
}

async function insertNotificationEvent(
  admin: ReturnType<typeof createClient>,
  userId: string,
  token: string,
  title: string,
  message: string,
  status: 'sent' | 'failed',
  payload: unknown,
) {
  await admin.from('notification_events').insert({
    user_id: userId,
    category: 'system',
    title,
    body: message,
    payload: {
      token_suffix: token.slice(-8),
      result: payload,
    },
    status,
    sent_at: status === 'sent' ? new Date().toISOString() : null,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json',
    },
  });
}
