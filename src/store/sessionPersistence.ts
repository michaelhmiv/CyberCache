export async function switchAccountStorageScope(_userId: string | null | undefined): Promise<void> {
  // Runtime state is hydrated from Supabase in AuthProvider.
}

export async function clearCurrentAccountStorage(): Promise<void> {
  // Browser save data is intentionally unused; Supabase is the runtime source of truth.
}
