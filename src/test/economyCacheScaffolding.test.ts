/**
 * Economy slice 2 (migration 0065) — cache scaffolding deletion
 * (economy redesign brief §10.1; owner ruling 8: DELETE).
 *
 *   - cc_draw_item was never defined: no CREATE FUNCTION for it
 *     exists in any migration, and no route or code path can write a
 *     verified_action_ledger row carrying that action_type (ledger
 *     action types are the literal names of the functions that
 *     insert them). The name survived only as a string inside the
 *     mastery trigger's cache-draws branch, the economy metrics
 *     fold's cache_opens filter, their InMemory twins, and the
 *     weekly leaderboard fold — copied forward by each restatement.
 *   - cache_second_drop / cache_third_drop (seeded by 0004) were
 *     never drawn: every cc_draw_odds call site in every migration
 *     names only boss_attempt_{aggressive,defensive,balanced},
 *     cache_primary_rarity, or slot_machine, and the InMemory
 *     cache twin filters outcomes to cache_primary_rarity alone.
 *   - The live open path is untouched by the slice: ChestScreen ->
 *     verifiedOps.makeItem -> cc_make_item (0037) makes exactly one
 *     draw, cc_draw_odds('cache_primary_rarity', cache_quality).
 *     Behavior coverage for opens lives in cacheLane.test.ts /
 *     cacheRank.test.ts; the pins below guard the deletion itself:
 *     the restated bodies are the chain-final bodies verbatim apart
 *     from the single dead-string line each, the deletes name
 *     exactly the two dead tables, and no live source file outside
 *     this test (the deletion's record, like the migration headers)
 *     mentions the dead names again.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const MIGRATION_0042 = read('db/migrations/0042_contracts_board.sql');
const MIGRATION_0049 = read('db/migrations/0049_slot_machine.sql');
const MIGRATION_0037 = read('db/migrations/0037_cache_lane.sql');
const MIGRATION_0065 = read('db/migrations/0065_cache_scaffolding_deletion.sql');

function sliceFn(sql: string, startMarker: string, endMarker: string): string {
  const start = sql.indexOf(startMarker);
  expect(start, `start marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(endMarker, start);
  expect(end, `end marker not found: ${endMarker}`).toBeGreaterThanOrEqual(0);
  return sql.slice(start, end + endMarker.length);
}

// ─── The live open path: one draw, primary table only ───────────

describe('0065 — the live cache path it must not disturb', () => {
  it("cc_make_item (0037) makes exactly one odds draw, of cache_primary_rarity", () => {
    const body = sliceFn(
      MIGRATION_0037,
      'CREATE OR REPLACE FUNCTION public.cc_make_item',
      '$function$;',
    );
    const draws = [...body.matchAll(/cc_draw_odds\(/g)];
    expect(draws).toHaveLength(1);
    expect(body).toContain("cc_draw_odds('cache_primary_rarity', cache_quality)");
  });
});

// ─── The deletes name exactly the two dead tables ───────────────

describe('0065 — odds table deletes', () => {
  it('deletes outcomes then tables, for exactly the two dead ids', () => {
    const deletes = [...MIGRATION_0065.matchAll(/delete from public\.(odds_outcomes|odds_tables)\s+where (?:table_id|id) in \(([^)]+)\)/g)];
    expect(deletes).toHaveLength(2);
    expect(deletes[0][1]).toBe('odds_outcomes');
    expect(deletes[1][1]).toBe('odds_tables');
    for (const d of deletes) {
      const ids = d[2].split(',').map((s) => s.trim().replaceAll("'", '')).sort();
      expect(ids).toEqual(['cache_second_drop', 'cache_third_drop']);
    }
  });

  it('restates neither cc_make_item nor cc_draw_odds', () => {
    expect(MIGRATION_0065).not.toContain('function public.cc_make_item');
    expect(MIGRATION_0065).not.toContain('function public.cc_draw_odds');
  });
});

// ─── Restatements: chain-final bodies verbatim, one line each ───

describe('0065 — restated folds differ by exactly the dead string', () => {
  it('cc_apply_mastery_for_verified_action is the 0042 body apart from the cache-draws branch', () => {
    const before = sliceFn(
      MIGRATION_0042,
      'CREATE OR REPLACE FUNCTION public.cc_apply_mastery_for_verified_action',
      '$function$;',
    );
    const after = sliceFn(
      MIGRATION_0065,
      'CREATE OR REPLACE FUNCTION public.cc_apply_mastery_for_verified_action',
      '$function$;',
    );
    expect(after).toContain("  if action = 'cc_make_item' then");
    expect(
      after.replace(
        "  if action = 'cc_make_item' then",
        "  if action in ('cc_make_item', 'cc_draw_item') then",
      ),
    ).toBe(before);
  });

  it('cc_compute_economy_metrics is the 0049 body apart from the cache_opens filter', () => {
    const before = sliceFn(
      MIGRATION_0049,
      'create or replace function public.cc_compute_economy_metrics',
      'end;$$;',
    );
    const after = sliceFn(
      MIGRATION_0065,
      'create or replace function public.cc_compute_economy_metrics',
      'end;$$;',
    );
    expect(after).toContain(
      "count(*) filter (where action_type = 'cc_make_item') as cache_opens,",
    );
    expect(
      after.replace(
        "count(*) filter (where action_type = 'cc_make_item') as cache_opens,",
        "count(*) filter (where action_type in ('cc_make_item', 'cc_draw_item')) as cache_opens,",
      ),
    ).toBe(before);
  });
});

// ─── The dead names are gone from live source ───────────────────

describe('0065 — no live source references the dead names', () => {
  const DEAD = ['cc_draw_item', 'cache_second_drop', 'cache_third_drop'];

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
    }
  }

  // The scan reads every source file — IO-bound by nature, so it
  // carries an explicit timeout instead of the 5s default.
  it('src/ is clean (this test file is the record, like the migration headers)', () => {
    const self = join(process.cwd(), 'src', 'test', 'economyCacheScaffolding.test.ts');
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), 'src'))) {
      if (file === self) continue;
      const text = readFileSync(file, 'utf8');
      for (const needle of DEAD) {
        if (text.includes(needle)) offenders.push(`${file}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000);

  it('docs/ECONOMY.md and wiki/Caches.md are clean', () => {
    for (const rel of ['docs/ECONOMY.md', 'wiki/Caches.md']) {
      const text = read(rel);
      for (const needle of DEAD) {
        expect(text, `${rel} still mentions ${needle}`).not.toContain(needle);
      }
    }
  });
});
