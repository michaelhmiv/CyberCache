/**
 * PR #646 adoptions (owner rulings 2026-11-21) — the four items the
 * owner adopted from the Neon audit PR, pinned across every
 * implementation that must agree:
 *
 *   7. Crafted-gear caps: vendor value 250 cr (named craft relics) /
 *      500 cr (other crafted gear); salvage base award 5 scrap
 *      (named relics) / 15 scrap (other crafted) — in the client
 *      estimate + salvage projection, in SQL (migration 0105), and
 *      in BOTH in-memory server twins. Non-crafted gear untouched.
 *   8. The four named relic recipes carry maxUnits 1 in the TS
 *      catalog AND the SQL catalog (0105), with the enqueue cap
 *      actually refusing a 2-unit relic job.
 *   9. Leaderboard wash-trade filter: the weekly Market Sales race
 *      counts a sale only at 50 cr or more, and never a self-sale.
 *  15. AGENTS.md's generator rule keeps its "shared" substance with
 *      the path that actually exists (src/server/lib/generators/*).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_CRAFT_RECIPES, getCraftRecipe } from '../content/crafting';
import { projectSalvageYield } from '../lib/gear/salvageAward';
import { salvageScrap } from '../lib/skills/salvageBonuses';
import {
  CRAFTED_GEAR_MAX_VENDOR_VALUE,
  CRAFTED_RELIC_MAX_VENDOR_VALUE,
  computeItemEstimatedValue,
} from '../lib/vendor/catalog';
import { computeRaceStandings, type WeeklyLedgerData } from '../server/leaderboards/fold';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { InMemoryWriteStore } from '../server/writes/memory';
import type { ProfileRowData } from '../server/reads/store';
import {
  emptyWriteSeed,
  type WriteItemData,
  type WriteSeed,
} from '../server/writes/store';
import type { GearItem } from '../types/items';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, '..', '..', rel), 'utf8');
const MIGRATION_0099 = read('db/migrations/0099_whole_skins.sql');
const MIGRATION_0105 = read('db/migrations/0105_adoptions_646.sql');
const AGENTS_MD = read('AGENTS.md');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
let nonceCounter = 0;
const nonce = () => `adoptions-nonce-${(nonceCounter += 1).toString().padStart(4, '0')}`;

const NAMED_RELICS = ['Precision Calipers', 'Servo Bench Rig', 'Reclaimer Head', 'Prime Laboratory'];
const RELIC_RECIPE_IDS = [
  'tool_precision_calipers', 'tool_servo_bench_rig', 'tool_reclaimer_head', 'relic_prime_laboratory',
];

// ---------------------------------------------------------------------------
// 7a. Vendor caps — the shared estimate (client preview + TS stamping)
// ---------------------------------------------------------------------------

describe('adoptions — ruling 7 vendor caps (computeItemEstimatedValue)', () => {
  it('caps a named craft relic at 250 and other crafted gear at 500', () => {
    const relicPayload = { name: 'Reclaimer Head', origin: 'crafted', affixes: [{}, {}, {}] };
    // Raw: 100 * 100 * 10 (Epic) + 3 affixes * 40 * 10 = 101,200.
    expect(computeItemEstimatedValue(relicPayload, 'relic', 'Epic', 100)).toBe(CRAFTED_RELIC_MAX_VENDOR_VALUE);
    expect(CRAFTED_RELIC_MAX_VENDOR_VALUE).toBe(250);

    const weaponPayload = { name: 'Forged Pistol', origin: 'crafted', combatPower: 5000 };
    // Raw: 100 * 100 * 25 (Legendary) + 5000 * 2 = 260,000.
    expect(computeItemEstimatedValue(weaponPayload, 'weapon', 'Legendary', 100)).toBe(CRAFTED_GEAR_MAX_VENDOR_VALUE);
    expect(CRAFTED_GEAR_MAX_VENDOR_VALUE).toBe(500);
  });

  it('leaves non-crafted gear at the raw estimate, and crafted gear under the cap untouched', () => {
    const foundRelic = { name: 'Reclaimer Head', affixes: [{}, {}, {}] };
    expect(computeItemEstimatedValue(foundRelic, 'relic', 'Epic', 100)).toBe(101_200);
    const foundWeapon = { name: 'Forged Pistol', combatPower: 5000 };
    expect(computeItemEstimatedValue(foundWeapon, 'weapon', 'Legendary', 100)).toBe(260_000);
    // A low-level crafted piece prices below the cap on its own merits.
    const smallCraft = { name: 'Workshop Frame', origin: 'crafted', combatPower: 0 };
    expect(computeItemEstimatedValue(smallCraft, 'weapon', 'Common', 1)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 7b. Salvage caps — client projection
// ---------------------------------------------------------------------------

describe('adoptions — ruling 7 salvage caps (projectSalvageYield)', () => {
  const asItem = (o: Record<string, unknown>) => o as unknown as GearItem;

  it('caps the crafted base award at 5 (named relic) / 15 (other crafted) before multipliers', () => {
    // salvageScrap('Epic', 50) = round((10 + 250) * 4) = 1040 uncapped.
    expect(salvageScrap('Epic', 50)).toBe(1040);
    const relic = asItem({ name: 'Reclaimer Head', origin: 'crafted', rarity: 'Epic', level: 50 });
    expect(projectSalvageYield(relic, {}).scrapValue).toBe(5);
    const frame = asItem({ name: 'Forged Pistol', origin: 'crafted', weaponType: 'Pistol', rarity: 'Epic', level: 50 });
    expect(projectSalvageYield(frame, {}).scrapValue).toBe(15);
  });

  it('leaves found gear at the full base award', () => {
    const found = asItem({ name: 'Looted Pistol', weaponType: 'Pistol', rarity: 'Epic', level: 50 });
    expect(projectSalvageYield(found, {}).scrapValue).toBe(1040);
  });
});

// ---------------------------------------------------------------------------
// 7c. The in-memory twins settle identically
// ---------------------------------------------------------------------------

function profile(overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: null, display_name: null, player_level: 25, player_xp: 0, credits: 0,
    scrap: 0, cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {},
    consumables: {}, skill_spends: {}, boss_state: {}, last_idle_claim_at: '2026-11-21T10:00:00.000Z',
    last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: '2026-11-21T00:00:00.000Z',
    account_type: 'verified', email: null, email_verified_at: '2026-06-14T00:00:00.000Z',
    verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
    last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
    username_updated_at: null, username_change_count: 0, vehicle_fuel: 0,
    workshop_benches: 3, workshop_tools: {},
    ...overrides,
  } as ProfileRowData;
}

function gearItem(overrides: Partial<WriteItemData> & { id: string }): WriteItemData {
  return {
    owner_user_id: A, kind: 'relic', static_item_id: null, item_level: 50, rarity: 'Epic',
    quality: null, material_tier: null, condition_state: null, condition_current: null,
    condition_max: null, supply_mode: 'crafted', source_id: null, creator_user_id: A,
    tradeable: true, account_bound: false, locked_until: null, payload: {},
    runtime_state: 'available', is_locked: false, equipped_slot: null,
    estimated_value: 100_000, created_at: '2026-11-21T00:00:00.000Z',
    updated_at: '2026-11-21T00:00:00.000Z',
    ...overrides,
  } as WriteItemData;
}

function writeStore(items: WriteItemData[]): InMemoryWriteStore {
  const seed: WriteSeed = emptyWriteSeed();
  seed.profiles = [profile({ id: A })];
  seed.items = items;
  return new InMemoryWriteStore(seed, { now: () => new Date('2026-11-21T12:00:00.000Z') });
}

describe('adoptions — ruling 7 in the writes twin', () => {
  it('vendor sell: crafted values cap at 250 / 500 before the 0.40 rate; found gear pays raw', async () => {
    const store = writeStore([
      gearItem({ id: 'w-relic', payload: { origin: 'crafted', name: 'Reclaimer Head' } }),
      gearItem({ id: 'w-frame', kind: 'weapon', payload: { origin: 'crafted', name: 'Forged Pistol' } }),
      gearItem({ id: 'w-found', kind: 'weapon', supply_mode: 'verified_action', payload: { name: 'Looted Pistol' } }),
    ]);
    const relic = await store.vendorSell(A, nonce(), { kind: 'gear', itemId: 'w-relic' }) as { vendor_value: number; total_payout: number };
    expect(relic.vendor_value).toBe(250);
    expect(relic.total_payout).toBe(100); // floor(250 * 0.40)
    const frame = await store.vendorSell(A, nonce(), { kind: 'gear', itemId: 'w-frame' }) as { vendor_value: number; total_payout: number };
    expect(frame.vendor_value).toBe(500);
    expect(frame.total_payout).toBe(200);
    const found = await store.vendorSell(A, nonce(), { kind: 'gear', itemId: 'w-found' }) as { vendor_value: number; total_payout: number };
    expect(found.vendor_value).toBe(100_000);
    expect(found.total_payout).toBe(40_000);
  });

  it('recycle: crafted base caps at 5 / 15; found gear pays the full base', async () => {
    const store = writeStore([
      gearItem({ id: 'r-relic', payload: { origin: 'crafted', name: 'Prime Laboratory' } }),
      gearItem({ id: 'r-frame', kind: 'weapon', payload: { origin: 'crafted', name: 'Forged Pistol' } }),
      gearItem({ id: 'r-found', kind: 'weapon', supply_mode: 'verified_action', payload: { name: 'Looted Pistol' } }),
    ]);
    const relic = await store.recycleItem(A, nonce(), 'r-relic') as { scrap_award: number };
    expect(relic.scrap_award).toBe(5);
    const frame = await store.recycleItem(A, nonce(), 'r-frame') as { scrap_award: number };
    expect(frame.scrap_award).toBe(15);
    const found = await store.recycleItem(A, nonce(), 'r-found') as { scrap_award: number };
    expect(found.scrap_award).toBe(1040);
  });
});

describe('adoptions — ruling 7 in the gameplay twin', () => {
  it('recycle: the gameplay store settles the same caps', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A });
    store.seedItem({ id: 'g-relic', owner_user_id: A, kind: 'relic', rarity: 'Epic', item_level: 50, supply_mode: 'crafted', payload: { origin: 'crafted', name: 'Servo Bench Rig' } });
    store.seedItem({ id: 'g-frame', owner_user_id: A, kind: 'weapon', rarity: 'Epic', item_level: 50, supply_mode: 'crafted', payload: { origin: 'crafted', name: 'Forged Pistol' } });
    store.seedItem({ id: 'g-found', owner_user_id: A, kind: 'weapon', rarity: 'Epic', item_level: 50, payload: { name: 'Looted Pistol' } });
    expect(((await store.recycleItem(A, nonce(), 'g-relic')) as { scrap_award: number }).scrap_award).toBe(5);
    expect(((await store.recycleItem(A, nonce(), 'g-frame')) as { scrap_award: number }).scrap_award).toBe(15);
    expect(((await store.recycleItem(A, nonce(), 'g-found')) as { scrap_award: number }).scrap_award).toBe(1040);
  });
});

// ---------------------------------------------------------------------------
// 7d + 8. SQL parity — migration 0105 text and catalog
// ---------------------------------------------------------------------------

function sqlCatalog(sql: string): Array<Record<string, unknown>> {
  const start = sql.indexOf('$catalog$') + '$catalog$'.length;
  const end = sql.indexOf('$catalog$', start);
  return JSON.parse(sql.slice(start, end)) as Array<Record<string, unknown>>;
}

describe('adoptions — SQL parity (migration 0105)', () => {
  it('restates cc_recycle_item and cc_vendor_sell with the same caps', () => {
    expect(MIGRATION_0105).toContain('create or replace function public.cc_recycle_item');
    expect(MIGRATION_0105).toContain('least(award, case when is_named_relic then 5 else 15 end)');
    expect(MIGRATION_0105).toContain('create or replace function public.cc_vendor_sell');
    expect(MIGRATION_0105).toContain('least(vendor_value, case when is_named_relic then 250 else 500 end)');
    for (const name of NAMED_RELICS) expect(MIGRATION_0105).toContain(`'${name}'`);
  });

  it('the 0105 catalog differs from 0099 only by maxUnits on the four relic recipes', () => {
    const before = sqlCatalog(MIGRATION_0099);
    const after = sqlCatalog(MIGRATION_0105);
    expect(after).toHaveLength(before.length);
    const diffs: string[] = [];
    for (let i = 0; i < before.length; i += 1) {
      if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) diffs.push(String(after[i].id));
    }
    expect(diffs.sort()).toEqual([...RELIC_RECIPE_IDS].sort());
    for (const row of after) {
      if (RELIC_RECIPE_IDS.includes(String(row.id))) expect(row.maxUnits).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. maxUnits in the TS catalog + enqueue enforcement
// ---------------------------------------------------------------------------

describe('adoptions — ruling 8 (named relic maxUnits 1)', () => {
  it('every named-relic recipe carries maxUnits 1, and no other gear recipe gained one', () => {
    for (const id of RELIC_RECIPE_IDS) expect(getCraftRecipe(id)?.maxUnits, id).toBe(1);
    for (const r of ALL_CRAFT_RECIPES) {
      if (r.namedRelic) expect(r.maxUnits, r.id).toBe(1);
    }
    // TS and SQL catalogs agree on the field for the four recipes.
    const sql = sqlCatalog(MIGRATION_0105);
    for (const id of RELIC_RECIPE_IDS) {
      expect(sql.find((row) => row.id === id)?.maxUnits).toBe(getCraftRecipe(id)?.maxUnits);
    }
  });

  it('enqueue refuses a 2-unit named relic job and accepts 1 unit', async () => {
    const seed: WriteSeed = emptyWriteSeed();
    seed.profiles = [profile({ id: A, materials: { CircuitLattice: 10, PrismShards: 10 } })];
    seed.activeActions = [{
      user_id: A, active_action: 'crafting', started_at: '2026-11-21T11:00:00.000Z',
      completes_at: null, target_type: null, target_id: null, target_label: null,
      scene_key: null, notes: null, activity_payload: {}, public_payload: {},
      last_heartbeat_at: '2026-11-21T11:00:00.000Z', public_visible: true, schema_version: 1,
      updated_at: '2026-11-21T11:00:00.000Z',
    } as WriteSeed['activeActions'][number]];
    const store = new InMemoryWriteStore(seed, { now: () => new Date('2026-11-21T12:00:00.000Z') });
    await expect(
      store.enqueueCraftJob(A, nonce(), { bench: 1, recipeId: 'tool_precision_calipers', units: 2 }),
    ).rejects.toThrow('at most 1 units at a time');
    const ok = await store.enqueueCraftJob(A, nonce(), { bench: 1, recipeId: 'tool_precision_calipers', units: 1 });
    expect(ok).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 9. Leaderboard wash-trade filter
// ---------------------------------------------------------------------------

describe('adoptions — ruling 9 (wash-trade filter)', () => {
  const START = '2026-10-19T00:00:00.000Z';
  const END = '2026-10-26T00:00:00.000Z';
  const profiles = [
    { id: A, username: 'alpha', created_at: '2026-10-01T00:00:00.000Z' },
    { id: B, username: 'bravo', created_at: '2026-10-02T00:00:00.000Z' },
    { id: C, username: 'charlie', created_at: '2026-10-03T00:00:00.000Z' },
  ];
  const sale = (buyer: string, seller: string, price: number, at: string): WeeklyLedgerData => ({
    user_id: buyer,
    action_type: 'cc_accept_listing',
    result_payload: { listing: { seller_user_id: seller, price_credits: price } },
    created_at: at,
  });

  it('counts only sales at 50 cr or more, and never a self-sale', () => {
    const standings = computeRaceStandings({
      profiles,
      endlessRuns: [],
      ledger: [
        sale(B, A, 49, '2026-10-19T10:00:00.000Z'), // under the floor — excluded
        sale(B, A, 50, '2026-10-19T11:00:00.000Z'), // at the floor — counts
        sale(A, A, 5_000, '2026-10-19T12:00:00.000Z'), // self-sale — excluded at any price
        sale(C, A, 500, '2026-10-19T13:00:00.000Z'), // counts
        sale(C, B, 1, '2026-10-19T14:00:00.000Z'), // wash-priced — B never ranks
      ],
    }, 'market_sales', START, END);
    expect(standings.map((s) => [s.player_id, s.value])).toEqual([[A, 2]]);
  });
});

// ---------------------------------------------------------------------------
// 15. AGENTS.md generator rule
// ---------------------------------------------------------------------------

describe('adoptions — ruling 15 (AGENTS.md generator rule)', () => {
  it('keeps the shared substance with the path that exists', () => {
    expect(AGENTS_MD).toContain(
      '**All item generators are shared.** `src/server/lib/generators/*` is imported by BOTH the Chef and the client. One source of truth. Do not create generator copies.',
    );
    expect(AGENTS_MD).not.toContain('`src/lib/generators/*` is imported');
  });
});
