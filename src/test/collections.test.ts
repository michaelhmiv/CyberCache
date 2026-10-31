/**
 * Collections + legendary cores (migration 0026) — shipped-path tests.
 *
 * The laws under test:
 *  - The collection log is a TROPHY RECORD: entries are written only
 *    by server routes at the moment the underlying server-side fact
 *    settles (boss victory applied, item delivered by a market sale,
 *    item salvaged). A request body can never name a discovery.
 *  - The collectible set is finite and completable: 25 legendary
 *    effects + 13 bosses + 36 legendary weapon frames (6 types × 6
 *    manufacturers) + 7 named elites = 81.
 *  - Legendary cores mint ONLY on salvaging a Legendary:
 *    1 + (level ≥ 25) + (level ≥ 50) + (effect weapon), range 1–4.
 *    Scrap multipliers (Market Crash 4×, Scavenger skills) compose
 *    with the SCRAP award and deliberately never touch cores.
 *  - The Legendary Core Catalyst is the in-slice spend: gear-frame
 *    jobs escrow 1 core/unit (Forge, mutually exclusive with the
 *    material catalyst) for +2 generation draws/unit; cancels refund
 *    on the material catalyst's schedule.
 *  - Cores minted/spent and legendaries salvaged land in the daily
 *    economy metrics, reconciled with — never double-counted into —
 *    the legendary creation meters.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  COLLECTION_ENTRIES, COLLECTION_TOTAL, NAMED_ELITES,
  bossDiscovery, collectionEntriesForFamily, discoveryEntriesForItem,
  eliteDiscovery, legendaryCoreYieldFor,
} from '../content/collections';
import { LEGENDARY_EFFECTS } from '../constants/legendaryEffects';
import { REGION_1_BOSSES } from '../constants/bosses';
import { ROAMING_AREAS } from '../constants/roamingAreas';
import { AREA_VISUALS, type RoamingAreaId } from '../content/areaPalettes';
import { Rarity, RiskSetting } from '../types/game';
import type { Weapon } from '../types/items';
import { processBossAttempt, type BossAttemptChefResult, type BossAttemptRequest } from '../server/chef';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, salvageScrap, type WriteItemData, type WriteSeed } from '../server/writes/store';
import { mountReadRoutes } from '../server/reads/routes';
import { InMemoryReadStore, emptyReadSeed, type ReadSeed } from '../server/reads/store';
import type { ProfileRowData } from '../server/reads/store';
import { mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { InMemoryEconomyStore } from '../server/economy/memory';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';

// ─── Catalog ─────────────────────────────────────────────────────────

describe('collection catalog — finite, completable, intel-only', () => {
  it('totals 81 entries across the four families', () => {
    expect(COLLECTION_TOTAL).toBe(81);
    expect(collectionEntriesForFamily('legendary_effect')).toHaveLength(25);
    expect(collectionEntriesForFamily('boss')).toHaveLength(13);
    expect(collectionEntriesForFamily('weapon_frame')).toHaveLength(36);
    expect(collectionEntriesForFamily('named_elite')).toHaveLength(7);
  });

  it('covers every legendary effect and every boss exactly once', () => {
    const effectKeys = new Set(collectionEntriesForFamily('legendary_effect').map((e) => e.key));
    for (const effect of LEGENDARY_EFFECTS) expect(effectKeys.has(effect.id)).toBe(true);
    expect(effectKeys.size).toBe(LEGENDARY_EFFECTS.length);
    const bossKeys = new Set(collectionEntriesForFamily('boss').map((e) => e.key));
    for (const boss of REGION_1_BOSSES) expect(bossKeys.has(boss.id)).toBe(true);
    expect(bossKeys.size).toBe(REGION_1_BOSSES.length);
  });

  it('weapon frames are the full 6 × 6 type × manufacturer grid', () => {
    const frames = collectionEntriesForFamily('weapon_frame').map((e) => e.key);
    expect(new Set(frames).size).toBe(36);
    for (const key of ['Sniper:Prismatek', 'Pistol:Redline', 'Launcher:ThrowTech', 'Beam:HelixWorks']) {
      expect(frames).toContain(key);
    }
  });

  it('named elites match the shipped per-area visual identity (parity)', () => {
    const elites = collectionEntriesForFamily('named_elite');
    expect(elites.map((e) => e.key).sort()).toEqual(ROAMING_AREAS.map((a) => a.id).sort());
    for (const area of ROAMING_AREAS) {
      const fromTable = NAMED_ELITES.find((e) => e.areaId === area.id);
      expect(fromTable?.eliteName).toBe(AREA_VISUALS[area.id as RoamingAreaId]?.eliteName);
      expect(elites.find((e) => e.key === area.id)?.name).toBe(AREA_VISUALS[area.id as RoamingAreaId]?.eliteName);
    }
  });

  it('every entry carries a source hint (intel) and no odds language', () => {
    for (const entry of COLLECTION_ENTRIES) {
      expect(entry.hint.length).toBeGreaterThan(0);
      expect(entry.hint).not.toMatch(/%|odds|chance/i);
    }
  });
});

// ─── Derivation + yield (pure) ───────────────────────────────────────

describe('discovery derivation — reads server item records in every carried shape', () => {
  it('generated Chef shape (flat fields, no kind): effect + frame', () => {
    const entries = discoveryEntriesForItem(
      { rarity: 'Legendary', level: 50, weaponType: 'Sniper', manufacturer: 'Prismatek', legendaryEffectId: 'glass_sun' },
      'boss_loot',
    );
    expect(entries).toEqual([
      { family: 'legendary_effect', entry_key: 'glass_sun', source: 'boss_loot' },
      { family: 'weapon_frame', entry_key: 'Sniper:Prismatek', source: 'boss_loot' },
    ]);
  });

  it('item_instances row shape (payload-nested): effect + frame', () => {
    const entries = discoveryEntriesForItem(
      {
        kind: 'weapon', rarity: 'Legendary', item_level: 12,
        payload: { weaponType: 'Pistol', manufacturer: 'HelixWorks', legendaryEffectId: 'jackpot', rarity: 'Legendary' },
      },
      'market_purchase',
    );
    expect(entries.map((e) => `${e.family}:${e.entry_key}`).sort()).toEqual([
      'legendary_effect:jackpot', 'weapon_frame:Pistol:HelixWorks',
    ]);
  });

  it('frames are Legendary-only; effects log whenever the record carries one', () => {
    const epic = discoveryEntriesForItem(
      { rarity: 'Epic', level: 40, weaponType: 'Pistol', manufacturer: 'Ironwood', legendaryEffectId: 'kickback' },
      'roaming_drop',
    );
    expect(epic).toEqual([{ family: 'legendary_effect', entry_key: 'kickback', source: 'roaming_drop' }]);
    const legendaryNoEffect = discoveryEntriesForItem(
      { rarity: 'Legendary', level: 9, weaponType: 'Beam', manufacturer: 'HelixWorks' },
      'roaming_drop',
    );
    expect(legendaryNoEffect).toEqual([
      { family: 'weapon_frame', entry_key: 'Beam:HelixWorks', source: 'roaming_drop' },
    ]);
  });

  it('non-weapons and unknown effect ids yield nothing spurious', () => {
    expect(discoveryEntriesForItem({ kind: 'shield', rarity: 'Legendary', item_level: 10, payload: {} }, 'salvage')).toEqual([]);
    const unknown = discoveryEntriesForItem(
      { rarity: 'Legendary', weaponType: 'SMG', manufacturer: 'Redline', legendaryEffectId: 'not_a_real_effect' },
      'salvage',
    );
    expect(unknown).toEqual([{ family: 'weapon_frame', entry_key: 'SMG:Redline', source: 'salvage' }]);
  });

  it('boss and elite derivations validate against the catalogs', () => {
    expect(bossDiscovery('ashgut')).toEqual({ family: 'boss', entry_key: 'ashgut', source: 'boss_victory' });
    expect(bossDiscovery('not_a_boss')).toBeNull();
    expect(eliteDiscovery('dustwaste_frontier')).toEqual({
      family: 'named_elite', entry_key: 'dustwaste_frontier', source: 'elite_kill',
    });
    expect(eliteDiscovery('nowhere')).toBeNull();
  });
});

describe('legendary core yield — 1 + level bands + effect weapon, never multiplied', () => {
  const cases: Array<[unknown, number]> = [
    [{ rarity: 'Legendary', item_level: 10, kind: 'shield', payload: {} }, 1],
    [{ rarity: 'Legendary', item_level: 24, kind: 'weapon', payload: { weaponType: 'Pistol' } }, 1],
    [{ rarity: 'Legendary', item_level: 25, kind: 'shield', payload: {} }, 2],
    [{ rarity: 'Legendary', item_level: 49, kind: 'weapon', payload: { legendaryEffectId: 'kickback' } }, 3],
    [{ rarity: 'Legendary', item_level: 50, kind: 'shield', payload: {} }, 3],
    [{ rarity: 'Legendary', level: 50, weaponType: 'Sniper', manufacturer: 'Prismatek', legendaryEffectId: 'glass_sun' }, 4],
    [{ rarity: 'Legendary', item_level: null, kind: 'weapon', payload: { level: 30, legendaryEffectId: 'jackpot', weaponType: 'Pistol' } }, 3],
    [{ rarity: 'Epic', item_level: 90, kind: 'weapon', payload: { legendaryEffectId: 'kickback' } }, 0],
    [{ rarity: 'Rare', item_level: 90, kind: 'weapon', payload: {} }, 0],
  ];
  it.each(cases)('yield %s → %i cores', (item, expected) => {
    expect(legendaryCoreYieldFor(item as never)).toBe(expected);
  });
});

// ─── Migration parity ────────────────────────────────────────────────

describe('migration 0026 — SQL twin parity with the content module', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'db/migrations/0026_collections_cores.sql'),
    'utf8',
  );

  it('backfill hardcodes exactly the shipped effect / boss / area id sets', () => {
    for (const effect of LEGENDARY_EFFECTS) expect(sql).toContain(`'${effect.id}'`);
    for (const boss of REGION_1_BOSSES) expect(sql).toContain(`'${boss.id}'`);
    for (const area of ROAMING_AREAS) expect(sql).toContain(`'${area.id}'`);
  });

  it('carries the cores schema, the discovery RPC, and the catalyst escrow', () => {
    expect(sql).toContain('legendary_cores');
    expect(sql).toContain('cc_record_discoveries');
    expect(sql).toContain('collection_discoveries');
    expect(sql).toContain('escrow_cores');
    expect(sql).toContain('cores_award');
    expect(sql).toContain('legendaries_salvaged');
    expect(sql).toContain('legendary_cores_minted');
    expect(sql).toContain('legendary_cores_spent');
  });
});

// ─── Write paths (recycle / market / craft) ──────────────────────────

const P = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const LEG_SNIPER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const LEG_SHIELD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const LEG_CRASH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const EPIC_GUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const LEG_FORGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const LEG_MARKET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
const LEG_SELLER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 60, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 3, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function gearItem(id: string, owner: string, payload: Record<string, unknown>): WriteItemData {
  return {
    id, owner_user_id: owner, kind: 'weapon', static_item_id: null,
    item_level: (payload.level as number) ?? 1, rarity: payload.rarity as string,
    quality: null, material_tier: null, condition_state: null,
    condition_current: null, condition_max: null,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null, payload,
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 5000,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as WriteItemData;
}

function writeSeed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({
      id: P, credits: 100_000, legendary_cores: 5,
      materials: { RefinedAlloy: 1000, TemperedParts: 1000, ForgeheartIngots: 1000, ScrapAlloy: 1000, ReactiveComponents: 1000 },
    }),
    profile({ id: S, credits: 0 }),
  ];
  s.items = [
    gearItem(LEG_SNIPER, P, { name: 'Glass Sun', rarity: 'Legendary', level: 50, weaponType: 'Sniper', manufacturer: 'Prismatek', element: 'Void', legendaryEffectId: 'glass_sun' }),
    gearItem(LEG_SHIELD, P, { name: 'Aegis Plate', rarity: 'Legendary', level: 10 }),
    gearItem(LEG_CRASH, P, { name: 'Boom Ledger', rarity: 'Legendary', level: 30, weaponType: 'SMG', manufacturer: 'Redline', element: 'Fire', legendaryEffectId: 'market_crash' }),
    gearItem(EPIC_GUN, P, { name: 'Plain Pistol', rarity: 'Epic', level: 40, weaponType: 'Pistol', manufacturer: 'Ironwood' }),
    gearItem(LEG_FORGE, P, { name: 'Dump Launcher', rarity: 'Legendary', level: 5, weaponType: 'Launcher', manufacturer: 'ThrowTech' }),
    gearItem(LEG_MARKET, S, { name: 'Jackpot Pistol', rarity: 'Legendary', level: 12, weaponType: 'Pistol', manufacturer: 'HelixWorks', legendaryEffectId: 'jackpot' }),
    gearItem(LEG_SELLER, S, { name: 'Seller Beam', rarity: 'Legendary', level: 20, weaponType: 'Beam', manufacturer: 'Prismatek' }),
  ];
  // The shield is not a weapon frame — fix its kind for realism.
  s.items[1].kind = 'shield';
  return s;
}

interface WriteHarness { store: InMemoryWriteStore; base: string; close: () => Promise<void>; tokens: Record<string, string> }
let wh: WriteHarness;
let wNonce = 0;
const wnonce = () => `collections-nonce-${++wNonce}-abcdefgh`;

async function makeWriteServer(): Promise<WriteHarness> {
  const store = new InMemoryWriteStore(writeSeed(), {
    now: () => new Date('2026-10-31T12:00:00.000Z'),
    rng: () => 0.5,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
  });
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((r) => server.on('listening', r));
  const { port } = server.address() as AddressInfo;
  const tokens: Record<string, string> = {};
  for (const id of [P, S]) tokens[id] = issueAccessToken(SECRET, id, false);
  return { store, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())), tokens };
}

async function wpost(path: string, token: string, payload: unknown) {
  const res = await fetch(`${wh.base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
async function wget(path: string, token: string) {
  const res = await fetch(`${wh.base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
const wprof = (id: string) => wh.store.seed.profiles.find((p) => p.id === id)!;
const witem = (id: string) => wh.store.seed.items.find((i) => i.id === id)!;
const discKeys = (id: string) => wh.store.discoveriesFor(id).map((d) => `${d.family}:${d.entry_key}`).sort();

describe('collections + cores — shipped write paths', () => {
  beforeAll(async () => { wh = await makeWriteServer(); });
  afterAll(async () => { await wh.close(); });

  it('salvaging a level-50 effect weapon mints 4 cores and logs effect + frame (source: salvage)', async () => {
    const res = await wpost('/api/ops/recycle-item', wh.tokens[P], { nonce: wnonce(), item_id: LEG_SNIPER });
    expect(res.status).toBe(200);
    expect(res.json.cores_award).toBe(4);
    expect(res.json.profile.legendary_cores).toBe(9);
    expect(wprof(P).legendary_cores).toBe(9);
    expect(discKeys(P)).toEqual(['legendary_effect:glass_sun', 'weapon_frame:Sniper:Prismatek']);
    expect(wh.store.discoveriesFor(P).every((d) => d.source === 'salvage')).toBe(true);
  });

  it('a low-level non-weapon legendary yields exactly 1 core and no entries', async () => {
    const res = await wpost('/api/ops/recycle-item', wh.tokens[P], { nonce: wnonce(), item_id: LEG_SHIELD });
    expect(res.status).toBe(200);
    expect(res.json.cores_award).toBe(1);
    expect(wprof(P).legendary_cores).toBe(10);
    expect(discKeys(P)).toHaveLength(2);
  });

  it('Market Crash scales scrap ×4 and leaves cores unmultiplied', async () => {
    const res = await wpost('/api/ops/recycle-item', wh.tokens[P], { nonce: wnonce(), item_id: LEG_CRASH });
    expect(res.status).toBe(200);
    expect(res.json.scrap_award).toBe(4 * salvageScrap('Legendary', 30));
    expect(res.json.cores_award).toBe(3); // 1 base + level≥25 + effect weapon — NOT ×4
    expect(wprof(P).legendary_cores).toBe(13);
    expect(discKeys(P)).toContain('legendary_effect:market_crash');
    expect(discKeys(P)).toContain('weapon_frame:SMG:Redline');
  });

  it('non-legendary salvage mints no cores', async () => {
    const res = await wpost('/api/ops/recycle-item', wh.tokens[P], { nonce: wnonce(), item_id: EPIC_GUN });
    expect(res.status).toBe(200);
    expect(res.json.cores_award).toBe(0);
    expect(wprof(P).legendary_cores).toBe(13);
  });

  it('forged discovery/core claims in the request body are ignored', async () => {
    const res = await wpost('/api/ops/recycle-item', wh.tokens[P], {
      nonce: wnonce(), item_id: LEG_FORGE,
      discoveries: [{ family: 'boss', entry_key: 'sister_null' }],
      legendary_cores: 9999, cores_award: 9999,
    });
    expect(res.status).toBe(200);
    expect(res.json.cores_award).toBe(1);
    expect(wprof(P).legendary_cores).toBe(14);
    expect(discKeys(P)).toContain('weapon_frame:Launcher:ThrowTech');
    expect(discKeys(P)).not.toContain('boss:sister_null');
  });

  it("cannot salvage another player's item", async () => {
    const res = await wpost('/api/ops/recycle-item', wh.tokens[P], { nonce: wnonce(), item_id: LEG_SELLER });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(witem(LEG_SELLER).runtime_state).toBe('available');
    expect(wprof(P).legendary_cores).toBe(14);
    expect(discKeys(S)).toEqual([]);
  });

  it('market purchase delivers the item and logs effect + frame for the buyer only', async () => {
    const created = await wpost('/api/ops/market-create', wh.tokens[S], {
      nonce: wnonce(), item_id: LEG_MARKET, price_credits: 5000,
    });
    expect(created.status).toBe(200);
    const listingId = (created.json.listing as Record<string, unknown>).id as string;
    const accepted = await wpost('/api/ops/market-accept', wh.tokens[P], {
      nonce: wnonce(), listing_id: listingId,
    });
    expect(accepted.status).toBe(200);
    expect(witem(LEG_MARKET).owner_user_id).toBe(P);
    expect(discKeys(P)).toContain('legendary_effect:jackpot');
    expect(discKeys(P)).toContain('weapon_frame:Pistol:HelixWorks');
    expect(wh.store.discoveriesFor(P).find((d) => d.entry_key === 'jackpot')?.source).toBe('market_purchase');
    expect(discKeys(S)).toEqual([]);
  });

  it('core catalyst escrows 1 core per unit and stamps the job', async () => {
    const res = await wpost('/api/ops/craft-enqueue', wh.tokens[P], {
      nonce: wnonce(), bench: 2, recipe_id: 'frame_weapon', units: 2, rarity: 'Rare',
      use_core_catalyst: true,
    });
    expect(res.status).toBe(200);
    expect(res.json.escrow_cores).toBe(2);
    expect(wprof(P).legendary_cores).toBe(12);
    const view = await wget('/api/workshop/me', wh.tokens[P]);
    const job = (view.json.jobs as Array<Record<string, unknown>>).find((j) => j.recipeId === 'frame_weapon');
    expect(job).toBeTruthy();
    expect(job!.coreCatalyst).toBe(true);
    expect(job!.escrowCores).toBe(2);
  });

  it('core catalyst gates: insufficient cores, dual catalysts, consumables, low bench', async () => {
    const jobsBefore = wh.store.seed.craftJobs.length;
    const insufficient = await wpost('/api/ops/craft-enqueue', wh.tokens[P], {
      nonce: wnonce(), bench: 2, recipe_id: 'frame_weapon', units: 20, rarity: 'Rare',
      use_core_catalyst: true,
    });
    expect(insufficient.status).toBeGreaterThanOrEqual(400);
    // The routes layer codes every "Insufficient …" failure as
    // insufficient_funds; with materials and credits plentiful, the
    // only insufficiency here is cores — and the state assertions
    // below prove nothing was escrowed.
    expect(String(insufficient.json.error)).toBe('insufficient_funds');

    const both = await wpost('/api/ops/craft-enqueue', wh.tokens[P], {
      nonce: wnonce(), bench: 2, recipe_id: 'frame_weapon', units: 1, rarity: 'Rare',
      use_catalyst: true, use_core_catalyst: true,
    });
    expect(both.status).toBeGreaterThanOrEqual(400);

    const consumable = await wpost('/api/ops/craft-enqueue', wh.tokens[P], {
      nonce: wnonce(), bench: 2, recipe_id: 'recipe_medkit', units: 1, use_core_catalyst: true,
    });
    expect(consumable.status).toBeGreaterThanOrEqual(400);

    const lowBench = await wpost('/api/ops/craft-enqueue', wh.tokens[P], {
      nonce: wnonce(), bench: 1, recipe_id: 'frame_weapon', units: 1, rarity: 'Common',
      use_core_catalyst: true,
    });
    expect(lowBench.status).toBeGreaterThanOrEqual(400);

    // The routes layer codes failures (insufficient_funds / validation),
    // so the exact gate messages are pinned at the store boundary:
    await expect(wh.store.enqueueCraftJob(P, wnonce(), {
      bench: 2, recipeId: 'frame_weapon', units: 20, rarity: 'Rare', useCoreCatalyst: true,
    })).rejects.toThrow('Insufficient legendary cores');
    await expect(wh.store.enqueueCraftJob(P, wnonce(), {
      bench: 2, recipeId: 'frame_weapon', units: 1, rarity: 'Rare', useCatalyst: true, useCoreCatalyst: true,
    })).rejects.toThrow('Choose one catalyst');
    await expect(wh.store.enqueueCraftJob(P, wnonce(), {
      bench: 2, recipeId: 'recipe_medkit', units: 1, useCoreCatalyst: true,
    })).rejects.toThrow('gear frames only');
    await expect(wh.store.enqueueCraftJob(P, wnonce(), {
      bench: 1, recipeId: 'frame_weapon', units: 1, rarity: 'Common', useCoreCatalyst: true,
    })).rejects.toThrow('Catalysts require the Forge (bench 2)');

    // Nothing escrowed, nothing created by any of the failures.
    expect(wprof(P).legendary_cores).toBe(12);
    expect(wh.store.seed.craftJobs).toHaveLength(jobsBefore);
  });

  it('cancelling the core-catalyst job refunds the escrowed cores in full', async () => {
    const view = await wget('/api/workshop/me', wh.tokens[P]);
    const job = (view.json.jobs as Array<Record<string, unknown>>).find((j) => j.recipeId === 'frame_weapon')!;
    const res = await wpost('/api/ops/craft-cancel', wh.tokens[P], { nonce: wnonce(), job_id: job.id });
    expect(res.status).toBe(200);
    expect(res.json.cores_refunded).toBe(2);
    expect(wprof(P).legendary_cores).toBe(14);
  });

  it('after the scripted sequence, the log matches the underlying records exactly', () => {
    expect(discKeys(P)).toEqual([
      'legendary_effect:glass_sun',
      'legendary_effect:jackpot',
      'legendary_effect:market_crash',
      'weapon_frame:Launcher:ThrowTech',
      'weapon_frame:Pistol:HelixWorks',
      'weapon_frame:SMG:Redline',
      'weapon_frame:Sniper:Prismatek',
    ]);
    // Every recorded discovery is a real catalog entry.
    const catalog = new Set(COLLECTION_ENTRIES.map((e) => `${e.family}:${e.key}`));
    for (const key of discKeys(P)) expect(catalog.has(key)).toBe(true);
    expect(wprof(P).legendary_cores).toBe(14); // 5 seeded + 4 + 1 + 3 + 0 + 1 salvaged, ± catalyst escrow round-trip
  });
});

// ─── Read path ───────────────────────────────────────────────────────

const RA = '11111111-1111-4111-8111-111111111111';
const RD = '44444444-4444-4444-8444-444444444444'; // valid id, no profile

describe('collections read path — GET /api/collections/me', () => {
  let base = '';
  let close: () => Promise<void> = async () => undefined;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const seed: ReadSeed = emptyReadSeed();
    seed.profiles = [profile({ id: RA, legendary_cores: 7 })];
    seed.discoveries = [
      { user_id: RA, family: 'boss', entry_key: 'ashgut', source: 'boss_victory', discovered_at: '2026-10-30T00:00:00.000Z' },
      { user_id: RA, family: 'legendary_effect', entry_key: 'salvage_rights', source: 'boss_loot', discovered_at: '2026-10-30T00:00:00.000Z' },
      { user_id: RA, family: 'weapon_frame', entry_key: 'Shotgun:BlastForge', source: 'boss_loot', discovered_at: '2026-10-30T00:00:00.000Z' },
    ];
    const app = express();
    app.use(express.json());
    mountReadRoutes(app, new InMemoryReadStore(seed, () => new Date('2026-10-31T12:00:00.000Z')), { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    close = () => new Promise<void>((r) => server.close(() => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    tokens[RA] = issueAccessToken(SECRET, RA, false);
    tokens[RD] = issueAccessToken(SECRET, RD, false);
  });
  afterAll(async () => { await close(); });

  it('returns the caller\'s cores balance and discovery rows', async () => {
    const res = await fetch(`${base}/api/collections/me`, { headers: { authorization: `Bearer ${tokens[RA]}` } });
    expect(res.status).toBe(200);
    const json = await res.json() as { legendary_cores: number; discoveries: Array<Record<string, unknown>> };
    expect(json.legendary_cores).toBe(7);
    expect(json.discoveries).toHaveLength(3);
    expect(json.discoveries.map((d) => `${d.family}:${d.entry_key}`).sort()).toEqual([
      'boss:ashgut', 'legendary_effect:salvage_rights', 'weapon_frame:Shotgun:BlastForge',
    ]);
  });

  it('404s for a token whose profile does not exist; 401s without a token', async () => {
    const missing = await fetch(`${base}/api/collections/me`, { headers: { authorization: `Bearer ${tokens[RD]}` } });
    expect(missing.status).toBe(404);
    const anon = await fetch(`${base}/api/collections/me`);
    expect(anon.status).toBe(401);
  });
});

// ─── Gameplay paths (boss victory + Chef salvage) ────────────────────

const GA = '11111111-1111-4111-8111-111111111111';
const openServers: Array<() => Promise<void>> = [];
afterEach(async () => { while (openServers.length) await openServers.pop()?.(); });

async function makeGameServer(store = new InMemoryChefGameplayStore()) {
  const app = express();
  app.use(express.json());
  mountGameplayRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  openServers.push(() => new Promise<void>((r) => server.close(() => r())));
  const { port } = server.address() as AddressInfo;
  return { store, base: `http://127.0.0.1:${port}`, token: issueAccessToken(SECRET, GA, false) };
}

async function gpost(base: string, path: string, body: unknown, token: string) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function strongWeapon(): Weapon {
  return {
    id: 'server-owned-boss-gun', name: 'Server Owned Boss Gun', level: 50,
    rarity: Rarity.Legendary, weaponType: 'SMG' as Weapon['weaponType'],
    manufacturer: 'Redline' as Weapon['manufacturer'], element: 'Fire' as Weapon['element'],
    rollQuality: 100, baseDamage: 10000, attackSpeed: 10, critChance: 0.5, critDamage: 2,
    statusChance: 0, statusDamage: 0, bossDamageMod: 2, waveDamageMod: 0,
    shieldDamageMod: 1, armorDamageMod: 1, offlineEarningsMod: 0, rareDropChanceMod: 0,
    scrapYieldMod: 0, parts: [], affixes: [], sourceTag: 'World Drop' as Weapon['sourceTag'],
    isLocked: false, pixelSeed: 1, combatPower: 0, bossPower: 0, farmPower: 0, economyScore: 0,
  } as Weapon;
}

function findNonce(base: Omit<BossAttemptRequest, 'attemptNonce'>, predicate: (r: BossAttemptChefResult) => boolean) {
  for (let nonce = 1; nonce <= 2000; nonce++) {
    const result = processBossAttempt({ ...base, attemptNonce: nonce });
    if (predicate(result)) return { nonce, expected: result };
  }
  throw new Error('no matching nonce found');
}

describe('collections — shipped gameplay paths', () => {
  it('boss victory records the boss, the dedicated effect, and its frame; forged entries are ignored; replay adds nothing', async () => {
    const { base, store, token } = await makeGameServer();
    const boss = REGION_1_BOSSES.find((b) => b.id === 'ashgut')!;
    store.seedProfile({
      id: GA, player_level: 20, credits: 10000,
      consumables: { MedKit: 5, ShieldCell: 3, AmmoPack: 2 },
      boss_state: { unlockedBossIds: ['dune_tyrant', 'siltstalker', 'heap_guard', 'ashgut'], defeatedBossIds: [], pityCounters: {} },
    });
    const weapon = strongWeapon();
    store.seedItem({
      id: weapon.id, owner_user_id: GA, kind: 'weapon',
      runtime_state: 'equipped', equipped_slot: 'primary',
      payload: weapon as unknown as Record<string, unknown>,
    });
    const prepared = { MedKit: 2, ShieldCell: 1, AmmoPack: 1 };
    const { nonce } = findNonce(
      {
        playerId: GA, bossId: boss.id, primary: weapon, secondary: null, heavy: null,
        ordnance: null, shield: null, classMod: null, relic: null,
        consumables: prepared, risk: RiskSetting.Balanced, playerLevel: 20,
        skillBonuses: {}, pityCount: 0, playerCredits: 10000, entryFee: boss.entryCost,
      },
      (r) => r.result.victory && r.dedicatedDropAwarded,
    );
    const body = {
      playerId: GA, bossId: boss.id, attemptNonce: nonce, consumables: prepared,
      risk: RiskSetting.Balanced,
      // Forged claims riding along with a real victory — must be ignored.
      discoveries: [{ family: 'boss', entry_key: 'vaultkeeper_omega' }, { family: 'named_elite', entry_key: 'helixworks_labyrinth' }],
      legendary_cores: 9999,
    };
    const res = await gpost(base, '/api/verify-boss', body, token);
    expect(res.status).toBe(200);
    expect(res.json.victory).toBe(true);

    const items = (res.json.items ?? []) as Array<{ legendaryEffectId?: string; weaponType?: string; manufacturer?: string }>;
    const dedicated = items.find((i) => i.legendaryEffectId && boss.dedicatedDrops.includes(i.legendaryEffectId))!;
    expect(dedicated).toBeDefined();

    const keys = store.discoveriesFor(GA).map((d) => `${d.family}:${d.entry_key}`);
    expect(keys).toContain('boss:ashgut');
    expect(keys).toContain(`legendary_effect:${dedicated.legendaryEffectId}`);
    expect(keys).toContain(`weapon_frame:${dedicated.weaponType}:${dedicated.manufacturer}`);
    expect(keys).not.toContain('boss:vaultkeeper_omega');
    expect(keys).not.toContain('named_elite:helixworks_labyrinth');
    const bossRow = store.discoveriesFor(GA).find((d) => d.family === 'boss');
    expect(bossRow?.source).toBe('boss_victory');

    // Idempotent replay: same nonce settles nothing twice.
    const countBefore = store.discoveriesFor(GA).length;
    const replay = await gpost(base, '/api/verify-boss', body, token);
    expect(replay.status).toBe(200);
    expect(store.discoveriesFor(GA)).toHaveLength(countBefore);
  });

  it('Chef salvage mints cores into the profile snapshot and logs the item', async () => {
    const { base, store, token } = await makeGameServer();
    store.seedProfile({ id: GA, player_level: 60, credits: 1000, consumables: {}, boss_state: {} });
    store.seedItem({
      id: 'chef-salvage-gun', owner_user_id: GA, kind: 'weapon', runtime_state: 'available', equipped_slot: null,
      rarity: 'Legendary', item_level: 50,
      payload: {
        name: 'Glass Sun', rarity: 'Legendary', level: 50, weaponType: 'Sniper',
        manufacturer: 'Prismatek', legendaryEffectId: 'glass_sun',
      },
    });
    const res = await gpost(base, '/api/salvage', { itemId: 'chef-salvage-gun', nonce: 'chef-salvage-1' }, token);
    expect(res.status).toBe(200);
    expect(res.json.salvaged).toBe(true);
    const profile = res.json.profile as { legendary_cores?: number };
    expect(profile.legendary_cores).toBe(4);
    const keys = store.discoveriesFor(GA).map((d) => `${d.family}:${d.entry_key}`).sort();
    expect(keys).toEqual(['legendary_effect:glass_sun', 'weapon_frame:Sniper:Prismatek']);
  });
});

// ─── Economy metrics ─────────────────────────────────────────────────

describe('economy metrics — cores meters reconcile, never double-count', () => {
  it('counts salvaged legendaries, minted cores, and net catalyst spend from the ledger', async () => {
    const store = new InMemoryEconomyStore({
      config: {},
      items: [],
      ledger: [
        { action_type: 'cc_recycle_item', created_at: '2026-10-31T08:00:00.000Z', result_payload: { item: { rarity: 'Legendary' }, cores_award: 4, scrap_award: 900 } },
        { action_type: 'cc_recycle_item', created_at: '2026-10-31T09:00:00.000Z', result_payload: { item: { rarity: 'Common' }, cores_award: 0, scrap_award: 12 } },
        { action_type: 'cc_enqueue_craft_job', created_at: '2026-10-31T10:00:00.000Z', result_payload: { job: { escrow_cores: 2 } } },
        { action_type: 'cc_cancel_craft_job', created_at: '2026-10-31T11:00:00.000Z', result_payload: { cores_refunded: 1 } },
      ],
    });
    const row = await store.computeMetricsForDay('2026-10-31');
    expect(row.legendariesSalvaged).toBe(1);
    expect(row.legendaryCoresMinted).toBe(4);
    expect(row.legendaryCoresSpent).toBe(1); // 2 escrowed − 1 refunded
  });
});
