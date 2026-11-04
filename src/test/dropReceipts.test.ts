/**
 * AL-1 drop receipts — wire-contract tests.
 *
 * The slice makes the Chef RECORD what it used to discard, without
 * changing any outcome: drops are stamped at generation (foundVia /
 * foundContext / foundEnemy / dropOdds), the item store writes
 * item_instances.source_id from the stamp, boss attempts carry the
 * dedicated-drop facts, and cache draws carry the odds-table version.
 *
 * These tests run against the real contracts:
 *   - roam claims and offline settles through the mounted gameplay
 *     routes (express + JWT + the InMemory gameplay twin), asserting
 *     the stamps on the STORED item rows and the area_id on the claim /
 *     settlement ledger records (the G3 pin — that recording predates
 *     AL-1, pinned so it can never silently regress);
 *   - a boss attempt through the route, asserting the dedicated-drop
 *     facts on the attempt record and the 'killed' receipts on loot;
 *   - an endless milestone through the engine, same stamp family;
 *   - a cache makeItem through the writes twin, asserting the
 *     odds_table_version on the draw record;
 *   - outcome identity: two identical seeded claims produce identical
 *     rewards and identical item identities — stamps are written AFTER
 *     generation from values already computed, and consume no RNG.
 *
 * Honesty pins: relations are 'engaged' for ambient roam drops (the
 * tick roll is not a kill), 'killed' only where the kill caused the
 * drop; items that predate stamping keep NULL source_id and no
 * receipt fields — nothing is fabricated.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import {
  DropSource,
  Element,
  Manufacturer,
  Rarity,
  RiskSetting,
  WeaponType,
} from '@/types/game';
import type { Weapon } from '@/types/items';
import { processEndlessEncounter, processRoamingClaim, type ClaimRequest } from '../server/chef';
import { mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore, type InMemoryItem } from '../server/gameplay/memory';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import { sourceIdFromPayload } from '../server/dropReceipts';
import { isEndlessMilestoneDepth } from '@/content/endless';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const AREA = 'dustwaste_frontier';

const openServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openServers.length) await openServers.pop()?.();
});

async function makeServer(store = new InMemoryChefGameplayStore()) {
  const app = express();
  app.use(express.json());
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
  return { store, base: `http://127.0.0.1:${port}`, token: issueAccessToken(SECRET, A, false) };
}

async function post(
  base: string,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** The engine's known-good boss fixture weapon (chefBossVerification). */
const STRONG_WEAPON: Weapon = {
  id: 'server-owned-boss-gun',
  name: 'Server Owned Boss Gun',
  level: 50,
  rarity: Rarity.Legendary,
  weaponType: WeaponType.SMG,
  manufacturer: Manufacturer.Redline,
  element: Element.Fire,
  rollQuality: 100,
  baseDamage: 10000,
  attackSpeed: 10,
  critChance: 0.5,
  critDamage: 2,
  statusChance: 0,
  statusDamage: 0,
  bossDamageMod: 2,
  waveDamageMod: 0,
  shieldDamageMod: 1,
  armorDamageMod: 1,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  parts: [],
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 1,
  combatPower: 0,
  bossPower: 0,
  farmPower: 0,
  economyScore: 0,
};

type Receipt = {
  foundVia?: string;
  foundContext?: unknown;
  foundEnemy?: { id?: string; name?: string; relation?: string };
  dropOdds?: Record<string, unknown>;
};

function receiptOf(item: InMemoryItem): Receipt {
  return item.payload as Receipt;
}

function expectWeightsSane(weights: unknown) {
  expect(typeof weights).toBe('object');
  const values = Object.values(weights as Record<string, number>);
  expect(values.length).toBeGreaterThan(0);
  expect(values.every((v) => typeof v === 'number' && v >= 0)).toBe(true);
  expect(values.some((v) => v > 0)).toBe(true);
}

describe('AL-1 drop receipts', () => {
  it('sourceIdFromPayload derives the stored string and stays null when unstamped', () => {
    expect(sourceIdFromPayload({ foundVia: 'boss', foundContext: 'dune_tyrant' })).toBe(
      'boss:dune_tyrant',
    );
    expect(sourceIdFromPayload({ foundVia: 'endless', foundContext: 25 })).toBe('endless:25');
    expect(sourceIdFromPayload({ foundVia: 'roam' })).toBe('roam');
    expect(sourceIdFromPayload({})).toBeNull();
    expect(sourceIdFromPayload({ name: 'Old Gun' })).toBeNull();
  });

  it('roam claims through the route store stamped items and write source_id', async () => {
    const { base, store, token } = await makeServer();
    store.seedProfile({ id: A, credits: 100 });

    // Drive cumulative 20-tick claims until drops land (seeded RNG —
    // deterministic). 200 ticks at the shaped gear chance yields many.
    let tickCount = 0;
    while (store.items.size < 3 && tickCount < 200) {
      tickCount += 20;
      const res = await post(
        base,
        '/api/claim',
        {
          playerId: A,
          areaId: AREA,
          ticks: 20,
          tickCount,
          playerLevel: 10,
          idleMods: { offlineEarningsMod: 0, scrapYieldMod: 0, rareDropChanceMod: 0 },
        },
        token,
      );
      expect(res.status).toBe(200);
    }
    expect(store.items.size).toBeGreaterThanOrEqual(3);

    for (const item of store.items.values()) {
      const receipt = receiptOf(item);
      // source_id is exactly the receipt rendered as a string.
      expect(item.source_id).toBe(sourceIdFromPayload(item.payload));
      expect(item.source_id).not.toBeNull();
      if (receipt.foundVia === 'roam') {
        expect(receipt.foundContext).toBe(AREA);
        expect(item.source_id).toBe(`roam:${AREA}`);
        // The ambient per-tick roll is honest: the enemy was being
        // fought, it did not drop the item.
        if (receipt.foundEnemy) {
          expect(receipt.foundEnemy.relation).toBe('engaged');
          expect(typeof receipt.foundEnemy.id).toBe('string');
          expect(typeof receipt.foundEnemy.name).toBe('string');
        }
        // The shaped odds actually in force: gear chance + weights.
        expect(typeof receipt.dropOdds?.gearChance).toBe('number');
        expect(receipt.dropOdds?.gearChance as number).toBeGreaterThan(0);
        expect(receipt.dropOdds?.gearChance as number).toBeLessThanOrEqual(0.98);
        expectWeightsSane(receipt.dropOdds?.rarityWeights);
      } else {
        // Roaming events are the only other claim-path stamp family.
        expect(receipt.foundVia).toBe('event');
        expect(typeof receipt.foundContext).toBe('string');
        expect(item.source_id).toBe(`event:${receipt.foundContext as string}`);
      }
    }

    // G3 pin: the claim ledger record carries the area id.
    const claimRecord = store.ledger.get(`${A}:chef:${tickCount}`) as
      | Record<string, unknown>
      | undefined;
    expect(claimRecord?.area_id).toBe(AREA);
  });

  it('offline settle through the route stamps offline receipts and records area_id', async () => {
    const { base, store, token } = await makeServer();
    const ticks = 598;
    const settleFromMs = Date.now() - (ticks * 3000 + 1500);
    store.seedProfile({
      id: A,
      player_level: 10,
      credits: 0,
      last_claimed_tick: 100,
      last_roaming_settled_at: new Date(settleFromMs).toISOString(),
    });
    store.seedActiveAction({
      user_id: A,
      active_action: 'roaming_loot',
      target_id: AREA,
      started_at: new Date(settleFromMs).toISOString(),
      last_heartbeat_at: null,
      activity_payload: {},
    });
    const res = await post(
      base,
      '/api/settle-offline',
      { playerId: A, settlementNonce: 'al1-settle-0001' },
      token,
    );
    expect(res.status).toBe(200);
    expect(res.json.settled).toBe(true);
    expect(store.items.size).toBeGreaterThan(0);

    let offlineCount = 0;
    for (const item of store.items.values()) {
      const receipt = receiptOf(item);
      expect(item.source_id).toBe(sourceIdFromPayload(item.payload));
      if (receipt.foundVia === 'offline') {
        offlineCount += 1;
        expect(receipt.foundContext).toBe(AREA);
        expect(item.source_id).toBe(`offline:${AREA}`);
        if (receipt.foundEnemy) expect(receipt.foundEnemy.relation).toBe('engaged');
      } else {
        // Events during the away window keep their own honest stamp.
        expect(receipt.foundVia).toBe('event');
      }
    }
    expect(offlineCount).toBeGreaterThan(0);

    // G3 pin: the settlement ledger record carries the area id.
    const settleRecord = store.ledger.get(`${A}:offline_settle:al1-settle-0001`) as
      | Record<string, unknown>
      | undefined;
    expect(settleRecord?.area_id).toBe(AREA);
  });

  it('boss attempts through the route record the dedicated-drop facts and killed receipts', async () => {
    const { base, store, token } = await makeServer();
    store.seedProfile({
      id: A,
      player_level: 50,
      credits: 10_000_000,
      consumables: { MedKit: 100 },
      boss_state: {},
    });
    const boss = REGION_1_BOSSES[0];

    // Deterministic per nonce — walk nonces to the first victory.
    let winningNonce = -1;
    let winningItems: Array<Record<string, unknown>> = [];
    for (let nonce = 1; nonce <= 60 && winningNonce < 0; nonce += 1) {
      const res = await post(
        base,
        '/api/verify-boss',
        {
          playerId: A,
          bossId: boss.id,
          attemptNonce: nonce,
          primary: STRONG_WEAPON,
          secondary: null,
          heavy: null,
          ordnance: null,
          shield: null,
          classMod: null,
          relic: null,
          consumables: { MedKit: 1 },
          risk: RiskSetting.Balanced,
          playerLevel: 50,
          playerCredits: 10_000_000,
          pityCount: 0,
          skillBonuses: {},
        },
        token,
      );
      expect(res.status).toBe(200);
      if (res.json.victory === true) {
        winningNonce = nonce;
        winningItems = (res.json.items ?? []) as Array<Record<string, unknown>>;
      }
    }
    expect(winningNonce).toBeGreaterThan(0);
    expect(winningItems.length).toBeGreaterThan(0);

    // G2: the attempt record itself carries the dedicated-drop facts —
    // the default 0.10 lever (no economy override in this harness),
    // the award flag, and the luck bonus in force.
    const record = store.ledger.get(`${A}:chef-boss:${boss.id}:${winningNonce}`) as
      | { attempt?: Record<string, unknown> }
      | undefined;
    const attempt = record?.attempt;
    expect(attempt?.dedicatedChance).toBe(0.1);
    expect(typeof attempt?.dedicatedDropAwarded).toBe('boolean');
    expect(attempt?.dropLuckBonus).toBe(0);

    // Every loot item on the winning attempt is stamped from the kill.
    for (const item of winningItems) {
      const receipt = item as Receipt;
      expect(receipt.foundVia).toBe('boss');
      expect(receipt.foundContext).toBe(boss.id);
      expect(receipt.foundEnemy?.id).toBe(boss.id);
      expect(receipt.foundEnemy?.relation).toBe('killed');
      expect(receipt.dropOdds?.dedicatedChance).toBe(0.1);
      expect(typeof receipt.dropOdds?.dedicatedHit).toBe('boolean');
      // The stored row's source_id matches the payload receipt.
      const stored = store.items.get(item.id as string);
      expect(stored?.source_id).toBe(`boss:${boss.id}`);
    }
    // Award flag and per-item hits agree.
    const anyHit = winningItems.some(
      (item) => (item as Receipt).dropOdds?.dedicatedHit === true,
    );
    expect(attempt?.dedicatedDropAwarded).toBe(anyHit);
  });

  it('endless milestone items carry the endless receipt with the depth as context', () => {
    const depth = [5, 10, 15, 20, 25].find((d) => isEndlessMilestoneDepth(d)) ?? 5;
    let stamped: Array<Record<string, unknown>> = [];
    for (let run = 1; run <= 40 && stamped.length === 0; run += 1) {
      const outcome = processEndlessEncounter({
        playerId: A,
        runId: `al1-run-${run}`,
        startLevel: 50,
        depth,
        primary: STRONG_WEAPON,
        secondary: null,
        heavy: null,
        ordnance: null,
        shield: null,
        classMod: null,
        relic: null,
        consumables: {},
        risk: RiskSetting.Balanced,
        playerLevel: 50,
        playerCredits: 0,
        pityCount: 0,
        skillBonuses: {},
      });
      if (outcome.result.victory && outcome.items.length > 0) {
        stamped = outcome.items as Array<Record<string, unknown>>;
      }
    }
    expect(stamped.length).toBeGreaterThan(0);
    for (const item of stamped) {
      const receipt = item as Receipt;
      expect(receipt.foundVia).toBe('endless');
      expect(receipt.foundContext).toBe(depth);
      expect(receipt.foundEnemy?.relation).toBe('killed');
      expect(receipt.dropOdds).toBeDefined();
      // The stored row's source_id derives from exactly this payload.
      expect(sourceIdFromPayload(item)).toBe(`endless:${depth}`);
    }
  });

  it('cache draws stamp the odds-table version on the draw record', async () => {
    const profile = (overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData =>
      ({
        username: null,
        display_name: null,
        player_level: 5,
        player_xp: 0,
        credits: 0,
        scrap: 0,
        cache_tokens: 0,
        cache_token_parts: 0,
        materials: {},
        essences: {},
        consumables: {},
        skill_spends: {},
        boss_state: {},
        last_idle_claim_at: '2026-10-31T10:00:00.000Z',
        last_claimed_tick: 0,
        created_at: '2026-06-14T00:00:00.000Z',
        updated_at: '2026-10-31T00:00:00.000Z',
        account_type: 'verified',
        email: null,
        email_verified_at: '2026-06-14T00:00:00.000Z',
        verification_grace_expires_at: null,
        verification_reminder_last_seen_at: null,
        last_roaming_settled_at: null,
        last_settlement_nonce: null,
        offline_cap_hours: 2,
        username_updated_at: null,
        username_change_count: 0,
        ...overrides,
      }) as ProfileRowData;

    const seed: WriteSeed = {
      ...emptyWriteSeed(),
      profiles: [profile({ id: A, cache_tokens: 2 })],
      oddsOutcomes: [
        { table_id: 'cache_primary_rarity', outcome: 'Common', weight: 70, payload: {} },
        { table_id: 'cache_primary_rarity', outcome: 'Rare', weight: 30, payload: {} },
      ],
      oddsTables: [{ id: 'cache_primary_rarity', version: 7 }],
    };
    const store = new InMemoryWriteStore(seed);
    const result = await store.makeItem(A, 'al1-cache-nonce-0001', 'key', null);
    const odds = result.odds as unknown as Record<string, unknown>;
    expect(odds.table_id).toBe('cache_primary_rarity');
    expect(odds.odds_table_version).toBe(7);
    // The version rides the durable ledger record, not just the reply.
    const ledgerRow = store.seed.ledger.find((row) => row.action_type === 'cc_make_item');
    const payload = ledgerRow?.result_payload as { odds?: Record<string, unknown> };
    expect(payload?.odds?.odds_table_version).toBe(7);

    // An unseeded table stamps null — the twin of the SQL select-into
    // finding no odds_tables row. Never fabricated.
    const bareSeed: WriteSeed = {
      ...emptyWriteSeed(),
      profiles: [profile({ id: A, cache_tokens: 2 })],
      oddsOutcomes: seed.oddsOutcomes,
    };
    const bareStore = new InMemoryWriteStore(bareSeed);
    const bare = await bareStore.makeItem(A, 'al1-cache-nonce-0002', 'key', null);
    expect((bare.odds as unknown as Record<string, unknown>).odds_table_version).toBeNull();
  });

  it('identical seeded claims produce identical outcomes — stamps consume no RNG', async () => {
    const request = (tickCount: number): ClaimRequest => ({
      playerId: A,
      areaId: AREA,
      ticks: 400,
      tickCount,
      playerLevel: 10,
      idleMods: { offlineEarningsMod: 0, scrapYieldMod: 0, rareDropChanceMod: 0 },
      equippedGear: [],
      source: 'roam',
      maxTicks: 400,
    });
    const first = await processRoamingClaim(request(400), undefined);
    const second = await processRoamingClaim(request(400), undefined);
    // Everything except the receipt fields themselves is the outcome:
    // rewards, item kinds, rarities, stats, values. Storage identity
    // (id) and the presentation seed (pixelSeed) are randomUUID-derived
    // on every generation by design — they are not drop outcomes, and
    // they differed run-to-run long before AL-1.
    const stripIdentity = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripIdentity);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([key]) => key !== 'id' && key !== 'pixelSeed')
            .map(([key, v]) => [key, stripIdentity(v)]),
        );
      }
      return value;
    };
    const outcome = (r: typeof first) => ({
      credits: r.rewards.creditsAwarded,
      scrap: r.rewards.scrapAwarded,
      xp: r.rewards.xpAwarded,
      kills: r.rewards.killsRecorded,
      items: r.items.map((item) => {
        const { foundVia, foundContext, foundEnemy, dropOdds, ...identity } = item as Record<
          string,
          unknown
        >;
        void foundVia;
        void foundContext;
        void foundEnemy;
        void dropOdds;
        return stripIdentity(identity);
      }),
    });
    expect(outcome(second)).toEqual(outcome(first));
    // And the fat claim really did stamp its drops (400 ticks).
    expect(first.items.length).toBeGreaterThan(5);
    for (const item of first.items as Array<Record<string, unknown>>) {
      expect(['roam', 'event']).toContain(item.foundVia);
      expect(item.dropOdds).toBeDefined();
    }
  });

  it('pre-stamp items stay unstamped — nothing is fabricated', async () => {
    const { store } = await makeServer();
    store.seedProfile({ id: A });
    store.seedItem({ id: 'legacy-1', owner_user_id: A, rarity: 'Rare', item_level: 10 });
    const legacy = store.items.get('legacy-1')!;
    expect((legacy.payload as Receipt).foundVia).toBeUndefined();
    expect(legacy.source_id ?? null).toBeNull();
  });

  it('migration 0070 restates only the two intended functions', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'db/migrations/0070_drop_receipts.sql'),
      'utf8',
    );
    expect(sql).toContain('NOT APPLIED TO PRODUCTION');
    expect(sql).toMatch(/create or replace function public\.cc_store_chef_items\(/);
    expect(sql).toContain("entry ->> 'foundVia'");
    expect(sql).toContain(', source_id');
    expect(sql).toMatch(
      /create or replace function public\.cc_draw_odds\(table_name text, p_quality numeric\)/,
    );
    expect(sql).toContain("'odds_table_version', v_version");
    // The area_id settlers already record it — never restated here.
    expect(sql).not.toMatch(/create or replace function public\.cc_apply_chef_rewards/);
    expect(sql).not.toMatch(/create or replace function public\.cc_settle_offline_roaming/);
    expect(sql).not.toMatch(/create or replace function public\.cc_settle_craft_jobs/);
    expect(sql).not.toMatch(/create or replace function public\.cc_apply_chef_boss_attempt/);
  });
});
