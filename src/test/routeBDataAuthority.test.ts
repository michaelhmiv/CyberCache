/**
 * Route B data authority (replaces supabaseAuthority.test.ts in B6).
 *
 * The June suite asserted a PostgREST grant posture over the
 * supabase/migrations tree: Chef-internal functions revoked from the
 * `authenticated` role, public surfaces granted to it, and the public
 * profile RPC exposing no economy balances. Route B deletes the
 * premise: there is no PostgREST, no anon/authenticated role, and no
 * client-reachable database surface at all — the Chef (database owner)
 * is the only caller, and every route derives its actor from the
 * verified Chef JWT. This suite asserts that posture over the Route B
 * migration set (db/migrations):
 *
 *   - no migration grants or revokes anything for a client role;
 *   - no function body derives identity from auth.uid();
 *   - the Chef-internal appliers take the player id as an explicit
 *     parameter (the route-verified identity);
 *   - the public-profile projection the API returns carries no
 *     credits/scrap (the June property, enforced in the B2 read store).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationsDir = resolve(process.cwd(), 'db/migrations');
const orderedMigrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => ({
    file,
    sql: readFileSync(resolve(migrationsDir, file), 'utf8'),
  }));

const allSql = orderedMigrations.map((m) => m.sql).join('\n');

/** SQL with `--` comment lines removed (headers discuss history). */
const codeOnly = allSql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('Route B data authority', () => {
  it('grants nothing to client roles — there is no client database surface', () => {
    expect(codeOnly).not.toMatch(/\b(grant|revoke)\b[^;]*\b(authenticated|anon)\b/i);
    expect(codeOnly).not.toMatch(/\bgrant\b[^;]*\bto\s+public\b/i);
  });

  it('derives no identity from auth.uid() anywhere in the migration set', () => {
    expect(codeOnly).not.toContain('auth.uid()');
  });

  it.each([
    'cc_apply_chef_rewards',
    'cc_store_chef_items',
    'cc_apply_chef_boss_attempt',
    'cc_settle_offline_roaming',
    'cc_consume_roaming_consumables',
  ])('%s takes the route-verified player id as a parameter (0007)', (fn) => {
    const migration = readFileSync(resolve(migrationsDir, '0007_chef_gameplay_appliers.sql'), 'utf8');
    const pattern = new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?_player_id uuid`, 'i');
    expect(migration).toMatch(pattern);
  });

  it('public profile projection exposes no credits or scrap', () => {
    const readStore = readFileSync(resolve(process.cwd(), 'src/server/reads/store.ts'), 'utf8');
    const start = readStore.indexOf('function mapPublicProfile');
    const projection = readStore.slice(start, readStore.indexOf('}', start));
    expect(projection).not.toContain('credits');
    expect(projection).not.toContain('scrap');
  });
});
