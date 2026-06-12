import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
const orderedMigrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => ({
    file,
    sql: readFileSync(resolve(migrationsDir, file), 'utf8'),
  }));

function lastAuthenticatedGrantAction(signature: string): string | null {
  const pattern = new RegExp(`\\b(revoke|grant)\\s+execute\\s+on\\s+function\\s+${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+[^;]*\\bauthenticated\\b`, 'gi');
  let last: string | null = null;

  for (const migration of orderedMigrations) {
    for (const match of migration.sql.matchAll(pattern)) {
      last = `${migration.file}:${match[1].toLowerCase()}`;
    }
  }

  return last;
}

describe('Supabase authority grants', () => {
  it.each([
    'public.cc_apply_chef_rewards(uuid, bigint, bigint, bigint, integer, jsonb, jsonb, integer, bigint, text)',
    'public.cc_increment_pity(uuid, text)',
    'public.cc_add_stat(uuid, text, bigint)',
    'public.cc_set_stat(uuid, text, bigint)',
    'public.cc_add_mastery_xp(uuid, text, bigint)',
    'public.cc_set_mastery_xp(uuid, text, bigint)',
  ])('%s is not executable by authenticated clients after all migrations', (signature) => {
    expect(lastAuthenticatedGrantAction(signature)).toMatch(/:revoke$/);
  });
});
