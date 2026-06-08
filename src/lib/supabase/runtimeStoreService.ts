import { supabase } from './client';

export type RuntimeStoreSnapshot = Record<string, unknown>;

interface RuntimeSnapshotRow {
  snapshot: RuntimeStoreSnapshot;
}

export async function getRuntimeStoreSnapshot(userId: string): Promise<RuntimeStoreSnapshot | null> {
  const { data, error } = await supabase
    .from('player_runtime_snapshots')
    .select('snapshot')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return (data as RuntimeSnapshotRow | null)?.snapshot ?? null;
}

export async function saveRuntimeStoreSnapshot(userId: string, snapshot: RuntimeStoreSnapshot): Promise<void> {
  const { error } = await supabase
    .from('player_runtime_snapshots')
    .upsert(
      {
        user_id: userId,
        snapshot,
        schema_version: 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (error) throw error;
}

export async function clearRuntimeStoreSnapshot(userId: string): Promise<void> {
  const { error } = await supabase
    .from('player_runtime_snapshots')
    .delete()
    .eq('user_id', userId);

  if (error) throw error;
}
