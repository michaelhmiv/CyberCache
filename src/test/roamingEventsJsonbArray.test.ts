/**
 * Regression: Pg roaming-event telemetry silently lost every claim
 * that fired at least one roaming event (found by the PR #284 audit,
 * 2026-11-02).
 *
 * Root cause: PgChefGameplayStore.recordRoamingEvents passed the
 * mapped events as a BARE JS array into cc_record_roaming_events,
 * whose second parameter is jsonb (migration 0023). pg serializes a
 * bare array as a Postgres array literal, not as a JSON document:
 *
 *   []                         -> '{}' (a jsonb OBJECT: the SQL guard
 *                                reads event_count = 0, so no
 *                                'roaming.event' row is written)
 *   [{ event_id, family }, …]  -> '{"{\"event_id\":…}"}' (not valid
 *                                JSON at all: the jsonb conversion
 *                                rejects the call before the function
 *                                body runs — the elite-kill row in the
 *                                same call is lost too)
 *
 * Both call sites (POST /api/claim in roamingHandler.ts and
 * POST /api/settle-offline in settleOffline.ts) invoke this AFTER the
 * claim has been paid and catch/log the failure, so players saw
 * successful claims while the Pg ledger writes vanished. The
 * InMemory twin takes arrays natively, which is why the route suite
 * never saw it — the same blind spot as #284.
 *
 * These tests pin the Pg seam itself: the events argument must reach
 * the driver as JSON TEXT, and that text must survive pg's own
 * serializer as the jsonb array document the SQL contract requires.
 * The final test drives the store against a fake pool that models
 * migration 0023's jsonb guard and ledger inserts, so the recorded
 * rows — not just the parameter shape — are asserted end to end.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error pg ships no types for its internal serializer; it is
// the exact function the driver runs over every parameter we hand it.
import { prepareValue } from 'pg/lib/utils';
import type { Pool } from 'pg';
import { PgChefGameplayStore } from '../server/gameplay/store';

const PLAYER = '11111111-1111-4111-8111-111111111111';

const EVENTS = [
  { eventId: 'dustwaste_buried_cache', family: 'cache' },
  { eventId: 'dustwaste_dust_devil', family: 'hazard' },
];
const EVENTS_JSON = JSON.stringify([
  { event_id: 'dustwaste_buried_cache', family: 'cache' },
  { event_id: 'dustwaste_dust_devil', family: 'hazard' },
]);

interface CapturedCall {
  sql: string;
  params: unknown[];
}

function captureStore(result: Record<string, unknown> = {}): {
  store: PgChefGameplayStore;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fakePool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [{ result }] };
    },
  };
  return { store: new PgChefGameplayStore(fakePool as unknown as Pool), calls };
}

describe('PgChefGameplayStore.recordRoamingEvents — events param wire format', () => {
  it('empty event set: the events param is the JSON text "[]", not a bare array', async () => {
    const { store, calls } = captureStore();
    await store.recordRoamingEvents(PLAYER, {
      events: [],
      eliteKills: 0,
      areaId: 'dustwaste_frontier',
      tickCount: 6000,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('cc_record_roaming_events');
    const eventsParam = calls[0].params[1];
    expect(typeof eventsParam).toBe('string');
    expect(eventsParam).toBe('[]');
    // The wire contract: what pg will actually transmit for this
    // param is a valid jsonb array document.
    expect(prepareValue(eventsParam)).toBe('[]');
    expect(JSON.parse(prepareValue(eventsParam) as string)).toEqual([]);
  });

  it('fired events: the events param is JSON text that round-trips to the mapped events', async () => {
    const { store, calls } = captureStore();
    await store.recordRoamingEvents(PLAYER, {
      events: EVENTS,
      eliteKills: 2,
      areaId: 'dustwaste_frontier',
      tickCount: 6000,
    });
    expect(calls).toHaveLength(1);
    const eventsParam = calls[0].params[1];
    expect(typeof eventsParam).toBe('string');
    expect(eventsParam).toBe(EVENTS_JSON);
    expect(JSON.parse(prepareValue(eventsParam) as string)).toEqual(JSON.parse(EVENTS_JSON));
    // The remaining parameters stay the scalars the function declares.
    expect(calls[0].params[0]).toBe(PLAYER);
    expect(calls[0].params[2]).toBe(2);
    expect(calls[0].params[3]).toBe('dustwaste_frontier');
    expect(calls[0].params[4]).toBe(6000);
  });
});

// ---------------------------------------------------------------------------
// Pg-shaped end to end: a fake pool that runs pg's serializer over the
// events parameter and then applies migration 0023's own rules — the
// jsonb document must be an array (jsonb_typeof guard) before any
// 'roaming.event' ledger row exists; the elite branch writes its row
// in the same call. On the pre-fix code the non-empty bare array
// serializes to a Postgres array literal that is not valid JSON, the
// jsonb conversion throws, and NO row is written — exactly the live
// failure the routes swallowed.
// ---------------------------------------------------------------------------

interface LedgerRow {
  action_type: string;
  result_payload: Record<string, unknown>;
}

describe('PgChefGameplayStore.recordRoamingEvents — Pg-shaped ledger write (0023 semantics)', () => {
  function pgShapedStore(): { store: PgChefGameplayStore; ledger: LedgerRow[]; documents: unknown[] } {
    const ledger: LedgerRow[] = [];
    const documents: unknown[] = [];
    const fakePool = {
      query: async (sql: string, params: unknown[]) => {
        expect(sql).toContain('cc_record_roaming_events');
        // The driver serializes first; Postgres then parses the
        // parameter text as jsonb. A bare JS array arrives as an
        // array literal — '{}' for empty (a jsonb object), invalid
        // JSON for a non-empty event list.
        const wire = prepareValue(params[1]) as string;
        const eventsDoc: unknown = JSON.parse(wire);
        documents.push(eventsDoc);
        const events = Array.isArray(eventsDoc) ? (eventsDoc as Array<Record<string, unknown>>) : [];
        const eliteKills = Number(params[2] ?? 0);
        let recordedEvents = 0;
        let recordedElites = 0;
        if (events.length > 0) {
          ledger.push({
            action_type: 'roaming.event',
            result_payload: {
              area_id: params[3],
              tick_count: params[4],
              event_count: events.length,
              events,
            },
          });
          recordedEvents = 1;
        }
        if (eliteKills > 0) {
          ledger.push({
            action_type: 'roaming.elite_kill',
            result_payload: {
              area_id: params[3],
              tick_count: params[4],
              elite_kills: eliteKills,
            },
          });
          recordedElites = 1;
        }
        return {
          rows: [{
            result: {
              recorded_event_rows: recordedEvents,
              recorded_elite_rows: recordedElites,
              event_count: events.length,
              elite_kills: eliteKills,
            },
          }],
        };
      },
    };
    return { store: new PgChefGameplayStore(fakePool as unknown as Pool), ledger, documents };
  }

  it('a claim’s fired events land as a roaming.event ledger row (elite row alongside)', async () => {
    const { store, ledger } = pgShapedStore();
    const result = await store.recordRoamingEvents(PLAYER, {
      events: EVENTS,
      eliteKills: 2,
      areaId: 'dustwaste_frontier',
      tickCount: 6000,
    }) as Record<string, unknown>;

    expect(result).toEqual({
      recorded_event_rows: 1,
      recorded_elite_rows: 1,
      event_count: 2,
      elite_kills: 2,
    });
    expect(ledger).toHaveLength(2);
    expect(ledger[0].action_type).toBe('roaming.event');
    expect(ledger[0].result_payload).toEqual({
      area_id: 'dustwaste_frontier',
      tick_count: 6000,
      event_count: 2,
      events: JSON.parse(EVENTS_JSON),
    });
    expect(ledger[1].action_type).toBe('roaming.elite_kill');
    expect(ledger[1].result_payload.elite_kills).toBe(2);
  });

  it('elite-only call (no fired events): the [] document parses as an array and the elite row lands', async () => {
    const { store, ledger, documents } = pgShapedStore();
    const result = await store.recordRoamingEvents(PLAYER, {
      events: [],
      eliteKills: 1,
      areaId: 'dustwaste_frontier',
      tickCount: 6001,
    }) as Record<string, unknown>;

    // The SQL guard accepts any non-array jsonb without error, so the
    // elite row landed even pre-fix — but the parameter contract is
    // an ARRAY document, and '{}' (the bare-array serialization of [])
    // does not satisfy it.
    expect(documents).toEqual([[]]);
    expect(result.event_count).toBe(0);
    expect(result.recorded_event_rows).toBe(0);
    expect(result.recorded_elite_rows).toBe(1);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].action_type).toBe('roaming.elite_kill');
  });
});
