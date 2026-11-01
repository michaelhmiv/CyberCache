/**
 * Repair refund event type (hotfix 0045).
 *
 * THE DEFECT: the repair lane's refund paths — cc_settle_craft_jobs
 * (vehicle already whole/gone) and cc_cancel_craft_job (job cancelled),
 * written in 0025 and carried verbatim through 0026/0030/0038/0044 —
 * return escrowed patch kits via
 * cc_add_consumable_batch(..., 'repair_refund', ...). But
 * 'repair_refund' was in NEITHER the writer's validated event list
 * (raises 'invalid consumable event type') NOR the
 * consumable_events_event_type_check CHECK, so every repair refund
 * failed its whole transaction in production.
 *
 * 0045 follows the 0043 ('standing_buy') / 0044 ('shieldtech_refund')
 * precedent: widen both lists by the one value, change nothing else.
 * These pins hold the widening in place and prove the restatement is
 * the 0044 body verbatim apart from the two list lines. (The live
 * before/after behavior is proven by the embedded-Postgres harness:
 * chain 0001→0044 reproduces the failure through the real
 * enqueue→cancel path; 0001→0045 completes it with kits restored.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');
const read = (f: string) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');

const MIGRATION_0044 = read('0044_shield_tech_services.sql');
const MIGRATION_0045 = read('0045_repair_refund_event.sql');

/** The full CREATE OR REPLACE block for cc_add_consumable_batch. */
function batchWriter(sql: string): string {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.cc_add_consumable_batch');
  const end = sql.indexOf('$function$;', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + '$function$;'.length);
}

describe('0045 — repair_refund event type', () => {
  it('widens the consumable_events CHECK by exactly repair_refund', () => {
    expect(MIGRATION_0045).toContain('drop constraint consumable_events_event_type_check');
    expect(MIGRATION_0045).toContain("'shieldtech_refund'::text, 'repair_refund'::text");
    // The pre-0045 tail of the list survives intact and in order.
    expect(MIGRATION_0045).toContain(
      "array['vendor_buy'::text, 'crafted'::text, 'market_buy'::text, 'market_sell'::text, " +
      "'used'::text, 'expired'::text, 'admin_adjust'::text, 'reset'::text, 'standing_buy'::text, " +
      "'shieldtech_refund'::text, 'repair_refund'::text]",
    );
  });

  it('widens the writer validated list by exactly repair_refund', () => {
    expect(MIGRATION_0045).toContain(
      "'standing_buy', 'shieldtech_refund', 'repair_refund') then raise exception 'invalid consumable event type'",
    );
  });

  it('restates the 0044 writer body verbatim apart from the event list', () => {
    const before = batchWriter(MIGRATION_0044);
    const after = batchWriter(MIGRATION_0045);
    expect(after.replace(", 'repair_refund'", '')).toBe(before);
    // The origin list is NOT touched (refund origins are the escrowed
    // kits' own, already legal).
    expect(after).toContain("p_origin not in ('vendor', 'crafted', 'market', 'reward', 'admin', 'standing')");
  });

  it('its writer is the chain-final restatement of cc_add_consumable_batch', () => {
    // 0045 was the chain's last migration when this pin was written;
    // 0047/0048 landed after it (PR #252 rework) and restate OTHER
    // functions. The invariant that protects production is narrower
    // and durable: no migration after 0045 restates the batch writer,
    // so the repair_refund widening is the chain-final writer body.
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain('0045_repair_refund_event.sql');
    const restatements = files.filter((f) =>
      read(f).includes('CREATE OR REPLACE FUNCTION public.cc_add_consumable_batch'));
    expect(restatements[restatements.length - 1]).toBe('0045_repair_refund_event.sql');
  });

  it('the defect it fixes is real: the live refund call sites pass repair_refund', () => {
    // 0044 carries the chain-final cc_settle_craft_jobs /
    // cc_cancel_craft_job bodies; both refund through the one writer.
    const sites = MIGRATION_0044.match(/'repair_refund'/g) ?? [];
    expect(sites.length).toBeGreaterThanOrEqual(2);
    expect(MIGRATION_0044).toContain('Patch kit refunded (repair job cancelled)');
    expect(MIGRATION_0044).toContain('Patch kit refunded (vehicle already at full condition)');
  });
});
