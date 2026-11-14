/**
 * Lane 1 fixture: local Postgres lifecycle for the e2e-browser gate.
 *
 * The repo ships 92 SQL migrations under db/migrations and no runner
 * (production applies them via the migration-drill pattern). This
 * fixture productises that pattern for CI:
 *
 *   node scripts/e2e/fixture.mjs apply-migrations
 *     Applies every db/migrations/*.sql in filename order against
 *     $E2E_DATABASE_URL (fallback $DATABASE_URL), recording applied
 *     files in public.e2e_applied_migrations so re-runs are no-ops.
 *
 *   node scripts/e2e/fixture.mjs seed-xp <accountId> <targetLevel>
 *     Best-effort durability seed for the boss case: lifts an account
 *     to a target level using the game's own cc_apply_xp curve
 *     function so the fixture never invents progression math. Prints
 *     the resulting level; the caller decides whether it is required.
 *
 * SAFETY: this tool refuses to run against any database whose host is
 * not loopback or whose name does not contain "e2e". It exists to
 * serve a throwaway CI database and must never be pointed at staging
 * or production.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export function fixtureDatabaseUrl() {
  return process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
}

export function assertFixtureUrl(url) {
  if (!url) throw new Error('E2E_DATABASE_URL (or DATABASE_URL) is not set');
  const parsed = new URL(url);
  const host = parsed.hostname;
  const dbName = parsed.pathname.replace(/^\//, '');
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!loopback) {
    throw new Error(`fixture refuses non-loopback database host: ${host}`);
  }
  if (!/e2e/i.test(dbName)) {
    throw new Error(`fixture refuses database not named for e2e: ${dbName}`);
  }
  return url;
}

export async function withPool(fn) {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: assertFixtureUrl(fixtureDatabaseUrl()) });
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function applyMigrations(pool) {
  const dir = path.join(ROOT, 'db', 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) throw new Error(`no migrations found in ${dir}`);
  await pool.query(
    `create table if not exists public.e2e_applied_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`,
  );
  const done = new Set(
    (await pool.query('select name from public.e2e_applied_migrations')).rows.map((r) => r.name),
  );
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await pool.query(sql);
    await pool.query('insert into public.e2e_applied_migrations (name) values ($1)', [file]);
    applied++;
    console.log(`[fixture] applied ${file}`);
  }
  console.log(`[fixture] migrations current: ${files.length} files, ${applied} newly applied`);
  return files.length;
}

/**
 * Unlock bosses on an account by merging ids into the profile's
 * boss_state (the same record the client's verified-state sync
 * reads). The boss case needs a DURABLE opponent: the default
 * first boss (800 HP) dies to the seeded hunter before its cadence
 * special can present, so the case unlocks the region and picks
 * the tankiest affordable boss from the picker itself.
 */
export async function seedBossUnlocks(pool, accountId, bossIds) {
  await pool.query(
    `update public.profiles
        set boss_state = coalesce(boss_state, '{}'::jsonb) || jsonb_build_object('unlockedBossIds', $1::jsonb)
      where id = $2`,
    [JSON.stringify(bossIds), accountId],
  );
  return bossIds.length;
}

/**
 * Lift an account to `targetLevel` using the game's own XP curve
 * function (cc_apply_xp, migration 0004). Returns the level actually
 * reached, or null when the account/columns cannot be resolved — the
 * caller treats the seed as best-effort calibration tooling and logs
 * loudly either way.
 */
export async function seedAccountLevel(pool, accountId, targetLevel) {
  const cols = (
    await pool.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'`,
    )
  ).rows.map((r) => r.column_name);
  // The shipped profiles table names them player_level / player_xp
  // (the seed's first candidate names never existed — calibration
  // round 4's job log shows the resolver failing on the real column
  // list, so the boss durability seed silently never ran).
  const levelCol = cols.includes('player_level') ? 'player_level' : cols.includes('level') ? 'level' : null;
  const xpCol = cols.includes('player_xp') ? 'player_xp' : cols.includes('total_xp') ? 'total_xp' : cols.includes('xp') ? 'xp' : null;
  if (!levelCol || !xpCol) {
    console.log(`[fixture] seed-xp: profiles columns not resolvable (have: ${cols.join(', ')})`);
    return null;
  }
  const current = (
    await pool.query(`select ${levelCol} as level, ${xpCol} as xp from public.profiles where id = $1`, [accountId])
  ).rows[0];
  if (!current) {
    console.log(`[fixture] seed-xp: no profile row for ${accountId}`);
    return null;
  }
  if (Number(current.level) >= targetLevel) return Number(current.level);
  // Walk the game's own curve: award XP in chunks until the target
  // level is reached or the curve stops moving. cc_apply_xp returns
  // jsonb {player_level, player_xp} (migration 0004) and treats xp
  // as progress within the current level — the same contract its
  // gameplay callers use, so reading/writing the profile's level/xp
  // columns through it invents no progression math.
  let level = Number(current.level);
  let xp = Number(current.xp);
  for (let guard = 0; guard < 64 && level < targetLevel; guard++) {
    const award = 250_000;
    const result = (
      await pool.query('select public.cc_apply_xp($1, $2, $3) as result', [level, xp, award])
    ).rows[0]?.result;
    const nextLevel = Number(result?.player_level ?? level);
    const nextXp = Number(result?.player_xp ?? xp);
    if (nextLevel === level && nextXp === xp) break;
    level = nextLevel;
    xp = nextXp;
  }
  if (level <= Number(current.level)) {
    console.log(`[fixture] seed-xp: curve walk did not advance (stuck at ${level})`);
    return null;
  }
  await pool.query(`update public.profiles set ${levelCol} = $1, ${xpCol} = $2 where id = $3`, [
    level,
    xp,
    accountId,
  ]);
  console.log(`[fixture] seed-xp: account ${accountId} level ${current.level} -> ${level}`);
  return level;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'apply-migrations') {
    await withPool(applyMigrations);
    return;
  }
  if (command === 'seed-xp') {
    const [accountId, target] = args;
    const level = await withPool((pool) => seedAccountLevel(pool, accountId, Number(target ?? 40)));
    console.log(`[fixture] seed-xp result: ${level}`);
    return;
  }
  console.error('usage: fixture.mjs apply-migrations | seed-xp <accountId> <targetLevel>');
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error('[fixture] FAILED', error);
    process.exit(1);
  });
}
