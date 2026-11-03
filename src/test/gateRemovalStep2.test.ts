/**
 * Gate-removal step 2 (migration 0057) — consumable recipe levels:
 *
 *   - 0057's restated SQL catalog deep-equals the TS catalog
 *     (87 recipes): every kind='consumable' entry (43) now carries
 *     requiresLevel 1 in both mirrors — the 36 formerly gated tiers
 *     (Shield Cell L3 up to Adrenaline Shot L20) are deleted, and
 *     after steps 1–2 no recipe in the catalog gates on level.
 *   - The gates that remain are the honest set, pinned on the
 *     formerly level-gated recipes themselves: owned bench,
 *     Research completions, Manufacturer Standing ranks, mastery —
 *     and material costs, byte-identical to before.
 *   - Behavior against the InMemory writes twin: a level-1 player
 *     who satisfies bench / research / standing enqueues the
 *     formerly gated consumables; without those gates the refusal
 *     names the real gate — never the level.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_CRAFT_RECIPES, getCraftRecipe } from '@/content/crafting';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type Json, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';

const MIGRATION_0057 = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0057_consumable_recipe_levels.sql'),
  'utf8',
);

const A = '11111111-1111-4111-8111-111111111111';
let nonceCounter = 0;
const nonce = () => `step2-nonce-${++nonceCounter}`;
const now = () => new Date('2026-11-03T12:00:00.000Z');

// ─── 0057 textual pins (gate-removal step 2) ────────────────────

describe('migration 0057 — consumable recipe levels removed', () => {
  const sqlCatalog = JSON.parse(
    MIGRATION_0057.split('$catalog$')[1],
  ) as Array<Record<string, unknown>>;

  it('the restated SQL catalog deep-equals the TS catalog (87 recipes)', () => {
    const parts = MIGRATION_0057.split('$catalog$');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(sqlCatalog).toHaveLength(87);
    expect(sqlCatalog).toEqual(JSON.parse(JSON.stringify(ALL_CRAFT_RECIPES)));
  });

  it('every consumable sits at the no-gate level 1 in both catalogs — and so does every recipe', () => {
    const tsConsumables = ALL_CRAFT_RECIPES.filter((r) => r.kind === 'consumable');
    expect(tsConsumables).toHaveLength(43);
    for (const recipe of tsConsumables) {
      expect(recipe.requiresLevel, recipe.id).toBe(1);
    }
    for (const row of sqlCatalog.filter((r) => r.kind === 'consumable')) {
      expect(row.requiresLevel, String(row.id)).toBe(1);
    }
    // Steps 1–2 together: no recipe of any kind gates on level.
    for (const recipe of ALL_CRAFT_RECIPES) {
      expect(recipe.requiresLevel, recipe.id).toBe(1);
    }
  });

  it('the surviving gates stand on the formerly level-gated recipes', () => {
    // Bench: the Calibration Core (was L15) still needs the Forge.
    const core = getCraftRecipe('recipe_calibration_core')!;
    expect(core.requiresBench).toBe(2);
    // Research: the Shield Cell batch (was L3) still needs the course.
    const batch = getCraftRecipe('recipe_shield_cell_batch')!;
    expect(batch.requiresResearch).toBe('production_systems');
    // Standing: all six tonics (were L12) still need rank 2 on their
    // own manufacturer's ladder.
    for (const id of [
      'recipe_redline_standing', 'recipe_ironwood_standing', 'recipe_blastforge_standing',
      'recipe_prismatek_standing', 'recipe_throwtech_standing', 'recipe_helixworks_standing',
    ]) {
      const tonic = getCraftRecipe(id)!;
      expect(tonic.requiresStanding?.rank, id).toBe(2);
      expect(tonic.requiresStanding?.manufacturer, id).toBeTruthy();
    }
    // Mastery: the Master Patch Kit's mastery gate is untouched.
    const master = getCraftRecipe('recipe_master_patch_kit')!;
    expect(master.requiresMastery).toEqual({ track: 'crafting_consumables', level: 15 });
  });

  it('material costs are byte-identical on the formerly gated recipes', () => {
    expect(getCraftRecipe('recipe_adrenaline')!.inputs)
      .toEqual({ ScrapAlloy: 40, ReactiveComponents: 25, VoidDust: 3 });
    expect(getCraftRecipe('recipe_fuel_cell')!.inputs)
      .toEqual({ ScrapAlloy: 6, NitrocellGel: 1 });
    expect(getCraftRecipe('recipe_field_patch_kit')!.inputs)
      .toEqual({ ScrapAlloy: 6, ReactiveComponents: 3, TechFragments: 1, HeartwoodResin: 1 });
    expect(getCraftRecipe('recipe_calibration_core')!.inputs)
      .toEqual({ ReactiveComponents: 20, TechFragments: 15, PrismShards: 2, VoidDust: 2 });
    expect(getCraftRecipe('recipe_redline_standing')!.inputs)
      .toEqual({ BallisticParts: 12, NitrocellGel: 2, ReactiveComponents: 6 });
  });
});

// ─── Behavior: writes twin at level 1 ───────────────────────────

function levelOneSeed(benches: number): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [{
    username: 'crafter', display_name: null, player_level: 1, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {
      ScrapAlloy: 500, ReactiveComponents: 500, BallisticParts: 200,
      TechFragments: 200, NitrocellGel: 50, PrismShards: 50, VoidDust: 100,
      HeartwoodResin: 50,
    },
    essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'crafter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: benches, workshop_tools: {},
    id: A,
  } as ProfileRowData];
  return s;
}

describe('consumable crafting after gate-removal step 2 (0057)', () => {
  it('a level-1 player with Standing rank 2 enqueues a standing tonic (was L12)', async () => {
    const store = new InMemoryWriteStore(levelOneSeed(3), { now });
    store.grantStandingRank(A, 'Redline', 2);
    const job = await store.enqueueCraftJob(A, nonce(), {
      bench: 1, recipeId: 'recipe_redline_standing', units: 1, consumableEfficiencyBonus: 0,
    }) as Json;
    expect((job.job as Json).recipe_id ?? (job.job as Json).recipeId).toBe('recipe_redline_standing');
  });

  it('a level-1 player enqueues the Field Patch Kit (was L12), the Calibration Core (was L15, bench 2), and the Adrenaline Shot (was L20)', async () => {
    const store = new InMemoryWriteStore(levelOneSeed(3), { now });
    for (const [recipeId, bench] of [
      ['recipe_field_patch_kit', 1],
      ['recipe_calibration_core', 2],
      ['recipe_adrenaline', 1],
    ] as const) {
      const job = await store.enqueueCraftJob(A, nonce(), {
        bench, recipeId, units: 1, consumableEfficiencyBonus: 0,
      }) as Json;
      expect((job.job as Json).recipe_id ?? (job.job as Json).recipeId).toBe(recipeId);
    }
  });

  it('a level-1 player with Production Systems complete enqueues the Shield Cell batch (was L3)', async () => {
    const store = new InMemoryWriteStore(levelOneSeed(3), { now });
    store.completeResearchCourse(A, 'production_systems');
    const job = await store.enqueueCraftJob(A, nonce(), {
      bench: 1, recipeId: 'recipe_shield_cell_batch', units: 1, consumableEfficiencyBonus: 0,
    }) as Json;
    expect((job.job as Json).recipe_id ?? (job.job as Json).recipeId).toBe('recipe_shield_cell_batch');
  });

  it('without Standing, the tonic refusal is standing_required — the level never speaks', async () => {
    const store = new InMemoryWriteStore(levelOneSeed(3), { now });
    await expect(store.enqueueCraftJob(A, nonce(), {
      bench: 1, recipeId: 'recipe_redline_standing', units: 1, consumableEfficiencyBonus: 0,
    })).rejects.toThrow('standing_required');
  });

  it('without the Research course, the batch refusal is research_required', async () => {
    const store = new InMemoryWriteStore(levelOneSeed(3), { now });
    await expect(store.enqueueCraftJob(A, nonce(), {
      bench: 1, recipeId: 'recipe_shield_cell_batch', units: 1, consumableEfficiencyBonus: 0,
    })).rejects.toThrow('research_required');
  });

  it('the bench gate still binds the Calibration Core at level 1', async () => {
    const store = new InMemoryWriteStore(levelOneSeed(1), { now });
    await expect(store.enqueueCraftJob(A, nonce(), {
      bench: 1, recipeId: 'recipe_calibration_core', units: 1, consumableEfficiencyBonus: 0,
    })).rejects.toThrow(/requires bench 2 or higher/);
    await expect(store.enqueueCraftJob(A, nonce(), {
      bench: 2, recipeId: 'recipe_calibration_core', units: 1, consumableEfficiencyBonus: 0,
    })).rejects.toThrow(/Bench not unlocked/);
  });
});
