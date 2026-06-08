export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseConfig(env: ImportMetaEnv = import.meta.env): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  return { url, anonKey };
}

export function requireSupabaseConfig(env: ImportMetaEnv = import.meta.env): SupabaseConfig {
  const config = getSupabaseConfig(env);
  if (!config) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  }
  return config;
}
