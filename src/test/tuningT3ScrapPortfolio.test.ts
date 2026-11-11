/**
 * Tuning slice T3 — SCRAP PORTFOLIO (owner ruling D3 = YES,
 * 2026-11-10; brief proposals P7, P8, P9).
 *
 * P7 — consumable recipe Scrap legs repriced tiered ×2–8 (staples
 * ×2–3, the mid band ×5, the high band ×6–8). The repricing moves
 * the CATALOG LITERALS (TS registry + the SQL catalog restated in
 * migration 0087), so the recipeScrap.<id> lever — which resolves
 * over the literals — keeps working on top, and a running job's
 * escrow snapshot is never repriced (0072 semantics, unchanged).
 * Batch recipes keep migration 0038's construction law: a batch
 * leg is exactly 2.5× the single recipe's leg. NO consumable
 * magnitude changes ride in this slice (T2's shipped state stands)
 * and no non-consumable leg moves (refining, gear frames, cosmetic
 * part legs and the tint leg are out of scope).
 *
 * P8 — market listing deposit: 25 Scrap charged on listing
 * creation, REFUNDED IN FULL when the item sells (the brief's own
 * words), BURNED on cancel. Two premise findings, verified against
 * the shipped code before building:
 *   - EXPIRY LEG DOES NOT EXIST: listings never expire in the data
 *     model (src/lib/market/listingAge.ts states it verbatim; the
 *     'expired' status in migration 0003's CHECK is never set by
 *     any code or migration, and no expires_at/TTL exists), so
 *     there is no burn-on-expire path to build. The deposit's burn
 *     path is cancel only.
 *   - QUICK-BUY PARTIAL FILLS: a stack listing can sell in legs.
 *     The deposit rides with the listing — partial legs refund
 *     nothing; the leg that CLOSES the listing refunds it in full
 *     (the deposit's "when the item sells" moment is the listing's
 *     completion). Pinned below.
 * The 5% sale fee and its floor are NOT touched by this slice: the
 * deposit is a separate Scrap hold beside the credit fee.
 *
 * P9 — PREMISE FALSE, NOT BUILT: the brief assumed reforge might
 * charge credits and proposed moving it to Scrap. Reforge already
 * charges Scrap only (plus legendary cores on Legendary gear) —
 * src/content/reforge.ts and docs/ECONOMY.md agree, and the cost
 * is already lever-addressable (reforgeScrapScalar,
 * reforgeLegendaryCoreCost). Pinned below so the finding is
 * executable, not just documented.
 *
 * Migration 0087 is prepared in-PR and applied by hand (staging
 * rehearsal first); the Chef never runs migrations. The deposit
 * figure itself is a live lever (marketListingDepositScrap,
 * default src/lib/market/listingDeposit.ts
 * MARKET_LISTING_DEPOSIT_SCRAP = 25), snapshotted onto the listing
 * row at creation so a lever move never reprices a live listing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CRAFT_RECIPES, getCraftRecipe } from '../content/crafting';
import {
  RECIPE_SCRAP_DEFAULTS,
  resolveEconomyConfigValues,
} from '../server/economy/config';
import {
  MARKET_LISTING_DEPOSIT_SCRAP,
  clampListingDepositScrap,
} from '../lib/market/listingDeposit';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';

const MIGRATION_0086 = readFileSync(
  join(process.cwd(), 'db/migrations/0086_retire_mfr_helm_recipes.sql'),
  'utf8',
);
const MIGRATION_0087 = readFileSync(
  join(process.cwd(), 'db/migrations/0087_scrap_portfolio.sql'),
  'utf8',
);

type CatalogRow = Record<string, unknown> & {
  id: string;
  inputs: Record<string, number>;
};
const catalogOf = (sql: string): CatalogRow[] =>
  JSON.parse(sql.split('$catalog$')[1]) as CatalogRow[];

/** Canonical stringify (sorted keys) — the gateRemovalStep2 form. */
const canon = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};

// ─── P7: the repricing map (brief table, from → to) ─────────────

/** [recipe id, Scrap before, Scrap after] — 38 consumable recipes. */
const T3_REPRICED: ReadonlyArray<readonly [string, number, number]> = [
  // Staple tier (×2–3)
  ['recipe_patch_kit', 4, 10],
  ['recipe_field_patch_kit', 6, 15],
  ['recipe_fuel_cell', 6, 15],
  ['recipe_master_patch_kit', 8, 20],
  ['recipe_ammo_pack', 10, 25],
  ['recipe_medkit', 15, 40],
  // Mid tier (×5)
  ['recipe_ordnance', 12, 60],
  ['recipe_salvage_contract', 12, 60],
  ['recipe_ap_ammo', 15, 75],
  ['recipe_fire_ammo', 15, 75],
  ['recipe_shock_ammo', 15, 75],
  ['recipe_corrosive_ammo', 15, 75],
  ['recipe_cryo_ammo', 15, 75],
  ['recipe_elemental_coating', 15, 75],
  ['recipe_luck', 15, 75],
  ['recipe_magnetized', 15, 75],
  ['recipe_signal_scrambler', 15, 75],
  ['recipe_high_capacity_ammo_pack', 18, 90],
  ['recipe_emp_charge', 18, 90],
  ['recipe_corrosive_charge', 18, 90],
  ['recipe_workshop_rush_ticket', 18, 90],
  ['recipe_shieldcell', 20, 100],
  ['recipe_void_ammo', 20, 100],
  ['recipe_targetpainter', 20, 100],
  ['recipe_scanner', 20, 100],
  ['recipe_jammer', 20, 100],
  ['recipe_loot_beacon', 20, 100],
  ['recipe_throwtech_standing', 20, 100],
  ['recipe_medkit_refined', 25, 125],
  ['recipe_overcharge', 25, 125],
  ['recipe_dataskimmer', 25, 125],
  // High tier (×6–8)
  ['recipe_nanoswarm', 30, 200],
  ['recipe_phaseshift', 30, 250],
  ['recipe_insurance', 30, 200],
  ['recipe_adrenaline', 40, 300],
  // Batch recipes — 0038's law: exactly 2.5× the single recipe's leg
  ['recipe_patch_kit_batch', 10, 25],
  ['recipe_ordnance_batch', 30, 150],
  ['recipe_shield_cell_batch', 50, 250],
];

describe('P7 — the repriced Scrap legs (TS literals)', () => {
  it('every mapped recipe carries the new literal, and only Scrap moved', () => {
    expect(T3_REPRICED).toHaveLength(38);
    const catalog0086 = new Map(catalogOf(MIGRATION_0086).map((r) => [r.id, r]));
    for (const [id, from, to] of T3_REPRICED) {
      const recipe = getCraftRecipe(id);
      expect(recipe, id).toBeDefined();
      expect(recipe!.inputs['Scrap'], id).toBe(to);
      // The from-state is 0086's catalog row (the pre-T3 live SQL).
      expect(catalog0086.get(id)?.inputs['Scrap'], id).toBe(from);
      // Every non-Scrap input is identical across the reprice.
      const before = { ...catalog0086.get(id)!.inputs };
      const after = { ...recipe!.inputs };
      delete before['Scrap'];
      delete after['Scrap'];
      expect(after, id).toEqual(before);
    }
  });

  it('the generated lever defaults follow the new literals', () => {
    for (const [id, , to] of T3_REPRICED) {
      expect(RECIPE_SCRAP_DEFAULTS[id], id).toBe(to);
    }
    // Untouched legs keep their defaults (out of P7 scope).
    expect(RECIPE_SCRAP_DEFAULTS['tint_craft']).toBe(25);
    expect(RECIPE_SCRAP_DEFAULTS['refine_refined_alloy']).toBe(10);
  });

  it('batch legs are exactly 2.5× the single recipe legs (0038 law)', () => {
    const pairs: Array<[string, string]> = [
      ['recipe_patch_kit_batch', 'recipe_patch_kit'],
      ['recipe_ordnance_batch', 'recipe_ordnance'],
      ['recipe_shield_cell_batch', 'recipe_shieldcell'],
    ];
    for (const [batchId, singleId] of pairs) {
      const batch = getCraftRecipe(batchId)!;
      const single = getCraftRecipe(singleId)!;
      expect(batch.inputs['Scrap'], batchId).toBe(2.5 * single.inputs['Scrap']);
    }
  });
});

describe('P7 — migration 0087 restates the SQL catalog in sync', () => {
  const catalog0086 = catalogOf(MIGRATION_0086);
  const catalog0087 = catalogOf(MIGRATION_0087);

  it('0087 vs 0086: same rows, exactly the 38 mapped rows differ, only in inputs.Scrap', () => {
    expect(catalog0087.map((r) => r.id).sort()).toEqual(
      catalog0086.map((r) => r.id).sort(),
    );
    const byId0086 = new Map(catalog0086.map((r) => [r.id, r]));
    const changed = catalog0087.filter(
      (r) => canon(byId0086.get(r.id)) !== canon(r),
    );
    expect(changed.map((r) => r.id).sort()).toEqual(
      T3_REPRICED.map(([id]) => id).sort(),
    );
    for (const row of changed) {
      const before = byId0086.get(row.id)!;
      const stripScrap = (r: CatalogRow) => {
        const clone = JSON.parse(JSON.stringify(r)) as CatalogRow;
        delete clone.inputs['Scrap'];
        return clone;
      };
      expect(canon(stripScrap(row))).toBe(canon(stripScrap(before)));
      const [, from, to] = T3_REPRICED.find(([id]) => id === row.id)!;
      expect(before.inputs['Scrap']).toBe(from);
      expect(row.inputs['Scrap']).toBe(to);
    }
  });

  it('0087’s catalog deep-equals the TS catalog minus 0086’s six retired helms and T6’s serum', () => {
    // Migration 0086 removed exactly six cosmetic helm recipes
    // from the SQL catalog ONLY (the TS rows live on, delisted in
    // code — Hero Pass H1). Tuning T6 (migration 0088) then added
    // recipe_overclock_serum to the TS catalog and to 0088's SQL
    // restatement — it is not in 0087's catalog. Together they are
    // the entire TS↔0087 delta.
    const retiredHelms = [
      'recipe_skin_mfr_head_redline', 'recipe_skin_mfr_head_ironwood',
      'recipe_skin_mfr_head_blastforge', 'recipe_skin_mfr_head_prismatek',
      'recipe_skin_mfr_head_throwtech', 'recipe_skin_mfr_head_helixworks',
    ];
    const addedByT6 = ['recipe_overclock_serum'];
    const tsIds = ALL_CRAFT_RECIPES.map((r) => r.id);
    const sqlIds = new Set(catalog0087.map((r) => r.id));
    expect(tsIds.filter((id) => !sqlIds.has(id)).sort()).toEqual(
      [...retiredHelms, ...addedByT6].sort(),
    );
    const tsLive = JSON.parse(JSON.stringify(ALL_CRAFT_RECIPES)) as CatalogRow[];
    expect(catalog0087).toEqual(
      tsLive.filter((r) => !retiredHelms.includes(r.id) && !addedByT6.includes(r.id)),
    );
  });

  it('0087 carries the deposit column, the lever read, and the burn report', () => {
    expect(MIGRATION_0087).toContain('add column if not exists deposit_scrap');
    expect(MIGRATION_0087).toContain(
      "cc_economy_config_number('marketListingDepositScrap', 25)",
    );
    expect(MIGRATION_0087).toContain('Insufficient scrap for the listing deposit');
    expect(MIGRATION_0087).toContain("'deposit_burned'");
  });
});

// ─── P8: the listing deposit in the InMemory twin ───────────────

const S = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ITEM_GEAR = '33333333-3333-4333-8333-333333333333';
const BATCH_MEDKIT = '44444444-4444-4444-8444-444444444444';
const LEGACY_LISTING = '55555555-5555-4555-8555-555555555555';

let nonceCounter = 0;
const nonce = () => `t3-nonce-${++nonceCounter}-abcdefgh`;

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 25, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {}, legendary_cores: 0,
    ...over,
  } as ProfileRowData;
}

function seed(over?: (s: WriteSeed) => void): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({
      id: S, username: 'seller', credits: 0,
      materials: { Scrap: 1000, BallisticParts: 100 },
      essences: { VoidEssence: 10 }, consumables: { MedKit: 10 },
      legendary_cores: 5,
    }),
    profile({ id: B, username: 'buyer', credits: 100_000 }),
  ];
  s.items = [{
    id: ITEM_GEAR, owner_user_id: S, kind: 'weapon', static_item_id: null, item_level: 5,
    rarity: 'Rare', quality: null, material_tier: null, condition_state: null,
    condition_current: 40, condition_max: 50, supply_mode: 'verified_action', source_id: null,
    creator_user_id: null, tradeable: true, account_bound: false, locked_until: null,
    payload: { name: 'Rusty Pistol', weaponType: 'Pistol', element: 'Fire', rarity: 'Rare', level: 5, sourceTag: 'World Drop' },
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 500,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as never];
  s.consumableBatches = [{
    id: BATCH_MEDKIT, owner_user_id: S, consumable_type: 'MedKit', quality_percent: 100,
    quantity: 10, origin: 'crafted', creator_user_id: S, source_recipe_id: 'recipe_medkit',
    metadata: {}, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as never];
  over?.(s);
  return s;
}

const scrapOf = (store: InMemoryWriteStore, id: string) =>
  store.seed.profiles.find((p) => p.id === id)!.materials['Scrap'] ?? 0;
const creditsOf = (store: InMemoryWriteStore, id: string) =>
  store.seed.profiles.find((p) => p.id === id)!.credits;
// The test's structural view of the twin's op results (only the
// fields these assertions read).
type Res = {
  listing: { id: string; deposit_scrap: number };
  item: { runtime_state: string };
  deposit_burned: number;
  market_fee: { fee_credits: number; seller_proceeds: number; fee_rate: number };
  status: string;
};

describe('P8 — deposit charge, refund on sale, burn on cancel (twin)', () => {
  it('gear create charges 25 Scrap and stamps it on the listing', async () => {
    const store = new InMemoryWriteStore(seed(), { rng: () => 0.5 });
    const res = (await store.marketCreate(S, nonce(), ITEM_GEAR, 1000)) as Res;
    expect(scrapOf(store, S)).toBe(975);
    expect(res.listing.deposit_scrap).toBe(25);
  });

  it('create → cancel BURNS the deposit; the escrowed item returns', async () => {
    const store = new InMemoryWriteStore(seed(), { rng: () => 0.5 });
    const created = (await store.marketCreate(S, nonce(), ITEM_GEAR, 1000)) as Res;
    const res = (await store.marketCancel(S, nonce(), created.listing.id)) as Res;
    expect(res.deposit_burned).toBe(25);
    expect(scrapOf(store, S)).toBe(975); // burned — not refunded
    expect(res.item.runtime_state).toBe('available');
  });

  it('create → sale refunds the deposit in full; the 5% fee is untouched', async () => {
    const store = new InMemoryWriteStore(seed(), { rng: () => 0.5 });
    const created = (await store.marketCreate(S, nonce(), ITEM_GEAR, 1000)) as Res;
    const res = (await store.acceptListing(B, nonce(), created.listing.id)) as Res;
    expect(scrapOf(store, S)).toBe(1000); // deposit back in full
    expect(res.market_fee.fee_credits).toBe(50); // 5% of 1000, as before
    expect(res.market_fee.seller_proceeds).toBe(950);
    expect(creditsOf(store, S)).toBe(950);
    expect(creditsOf(store, B)).toBe(99_000);
  });

  it('a seller short on Scrap cannot list — nothing is charged or created', async () => {
    const store = new InMemoryWriteStore(
      seed((s) => { s.profiles[0].materials = { Scrap: 24 }; }),
      { rng: () => 0.5 },
    );
    await expect(store.marketCreate(S, nonce(), ITEM_GEAR, 1000))
      .rejects.toThrow('Insufficient scrap for the listing deposit');
    expect(scrapOf(store, S)).toBe(24);
    expect(store.seed.listings).toHaveLength(0);
  });

  it('consumable, core and essence creates each charge the deposit once', async () => {
    const store = new InMemoryWriteStore(seed(), { rng: () => 0.5 });
    await store.marketCreateConsumable(S, nonce(), BATCH_MEDKIT, 4, 200);
    expect(scrapOf(store, S)).toBe(975);
    expect(store.seed.consumableBatches[0].quantity).toBe(6);
    await store.marketCreateCore(S, nonce(), 2, 500);
    expect(scrapOf(store, S)).toBe(950);
    expect(store.seed.profiles[0].legendary_cores).toBe(3);
    await store.marketCreateEssence(S, nonce(), 'VoidEssence', 3, 300);
    expect(scrapOf(store, S)).toBe(925);
    expect(store.seed.profiles[0].essences['VoidEssence']).toBe(7);
  });

  it('material create charges once; listing Scrap itself must clear the deposit AFTER escrow', async () => {
    const store = new InMemoryWriteStore(seed(), { rng: () => 0.5 });
    await store.marketCreateMaterial(S, nonce(), 'BallisticParts', 10, 250);
    expect(scrapOf(store, S)).toBe(975);
    expect(store.seed.profiles[0].materials['BallisticParts']).toBe(90);

    const tight = new InMemoryWriteStore(
      seed((s) => { s.profiles[0].materials = { Scrap: 100 }; }),
      { rng: () => 0.5 },
    );
    // 100 − 80 escrowed = 20 left < 25 deposit → refused, nothing moves.
    await expect(tight.marketCreateMaterial(S, nonce(), 'Scrap', 80, 400))
      .rejects.toThrow('Insufficient scrap for the listing deposit');
    expect(scrapOf(tight, S)).toBe(100);
    // 100 − 70 escrowed = 30 ≥ 25 → lists; 30 − 25 deposit = 5 left.
    await tight.marketCreateMaterial(S, nonce(), 'Scrap', 70, 400);
    expect(scrapOf(tight, S)).toBe(5);
  });

  it('Quick-Buy: partial legs hold the deposit; the closing leg refunds it', async () => {
    const store = new InMemoryWriteStore(seed(), { rng: () => 0.5 });
    await store.marketCreateMaterial(S, nonce(), 'BallisticParts', 10, 1000);
    expect(scrapOf(store, S)).toBe(975);
    const partial = (await store.quickbuyFill(B, nonce(), {
      source: 'market', goodKind: 'material', goodId: 'BallisticParts',
      quantity: 4, quotedTotal: 400,
    })) as Res;
    expect(partial.status).toBe('filled');
    expect(scrapOf(store, S)).toBe(975); // still held with the listing
    const closing = (await store.quickbuyFill(B, nonce(), {
      source: 'market', goodKind: 'material', goodId: 'BallisticParts',
      quantity: 6, quotedTotal: 600,
    })) as Res;
    expect(closing.status).toBe('filled');
    expect(scrapOf(store, S)).toBe(1000); // refunded on the closing leg
    expect(store.seed.profiles[1].materials['BallisticParts']).toBe(10);
  });

  it('a pre-0087 listing (no deposit held) refunds and burns exactly 0', async () => {
    const store = new InMemoryWriteStore(
      seed((s) => {
        s.profiles[0].materials = { Scrap: 300 };
        s.listings.push({
          id: LEGACY_LISTING, seller_user_id: S, item_instance_id: null,
          price_credits: 500, status: 'active',
          listed_at: '2026-10-01T00:00:00.000Z', sold_at: null,
          listing_kind: 'material', quantity: 2, material_id: 'BallisticParts',
          identity_key: 'material:BallisticParts', category: 'material',
          display_name: 'BallisticParts', seller_type: 'player',
        } as never);
      }),
      { rng: () => 0.5 },
    );
    const res = (await store.acceptListing(B, nonce(), LEGACY_LISTING)) as Res;
    expect(res.listing.deposit_scrap).toBe(0);
    expect(scrapOf(store, S)).toBe(300); // no phantom refund
  });

  it('the deposit is a lever: provider value charges, 0 disables, clamp bounds the band', async () => {
    const levered = new InMemoryWriteStore(seed(), {
      rng: () => 0.5, listingDepositProvider: () => 10,
    });
    const res = (await levered.marketCreate(S, nonce(), ITEM_GEAR, 1000)) as Res;
    expect(res.listing.deposit_scrap).toBe(10);
    expect(scrapOf(levered, S)).toBe(990);
    const cancelled = (await levered.marketCancel(S, nonce(), res.listing.id)) as Res;
    expect(cancelled.deposit_burned).toBe(10);

    const disabled = new InMemoryWriteStore(seed(), {
      rng: () => 0.5, listingDepositProvider: () => 0,
    });
    await disabled.marketCreate(S, nonce(), ITEM_GEAR, 1000);
    expect(scrapOf(disabled, S)).toBe(1000);

    expect(MARKET_LISTING_DEPOSIT_SCRAP).toBe(25);
    expect(resolveEconomyConfigValues({}).marketListingDepositScrap).toBe(25);
    expect(clampListingDepositScrap(-5)).toBe(0);
    expect(clampListingDepositScrap(100_001)).toBe(100_000);
    expect(clampListingDepositScrap(25.9)).toBe(25);
    expect(clampListingDepositScrap(undefined)).toBe(25);
    expect(clampListingDepositScrap(Number.NaN)).toBe(25);
  });
});

// ─── Premise findings, pinned ───────────────────────────────────

describe('premise findings — P9 and the P8 expiry leg (verified, not built)', () => {
  it('P9: reforge already charges Scrap (+ legendary cores) — no credit cost exists', () => {
    const reforge = readFileSync(
      join(process.cwd(), 'src/content/reforge.ts'),
      'utf8',
    );
    expect(reforge).toContain('Scrap');
    expect(reforge.toLowerCase()).not.toContain('credits');
    const values = resolveEconomyConfigValues({});
    expect(values.reforgeScrapScalar).toBe(1);
    expect(values.reforgeLegendaryCoreCost).toBe(2);
  });

  it('P8 expiry leg: listings never expire in the shipped data model', () => {
    const listingAge = readFileSync(
      join(process.cwd(), 'src/lib/market/listingAge.ts'),
      'utf8',
    );
    expect(listingAge).toContain('never expire');
  });
});
