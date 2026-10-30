/**
 * Phase 0 Slice 2 — the SHIPPED roaming consumable path, end to end.
 *
 * The mechanics audit found the roaming consumable contract broken in
 * ways unit tests never caught (activateFromInventory had zero tests):
 * the engine ran on private value tables that disagreed with the defs,
 * two produced effects were never read, seven defs were silently
 * skipped at activation, offline settlement granted benefits without
 * ever decrementing, and a foreground consumption-persistence failure
 * was swallowed while the claim paid out.
 *
 * These tests drive the actual routes (express +
 * InMemoryChefGameplayStore, the repo's HTTP harness pattern) and the
 * Chef engine itself, asserting PERSISTED end state — profile
 * consumable counts and consumable_events rows — not just responses.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { processRoamingClaim } from '../server/chef';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { GameplayStoreError, type Json } from '../server/gameplay/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '22222222-2222-4222-8222-222222222222';

interface Harness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
}

const openServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openServers.length) await openServers.pop()?.();
});

async function makeServer(store = new InMemoryChefGameplayStore()): Promise<Harness> {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolveListen) => server.once('listening', resolveListen));
  openServers.push(
    () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return { store, base: `http://127.0.0.1:${port}`, tokenA: issueAccessToken(SECRET, A, false) };
}

async function post(
  base: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** A carried roaming state whose OrdnanceCharge fires on tick 99. */
function ordnanceStateFiringAt(tick: number) {
  return {
    tickIndex: tick - 1,
    slots: [
      {
        slot: 'active',
        consumableId: 'OrdnanceCharge',
        family: 'ordnance',
        activatedAtTick: tick - 20,
        expiresAtTick: 0,
        remainingBuffer: 0,
        remainingRegenTicks: 0,
        armed: false,
        remainingBurstTicks: 0,
        ordnanceNextFireTick: tick,
      },
    ],
  };
}

const ordnanceClaimBody = {
  playerId: A,
  areaId: 'dustwaste_frontier',
  ticks: 1,
  tickCount: 100,
  playerLevel: 10,
  equippedGear: [],
  survival: { currentHp: 5000, shieldHp: 500, maxHp: 5000, mitigation: 0 },
  roamingConsumableState: ordnanceStateFiringAt(99),
};

describe('shipped roaming claim (POST /api/claim) — consumable consumption', () => {
  it('persists the engine’s consumed set to the profile and writes the event row', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, player_level: 10, consumables: { OrdnanceCharge: 3 } });

    const res = await post(base, '/api/claim', ordnanceClaimBody, tokenA);

    expect(res.status).toBe(200);
    expect(res.json.consumedConsumables).toEqual({ OrdnanceCharge: 1 });
    expect(store.profiles.get(A)!.consumables).toEqual({ OrdnanceCharge: 2 });
    expect(store.consumableEvents).toEqual([
      expect.objectContaining({
        user_id: A,
        consumable_type: 'OrdnanceCharge',
        quantity_delta: -1,
        event_type: 'used',
        activity_type: 'roaming_loot',
      }),
    ]);
  });

  it('fails the claim loudly (500) when consumption cannot be persisted — no silent free consumables', async () => {
    class FailingConsumeStore extends InMemoryChefGameplayStore {
      override async consumeRoamingConsumables(): Promise<Json> {
        throw new GameplayStoreError('simulated consumption write failure');
      }
    }
    const { base, store, tokenA } = await makeServer(new FailingConsumeStore());
    store.seedProfile({ id: A, player_level: 10, consumables: { OrdnanceCharge: 3 } });

    const res = await post(base, '/api/claim', ordnanceClaimBody, tokenA);

    expect(res.status).toBe(500);
    expect(res.json.error).toBe('Failed to persist consumable consumption');
    // The rewards write already landed (the response carries the
    // applied profile, like the store-items failure path), and the
    // tick guard advanced — a client retry gets a 409, never a
    // double-apply. The consumables themselves were NOT decremented.
    const profile = store.profiles.get(A)!;
    expect(profile.last_claimed_tick).toBe(100);
    expect(profile.consumables).toEqual({ OrdnanceCharge: 3 });
  });
});

describe('shipped offline settlement (POST /api/settle-offline) — consumable consumption', () => {
  it('decrements inventory for the offline ticks’ consumable windows, atomically with the rewards', async () => {
    const { base, store, tokenA } = await makeServer();
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    store.seedProfile({
      id: A,
      player_level: 10,
      consumables: { AmmoPack: 5, LuckBooster: 5 },
      last_roaming_settled_at: fifteenMinutesAgo,
    });
    store.seedActiveAction({
      user_id: A,
      active_action: 'roaming_loot',
      target_id: 'dustwaste_frontier',
      started_at: fifteenMinutesAgo,
      last_heartbeat_at: fifteenMinutesAgo,
      activity_payload: {},
    });

    const res = await post(
      base,
      '/api/settle-offline',
      { playerId: A, settlementNonce: 'slice2-offline-nonce-1' },
      tokenA,
    );

    expect(res.status).toBe(200);
    expect(res.json.settled).toBe(true);
    // 15 minutes = 300 ticks. Each 600s (200-tick) coverage window
    // expires exactly once in that span and is charged — before the
    // repair, offline settlement discarded the consumed set entirely
    // and these counts never moved.
    expect(res.json.consumedConsumables).toEqual({ AmmoPack: 1, LuckBooster: 1 });
    expect(store.profiles.get(A)!.consumables).toEqual({ AmmoPack: 4, LuckBooster: 4 });
    const events = store.consumableEvents.filter((e) => e.user_id === A);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.consumable_type).sort()).toEqual(['AmmoPack', 'LuckBooster']);
    expect(events.every((e) => e.reason.includes('offline settlement'))).toBe(true);

    // A replay of the same nonce settles nothing and charges nothing.
    const replay = await post(
      base,
      '/api/settle-offline',
      { playerId: A, settlementNonce: 'slice2-offline-nonce-1' },
      tokenA,
    );
    expect(replay.json.settled).toBe(false);
    expect(replay.json.reason).toBe('idempotent');
    expect(store.profiles.get(A)!.consumables).toEqual({ AmmoPack: 4, LuckBooster: 4 });
  });
});

describe('Chef engine — def-driven outcomes', () => {
  it('Med Kit (Refined) activates, absorbs, and is charged as Refined — not lumped into base Med Kit', () => {
    const result = processRoamingClaim({
      playerId: A,
      areaId: 'helixworks_labyrinth',
      ticks: 20,
      tickCount: 20,
      playerLevel: 30,
      equippedGear: [],
      survival: { currentHp: 5000, shieldHp: 0, maxHp: 5000, mitigation: 0 },
      consumableInventory: { MedKitRefined: 2 },
    });

    // The slot exists (pre-repair it never activated), Helix damage
    // (115–195 per hit) drains the full 2 × 260 pool, and the charge
    // lands on the Refined type at its own def rate.
    expect(result.roamingConsumableState?.slots.map((s) => s.consumableId)).toEqual(['MedKitRefined']);
    expect(result.survival.medKitBuffer).toBe(0);
    expect(result.consumedConsumables).toEqual({ MedKitRefined: 2 });
  });

  it('Data Skimmer’s extraLootRollChance produces extra loot on the claim’s loot roll', () => {
    const runSweep = (consumableInventory: Record<string, number>) => {
      let items = 0;
      let extraRollEvents = 0;
      for (let tc = 1000; tc < 1010; tc++) {
        const result = processRoamingClaim({
          playerId: A,
          areaId: 'dustwaste_frontier',
          ticks: 20,
          tickCount: tc * 100,
          playerLevel: 10,
          equippedGear: [],
          survival: { currentHp: 5000, shieldHp: 500, maxHp: 5000, mitigation: 0 },
          consumableInventory,
        });
        items += result.items.length;
        extraRollEvents += (result.feedEvents as Array<{ detail?: string }>).filter((e) =>
          (e.detail ?? '').includes('Data Skimmer extra roll'),
        ).length;
      }
      return { items, extraRollEvents };
    };

    // Deterministic (the claim RNG is seeded per tick): the sweep with
    // a Skimmer yields strictly more items, every extra one announced.
    const baseline = runSweep({});
    const skimmed = runSweep({ DataSkimmer: 1 });
    expect(baseline.extraRollEvents).toBe(0);
    expect(skimmed.extraRollEvents).toBe(10);
    expect(skimmed.items).toBe(baseline.items + skimmed.extraRollEvents);
    expect(skimmed.items).toBeGreaterThan(baseline.items);
  });
});

describe('migration 0012 — offline consumption applier', () => {
  it('extends cc_settle_offline_roaming with the consumed set and drops the old signature', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'db/migrations/0012_offline_consumable_consumption.sql'),
      'utf8',
    );
    expect(migration).toContain('drop function if exists public.cc_settle_offline_roaming');
    expect(migration).toContain('_consumed_consumables jsonb default null');
    expect(migration).toContain('consumables = next_consumables');
    expect(migration).toContain("'consumed_consumables', applied_consumables");
    const store = readFileSync(resolve(process.cwd(), 'src/server/gameplay/store.ts'), 'utf8');
    // RE-PINNED by the pacing-baseline tuning pass: migration 0015
    // appended a fourteenth argument (_cap_hours, the server-derived
    // earned offline cap) to the same call — the consumed set remains
    // the thirteenth.
    expect(store).toContain('cc_settle_offline_roaming($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)');
  });
});
