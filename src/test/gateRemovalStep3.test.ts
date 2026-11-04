/**
 * Gate-removal step 3 (migration 0059) — Research course levels:
 *
 *   - 0059 restates the Research catalog twins (cc_research_course
 *     + cc_research_catalog) and cc_enroll_research from 0038 with
 *     ONLY the level gate removed: the two catalog literals lose
 *     their "requiresLevel" keys (10 entries — T1 L5 ×4, T2 L20 ×3,
 *     T3 L40 ×3) and enroll loses its level_too_low check. Both
 *     literals deep-equal the TS catalog (minus its UI-only
 *     unlockText), and the TS catalog carries no level gate either.
 *   - The gates that remain are the honest set, pinned below: the
 *     prerequisite chain inside each faculty, the wall-clock
 *     durations (6h / 48h / 168h), the fees destroyed at enroll
 *     (2,500 / 15,000 / 60,000 cr), and Fabrication's bench gates
 *     (bench 2 / bench 3 — bench unlock levels are a later step).
 *     [Slice-9 note, 2026-11-03: the bench collapse has since
 *     retired those bench gates too — see the re-pointed pins.]
 *   - Behavior against the in-memory gameplay twin: a level-1
 *     player starts, queues, and completes the formerly gated
 *     Xenotech ladder end to end; without the prerequisite or the
 *     bench, the refusal names that real gate — never the level.
 *   - Cross-system survivors: the batch recipes still require the
 *     Production Systems completion (research gate ON recipes,
 *     unchanged), and the standing tonics still require rank 2.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RESEARCH_COURSES,
  computeResearchBonuses,
  researchCourse,
  researchStateView,
  resolveResearchLevers,
  type ResearchFacts,
} from '@/content/research';
import { getCraftRecipe } from '@/content/crafting';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';

const MIGRATION_0059 = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0059_research_course_levels.sql'),
  'utf8',
);
const MIGRATION_0063 = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0063_offline_cap_research_carrier.sql'),
  'utf8',
);
const MIGRATION_0073 = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0073_bench_collapse_relic_merger.sql'),
  'utf8',
);

const A = '11111111-1111-4111-8111-111111111111';
let nonceCounter = 0;
const nonce = () => `step3-nonce-${++nonceCounter}`;
const T0 = new Date('2026-11-03T12:00:00.000Z').getTime();
const HOUR = 3_600_000;

// ─── 0059 textual pins (gate-removal step 3) ────────────────────

/** The TS catalog in its SQL shape: the SQL twin omits unlockText. */
function tsCatalogAsSql(): Array<Record<string, unknown>> {
  return RESEARCH_COURSES.map((course) => {
    const parsed = JSON.parse(JSON.stringify(course)) as Record<string, unknown>;
    delete parsed.unlockText;
    return parsed;
  });
}

function parseCatalogs(sql: string): Array<Array<Record<string, unknown>>> {
  const literals = [...sql.matchAll(/\$catalog\$(\[[\s\S]*?\])\$catalog\$/g)];
  return literals.map((m) => JSON.parse(m[1]) as Array<Record<string, unknown>>);
}

describe('migration 0059 — research course levels removed', () => {
  const catalogs = parseCatalogs(MIGRATION_0059);

  it('restates both catalog literals and the enroll function — and nothing else with a level gate', () => {
    for (const fn of ['cc_research_course', 'cc_research_catalog', 'cc_enroll_research']) {
      expect(MIGRATION_0059, fn).toContain(`function public.${fn}`);
    }
    expect(catalogs).toHaveLength(2);
    // In the executable SQL (comment lines stripped — the header
    // narrates the removal), no level gate survives anywhere.
    const executable = MIGRATION_0059.split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executable).not.toContain('requiresLevel');
    expect(executable).not.toContain('level_too_low');
  });

  it('both restated SQL catalogs deep-equal the TS catalog (12 courses)', () => {
    // Parity binds the LIVE restatement: 0073 (economy slice 9,
    // bench collapse) restated both catalogs again with the
    // Fabrication bench gates removed, superseding 0063's literals,
    // whose pins above stand as written. (0073 also carries the
    // 88-entry craft catalog — the filter keeps the two Research
    // literals.)
    const expected = tsCatalogAsSql();
    const researchCatalogs = parseCatalogs(MIGRATION_0073).filter((c) => c.length === 12);
    expect(researchCatalogs).toHaveLength(2);
    for (const catalog of researchCatalogs) {
      expect(catalog).toEqual(expected);
    }
  });

  it('no course carries a level gate in either mirror — the former numbers are gone', () => {
    const formerlyGated: Record<string, number> = {
      shop_fundamentals: 5, wrench_basics: 5, street_economics: 5, ballistics_theory: 5,
      powertrain_systems: 20, supply_chains: 20, shield_dynamics: 20,
      master_mechanic: 40, syndicate_ledger: 40, void_theory: 40,
    };
    expect(Object.keys(formerlyGated)).toHaveLength(10);
    for (const course of RESEARCH_COURSES) {
      expect('requiresLevel' in course, course.id).toBe(false);
    }
    for (const catalog of catalogs) {
      for (const row of catalog) {
        expect('requiresLevel' in row, String(row.id)).toBe(false);
      }
    }
  });

  it('the surviving gates stand in the restated catalog, byte-pinned', () => {
    for (const catalog of catalogs) {
      const byId = new Map(catalog.map((c) => [c.id as string, c]));
      // Bench gates (Fabrication): bench 2 / bench 3 survive untouched.
      expect(byId.get('production_systems')?.requiresBench).toBe(2);
      expect(byId.get('master_fabricator')?.requiresBench).toBe(3);
      // Prerequisite chain survives on every tier 2/3 course.
      expect(byId.get('production_systems')?.prerequisite).toBe('shop_fundamentals');
      expect(byId.get('master_fabricator')?.prerequisite).toBe('production_systems');
      expect(byId.get('powertrain_systems')?.prerequisite).toBe('wrench_basics');
      expect(byId.get('master_mechanic')?.prerequisite).toBe('powertrain_systems');
      expect(byId.get('supply_chains')?.prerequisite).toBe('street_economics');
      expect(byId.get('syndicate_ledger')?.prerequisite).toBe('supply_chains');
      expect(byId.get('shield_dynamics')?.prerequisite).toBe('ballistics_theory');
      expect(byId.get('void_theory')?.prerequisite).toBe('shield_dynamics');
      // Fees + durations of the formerly gated capstones are unchanged.
      expect(byId.get('void_theory')).toMatchObject({ durationHours: 168, costCredits: 60_000 });
      expect(byId.get('shield_dynamics')).toMatchObject({ durationHours: 48, costCredits: 15_000 });
      expect(byId.get('ballistics_theory')).toMatchObject({ durationHours: 6, costCredits: 2_500 });
    }
    // And in the TS mirror: totals are the shipped totals.
    expect(RESEARCH_COURSES.reduce((s, c) => s + c.durationHours, 0)).toBe(888);
    expect(RESEARCH_COURSES.reduce((s, c) => s + c.costCredits, 0)).toBe(310_000);
  });
});

// ─── Behavior: gameplay twin at level 1 ─────────────────────────

let nowMs = T0;
function makeStore() {
  nowMs = T0;
  return new InMemoryChefGameplayStore(() => new Date(nowMs));
}
function seedLevelOne(
  store: InMemoryChefGameplayStore,
  over: Record<string, unknown> = {},
) {
  store.seedProfile({
    id: A, player_level: 1, credits: 500_000, workshop_benches: 3, ...over,
  } as Parameters<InMemoryChefGameplayStore['seedProfile']>[0]);
}

describe('research enrollment after gate-removal step 3 (0059)', () => {
  it('a level-1 player starts, queues, and completes the formerly L5/L20/L40 ladder', async () => {
    const store = makeStore();
    seedLevelOne(store);

    // T1 (was L5): enrolls at level 1.
    await store.enrollResearch(A, nonce(), 'ballistics_theory');
    nowMs += 6 * HOUR;
    let facts = await store.getResearchFacts(A); // settles the completion
    expect(facts?.completed.map((c) => c.courseId)).toEqual(['ballistics_theory']);

    // T2 (was L20): enrolls at level 1 on the strength of the chain.
    await store.enrollResearch(A, nonce(), 'shield_dynamics');
    nowMs += 48 * HOUR;
    facts = await store.getResearchFacts(A);
    expect(facts?.completed.map((c) => c.courseId)).toEqual([
      'ballistics_theory', 'shield_dynamics',
    ]);

    // T3 (was L40): enrolls and completes at level 1; the unlock lands.
    await store.enrollResearch(A, nonce(), 'void_theory');
    nowMs += 168 * HOUR;
    facts = await store.getResearchFacts(A);
    expect(facts?.completed.map((c) => c.courseId)).toEqual([
      'ballistics_theory', 'shield_dynamics', 'void_theory',
    ]);
    expect(store.profiles.get(A)?.player_level).toBe(1); // never leveled
    expect(store.profiles.get(A)?.credits).toBe(500_000 - 77_500); // the fees were the gate
    const bonuses = computeResearchBonuses(facts!.completed.map((c) => c.courseId));
    expect(bonuses.weaponDamage).toBeCloseTo(0.01, 10);
    expect(bonuses.shieldCapacity).toBeCloseTo(0.02, 10);
    expect(bonuses.bossDedicatedChanceBonus).toBeCloseTo(0.01, 10);
    expect((await store.getResearchBonuses(A)).bossDedicatedChanceBonus).toBeCloseTo(0.01, 10);
  });

  it('without the prerequisite, the refusal is prerequisite_not_met — the level never speaks', async () => {
    const store = makeStore();
    seedLevelOne(store);
    await expect(store.enrollResearch(A, nonce(), 'powertrain_systems')).rejects.toThrow('prerequisite_not_met');
    await expect(store.enrollResearch(A, nonce(), 'void_theory')).rejects.toThrow('prerequisite_not_met');
    expect(store.researchEnrollments.has(A)).toBe(false);
    expect(store.profiles.get(A)?.credits).toBe(500_000); // refused enrollments charge zero
  });

  it('the Fabrication bench gate no longer binds (slice 9): bench 1 enrolls after the prerequisite', async () => {
    const store = makeStore();
    seedLevelOne(store, { workshop_benches: 1 });
    await store.enrollResearch(A, nonce(), 'shop_fundamentals');
    nowMs += 6 * HOUR;
    await store.getResearchFacts(A); // settles Shop Fundamentals
    // Pre-collapse this threw 'bench_too_low'. One bench for
    // everyone — the prerequisite + fee are the whole gate now.
    await expect(store.enrollResearch(A, nonce(), 'production_systems')).resolves.toBeTruthy();
  });

  it('the state view at level 1: tier 1 is available; chains lock by prerequisite only', async () => {
    const store = makeStore();
    seedLevelOne(store);
    const facts = (await store.getResearchFacts(A)) as ResearchFacts;
    const view = researchStateView(facts, resolveResearchLevers({}));
    const byId = new Map(view.courses.map((c) => [c.id, c]));
    for (const id of ['shop_fundamentals', 'wrench_basics', 'street_economics', 'ballistics_theory']) {
      expect(byId.get(id)?.status, id).toBe('available');
      expect(byId.get(id)?.canEnroll, id).toBe(true);
    }
    // The former L40 capstone names exactly one unmet gate: its chain.
    expect(byId.get('master_mechanic')?.lockReasons).toEqual(['Requires Powertrain Systems']);
    expect(byId.get('production_systems')?.lockReasons).toEqual(['Requires Shop Fundamentals']);
    for (const course of view.courses) {
      expect(course.lockReasons.join(' '), course.id).not.toMatch(/level/i);
    }
  });
});

// ─── Cross-system survivors ─────────────────────────────────────

describe('surviving gates outside the Research catalog', () => {
  it('the batch recipes still carry their research-completion gate', () => {
    for (const id of ['recipe_shield_cell_batch', 'recipe_patch_kit_batch', 'recipe_ordnance_batch']) {
      expect(getCraftRecipe(id)?.requiresResearch, id).toBe('production_systems');
    }
    expect(researchCourse('production_systems')?.name).toBe('Production Systems');
  });

  it('the standing tonics still carry their Standing rank gate (step 2 survivor, unchanged)', () => {
    for (const id of [
      'recipe_redline_standing', 'recipe_ironwood_standing', 'recipe_blastforge_standing',
      'recipe_prismatek_standing', 'recipe_throwtech_standing', 'recipe_helixworks_standing',
    ]) {
      expect(getCraftRecipe(id)?.requiresStanding?.rank, id).toBe(2);
    }
  });

  it('a level-1 crafter without Production Systems is refused by research_required', async () => {
    const s = emptyWriteSeed();
    s.profiles = [{
      username: 'crafter', display_name: null, player_level: 1, player_xp: 0,
      credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
      materials: { Scrap: 100, ReactiveComponents: 100 }, essences: {}, consumables: {}, skill_spends: {},
      boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
      created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
      account_type: 'verified', email: 'crafter@example.com',
      email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
      verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
      last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
      workshop_benches: 1, workshop_tools: {},
      id: A,
    } as ProfileRowData];
    const store = new InMemoryWriteStore(s, { now: () => new Date(T0) });
    await expect(store.enqueueCraftJob(A, nonce(), {
      bench: 1, recipeId: 'recipe_patch_kit_batch', units: 1, consumableEfficiencyBonus: 0,
    })).rejects.toThrow('research_required');
  });
});
