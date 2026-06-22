import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.VITE_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) {
    throw new Error('Missing Supabase service-role configuration');
  }
  _supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _supabase;
}

export const NPC_MARKET_USER_ID =
  process.env.NPC_MARKET_USER_ID || '00000000-0000-0000-0000-000000000000';
