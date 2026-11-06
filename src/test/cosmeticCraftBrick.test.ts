/**
 * Cosmetic-craft workshop brick (fleet-found 2026-11-05; migration
 * 0085 + the craftFinalize defense).
 *
 * The defect: cc_pending_crafted_gear returned EVERY pending craft
 * output — no kind filter — so a completed cosmetic (skin-part)
 * unit, whose pending output carries cosmeticPartId + quality with
 * all gear fields NULL, was swept into the gear projection. Every
 * workshop surface finalizes gear before cosmetics, so the gear
 * finalizer hit the cosmetic row first: slot String(null) matched
 * no generator, `item.origin = 'crafted'` threw on undefined, the
 * request 500'd, the cosmetics finalizer never ran, and the output
 * never drained — the account's workshop 500'd on every touch
 * (workshop/me, craft-enqueue, settle-offline) forever.
 *
 * Pins:
 *  - 0085's restated function differs from its 0073 chain head by
 *    EXACTLY the two guard lines (provenance, machine-checked).
 *  - The gear finalizer, handed a cosmetic-shaped pending row (the
 *    pre-0085 leak), SKIPS it — no throw, no insert, no finalize —
 *    and logs the skip (defense in depth: one bad row must never
 *    500 the workshop again).
 *  - Through the real surface: PgWriteStore.getWorkshopState with a
 *    cosmetic output pending resolves, mints nothing as gear, and
 *    the cosmetics finalizer drains the row as a kind='cosmetic'
 *    item.
 *  - Control: a genuine gear pending output still finalizes into a
 *    minted item + a cc_finalize_crafted_gear call.
 *
 * The pool is a fake in the cacheKeyRemainder.test.ts style: it
 * dispatches on SQL text and records inserts/finalize calls.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgWriteStore } from '../server/writes/store';
import { finalizePendingCraftedGear } from '../server/writes/craftFinalize';

const A = '11111111-1111-4111-8111-111111111111';
const GEAR_JOB = '33333333-3333-4333-8333-333333333333';
const COSMETIC_JOB = '44444444-4444-4444-8444-444444444444';

/** What cc_pending_crafted_gear (pre-0085) returned for a completed
 *  cosmetic unit: the job's bench + snapshot values are real; every
 *  gear field on the output element is absent, hence NULL. */
const COSMETIC_ROW_AS_GEAR_LEAK: Record<string, unknown> = {
  job_id: COSMETIC_JOB,
  unit: 1,
  slot: null,
  rarity: null,
  item_level: null,
  draws: null,
  bench: 1,
  tool_quality_multiplier: 1,
  quality_bounds: null,
  named_relic: null,
};

/** The same completion as cc_pending_crafted_cosmetics returns it. */
const COSMETIC_ROW: Record<string, unknown> = {
  job_id: COSMETIC_JOB,
  unit: 1,
  part_id: 'dread-torso',
  quality: 87,
};

/** A genuine pending gear output (the control). */
const GEAR_ROW: Record<string, unknown> = {
  job_id: GEAR_JOB,
  unit: 1,
  slot: 'weapon',
  rarity: 'Rare',
  item_level: 20,
  draws: 1,
  bench: 1,
  tool_quality_multiplier: 1,
  quality_bounds: null,
  named_relic: null,
};

interface PoolCalls {
  inserts: Array<{ sql: string; params: unknown[] }>;
  finalizeGear: unknown[][];
  finalizeCosmetics: unknown[][];
}

function makeFakePool(opts: {
  pendingGear?: Array<Record<string, unknown>>;
  pendingCosmetics?: Array<Record<string, unknown>>;
}): { pool: Pool; calls: PoolCalls } {
  const calls: PoolCalls = { inserts: [], finalizeGear: [], finalizeCosmetics: [] };
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('cc_pending_crafted_gear')) return { rows: opts.pendingGear ?? [] };
      if (sql.includes('cc_pending_crafted_cosmetics')) return { rows: opts.pendingCosmetics ?? [] };
      if (sql.includes('cc_finalize_crafted_gear')) {
        calls.finalizeGear.push(params);
        return { rows: [{}] };
      }
      if (sql.includes('cc_finalize_crafted_cosmetic')) {
        calls.finalizeCosmetics.push(params);
        return { rows: [{}] };
      }
      if (sql.includes('insert into public.item_instances')) {
        calls.inserts.push({ sql, params });
        return { rows: [{ id: `item-${calls.inserts.length}` }] };
      }
      if (sql.includes('cc_settle_craft_jobs')) return { rows: [{ result: {} }] };
      if (sql.includes('from public.profiles')) {
        return { rows: [{ workshop_benches: 1, workshop_tools: {}, bench_time_banked_seconds: 0 }] };
      }
      return { rows: [] };
    },
  };
  return { pool: pool as unknown as Pool, calls };
}

/** Deterministic rng for the finalizer-level control (the weapon
 *  generator consumes rolls; any fixed stream works). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('migration 0085 — provenance pin', () => {
  const mig0085 = readFileSync(
    join(process.cwd(), 'db', 'migrations', '0085_pending_crafted_gear_kind_filter.sql'),
    'utf8',
  );
  const mig0073 = readFileSync(
    join(process.cwd(), 'db', 'migrations', '0073_bench_collapse_relic_merger.sql'),
    'utf8',
  );

  function extractPendingGear(sql: string): string {
    const start = sql.indexOf('drop function if exists public.cc_pending_crafted_gear');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = sql.indexOf('$$;', start);
    expect(end).toBeGreaterThan(start);
    return sql.slice(start, end + 3);
  }

  it('restates the 0073 chain head with exactly the two guard lines added', () => {
    const head = extractPendingGear(mig0073);
    const next = extractPendingGear(mig0085);
    expect(next).toContain("and j.kind = 'gear'");
    expect(next).toContain("and o ->> 'cosmeticPartId' is null");
    const stripped = next
      .split('\n')
      .filter((line) => !line.includes("j.kind = 'gear'") && !line.includes('cosmeticPartId'))
      .join('\n');
    expect(stripped).toBe(head);
  });
});

describe('finalizePendingCraftedGear — the defense', () => {
  it('skips a cosmetic-shaped pending row: no throw, no mint, no finalize, skip logged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pool, calls } = makeFakePool({ pendingGear: [COSMETIC_ROW_AS_GEAR_LEAK] });
    const finalized = await finalizePendingCraftedGear(pool, A, lcg(42));
    expect(finalized).toBe(0);
    expect(calls.inserts).toHaveLength(0);
    expect(calls.finalizeGear).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(String(errorSpy.mock.calls[0][0])).toContain('unknown slot');
  });

  it('control: a genuine gear output still finalizes (mint + finalize call)', async () => {
    const { pool, calls } = makeFakePool({ pendingGear: [GEAR_ROW] });
    const finalized = await finalizePendingCraftedGear(pool, A, lcg(7));
    expect(finalized).toBe(1);
    expect(calls.inserts).toHaveLength(1);
    // Insert params: [playerId, kind, rarity, itemLevel, payloadJson].
    expect(calls.inserts[0].params[0]).toBe(A);
    expect(calls.inserts[0].params[1]).toBe('weapon');
    const payload = JSON.parse(String(calls.inserts[0].params[4])) as Record<string, unknown>;
    expect(payload.origin).toBe('crafted');
    expect(payload.craftedBy).toBe(A);
    expect(calls.finalizeGear).toHaveLength(1);
    expect(calls.finalizeGear[0][1]).toBe(GEAR_JOB);
    expect(calls.finalizeGear[0][3]).toBe('item-1');
  });

  it('a bad row does not stop the rest of the queue from draining', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pool, calls } = makeFakePool({ pendingGear: [COSMETIC_ROW_AS_GEAR_LEAK, GEAR_ROW] });
    const finalized = await finalizePendingCraftedGear(pool, A, lcg(11));
    expect(finalized).toBe(1);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.finalizeGear).toHaveLength(1);
  });
});

describe('PgWriteStore.getWorkshopState — the bricked surface', () => {
  it('resolves with a cosmetic output pending; the row drains as a cosmetic, never as gear', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pool, calls } = makeFakePool({
      // Pre-0085 leak shape: the gear projection hands the gear
      // finalizer the cosmetic row too. (Post-0085 the SQL never
      // returns it; the store must survive either way.)
      pendingGear: [COSMETIC_ROW_AS_GEAR_LEAK],
      pendingCosmetics: [COSMETIC_ROW],
    });
    const store = new PgWriteStore(pool);
    const state = await store.getWorkshopState(A);
    expect(state).toBeTypeOf('object');
    // Exactly one mint: the cosmetic, through its own finalizer.
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].sql).toContain("'cosmetic'");
    const payload = JSON.parse(String(calls.inserts[0].params[1])) as Record<string, unknown>;
    expect(payload.partId).toBe('dread-torso');
    expect(calls.finalizeGear).toHaveLength(0);
    expect(calls.finalizeCosmetics).toHaveLength(1);
    expect(calls.finalizeCosmetics[0][1]).toBe(COSMETIC_JOB);
  });
});
