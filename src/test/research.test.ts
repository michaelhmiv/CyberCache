/**
 * Research occupation (migration 0038) — the parallel education
 * track (DECISIONS R1: a deliberate, recorded exception to the ONE
 * ACTION AT A TIME law, for education only).
 *
 * Laws under test:
 *  - THE CATALOG: 4 faculties × 3 tiers = 12 courses; 888 course
 *    hours (37 days sequential) and 310,000 credits total, 77,500
 *    per faculty. T1 6h/2,500cr/L5, T2 2d/15,000cr, T3 7d/60,000cr
 *    (Q4: flat capstones). The SQL catalog twin parses to the same
 *    numbers as the content module.
 *  - PARALLEL TRACK: enrollment lives in its own record beside the
 *    personal action slot — enrolling, settling, and cancelling
 *    never read or write action state, and other systems' activity
 *    never moves an enrollment's terms.
 *  - NO PLAYER XP (Q2): completion grants mastery XP to the
 *    research.scholarship track at 10 XP per catalog hour, once.
 *    The unlocks are permanent passive terms, not XP.
 *  - WALL CLOCK + LAZY SETTLE: progress is enrolled_at/completes_at
 *    only; completion settles exactly once at the head of research
 *    reads and bonus derivations — no cron, no client assertion.
 *  - CANCEL (Q3): progress lost, fee kept (destroyed at enroll).
 *  - SERVER TRUTH: bonuses derive ONLY from completion records;
 *    forged/unknown course ids derive zero.
 *  - LEVERS: researchDurationScalar [0.5, 2] / researchCostScalar
 *    [0.5, 3] snapshot into the enrollment at enroll time; moving a
 *    lever never moves a running course.
 *  - METERS: research_enrollments_started / _courses_completed /
 *    _credits_destroyed fold from the ledger; the destroyed fees
 *    join credits_destroyed_total.
 *
 * The SQL twin is exercised against real Postgres in the slice
 * harness (0038: full chain 0001→0038, enroll/settle/cancel, gates,
 * vendor 0.42-vs-0.40 control, batch ×3 output, market fee 475,
 * lever snapshot, meter fold — 48 checks); its shapes are pinned
 * textually below.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RESEARCH_CATALOG_TOTALS,
  RESEARCH_COURSES,
  RESEARCH_EFFECT_KEYS,
  RESEARCH_FACULTIES,
  RESEARCH_LEVER_CLAMPS,
  RESEARCH_LEVER_DEFAULTS,
  RESEARCH_MASTERY_TRACK,
  RESEARCH_MASTERY_XP_PER_HOUR,
  computeResearchBonuses,
  mergeResearchBonuses,
  researchCourse,
  researchEnrollmentTerms,
  researchMasteryXpFor,
  researchStateView,
  resolveResearchLevers,
  zeroResearchBonuses,
  type ResearchFacts,
} from '@/content/research';
import { ALL_CRAFT_RECIPES, BATCH_RECIPES } from '@/content/crafting';
import { RESEARCH_EFFECT_CONSUMERS } from '@/lib/skills/skillConsumers';
import {
  ECONOMY_CONFIG_DEFAULTS,
  ECONOMY_CONFIG_KEYS,
} from '../server/economy/config';
import { InMemoryEconomyStore } from '../server/economy/memory';
import {
  mountChefHealthRoute,
  mountGameplayRoutes,
  mountResearchRoutes,
} from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
type Json = Record<string, unknown>;

const T0 = new Date('2026-11-01T12:00:00.000Z').getTime();
const HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// 1. The catalog
// ---------------------------------------------------------------------------

describe('research catalog — faculties, tiers, sizing', () => {
  it('12 courses across 4 faculties, 3 tiers each', () => {
    expect(RESEARCH_COURSES).toHaveLength(12);
    expect(RESEARCH_FACULTIES).toHaveLength(4);
    for (const faculty of RESEARCH_FACULTIES) {
      const courses = RESEARCH_COURSES.filter((c) => c.faculty === faculty.id);
      expect(courses.map((c) => c.tier)).toEqual([1, 2, 3]);
    }
  });

  it('totals: 888 hours (37 days), 310,000 cr, 77,500 per faculty', () => {
    expect(RESEARCH_CATALOG_TOTALS.courses).toBe(12);
    expect(RESEARCH_CATALOG_TOTALS.totalDurationHours).toBe(888);
    expect(RESEARCH_CATALOG_TOTALS.totalCostCredits).toBe(310_000);
    for (const faculty of RESEARCH_FACULTIES) {
      const courses = RESEARCH_COURSES.filter((c) => c.faculty === faculty.id);
      expect(courses.reduce((s, c) => s + c.costCredits, 0)).toBe(77_500);
      expect(courses.reduce((s, c) => s + c.durationHours, 0)).toBe(222);
    }
  });

  it('tier shapes: T1 6h/2,500/L5 · T2 48h/15,000 · T3 168h/60,000 flat (Q4)', () => {
    for (const course of RESEARCH_COURSES) {
      if (course.tier === 1) {
        expect(course.durationHours).toBe(6);
        expect(course.costCredits).toBe(2_500);
        expect(course.requiresLevel).toBe(5);
        expect(course.prerequisite).toBeUndefined();
      } else if (course.tier === 2) {
        expect(course.durationHours).toBe(48);
        expect(course.costCredits).toBe(15_000);
      } else {
        expect(course.durationHours).toBe(168);
        expect(course.costCredits).toBe(60_000);
      }
      if (course.tier > 1) {
        const prior = RESEARCH_COURSES.find(
          (c) => c.faculty === course.faculty && c.tier === course.tier - 1,
        );
        expect(course.prerequisite).toBe(prior?.id);
      }
    }
    // Non-Fabrication ladders gate T2 at L20 and T3 at L40.
    for (const id of ['powertrain_systems', 'supply_chains', 'shield_dynamics']) {
      expect(researchCourse(id)?.requiresLevel).toBe(20);
    }
    for (const id of ['master_mechanic', 'syndicate_ledger', 'void_theory']) {
      expect(researchCourse(id)?.requiresLevel).toBe(40);
    }
    // Fabrication gates on benches instead (the workshop IS the school).
    expect(researchCourse('production_systems')?.requiresBench).toBe(2);
    expect(researchCourse('master_fabricator')?.requiresBench).toBe(3);
  });

  it('mastery XP: 10 per catalog hour (T1 60, T2 480, T3 1,680)', () => {
    expect(RESEARCH_MASTERY_TRACK).toBe('research.scholarship');
    expect(RESEARCH_MASTERY_XP_PER_HOUR).toBe(10);
    for (const course of RESEARCH_COURSES) {
      expect(researchMasteryXpFor(course)).toBe(course.durationHours * 10);
    }
    expect(researchMasteryXpFor(RESEARCH_COURSES[0])).toBe(60);
  });

  it('every course unlock is keyed in the effect registry vocabulary', () => {
    const keys = new Set<string>(RESEARCH_EFFECT_KEYS);
    for (const course of RESEARCH_COURSES) {
      for (const key of Object.keys(course.effects)) {
        expect(keys.has(key), `${course.id} effect ${key}`).toBe(true);
      }
    }
    // Spot-pin the load-bearing magnitudes.
    expect(researchCourse('shop_fundamentals')?.effects).toEqual({ craftQualityShift: 2 });
    expect(researchCourse('master_fabricator')?.effects).toEqual({
      gearTemperBonus: 0.03,
      gearDrawBonus: 1,
    });
    expect(researchCourse('void_theory')?.effects).toEqual({ bossDedicatedChanceBonus: 0.01 });
    expect(researchCourse('syndicate_ledger')?.effects).toEqual({ marketFeeReduction: 0.05 });
  });
});

// ---------------------------------------------------------------------------
// 2. Bonus derivation — pure, completion-keyed, adversarial
// ---------------------------------------------------------------------------

describe('research bonus derivation', () => {
  it('no completions → the all-zero record', () => {
    expect(computeResearchBonuses([])).toEqual(zeroResearchBonuses());
  });

  it('each course contributes exactly its catalog effects', () => {
    for (const course of RESEARCH_COURSES) {
      const bonuses = computeResearchBonuses([course.id]);
      for (const key of RESEARCH_EFFECT_KEYS) {
        const expected = (course.effects as Record<string, number>)[key] ?? 0;
        expect(bonuses[key], `${course.id}.${key}`).toBeCloseTo(expected, 10);
      }
    }
  });

  it('the full catalog derives the full 12-key record', () => {
    const bonuses = computeResearchBonuses(RESEARCH_COURSES.map((c) => c.id));
    expect(bonuses.craftQualityShift).toBe(2);
    expect(bonuses.gearTemperBonus).toBeCloseTo(0.03, 10);
    expect(bonuses.gearDrawBonus).toBe(1);
    expect(bonuses.repairWorkRateBonus).toBeCloseTo(0.05, 10);
    expect(bonuses.vehicleDecayReduction).toBeCloseTo(0.1, 10);
    expect(bonuses.repairServiceXpBonus).toBe(1);
    expect(bonuses.vendorBuybackBonus).toBeCloseTo(0.02, 10);
    expect(bonuses.offlineCapBonus).toBe(1);
    expect(bonuses.marketFeeReduction).toBeCloseTo(0.05, 10);
    expect(bonuses.weaponDamage).toBeCloseTo(0.01, 10);
    expect(bonuses.shieldCapacity).toBeCloseTo(0.02, 10);
    expect(bonuses.bossDedicatedChanceBonus).toBeCloseTo(0.01, 10);
  });

  it('forged and unknown course ids derive ZERO (server truth only)', () => {
    const forged = computeResearchBonuses([
      'master_fabricator_cert', // near-miss: the real id drops the suffix
      'void_theory ', // trailing space
      'admin_grant_all',
      '',
    ]);
    expect(forged).toEqual(zeroResearchBonuses());
  });

  it('merge: additive terms add; vehicle decay composes multiplicatively', () => {
    const merged = mergeResearchBonuses(
      { weaponDamage: 0.05, vehicleDecayReduction: 0.25 },
      computeResearchBonuses(['ballistics_theory', 'powertrain_systems']),
    );
    expect(merged.weaponDamage).toBeCloseTo(0.06, 10);
    // 1 − (1 − 0.25)(1 − 0.10) = 0.325 — never a naive 0.35 sum.
    expect(merged.vehicleDecayReduction).toBeCloseTo(0.325, 10);
  });

  it('merge: a zero research record leaves the skill record bit-identical', () => {
    const skills = { weaponDamage: 0.05, shieldCapacity: 0.1, someOtherTerm: 3 };
    expect(mergeResearchBonuses(skills, zeroResearchBonuses())).toEqual(skills);
  });
});

// ---------------------------------------------------------------------------
// 3. Levers + enrollment terms
// ---------------------------------------------------------------------------

describe('research levers', () => {
  it('defaults are 1.0 / 1.0 and pinned in the economy registry', () => {
    expect(RESEARCH_LEVER_DEFAULTS).toEqual({ researchDurationScalar: 1, researchCostScalar: 1 });
    expect(ECONOMY_CONFIG_DEFAULTS.researchDurationScalar).toBe(1);
    expect(ECONOMY_CONFIG_DEFAULTS.researchCostScalar).toBe(1);
    expect('researchDurationScalar' in ECONOMY_CONFIG_KEYS).toBe(true);
    expect('researchCostScalar' in ECONOMY_CONFIG_KEYS).toBe(true);
  });

  it('clamps: duration [0.5, 2], cost [0.5, 3]', () => {
    expect(RESEARCH_LEVER_CLAMPS.researchDurationScalar).toEqual({ min: 0.5, max: 2 });
    expect(RESEARCH_LEVER_CLAMPS.researchCostScalar).toEqual({ min: 0.5, max: 3 });
    expect(resolveResearchLevers({ researchDurationScalar: 99 }).researchDurationScalar).toBe(2);
    expect(resolveResearchLevers({ researchDurationScalar: 0.01 }).researchDurationScalar).toBe(0.5);
    expect(resolveResearchLevers({ researchCostScalar: 99 }).researchCostScalar).toBe(3);
    expect(resolveResearchLevers({ researchCostScalar: 0 }).researchCostScalar).toBe(0.5);
    expect(resolveResearchLevers({ researchDurationScalar: Number.NaN }).researchDurationScalar).toBe(1);
  });

  it('terms: cost floors, duration rounds, scalars apply at enroll', () => {
    const t1 = researchCourse('shop_fundamentals')!;
    expect(researchEnrollmentTerms(t1, resolveResearchLevers({}))).toEqual({
      costCredits: 2_500,
      durationMs: 6 * HOUR,
    });
    const doubled = researchEnrollmentTerms(t1, resolveResearchLevers({ researchDurationScalar: 2, researchCostScalar: 2 }));
    expect(doubled).toEqual({ costCredits: 5_000, durationMs: 12 * HOUR });
    const t3 = researchCourse('void_theory')!;
    expect(researchEnrollmentTerms(t3, resolveResearchLevers({ researchCostScalar: 0.5 })).costCredits).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// 4. Migration 0038 — textual pins + catalog parity with the SQL twin
// ---------------------------------------------------------------------------

describe('migration 0038 textual pins', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0038_research.sql'), 'utf8');

  it('the embedded SQL catalog parses to the TS catalog (ids, hours, costs, effects)', () => {
    const start = sql.indexOf('select $catalog$[');
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf(']$catalog$', start);
    const parsed = JSON.parse(sql.slice(start + 'select $catalog$'.length, end + 1)) as Array<Json>;
    expect(parsed).toHaveLength(12);
    for (const course of RESEARCH_COURSES) {
      const twin = parsed.find((c) => c.id === course.id);
      expect(twin, course.id).toBeDefined();
      expect(twin!.durationHours).toBe(course.durationHours);
      expect(twin!.costCredits).toBe(course.costCredits);
      expect(twin!.effects).toEqual(course.effects);
    }
  });

  it('carries the research RPC surface and NO invented ledger helper', () => {
    for (const fn of [
      'cc_research_course', 'cc_research_catalog', 'cc_research_bonus_number',
      'cc_research_offline_cap_bonus', 'cc_settle_research', 'cc_enroll_research',
      'cc_cancel_research',
    ]) {
      expect(sql, fn).toContain(`function public.${fn}`);
    }
    expect(sql).not.toContain('cc_ledger_write');
    expect(sql).toContain("values (actor, 'cc_enroll_research', v_key, result)");
    expect(sql).toContain("'cc_research_complete'");
  });

  it('seeds the scholarship mastery track and the three meter columns', () => {
    expect(sql).toContain("'research.scholarship'");
    expect(sql).toContain('research_enrollments_started');
    expect(sql).toContain('research_courses_completed');
    expect(sql).toContain('research_credits_destroyed');
  });

  it('exactly ONE cc_complete_craft_unit restatement (the edited one)', () => {
    const matches = sql.match(/create or replace function public\.cc_complete_craft_unit/gi) ?? [];
    expect(matches).toHaveLength(1);
    expect(sql).toContain('v_research_shift');
    expect(sql).toContain("cc_research_bonus_number(p.id, 'craftQualityShift')");
  });

  it('batch recipes ride the craft catalog with outputQuantity + the research gate', () => {
    for (const id of ['recipe_shield_cell_batch', 'recipe_patch_kit_batch', 'recipe_ordnance_batch']) {
      expect(sql).toContain(`"id": "${id}"`);
    }
    expect(sql).toContain('"outputQuantity": 3');
    expect(sql).toContain('"requiresResearch": "production_systems"');
    expect(sql).toContain('research_required');
  });
});

// ---------------------------------------------------------------------------
// 5. Batch recipes — content side
// ---------------------------------------------------------------------------

describe('batch recipes (Production Systems unlock)', () => {
  it('three batch recipes: ×3 output, 2.5× inputs (ceil), 2.2× duration', () => {
    expect(BATCH_RECIPES).toHaveLength(3);
    for (const batch of BATCH_RECIPES) {
      expect(batch.outputQuantity).toBe(3);
      expect(batch.requiresResearch).toBe('production_systems');
      const base = ALL_CRAFT_RECIPES.find((r) => r.id === batch.id.replace('_batch', ''));
      if (base) {
        expect(batch.unitDurationMs).toBe(Math.round(base.unitDurationMs * 2.2));
        for (const [material, qty] of Object.entries(batch.inputs)) {
          expect(qty).toBe(Math.ceil((base.inputs[material] ?? 0) * 2.5));
        }
      }
    }
    // Shield Cell has no TS base recipe (vendor-only single; its base
    // lives only in the SQL catalog — a pre-existing divergence), so
    // pin its batch against the SQL base numbers (20/12, 900,000 ms).
    const shield = BATCH_RECIPES.find((r) => r.id === 'recipe_shield_cell_batch')!;
    expect(shield.inputs).toEqual({ ScrapAlloy: 50, ReactiveComponents: 30 });
    expect(shield.unitDurationMs).toBe(1_980_000);
    // The one fractional case: Patch Kit ReactiveComponents 1 × 2.5 → 3.
    const patch = BATCH_RECIPES.find((r) => r.id === 'recipe_patch_kit_batch')!;
    expect(patch.inputs).toEqual({ ScrapAlloy: 10, ReactiveComponents: 3 });
  });
});

// ---------------------------------------------------------------------------
// 6. In-memory gameplay store — enroll / settle / cancel semantics
// ---------------------------------------------------------------------------

let nowMs = T0;
function makeStore(levers?: () => Partial<{ researchDurationScalar: number; researchCostScalar: number }>) {
  nowMs = T0;
  const store = new InMemoryChefGameplayStore(
    () => new Date(nowMs),
    undefined, undefined, undefined, undefined,
    levers,
  );
  return store;
}
function seedRich(store: InMemoryChefGameplayStore, id: string, over: Json = {}) {
  store.seedProfile({
    id, player_level: 40, credits: 500_000, workshop_benches: 3, ...over,
  } as Parameters<InMemoryChefGameplayStore['seedProfile']>[0]);
}
let nonceN = 0;
const nonce = () => `research-nonce-${++nonceN}-abcdefgh`;

describe('research store — enrollment lifecycle', () => {
  it('enroll charges the snapshotted fee once; a nonce replay charges nothing', async () => {
    const store = makeStore();
    seedRich(store, A);
    const enrollNonce = nonce();
    await store.enrollResearch(A, enrollNonce, 'shop_fundamentals');
    expect(store.profiles.get(A)?.credits).toBe(500_000 - 2_500);
    const facts = await store.getResearchFacts(A);
    expect(facts?.activeEnrollment?.courseId).toBe('shop_fundamentals');
    expect(facts?.activeEnrollment?.costCredits).toBe(2_500);
    expect(facts?.activeEnrollment?.durationMs).toBe(6 * HOUR);

    const replay = await store.enrollResearch(A, enrollNonce, 'shop_fundamentals');
    expect((replay as Json).idempotent_replay).toBe(true);
    expect(store.profiles.get(A)?.credits).toBe(500_000 - 2_500);
  });

  it('the validation matrix refuses with the SQL error strings and charges zero', async () => {
    const store = makeStore();
    seedRich(store, A);
    seedRich(store, B, { player_level: 5, credits: 100, workshop_benches: 1 });
    const creditsBefore = store.profiles.get(B)?.credits;

    await expect(store.enrollResearch(B, nonce(), 'not_a_course')).rejects.toThrow('unknown_course');
    await expect(store.enrollResearch(B, nonce(), 'street_economics')).rejects.toThrow('insufficient_credits');
    await expect(store.enrollResearch(B, nonce(), 'powertrain_systems')).rejects.toThrow('level_too_low');
    await expect(store.enrollResearch(A, nonce(), 'production_systems')).rejects.toThrow('prerequisite_not_met');
    expect(store.profiles.get(B)?.credits).toBe(creditsBefore);
    expect(store.researchEnrollments.has(B)).toBe(false);

    // Busy track: a second enrollment while one runs is refused.
    await store.enrollResearch(A, nonce(), 'shop_fundamentals');
    await expect(store.enrollResearch(A, nonce(), 'wrench_basics')).rejects.toThrow('research_already_enrolled');
    expect(store.profiles.get(A)?.credits).toBe(500_000 - 2_500);
  });

  it('bench gate fires after the prerequisite is met', async () => {
    const store = makeStore();
    seedRich(store, A, { workshop_benches: 1 });
    await store.enrollResearch(A, nonce(), 'shop_fundamentals');
    nowMs += 6 * HOUR;
    await store.getResearchFacts(A); // settles the completion
    await expect(store.enrollResearch(A, nonce(), 'production_systems')).rejects.toThrow('bench_too_low');
  });

  it('settle boundary: not complete 1s early, complete at completes_at, exactly once', async () => {
    const store = makeStore();
    seedRich(store, A);
    await store.enrollResearch(A, nonce(), 'shop_fundamentals');

    nowMs += 6 * HOUR - 1_000;
    let facts = await store.getResearchFacts(A);
    expect(facts?.activeEnrollment?.courseId).toBe('shop_fundamentals');
    expect(facts?.completed).toHaveLength(0);
    expect(await store.getResearchBonuses(A)).toEqual(zeroResearchBonuses());

    nowMs += 1_000;
    facts = await store.getResearchFacts(A);
    expect(facts?.activeEnrollment).toBeNull();
    expect(facts?.completed.map((c) => c.courseId)).toEqual(['shop_fundamentals']);
    const mastery = store.masteries.find((m) => m.user_id === A && m.mastery_id === RESEARCH_MASTERY_TRACK);
    expect(mastery?.mastery_xp).toBe(60);
    expect((await store.getResearchBonuses(A)).craftQualityShift).toBe(2);

    // Repeated settles never re-grant.
    await store.getResearchFacts(A);
    await store.getResearchBonuses(A);
    const again = store.masteries.find((m) => m.user_id === A && m.mastery_id === RESEARCH_MASTERY_TRACK);
    expect(again?.mastery_xp).toBe(60);
    expect((await store.getResearchFacts(A))?.completed).toHaveLength(1);

    // A completed course can never be re-enrolled.
    await expect(store.enrollResearch(A, nonce(), 'shop_fundamentals')).rejects.toThrow('course_already_completed');
  });

  it('cancel forfeits the fee and the progress; re-enroll starts fresh at full terms (Q3)', async () => {
    const store = makeStore();
    seedRich(store, A);
    await store.enrollResearch(A, nonce(), 'street_economics');
    nowMs += 3 * HOUR;
    const cancelled = await store.cancelResearch(A, nonce()) as Json;
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.fee_forfeited).toBe(2_500);
    expect(store.profiles.get(A)?.credits).toBe(500_000 - 2_500); // nothing refunded
    expect((await store.getResearchFacts(A))?.completed).toHaveLength(0);

    await store.enrollResearch(A, nonce(), 'street_economics');
    const facts = await store.getResearchFacts(A);
    expect(facts?.activeEnrollment?.durationMs).toBe(6 * HOUR); // full duration again
    expect(store.profiles.get(A)?.credits).toBe(500_000 - 5_000); // full price again
  });

  it('lever movement mid-course never moves the running enrollment (snapshot law)', async () => {
    let scalar = 1;
    const store = makeStore(() => ({ researchDurationScalar: scalar }));
    seedRich(store, A);
    await store.enrollResearch(A, nonce(), 'shop_fundamentals');
    scalar = 2;
    const facts = await store.getResearchFacts(A);
    expect(facts?.activeEnrollment?.durationMs).toBe(6 * HOUR);
    // After cancelling, a NEW enrollment reads the moved lever.
    await store.cancelResearch(A, nonce());
    await store.enrollResearch(A, nonce(), 'shop_fundamentals');
    expect((await store.getResearchFacts(A))?.activeEnrollment?.durationMs).toBe(12 * HOUR);
  });

  it('PARALLEL TRACK (R1): enrollment is untouched by other systems activity', async () => {
    const store = makeStore();
    seedRich(store, A);
    await store.enrollResearch(A, nonce(), 'wrench_basics');
    const before = structuredClone(store.researchEnrollments.get(A));

    // Other systems run: a login-streak day records, a cache-rank
    // read happens, time passes below completion — none of it may
    // move the enrollment record or consume the track.
    await store.recordLoginStreakDay(A).catch(() => undefined);
    nowMs += 1 * HOUR;
    await store.getResearchFacts(A);
    expect(store.researchEnrollments.get(A)).toEqual(before);
    const view = researchStateView((await store.getResearchFacts(A)) as ResearchFacts, resolveResearchLevers({}));
    expect(view.activeEnrollment?.courseId).toBe('wrench_basics');
    expect(view.courses.find((c) => c.id === 'wrench_basics')?.status).toBe('enrolled');
  });

  it('an unknown profile is refused', async () => {
    const store = makeStore();
    await expect(store.enrollResearch(A, nonce(), 'shop_fundamentals')).rejects.toThrow('Profile not found');
    expect(await store.getResearchFacts(A)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. State view
// ---------------------------------------------------------------------------

describe('research state view', () => {
  it('statuses, lock reasons, and the cancel terms ride the view', async () => {
    const store = makeStore();
    seedRich(store, B, { player_level: 5, credits: 100, workshop_benches: 1 });
    const facts = (await store.getResearchFacts(B)) as ResearchFacts;
    const view = researchStateView(facts, resolveResearchLevers({}));
    expect(view.credits).toBe(100);
    expect(view.cancelTerms).toContain('not refunded');
    const byId = new Map(view.courses.map((c) => [c.id, c]));
    // Gates met but the fee is unpayable: available, yet canEnroll is false.
    expect(byId.get('shop_fundamentals')?.status).toBe('available');
    expect(byId.get('shop_fundamentals')?.canEnroll).toBe(false);
    expect(byId.get('powertrain_systems')?.lockReasons.join(' ')).toContain('Requires level 20');
    expect(byId.get('production_systems')?.lockReasons.join(' ')).toContain('Requires Shop Fundamentals');

    seedRich(store, A);
    await store.enrollResearch(A, nonce(), 'wrench_basics');
    nowMs += 3 * HOUR;
    const activeView = researchStateView((await store.getResearchFacts(A)) as ResearchFacts, resolveResearchLevers({}));
    expect(activeView.activeEnrollment?.courseId).toBe('wrench_basics');
    expect(activeView.activeEnrollment?.progressFraction).toBeCloseTo(0.5, 5);
    const enrolled = activeView.courses.find((c) => c.id === 'wrench_basics');
    expect(enrolled?.status).toBe('enrolled');
  });
});

// ---------------------------------------------------------------------------
// 8. Routes — JWT identity only, visible refusals
// ---------------------------------------------------------------------------

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface RouteHarness { base: string; tokenA: string; tokenB: string }

async function makeRouteServer(store: InMemoryChefGameplayStore): Promise<RouteHarness> {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, store, { jwtSecret: SECRET });
  mountResearchRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    tokenA: issueAccessToken(SECRET, A, false),
    tokenB: issueAccessToken(SECRET, B, false),
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

describe('research routes', () => {
  it('requires auth and 404s without a profile', async () => {
    const store = makeStore();
    const h = await makeRouteServer(store);
    expect((await call(h, 'GET', '/api/research/me')).status).toBe(401);
    expect((await call(h, 'GET', '/api/research/me', h.tokenA)).status).toBe(404);
  });

  it('enroll → state shows the active course; cancel forfeits visibly', async () => {
    const store = makeStore();
    seedRich(store, A);
    const h = await makeRouteServer(store);

    const enrolled = await call(h, 'POST', '/api/research/enroll', h.tokenA, {
      nonce: nonce(), courseId: 'shop_fundamentals',
    });
    expect(enrolled.status).toBe(200);
    expect(enrolled.json.verified).toBe(true);

    const me = await call(h, 'GET', '/api/research/me', h.tokenA);
    expect(me.status).toBe(200);
    const research = me.json.research as Json;
    expect((research.activeEnrollment as Json).courseId).toBe('shop_fundamentals');
    expect(research.credits).toBe(500_000 - 2_500);
    expect(store.profiles.get(A)?.credits).toBe(500_000 - 2_500);

    const cancelled = await call(h, 'POST', '/api/research/cancel', h.tokenA, { nonce: nonce() });
    expect(cancelled.status).toBe(200);
    expect(((cancelled.json.research as Json).activeEnrollment)).toBeNull();
  });

  it('refusals surface as 400 with the machine-readable reason', async () => {
    const store = makeStore();
    seedRich(store, B, { player_level: 5, credits: 100, workshop_benches: 1 });
    const h = await makeRouteServer(store);
    const broke = await call(h, 'POST', '/api/research/enroll', h.tokenB, {
      nonce: nonce(), courseId: 'street_economics',
    });
    expect(broke.status).toBe(400);
    expect(broke.json.error).toBe('insufficient_credits');
    const unknown = await call(h, 'POST', '/api/research/enroll', h.tokenB, {
      nonce: nonce(), courseId: 'not_a_course',
    });
    expect(unknown.status).toBe(400);
    expect(unknown.json.error).toBe('unknown_course');
    // Cancelling with nothing enrolled is a successful no-op (the
    // RPC returns cancelled:false), not an error.
    const noEnrollment = await call(h, 'POST', '/api/research/cancel', h.tokenB, { nonce: nonce() });
    expect(noEnrollment.status).toBe(200);
    expect(((noEnrollment.json.research as Json).activeEnrollment)).toBeNull();
  });

  it('identity comes from the JWT — B cannot see or move A\'s enrollment', async () => {
    const store = makeStore();
    seedRich(store, A);
    seedRich(store, B);
    const h = await makeRouteServer(store);
    await call(h, 'POST', '/api/research/enroll', h.tokenA, { nonce: nonce(), courseId: 'wrench_basics' });
    const bView = await call(h, 'GET', '/api/research/me', h.tokenB);
    expect(((bView.json.research as Json).activeEnrollment)).toBeNull();
    const bCancel = await call(h, 'POST', '/api/research/cancel', h.tokenB, { nonce: nonce() });
    expect(bCancel.status).toBe(200); // B's own track is empty — a no-op for B only
    const aView = await call(h, 'GET', '/api/research/me', h.tokenA);
    expect(((aView.json.research as Json).activeEnrollment as Json).courseId).toBe('wrench_basics');
  });
});

// ---------------------------------------------------------------------------
// 9. Effect-consumer registry — every key consumed, every needle real
// ---------------------------------------------------------------------------

describe('research effect consumers registry', () => {
  it('covers exactly the research effect keys', () => {
    expect(Object.keys(RESEARCH_EFFECT_CONSUMERS).sort()).toEqual([...RESEARCH_EFFECT_KEYS].sort());
  });

  it('every registered needle exists in its file (no decorative bonuses)', () => {
    for (const [key, consumers] of Object.entries(RESEARCH_EFFECT_CONSUMERS)) {
      expect(consumers.length, key).toBeGreaterThan(0);
      for (const consumer of consumers) {
        const text = readFileSync(join(process.cwd(), consumer.file), 'utf8');
        expect(text, `${key} → ${consumer.file}`).toContain(consumer.needle);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Batch recipe gate — the writes twin
// ---------------------------------------------------------------------------

describe('batch recipe gate — writes store', () => {
  function writesSeed(): WriteSeed {
    const s = emptyWriteSeed();
    s.profiles = [{
      username: 'crafter', display_name: null, player_level: 25, player_xp: 0,
      credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
      materials: { ScrapAlloy: 100, ReactiveComponents: 100 }, essences: {}, consumables: {}, skill_spends: {},
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

  it('refuses the batch recipe until Production Systems is complete, then escrows batch inputs', async () => {
    const store = new InMemoryWriteStore(writesSeed(), { now: () => new Date(T0) });
    await expect(store.enqueueCraftJob(A, nonce(), {
      bench: 1, recipeId: 'recipe_patch_kit_batch', units: 1, consumableEfficiencyBonus: 0,
    })).rejects.toThrow('research_required');

    store.completeResearchCourse(A, 'production_systems');
    const job = await store.enqueueCraftJob(A, nonce(), {
      bench: 1, recipeId: 'recipe_patch_kit_batch', units: 1, consumableEfficiencyBonus: 0,
    }) as Json;
    expect((job.job as Json).recipe_id ?? (job.job as Json).recipeId).toBe('recipe_patch_kit_batch');
  });
});

// ---------------------------------------------------------------------------
// 11. Meters — the economy twin folds research ledger rows
// ---------------------------------------------------------------------------

describe('research meters — economy twin', () => {
  it('folds enroll + complete rows into the three meters and the destroyed total', async () => {
    const store = new InMemoryEconomyStore({
      ledger: [
        {
          action_type: 'cc_enroll_research',
          created_at: '2026-11-01T08:00:00.000Z',
          result_payload: { cost_credits: 2_500 },
        },
        {
          action_type: 'cc_enroll_research',
          created_at: '2026-11-01T09:00:00.000Z',
          result_payload: { cost_credits: 15_000 },
        },
        {
          action_type: 'cc_research_complete',
          created_at: '2026-11-01T20:00:00.000Z',
          result_payload: { course_id: 'shop_fundamentals', mastery_xp: 60 },
        },
        {
          // Yesterday's enrollment belongs to yesterday's meters.
          action_type: 'cc_enroll_research',
          created_at: '2026-10-31T08:00:00.000Z',
          result_payload: { cost_credits: 60_000 },
        },
      ],
      items: [],
      config: {},
    });
    const row = await store.computeMetricsForDay('2026-11-01');
    expect(row.researchEnrollmentsStarted).toBe(2);
    expect(row.researchCoursesCompleted).toBe(1);
    expect(row.researchCreditsDestroyed).toBe(17_500);
    expect(row.creditsDestroyedTotal).toBeGreaterThanOrEqual(17_500);
  });
});
