import { createClient } from '@supabase/supabase-js';
import { requireSupabaseConfig } from './config';

const config = requireSupabaseConfig();

export const supabase = createClient(config.url, config.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
