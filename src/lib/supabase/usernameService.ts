import { supabase } from './client';

export interface SetUsernameResult {
  ok: boolean;
  error?: string;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cc_is_username_available', {
    _username: username.trim(),
  });
  if (error) {
    console.error('isUsernameAvailable failed:', error.message);
    return false;
  }
  return Boolean(data);
}

export async function setUsername(username: string): Promise<SetUsernameResult> {
  const { data, error } = await supabase.rpc('cc_set_username', {
    _username: username.trim(),
  });
  if (error) {
    console.error('setUsername failed:', error.message);
    return { ok: false, error: error.message };
  }
  return (data as SetUsernameResult) ?? { ok: false, error: 'Unknown error.' };
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
  const { data, error } = await supabase.rpc('cc_my_profile_summary');
  if (error) {
    console.error('getMyProfileSummary failed:', error.message);
    return null;
  }
  return (data as ProfileSummary) ?? null;
}
