/**
 * Contracts board (0042) — the slice test suite, mirroring the
 * brief's §2.11 skeleton:
 *
 *   1. Content: taxonomy, bands, targets, rewards (brief numbers).
 *   2. Generation: determinism, R4 seed shapes (daily global per
 *      band, weekly per player), spread rules, band filtering,
 *      reroll draws.
 *   3. The evaluator: stat baselines, window folds, depth = MAX.
 *   4. Levers: defaults/clamps pinned against the economy registry.
 *   5. The in-memory store (the SQL twin's mirror): issuance,
 *      claim exactly-once, full-set bonuses, reroll economics,
 *      expiry, guest refusal, lever freezing.
 *   6. Routes over real HTTP: JWT identity, forgery bodies ignored.
 *   7. Migration 0042 textual pins: SQL twin parity (templates,
 *      bands, bosses), the three new stats, the meter folds, and
 *      the R3 guard (the claim op never touches legendary cores).
 *
 * The SQL functions themselves are exercised end-to-end by the
 * slice's embedded-Postgres harness (full chain 0001→0042); these
 * pins keep the TS and SQL twins from drifting apart.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTRACT_BANDS,
  CONTRACT_STAT_KEYS,
  CONTRACT_TEMPLATES,
  CONTRACT_TEMPLATE_BY_ID,
  contractBandForLevel,
  contractBoardView,
  contractPeriodExpired,
  contractPeriodKey,
  contractProgressFor,
  contractRewardFor,
  contractSetBonusFor,
  contractSetSeed,
  contractTargetFor,
  drawContractReroll,
  drawContractSet,
  resolveContractLevers,
  type ContractInstanceRecord,
  type ContractLeverValues,
  type ContractSetFacts,
  type ContractWindowFacts,
  EMPTY_CONTRACT_WINDOW_FACTS,
} from '@/content/contracts';
import { REGION_1_BOSSES } from '@/constants/bosses';
import {
  ECONOMY_CONFIG_DEFAULTS,
  ECONOMY_CONFIG_KEYS,
  validateEconomyConfigValue,
} from '../server/economy/config';
import { CONTRACT_LEVER_CLAMPS, CONTRACT_LEVER_DEFAULTS } from '@/content/contracts';
import { mountChefHealthRoute, mountContractsRoutes, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { issueAccessToken } from '../server/auth/tokens';

type Json = Record<string, unknown>;

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const BOSSES = REGION_1_BOSSES.map((b) => ({ id: b.id, level: b.level }));
const LEVERS: ContractLeverValues = resolveContractLevers();

function drawDaily(dateKey: string, bandId: 'B1' | 'B2' | 'B3' | 'B4' | 'B5', playerId: string = A) {
  const band = CONTRACT_BANDS.find((b) => b.id === bandId)!;
  return drawContractSet({
    seed: contractSetSeed('daily', dateKey, bandId, playerId),
    kind: 'daily', band, count: LEVERS.contractDailyCount, bosses: BOSSES,
  });
}

function drawWeekly(weekKey: string, bandId: 'B1' | 'B2' | 'B3' | 'B4' | 'B5', playerId: string) {
  const band = CONTRACT_BANDS.find((b) => b.id === bandId)!;
  return drawContractSet({
    seed: contractSetSeed('weekly', weekKey, bandId, playerId),
    kind: 'weekly', band, count: LEVERS.contractWeeklyCount, bosses: BOSSES,
  });
}

/**
 * Drive one issued instance to completion through the twin's own
 * fact records: stat kinds via the contractStats mirror — except
 * consumables_crafted, which the twin folds from craft outputs
 * (its settler mirror), so the helper seeds those outputs instead.
 */
function driveContractComplete(
  store: InMemoryChefGameplayStore,
  playerId: string,
  inst: ContractInstanceRecord,
): void {
  const template = CONTRACT_TEMPLATE_BY_ID.get(inst.templateId)!;
  const statKey = CONTRACT_STAT_KEYS[template.kind];
  expect(statKey, `${inst.templateId} must be stat-backed for this helper`).toBeTruthy();
  if (template.kind === 'consumables_crafted') {
    store.craftJobs.push({
      id: `contracts-test-job-${inst.id}`,
      owner_user_id: playerId,
      outputs: Array.from({ length: inst.target }, (_, i) => ({
        unit: i + 1, kind: 'consumable' as const, xp: 0,
        completedAtMs: Date.now(), consumableType: 'Medkit',
      })),
    } as never);
    return;
  }
  store.contractStats.set(
    `${playerId}:${statKey}`, (inst.baseline[statKey!] ?? 0) + inst.target);
}

// ---------------------------------------------------------------------------
// 1. Content — taxonomy, bands, targets, rewards
// ---------------------------------------------------------------------------

describe('contracts content — taxonomy and bands', () => {
  it('ships exactly the 21 briefed templates with unique ids', () => {
    expect(CONTRACT_TEMPLATES).toHaveLength(21);
    expect(new Set(CONTRACT_TEMPLATES.map((t) => t.id)).size).toBe(21);
    // The two exclusions the brief rules out by law.
    expect(CONTRACT_TEMPLATES.some((t) => t.kind === 'credits_earned' as never)).toBe(false);
    expect(CONTRACT_TEMPLATES.some((t) => t.kind === 'deaths' as never)).toBe(false);
  });

  it('bands split levels B1 1–9 · B2 10–24 · B3 25–49 · B4 50–74 · B5 75+', () => {
    expect([1, 9, 10, 24, 25, 49, 50, 74, 75, 100].map((lv) => contractBandForLevel(lv).id))
      .toEqual(['B1', 'B1', 'B2', 'B2', 'B3', 'B3', 'B4', 'B4', 'B5', 'B5']);
    expect(CONTRACT_BANDS.map((b) => b.targetMultiplier)).toEqual([0.5, 1, 1.5, 2, 2.5]);
    expect(CONTRACT_BANDS.map((b) => b.dailyCredits)).toEqual([120, 220, 350, 500, 650]);
    expect(CONTRACT_BANDS.map((b) => b.weeklyCredits)).toEqual([500, 900, 1400, 2000, 2600]);
  });

  it('targets follow the brief bases scaled by band (kills 200/1,200 at B2)', () => {
    const fieldWork = CONTRACT_TEMPLATE_BY_ID.get('field_work')!;
    const b1 = CONTRACT_BANDS[0];
    const b2 = CONTRACT_BANDS[1];
    const b3 = CONTRACT_BANDS[2];
    expect(contractTargetFor(fieldWork, 'daily', b2, LEVERS)).toBe(200);
    expect(contractTargetFor(fieldWork, 'weekly', b2, LEVERS)).toBe(1200);
    expect(contractTargetFor(fieldWork, 'daily', b1, LEVERS)).toBe(100);
    expect(contractTargetFor(fieldWork, 'weekly', b3, LEVERS)).toBe(1800);
    const boss = CONTRACT_TEMPLATE_BY_ID.get('boss_contract')!;
    expect(contractTargetFor(boss, 'daily', b2, LEVERS)).toBe(1);
    expect(contractTargetFor(boss, 'weekly', b2, LEVERS)).toBe(3);
    // The target lever scales at issuance (and only there).
    const hard = resolveContractLevers({ contractTargetScalar: 2 });
    expect(contractTargetFor(fieldWork, 'daily', b2, hard)).toBe(400);
  });

  it('rewards: band credits, combat dailies +1 part, weeklies 3 parts, never cores/gear/XP', () => {
    const b2 = CONTRACT_BANDS[1];
    const fieldWork = CONTRACT_TEMPLATE_BY_ID.get('field_work')!;
    expect(contractRewardFor(fieldWork, 'daily', b2, LEVERS)).toEqual({ credits: 220, fragments: 1 });
    expect(contractRewardFor(fieldWork, 'weekly', b2, LEVERS)).toEqual({ credits: 900, fragments: 3 });
    const production = CONTRACT_TEMPLATE_BY_ID.get('production_order')!;
    expect(contractRewardFor(production, 'daily', b2, LEVERS)).toEqual({ credits: 220, fragments: 0 });
    // The brief's own G-3 example prices Breakdown at B2 with a fragment.
    const breakdown = CONTRACT_TEMPLATE_BY_ID.get('breakdown')!;
    expect(contractRewardFor(breakdown, 'daily', b2, LEVERS)).toEqual({ credits: 220, fragments: 1 });
    // The reward shape has no other fields — structurally no cores, gear, or XP.
    for (const template of CONTRACT_TEMPLATES) {
      for (const kind of ['daily', 'weekly'] as const) {
        if (!template.cadences.includes(kind)) continue;
        expect(Object.keys(contractRewardFor(template, kind, b2, LEVERS)).sort())
          .toEqual(['credits', 'fragments']);
      }
    }
  });

  it('full-set bonuses: daily +2 parts; weekly 1 key + one weekly of credits', () => {
    const b2 = CONTRACT_BANDS[1];
    expect(contractSetBonusFor('daily', b2, LEVERS)).toEqual({ credits: 0, fragments: 2, cacheKeys: 0 });
    expect(contractSetBonusFor('weekly', b2, LEVERS)).toEqual({ credits: 900, fragments: 0, cacheKeys: 1 });
    const noKeys = resolveContractLevers({ contractWeeklyKeys: 0 });
    expect(contractSetBonusFor('weekly', b2, noKeys).cacheKeys).toBe(0);
  });

  it('period keys: daily is the UTC date; weekly is the ISO Monday', () => {
    expect(contractPeriodKey('daily', new Date('2026-11-01T12:00:00.000Z'))).toBe('2026-11-01');
    // 2026-11-01 is a Sunday; its ISO week starts Monday 2026-10-26.
    expect(contractPeriodKey('weekly', new Date('2026-11-01T12:00:00.000Z'))).toBe('2026-10-26');
    expect(contractPeriodKey('weekly', new Date('2026-11-02T00:00:00.000Z'))).toBe('2026-11-02');
    expect(contractPeriodExpired('daily', '2026-11-02', new Date('2026-11-02T23:59:59.000Z'))).toBe(false);
    expect(contractPeriodExpired('daily', '2026-11-02', new Date('2026-11-03T00:00:00.000Z'))).toBe(true);
    expect(contractPeriodExpired('weekly', '2026-11-02', new Date('2026-11-09T00:00:00.000Z'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Generation — determinism, seed shapes, spread rules
// ---------------------------------------------------------------------------

describe('contracts generation — seeded draws', () => {
  it('is deterministic: the same seed draws the same set, in the same order', () => {
    expect(drawDaily('2026-11-02', 'B2')).toEqual(drawDaily('2026-11-02', 'B2'));
    expect(drawWeekly('2026-11-02', 'B3', A)).toEqual(drawWeekly('2026-11-02', 'B3', A));
  });

  it('R4: the daily board is global per band — the player never enters its seed', () => {
    expect(contractSetSeed('daily', '2026-11-02', 'B2', A))
      .toBe(contractSetSeed('daily', '2026-11-02', 'B2', B));
    expect(drawDaily('2026-11-02', 'B2', A)).toEqual(drawDaily('2026-11-02', 'B2', B));
    // …but a different band is a different board.
    expect(contractSetSeed('daily', '2026-11-02', 'B2', A))
      .not.toBe(contractSetSeed('daily', '2026-11-02', 'B3', A));
  });

  it('R4: the weekly set is per-player seeded and stable on re-draw', () => {
    expect(contractSetSeed('weekly', '2026-11-02', 'B2', A))
      .not.toBe(contractSetSeed('weekly', '2026-11-02', 'B2', B));
    const sets = [A, B, '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']
      .map((p) => JSON.stringify(drawWeekly('2026-11-02', 'B2', p).map((d) => d.template.id)));
    expect(new Set(sets).size).toBeGreaterThan(1); // per-player boards actually differ
  });

  it('spread rules hold across many boards: size, no repeats, ≤2 per family', () => {
    for (let day = 2; day < 30; day += 1) {
      const key = `2026-11-${String(day).padStart(2, '0')}`;
      for (const bandId of ['B1', 'B2', 'B3', 'B4', 'B5'] as const) {
        const daily = drawDaily(key, bandId);
        expect(daily).toHaveLength(3);
        expect(new Set(daily.map((d) => d.template.id)).size).toBe(3);
        const families = new Map<string, number>();
        for (const d of daily) families.set(d.template.family, (families.get(d.template.family) ?? 0) + 1);
        expect(Math.max(...families.values())).toBeLessThanOrEqual(2);
      }
      const weekly = drawWeekly(key, 'B3', A);
      expect(weekly).toHaveLength(5);
      expect(new Set(weekly.map((d) => d.template.id)).size).toBe(5);
    }
  });

  it('band filtering: gated templates never appear below their band', () => {
    for (let day = 2; day < 16; day += 1) {
      const key = `2026-11-${String(day).padStart(2, '0')}`;
      const b1Daily = drawDaily(key, 'B1').map((d) => d.template.id);
      const b1Weekly = drawWeekly(key, 'B1', A).map((d) => d.template.id);
      for (const gated of ['named_bounty', 'perfectionist', 'service_record', 'shopfront']) {
        expect(b1Daily).not.toContain(gated);
        expect(b1Weekly).not.toContain(gated);
      }
    }
  });

  it('reroll draws exclude the whole set and respect the family cap', () => {
    const band = CONTRACT_BANDS[1];
    const set = drawDaily('2026-11-02', 'B2');
    const draw = drawContractReroll({
      kind: 'daily', periodKey: '2026-11-02', band, playerId: A, slot: 0, generation: 1,
      bosses: BOSSES,
      excludeIds: set.map((d) => d.template.id),
      setFamilies: set.slice(1).map((d) => d.template.family),
    });
    expect(draw).not.toBeNull();
    expect(set.map((d) => d.template.id)).not.toContain(draw!.template.id);
    // Excluding everything eligible leaves nothing to draw.
    expect(drawContractReroll({
      kind: 'daily', periodKey: '2026-11-02', band, playerId: A, slot: 0, generation: 1,
      bosses: BOSSES,
      excludeIds: CONTRACT_TEMPLATES.map((t) => t.id),
      setFamilies: [],
    })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. The evaluator
// ---------------------------------------------------------------------------

describe('contracts evaluator — progress from facts only', () => {
  function instance(partial: Partial<ContractInstanceRecord>): ContractInstanceRecord {
    return {
      id: 'inst', periodKind: 'daily', periodKey: '2026-11-02', slot: 0, generation: 0,
      templateId: 'field_work', params: {}, target: 200, baseline: {}, reward: { credits: 220, fragments: 1 },
      status: 'active', issuedAt: '2026-11-02T00:00:00.000Z', claimedAt: null,
      ...partial,
    };
  }

  it('stat kinds diff the standing counter against the frozen baseline, floored at 0', () => {
    const inst = instance({ baseline: { 'combat.roaming_kills': 500 } });
    expect(contractProgressFor(inst, { 'combat.roaming_kills': 650 }, EMPTY_CONTRACT_WINDOW_FACTS)).toBe(150);
    expect(contractProgressFor(inst, { 'combat.roaming_kills': 400 }, EMPTY_CONTRACT_WINDOW_FACTS)).toBe(0);
    expect(contractProgressFor(inst, {}, EMPTY_CONTRACT_WINDOW_FACTS)).toBe(0);
  });

  it('endless depth is a MAX in the window, never a sum', () => {
    const inst = instance({ templateId: 'gauntlet', target: 5 });
    const facts: ContractWindowFacts = { ...EMPTY_CONTRACT_WINDOW_FACTS, endlessBestDepth: 4, endlessRuns: 9 };
    expect(contractProgressFor(inst, {}, facts)).toBe(4);
  });

  it('window kinds read their own fold (crafts, discoveries, specific boss)', () => {
    const facts: ContractWindowFacts = {
      ...EMPTY_CONTRACT_WINDOW_FACTS, crafts: 7, discoveries: 2,
      specificBossVictories: { dune_tyrant: 1 },
    };
    expect(contractProgressFor(instance({ templateId: 'production_order' }), {}, facts)).toBe(7);
    expect(contractProgressFor(instance({ templateId: 'archivist' }), {}, facts)).toBe(2);
    expect(contractProgressFor(
      instance({ templateId: 'named_bounty', params: { bossId: 'dune_tyrant' } }), {}, facts)).toBe(1);
    expect(contractProgressFor(
      instance({ templateId: 'named_bounty', params: { bossId: 'siltstalker' } }), {}, facts)).toBe(0);
  });

  it('the G-3 progress line is the brief\u2019s own example, verbatim', () => {
    const facts: ContractSetFacts = {
      band: 'B2',
      rerollsUsed: 0,
      setBonusClaimed: false,
      instances: [{
        ...instance({ templateId: 'breakdown', target: 6, reward: { credits: 220, fragments: 1 } }),
        progress: 4,
      }],
    };
    const view = contractBoardView(
      { canClaim: true, daily: facts, weekly: { ...facts, instances: [] } },
      LEVERS, new Date('2026-11-02T12:00:00.000Z'), () => undefined,
    );
    expect(view.daily.contracts[0].progressLine)
      .toBe('Salvages 4 / 6 — pays 220 cr + 1 fragment · claim by 00:00 UTC');
    expect(view.daily.contracts[0].title).toBe('Breakdown: salvage 6 items');
  });
});

// ---------------------------------------------------------------------------
// 4. Levers — registry pins
// ---------------------------------------------------------------------------

describe('contracts levers — registry pins', () => {
  it('config defaults and clamps equal the content owner\u2019s, for all seven levers', () => {
    for (const key of Object.keys(CONTRACT_LEVER_DEFAULTS) as Array<keyof ContractLeverValues>) {
      expect(ECONOMY_CONFIG_DEFAULTS[key]).toBe(CONTRACT_LEVER_DEFAULTS[key]);
      expect(ECONOMY_CONFIG_KEYS[key].min).toBe(CONTRACT_LEVER_CLAMPS[key].min);
      expect(ECONOMY_CONFIG_KEYS[key].max).toBe(CONTRACT_LEVER_CLAMPS[key].max);
      expect(ECONOMY_CONFIG_KEYS[key].integer).toBe(CONTRACT_LEVER_CLAMPS[key].integer ?? false);
    }
    expect(validateEconomyConfigValue('contractDailyCount', 4)).toBe(4);
    expect(validateEconomyConfigValue('contractDailyCount', 6)).toBeNull();
    expect(validateEconomyConfigValue('contractRewardScalar', 2)).toBe(2);
    expect(validateEconomyConfigValue('contractRewardScalar', 2.5)).toBeNull();
  });

  it('resolve clamps into the brief bands and drops non-numbers', () => {
    expect(resolveContractLevers()).toEqual(CONTRACT_LEVER_DEFAULTS);
    expect(resolveContractLevers({ contractTargetScalar: 0.1 }).contractTargetScalar).toBe(0.5);
    expect(resolveContractLevers({ contractWeeklyCount: 99 }).contractWeeklyCount).toBe(8);
    expect(resolveContractLevers({ contractRerollScrapDaily: -5 }).contractRerollScrapDaily).toBe(0);
  });

  it('every stat-kind template names a real stat key; window kinds name none', () => {
    for (const template of CONTRACT_TEMPLATES) {
      const key = CONTRACT_STAT_KEYS[template.kind];
      if (['specific_boss', 'endless_depth', 'endless_runs', 'crafts', 'refines',
        'seller_sales', 'discoveries', 'extraction_units'].includes(template.kind)) {
        expect(key).toBeNull();
      } else {
        expect(typeof key).toBe('string');
      }
    }
    expect(CONTRACT_STAT_KEYS.kills).toBe('combat.roaming_kills');
    expect(CONTRACT_STAT_KEYS.points_restored).toBe('services.points_restored');
    expect(CONTRACT_STAT_KEYS.consumables_used).toBe('consumables.used');
  });
});

// ---------------------------------------------------------------------------
// 5. The in-memory store — issuance, claim, reroll, expiry
// ---------------------------------------------------------------------------

describe('contracts — in-memory gameplay store', () => {
  function makeStore(
    startIso: string,
    levers?: Partial<ContractLeverValues> | (() => Partial<ContractLeverValues>),
  ) {
    let now = new Date(startIso);
    const provider = typeof levers === 'function' ? levers : () => levers ?? {};
    const store = new InMemoryChefGameplayStore(
      () => now, undefined, undefined, undefined, undefined, undefined, provider,
    );
    return { store, setNow: (iso: string) => { now = new Date(iso); } };
  }

  function seedVerified(store: InMemoryChefGameplayStore, id: string, overrides: Json = {}) {
    store.seedProfile({ id, player_level: 12, ...overrides } as never);
    (store.profiles.get(id) as unknown as Record<string, unknown>).account_type = 'verified';
  }

  /** Find a date whose single-contract daily board (count lever 1) is stat-backed. */
  function findStatBackedDaily(): string {
    const band = CONTRACT_BANDS[1]; // B2 — level 12
    for (let day = 2; day < 62; day += 1) {
      const key = day <= 30
        ? `2026-11-${String(day).padStart(2, '0')}`
        : `2026-12-${String(day - 30).padStart(2, '0')}`;
      const draws = drawContractSet({
        seed: contractSetSeed('daily', key, 'B2', A), kind: 'daily', band,
        count: 1, bosses: BOSSES,
      });
      if (CONTRACT_STAT_KEYS[draws[0].template.kind]) return key;
    }
    throw new Error('no stat-backed daily found in the search window');
  }

  it('issuance materializes both sets once; re-issuing is a no-op', async () => {
    const { store } = makeStore('2026-11-02T08:00:00.000Z');
    seedVerified(store, A);
    const first = await store.issueContracts(A, 'daily') as Json;
    expect(first.already_issued).toBe(false);
    expect(first.issued).toBe(3);
    await store.issueContracts(A, 'weekly');
    const again = await store.issueContracts(A, 'daily') as Json;
    expect(again.already_issued).toBe(true);
    expect(store.contractInstances.filter((i) => i.user_id === A)).toHaveLength(8);
    const facts = await store.getContractsFacts(A);
    expect(facts?.daily.instances).toHaveLength(3);
    expect(facts?.weekly.instances).toHaveLength(5);
    expect(facts?.daily.band).toBe('B2'); // level 12
  });

  it('two players at the same level share the daily board; weeklies are their own', async () => {
    const { store } = makeStore('2026-11-02T08:00:00.000Z');
    seedVerified(store, A);
    seedVerified(store, B);
    await store.issueContracts(A, 'daily');
    await store.issueContracts(B, 'daily');
    await store.issueContracts(A, 'weekly');
    await store.issueContracts(B, 'weekly');
    const factsA = await store.getContractsFacts(A);
    const factsB = await store.getContractsFacts(B);
    expect(factsA?.daily.instances.map((i) => i.templateId))
      .toEqual(factsB?.daily.instances.map((i) => i.templateId));
    expect(factsA?.daily.instances.map((i) => i.target))
      .toEqual(factsB?.daily.instances.map((i) => i.target));
    // Weekly sets are per-player draws (ids may coincide; the seeds differ).
    expect(store.contractInstances.filter((i) => i.user_id === A && i.periodKind === 'weekly'))
      .toHaveLength(5);
  });

  it('claim pays the frozen reward exactly once; a nonce replay returns the stored result', async () => {
    const { store } = makeStore('2026-11-02T08:00:00.000Z');
    seedVerified(store, A);
    await store.issueContracts(A, 'daily');
    const facts = await store.getContractsFacts(A);
    const inst = facts!.daily.instances.find((i) => CONTRACT_STAT_KEYS[
      CONTRACT_TEMPLATE_BY_ID.get(i.templateId)!.kind]);
    expect(inst).toBeTruthy();
    driveContractComplete(store, A, inst!);
    const beforeCredits = store.profiles.get(A)!.credits;
    const beforeParts = store.profiles.get(A)!.cache_token_parts;
    const claimed = await store.claimContractReward(A, 'claim-nonce-0001', inst!.id) as Json;
    expect(claimed.credits_awarded).toBe(inst!.reward.credits);
    expect(claimed.fragments_awarded).toBe(inst!.reward.fragments);
    expect(store.profiles.get(A)!.credits).toBe(beforeCredits + inst!.reward.credits);
    expect(store.profiles.get(A)!.cache_token_parts).toBe(beforeParts + inst!.reward.fragments);
    const replay = await store.claimContractReward(A, 'claim-nonce-0001', inst!.id) as Json;
    expect(replay).toEqual(claimed);
    expect(store.profiles.get(A)!.credits).toBe(beforeCredits + inst!.reward.credits);
    await expect(store.claimContractReward(A, 'claim-nonce-0002', inst!.id))
      .rejects.toThrow('Contract already claimed');
  });

  it('claim refuses incomplete, foreign, guest, and expired contracts', async () => {
    const { store, setNow } = makeStore('2026-11-02T08:00:00.000Z');
    seedVerified(store, A);
    seedVerified(store, B);
    store.seedProfile({ id: '33333333-3333-4333-8333-333333333333', player_level: 12 });
    const guest = '33333333-3333-4333-8333-333333333333';
    await store.issueContracts(A, 'daily');
    await store.issueContracts(guest, 'daily');
    const facts = await store.getContractsFacts(A);
    const inst = facts!.daily.instances[0];
    await expect(store.claimContractReward(A, 'claim-nonce-1001', inst.id))
      .rejects.toThrow('Contract not complete');
    await expect(store.claimContractReward(B, 'claim-nonce-1002', inst.id))
      .rejects.toThrow('Contract not found');
    const guestFacts = await store.getContractsFacts(guest);
    const guestInst = guestFacts!.daily.instances.find((i) => CONTRACT_STAT_KEYS[
      CONTRACT_TEMPLATE_BY_ID.get(i.templateId)!.kind])!;
    driveContractComplete(store, guest, guestInst);
    await expect(store.claimContractReward(guest, 'claim-nonce-1003', guestInst.id))
      .rejects.toThrow('verified account');
    // Expiry: issued Monday, claimed Tuesday — refused even complete.
    driveContractComplete(store, A, inst);
    setNow('2026-11-03T00:00:01.000Z');
    await expect(store.claimContractReward(A, 'claim-nonce-1004', inst.id))
      .rejects.toThrow('expired');
  });

  it('the daily full-set bonus pays +2 parts once, in the completing claim', async () => {
    const dayKey = findStatBackedDaily();
    const { store } = makeStore(`${dayKey}T08:00:00.000Z`, { contractDailyCount: 1 });
    seedVerified(store, A);
    await store.issueContracts(A, 'daily');
    const facts = await store.getContractsFacts(A);
    expect(facts!.daily.instances).toHaveLength(1);
    const inst = facts!.daily.instances[0];
    driveContractComplete(store, A, inst);
    const claimed = await store.claimContractReward(A, 'claim-nonce-2001', inst.id) as Json;
    expect(claimed.set_bonus).toEqual({ credits: 0, fragments: 2, cache_keys: 0 });
    expect(store.profiles.get(A)!.cache_token_parts)
      .toBe(inst.reward.fragments + 2);
    const after = await store.getContractsFacts(A);
    expect(after!.daily.setBonusClaimed).toBe(true);
  });

  it('the weekly full-set bonus pays the cache key (the system\u2019s only key source)', async () => {
    // Find a Monday whose single weekly (count lever 1) is stat-backed.
    const band = CONTRACT_BANDS[1];
    let monday: string | null = null;
    for (let week = 0; week < 12 && !monday; week += 1) {
      const d = new Date(Date.UTC(2026, 10, 2 + week * 7));
      const key = d.toISOString().slice(0, 10);
      const draws = drawContractSet({
        seed: contractSetSeed('weekly', key, 'B2', A), kind: 'weekly', band,
        count: 1, bosses: BOSSES,
      });
      if (CONTRACT_STAT_KEYS[draws[0].template.kind]) monday = key;
    }
    expect(monday).toBeTruthy();
    const { store } = makeStore(`${monday}T08:00:00.000Z`, { contractWeeklyCount: 1 });
    seedVerified(store, A);
    await store.issueContracts(A, 'weekly');
    const facts = await store.getContractsFacts(A);
    const inst = facts!.weekly.instances[0];
    driveContractComplete(store, A, inst);
    const claimed = await store.claimContractReward(A, 'claim-nonce-3001', inst.id) as Json;
    expect(claimed.set_bonus).toEqual({ credits: 900, fragments: 0, cache_keys: 1 });
    expect(store.profiles.get(A)!.cache_tokens).toBe(1);
    expect(store.profiles.get(A)!.credits).toBe(inst.reward.credits + 900);
  });

  it('reroll: first is free, the next destroys scrap; completed and broke refuse', async () => {
    const { store } = makeStore('2026-11-02T08:00:00.000Z');
    seedVerified(store, A, { scrap: 500 });
    await store.issueContracts(A, 'daily');
    const facts = await store.getContractsFacts(A);
    const first = facts!.daily.instances[0];
    const setIds = facts!.daily.instances.map((i) => i.templateId);
    const rerolled = await store.rerollContract(A, 'reroll-nonce-0001', first.id) as Json;
    expect(rerolled.free_reroll).toBe(true);
    expect(rerolled.scrap_charged).toBe(0);
    expect(store.profiles.get(A)!.scrap).toBe(500);
    expect(setIds).not.toContain(rerolled.template_id);
    const after = await store.getContractsFacts(A);
    expect(after!.daily.rerollsUsed).toBe(1);
    const second = after!.daily.instances[1];
    const paid = await store.rerollContract(A, 'reroll-nonce-0002', second.id) as Json;
    expect(paid.free_reroll).toBe(false);
    expect(paid.scrap_charged).toBe(100);
    expect(store.profiles.get(A)!.scrap).toBe(400);
    // Replay returns the stored result and charges nothing again.
    const replay = await store.rerollContract(A, 'reroll-nonce-0002', second.id) as Json;
    expect(replay).toEqual(paid);
    expect(store.profiles.get(A)!.scrap).toBe(400);
    // A completed contract cannot be rerolled.
    const factsNow = await store.getContractsFacts(A);
    const completable = factsNow!.daily.instances.find((i) => CONTRACT_STAT_KEYS[
      CONTRACT_TEMPLATE_BY_ID.get(i.templateId)!.kind]);
    if (completable) {
      driveContractComplete(store, A, completable);
      await expect(store.rerollContract(A, 'reroll-nonce-0003', completable.id))
        .rejects.toThrow('claim it or let it expire');
    }
  });

  it('issued rewards ignore later lever moves (freeze at issuance)', async () => {
    const live: Partial<ContractLeverValues> = { contractRewardScalar: 1 };
    const { store, setNow } = makeStore('2026-11-02T08:00:00.000Z', () => live);
    seedVerified(store, A);
    await store.issueContracts(A, 'daily');
    const dayOne = await store.getContractsFacts(A);
    const frozen = dayOne!.daily.instances[0].reward.credits;
    live.contractRewardScalar = 2;
    const reread = await store.getContractsFacts(A);
    expect(reread!.daily.instances[0].reward.credits).toBe(frozen);
    setNow('2026-11-03T08:00:00.000Z');
    await store.issueContracts(A, 'daily');
    const dayTwo = await store.getContractsFacts(A);
    expect(dayTwo!.daily.instances[0].reward.credits).toBe(frozen * 2);
  });
});

// ---------------------------------------------------------------------------
// 6. Routes — real HTTP, JWT identity, forgery bodies
// ---------------------------------------------------------------------------

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface RouteHarness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
  tokenB: string;
}

async function makeRouteServer(store: InMemoryChefGameplayStore): Promise<RouteHarness> {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, store, { jwtSecret: SECRET });
  mountContractsRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return {
    store,
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

describe('contracts routes', () => {
  function routeStore(startIso = '2026-11-02T08:00:00.000Z') {
    const store = new InMemoryChefGameplayStore(() => new Date(startIso));
    store.seedProfile({ id: A, player_level: 12 } as never);
    (store.profiles.get(A) as unknown as Record<string, unknown>).account_type = 'verified';
    store.seedProfile({ id: B, player_level: 12 } as never);
    (store.profiles.get(B) as unknown as Record<string, unknown>).account_type = 'verified';
    return store;
  }

  it('requires auth; the board issues on first read (3 daily + 5 weekly)', async () => {
    const h = await makeRouteServer(routeStore());
    expect((await call(h, 'GET', '/api/contracts/me')).status).toBe(401);
    const res = await call(h, 'GET', '/api/contracts/me', h.tokenA);
    expect(res.status).toBe(200);
    const board = res.json.contracts as Json;
    expect(board.canClaim).toBe(true);
    expect((board.daily as Json).contracts).toHaveLength(3);
    expect((board.weekly as Json).contracts).toHaveLength(5);
    expect((board.daily as Json).band).toBe('B2');
  });

  it('forgery: body progress/target/reward/playerId fields are ignored — server facts decide', async () => {
    const store = routeStore();
    const h = await makeRouteServer(store);
    const board = (await call(h, 'GET', '/api/contracts/me', h.tokenA)).json.contracts as Json;
    const target = ((board.daily as Json).contracts as Json[])[0];
    const forged = await call(h, 'POST', '/api/contracts/claim', h.tokenA, {
      instanceId: target.id as string,
      nonce: 'forged-nonce-0001',
      progress: 999999,
      target: 1,
      reward: { credits: 999999, fragments: 99 },
      credits: 999999,
      periodKey: '1999-01-01',
      band: 'B5',
    });
    expect(forged.status).toBe(409);
    expect(String(forged.json.detail)).toContain('Contract not complete');
    // A body playerId naming someone else is rejected at the auth
    // layer (#207 pattern) before any store call happens.
    const impersonation = await call(h, 'POST', '/api/contracts/claim', h.tokenA, {
      instanceId: target.id as string,
      nonce: 'forged-nonce-0002',
      playerId: B,
    });
    expect(impersonation.status).toBe(403);
    expect(store.profiles.get(A)!.credits).toBe(0);
    expect(store.profiles.get(B)!.credits).toBe(0);
  });

  it('another player\u2019s instance is not claimable or rerollable', async () => {
    const store = routeStore();
    const h = await makeRouteServer(store);
    const board = (await call(h, 'GET', '/api/contracts/me', h.tokenA)).json.contracts as Json;
    const target = ((board.daily as Json).contracts as Json[])[0];
    const claim = await call(h, 'POST', '/api/contracts/claim', h.tokenB, {
      instanceId: target.id as string, nonce: 'foreign-nonce-001',
    });
    expect(claim.status).toBe(404);
    const reroll = await call(h, 'POST', '/api/contracts/reroll', h.tokenB, {
      instanceId: target.id as string, nonce: 'foreign-nonce-002',
    });
    expect(reroll.status).toBe(404);
  });

  it('the full claim flow over HTTP pays and the board reflects it', async () => {
    const store = routeStore();
    const h = await makeRouteServer(store);
    await call(h, 'GET', '/api/contracts/me', h.tokenA);
    const facts = await store.getContractsFacts(A);
    const inst = facts!.daily.instances.find((i) => CONTRACT_STAT_KEYS[
      CONTRACT_TEMPLATE_BY_ID.get(i.templateId)!.kind])!;
    driveContractComplete(store, A, inst);
    const claimed = await call(h, 'POST', '/api/contracts/claim', h.tokenA, {
      instanceId: inst.id, nonce: 'http-nonce-00001',
    });
    expect(claimed.status).toBe(200);
    expect((claimed.json.claimed as Json).creditsAwarded).toBe(inst.reward.credits);
    expect((claimed.json.profile as Json).credits).toBe(inst.reward.credits);
    const board = claimed.json.contracts as Json;
    const card = ((board.daily as Json).contracts as Json[]).find((c) => c.id === inst.id)!;
    expect(card.status).toBe('claimed');
  });

  it('guests see the board with canClaim false and claims refuse', async () => {
    const store = new InMemoryChefGameplayStore(() => new Date('2026-11-02T08:00:00.000Z'));
    const guestId = '33333333-3333-4333-8333-333333333333';
    store.seedProfile({ id: guestId, player_level: 12 } as never);
    const app = express();
    app.use(express.json());
    mountChefHealthRoute(app);
    mountGameplayRoutes(app, store, { jwtSecret: SECRET });
    mountContractsRoutes(app, store, { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = server.address() as AddressInfo;
    const token = issueAccessToken(SECRET, guestId, true);
    const res = await fetch(`http://127.0.0.1:${port}/api/contracts/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as Json;
    expect(res.status).toBe(200);
    expect((json.contracts as Json).canClaim).toBe(false);
    const facts = await store.getContractsFacts(guestId);
    const inst = facts!.daily.instances.find((i) => CONTRACT_STAT_KEYS[
      CONTRACT_TEMPLATE_BY_ID.get(i.templateId)!.kind])!;
    driveContractComplete(store, guestId, inst);
    const claim = await fetch(`http://127.0.0.1:${port}/api/contracts/claim`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: inst.id, nonce: 'guest-nonce-0001' }),
    });
    expect(claim.status).toBe(409);
    expect(store.profiles.get(guestId)!.credits).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Migration 0042 — textual pins (TS ↔ SQL twin parity)
// ---------------------------------------------------------------------------

describe('migration 0042 textual pins', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0042_contracts_board.sql'), 'utf8');

  it('seeds the template twin in parity with CONTRACT_TEMPLATES', () => {
    const start = sql.indexOf('insert into public.contract_template_definitions');
    const end = sql.indexOf('on conflict (template_id) do nothing', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = sql.slice(start, end);
    for (const t of CONTRACT_TEMPLATES) {
      const rowStart = block.indexOf(`('${t.id}', '${t.family}', '${t.kind}',`);
      expect(rowStart, `row for ${t.id}`).toBeGreaterThan(-1);
      const row = block.slice(rowStart, block.indexOf(')', rowStart));
      const head = row.split(',').slice(0, 9).map((s) => s.trim());
      expect(head[3]).toBe(CONTRACT_STAT_KEYS[t.kind] ? `'${CONTRACT_STAT_KEYS[t.kind]}'` : 'null');
      expect(head[4]).toBe(String(t.cadences.includes('daily')));
      expect(head[5]).toBe(String(t.cadences.includes('weekly')));
      expect(head[6]).toBe(String(CONTRACT_BANDS.find((b) => b.id === t.minBand)!.index));
      expect(head[7]).toBe(t.baseTargetDaily == null ? 'null' : String(t.baseTargetDaily));
      expect(head[8]).toBe(t.baseTargetWeekly == null ? 'null' : String(t.baseTargetWeekly));
      // Fragment parts ride the tail (after the target_by_band jsonb).
      if (!t.targetByBand) {
        const tail = row.split(',').slice(-2).map((s) => s.trim());
        expect(tail[0]).toBe(String(t.fragmentPartsDaily));
        expect(tail[1]).toBe(`'${t.paramKind}'`);
      }
    }
  });

  it('seeds the band and boss twins in parity', () => {
    for (const band of CONTRACT_BANDS) {
      expect(sql).toContain(
        `(${band.index}, '${band.id}', ${band.minLevel}, ${Number.isFinite(band.maxLevel) ? band.maxLevel : 'null'}, ${band.targetMultiplier}, ${band.dailyCredits}, ${band.weeklyCredits})`);
    }
    for (const boss of REGION_1_BOSSES) {
      expect(sql).toContain(`('${boss.id}', ${boss.level})`);
    }
  });

  it('ships the four ops, the draw machinery, and both claim ledger rows', () => {
    for (const fn of ['cc_issue_contracts', 'cc_contract_progress', 'cc_claim_contract_reward',
      'cc_reroll_contract', 'cc_contract_draw', 'cc_contract_draw_reroll', 'cc_contract_fnv1a',
      'cc_contract_terms', 'cc_contract_eligible_bosses']) {
      expect(sql).toContain(`function public.${fn}`);
    }
    expect(sql).toContain("'cc_claim_contract_reward'");
    expect(sql).toContain("'cc_claim_contract_set_bonus'");
    expect(sql).toContain("'cc_reroll_contract'");
    expect(sql).toContain('create table if not exists public.contract_instances');
    expect(sql).toContain('create table if not exists public.contract_set_bonuses');
    expect(sql).toContain('unique (user_id, period_kind, period_key, slot, generation)');
  });

  it('the trigger restatement adds exactly the three new stats', () => {
    expect(sql).toContain("'combat.roaming_kills'");
    expect(sql).toContain("(reward_payload ->> 'kills_recorded')");
    expect(sql).toContain("'consumables.used'");
    expect(sql).toContain("'services.points_restored'");
    expect(sql).toContain("action = 'cc_repair_job_finish'");
  });

  it('the metrics restatement folds the contract meters into the minted total', () => {
    for (const col of ['credits_minted_contracts', 'contracts_claimed', 'contracts_expired_unclaimed',
      'contract_rerolls', 'contract_keys_awarded', 'scrap_destroyed_contract_rerolls']) {
      expect(sql).toContain(`add column if not exists ${col}`);
    }
    expect(sql).toContain('as minted_contracts');
    expect(sql).toContain('+ m.minted_contracts');
  });

  it('R3 guard: the claim and reroll ops never touch legendary cores', () => {
    const claimStart = sql.indexOf('function public.cc_claim_contract_reward');
    const rerollEnd = sql.indexOf('function public.cc_reroll_contract');
    const ops = sql.slice(claimStart, sql.indexOf('$$;', rerollEnd) + 3);
    expect(ops).not.toContain('legendary_cores');
    expect(ops).not.toContain('legendary');
  });

  it('the Dashboard panel does no progress math (guard pin)', () => {
    const panel = readFileSync(
      join(process.cwd(), 'src/components/dashboard/ContractsPanel.tsx'), 'utf8');
    expect(panel).not.toContain('contractProgressFor');
    expect(panel).not.toContain('drawContractSet');
    // Dashboard-top redesign (2026-11-01): the board read moved
    // from the panel into the shared contracts store (the
    // Dashboard icon performs it so the claimable badge never
    // waits on opening the pop-up). The pin follows the fetch:
    // the panel consumes the store; the store performs the read.
    expect(panel).toContain('useContractsStore');
    const slice = readFileSync(
      join(process.cwd(), 'src/store/slices/contractsSlice.ts'), 'utf8');
    expect(slice).toContain('getContractsState');
  });
});
