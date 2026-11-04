/**
 * Economy slice 5 — the Scrap Merge (brief §3; migration 0069).
 *
 * THE RULING: ONE tradeable Scrap. The profile scrap currency folded
 * into the material stack (profiles.materials['Scrap']) AND the
 * ScrapAlloy material was renamed into the same key (brief §3.1) —
 * every faucet/sink/recipe/display and the player market runs on the
 * single stock, and no ScrapAlloy key survives anywhere. NO yield
 * number changed: only the ledger each amount lands in.
 *
 * Pins, in order:
 *   1. Key-space parity, four ways: the MaterialType enum, the TS
 *      market id list, and BOTH SQL whitelists in 0069
 *      (cc_is_material_key + cc_market_create_material) name the
 *      same 21 material ids, Scrap included, ScrapAlloy gone.
 *   2. Migration 0069 text: the conversion + audit + self-check are
 *      present, and no restated function still writes the retired
 *      column (the only `scrap = 0` writes are the conversion and
 *      the reset reseed — the tombstone zeroing).
 *   3. InMemory gameplay twin: seed fold, claim + salvage pay the
 *      stack, the profile snapshot projects it.
 *   4. InMemory writes twin: seed fold, the market list/buy path for
 *      Scrap end-to-end, cosmetic escrow + cancel refund, tint, and
 *      the initial bundle — all against the stack. (Reforge's own
 *      suite covers its debit; it reads the same stack.)
 *   5. Reads twins: the InMemory store folds + projects; the Pg
 *      row mapper derives the profile's scrap from materials.
 * The Pg functions themselves were verified against real Postgres
 * (full chain + probes) — see cybercache-prep/econ5-verification/.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MATERIAL_VISUALS } from '../constants/visualAssets';
import { ALL_CRAFT_RECIPES, getCraftRecipe, isMaterialInput } from '../content/crafting';
import { skinPartCatalog } from '../content/skins';
import { MARKET_MATERIAL_IDS } from '../lib/market/identityKey';
import { VENDOR_MATERIALS } from '../lib/vendor/catalog';
import { MaterialType } from '../types/game';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import {
  InMemoryReadStore,
  emptyReadSeed,
  mapProfile,
  type ProfileRowData,
  type ReadSeed,
} from '../server/reads/store';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(HERE, '..', '..', 'db', 'migrations', '0069_scrap_merge.sql'), 'utf8');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let nonceCounter = 0;
const nonce = () => `scrap-merge-nonce-${(nonceCounter += 1).toString().padStart(4, '0')}`;

// ---------------------------------------------------------------------------
// 1. Key-space parity
// ---------------------------------------------------------------------------

describe('scrap merge — key-space parity', () => {
  it('ScrapAlloy is renamed into Scrap — 21 materials, no second scrap', () => {
    const ids = Object.values(MaterialType);
    expect(ids).toContain('Scrap');
    expect(ids).not.toContain('ScrapAlloy');
    expect(ids).toHaveLength(21);
    expect(MaterialType.Scrap).toBe('Scrap');
    expect(isMaterialInput('Scrap')).toBe(true);
  });

  it('the TS market list is exactly the enum', () => {
    expect([...MARKET_MATERIAL_IDS].sort()).toEqual(Object.values(MaterialType).sort());
    expect(MARKET_MATERIAL_IDS).toContain('Scrap');
  });

  it('both SQL whitelists in 0069 name exactly the enum ids', () => {
    const keyList = MIGRATION.match(/select p_key = any \(array\[([\s\S]*?)\]\)/)?.[1] ?? '';
    const sqlKeys = [...keyList.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(sqlKeys.sort()).toEqual(Object.values(MaterialType).sort());

    const marketList = MIGRATION.match(/if material_id not in \(([^)]*)\)/)?.[1] ?? '';
    const sqlMarket = [...marketList.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(sqlMarket.sort()).toEqual(Object.values(MaterialType).sort());
  });

  it('the display registry names the stock "Scrap"; the vendor sells it at the old 10 cr anchor', () => {
    expect(MATERIAL_VISUALS[MaterialType.Scrap].label).toBe('Scrap');
    // Brief §3.3 step 5: the vendor row is renamed, not removed —
    // the merged Scrap sells at the old ScrapAlloy anchor for one
    // slice; slice 6 removes the line outright.
    const vendorScrap = VENDOR_MATERIALS.find((e) => e.id === MaterialType.Scrap);
    expect(vendorScrap?.unitPrice).toBe(10);
    expect(vendorScrap?.name).toBe('Scrap');
  });
});

// ---------------------------------------------------------------------------
// 2. Migration text pins
// ---------------------------------------------------------------------------

describe('scrap merge — migration 0069 pins', () => {
  it('carries the conversion, the audit ledger, and the self-check', () => {
    expect(MIGRATION).toContain('create table if not exists public.scrap_merge_audit');
    expect(MIGRATION).toContain('insert into public.scrap_merge_audit');
    expect(MIGRATION).toContain('on conflict (profile_id) do nothing');
    // The brief §3.3 formula: stack := stack + column + alloy stack,
    // the alloy key is removed, and the column zeroes.
    expect(MIGRATION).toContain("+ coalesce((materials ->> 'ScrapAlloy')::bigint, 0)");
    expect(MIGRATION).toContain("- 'ScrapAlloy'");
    expect(MIGRATION).toContain("raise exception '0069 self-check failed");
    expect(MIGRATION).toContain("a ScrapAlloy stack survived the conversion");
    // Conversion is scoped to affected rows — that is what makes a
    // re-apply a no-op (idempotent).
    expect(MIGRATION.match(/where scrap > 0/g)).toHaveLength(2);
  });

  it('rekeys the stored data the brief names (§3.3 steps 2–4)', () => {
    // In-flight job escrows fold onto the merged stack; open listings
    // relabel; unsettled dispatch payouts rekey.
    expect(MIGRATION).toContain('update public.craft_jobs');
    expect(MIGRATION).toContain("set material_id = 'Scrap', identity_key = 'mat:Scrap'");
    expect(MIGRATION).toContain("set payout_material_id = 'Scrap'");
    // The retired key is unlistable afterward.
    const keyList = MIGRATION.match(/select p_key = any \(array\[([\s\S]*?)\]\)/)?.[1] ?? '';
    expect(keyList).not.toContain('ScrapAlloy');
  });

  it('no restated code path still writes the retired column', () => {
    expect(MIGRATION).not.toContain('scrap = scrap');
    expect(MIGRATION).not.toContain('p.scrap');
    expect(MIGRATION).not.toContain('profile_row.scrap');
    expect(MIGRATION).not.toContain('.scrap +');
    expect(MIGRATION).not.toContain('.scrap -');
    // The only column writes left are the two tombstone zeroings
    // (conversion + reset reseed).
    expect(MIGRATION.match(/scrap = 0/g)).toHaveLength(2);
  });

  it('restates the full recipe catalog with renamed keys — the merge’s primary proof (§3.4)', () => {
    const parts = MIGRATION.split('$catalog$');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const catalog = JSON.parse(parts[1]) as Array<Record<string, unknown>>;
    expect(catalog).toHaveLength(87);
    expect(catalog).toEqual(JSON.parse(JSON.stringify(ALL_CRAFT_RECIPES)));
    // 65 recipes price in Scrap after the rename; none keys the old id.
    expect(catalog.filter((r) => JSON.stringify(r.inputs ?? {}).includes('"Scrap"'))).toHaveLength(65);
    expect(JSON.stringify(catalog)).not.toContain('ScrapAlloy');
  });

  it('restates the full faucet/sink/reader surface', () => {
    for (const fn of [
      'cc_is_material_key', 'cc_market_create_material',
      'cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_recycle_item',
      'cc_dispatch_settle_mission', 'cc_apply_chef_boss_attempt',
      'cc_apply_endless_encounter', 'cc_start_endless_run', 'cc_end_endless_run',
      'cc_initial_bundle', 'cc_enqueue_craft_job', 'cc_enqueue_tint_job',
      'cc_cancel_craft_job', 'cc_reforge_item', 'cc_reroll_contract',
      'cc_profile_snapshot', 'cc_recalculate_net_worth', 'cc_reset_progress',
      'player_public_stats', 'cc_craft_recipe_catalog', 'cc_vendor_catalog',
    ]) {
      expect(MIGRATION).toContain(fn);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. InMemory gameplay twin
// ---------------------------------------------------------------------------

describe('scrap merge — gameplay twin settles on the stack', () => {
  it('seedProfile folds a legacy scrap seed into materials', () => {
    const store = new InMemoryChefGameplayStore();
    const p = store.seedProfile({ id: A, scrap: 250 });
    expect(p.materials['Scrap']).toBe(250);
    expect('scrap' in p && typeof (p as { scrap?: unknown }).scrap === 'number').toBe(false);
  });

  it('a roaming claim pays the stack and the snapshot projects it', async () => {
    const store = new InMemoryChefGameplayStore();
    const p = store.seedProfile({ id: A, scrap: 100 });
    const result = (await store.applyChefRewards(
      A,
      { credits: 0, scrap: 40, xp: 0, fragments: 0, materials: {}, essences: {}, kills: 0 },
      10,
      'dustwaste',
    )) as { profile?: { scrap?: number } };
    expect(p.materials['Scrap']).toBe(140);
    expect(result.profile?.scrap).toBe(140);
  });

  it('salvage pays the stack (value formula untouched)', async () => {
    const store = new InMemoryChefGameplayStore();
    const p = store.seedProfile({ id: A, scrap: 0 });
    store.seedItem({ id: 'item-1', owner_user_id: A, rarity: 'Common', item_level: 1 });
    const result = (await store.recycleItem(A, nonce(), 'item-1')) as { scrap_award?: number };
    expect(result.scrap_award).toBeGreaterThan(0);
    expect(p.materials['Scrap']).toBe(result.scrap_award);
  });
});

// ---------------------------------------------------------------------------
// 4. InMemory writes twin
// ---------------------------------------------------------------------------

function writesSeed(): WriteSeed {
  const s = emptyWriteSeed();
  const profile = (overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData => ({
    username: null, display_name: null, player_level: 25, player_xp: 0, credits: 0,
    scrap: 0, cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {},
    consumables: {}, skill_spends: {}, boss_state: {}, last_idle_claim_at: '2026-10-29T10:00:00.000Z',
    last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: '2026-10-28T00:00:00.000Z',
    account_type: 'verified', email: null, email_verified_at: '2026-06-14T00:00:00.000Z',
    verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
    last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
    username_updated_at: null, username_change_count: 0, vehicle_fuel: 0,
    workshop_benches: 3, workshop_tools: {},
    ...overrides,
  } as ProfileRowData);
  s.profiles = [
    profile({
      id: A, username: 'alpha', credits: 100_000, scrap: 100_000,
      materials: { TemperedParts: 50, RefinedAlloy: 50, CompositePlating: 50, PrismShards: 50, Chromaweave: 5 },
    }),
    profile({ id: B, username: 'bravo', credits: 100_000, scrap: 0, materials: { Scrap: 30 } }),
  ];
  s.activeActions = [
    {
      user_id: A, active_action: 'crafting', started_at: '2026-10-29T11:00:00.000Z',
      completes_at: null, target_type: null, target_id: null, target_label: null,
      scene_key: null, notes: null, activity_payload: {}, public_payload: {},
      last_heartbeat_at: '2026-10-29T11:00:00.000Z', public_visible: true, schema_version: 1,
      updated_at: '2026-10-29T11:00:00.000Z',
    },
  ];
  return s;
}

const stackOf = (store: InMemoryWriteStore, id: string) =>
  store.seed.profiles.find((p) => p.id === id)!.materials['Scrap'] ?? 0;

describe('scrap merge — writes twin settles on the stack', () => {
  it('the seed fold moves legacy scrap into the stack and zeroes the field', () => {
    const store = new InMemoryWriteStore(writesSeed());
    const a = store.seed.profiles.find((p) => p.id === A)!;
    expect(a.materials['Scrap']).toBe(100_000);
    expect(a.scrap).toBe(0);
    // A profile seeded with a stack only is untouched by the fold.
    expect(stackOf(store, B)).toBe(30);
    void store;
  });

  it('Scrap lists and sells end-to-end on the player market', async () => {
    const store = new InMemoryWriteStore(writesSeed());
    const created = (await store.marketCreateMaterial(A, nonce(), 'Scrap', 400, 500)) as {
      listing?: { id?: string };
    };
    expect(stackOf(store, A)).toBe(100_000 - 400);
    const listingId = created.listing?.id;
    expect(listingId).toBeTruthy();
    const bCreditsBefore = store.seed.profiles.find((p) => p.id === B)!.credits;
    await store.acceptListing(B, nonce(), listingId!);
    expect(stackOf(store, B)).toBe(30 + 400);
    expect(store.seed.profiles.find((p) => p.id === B)!.credits).toBe(bCreditsBefore - 500);
    // The seller was paid (net of the standard market fee).
    expect(store.seed.profiles.find((p) => p.id === A)!.credits).toBeGreaterThan(100_000);
  });

  it('a cosmetic enqueue escrows Scrap from the stack; cancelling a queued job refunds it in full', async () => {
    const store = new InMemoryWriteStore(writesSeed(), {
      now: () => new Date('2026-10-29T12:00:00.000Z'),
    });
    const recipe = getCraftRecipe(skinPartCatalog('dread-arm-upper-n')!.recipeId)!;
    const cost = recipe.inputs.Scrap ?? 0;
    expect(cost).toBeGreaterThan(0);
    // The first job starts on the bench; the second queues behind it
    // (unstarted — a cancel refunds unstarted units in full, the
    // generic material schedule Scrap now rides like any input).
    await store.enqueueCraftJob(A, nonce(), {
      bench: 2, recipeId: recipe.id, units: 1, consumableEfficiencyBonus: 0,
    });
    expect(stackOf(store, A)).toBe(100_000 - cost);
    const queued = (await store.enqueueCraftJob(A, nonce(), {
      bench: 2, recipeId: recipe.id, units: 1, consumableEfficiencyBonus: 0,
    })) as { job?: { id?: string } };
    expect(stackOf(store, A)).toBe(100_000 - 2 * cost);
    const queuedId = queued.job?.id;
    expect(queuedId).toBeTruthy();
    await store.cancelCraftJob(A, nonce(), queuedId!);
    expect(stackOf(store, A)).toBe(100_000 - cost);
  });

  it('an unaffordable Scrap leg refuses with the generic material error', async () => {
    const seed = writesSeed();
    seed.profiles[0] = { ...seed.profiles[0], scrap: 0, materials: {} };
    const store = new InMemoryWriteStore(seed);
    const recipe = getCraftRecipe(skinPartCatalog('dread-arm-upper-n')!.recipeId)!;
    await expect(store.enqueueCraftJob(A, nonce(), {
      bench: 2, recipeId: recipe.id, units: 1, consumableEfficiencyBonus: 0,
    })).rejects.toThrow('Insufficient material Scrap');
  });

  it('a tint job charges its flat Scrap leg from the stack', async () => {
    const itemId = '99999999-9999-4999-8999-999999999999';
    const seed = writesSeed();
    seed.items.push({
      id: itemId, owner_user_id: A, kind: 'cosmetic', static_item_id: null,
      item_level: 1, rarity: 'Common', quality: null, material_tier: null,
      condition_state: null, condition_current: null, condition_max: null,
      supply_mode: 'verified_action', source_id: null, creator_user_id: null,
      tradeable: true, account_bound: false, locked_until: null,
      payload: {
        name: 'Dreadplate Helm', partId: 'dread-head', slot: 'head', setId: 'dreadplate',
        tier: 'repaint', quality: 70, tintPaletteId: null, origin: 'crafted', craftedBy: A,
      },
      runtime_state: 'available', is_locked: false, equipped_slot: null,
      estimated_value: 100, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    } as never);
    const store = new InMemoryWriteStore(seed);
    await store.enqueueTintJob(A, nonce(), { itemId, paletteId: 'arctic' });
    // tint_craft's flat leg is 25 Scrap, charged at enqueue.
    expect(stackOf(store, A)).toBe(100_000 - 25);
  });

  it('the initial bundle pays its +500 into the stack', async () => {
    const seed = writesSeed();
    const store = new InMemoryWriteStore(seed);
    const result = (await store.initialBundle(B, nonce())) as { profile?: { scrap?: number } };
    expect(stackOf(store, B)).toBe(30 + 500);
    expect(result.profile?.scrap).toBe(530);
  });
});

// ---------------------------------------------------------------------------
// 5. Reads twins
// ---------------------------------------------------------------------------

describe('scrap merge — reads project the one stock', () => {
  it('the InMemory read store folds the seed and projects on read', async () => {
    const seed: ReadSeed = {
      ...emptyReadSeed(),
      profiles: [{
        id: A, username: 'alpha', display_name: null, player_level: 10, player_xp: 0,
        credits: 500, scrap: 77, cache_tokens: 0, cache_token_parts: 0,
        materials: {}, essences: {}, consumables: {}, skill_spends: {}, boss_state: {},
        last_idle_claim_at: '2026-10-29T10:00:00.000Z', last_claimed_tick: 0,
        created_at: '2026-06-14T00:00:00.000Z', updated_at: '2026-10-28T00:00:00.000Z',
        account_type: 'verified', email: null, email_verified_at: null,
        verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
        last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
        username_updated_at: null,
      } as unknown as ProfileRowData],
    };
    const store = new InMemoryReadStore(seed);
    const profile = await store.getProfile(A);
    expect(profile?.scrap).toBe(77);
    expect(profile?.materials['Scrap']).toBe(77);
  });

  it('mapProfile derives scrap from materials, never the retired column', () => {
    const row = {
      id: A, player_xp: 0, credits: 10, scrap: 0,
      materials: { Scrap: 42, BallisticParts: 3 },
      last_claimed_tick: 0, offline_cap_hours: 2,
      last_idle_claim_at: new Date('2026-10-29T10:00:00.000Z'),
      created_at: new Date('2026-06-14T00:00:00.000Z'),
      updated_at: new Date('2026-10-28T00:00:00.000Z'),
      email_verified_at: null, verification_grace_expires_at: null,
      verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
      username_updated_at: null,
    };
    const mapped = mapProfile(row as never);
    expect(mapped.scrap).toBe(42);
  });
});
