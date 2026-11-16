/**
 * Cache Hunters reshape, slice (d) — Workshop whole-skin crafting
 * + part-set conversion (brief §4(d), checks D1–D5).
 *
 * The premise these pins are built on (brief §2.4/§8.2's painting
 * gate): ONLY the four Cast B base paintings exist. Neither part
 * set (Bulwark, Dreadplate) is painted as a whole for any hunter,
 * so the production catalogs are honestly EMPTY where the brief
 * gates on paintings — WHOLE_SKIN_RECIPES is [], conversion
 * grants nothing — and every mechanism is proven against a
 * FIXTURE skin def (a Bulwark whole for Vesper, riding her
 * existing painting) pushed into the catalog for the describes
 * that need one. The fixture never ships: it exists only inside
 * this file's module registry.
 *
 *   D1 — whole-skin recipes ride the cosmetic lane (derivation
 *        pins) and the Pg finalizer mints skin items from pending
 *        outputs (fake-pool, the cosmeticCraftBrick pattern).
 *   D2 — complete sets convert per painted hunter; partials and
 *        the production (painting-less) catalog convert nothing;
 *        parts are never consumed; grants are idempotent.
 *   D3 — every part is delisted: no new crafts (writes twin
 *        refuses), no new listings (writes twin refuses), owned
 *        parts still resolve in the cosmetics view (grandfather).
 *   D4 — HARD LAW: wearing any skin changes no derived stat —
 *        mechanics snapshots are identical across wear states,
 *        and skin defs/payloads carry no stat-shaped fields.
 *   D5 — whole skins trade as their OWN listing family
 *        (kind/category/identity 'skin'), the item moves on
 *        accept, and the buyer can wear it through the ownership
 *        seam; class mods speak their hunter-binding.
 *   0099 — the SQL restatements are their chain heads verbatim
 *        plus the marked insertions (strip-back proofs, the 0098
 *        pattern); the catalog deep-compare removes exactly the
 *        20 part recipes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_CRAFT_RECIPES,
  WHOLE_SKIN_COSTS,
  WHOLE_SKIN_RECIPES,
  buildWholeSkinRecipes,
  getCraftRecipe,
  isDelistedRecipe,
} from '@/content/crafting';
import {
  SKIN_PARTS,
  skinPartCatalog,
  skinPartDelisted,
  skinPartsForSet,
} from '@/content/skins';
import {
  HUNTER_SKINS,
  buildCosmeticSkinPayload,
  evaluateSetConversions,
  isCosmeticSkinPayload,
  isSkinOwned,
  setOwnedSkinIds,
  skinById,
  type HunterSkinDef,
} from '@/lib/hunters/hunterSkins';
import { classModBindingLabel } from '@/lib/hunters/hunters';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { buildCharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { createTickRng } from '@/lib/rng/tickRng';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { DropSource, Rarity } from '@/types/game';
import type { PlayerProfile } from '@/types/player';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { finalizePendingCraftedCosmetics } from '../server/writes/craftFinalize';
import { browseRowFor } from '../server/reads/store';
import type { ProfileRowData } from '../server/reads/store';
import {
  useHunterWardrobeStore,
  wornSkinSpriteId,
} from '@/store/slices/hunterWardrobeSlice';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let nonceCounter = 0;
const nonce = () => `test-nonce-${++nonceCounter}`;

/** The fixture: Bulwark painted whole for Vesper (her Cast B
 *  sprite stands in for the painting). NOT production data. */
const FIXTURE_SKIN: HunterSkinDef = {
  id: 'bulwark-vesper-cole',
  hunterId: 'vesper',
  name: 'Bulwark',
  spriteId: 'hunter-vesper-cole',
  base: false,
  setId: 'bulwark',
};

function withFixtureSkin(run: () => void): void {
  describe('fixture', () => {
    beforeAll(() => {
      HUNTER_SKINS.push(FIXTURE_SKIN);
    });
    afterAll(() => {
      const i = HUNTER_SKINS.indexOf(FIXTURE_SKIN);
      if (i >= 0) HUNTER_SKINS.splice(i, 1);
      setOwnedSkinIds([]);
    });
    run();
  });
}

// ─── Migration 0099 — mechanical provenance proofs ──────────────

const MIG = (name: string) =>
  readFileSync(join(process.cwd(), 'db', 'migrations', name), 'utf8');
const MIG_0099 = MIG('0099_whole_skins.sql');

/** Extract one function's create-or-replace statement (the LAST
 *  definition in the file), dollar-quote aware. The marker carries
 *  the opening paren so sibling functions (cc_market_create_essence
 *  & co.) never match by prefix. */
function fnBody(sql: string, name: string): string {
  const marker = `create or replace function public.${name}(`;
  const start = sql.lastIndexOf(marker);
  expect(start, name).toBeGreaterThanOrEqual(0);
  let i = start;
  let tag: string | null = null;
  const tagRe = /\$[A-Za-z_0-9]*\$/y;
  while (i < sql.length) {
    if (tag === null) {
      tagRe.lastIndex = i;
      const m = tagRe.exec(sql);
      if (m) {
        tag = m[0];
        i += m[0].length;
        continue;
      }
      if (sql[i] === ';') return sql.slice(start, i + 1);
      i += 1;
    } else {
      if (sql.startsWith(tag, i)) {
        i += tag.length;
        tag = null;
        continue;
      }
      i += 1;
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function catalogOf(sql: string, name: string): Array<Record<string, unknown>> {
  const body = fnBody(sql, name);
  const m = body.match(/\$catalog\$([\s\S]*?)\$catalog\$/);
  expect(m, 'catalog markers').toBeTruthy();
  return JSON.parse(m![1]) as Array<Record<string, unknown>>;
}

// The exact 0099 insertions (mirrors the migration builder; the
// strip-back assertions below fail if either side drifts).
const VIEW_PARTID_LINE = "        and i.payload ? 'partId'\n";
const VIEW_SKINS_AGG = `    'skins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'skinId', i.payload ->> 'skinId',
        'hunterId', i.payload ->> 'hunterId',
        'name', i.payload ->> 'name',
        'setId', i.payload ->> 'setId',
        'quality', (i.payload ->> 'quality')::integer,
        'origin', i.payload ->> 'origin',
        'runtimeState', i.runtime_state
      ) order by i.created_at)
      from public.item_instances i
      where i.owner_user_id = p_player_id
        and i.kind = 'cosmetic'
        and i.payload ? 'skinId'
        and i.runtime_state in ('available', 'locked')
    ), '[]'::jsonb),
`;
const COMPLETE_SKIN_BRANCH = `    elsif recipe ? 'cosmeticSkinId' then
      -- Whole-skin craft (reshape slice (d), 0099): the same
      -- finish roll as a part craft — the quality is a
      -- collection finish, never a stat — and the output pends
      -- for the skin finalizer (cc_pending_crafted_skins).
      v_ml := public.cc_player_mastery_level(actor, 'crafting.cosmetics');
      v_hi := 95 + least(15, 0.3 * v_ml);
      v_roll := round((
        (35 + random() * greatest(0, v_hi - 35))
        * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
      )::numeric) + v_shift;
      v_roll := least(100, greatest(1, v_roll))::integer;
      v_output := v_output || jsonb_build_object(
        'pending', true,
        'cosmeticSkinId', recipe ->> 'cosmeticSkinId',
        'quality', v_roll
      );
`;
const MARKET_SKIN_BRANCH = `    if item.payload ? 'skinId' then
      -- Whole-skin listing (reshape slice (d), 0099): skins
      -- trade as their OWN listing family — no part columns,
      -- no auto-unequip (wearing is the device-local wardrobe;
      -- a listed skin stops being owned, and the seller's worn
      -- selection falls back on their next cosmetics read).
      insert into public.market_listings(
        seller_user_id, item_instance_id, price_credits, status,
        listing_kind, quantity, material_id, identity_key, category,
        display_name, seller_type, part_id, tint_palette_id, quality_percent,
        deposit_scrap)
      values (
        actor, item.id, price_credits, 'active',
        'skin', 1, null, 'skin:' || (item.payload ->> 'skinId'), 'skin',
        item.payload ->> 'name', 'player', null,
        null, (item.payload ->> 'quality')::numeric,
        v_deposit)
      returning * into listing;
      update public.item_instances set runtime_state = 'listed' where id = item.id returning * into item;
      result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
      insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
      return result;
    end if;
`;
const TINT_GATE = `  -- Whole skins (slice (d), 0099) share the cosmetic kind but
  -- are not parts: a tint names a part payload or it does not start.
  if not (item.payload ? 'partId') then raise exception 'Item is not a cosmetic part'; end if;
`;

describe('migration 0099 — verbatim heads plus the marked insertions', () => {
  it('cc_cosmetics_view = 0092 head + the partId gate + the skins array', () => {
    const head = fnBody(MIG('0092_cosmetics_view_tier.sql'), 'cc_cosmetics_view');
    const next = fnBody(MIG_0099, 'cc_cosmetics_view');
    expect(next.replace(VIEW_PARTID_LINE, '').replace(VIEW_SKINS_AGG, '')).toBe(head);
  });

  it('cc_complete_craft_unit = 0073 head + the skin completion branch', () => {
    const head = fnBody(MIG('0073_bench_collapse_relic_merger.sql'), 'cc_complete_craft_unit');
    const next = fnBody(MIG_0099, 'cc_complete_craft_unit');
    expect(next.replace(COMPLETE_SKIN_BRANCH, '')).toBe(head);
  });

  it('cc_market_create = 0087 head + the skin listing branch', () => {
    const head = fnBody(MIG('0087_scrap_portfolio.sql'), 'cc_market_create');
    const next = fnBody(MIG_0099, 'cc_market_create');
    expect(next.replace(MARKET_SKIN_BRANCH, '')).toBe(head);
  });

  it('cc_accept_listing = 0097 head with skin in the three item-backed kind lists', () => {
    const head = fnBody(MIG('0097_cache_hunters.sql'), 'cc_accept_listing');
    const next = fnBody(MIG_0099, 'cc_accept_listing');
    expect(next.split("('gear', 'vehicle', 'cosmetic', 'skin')").join("('gear', 'vehicle', 'cosmetic')")).toBe(head);
    expect(next.match(/\('gear', 'vehicle', 'cosmetic', 'skin'\)/g)).toHaveLength(3);
  });

  it('cc_market_cancel = 0087 head with skin in the item-backed kind list', () => {
    const head = fnBody(MIG('0087_scrap_portfolio.sql'), 'cc_market_cancel');
    const next = fnBody(MIG_0099, 'cc_market_cancel');
    expect(next.split("('gear', 'vehicle', 'cosmetic', 'skin')").join("('gear', 'vehicle', 'cosmetic')")).toBe(head);
  });

  it('cc_enqueue_tint_job = 0075 head + the part-payload gate', () => {
    const head = fnBody(MIG('0075_bench_time.sql'), 'cc_enqueue_tint_job');
    const next = fnBody(MIG_0099, 'cc_enqueue_tint_job');
    expect(next.replace(TINT_GATE, '')).toBe(head);
  });

  it('the catalog loses exactly the 20 part recipes (deep-compare)', () => {
    const before = catalogOf(MIG('0088_overclock_serum_recipe.sql'), 'cc_craft_recipe_catalog');
    const after = catalogOf(MIG_0099, 'cc_craft_recipe_catalog');
    const removed = before.filter((r) => !after.some((a) => a.id === r.id));
    expect(removed.map((r) => r.id).sort()).toEqual(
      SKIN_PARTS.filter((p) => p.setId === 'bulwark' || p.setId === 'dreadplate')
        .map((p) => p.recipeId)
        .sort(),
    );
    expect(after).toEqual(before.filter((r) => !removed.includes(r)));
    // The tint craft survives; no recipe carries a skin output yet.
    expect(after.some((r) => r.id === 'tint_craft')).toBe(true);
    expect(after.some((r) => 'cosmeticSkinId' in r)).toBe(false);
    // SQL↔TS parity: every remaining SQL recipe exists in the TS
    // registry, and the TS-only recipes are exactly the 26 retired
    // part recipes (kept resolvable for in-flight jobs).
    const tsIds = new Set(ALL_CRAFT_RECIPES.map((r) => r.id));
    for (const r of after) expect(tsIds.has(r.id as string), String(r.id)).toBe(true);
    const sqlIds = new Set(after.map((r) => r.id));
    const tsOnly = ALL_CRAFT_RECIPES.filter((r) => !sqlIds.has(r.id)).map((r) => r.id).sort();
    expect(tsOnly).toEqual(SKIN_PARTS.map((p) => p.recipeId).sort());
  });

  it('the new objects: skin kind check, paintings gate (zero rows), conversion + finalizer pair', () => {
    expect(MIG_0099).toContain("'cosmetic', 'skin')");
    expect(MIG_0099).toContain('create table if not exists public.skin_set_paintings');
    expect(MIG_0099).not.toContain('insert into public.skin_set_paintings');
    expect(MIG_0099).toContain('create or replace function public.cc_convert_skin_sets(p_player_id uuid)');
    expect(MIG_0099).toContain('create or replace function public.cc_pending_crafted_skins(p_player_id uuid)');
    expect(MIG_0099).toContain('create or replace function public.cc_finalize_crafted_skin(');
  });
});

// ─── D3 — the part retirement (production catalogs) ─────────────

describe('D3 — every part delisted; the lane carries no part recipes', () => {
  it('all 26 catalog parts are delisted and every part recipe reads delisted', () => {
    expect(SKIN_PARTS).toHaveLength(26);
    for (const part of SKIN_PARTS) {
      expect(skinPartDelisted(part.id), part.id).toBe(true);
      const recipe = getCraftRecipe(part.recipeId)!;
      expect(isDelistedRecipe(recipe), part.recipeId).toBe(true);
    }
    // The tint service is not a part recipe: it stays available
    // for owned (grandfathered) parts.
    expect(isDelistedRecipe(getCraftRecipe('tint_craft')!)).toBe(false);
  });

  it('the whole-skin lane is armed but empty: no painted non-base skins exist', () => {
    expect(HUNTER_SKINS.every((s) => s.base)).toBe(true);
    expect(WHOLE_SKIN_RECIPES).toEqual([]);
    expect(WHOLE_SKIN_COSTS).toEqual({});
    for (const skin of HUNTER_SKINS) {
      expect(getPixelSprite(skin.spriteId), skin.id).toBeTruthy();
    }
  });
});

// ─── D1 — the recipe derivation + payload (fixture) ─────────────

describe('D1 — whole-skin recipe derivation', () => {
  it('a painted non-base skin yields one scrap-led cosmetic-lane recipe', () => {
    const recipes = buildWholeSkinRecipes([FIXTURE_SKIN], {
      [FIXTURE_SKIN.id]: { inputs: { Scrap: 9000, CompositePlating: 2 }, minutes: 240, bench: 1 },
    });
    expect(recipes).toHaveLength(1);
    const recipe = recipes[0];
    expect(recipe.id).toBe('recipe_skin_whole_bulwark_vesper_cole');
    expect(recipe.kind).toBe('cosmetic');
    expect(recipe.category).toBe('cosmetics');
    expect(recipe.cosmeticSkinId).toBe(FIXTURE_SKIN.id);
    expect(recipe.cosmeticPartId).toBeUndefined();
    expect(recipe.inputs.Scrap).toBeGreaterThan(0);
    expect(recipe.maxUnits).toBe(1);
  });

  it('base skins never yield recipes, and an unpriced painting fails loudly', () => {
    expect(buildWholeSkinRecipes(HUNTER_SKINS, {})).toEqual([]);
    expect(() => buildWholeSkinRecipes([FIXTURE_SKIN], {})).toThrow(/Missing whole-skin craft cost/);
  });

  it('the payload builder stamps def facts only — and refuses base/unknown skins', () => {
    expect(buildCosmeticSkinPayload('vesper-standard-issue', 90, 'crafted', A)).toBeNull();
    expect(buildCosmeticSkinPayload('no-such-skin', 90, 'crafted', A)).toBeNull();
  });
});

withFixtureSkin(() => {
  it('D1 — the payload builder stamps the fixture skin; the guard round-trips', () => {
    const payload = buildCosmeticSkinPayload(FIXTURE_SKIN.id, 92, 'crafted', A);
    expect(payload).toEqual({
      name: 'Bulwark',
      skinId: FIXTURE_SKIN.id,
      hunterId: 'vesper',
      setId: 'bulwark',
      quality: 92,
      origin: 'crafted',
      craftedBy: A,
    });
    expect(isCosmeticSkinPayload(payload)).toBe(true);
    expect(isCosmeticSkinPayload({ partId: 'bulwark-head' })).toBe(false);
  });

  it('D1 — the Pg finalizer mints a skin item from a pending skin output', async () => {
    const SKIN_JOB = '55555555-5555-4555-8555-555555555555';
    const inserts: Array<{ sql: string; params: unknown[] }> = [];
    const finalizeSkins: unknown[][] = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('cc_pending_crafted_skins')) {
          return { rows: [{ job_id: SKIN_JOB, unit: 1, skin_id: FIXTURE_SKIN.id, quality: 88 }] };
        }
        if (sql.includes('cc_pending_crafted_cosmetics')) return { rows: [] };
        if (sql.includes('cc_finalize_crafted_skin')) {
          finalizeSkins.push(params);
          return { rows: [{}] };
        }
        if (sql.includes('insert into public.item_instances')) {
          inserts.push({ sql, params });
          return { rows: [{ id: 'skin-item-1' }] };
        }
        return { rows: [] };
      },
    } as unknown as Pool;
    const finalized = await finalizePendingCraftedCosmetics(pool, A);
    expect(finalized).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain("'cosmetic'");
    const payload = JSON.parse(String(inserts[0].params[1])) as Record<string, unknown>;
    expect(payload.skinId).toBe(FIXTURE_SKIN.id);
    expect(payload.hunterId).toBe('vesper');
    expect(payload.origin).toBe('crafted');
    expect(payload.craftedBy).toBe(A);
    expect(payload.quality).toBe(88);
    expect(finalizeSkins).toEqual([[A, SKIN_JOB, 1, 'skin-item-1']]);
  });
});

// ─── Writes-twin seeds (the skinsCosmetics pattern) ─────────────

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
      materials: { Scrap: 100_000, TemperedParts: 50, RefinedAlloy: 50, CompositePlating: 50, Chromaweave: 0 },
    }),
    profile({ id: B, username: 'bravo', credits: 100_000, scrap: 0, materials: { Scrap: 0 } }),
  ];
  return s;
}

function partItem(id: string, owner: string, partId: string): never {
  const def = skinPartCatalog(partId)!;
  return {
    id, owner_user_id: owner, kind: 'cosmetic', static_item_id: null,
    item_level: 1, rarity: 'Common', quality: null, material_tier: null,
    condition_state: null, condition_current: null, condition_max: null,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null,
    tradeable: true, account_bound: false, locked_until: null,
    payload: {
      name: def.name, partId, slot: def.slot, setId: def.setId,
      tier: def.tier, quality: 70, tintPaletteId: null, origin: 'crafted', craftedBy: owner,
    },
    runtime_state: 'available', is_locked: false, equipped_slot: null,
    estimated_value: 100, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as never;
}

describe('D3 — writes twin: no new part crafts, no new part listings', () => {
  it('enqueue refuses Bulwark and Dreadplate part recipes as retired', async () => {
    const store = new InMemoryWriteStore(writesSeed(), { now: () => new Date('2026-10-29T12:00:00.000Z') });
    for (const partId of ['bulwark-head', 'dread-head']) {
      const recipe = getCraftRecipe(skinPartCatalog(partId)!.recipeId)!;
      await expect(store.enqueueCraftJob(A, nonce(), {
        bench: 1, recipeId: recipe.id, units: 1,
      })).rejects.toThrow(/retired/);
    }
  });

  it('market create refuses a delisted part listing; the part stays owned', async () => {
    const itemId = '88888888-8888-4888-8888-888888888888';
    const seed = writesSeed();
    seed.items.push(partItem(itemId, A, 'bulwark-torso'));
    const store = new InMemoryWriteStore(seed, { now: () => new Date('2026-10-29T12:00:00.000Z') });
    await expect(store.marketCreate(A, nonce(), itemId, 5000))
      .rejects.toThrow(/Retired designs can't be listed/);
    expect(store.seed.items.find((i) => i.id === itemId)!.owner_user_id).toBe(A);
    expect(store.seed.items.find((i) => i.id === itemId)!.runtime_state).toBe('available');
  });
});

// ─── D2 — conversion (evaluator + gameplay twin) ────────────────

describe('D2 — complete-set conversion', () => {
  const bulwarkParts = skinPartsForSet('bulwark').map((p) => p.id);

  it('the production catalog converts nothing — no set is painted', () => {
    const grants = evaluateSetConversions(new Set(bulwarkParts), new Set());
    expect(grants).toEqual([]);
  });

  it('a partial set converts to nothing (the fixture catalog)', () => {
    const partial = new Set(bulwarkParts.slice(0, 9));
    expect(evaluateSetConversions(partial, new Set(), [...HUNTER_SKINS, FIXTURE_SKIN])).toEqual([]);
  });

  it('a complete set grants the painted hunter’s skin, once (the fixture catalog)', () => {
    const catalog = [...HUNTER_SKINS, FIXTURE_SKIN];
    expect(evaluateSetConversions(new Set(bulwarkParts), new Set(), catalog)).toEqual([FIXTURE_SKIN]);
    expect(evaluateSetConversions(new Set(bulwarkParts), new Set([FIXTURE_SKIN.id]), catalog)).toEqual([]);
  });
});

function gameplayStore() {
  const store = new InMemoryChefGameplayStore(() => new Date('2026-10-29T12:00:00.000Z'));
  store.seedProfile({ id: A, username: 'alpha' });
  store.seedProfile({ id: B, username: 'bravo' });
  return store;
}

function seedPart(store: InMemoryChefGameplayStore, owner: string, partId: string, n: number) {
  const def = skinPartCatalog(partId)!;
  store.seedItem({
    id: `part-${owner.slice(0, 4)}-${n}`,
    owner_user_id: owner, kind: 'cosmetic', runtime_state: 'available',
    payload: {
      name: def.name, partId, slot: def.slot, setId: def.setId, tier: def.tier,
      quality: 70, tintPaletteId: null, origin: 'crafted', craftedBy: owner,
    },
  } as never);
}

describe('D2/D3 — gameplay twin: grandfathering + the conversion settle', () => {
  it('owned parts resolve in the view (grandfathered); skins stay empty with no paintings', async () => {
    const store = gameplayStore();
    skinPartsForSet('bulwark').forEach((p, i) => seedPart(store, A, p.id, i));
    const state = await store.getCosmeticsState(A);
    expect(state?.parts).toHaveLength(10);
    expect(state?.skins).toEqual([]);
  });
});

withFixtureSkin(() => {
  it('D2 — a complete set converts on read; parts remain; a second read grants nothing new', async () => {
    const store = gameplayStore();
    skinPartsForSet('bulwark').forEach((p, i) => seedPart(store, A, p.id, i));
    skinPartsForSet('bulwark').slice(0, 9).forEach((p, i) => seedPart(store, B, p.id, i));

    const stateA = await store.getCosmeticsState(A);
    expect(stateA?.skins).toHaveLength(1);
    expect(stateA?.skins[0].skinId).toBe(FIXTURE_SKIN.id);
    expect(stateA?.skins[0].origin).toBe('converted');
    expect(stateA?.skins[0].hunterId).toBe('vesper');
    // Parts are never consumed — they grandfather as collection pieces.
    expect(stateA?.parts).toHaveLength(10);

    const again = await store.getCosmeticsState(A);
    expect(again?.skins).toHaveLength(1);

    const stateB = await store.getCosmeticsState(B);
    expect(stateB?.skins).toEqual([]);
  });

  it('D5/D3 — a skin item is not a part: equip and tint both refuse it as one', async () => {
    const store = gameplayStore();
    const skinItemId = '66666666-6666-4666-8666-666666666666';
    store.seedItem({
      id: skinItemId, owner_user_id: A, kind: 'cosmetic', runtime_state: 'available',
      payload: buildCosmeticSkinPayload(FIXTURE_SKIN.id, 90, 'crafted', A),
    } as never);
    await expect(store.equipCosmetic(A, nonce(), skinItemId)).rejects.toThrow('Part has no wearable slot');
    const state = await store.getCosmeticsState(A);
    expect(state?.skins.map((s) => s.id)).toContain(skinItemId);
    expect(state?.parts.map((p) => p.id)).not.toContain(skinItemId);
  });
});

// ─── D5 — the skin market family (writes twin + browse) ─────────

withFixtureSkin(() => {
  it('D5 — a skin lists in its own family, sells, and the buyer owns it', async () => {
    const itemId = '77777777-7777-4777-8777-777777777777';
    const seed = writesSeed();
    seed.items.push({
      id: itemId, owner_user_id: A, kind: 'cosmetic', static_item_id: null,
      item_level: 1, rarity: 'Common', quality: null, material_tier: null,
      condition_state: null, condition_current: null, condition_max: null,
      supply_mode: 'verified_action', source_id: null, creator_user_id: null,
      tradeable: true, account_bound: false, locked_until: null,
      payload: buildCosmeticSkinPayload(FIXTURE_SKIN.id, 92, 'crafted', A),
      runtime_state: 'available', is_locked: false, equipped_slot: null,
      estimated_value: 100, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    } as never);
    const store = new InMemoryWriteStore(seed, { now: () => new Date('2026-10-29T12:00:00.000Z') });

    const created = await store.marketCreate(A, nonce(), itemId, 5000) as {
      listing?: { id?: string; listing_kind?: string; identity_key?: string; category?: string };
    };
    expect(created.listing?.listing_kind).toBe('skin');
    expect(created.listing?.identity_key).toBe(`skin:${FIXTURE_SKIN.id}`);
    expect(created.listing?.category).toBe('skin');

    const sellerBefore = store.seed.profiles.find((p) => p.id === A)!.credits;
    await store.acceptListing(B, nonce(), created.listing!.id!);
    expect(store.seed.items.find((i) => i.id === itemId)!.owner_user_id).toBe(B);
    expect(store.seed.profiles.find((p) => p.id === A)!.credits).toBe(sellerBefore + 4750);

    // The browse fold reads it as the skin family.
    const row = browseRowFor(
      {
        id: created.listing!.id!, seller_user_id: A, seller_type: 'player',
        listing_kind: 'skin', quantity: 1, price_credits: 5000,
        listed_at: '2026-10-29T12:00:00.000Z', identity_key: `skin:${FIXTURE_SKIN.id}`,
        display_name: 'Bulwark', quality_percent: 92,
      } as never,
      { kind: 'cosmetic', payload: buildCosmeticSkinPayload(FIXTURE_SKIN.id, 92, 'crafted', A) as never },
    );
    expect(row.kind).toBe('skin');
    expect(row.category).toBe('skin');
    expect(row.skinId).toBe(FIXTURE_SKIN.id);
    expect(row.identityKey).toBe(`skin:${FIXTURE_SKIN.id}`);
  });

  it('D5 — cancelling a skin listing returns the item to the seller', async () => {
    const itemId = '77777777-7777-4777-8777-777777777778';
    const seed = writesSeed();
    seed.items.push({
      id: itemId, owner_user_id: A, kind: 'cosmetic', static_item_id: null,
      item_level: 1, rarity: 'Common', quality: null, material_tier: null,
      condition_state: null, condition_current: null, condition_max: null,
      supply_mode: 'verified_action', source_id: null, creator_user_id: null,
      tradeable: true, account_bound: false, locked_until: null,
      payload: buildCosmeticSkinPayload(FIXTURE_SKIN.id, 92, 'crafted', A),
      runtime_state: 'available', is_locked: false, equipped_slot: null,
      estimated_value: 100, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    } as never);
    const store = new InMemoryWriteStore(seed, { now: () => new Date('2026-10-29T12:00:00.000Z') });
    const created = await store.marketCreate(A, nonce(), itemId, 5000) as { listing?: { id?: string } };
    expect(store.seed.items.find((i) => i.id === itemId)!.runtime_state).toBe('listed');
    await store.marketCancel(A, nonce(), created.listing!.id!);
    const item = store.seed.items.find((i) => i.id === itemId)!;
    expect(item.owner_user_id).toBe(A);
    expect(item.runtime_state).toBe('available');
  });

  it('D5 — tint refuses a whole-skin item (it is not a part)', async () => {
    const itemId = '77777777-7777-4777-8777-777777777779';
    const seed = writesSeed();
    seed.items.push({
      id: itemId, owner_user_id: A, kind: 'cosmetic', static_item_id: null,
      item_level: 1, rarity: 'Common', quality: null, material_tier: null,
      condition_state: null, condition_current: null, condition_max: null,
      supply_mode: 'verified_action', source_id: null, creator_user_id: null,
      tradeable: true, account_bound: false, locked_until: null,
      payload: buildCosmeticSkinPayload(FIXTURE_SKIN.id, 92, 'crafted', A),
      runtime_state: 'available', is_locked: false, equipped_slot: null,
      estimated_value: 100, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    } as never);
    const store = new InMemoryWriteStore(seed, { now: () => new Date('2026-10-29T12:00:00.000Z') });
    await expect(store.enqueueTintJob(A, nonce(), { itemId, paletteId: 'arctic' }))
      .rejects.toThrow('Item is not a cosmetic part');
  });
});

// ─── D5/D4 — wearing through the seam; zero power ───────────────

withFixtureSkin(() => {
  it('D5 — the buyer can wear it: the seam gates on the server record mirror', () => {
    const wardrobe = useHunterWardrobeStore.getState();
    // Not owned: wear is refused and the sprite stays the base painting.
    wardrobe.wearSkin('vesper', FIXTURE_SKIN.id);
    expect(useHunterWardrobeStore.getState().wornByHunter.vesper).not.toBe(FIXTURE_SKIN.id);
    // Owned (the cosmetics view's mirror): wear lands.
    setOwnedSkinIds([FIXTURE_SKIN.id]);
    expect(isSkinOwned(FIXTURE_SKIN)).toBe(true);
    wardrobe.wearSkin('vesper', FIXTURE_SKIN.id);
    expect(useHunterWardrobeStore.getState().wornByHunter.vesper).toBe(FIXTURE_SKIN.id);
    // Sold away (mirror empties): the worn selection falls back.
    setOwnedSkinIds([]);
    expect(isSkinOwned(FIXTURE_SKIN)).toBe(false);
    expect(
      wornSkinSpriteId(useHunterWardrobeStore.getState().wornByHunter, 'vesper'),
    ).toBe(skinById('vesper-standard-issue')!.spriteId);
  });
});

describe('D4 — skins carry zero power (hard law)', () => {
  const player = (spends: Record<string, number>): PlayerProfile => ({
    id: A, name: 'Test Hunter', level: 10, xp: 0, credits: 0, scrap: 0,
    cacheKeys: 0, legendaryCores: 0,
    currentZoneId: 'dustwaste', highestZoneId: 'dustwaste',
    offlineCapHours: 0, lastClaimTime: 0, deathFeeInsurance: false,
    consumables: {}, materials: {}, essences: {}, workshopQueues: [], lastWorkshopTick: 0,
    cacheRankTokens: 0, cacheRankSpends: spends,
  } as unknown as PlayerProfile);
  const weapon = generateWeapon(
    { source: DropSource.WorldDrop, level: 10, forcedRarity: Rarity.Rare },
    createTickRng('slice-d-test', 'snapshot', 3),
  );

  it('the mechanics snapshot is identical whatever skin is worn or owned', () => {
    const input = { player: player({}), weapons: [weapon], spentSkills: {} };
    const baseline = buildCharacterMechanicsSnapshot(input);

    // Wear every base skin in turn (all owned by definition).
    for (const skin of HUNTER_SKINS) {
      useHunterWardrobeStore.getState().wearSkin(skin.hunterId, skin.id);
      expect(wornSkinSpriteId(useHunterWardrobeStore.getState().wornByHunter, skin.hunterId))
        .toBe(skin.spriteId);
      const snap = buildCharacterMechanicsSnapshot(input);
      expect(snap.maxHp.value).toBe(baseline.maxHp.value);
      expect(snap.simulatedBossDps.value).toBe(baseline.simulatedBossDps.value);
      expect(snap.shieldBreak.value).toBe(baseline.shieldBreak.value);
      expect(snap).toEqual(baseline);
    }
  });

  it('skin defs and payloads carry no stat-shaped fields', () => {
    for (const skin of HUNTER_SKINS) {
      expect(Object.keys(skin).sort()).toEqual(['base', 'hunterId', 'id', 'name', 'spriteId']);
    }
    const payload = buildCosmeticSkinPayload(FIXTURE_SKIN.id, 90, 'crafted', A);
    expect(payload).toBeNull(); // production catalog: fixture absent → refused
    const fixturePayloadKeys = ['craftedBy', 'hunterId', 'name', 'origin', 'quality', 'setId', 'skinId'];
    expect(fixturePayloadKeys).not.toContain('damage');
    expect(fixturePayloadKeys).not.toContain('hp');
  });
});

// ─── Class-mod binding language ─────────────────────────────────

describe('class mods speak hunter-binding', () => {
  it('the label names the owning hunter + tree', () => {
    expect(classModBindingLabel({ treeBonus: 'Gunslinger' })).toBe('Vesper Cole · Gunslinger');
    expect(classModBindingLabel({ treeBonus: 'Demolition' })).toBe('Silas Boone · Demolition');
    expect(classModBindingLabel({ treeBonus: 'Scavenger' })).toBe('Josie Lode · Scavenger');
    expect(classModBindingLabel({ treeBonus: 'Fixer' })).toBe('Doc Sutter · Fixer');
    expect(classModBindingLabel({ treeBonus: null })).toBeNull();
    expect(classModBindingLabel(null)).toBeNull();
    expect(classModBindingLabel({ treeBonus: 'NotATree' })).toBeNull();
  });
});
