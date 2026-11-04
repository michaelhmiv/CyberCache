/**
 * Slots removal (migration 0074) — Data Slots, the vendor's slot
 * machine (0049), is deleted end-to-end under the economy brief's
 * ruling 8 ("plus SLOTS REMOVED"). These pins guard the deletion
 * itself, in the economyCacheScaffolding.test.ts pattern:
 *
 *   - 0074 names exactly the drops/deletes the removal needs and
 *     keeps the history (ledger rows, metrics columns) untouched;
 *   - the restated cc_compute_economy_metrics is the chain head
 *     (0068) VERBATIM apart from the slot panel — the transform
 *     below is the exact recipe the migration was built with, so
 *     any future drift between the two bodies fails here;
 *   - no live source file (outside this test, the deletion's
 *     record — the same carve-out the migration headers carry)
 *     references the machine again: no content module, no panel,
 *     no routes, no ops, no sprite, no golden scenes, no wiki
 *     page-map entry.
 *
 * Player-state audit (0074 header): pulls settled atomically —
 * no escrow, no pending payout, no slots balance ever existed;
 * the dropped slot_pulls_* counter pair was the only per-player
 * state and carried no value, so nothing converts.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const MIGRATION_0068 = read('db/migrations/0068_dispatch_reroll.sql');
const MIGRATION_0074 = read('db/migrations/0074_slots_removal.sql');

function sliceFn(sql: string, startMarker: string): string {
  const start = sql.toLowerCase().indexOf(startMarker.toLowerCase());
  expect(start, `start marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('end;$$;', start);
  expect(end, 'function terminator not found').toBeGreaterThanOrEqual(0);
  return sql.slice(start, end + 'end;$$;'.length);
}

const METRICS_0068 = sliceFn(MIGRATION_0068, 'create or replace function public.cc_compute_economy_metrics');
const METRICS_0074 = sliceFn(MIGRATION_0074, 'create or replace function public.cc_compute_economy_metrics');

/** The exact panel-removal recipe 0074 was built with. */
function stripSlotPanel(body: string): string {
  let out = body;
  // The fold's slot fields (comment + seven fields).
  const foldStart = out.indexOf('    -- Data Slots (0049): pulls, wagered / paid credits, and the');
  expect(foldStart).toBeGreaterThanOrEqual(0);
  const foldEndMarker = 'as slot_fallbacks\n';
  const foldEnd = out.indexOf(foldEndMarker, foldStart);
  expect(foldEnd).toBeGreaterThanOrEqual(0);
  out = out.slice(0, foldStart) + out.slice(foldEnd + foldEndMarker.length);
  // The standing_orders field loses the comma the panel justified.
  out = out.replace(
    "count(*) filter (where action_type = 'cc_standing_order_weapon') as standing_orders,\n",
    "count(*) filter (where action_type = 'cc_standing_order_weapon') as standing_orders\n",
    );
  // Minted total: drop the slot term, close on contracts.
  out = out.replace('    + m.slot_credits_paid;\n', '');
  out = out.replace('    + m.minted_contracts\n', '    + m.minted_contracts;\n');
  // Destroyed total: drop the wagered term, keep the reroll sink.
  out = out.replace(
    '    + m.slot_wagered + m.destroyed_dispatch_rerolls;',
    '    + m.destroyed_dispatch_rerolls;',
  );
  // Insert column list.
  out = out.replace(
    `    slot_pulls, slot_credits_wagered, slot_credits_paid,
    slot_bundles_paid, slot_fragments_paid, slot_keys_paid,
    slot_fragment_fallbacks, credits_minted_slots, credits_destroyed_slots,
`,
    '',
  );
  // Values list.
  out = out.replace(
    `    m.slot_pulls::integer, m.slot_wagered, m.slot_credits_paid,
    m.slot_bundles::integer, m.slot_fragments, m.slot_keys::integer,
    m.slot_fallbacks::integer, m.slot_credits_paid,
    greatest(0, m.slot_wagered - m.slot_credits_paid),
`,
    '',
  );
  // Upsert assignments.
  out = out.replace(
    `    slot_pulls = excluded.slot_pulls,
    slot_credits_wagered = excluded.slot_credits_wagered,
    slot_credits_paid = excluded.slot_credits_paid,
    slot_bundles_paid = excluded.slot_bundles_paid,
    slot_fragments_paid = excluded.slot_fragments_paid,
    slot_keys_paid = excluded.slot_keys_paid,
    slot_fragment_fallbacks = excluded.slot_fragment_fallbacks,
    credits_minted_slots = excluded.credits_minted_slots,
    credits_destroyed_slots = excluded.credits_destroyed_slots,
`,
    '',
  );
  return out;
}

describe('0074 — the drops name exactly the machine', () => {
  it('drops both slot ops and nothing else', () => {
    const drops = [...MIGRATION_0074.matchAll(/drop function if exists public\.([a-z_0-9]+)/g)].map((m) => m[1]);
    expect(drops.sort()).toEqual(['cc_slot_bundle', 'cc_slot_pull']);
  });

  it('deletes exactly the slot_machine odds seed', () => {
    expect(MIGRATION_0074).toContain("delete from public.odds_outcomes where table_id = 'slot_machine';");
    expect(MIGRATION_0074).toContain("delete from public.odds_tables where id = 'slot_machine';");
  });

  it('drops the counter pair and deletes the four lever values', () => {
    expect(MIGRATION_0074).toContain('drop column if exists slot_pulls_day');
    expect(MIGRATION_0074).toContain('drop column if exists slot_pulls_count');
    for (const key of ['slotDailyPullCap', 'slotBetTier1', 'slotBetTier2', 'slotBetTier3']) {
      expect(MIGRATION_0074).toContain(key);
    }
  });

  it('keeps the history: no ledger or metrics-column deletion', () => {
    expect(MIGRATION_0074).not.toMatch(/delete from public\.verified_action_ledger/);
    expect(MIGRATION_0074).not.toMatch(/drop column if exists (slot_pulls|slot_credits|slot_bundles|slot_fragments|slot_keys|slot_fragment|credits_minted_slots|credits_destroyed_slots)/);
    expect(MIGRATION_0074).not.toContain('drop table');
  });

  it('does not restate cc_add_consumable_batch (slot_bundle stays a valid historical event type)', () => {
    expect(MIGRATION_0074.toLowerCase()).not.toContain('create or replace function public.cc_add_consumable_batch');
  });
});

describe('0074 — the metrics restatement is 0068 verbatim apart from the slot panel', () => {
  it('the restated body carries no slot reference at all', () => {
    expect(METRICS_0074).not.toContain('slot');
    expect(METRICS_0074).not.toContain('Slot');
  });

  it('equals the chain head (0068) under the panel-removal recipe', () => {
    expect(stripSlotPanel(METRICS_0068)).toBe(METRICS_0074);
  });
});

describe('slots removal — the live tree has no machine left', () => {
  const DEAD = /cc_slot_pull|cc_slot_bundle|slot_machine|DataSlotsPanel|slotService|content\/slots|api\/slots|'slot-pull'/;

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) yield path;
    }
  }

  it('no source file under src/ references the machine (deletion records excluded)', () => {
    // Carve-out, the 0065 pattern: this test and the two suites
    // that pin SHIPPED migration text name the machine because
    // migration 0049's filename and body are history — they are
    // the deletion's record, not live references.
    const RECORDS = ['slotsRemoval.test.ts', 'economyCacheScaffolding.test.ts', 'marketSellableResources.test.ts'];
    const offenders: string[] = [];
    for (const path of walk(join(process.cwd(), 'src'))) {
      if (RECORDS.some((name) => path.endsWith(name))) continue;
      if (DEAD.test(readFileSync(path, 'utf8'))) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it('the deleted files stay deleted', () => {
    for (const rel of [
      'src/content/slots.ts',
      'src/components/vendor/DataSlotsPanel.tsx',
      'src/lib/api/slotService.ts',
      'src/assets/pixel/sprites/prop-slot-machine.png',
      'src/test/golden/baselines/slots-idle.png',
      'src/test/golden/baselines/slots-key-win.png',
      'wiki/Slots.md',
      'scripts/wiki-gen/slots.ts',
    ]) {
      expect(existsSync(join(process.cwd(), rel)), rel).toBe(false);
    }
  });

  it('the wiki page map no longer routes the deleted content module', () => {
    const map = read('wiki/.page-map.json');
    expect(map).not.toContain('src/content/slots.ts');
    expect(map).not.toContain('wiki/Slots.md');
  });

  it('the Market rail has exactly six stops and Slots is not one', () => {
    const slice = read('src/store/slices/marketSlice.ts');
    expect(slice).toContain("'buy' | 'sell' | 'vendor' | 'repair' | 'shieldTech' | 'repdesk'");
    expect(slice).not.toContain("'slots'");
  });
});
