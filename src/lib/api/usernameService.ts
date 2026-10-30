/**
 * Username service (Route B, slice B4) — transport swap onto the Chef
 * routes. Same signatures and error semantics as the Supabase version:
 * availability/summary failures degrade quietly; setUsername reports
 * validation as data ({ ok: false, error }), exactly like the RPC.
 */
import { apiRequest } from './http';

export interface SetUsernameResult {
  ok: boolean;
  error?: string;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  try {
    const data = await apiRequest<{ username: string; available: boolean }>(
      `/usernames/availability?username=${encodeURIComponent(username.trim())}`,
    );
    return Boolean(data?.available);
  } catch (error) {
    console.error('isUsernameAvailable failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

export async function setUsername(username: string): Promise<SetUsernameResult> {
  try {
    const data = await apiRequest<SetUsernameResult>('/profile/set-username', {
      method: 'POST',
      body: { username: username.trim() },
    });
    return data ?? { ok: false, error: 'Unknown error.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    console.error('setUsername failed:', message);
    return { ok: false, error: message };
  }
}

export interface ProfileSummary {
  user_id: string;
  username: string | null;
  display_name: string | null;
  account_type: string;
  has_username: boolean;
  username_updated_at: string | null;
  can_rename_at: string | null;
}

export async function getMyProfileSummary(): Promise<ProfileSummary | null> {
  try {
    return (await apiRequest<ProfileSummary | null>('/profile/summary')) ?? null;
  } catch (error) {
    console.error('getMyProfileSummary failed:', error instanceof Error ? error.message : error);
    return null;
  }
}
