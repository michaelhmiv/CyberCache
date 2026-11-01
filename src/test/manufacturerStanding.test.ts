/**
 * Manufacturer Standing (0043) — the slice test suite, mirroring the
 * brief's §2.10 skeleton:
 *
 *   1. Content: the six independent ladders (R6), rank thresholds and
 *      tributes verbatim (R7: 410,000 cr + 3 items per ladder), the
 *      30 flavor titles, and the unlock catalog's shape.
 *   2. The no-power law: unlock defs carry no stat/drop/price fields
 *      (structural key whitelist), and every unlock id has a real
 *      registered consumer whose needle exists in its file (#216
 *      discipline).
 *   3. Levers: defaults + clamps pinned against the economy registry
 *      (the ONE accessor in src/server/economy/config.ts).
 *   4. Turn-in math: award = max(1, round(scrap/divisor)) over the
 *      shipped salvage scrap value (cc_salvage_scrap's TS twin),
 *      Market Crash ×4, Scavenger bonuses never applied; the
 *      eligibility matrix (0027 reforge rule, vehicles out).
 *   5. The in-memory store (the SQL twin's mirror): turn-ins pay
 *      standing ONLY (a turned-in Legendary mints zero cores, zero
 *      scrap), nonce replay pays once, drip cap per UTC day, rank-up
 *      gates (threshold, tribute credits, tribute item), the balance
 *      is never spent by ranking, Rep Shelf / Parts Crate cadence,
 *      Signature Order corpus (Rare–Epic, never Legendary, origin
 *      standing_order), guest refusal, cross-manufacturer isolation.
 *   6. The craft gate on the writes twin: standing_required until
 *      the granted rank reaches 2.
 *   7. The economy twin fold: standing meters from ledger rows, the
 *      destroyed total joins exactly once, turned-in legendaries
 *      never count as salvaged.
 *   8. Routes over real HTTP: JWT identity, forged bodies ignored,
 *      guest read-only, refusal status mapping.
 *   9. Migration 0043 textual pins: cc_standing_catalog == the TS
 *      offers, the restated craft catalog (58 recipes, the 6 standing
 *      recipes deep-equal, the 0038 research gate survives), the
 *      restated enqueue keeps BOTH gates, quality bounds gained the
 *      6 types, and the restated metrics fold keeps the Research and
 *      Contracts meters while adding the standing folds.
 *
 * The SQL functions themselves are exercised end-to-end by the
 * slice's embedded-Postgres harness (full chain 0001→0043); these
 * pins keep the TS and SQL twins from drifting apart.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  STANDING_COSMETICS,
  STANDING_CRATE_CONTENTS,
  STANDING_LEVER_CLAMPS,
  STANDING_LEVER_DEFAULTS,
  STANDING_MANUFACTURERS,
  STANDING_OFFERS,
  STANDING_RANKS,
  STANDING_RECIPE_TYPES,
  STANDING_SHELF_TYPES,
  STANDING_TITLES,
  STANDING_TOTAL_TRIBUTE_CREDITS,
  STANDING_UNLOCKS,
  STANDING_UNLOCK_CONSUMERS,
  buildStandingStateView,
  highestEarnedRank,
  isStandingManufacturer,
  isoWeekKey,
  manufacturerSlug,
  rarityMeetsMinimum,
  resolveStandingLevers,
  standingOffer,
  standingRankDef,
  standingTributeCredits,
  standingTurnInAward,
  standingTurnInRefusal,
  standingUnlockId,
  utcDayKey,
  type StandingFacts,
  type StandingLeverValues,
} from '@/content/manufacturerStanding';
import { ALL_CRAFT_RECIPES } from '@/content/crafting';
import { CONSUMABLES } from '@/constants/consumables';
import { MANUFACTURERS } from '@/constants/manufacturers';
import { salvageScrap } from '@/lib/skills/salvageBonuses';
import { Manufacturer, Rarity } from '@/types/game';
import {
  ECONOMY_CONFIG_DEFAULTS,
  ECONOMY_CONFIG_KEYS,
} from '../server/economy/config';
import { InMemoryEconomyStore } from '../server/economy/memory';
import { mountChefHealthRoute, mountStandingRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { generateStandingOrderWeapon } from '../server/gameplay/standingOrder';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';

type Json = Record<string, unknown>;

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const GUEST = '33333333-3333-4333-8333-333333333333';

const MIGRATION = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0043_manufacturer_standing.sql'),
  'utf8',
);

// ---------------------------------------------------------------------------
// 1. Content — ladders, ranks, tributes, titles
// ---------------------------------------------------------------------------

describe('standing content — ladders and ranks', () => {
  it('ships exactly the six manufacturers, in desk order', () => {
    expect(STANDING_MANUFACTURERS).toEqual([
      Manufacturer.Redline,
      Manufacturer.Ironwood,
      Manufacturer.BlastForge,
      Manufacturer.Prismatek,
      Manufacturer.ThrowTech,
      Manufacturer.HelixWorks,
    ]);
    for (const m of STANDING_MANUFACTURERS) {
      expect(isStandingManufacturer(m)).toBe(true);
      expect(MANUFACTURERS[m].name).toBe(m);
    }
    expect(isStandingManufacturer('Acme')).toBe(false);
    expect(isStandingManufacturer(null)).toBe(false);
    expect(manufacturerSlug(Manufacturer.BlastForge)).toBe('blastforge');
  });

  it('rank thresholds and tributes are the brief numbers verbatim (R7)', () => {
    expect(STANDING_RANKS.map((r) => r.rank)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(STANDING_RANKS.map((r) => r.threshold)).toEqual([0, 500, 2_000, 5_000, 11_000, 25_000]);
    expect(STANDING_RANKS.map((r) => r.tributeCredits)).toEqual([0, 5_000, 15_000, 40_000, 100_000, 250_000]);
    expect(STANDING_RANKS.map((r) => r.tributeMinRarity)).toEqual([
      null, null, null, Rarity.Rare, Rarity.Epic, Rarity.Epic,
    ]);
    expect(STANDING_RANKS.map((r) => r.title)).toEqual([
      'Unknown', 'Recognized', 'Supplier', 'Partner', 'Insider', 'Factory Friend',
    ]);
    // R7: the full ladder costs 410,000 credits + 3 tribute items.
    expect(STANDING_TOTAL_TRIBUTE_CREDITS).toBe(410_000);
    expect(STANDING_RANKS.filter((r) => r.tributeMinRarity !== null)).toHaveLength(3);
  });

  it('every manufacturer has five flavor titles (30 strings, Q5 drafts)', () => {
    for (const m of STANDING_MANUFACTURERS) {
      expect(STANDING_TITLES[m]).toHaveLength(5);
      expect(new Set(STANDING_TITLES[m]).size).toBe(5);
      for (const title of STANDING_TITLES[m]) expect(title.length).toBeGreaterThan(2);
    }
  });

  it('earned rank derives from the balance; granted rank is separate', () => {
    expect(highestEarnedRank(0)).toBe(0);
    expect(highestEarnedRank(499)).toBe(0);
    expect(highestEarnedRank(500)).toBe(1);
    expect(highestEarnedRank(4_999)).toBe(2);
    expect(highestEarnedRank(24_999)).toBe(4);
    expect(highestEarnedRank(25_000)).toBe(5);
    expect(highestEarnedRank(10_000_000)).toBe(5);
    expect(standingRankDef(3).title).toBe('Partner');
  });

  it('tribute credits scale by the lever scalar, rounded', () => {
    expect(standingTributeCredits(1, 1)).toBe(5_000);
    expect(standingTributeCredits(5, 1)).toBe(250_000);
    expect(standingTributeCredits(5, 0.5)).toBe(125_000);
    expect(standingTributeCredits(3, 1.333)).toBe(53_320);
    expect(standingTributeCredits(0, 2)).toBe(0);
  });

  it('rarity meets-minimum follows the rarity ladder', () => {
    expect(rarityMeetsMinimum('Rare', Rarity.Rare)).toBe(true);
    expect(rarityMeetsMinimum('Epic', Rarity.Rare)).toBe(true);
    expect(rarityMeetsMinimum('Legendary', Rarity.Epic)).toBe(true);
    expect(rarityMeetsMinimum('Uncommon', Rarity.Rare)).toBe(false);
    expect(rarityMeetsMinimum(null, Rarity.Rare)).toBe(false);
    expect(rarityMeetsMinimum('Mythic', Rarity.Rare)).toBe(false);
  });
});

describe('standing content — the unlock catalog', () => {
  it('one unlock per rank per manufacturer (30), identical shape', () => {
    expect(STANDING_UNLOCKS).toHaveLength(30);
    expect(new Set(STANDING_UNLOCKS.map((u) => u.id)).size).toBe(30);
    for (const m of STANDING_MANUFACTURERS) {
      const mine = STANDING_UNLOCKS.filter((u) => u.manufacturer === m);
      expect(mine.map((u) => u.rank)).toEqual([1, 2, 3, 4, 5]);
      expect(mine.map((u) => u.kind)).toEqual(['shelf', 'recipe', 'cosmetic', 'crate', 'order']);
      for (const u of mine) {
        expect(u.id).toBe(standingUnlockId(m, u.kind));
        expect(u.label.length).toBeGreaterThan(3);
        expect(u.detail.length).toBeGreaterThan(10);
      }
    }
  });

  it('NO-POWER LAW: unlock defs carry access fields only — no stats, drops, or prices', () => {
    const allowed = ['detail', 'id', 'kind', 'label', 'manufacturer', 'rank'];
    for (const u of STANDING_UNLOCKS) {
      expect(Object.keys(u).sort()).toEqual(allowed);
    }
  });

  it('every unlock id has a registered consumer whose needle exists in its file', () => {
    expect(Object.keys(STANDING_UNLOCK_CONSUMERS).sort())
      .toEqual(STANDING_UNLOCKS.map((u) => u.id).sort());
    for (const [id, consumer] of Object.entries(STANDING_UNLOCK_CONSUMERS)) {
      const text = readFileSync(join(process.cwd(), consumer.file), 'utf8');
      expect(text, `${id} → ${consumer.file}`).toContain(consumer.needle);
    }
  });

  it('shelf picks are vendor-stocked consumables sold at list price', () => {
    for (const m of STANDING_MANUFACTURERS) {
      const shelf = STANDING_SHELF_TYPES[m];
      const def = CONSUMABLES[shelf.consumableType as keyof typeof CONSUMABLES];
      expect(def, `${m} shelf type`).toBeTruthy();
      expect(def.market.vendorExcluded).toBeFalsy();
      expect(def.market.vendorPrice).toBe(shelf.priceCredits);
    }
    expect(STANDING_SHELF_TYPES[Manufacturer.Redline]).toEqual({ consumableType: 'OverchargeStim', priceCredits: 800 });
    expect(STANDING_SHELF_TYPES[Manufacturer.HelixWorks]).toEqual({ consumableType: 'LuckBooster', priceCredits: 350 });
  });

  it('exclusive recipe outputs exist, are vendor-excluded, and match the recipe table', () => {
    for (const m of STANDING_MANUFACTURERS) {
      const entry = STANDING_RECIPE_TYPES[m];
      const def = CONSUMABLES[entry.consumableType as keyof typeof CONSUMABLES];
      expect(def, `${m} recipe output`).toBeTruthy();
      expect(def.market.vendorExcluded).toBe(true);
      const recipe = ALL_CRAFT_RECIPES.find((r) => r.id === entry.recipeId);
      expect(recipe, entry.recipeId).toBeTruthy();
      expect(recipe!.consumableType).toBe(entry.consumableType);
      expect(recipe!.name).toBe(entry.name);
      expect(recipe!.requiresStanding).toEqual({ manufacturer: m, rank: 2 });
    }
    // Exactly six recipes in the whole catalog carry a standing gate.
    expect(ALL_CRAFT_RECIPES.filter((r) => r.requiresStanding)).toHaveLength(6);
  });

  it('cosmetics name a shipped head variant + sprite per manufacturer', () => {
    for (const m of STANDING_MANUFACTURERS) {
      const c = STANDING_COSMETICS[m];
      expect(c.headVariantId).toBe(`mfr-${manufacturerSlug(m)}`);
      expect(c.spriteId).toBe(`hunter-head-${manufacturerSlug(m)}`);
    }
  });

  it('offers: 12 (shelf rank 1 + crate rank 4 per manufacturer), contents match the tables', () => {
    expect(STANDING_OFFERS).toHaveLength(12);
    for (const m of STANDING_MANUFACTURERS) {
      const shelf = standingOffer(`shelf:${m}`);
      expect(shelf).toMatchObject({
        manufacturer: m, kind: 'shelf', rankRequired: 1,
        priceCredits: STANDING_SHELF_TYPES[m].priceCredits,
        consumableType: STANDING_SHELF_TYPES[m].consumableType,
      });
      const crate = standingOffer(`crate:${m}`);
      expect(crate).toMatchObject({
        manufacturer: m, kind: 'crate', rankRequired: 4,
        priceCredits: STANDING_CRATE_CONTENTS[m].priceCredits,
        consumableType: null,
        materials: STANDING_CRATE_CONTENTS[m].materials,
        essences: STANDING_CRATE_CONTENTS[m].essences,
      });
    }
    expect(standingOffer('shelf:Acme')).toBeNull();
    expect(standingOffer('order:Redline')).toBeNull();
  });

  it('the state view derives unlocks, next-rank math, and availability from facts', () => {
    const facts: StandingFacts = {
      accountType: 'verified',
      canUsePlayerEconomy: true,
      credits: 60_000,
      playerLevel: 25,
      rows: [{ manufacturer: 'Redline', standing: 6_320, rank: 3 }],
      weeklyPurchases: [{ manufacturer: 'Redline', kind: 'crate' }],
    };
    const view = buildStandingStateView(facts);
    const redline = view.manufacturers[0];
    expect(redline.manufacturer).toBe(Manufacturer.Redline);
    expect(redline.earnedRank).toBe(3);
    expect(redline.rankTitle).toBe(STANDING_TITLES[Manufacturer.Redline][2]);
    expect(redline.nextRank).toMatchObject({
      rank: 4, threshold: 11_000, standingNeeded: 4_680,
      tributeCredits: 100_000, tributeMinRarity: Rarity.Epic,
      canAffordTribute: false, thresholdMet: false,
    });
    expect(redline.unlocks.filter((u) => u.state === 'owned').map((u) => u.rank)).toEqual([1, 2, 3]);
    expect(redline.shelf.available).toBe(true);
    expect(redline.crate.boughtThisWeek).toBe(true);
    expect(redline.crate.available).toBe(false); // rank 3 < 4 anyway
    expect(redline.order.available).toBe(false);
    const ironwood = view.manufacturers[1];
    expect(ironwood.standing).toBe(0);
    expect(ironwood.nextRank).toMatchObject({ rank: 1, threshold: 500, tributeCredits: 5_000 });
    expect(view.totalStanding).toBe(6_320);
    expect(view.totalRanks).toBe(3);
  });

  it('calendar helpers: UTC day + ISO week keys', () => {
    expect(utcDayKey(new Date('2026-11-01T23:59:59.000Z'))).toBe('2026-11-01');
    expect(isoWeekKey(new Date('2026-11-01T12:00:00.000Z'))).toBe('2026-W44');
    expect(isoWeekKey(new Date('2026-11-02T00:00:00.000Z'))).toBe('2026-W45');
    expect(isoWeekKey(new Date('2027-01-01T00:00:00.000Z'))).toBe('2026-W53');
  });
});

// ---------------------------------------------------------------------------
// 2. Levers — pinned against the ONE economy registry
// ---------------------------------------------------------------------------

describe('standing levers — registry pins', () => {
  it('defaults are the brief numbers', () => {
    expect(STANDING_LEVER_DEFAULTS).toEqual({
      standingScrapDivisor: 10,
      standingPerKill: 1,
      standingDripDailyCap: 100,
      standingTributeScalar: 1,
      standingOrderPrice: 150_000,
      standingOrderEnabled: 1,
    });
    expect(resolveStandingLevers()).toEqual(STANDING_LEVER_DEFAULTS);
  });

  it('every lever default + clamp matches src/server/economy/config.ts', () => {
    for (const key of Object.keys(STANDING_LEVER_DEFAULTS) as Array<keyof StandingLeverValues>) {
      expect(ECONOMY_CONFIG_DEFAULTS[key], key).toBe(STANDING_LEVER_DEFAULTS[key]);
      const spec = ECONOMY_CONFIG_KEYS[key];
      expect(spec, key).toBeTruthy();
      expect(spec.min, key).toBe(STANDING_LEVER_CLAMPS[key].min);
      expect(spec.max, key).toBe(STANDING_LEVER_CLAMPS[key].max);
      expect(spec.integer, key).toBe(STANDING_LEVER_CLAMPS[key].integer);
    }
  });

  it('resolution clamps and truncates exactly like the registry', () => {
    expect(resolveStandingLevers({ standingScrapDivisor: 1_000 }).standingScrapDivisor).toBe(50);
    expect(resolveStandingLevers({ standingScrapDivisor: 0 }).standingScrapDivisor).toBe(2);
    expect(resolveStandingLevers({ standingPerKill: -3 }).standingPerKill).toBe(0);
    expect(resolveStandingLevers({ standingDripDailyCap: 100.9 }).standingDripDailyCap).toBe(100);
    expect(resolveStandingLevers({ standingOrderEnabled: 7 }).standingOrderEnabled).toBe(1);
    expect(resolveStandingLevers({ standingOrderPrice: -5 }).standingOrderPrice).toBe(0);
    expect(resolveStandingLevers({ standingTributeScalar: Number.NaN }).standingTributeScalar).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Turn-in math + eligibility (pure)
// ---------------------------------------------------------------------------

describe('turn-in math — award over the shipped scrap value', () => {
  it('award = max(1, round(scrap / divisor)) across the rarity × level corpus', () => {
    for (const rarity of ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']) {
      for (const level of [1, 5, 12, 25, 40, 75]) {
        const expected = Math.max(1, Math.round(salvageScrap(rarity, level) / 10));
        expect(
          standingTurnInAward({ rarity, itemLevel: level }, 10),
          `${rarity} L${level}`,
        ).toBe(expected);
      }
    }
    // The brief's worked shape: a mid-level Rare is worth real standing.
    expect(standingTurnInAward({ rarity: 'Rare', itemLevel: 25 }, 10))
      .toBe(Math.round(salvageScrap('Rare', 25) / 10));
  });

  it('Market Crash legendaries pay ×4 base, like cc_recycle_item', () => {
    const plain = standingTurnInAward({ rarity: 'Legendary', itemLevel: 20 }, 10);
    const crash = standingTurnInAward(
      { rarity: 'Legendary', itemLevel: 20, legendaryEffectId: 'market_crash' }, 10);
    expect(crash).toBe(Math.max(1, Math.round((salvageScrap('Legendary', 20) * 4) / 10)));
    expect(crash).toBeGreaterThan(plain);
    // Other legendary effects do not multiply.
    expect(standingTurnInAward(
      { rarity: 'Legendary', itemLevel: 20, legendaryEffectId: 'chain_lightning' }, 10,
    )).toBe(plain);
  });

  it('the floor is 1: even a worthless Common turns in for a point', () => {
    expect(standingTurnInAward({ rarity: 'Common', itemLevel: 1 }, 50)).toBe(1);
    expect(standingTurnInAward({ rarity: null, itemLevel: 1 }, 10))
      .toBe(Math.max(1, Math.round(salvageScrap('Common', 1) / 10)));
  });

  it('eligibility matrix — the 0027 rule with vehicles out', () => {
    const base = {
      kind: 'weapon', runtimeState: 'available', isLocked: false,
      equippedSlot: null, rarity: 'Rare', itemLevel: 10, manufacturer: 'Redline',
    };
    expect(standingTurnInRefusal(base)).toBeNull();
    expect(standingTurnInRefusal({ ...base, kind: 'vehicle' }))
      .toBe('Vehicles cannot be turned in for standing');
    expect(standingTurnInRefusal({ ...base, manufacturer: null }))
      .toBe('Item has no manufacturer standing');
    expect(standingTurnInRefusal({ ...base, manufacturer: 'Acme' }))
      .toBe('Item has no manufacturer standing');
    expect(standingTurnInRefusal({ ...base, isLocked: true })).toBe('Locked item');
    expect(standingTurnInRefusal({ ...base, equippedSlot: 'primary' }))
      .toBe('Unequip the item before turning it in');
    expect(standingTurnInRefusal({ ...base, runtimeState: 'listed' })).toBe('Item is not available');
    expect(standingTurnInRefusal({ ...base, runtimeState: 'consumed' })).toBe('Item is not available');
    // Non-weapon gear kinds with a manufacturer are eligible.
    expect(standingTurnInRefusal({ ...base, kind: 'shield' })).toBeNull();
    expect(standingTurnInRefusal({ ...base, kind: 'relic' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. The in-memory store — the SQL twin's mirror
// ---------------------------------------------------------------------------

describe('standing store (in-memory twin)', () => {
  function makeStore(startIso = '2026-11-01T12:00:00.000Z', levers?: Partial<StandingLeverValues>) {
    let now = new Date(startIso);
    const provider = levers ? () => levers : undefined;
    const store = new InMemoryChefGameplayStore(
      () => now, undefined, undefined, undefined, undefined, undefined, undefined, provider,
    );
    return { store, setNow: (iso: string) => { now = new Date(iso); } };
  }

  function seedVerified(store: InMemoryChefGameplayStore, id: string, overrides: Json = {}) {
    store.seedProfile({ id, player_level: 25, credits: 1_000_000, ...overrides } as never);
    const rec = store.profiles.get(id) as unknown as Record<string, unknown>;
    rec.account_type = 'verified';
    rec.email_verified_at = '2026-10-01T00:00:00.000Z';
  }

  function seedGuest(store: InMemoryChefGameplayStore, id: string) {
    store.seedProfile({ id, player_level: 25, credits: 1_000_000 } as never);
    (store.profiles.get(id) as unknown as Record<string, unknown>).account_type = 'guest';
  }

  let itemSeq = 0;
  function seedItem(
    store: InMemoryChefGameplayStore,
    owner: string,
    overrides: Json = {},
  ): string {
    itemSeq += 1;
    const id = `standing-item-${itemSeq}`;
    store.seedItem({
      id,
      owner_user_id: owner,
      kind: 'weapon',
      rarity: 'Rare',
      item_level: 25,
      payload: { manufacturer: 'Redline', weaponType: 'SMG' },
      ...overrides,
    } as never);
    return id;
  }

  function grant(store: InMemoryChefGameplayStore, id: string, mfr: string, standing: number, rank: number) {
    store.standingRows.set(`${id}:${mfr}`, { standing, rank });
  }

  it('turn-in destroys the item and pays standing only — no scrap, no cores, no materials', async () => {
    const { store } = makeStore();
    seedVerified(store, A);
    const profile = store.profiles.get(A)!;
    profile.materials = { BallisticParts: 7 };
    // A Legendary with a core yield if it were recycled instead.
    const itemId = seedItem(store, A, {
      rarity: 'Legendary',
      payload: { manufacturer: 'Redline', weaponType: 'SMG', legendaryEffectId: 'chain_lightning' },
    });
    const result = await store.turnInItem(A, 'turn-in-nonce-001', itemId) as Json;
    const expectedAward = standingTurnInAward({ rarity: 'Legendary', itemLevel: 25 }, 10);
    expect(result.standing_awarded).toBe(expectedAward);
    expect(result.new_balance).toBe(expectedAward);
    expect(result.manufacturer).toBe('Redline');
    expect(store.items.get(itemId)!.runtime_state).toBe('consumed');
    // Standing pays reputation ONLY.
    expect(profile.credits).toBe(1_000_000);
    expect(profile.scrap).toBe(0);
    expect(profile.legendary_cores).toBe(0);
    expect(profile.materials).toEqual({ BallisticParts: 7 });
    expect(profile.consumables).toEqual({});
  });

  it('nonce replay pays once and returns the stored result', async () => {
    const { store } = makeStore();
    seedVerified(store, A);
    const itemId = seedItem(store, A);
    const first = await store.turnInItem(A, 'turn-in-nonce-002', itemId) as Json;
    const replay = await store.turnInItem(A, 'turn-in-nonce-002', itemId) as Json;
    expect(replay).toEqual(first);
    const facts = await store.getStandingFacts(A);
    expect(facts!.rows).toEqual([
      { manufacturer: 'Redline', standing: first.standing_awarded, rank: 0 },
    ]);
    // A fresh nonce on the consumed item refuses.
    await expect(store.turnInItem(A, 'turn-in-nonce-003', itemId))
      .rejects.toThrow('Item is not available');
  });

  it('turn-in refusal matrix at the store boundary', async () => {
    const { store } = makeStore();
    seedVerified(store, A);
    seedVerified(store, B);
    const foreign = seedItem(store, B);
    await expect(store.turnInItem(A, 'nonce-foreign-01', foreign)).rejects.toThrow('Item not found');
    const vehicle = seedItem(store, A, { kind: 'vehicle', payload: { manufacturer: 'Redline' } });
    await expect(store.turnInItem(A, 'nonce-vehicle-01', vehicle))
      .rejects.toThrow('Vehicles cannot be turned in for standing');
    const locked = seedItem(store, A, { is_locked: true });
    await expect(store.turnInItem(A, 'nonce-locked-001', locked)).rejects.toThrow('Locked item');
    const equipped = seedItem(store, A, { equipped_slot: 'primary', runtime_state: 'equipped' });
    await expect(store.turnInItem(A, 'nonce-equipped-1', equipped)).rejects.toThrow('Unequip');
    const noMaker = seedItem(store, A, { payload: { weaponType: 'SMG' } });
    await expect(store.turnInItem(A, 'nonce-nomaker-01', noMaker))
      .rejects.toThrow('Item has no manufacturer standing');
    await expect(store.turnInItem(A, 'short', seedItem(store, A))).rejects.toThrow('nonce is required');
  });

  it('turn-ins refuse at max rank (the ladder is full — nothing to earn)', async () => {
    const { store } = makeStore();
    seedVerified(store, A);
    grant(store, A, 'Redline', 30_000, 5);
    const itemId = seedItem(store, A);
    await expect(store.turnInItem(A, 'nonce-maxrank-01', itemId))
      .rejects.toThrow('Already at maximum rank with Redline');
    expect(store.items.get(itemId)!.runtime_state).toBe('available');
  });

  it('R6 isolation: earning and ranking on one ladder never touches another', async () => {
    const { store } = makeStore();
    seedVerified(store, A);
    const itemId = seedItem(store, A, { payload: { manufacturer: 'Ironwood', weaponType: 'Sniper' } });
    await store.turnInItem(A, 'nonce-r6-isolate1', itemId);
    await store.accrueManufacturerStanding(A, 'Ironwood', 10);
    const facts = await store.getStandingFacts(A);
    expect(facts!.rows.map((r) => r.manufacturer)).toEqual(['Ironwood']);
    expect(store.standingRows.has(`${A}:Redline`)).toBe(false);
    // Ranking Ironwood leaves a seeded Redline row untouched.
    grant(store, A, 'Redline', 700, 1);
    grant(store, A, 'Ironwood', 600, 0);
    await store.rankUpManufacturer(A, 'nonce-r6-isolate2', 'Ironwood', null);
    expect(store.standingRows.get(`${A}:Ironwood`)).toEqual({ standing: 600, rank: 1 });
    expect(store.standingRows.get(`${A}:Redline`)).toEqual({ standing: 700, rank: 1 });
  });

  it('drip accrues per kill, caps per manufacturer per UTC day, resets next day', async () => {
    const { store, setNow } = makeStore('2026-11-01T23:30:00.000Z');
    seedVerified(store, A);
    const first = await store.accrueManufacturerStanding(A, 'Redline', 30) as Json;
    expect(first).toMatchObject({ points: 30, cap_remaining: 70, balance: 30 });
    const second = await store.accrueManufacturerStanding(A, 'Redline', 90) as Json;
    expect(second).toMatchObject({ points: 70, cap_remaining: 0, balance: 100 });
    const third = await store.accrueManufacturerStanding(A, 'Redline', 10) as Json;
    expect(third.points).toBe(0);
    // A different manufacturer has its own cap.
    const other = await store.accrueManufacturerStanding(A, 'Ironwood', 5) as Json;
    expect(other.points).toBe(5);
    // Next UTC day: the cap resets (the balance keeps accumulating).
    setNow('2026-11-02T00:15:00.000Z');
    const nextDay = await store.accrueManufacturerStanding(A, 'Redline', 10) as Json;
    expect(nextDay).toMatchObject({ points: 10, cap_remaining: 90, balance: 110 });
    // Unknown manufacturers and zero kills are fact-only no-ops.
    expect((await store.accrueManufacturerStanding(A, 'Acme', 10) as Json).points).toBe(0);
    expect((await store.accrueManufacturerStanding(A, 'Redline', 0) as Json).points).toBe(0);
  });

  it('rank-up: threshold gate, tribute destroyed, balance NOT spent, replay pays once', async () => {
    const { store } = makeStore();
    seedVerified(store, A);
    grant(store, A, 'Redline', 499, 0);
    await expect(store.rankUpManufacturer(A, 'nonce-rankup-001', 'Redline', null))
      .rejects.toThrow('Requires 500 standing with Redline');
    grant(store, A, 'Redline', 500, 0);
    const before = store.profiles.get(A)!.credits;
    const result = await store.rankUpManufacturer(A, 'nonce-rankup-002', 'Redline', null) as Json;
    expect(result).toMatchObject({
      new_rank: 1, tribute_credits: 5_000, tribute_item_id: null, standing_balance: 500,
    });
    expect(store.profiles.get(A)!.credits).toBe(before - 5_000);
    // The standing balance survives ranking — rank is granted, not bought with points.
    expect(store.standingRows.get(`${A}:Redline`)).toEqual({ standing: 500, rank: 1 });
    const replay = await store.rankUpManufacturer(A, 'nonce-rankup-002', 'Redline', null) as Json;
    expect(replay).toEqual(result);
    expect(store.profiles.get(A)!.credits).toBe(before - 5_000);
  });

  it('rank-up refuses insufficient credits and unknown manufacturers', async () => {
    const { store } = makeStore();
    seedVerified(store, A, { credits: 4_999 });
    grant(store, A, 'Redline', 500, 0);
    await expect(store.rankUpManufacturer(A, 'nonce-rankup-003', 'Redline', null))
      .rejects.toThrow('Insufficient credits');
    await expect(store.rankUpManufacturer(A, 'nonce-rankup-004', 'Acme', null))
      .rejects.toThrow('Unknown manufacturer');
    expect(store.standingRows.get(`${A}:Redline`)!.rank).toBe(0);
  });

  it('rank 3+ tribute items: required, same-manufacturer, rarity floor, destroyed, pays no standing', async () => {
    const { store } = makeStore();
    seedVerified(store, A);
    grant(store, A, 'Redline', 5_000, 2);
    // Missing item.
    await expect(store.rankUpManufacturer(A, 'nonce-tribute-01', 'Redline', null))
      .rejects.toThrow('requires a tribute item of Rare rarity or better');
    // Wrong manufacturer.
    const wrongMaker = seedItem(store, A, { payload: { manufacturer: 'Ironwood', weaponType: 'Sniper' } });
    await expect(store.rankUpManufacturer(A, 'nonce-tribute-02', 'Redline', wrongMaker))
      .rejects.toThrow('Tribute item must be made by Redline');
    // Below the rarity floor.
    const tooLow = seedItem(store, A, { rarity: 'Uncommon' });
    await expect(store.rankUpManufacturer(A, 'nonce-tribute-03', 'Redline', tooLow))
      .rejects.toThrow('Tribute item must be Rare rarity or better');
    // A good tribute: destroyed, 40,000 cr charged, balance untouched.
    const good = seedItem(store, A, { rarity: 'Epic' });
    const before = store.profiles.get(A)!.credits;
    const result = await store.rankUpManufacturer(A, 'nonce-tribute-04', 'Redline', good) as Json;
    expect(result).toMatchObject({ new_rank: 3, tribute_credits: 40_000, tribute_item_id: good });
    expect(store.items.get(good)!.runtime_state).toBe('consumed');
    expect(store.profiles.get(A)!.credits).toBe(before - 40_000);
    expect(store.standingRows.get(`${A}:Redline`)).toEqual({ standing: 5_000, rank: 3 });
    // An item offered at a rank that takes none is refused.
    grant(store, A, 'Ironwood', 500, 0);
    const extra = seedItem(store, A, { payload: { manufacturer: 'Ironwood', weaponType: 'Sniper' } });
    await expect(store.rankUpManufacturer(A, 'nonce-tribute-05', 'Ironwood', extra))
      .rejects.toThrow('requires no tribute item');
  });

  it('the full ladder costs exactly 410,000 cr + 3 items (R7 end-to-end)', async () => {
    const { store } = makeStore();
    seedVerified(store, A);
    grant(store, A, 'ThrowTech', 25_000, 0);
    const start = store.profiles.get(A)!.credits;
    await store.rankUpManufacturer(A, 'nonce-ladder-001', 'ThrowTech', null);
    await store.rankUpManufacturer(A, 'nonce-ladder-002', 'ThrowTech', null);
    const t3 = seedItem(store, A, { rarity: 'Rare', payload: { manufacturer: 'ThrowTech', weaponType: 'Launcher' } });
    await store.rankUpManufacturer(A, 'nonce-ladder-003', 'ThrowTech', t3);
    const t4 = seedItem(store, A, { rarity: 'Epic', payload: { manufacturer: 'ThrowTech', weaponType: 'Launcher' } });
    await store.rankUpManufacturer(A, 'nonce-ladder-004', 'ThrowTech', t4);
    const t5 = seedItem(store, A, { rarity: 'Legendary', payload: { manufacturer: 'ThrowTech', weaponType: 'Launcher' } });
    await store.rankUpManufacturer(A, 'nonce-ladder-005', 'ThrowTech', t5);
    expect(store.profiles.get(A)!.credits).toBe(start - 410_000);
    expect(store.standingRows.get(`${A}:ThrowTech`)).toEqual({ standing: 25_000, rank: 5 });
    await expect(store.rankUpManufacturer(A, 'nonce-ladder-006', 'ThrowTech', null))
      .rejects.toThrow('Already at maximum rank with ThrowTech');
  });

  it('Rep Shelf: rank gate, list price, quantity, replay pays once', async () => {
    const { store } = makeStore();
    seedVerified(store, A);
    await expect(store.standingBuy(A, 'nonce-shelf-0001', 'shelf:Redline', 1))
      .rejects.toThrow('Requires rank 1 with Redline');
    grant(store, A, 'Redline', 500, 1);
    const before = store.profiles.get(A)!.credits;
    const bought = await store.standingBuy(A, 'nonce-shelf-0002', 'shelf:Redline', 3) as Json;
    expect(bought).toMatchObject({
      offer_key: 'shelf:Redline', kind: 'shelf', quantity: 3,
      consumable_type: 'OverchargeStim', total_price: 2_400,
    });
    expect(store.profiles.get(A)!.credits).toBe(before - 2_400);
    expect(store.profiles.get(A)!.consumables.OverchargeStim).toBe(3);
    const replay = await store.standingBuy(A, 'nonce-shelf-0002', 'shelf:Redline', 3) as Json;
    expect(replay).toEqual(bought);
    expect(store.profiles.get(A)!.consumables.OverchargeStim).toBe(3);
    await expect(store.standingBuy(A, 'nonce-shelf-0003', 'shelf:Acme', 1))
      .rejects.toThrow('Unknown standing offer');
  });

  it('Parts Crate: rank 4 gate, weekly cadence per manufacturer, contents land', async () => {
    const { store, setNow } = makeStore('2026-11-02T12:00:00.000Z'); // a Monday
    seedVerified(store, A);
    grant(store, A, 'Prismatek', 11_000, 3);
    await expect(store.standingBuy(A, 'nonce-crate-0001', 'crate:Prismatek', 1))
      .rejects.toThrow('Requires rank 4 with Prismatek');
    grant(store, A, 'Prismatek', 11_000, 4);
    const bought = await store.standingBuy(A, 'nonce-crate-0002', 'crate:Prismatek', 5) as Json;
    expect(bought).toMatchObject({ kind: 'crate', quantity: 1, total_price: 6_000 });
    const profile = store.profiles.get(A)!;
    expect(profile.materials.PrismShards).toBe(4);
    expect(profile.essences.VoidEssence).toBe(2);
    expect(profile.essences.CryoGel).toBe(2);
    await expect(store.standingBuy(A, 'nonce-crate-0003', 'crate:Prismatek', 1))
      .rejects.toThrow('Parts Crate already claimed this week');
    // Next ISO week the crate opens again.
    setNow('2026-11-09T12:00:00.000Z');
    await store.standingBuy(A, 'nonce-crate-0004', 'crate:Prismatek', 1);
    expect(store.profiles.get(A)!.materials.PrismShards).toBe(8);
    // The facts read reports this week's purchase.
    const facts = await store.getStandingFacts(A);
    expect(facts!.weeklyPurchases).toEqual([{ manufacturer: 'Prismatek', kind: 'crate' }]);
  });

  it('Signature Order: rank 5 + weekly + price; the weapon honors the order laws', async () => {
    const { store } = makeStore();
    seedVerified(store, A);
    grant(store, A, 'Redline', 25_000, 4);
    await expect(store.standingOrderWeapon(A, 'nonce-order-0001', 'Redline'))
      .rejects.toThrow('Requires rank 5 with Redline');
    grant(store, A, 'Redline', 25_000, 5);
    const before = store.profiles.get(A)!.credits;
    const result = await store.standingOrderWeapon(A, 'nonce-order-0002', 'Redline') as Json;
    expect(result.total_price).toBe(150_000);
    expect(store.profiles.get(A)!.credits).toBe(before - 150_000);
    const item = result.item as Json;
    const payload = item.payload as Json;
    expect(item.kind).toBe('weapon');
    expect(payload.manufacturer).toBe('Redline');
    expect(['Rare', 'Epic']).toContain(payload.rarity);
    expect(payload.origin).toBe('standing_order');
    expect(payload.legendaryEffectId).toBeUndefined();
    expect(typeof payload.weaponType).toBe('string');
    await expect(store.standingOrderWeapon(A, 'nonce-order-0003', 'Redline'))
      .rejects.toThrow('Signature Order already placed this week');
    const replay = await store.standingOrderWeapon(A, 'nonce-order-0002', 'Redline') as Json;
    expect(replay).toEqual(result);
  });

  it('Signature Order kill switch + corpus: 40 orders, all Rare–Epic Redline, never Legendary', async () => {
    const { store } = makeStore('2026-11-01T12:00:00.000Z', { standingOrderEnabled: 0 });
    seedVerified(store, A);
    grant(store, A, 'Redline', 25_000, 5);
    await expect(store.standingOrderWeapon(A, 'nonce-order-0004', 'Redline'))
      .rejects.toThrow('Signature Orders are disabled');

    const rarities = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const payload = generateStandingOrderWeapon({
        playerId: A, nonce: `corpus-nonce-${i}`, manufacturer: 'HelixWorks', level: 30,
      });
      expect(payload.manufacturer).toBe('HelixWorks');
      expect(['Rare', 'Epic']).toContain(payload.rarity);
      expect(payload.origin).toBe('standing_order');
      expect(payload.legendaryEffectId).toBeUndefined();
      rarities.add(String(payload.rarity));
    }
    expect(rarities).toEqual(new Set(['Rare', 'Epic']));
    // The seeded stream drives rarity + roll stats: two generations
    // for the same (player, nonce) agree on every combat field. The
    // generator's id and pixelSeed are ambient per call (not seeded)
    // and are not the item's identity — the item_instances row id
    // is, on both stores — and a retried apply returns the op's
    // stored ledger result without inserting a second weapon.
    const stripAmbient = (p: Record<string, unknown>) => {
      const { id: _id, pixelSeed: _seed, ...rest } = p;
      return rest;
    };
    expect(stripAmbient(generateStandingOrderWeapon({ playerId: A, nonce: 'corpus-nonce-7', manufacturer: 'HelixWorks', level: 30 })))
      .toEqual(stripAmbient(generateStandingOrderWeapon({ playerId: A, nonce: 'corpus-nonce-7', manufacturer: 'HelixWorks', level: 30 })));
  });

  it('guests read the desk but every standing op refuses', async () => {
    const { store } = makeStore();
    seedGuest(store, GUEST);
    const facts = await store.getStandingFacts(GUEST);
    expect(facts).not.toBeNull();
    expect(facts!.canUsePlayerEconomy).toBe(false);
    expect(facts!.accountType).toBe('guest');
    const view = buildStandingStateView(facts!);
    expect(view.isGuest).toBe(true);
    expect(view.manufacturers).toHaveLength(6);
    const itemId = seedItem(store, GUEST);
    await expect(store.turnInItem(GUEST, 'nonce-guest-0001', itemId))
      .rejects.toThrow('Verified account required');
    await expect(store.rankUpManufacturer(GUEST, 'nonce-guest-0002', 'Redline', null))
      .rejects.toThrow('Verified account required');
    await expect(store.standingBuy(GUEST, 'nonce-guest-0003', 'shelf:Redline', 1))
      .rejects.toThrow('Verified account required');
    await expect(store.standingOrderWeapon(GUEST, 'nonce-guest-0004', 'Redline'))
      .rejects.toThrow('Verified account required');
    expect(store.items.get(itemId)!.runtime_state).toBe('available');
  });

  it('lever overrides move the twin: divisor, drip cap, tribute scalar, order price', async () => {
    const { store } = makeStore('2026-11-01T12:00:00.000Z', {
      standingScrapDivisor: 5,
      standingDripDailyCap: 10,
      standingTributeScalar: 2,
      standingOrderPrice: 42_000,
    });
    seedVerified(store, A);
    const itemId = seedItem(store, A, { rarity: 'Common', item_level: 1 });
    const turned = await store.turnInItem(A, 'nonce-lever-0001', itemId) as Json;
    expect(turned.standing_awarded).toBe(standingTurnInAward({ rarity: 'Common', itemLevel: 1 }, 5));
    const drip = await store.accrueManufacturerStanding(A, 'Redline', 50) as Json;
    expect(drip.points).toBe(10);
    grant(store, A, 'Redline', 500, 0);
    const ranked = await store.rankUpManufacturer(A, 'nonce-lever-0002', 'Redline', null) as Json;
    expect(ranked.tribute_credits).toBe(10_000);
    grant(store, A, 'Redline', 25_000, 5);
    const ordered = await store.standingOrderWeapon(A, 'nonce-lever-0003', 'Redline') as Json;
    expect(ordered.total_price).toBe(42_000);
  });
});

// ---------------------------------------------------------------------------
// 5. The craft gate — the writes twin
// ---------------------------------------------------------------------------

describe('standing craft gate — writes store', () => {
  function writesSeed(): WriteSeed {
    const s = emptyWriteSeed();
    s.profiles = [{
      username: 'crafter', display_name: null, player_level: 25, player_xp: 0,
      credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
      materials: { BallisticParts: 100, NitrocellGel: 100, ReactiveComponents: 100 },
      essences: {}, consumables: {}, skill_spends: {},
      boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
      created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
      account_type: 'verified', email: 'crafter@example.com',
      email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
      verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
      last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
      workshop_benches: 1, workshop_tools: {},
      id: A,
    } as ProfileRowData];
    return s;
  }

  it('refuses the exclusive recipe until Redline rank 2, then escrows its inputs', async () => {
    const store = new InMemoryWriteStore(writesSeed(), { now: () => new Date('2026-11-01T12:00:00.000Z') });
    let attemptSeq = 0;
    const attempt = () => store.enqueueCraftJob(A, `craft-nonce-${++attemptSeq}-standing`, {
      bench: 1, recipeId: 'recipe_redline_standing', units: 1, consumableEfficiencyBonus: 0,
    });
    await expect(attempt()).rejects.toThrow('standing_required');
    // Rank 1 is not enough — the gate is rank 2 exactly.
    store.grantStandingRank(A, 'Redline', 1);
    await expect(attempt()).rejects.toThrow('standing_required');
    // Another manufacturer's rank does not open Redline's recipe (R6).
    store.grantStandingRank(A, 'Ironwood', 5);
    await expect(attempt()).rejects.toThrow('standing_required');
    store.grantStandingRank(A, 'Redline', 2);
    const job = await attempt() as Json;
    expect((job.job as Json).recipe_id ?? (job.job as Json).recipeId).toBe('recipe_redline_standing');
  });
});

// ---------------------------------------------------------------------------
// 6. The economy twin fold — standing meters
// ---------------------------------------------------------------------------

describe('standing meters — economy twin', () => {
  it('folds desk ledger rows into the standing meters and the destroyed total, exactly once', async () => {
    const at = (time: string) => `2026-11-01T${time}.000Z`;
    const store = new InMemoryEconomyStore({
      ledger: [
        { action_type: 'cc_turn_in_item', created_at: at('08:00:00'), result_payload: { manufacturer: 'Redline', standing_awarded: 68 } },
        { action_type: 'cc_turn_in_item', created_at: at('09:00:00'), result_payload: { manufacturer: 'Redline', standing_awarded: 12 } },
        { action_type: 'cc_turn_in_item', created_at: at('10:00:00'), result_payload: { manufacturer: 'Ironwood', standing_awarded: 30 } },
        { action_type: 'cc_rank_up_manufacturer', created_at: at('11:00:00'), result_payload: { manufacturer: 'Redline', tribute_credits: 40_000, tribute_item_id: 'item-x' } },
        { action_type: 'cc_rank_up_manufacturer', created_at: at('12:00:00'), result_payload: { manufacturer: 'Ironwood', tribute_credits: 5_000, tribute_item_id: null } },
        { action_type: 'cc_standing_buy', created_at: at('13:00:00'), result_payload: { manufacturer: 'Redline', total_price: 800 } },
        { action_type: 'cc_standing_order_weapon', created_at: at('14:00:00'), result_payload: { manufacturer: 'Redline', total_price: 150_000 } },
        // Yesterday's turn-in belongs to yesterday's meters.
        { action_type: 'cc_turn_in_item', created_at: '2026-10-31T08:00:00.000Z', result_payload: { manufacturer: 'Redline', standing_awarded: 999 } },
      ],
      items: [],
      config: {},
    });
    const row = await store.computeMetricsForDay('2026-11-01');
    expect(row.standingPointsAwarded.turn_in).toEqual({ Redline: 80, Ironwood: 30 });
    expect(row.standingPointsAwarded.drip).toEqual({}); // daily-table fold: SQL-side, harness-verified
    expect(row.standingItemsDestroyed).toBe(4); // 3 turn-ins + 1 tribute item
    expect(row.standingTributeCreditsDestroyed).toBe(45_000);
    expect(row.standingCreditsDestroyed).toBe(45_000 + 800 + 150_000);
    expect(row.standingOrdersFulfilled).toBe(1);
    expect(row.standingRankUps).toEqual({ Redline: 1, Ironwood: 1 });
    // The destroyed total includes the standing sink exactly once.
    expect(row.creditsDestroyedTotal).toBe(195_800);
    // Standing mints nothing.
    expect(row.creditsMintedTotal).toBe(0);
  });

  it('a turned-in Legendary never counts as salvaged and mints no cores', async () => {
    const store = new InMemoryEconomyStore({
      ledger: [
        {
          action_type: 'cc_turn_in_item', created_at: '2026-11-01T08:00:00.000Z',
          result_payload: {
            manufacturer: 'Redline', standing_awarded: 122,
            item: { rarity: 'Legendary', payload: { legendaryEffectId: 'market_crash' } },
          },
        },
      ],
      items: [],
      config: {},
    });
    const row = await store.computeMetricsForDay('2026-11-01');
    expect(row.legendariesSalvaged).toBe(0);
    expect(row.legendaryCoresMinted).toBe(0);
    expect(row.standingItemsDestroyed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Routes over real HTTP
// ---------------------------------------------------------------------------

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

interface RouteHarness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
  tokenGuest: string;
}

async function makeRouteServer(store: InMemoryChefGameplayStore): Promise<RouteHarness> {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountStandingRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    tokenA: issueAccessToken(SECRET, A, false),
    tokenGuest: issueAccessToken(SECRET, GUEST, true),
  };
}

async function call(h: RouteHarness, method: string, path: string, token?: string, body?: Json) {
  const res = await fetch(`${h.base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Json };
}

describe('standing routes', () => {
  function routeStore(): InMemoryChefGameplayStore {
    const store = new InMemoryChefGameplayStore(() => new Date('2026-11-01T12:00:00.000Z'));
    store.seedProfile({ id: A, player_level: 25, credits: 1_000_000 } as never);
    const recA = store.profiles.get(A) as unknown as Record<string, unknown>;
    recA.account_type = 'verified';
    recA.email_verified_at = '2026-10-01T00:00:00.000Z';
    store.seedProfile({ id: GUEST, player_level: 25, credits: 0 } as never);
    (store.profiles.get(GUEST) as unknown as Record<string, unknown>).account_type = 'guest';
    store.seedItem({
      id: 'route-item-1', owner_user_id: A, kind: 'weapon', rarity: 'Rare', item_level: 25,
      payload: { manufacturer: 'Redline', weaponType: 'SMG' },
    });
    store.seedItem({
      id: 'route-item-locked', owner_user_id: A, kind: 'weapon', rarity: 'Rare', item_level: 25,
      is_locked: true, payload: { manufacturer: 'Redline', weaponType: 'SMG' },
    });
    return store;
  }

  it('requires auth; the desk reads six ladders for a verified player', async () => {
    const h = await makeRouteServer(routeStore());
    expect((await call(h, 'GET', '/api/standing/me')).status).toBe(401);
    const res = await call(h, 'GET', '/api/standing/me', h.tokenA);
    expect(res.status).toBe(200);
    expect(res.json.verified).toBe(true);
    const view = res.json.standing as Json;
    expect((view.manufacturers as Json[])).toHaveLength(6);
    expect(view.isGuest).toBe(false);
    expect(view.canUsePlayerEconomy).toBe(true);
  });

  it('guests read the desk read-only; their ops refuse with 409', async () => {
    const h = await makeRouteServer(routeStore());
    const res = await call(h, 'GET', '/api/standing/me', h.tokenGuest);
    expect(res.status).toBe(200);
    expect((res.json.standing as Json).isGuest).toBe(true);
    const op = await call(h, 'POST', '/api/standing/turn-in', h.tokenGuest, {
      nonce: 'guest-route-nonce-1', itemId: 'route-item-1',
    });
    expect(op.status).toBe(409);
    expect(String(op.json.detail)).toContain('Verified account required');
  });

  it('turn-in over HTTP: forged standing fields are ignored — the server derives the award', async () => {
    const h = await makeRouteServer(routeStore());
    const res = await call(h, 'POST', '/api/standing/turn-in', h.tokenA, {
      nonce: 'route-nonce-0001',
      itemId: 'route-item-1',
      // Forged claims riding along — must be ignored.
      standingAwarded: 999_999,
      standing: 999_999,
      manufacturer: 'HelixWorks',
      credits: 999_999,
    });
    expect(res.status).toBe(200);
    const turnedIn = res.json.turnedIn as Json;
    const expected = standingTurnInAward({ rarity: 'Rare', itemLevel: 25 }, 10);
    expect(turnedIn.standingAwarded).toBe(expected);
    expect(turnedIn.manufacturer).toBe('Redline');
    expect(turnedIn.newBalance).toBe(expected);
    const view = res.json.standing as Json;
    const redline = (view.manufacturers as Json[])[0];
    expect(redline.standing).toBe(expected);
    expect(h.store.items.get('route-item-1')!.runtime_state).toBe('consumed');
    expect(h.store.profiles.get(A)!.credits).toBe(1_000_000);
  });

  it('refusals map to 409, missing items to 404, impersonation to 403', async () => {
    const h = await makeRouteServer(routeStore());
    const locked = await call(h, 'POST', '/api/standing/turn-in', h.tokenA, {
      nonce: 'route-nonce-0002', itemId: 'route-item-locked',
    });
    expect(locked.status).toBe(409);
    expect(String(locked.json.detail)).toContain('Locked item');
    const missing = await call(h, 'POST', '/api/standing/turn-in', h.tokenA, {
      nonce: 'route-nonce-0003', itemId: 'no-such-item',
    });
    expect(missing.status).toBe(404);
    const impersonation = await call(h, 'POST', '/api/standing/turn-in', h.tokenA, {
      nonce: 'route-nonce-0004', itemId: 'route-item-1', playerId: B,
    });
    expect(impersonation.status).toBe(403);
    const noItem = await call(h, 'POST', '/api/standing/turn-in', h.tokenA, {
      nonce: 'route-nonce-0005',
    });
    expect(noItem.status).toBe(400);
  });

  it('rank-up + buy + order over HTTP move the view and the balance', async () => {
    const store = routeStore();
    store.standingRows.set(`${A}:Redline`, { standing: 25_000, rank: 0 });
    const h = await makeRouteServer(store);
    const rank1 = await call(h, 'POST', '/api/standing/rank-up', h.tokenA, {
      nonce: 'route-rankup-001', manufacturer: 'Redline',
    });
    expect(rank1.status).toBe(200);
    expect((rank1.json.rankedUp as Json).newRank).toBe(1);
    expect((rank1.json.rankedUp as Json).tributeCredits).toBe(5_000);
    const buy = await call(h, 'POST', '/api/standing/buy', h.tokenA, {
      nonce: 'route-buy-000001', offerKey: 'shelf:Redline', quantity: 2,
    });
    expect(buy.status).toBe(200);
    expect((buy.json.bought as Json).totalPrice).toBe(1_600);
    expect(store.profiles.get(A)!.consumables.OverchargeStim).toBe(2);
    // Rank gates still bind over HTTP (order needs rank 5).
    const order = await call(h, 'POST', '/api/standing/order', h.tokenA, {
      nonce: 'route-order-0001', manufacturer: 'Redline',
    });
    expect(order.status).toBe(409);
    store.standingRows.set(`${A}:Redline`, { standing: 25_000, rank: 5 });
    const ordered = await call(h, 'POST', '/api/standing/order', h.tokenA, {
      nonce: 'route-order-0002', manufacturer: 'Redline',
    });
    expect(ordered.status).toBe(200);
    const item = (ordered.json.ordered as Json).item as Json;
    expect((item.payload as Json).origin).toBe('standing_order');
    expect(store.profiles.get(A)!.credits).toBe(1_000_000 - 5_000 - 1_600 - 150_000);
  });
});

// ---------------------------------------------------------------------------
// 8. Migration 0043 — textual pins (TS/SQL twin parity + restatement safety)
// ---------------------------------------------------------------------------

describe('migration 0043 — textual pins', () => {
  it('cc_standing_catalog rows equal STANDING_OFFERS exactly', () => {
    const rowRe = /\('((?:shelf|crate):[A-Za-z]+)', '([A-Za-z]+)', '(shelf|crate)', (\d+), (\d+), (null|'[^']*'), '(\{.*\})'::jsonb\)/g;
    const rows = [...MIGRATION.matchAll(rowRe)].map((m) => ({
      offerKey: m[1],
      manufacturer: m[2],
      kind: m[3],
      rankRequired: Number(m[4]),
      priceCredits: Number(m[5]),
      consumableType: m[6] === 'null' ? null : m[6].slice(1, -1),
      contents: JSON.parse(m[7]) as { materials: Json; essences: Json },
    }));
    expect(rows).toHaveLength(12);
    const expected = STANDING_OFFERS.map((o) => ({
      offerKey: o.offerKey,
      manufacturer: o.manufacturer as string,
      kind: o.kind as string,
      rankRequired: o.rankRequired,
      priceCredits: o.priceCredits,
      consumableType: o.consumableType,
      contents: { materials: o.materials, essences: o.essences },
    }));
    expect(rows).toEqual(expected);
  });

  it('the restated craft catalog: 58 recipes, standing six deep-equal, research gate survives', () => {
    const parts = MIGRATION.split('$catalog$');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const catalog = JSON.parse(parts[1]) as Array<Json>;
    expect(catalog).toHaveLength(58);
    // 59 since 0044 added the Calibration Core recipe (pinned
    // against 0044's restated catalog in shieldTechServices.test.ts).
    expect(ALL_CRAFT_RECIPES).toHaveLength(59);
    const sqlIds = new Set(catalog.map((r) => r.id));
    for (const recipe of ALL_CRAFT_RECIPES) {
      // recipe_calibration_core postdates 0043 (it lands in 0044's
      // restated catalog, pinned in shieldTechServices.test.ts).
      if (recipe.id === 'recipe_calibration_core') continue;
      expect(sqlIds.has(recipe.id), recipe.id).toBe(true);
    }
    // The six standing recipes match the TS catalog field for field.
    for (const recipe of ALL_CRAFT_RECIPES.filter((r) => r.requiresStanding)) {
      const sql = catalog.find((r) => r.id === recipe.id)!;
      expect(sql.name).toBe(recipe.name);
      expect(sql.consumableType).toBe(recipe.consumableType);
      expect(sql.inputs).toEqual(recipe.inputs);
      expect(sql.unitDurationMs).toBe(recipe.unitDurationMs);
      expect(sql.requiresLevel).toBe(recipe.requiresLevel);
      expect(sql.requiresStanding).toEqual(recipe.requiresStanding);
    }
    // Nothing from 0038 was dropped: the batch recipe keeps its research gate.
    const batch = catalog.find((r) => r.id === 'recipe_patch_kit_batch')!;
    expect(batch.requiresResearch).toBe('production_systems');
  });

  it('the restated enqueue keeps BOTH the research gate and the new standing gate', () => {
    expect(MIGRATION).toContain("'research_required'");
    expect(MIGRATION).toContain("'standing_required'");
    expect(MIGRATION).toContain('requiresStanding');
    expect(MIGRATION).toContain('manufacturer_standing');
  });

  it('quality bounds gained exactly the six standing types', () => {
    const boundsStart = MIGRATION.indexOf('create or replace function public.cc_craft_quality_bounds');
    expect(boundsStart).toBeGreaterThan(-1);
    const bounds = MIGRATION.slice(boundsStart, MIGRATION.indexOf('$$;', boundsStart));
    for (const m of STANDING_MANUFACTURERS) {
      expect(bounds).toContain(STANDING_RECIPE_TYPES[m].consumableType);
    }
  });

  it('the restated metrics fold keeps Research + Contracts meters and adds the standing folds', () => {
    // Prior slices survive the restatement.
    expect(MIGRATION).toContain('cc_enroll_research');
    expect(MIGRATION).toContain('research_credits_destroyed');
    expect(MIGRATION).toContain('cc_claim_contract_reward');
    expect(MIGRATION).toContain('credits_minted_contracts');
    // Standing folds land.
    expect(MIGRATION).toContain('standing_turn_in_points');
    expect(MIGRATION).toContain('standing_tribute_destroyed');
    expect(MIGRATION).toContain('standing_purchases_destroyed');
    expect(MIGRATION).toContain('manufacturer_standing_daily');
    expect(MIGRATION).toContain("'turn_in'");
    expect(MIGRATION).toContain("'drip'");
    // The destroyed total joins the standing sink exactly as specified.
    expect(MIGRATION).toContain('+ m.standing_tribute_destroyed + m.standing_purchases_destroyed');
    // Turned-in legendaries never join the salvage meter.
    expect(MIGRATION).toContain("action_type = 'cc_recycle_item'");
  });

  it('the migration is additive and defines the desk surface exactly once', () => {
    for (const fn of [
      'cc_standing_catalog', 'cc_accrue_manufacturer_standing', 'cc_turn_in_item',
      'cc_rank_up_manufacturer', 'cc_standing_buy', 'cc_standing_order_weapon',
    ]) {
      const defs = MIGRATION.match(new RegExp(`create or replace function public\\.${fn}\\b`, 'g'));
      expect(defs, fn).toHaveLength(1);
    }
    expect(MIGRATION).toContain('create table if not exists public.manufacturer_standing');
    expect(MIGRATION).toContain('create table if not exists public.manufacturer_standing_daily');
    expect(MIGRATION).toContain('create table if not exists public.standing_weekly_purchases');
    expect(MIGRATION).not.toMatch(/drop table/i);
    expect(MIGRATION).not.toMatch(/delete from/i);
  });

  it('the batch-writer restatement widens only the standing provenance lists', () => {
    // cc_add_consumable_batch (0004 body) refuses origin 'standing' /
    // event 'standing_buy', and two table CHECKs mirror the lists —
    // the harness caught all three; 0043 widens each by exactly one
    // value. The function keeps its 0004 signature (verbatim header).
    expect(MIGRATION.match(/function public\.cc_add_consumable_batch/gi)).toHaveLength(1);
    expect(MIGRATION).toContain(
      "p_origin not in ('vendor', 'crafted', 'market', 'reward', 'admin', 'standing')");
    expect(MIGRATION).toContain("'admin_adjust', 'reset', 'standing_buy')");
    expect(MIGRATION).toContain('drop constraint consumable_batches_origin_check');
    expect(MIGRATION).toContain("'admin'::text, 'standing'::text");
    expect(MIGRATION).toContain('drop constraint consumable_events_event_type_check');
    expect(MIGRATION).toContain("'reset'::text, 'standing_buy'::text");
    // The desk's shelf grant passes the honest provenance pair.
    expect(MIGRATION).toContain("'standing'");
    expect(MIGRATION).toContain("'standing_buy'");
  });
});
