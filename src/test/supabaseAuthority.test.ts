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
    'public.cc_record_player_snapshot(uuid, text, jsonb)',
    'public.cc_record_daily_heartbeats()',
    'public.cc_compute_player_snapshot(uuid)',
  ])('%s is not executable by authenticated clients after all migrations', (signature) => {
    expect(lastAuthenticatedGrantAction(signature)).toMatch(/:revoke$/);
  });

  it('player_public_stats view is granted select to authenticated only', () => {
    const grants = orderedMigrations
      .flatMap((m) => Array.from(m.sql.matchAll(/grant\s+select\s+on\s+public\.player_public_stats\s+to\s+([^;]+)/gi)))
      .map((m) => m[1]);
    expect(grants.length).toBeGreaterThan(0);
    const lastGrant = grants[grants.length - 1];
    expect(lastGrant).toMatch(/authenticated/);
    expect(lastGrant).not.toMatch(/anon|public/);
  });

  it('player_progression_snapshots table is readable but not writable by authenticated clients', () => {
    const selectGrants = orderedMigrations
      .flatMap((m) => Array.from(m.sql.matchAll(/grant\s+select\s+on\s+public\.player_progression_snapshots\s+to\s+([^;]+)/gi)))
      .map((m) => m[1]);
    expect(selectGrants.length).toBeGreaterThan(0);
    const lastSelect = selectGrants[selectGrants.length - 1];
    expect(lastSelect).toMatch(/authenticated/);
    expect(lastSelect).not.toMatch(/anon|public/);

    const insertGrants = orderedMigrations
      .flatMap((m) => Array.from(m.sql.matchAll(/grant\s+insert\s+on\s+public\.player_progression_snapshots\s+to\s+([^;]+)/gi)))
      .map((m) => m[1]);
    const lastInsert = insertGrants.length > 0 ? insertGrants[insertGrants.length - 1] : '';
    expect(lastInsert).not.toMatch(/authenticated|anon|public/);
  });

  it.each([
    'public.cc_my_stats_summary()',
    'public.cc_public_stats(uuid)',
    'public.cc_is_username_available(text)',
    'public.cc_set_username(text)',
    'public.cc_my_profile_summary()',
    'public.cc_get_leaderboard(text, text, int)',
    'public.cc_get_my_leaderboard_rank(text, text)',
    'public.cc_get_public_profile(uuid)',
  ])('%s is granted to authenticated clients after all migrations', (signature) => {
    expect(lastAuthenticatedGrantAction(signature)).toMatch(/:grant$/);
  });

  it.each([
    'public.cc_validate_username(text)',
    'public.cc_generate_guest_username(uuid)',
  ])('%s is revoked from authenticated clients after all migrations', (signature) => {
    expect(lastAuthenticatedGrantAction(signature)).toMatch(/:revoke$/);
  });

  it('public profile RPC does not expose credits or scrap', () => {
    const allSql = orderedMigrations.map((m) => m.sql).join('\n');
    const match = allSql.match(/create\s+or\s+replace\s+function\s+public\.cc_get_public_profile[\s\S]*?as\s+\$\$[\s\S]*?\$\$/i);
    expect(match).toBeTruthy();
    const body = match![0].toLowerCase();
    expect(body).not.toContain('credits');
    expect(body).not.toContain('scrap');
  });
});
