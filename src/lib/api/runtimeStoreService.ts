/**
 * Runtime snapshot service (Route B, slice B4) — transport swap onto
 * the Chef snapshot routes (GET/PUT/DELETE /api/runtime/snapshot),
 * which treat the row as one unit, as the B3 port designed. The GET
 * route returns the snapshot document itself (or null), where
 * PostgREST returned a row wrapping it — the service contract
 * (snapshot | null) is unchanged. userId arguments are retained for
 * call-site compatibility; identity is the Chef JWT.
 */
import { apiRequest } from './http';

export type RuntimeStoreSnapshot = Record<string, unknown>;

export async function getRuntimeStoreSnapshot(_userId: string): Promise<RuntimeStoreSnapshot | null> {
  const data = await apiRequest<RuntimeStoreSnapshot | null>('/runtime/snapshot');
  return data ?? null;
}

export async function saveRuntimeStoreSnapshot(_userId: string, snapshot: RuntimeStoreSnapshot): Promise<void> {
  await apiRequest('/runtime/snapshot', { method: 'PUT', body: { snapshot } });
}

export async function clearRuntimeStoreSnapshot(_userId: string): Promise<void> {
  await apiRequest('/runtime/snapshot', { method: 'DELETE' });
}
