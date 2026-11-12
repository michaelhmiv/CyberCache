/**
 * Skins / cosmetics (migration 0053) — the M4 slice pins:
 *
 *   - 0053's restated SQL catalog deep-equals the TS catalog
 *     (87 recipes; cosmetics excepted — their requiresLevel was
 *     removed by 0056, whose restated catalog pins them; the
 *     consumables are excepted in turn at 0056 — their levels were
 *     removed by 0057, which carries the full-catalog pin in
 *     gateRemovalStep2.test.ts), the listing-kind check carries
 *     'cosmetic',
 *     the material whitelist carries 'Chromaweave', and the
 *     mastery seed + cosmetic functions exist.
 *   - The wave-1 art gates: both skin sets lint clean under the
 *     parts-system joint rules, every catalog part has a render
 *     def + a scrap-led recipe, and look resolution swaps worn
 *     parts over the empty frame (never overlays).
 *   - Behavior against the InMemory twins (the wire contracts the
 *     routes expose): craft → item → equip, the Standing
 *     grandfather exception, list-auto-unequip → accept at the
 *     standard fee, and the tint flow.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_CRAFT_RECIPES, getCraftRecipe } from '@/content/crafting';
import {
  SKIN_PARTS,
  TINT_PALETTES,
  skinPartCatalog,
} from '@/content/skins';
import { BULWARK_SET, DREADPLATE_SET, SKIN_PART_DEFS } from '@/lib/pixel/skinParts';
import { lintPartSet } from '@/lib/pixel/parts';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import { resolveLookView, resolveOwnLook } from '@/lib/pixel/lookResolution';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import type { ProfileRowData } from '../server/reads/store';
import type { Json } from '../server/writes/store';

const MIGRATION = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0053_skins_cosmetics.sql'),
  'utf8',
);

const MIGRATION_0056 = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0056_cosmetic_recipe_levels.sql'),
  'utf8',
);
const MIGRATION_0073 = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0073_bench_collapse_relic_merger.sql'),
  'utf8',
);
const MIGRATION_0092 = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0092_cosmetics_view_tier.sql'),
  'utf8',
);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let nonceCounter = 0;
const nonce = () => `test-nonce-${++nonceCounter}`;

// ─── 0053 textual pins ──────────────────────────────────────────

describe('migration 0053 — catalog + schema pins', () => {
  it('the restated SQL catalog deep-equals the TS catalog (87 recipes)', () => {
    const parts = MIGRATION.split('$catalog$');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const catalog = JSON.parse(parts[1]) as Array<Record<string, unknown>>;
    expect(catalog).toHaveLength(87);
    // Cosmetic requiresLevel postdates 0053: gate-removal step 1
    // (0056) deleted the L5/L10/L12 recipe levels, so the cosmetics
    // are excluded here and pinned against 0056's restated catalog
    // in the 0056 describe below. Consumable requiresLevel postdates
    // it in turn: step 2 (0057) deleted the L3–L20 tiers, so the
    // consumables are excluded here too and pinned against 0057's
    // restated catalog in gateRemovalStep2.test.ts. Everything else
    // in 0053's catalog still deep-equals the TS catalog.
    // Econ 5 (0069) renamed the ScrapAlloy input key to Scrap in 38
    // recipes (37 consumables + refine_refined_alloy in this set);
    // those rows are pinned against 0069's restated catalog in
    // scrapMerge.test.ts instead.
    const renamedBy0069 = new Set(
      catalog
        .filter((r) => JSON.stringify(r.inputs ?? {}).includes('ScrapAlloy'))
        .map((r) => String(r.id)),
    );
    // Slice 9 (0073) in turn changed rows inside this kept set
    // (the 3 tool recipes' family change + 4 furnace refines'
    // requiresBench) and added relic_prime_laboratory; those are
    // carved here and pinned against 0073 in econBenchRelic.
    const changed9 = changedBy0073(catalog);
    const withoutSuperseded = (rows: Array<Record<string, unknown>>) =>
      rows.filter((r) => r.category !== 'cosmetics' && r.kind !== 'consumable' && !renamedBy0069.has(String(r.id)) && !changed9.has(String(r.id)) && r.id !== 'relic_prime_laboratory');
    expect(catalog.filter((r) => r.category === 'cosmetics')).toHaveLength(27);
    expect(catalog.filter((r) => r.kind === 'consumable')).toHaveLength(43);
    expect(withoutSuperseded(catalog)).toEqual(
      withoutSuperseded(JSON.parse(JSON.stringify(ALL_CRAFT_RECIPES))),
    );
  });

  it('widens the listing-kind check and stamps the cosmetic card columns', () => {
    expect(MIGRATION).toContain("'fragment', 'core', 'essence', 'cosmetic'");
    expect(MIGRATION).toContain('add column if not exists part_id');
    expect(MIGRATION).toContain('add column if not exists tint_palette_id');
  });

  it('the material whitelist carries Chromaweave in both functions', () => {
    const isKey = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.cc_is_material_key'));
    expect(isKey.slice(0, 4000)).toContain("'Chromaweave'");
    const create = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.cc_market_create_material'));
    expect(create.slice(0, 6000)).toContain("'Chromaweave'");
  });

  it('restates the extraction applier with Chromaweave in its material whitelist', () => {
    const applier = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.cc_apply_extraction'));
    expect(applier).toContain("'Voidweave','Chromaweave'");
  });

  it('seeds the cosmetic mastery track and the selection table', () => {
    expect(MIGRATION).toContain("'crafting.cosmetics'");
    expect(MIGRATION).toContain('create table if not exists public.player_skin_selection');
    for (const fn of [
      'cc_enqueue_tint_job', 'cc_cosmetics_view', 'cc_hunter_look_view',
      'cc_cosmetic_equip', 'cc_cosmetic_unequip', 'cc_cosmetic_set_head_variant',
      'cc_finalize_crafted_cosmetic',
    ]) {
      expect(MIGRATION, fn).toContain(`public.${fn}`);
    }
  });
});


/** Slice 9 (0073) changed rows vs a historical catalog: the ids
 * whose 0073 row differs (canonical, key-order-insensitive). */
function changedBy0073(rows: Array<Record<string, unknown>>): Set<string> {
  const catalog0073 = JSON.parse(
    MIGRATION_0073.split('$catalog$')[1],
  ) as Array<Record<string, unknown>>;
  const byId = new Map(catalog0073.map((r) => [String(r.id), r]));
  const canon = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v as Record<string, unknown>).sort()
        .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
  };
  return new Set(
    rows.filter((r) => canon(byId.get(String(r.id))) !== canon(r)).map((r) => String(r.id)),
  );
}

// ─── 0056 textual pins (gate-removal step 1) ────────────────────

describe('migration 0056 — cosmetic recipe levels removed', () => {
  it('the restated SQL catalog deep-equals the TS catalog outside the consumables (87 recipes)', () => {
    const parts = MIGRATION_0056.split('$catalog$');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const catalog = JSON.parse(parts[1]) as Array<Record<string, unknown>>;
    expect(catalog).toHaveLength(87);
    // Consumable requiresLevel postdates 0056: gate-removal step 2
    // (0057) deleted the consumable tiers (L3–L20), so the
    // consumables are excluded here and pinned against 0057's
    // restated catalog in gateRemovalStep2.test.ts. Everything else
    // in 0056's catalog still deep-equals the TS catalog.
    // Econ 5 (0069) renamed the ScrapAlloy input key to Scrap;
    // refine_refined_alloy is the one renamed row in this set — it
    // is pinned against 0069's restated catalog in scrapMerge.test.ts.
    const renamedBy0069 = new Set(
      catalog
        .filter((r) => JSON.stringify(r.inputs ?? {}).includes('ScrapAlloy'))
        .map((r) => String(r.id)),
    );
    // Slice 9 (0073) changed the skin-part recipes' requiresBench
    // (2/3 -> 1), the tool recipes' family, and 4 refines inside
    // this set, and added relic_prime_laboratory — carved here,
    // pinned against 0073 in econBenchRelic.
    const changed9 = changedBy0073(catalog);
    const withoutConsumables = (rows: Array<Record<string, unknown>>) =>
      rows.filter((r) => r.kind !== 'consumable' && !renamedBy0069.has(String(r.id)) && !changed9.has(String(r.id)) && r.id !== 'relic_prime_laboratory');
    expect(catalog.filter((r) => r.kind === 'consumable')).toHaveLength(43);
    expect(withoutConsumables(catalog)).toEqual(
      withoutConsumables(JSON.parse(JSON.stringify(ALL_CRAFT_RECIPES))),
    );
  });

  it('every cosmetic recipe sits at the no-gate level 1 in both catalogs; benches collapsed by slice 9', () => {
    const sqlCatalog = JSON.parse(MIGRATION_0056.split('$catalog$')[1]) as Array<Record<string, unknown>>;
    for (const recipe of ALL_CRAFT_RECIPES.filter((r) => r.kind === 'cosmetic')) {
      expect(recipe.requiresLevel, recipe.id).toBe(1);
    }
    for (const row of sqlCatalog.filter((r) => r.kind === 'cosmetic')) {
      expect(row.requiresLevel, String(row.id)).toBe(1);
    }
    // The bench gates WERE a later program step: slice 9's
    // collapse retired them — every recipe now sits at bench 1
    // in TS (0073's catalog agrees; econBenchRelic pins it).
    expect(getCraftRecipe(skinPartCatalog('dread-head')!.recipeId)!.requiresBench).toBe(1);
    expect(getCraftRecipe(skinPartCatalog('bulwark-head')!.recipeId)!.requiresBench).toBe(1);
    expect(getCraftRecipe(skinPartCatalog('mfr-head-redline')!.recipeId)!.requiresBench).toBe(1);
    expect(getCraftRecipe('tint_craft')!.requiresBench).toBe(1);
    // Step 1's boundary, pinned historically: in 0056's own catalog
    // a standing tonic still carried L12 — gate-removal step 2
    // (0057) removed the consumable levels in TS and SQL alike.
    const tonicRow = sqlCatalog.find((r) => r.id === 'recipe_helixworks_standing');
    expect(tonicRow?.requiresLevel).toBe(12);
  });
});

// ─── Content + art gates ────────────────────────────────────────

describe('wave-1 skin content', () => {
  it('both skin sets lint clean under the joint rules', () => {
    for (const set of [BULWARK_SET, DREADPLATE_SET]) {
      const lint = lintPartSet(set);
      expect(lint.errors, `${set.id}: ${lint.errors.join('; ')}`).toEqual([]);
    }
  });

  it('every catalog part has a render def and a scrap-led recipe', () => {
    expect(SKIN_PARTS.length).toBe(26);
    for (const part of SKIN_PARTS) {
      expect(SKIN_PART_DEFS[part.id], part.id).toBeTruthy();
      expect(SKIN_PART_DEFS[part.id].slot, part.id).toBe(part.slot);
      const recipe = getCraftRecipe(part.recipeId);
      expect(recipe, part.recipeId).toBeTruthy();
      expect(recipe!.kind).toBe('cosmetic');
      expect(recipe!.category).toBe('cosmetics');
      expect(recipe!.inputs.Scrap ?? 0, part.id).toBeGreaterThan(0);
      expect(recipe!.maxUnits, part.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('the tint recipe is item-targeted (never generic-enqueueable)', () => {
    const tint = getCraftRecipe('tint_craft')!;
    expect(tint.tintCraft).toBe(true);
    expect(tint.tintPalettes).toHaveLength(TINT_PALETTES.length);
    // Starter palettes cost no Chromaweave (day-one personalization).
    expect(TINT_PALETTES.filter((t) => t.starter).map((t) => t.chromaweave)).toEqual([0, 0]);
  });

  it('look resolution: empty selection is the stock set, a worn part replaces its slot', () => {
    const empty = resolveOwnLook({ selection: null, partsById: new Map(), fallbackHeadVariant: 'visor' });
    expect(empty.set).toBe(STANDARD_ISSUE);

    const worn = resolveOwnLook({
      selection: { equipped: { torso: 'item-1' }, headVariant: 'visor' },
      partsById: new Map([
        ['item-1', {
          id: 'item-1', partId: 'bulwark-torso', slot: 'torso' as const, setId: 'bulwark',
          tier: 'shaped' as const, name: 'Bulwark Siege Torso', quality: 90,
          tintPaletteId: null, runtimeState: 'available',
        }],
      ]),
      fallbackHeadVariant: 'visor',
    });
    expect(worn.set).not.toBe(STANDARD_ISSUE);
    expect(worn.set.parts.torso?.spriteId).toBe(SKIN_PART_DEFS['bulwark-torso'].spriteId);
    // Untouched slots keep the stock parts — replacement is per slot.
    expect(worn.set.parts.head?.spriteId).toBe(STANDARD_ISSUE.parts.head?.spriteId);
  });

  it('public look views resolve the same way (Standings parity)', () => {
    const look = resolveLookView({
      playerId: B, username: 'bravo', headVariant: 'fin',
      parts: { head: { partId: 'dread-head', tintPaletteId: 'void', quality: 40 } },
    });
    expect(look.set.parts.head?.spriteId).toBe(SKIN_PART_DEFS['dread-head'].spriteId);
    expect(look.partPalettes.head?.paletteId).toContain('void');
  });
});

// ─── Behavior: writes twin (craft / tint / market) ──────────────

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
      materials: { TemperedParts: 50, RefinedAlloy: 50, CompositePlating: 50, Chromaweave: 0 },
    }),
    profile({ id: B, username: 'bravo', credits: 100_000, scrap: 0 }),
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

describe('cosmetic crafting — writes twin', () => {
  it('escrows Scrap at enqueue, refuses the tint recipe generically, and completes into a cosmetic item', async () => {
    let nowMs = Date.parse('2026-10-29T12:00:00.000Z');
    const store = new InMemoryWriteStore(writesSeed(), { now: () => new Date(nowMs) });

    await expect(store.enqueueCraftJob(A, nonce(), {
      bench: 2, recipeId: 'tint_craft', units: 1,
    })).rejects.toThrow(/tint/i);

    const recipe = getCraftRecipe(skinPartCatalog('dread-arm-upper-n')!.recipeId)!;
    // Econ 5: the escrow draws from the unified materials['Scrap']
    // stack (the seed's legacy scrap field folded into it).
    const scrapBefore = store.seed.profiles.find((p) => p.id === A)!.materials['Scrap'] ?? 0;
    const job = await store.enqueueCraftJob(A, nonce(), {
      bench: 2, recipeId: recipe.id, units: 1,
    }) as Json;
    expect((job as { job?: Json }).job).toBeTruthy();
    expect(store.seed.profiles.find((p) => p.id === A)!.materials['Scrap'] ?? 0)
      .toBe(scrapBefore - (recipe.inputs.Scrap ?? 0));

    // Settle past the unit duration; the workshop read settles jobs.
    nowMs += recipe.unitDurationMs + 60_000;
    await store.getWorkshopState(A);
    const items = store.seed.items.filter((i) => i.owner_user_id === A && i.kind === 'cosmetic');
    expect(items).toHaveLength(1);
    expect((items[0].payload as { partId?: string }).partId).toBe('dread-arm-upper-n');
    expect(items[0].runtime_state).toBe('available');
  });

  it('maxUnits refuses a second Bulwark helm in one job', async () => {
    const store = new InMemoryWriteStore(writesSeed(), { now: () => new Date('2026-10-29T12:00:00.000Z') });
    const recipe = getCraftRecipe(skinPartCatalog('bulwark-head')!.recipeId)!;
    await expect(store.enqueueCraftJob(A, nonce(), {
      bench: 3, recipeId: recipe.id, units: 2,
    })).rejects.toThrow(/at most|units/i);
  });
});

// ─── Gate-removal step 1: level 1 + bench + materials is enough ──

describe('cosmetic crafting after gate-removal step 1 (0056)', () => {
  function levelOneSeed(benches: number): WriteSeed {
    const s = writesSeed();
    const a = s.profiles.find((p) => p.id === A)!;
    a.player_level = 1;
    a.workshop_benches = benches;
    a.materials = { ...a.materials, PrismShards: 10, NitrocellGel: 5 };
    return s;
  }
  const now = () => new Date('2026-10-29T12:00:00.000Z');

  it('a level-1 player enqueues Dreadplate (bench 2, was L5) and Bulwark (bench 3, was L10)', async () => {
    const store = new InMemoryWriteStore(levelOneSeed(3), { now });
    const dread = getCraftRecipe(skinPartCatalog('dread-head')!.recipeId)!;
    const bulwark = getCraftRecipe(skinPartCatalog('bulwark-head')!.recipeId)!;
    await store.enqueueCraftJob(A, nonce(), {
      bench: 2, recipeId: dread.id, units: 1,
    });
    await store.enqueueCraftJob(A, nonce(), {
      bench: 3, recipeId: bulwark.id, units: 1,
    });
  });

  it('a manufacturer head NO LONGER enqueues at any level (Hero Pass H1 delisting supersedes the 0056 pin)', async () => {
    // Pre-H1 this test pinned the opposite: the maker helms were
    // normal craft-pool parts and a level-1 player could enqueue
    // one. Q2 (owner-ruled 2026-11-06) retired them to the
    // Standing pick lane — the enqueue now refuses, at level 1
    // and everywhere else. heroPassH1.test.ts carries the full
    // delisting + grandfathering suite.
    const store = new InMemoryWriteStore(levelOneSeed(3), { now });
    const head = getCraftRecipe(skinPartCatalog('mfr-head-redline')!.recipeId)!;
    await expect(store.enqueueCraftJob(A, nonce(), {
      bench: 2, recipeId: head.id, units: 1,
    })).rejects.toThrow(/retired/);
  });

  it('no bench gate binds a cosmetic anymore (slice 9): the dread head enqueues on the one bench', async () => {
    const store = new InMemoryWriteStore(levelOneSeed(1), { now });
    const dread = getCraftRecipe(skinPartCatalog('dread-head')!.recipeId)!;
    // Pre-collapse: 'Bench not unlocked' / 'requires bench 2 or
    // higher'. Post-collapse the former bench-2 cosmetic runs on
    // the single bench.
    await expect(store.enqueueCraftJob(A, nonce(), {
      bench: 1, recipeId: dread.id, units: 1,
    })).resolves.toBeTruthy();
  });
});


function cosmeticItem(id: string, owner: string, partId: string, slot: string, name: string, quality = 70): never {
  return {
    id, owner_user_id: owner, kind: 'cosmetic', static_item_id: null,
    item_level: 1, rarity: 'Common', quality: null, material_tier: null,
    condition_state: null, condition_current: null, condition_max: null,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null,
    tradeable: true, account_bound: false, locked_until: null,
    payload: {
      name, partId, slot, setId: partId.startsWith('bulwark') ? 'bulwark' : 'dreadplate',
      tier: partId.startsWith('bulwark') ? 'shaped' : 'repaint',
      quality, tintPaletteId: null, origin: 'crafted', craftedBy: owner,
    },
    runtime_state: 'available', is_locked: false, equipped_slot: null,
    estimated_value: 100, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as never;
}

describe('tint jobs — writes twin', () => {
  it('a starter tint completes onto the part payload', async () => {
    let nowMs = Date.parse('2026-10-29T12:00:00.000Z');
    const itemId = '99999999-9999-4999-8999-999999999999';
    const seed = writesSeed();
    seed.items.push(cosmeticItem(itemId, A, 'dread-head', 'head', 'Dreadplate Helm'));
    const store = new InMemoryWriteStore(seed, { now: () => new Date(nowMs) });

    await store.enqueueTintJob(A, nonce(), { itemId, paletteId: 'arctic' });
    nowMs += 6 * 60_000;
    await store.getWorkshopState(A);
    const item = store.seed.items.find((i) => i.id === itemId)!;
    expect((item.payload as { tintPaletteId?: string }).tintPaletteId).toBe('arctic');
  });
});

describe('cosmetic market — writes twin', () => {
  it('listing a worn part auto-unequips it; accept moves it at the standard 5% fee', async () => {
    const itemId = '88888888-8888-4888-8888-888888888888';
    const seed = writesSeed();
    seed.items.push(cosmeticItem(itemId, A, 'bulwark-torso', 'torso', 'Bulwark Siege Torso', 88));
    const store = new InMemoryWriteStore(seed, { now: () => new Date('2026-10-29T12:00:00.000Z') });
    store.seedSkinSelection(A, { torso: itemId }, 'visor');

    const created = await store.marketCreate(A, nonce(), itemId, 5000) as {
      listing?: { id?: string; listing_kind?: string };
    };
    expect(created.listing?.listing_kind).toBe('cosmetic');
    // Auto-unequip: the selection no longer names the part.
    expect(store.skinSelections.get(A)?.equipped.torso).toBeUndefined();

    const sellerBefore = store.seed.profiles.find((p) => p.id === A)!.credits;
    await store.acceptListing(B, nonce(), created.listing!.id!);
    expect(store.seed.items.find((i) => i.id === itemId)!.owner_user_id).toBe(B);
    expect(store.seed.profiles.find((p) => p.id === A)!.credits).toBe(sellerBefore + 4750);
  });
});

// ─── Behavior: gameplay twin (equip + grandfather) ──────────────

describe('cosmetic equip — gameplay twin', () => {
  function gameplayStore() {
    const store = new InMemoryChefGameplayStore(() => new Date('2026-10-29T12:00:00.000Z'));
    store.seedProfile({ id: A, username: 'alpha' });
    store.seedProfile({ id: B, username: 'bravo' });
    return store;
  }

  it('equip validates possession, unequip clears the slot, looks project worn parts only', async () => {
    const store = gameplayStore();
    const itemId = '77777777-7777-4777-8777-777777777777';
    store.seedItem({
      id: itemId, owner_user_id: A, kind: 'cosmetic', runtime_state: 'available',
      payload: {
        name: 'Bulwark Helm', partId: 'bulwark-head', slot: 'head', setId: 'bulwark',
        tier: 'shaped', quality: 77, tintPaletteId: null, origin: 'crafted', craftedBy: A,
      },
    } as never);

    await expect(store.equipCosmetic(B, nonce(), itemId)).rejects.toThrow('Item not found');
    await store.equipCosmetic(A, nonce(), itemId);
    const state = await store.getCosmeticsState(A);
    expect(state?.selection.equipped.head).toBe(itemId);
    expect(state?.parts.map((p) => p.id)).toContain(itemId);

    const looks = await store.getHunterLooks([A]);
    expect(looks[A]?.parts.head?.partId).toBe('bulwark-head');

    await store.unequipCosmetic(A, nonce(), 'head');
    const after = await store.getCosmeticsState(A);
    expect(after?.selection.equipped.head).toBeUndefined();
  });

  it('manufacturer head picks are grandfathered by Standing rank ≥ 3, never below it', async () => {
    const store = gameplayStore();
    await expect(store.setCosmeticHeadVariant(A, nonce(), 'mfr-redline'))
      .rejects.toThrow(/earned at Redline rank 3/);
    store.standingRows.set(`${A}:Redline`, { standing: 0, rank: 3 } as never);
    await store.setCosmeticHeadVariant(A, nonce(), 'mfr-redline');
    const state = await store.getCosmeticsState(A);
    expect(state?.selection.headVariant).toBe('mfr-redline');
    expect(state?.wearableVariantIds).toContain('mfr-redline');
  });
});

// ─── Audit G-F4 — repaint-tier cosmetics must not break the view ────

describe('audit G-F4 — cosmetics view tier handling', () => {
  it('the gameplay twin lists a repaint-tier part with its string tier', async () => {
    const store = new InMemoryChefGameplayStore(() => new Date('2026-10-29T12:00:00.000Z'));
    store.seedProfile({ id: A, username: 'alpha' });
    const itemId = '88888888-8888-4888-8888-888888888888';
    store.seedItem({
      id: itemId, owner_user_id: A, kind: 'cosmetic', runtime_state: 'available',
      payload: {
        name: 'Dreadplate Helm', partId: 'dread-head', slot: 'head', setId: 'dreadplate',
        tier: 'repaint', quality: 88, tintPaletteId: 'crimson', origin: 'crafted', craftedBy: A,
      },
    } as never);
    const state = await store.getCosmeticsState(A);
    const part = state?.parts.find((p) => p.id === itemId);
    expect(part).toBeTruthy();
    expect(part?.tier).toBe('repaint');
  });

  it('migration 0092 restates cc_cosmetics_view with the string-union tier mapping', () => {
    expect(MIGRATION_0092).toContain('create or replace function public.cc_cosmetics_view(p_player_id uuid)');
    expect(MIGRATION_0092).toContain("case when i.payload ->> 'tier' in ('repaint', 'shaped')");
    expect(MIGRATION_0092).toContain("else 'palette' end");
    // The defect itself: no integer cast on the tier value survives.
    expect(MIGRATION_0092).not.toContain("(i.payload ->> 'tier')::integer");
    expect(MIGRATION_0092).not.toMatch(/->> 'tier'\)::/);
  });
});
