/**
 * Extraction occupation (migration 0033) — shipped-path tests.
 *
 * Covered (brief §2.11 + the task's required list): the XP peg
 * measured against the roaming benchmark across levels (band
 * [0.74, 0.76] around the 0.75 ruling, twins in parity), draw-rate
 * math at both rates incl. lever clamps, the gear factor from the
 * shipped monster-damage path, pool-distribution identity against
 * rollAreaMaterialFind, the signature-material home-area rule,
 * Deep Delve gating (mastery at selection; gear factor at
 * settlement; mid-session degradation), accrual only-while-active,
 * settlement idempotence, slot-exclusivity transitions in all
 * orders across the writes twin, guest/death/locked-area start
 * refusals, forged-claim resistance (extra payload fields are
 * ignored; starts settle from server records), Cache Rank
 * composition exactly once, vehicle invariance, the offline
 * max-advance cap, textual SQL pins on migration 0033 (whitelist
 * parity with the MaterialType/EssenceType enums, clamps, function
 * names), and the client guard pins (no pass-timing math in the
 * panel; the kind is wired through labels/specs/grammar).
 *
 * The SQL itself is exercised against embedded Postgres in the
 * slice verification harness (0001→0033 chain); these tests pin
 * the TypeScript twins and the wire contracts of the real routes.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXTRACTION_LEVER_DEFAULTS,
  EXTRACTION_MATERIAL_IDS,
  EXTRACTION_ESSENCE_IDS,
  EXTRACTION_PASS_MS,
  canSelectDeepDelve,
  extractionGearFactor,
  extractionPassDraws,
  extractionPassXp,
  expectedPassDamage,
  resolveExtractionLevers,
  rollExtractionPass,
} from '../content/extraction';
import { benchmarkXpPerHour } from '../content/crafting';
import { signatureMaterialForArea } from '../content/roamingEvents';
import { ROAMING_AREAS, getRoamingArea, rollAreaMaterialFind } from '../constants/roamingAreas';
import { MaterialType, EssenceType } from '../types/game';
import { createTickRng } from '../lib/rng/tickRng';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { mountExtractionRoutes } from '../server/gameplay/routes';
import { issueAccessToken } from '../server/auth/tokens';
import { newExtractionState } from '../server/writes/extractionEngine';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { cacheRankBonuses } from '../content/cacheRank';
import { hotAreaIdForDate } from '../content/hotArea';
import { masteryLevelForXp } from '../server/writes/store';
import { PRODUCTIVE_ACTIVITY_LABELS } from '../types/activity';
import { ACTION_WORKSPACE_SPECS } from '../lib/activity/actionWorkspaceSpecs';
import { ACTION_SETS } from '../lib/pixel/grammar';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const T0 = new Date('2026-10-31T12:00:00.000Z');
const LEVERS = { ...EXTRACTION_LEVER_DEFAULTS };

type Json = Record<string, unknown>;

// ---------------------------------------------------------------- content

describe('extraction content: levers clamp at the ruling bounds', () => {
  it('extractXpRate hard-clamps to [0.70, 0.85]', () => {
    expect(resolveExtractionLevers({ extractXpRate: 0.99 }).extractXpRate).toBe(0.85);
    expect(resolveExtractionLevers({ extractXpRate: 0.5 }).extractXpRate).toBe(0.7);
    expect(resolveExtractionLevers({ extractXpRate: 0.75 }).extractXpRate).toBe(0.75);
    expect(resolveExtractionLevers({}).extractXpRate).toBe(0.75);
  });

  it('the other levers clamp to their registered ranges', () => {
    const wild = resolveExtractionLevers({
      extractFindsPerHour: 99999, extractSignatureChance: 0.9,
      extractDeepYieldMult: 9, extractGearFactorFloor: -1, extractMasteryYieldPerLevel: 0.5,
    });
    expect(wild.extractFindsPerHour).toBe(480);
    expect(wild.extractSignatureChance).toBe(0.4);
    expect(wild.extractDeepYieldMult).toBe(2.5);
    expect(wild.extractGearFactorFloor).toBe(0);
    expect(wild.extractMasteryYieldPerLevel).toBe(0.02);
    const low = resolveExtractionLevers({ extractFindsPerHour: 10 });
    expect(low.extractFindsPerHour).toBe(48);
    expect(Number.isInteger(resolveExtractionLevers({ extractFindsPerHour: 100.6 }).extractFindsPerHour)).toBe(true);
  });
});

describe('extraction content: the 0.75 XP peg, measured', () => {
  it('pass XP tracks 0.75 x the roaming benchmark across the ladder', () => {
    for (const level of [1, 3, 4, 8, 12, 16, 20, 25, 40, 80]) {
      const perHour = extractionPassXp(level, LEVERS) * 6;
      const ratio = perHour / benchmarkXpPerHour(level);
      expect(ratio, `level ${level}`).toBeGreaterThanOrEqual(0.74);
      expect(ratio, `level ${level}`).toBeLessThanOrEqual(0.76);
    }
    expect(extractionPassXp(1, LEVERS)).toBe(150);
    expect(extractionPassXp(25, LEVERS)).toBe(360);
  });

  it('the peg rate moves XP only inside the hard band', () => {
    // Even a forged lever value of 2.0 prices at the 0.85 ceiling.
    const xp = extractionPassXp(1, resolveExtractionLevers({ extractXpRate: 2 }));
    expect(xp).toBe(Math.round((benchmarkXpPerHour(1) / 6) * 0.85));
  });
});

describe('extraction content: draw math at both rates', () => {
  const base = { masteryLevel: 1, gearFactor: 1, isHot: false, levers: LEVERS, hotAreaMaterialBonus: 0.2 };

  it('surface: 32 draws/pass = 192/hour', () => {
    const m = extractionPassDraws({ ...base, method: 'surface' });
    expect(m.draws).toBe(32);
    expect(m.draws * 6).toBe(192);
    expect(m.deepDegraded).toBe(false);
  });

  it('deep delve: 48 draws/pass = 288/hour at factor 1.00', () => {
    const m = extractionPassDraws({ ...base, method: 'deep' });
    expect(m.draws).toBe(48);
    expect(m.draws * 6).toBe(288);
    expect(m.deepDegraded).toBe(false);
  });

  it('the gear factor scales draws (13 at the 0.40 floor)', () => {
    expect(extractionPassDraws({ ...base, method: 'surface', gearFactor: 0.4 }).draws).toBe(13);
    expect(extractionPassDraws({ ...base, method: 'surface', gearFactor: 0.79 }).draws).toBe(25);
  });

  it('hot area and mastery compose multiplicatively', () => {
    expect(extractionPassDraws({ ...base, method: 'surface', isHot: true }).draws).toBe(38);
    // Mastery 21 = +10% (0.005 x 20), capped at +25% by mastery 51.
    expect(extractionPassDraws({ ...base, method: 'surface', masteryLevel: 21 }).draws).toBe(35);
    expect(extractionPassDraws({ ...base, method: 'surface', masteryLevel: 99 }).draws).toBe(40);
  });

  it('deep delve below the 0.80 factor pays as surface and says so', () => {
    const degraded = extractionPassDraws({ ...base, method: 'deep', gearFactor: 0.79 });
    const surface = extractionPassDraws({ ...base, method: 'surface', gearFactor: 0.79 });
    expect(degraded.deepDegraded).toBe(true);
    expect(degraded.draws).toBe(surface.draws);
    const held = extractionPassDraws({ ...base, method: 'deep', gearFactor: 0.8 });
    expect(held.deepDegraded).toBe(false);
    expect(held.draws).toBe(Math.round(32 * 0.8 * 1.5));
  });

  it('deep selection requires mastery 5', () => {
    expect(canSelectDeepDelve(4)).toBe(false);
    expect(canSelectDeepDelve(5)).toBe(true);
  });
});

describe('extraction content: the gear factor from the shipped damage path', () => {
  const dustwaste = getRoamingArea('dustwaste_frontier');

  it('an unshielded L1 hunter at Dustwaste prices between floor and 1', () => {
    const factor = extractionGearFactor({ level: 1, shield: null, area: dustwaste, levers: LEVERS });
    expect(factor).toBeGreaterThan(0.4);
    expect(factor).toBeLessThan(1);
    const pool = 700 + 60;
    const expected = expectedPassDamage(dustwaste, null);
    expect(factor).toBeCloseTo(Math.min(1, Math.max(0.4, pool / (pool + expected))), 6);
  });

  it('a real shield raises the factor; a huge shield saturates at 1.00', () => {
    const bare = extractionGearFactor({ level: 10, shield: null, area: dustwaste, levers: LEVERS });
    const shielded = extractionGearFactor({
      level: 10, area: dustwaste, levers: LEVERS,
      shield: { hp: 900, mitigation: 0.4, element: null },
    });
    expect(shielded).toBeGreaterThan(bare);
    const saturated = extractionGearFactor({
      level: 10, area: dustwaste, levers: LEVERS,
      shield: { hp: 1_000_000, mitigation: 0.9, element: null },
    });
    expect(saturated).toBeGreaterThan(0.999);
  });

  it('the lever floor clamps the factor from below', () => {
    const floored = extractionGearFactor({
      level: 1, shield: null, area: dustwaste,
      levers: resolveExtractionLevers({ extractGearFactorFloor: 0.9 }),
    });
    expect(floored).toBe(0.9);
  });

  it('expected damage rises with area danger (later areas hit harder)', () => {
    const early = expectedPassDamage(getRoamingArea('dustwaste_frontier'), null);
    const late = expectedPassDamage(getRoamingArea('helixworks_labyrinth'), null);
    expect(late).toBeGreaterThan(early);
  });
});

describe('extraction content: the find pool is roaming\'s pool', () => {
  function aggregate(roller: (i: number) => { materials: Record<string, number>; essences: Record<string, number> }, passes: number) {
    const totals: Record<string, number> = {};
    for (let i = 0; i < passes; i++) {
      const r = roller(i);
      for (const [k, v] of Object.entries(r.materials)) totals[k] = (totals[k] ?? 0) + v;
      for (const [k, v] of Object.entries(r.essences)) totals[k] = (totals[k] ?? 0) + v;
    }
    return totals;
  }

  it('extraction draws land on the same id space and roughly the shipped weights', () => {
    const area = getRoamingArea('dustwaste_frontier');
    const whitelist = new Set([...EXTRACTION_MATERIAL_IDS, ...EXTRACTION_ESSENCE_IDS]);
    const noSubstitution = resolveExtractionLevers({ extractSignatureChance: 0 });
    const extractTotals = aggregate((i) => rollExtractionPass(area, 32, {
      main: createTickRng(A, 'extract', i),
      signature: createTickRng(A, 'extract:signature', i),
      lootQuantity: createTickRng(A, 'extract:loot', i),
    }, noSubstitution, 0), 300);
    for (const id of Object.keys(extractTotals)) {
      expect(whitelist.has(id), `find ${id} is whitelisted`).toBe(true);
    }
    // Roaming's own roller over the same number of single draws:
    // the base-material share must agree within sampling tolerance.
    const roamTotals = aggregate((i) => {
      const rng = createTickRng(A, area.id, i);
      const materials: Record<string, number> = {};
      const essences: Record<string, number> = {};
      for (let d = 0; d < 32; d++) {
        const find = rollAreaMaterialFind(area, rng);
        if (!find) continue;
        if (find.kind === 'material') materials[find.type] = (materials[find.type] ?? 0) + 1;
        else essences[find.type] = (essences[find.type] ?? 0) + 1;
      }
      return { materials, essences };
    }, 300);
    const share = (t: Record<string, number>, id: string) => {
      const total = Object.values(t).reduce((a, b) => a + b, 0);
      return (t[id] ?? 0) / Math.max(1, total);
    };
    for (const id of ['ScrapAlloy', 'BallisticParts', 'ReactiveComponents']) {
      expect(Math.abs(share(extractTotals, id) - share(roamTotals, id)), id).toBeLessThan(0.05);
    }
  });

  it('signature materials substitute ONLY in their home area', () => {
    const dustwaste = getRoamingArea('dustwaste_frontier');
    const redline = getRoamingArea('redline_circuit');
    expect(signatureMaterialForArea(dustwaste.id)?.materialId).toBe(MaterialType.Siltglass);
    const rollMany = (area: typeof dustwaste) => aggregate((i) => rollExtractionPass(area, 48, {
      main: createTickRng(A, 'extract', 10000 + i),
      signature: createTickRng(A, 'extract:signature', 10000 + i),
      lootQuantity: createTickRng(A, 'extract:loot', 10000 + i),
    }, LEVERS, 0), 200);
    const home = rollMany(dustwaste);
    expect(home[MaterialType.Siltglass] ?? 0).toBeGreaterThan(0);
    const away = rollMany(redline);
    expect(away[MaterialType.Siltglass] ?? 0).toBe(0);
    expect(away[MaterialType.NitrocellGel] ?? 0).toBeGreaterThan(0);
  });

  it('scavenger lootQuantity adds units; without it totals stay within draws', () => {
    const area = getRoamingArea('dustwaste_frontier');
    const plain = rollExtractionPass(area, 32, {
      main: createTickRng(A, 'extract', 7), signature: createTickRng(A, 'extract:signature', 7),
      lootQuantity: createTickRng(A, 'extract:loot', 7),
    }, LEVERS, 0);
    const plainUnits = [...Object.values(plain.materials), ...Object.values(plain.essences)].reduce((a, b) => a + b, 0);
    expect(plainUnits).toBeLessThanOrEqual(32);
    // lootQuantity 1.0 = every find gains +1 unit.
    const boosted = rollExtractionPass(area, 32, {
      main: createTickRng(A, 'extract', 7), signature: createTickRng(A, 'extract:signature', 7),
      lootQuantity: createTickRng(A, 'extract:loot', 7),
    }, LEVERS, 1);
    const boostedUnits = [...Object.values(boosted.materials), ...Object.values(boosted.essences)].reduce((a, b) => a + b, 0);
    expect(boostedUnits).toBe(plainUnits * 2);
  });

  it('finds never include gear, credits, or non-whitelist ids — across every area', () => {
    const whitelist = new Set([...EXTRACTION_MATERIAL_IDS, ...EXTRACTION_ESSENCE_IDS]);
    for (const area of ROAMING_AREAS) {
      const finds = rollExtractionPass(area, 48, {
        main: createTickRng(A, 'extract', 42), signature: createTickRng(A, 'extract:signature', 42),
        lootQuantity: createTickRng(A, 'extract:loot', 42),
      }, LEVERS, 0);
      for (const id of [...Object.keys(finds.materials), ...Object.keys(finds.essences)]) {
        expect(whitelist.has(id), `${area.id} -> ${id}`).toBe(true);
      }
    }
  });
});

// ------------------------------------------------------- migration pins

describe('migration 0033: textual pins', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0033_extraction.sql'), 'utf8');

  it('carries the extraction objects, functions, and meters', () => {
    for (const needle of [
      'create table if not exists public.extraction_state',
      'cc_settle_extraction_time', 'cc_apply_extraction', 'cc_extract_pass_xp',
      "'gathering.extraction'", 'extraction_passes', 'extraction_xp_awarded',
      'materials_minted_extraction', "action_type = 'cc_apply_extraction'",
    ]) {
      expect(sql, needle).toContain(needle);
    }
  });

  it('the applier whitelist equals the TS material/essence id sets', () => {
    const listMatch = sql.match(/v_material_ids text\[\] := array\[([\s\S]*?)\];/);
    expect(listMatch).not.toBeNull();
    const sqlIds = [...listMatch![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(sqlIds).toEqual([...Object.values(MaterialType)].sort());
    const essMatch = sql.match(/v_essence_ids text\[\] := array\[([\s\S]*?)\];/);
    const sqlEss = [...essMatch![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(sqlEss).toEqual([...Object.values(EssenceType)].sort());
    expect(EXTRACTION_MATERIAL_IDS).toEqual(Object.values(MaterialType));
    expect(EXTRACTION_ESSENCE_IDS).toEqual(Object.values(EssenceType));
  });

  it('the rate clamp is hard in SQL and the peg delegates to the crafting twin', () => {
    expect(sql).toContain("least(0.85, greatest(0.70,\n    public.cc_economy_config_number('extractXpRate', 0.75)))");
    expect(sql).toContain('public.cc_craft_unit_xp(600000');
  });

  it('the action slot learns extraction in both the function whitelist and the table check', () => {
    expect(sql).toContain("'endless_run',\n    'extraction'");
    expect(sql).toContain("'endless_run', 'extraction'");
    expect(sql).toContain('perform public.cc_settle_extraction_time(actor);');
    expect(sql).toContain("raise exception 'Verified account required'");
    expect(sql).toContain("raise exception 'Deep Delve requires Extraction mastery 5'");
  });
});

// ---------------------------------------------------------- guard pins

describe('client wiring: the kind is plumbed and the panel runs no pass math', () => {
  it('labels, workspace spec, and scene grammar carry extraction', () => {
    expect(PRODUCTIVE_ACTIVITY_LABELS.extraction).toBe('Extraction');
    expect(ACTION_WORKSPACE_SPECS.extraction.kind).toBe('extraction');
    expect(ACTION_SETS.extraction).toEqual(['set-extract-stakes', 'set-extract-rig', 'set-extract-crates']);
  });

  it('the panel never computes pass timing or finds client-side', () => {
    const panel = readFileSync(join(process.cwd(), 'src/components/fight/ExtractionPanel.tsx'), 'utf8');
    expect(panel).not.toContain('EXTRACTION_PASS_MS');
    expect(panel).not.toContain('600000');
    expect(panel).not.toContain('rollExtractionPass');
    expect(panel).not.toContain('Math.random');
    expect(panel).toContain('getExtractionState');
  });

  it('loot-moment timings and movement are untouched by the slice (grammar constants intact)', () => {
    const grammar = readFileSync(join(process.cwd(), 'src/lib/pixel/grammar.ts'), 'utf8');
    expect(grammar).toContain('beamWidthPx');
    expect(EXTRACTION_PASS_MS).toBe(600_000);
  });
});

// ------------------------------------------- gameplay store (finalize)

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface GameplayRig {
  store: InMemoryChefGameplayStore;
  advance: (minutes: number) => void;
  now: () => Date;
}

function makeGameplayRig(start: Date): GameplayRig {
  let clock = start.getTime();
  const store = new InMemoryChefGameplayStore(() => new Date(clock));
  return {
    store,
    advance: (minutes: number) => {
      clock += minutes * 60_000;
      // The client heartbeats while it plays; the seeded action row
      // tracks the clock so accrual reads as attended time.
      const action = store.activeActions.get(A);
      if (action) action.last_heartbeat_at = new Date(clock).toISOString();
    },
    now: () => new Date(clock),
  };
}

function seedExtractionRun(rig: GameplayRig, opts: {
  level?: number; areaId?: string; method?: 'surface' | 'deep'; masteryXp?: number;
} = {}): void {
  const areaId = opts.areaId ?? 'dustwaste_frontier';
  rig.store.seedProfile({ id: A, player_level: opts.level ?? 25 });
  rig.store.seedActiveAction({
    user_id: A, active_action: 'extraction', target_id: areaId,
    started_at: rig.now().toISOString(), last_heartbeat_at: rig.now().toISOString(),
    activity_payload: { method: opts.method ?? 'surface' },
  });
  rig.store.seedExtractionState(newExtractionState(A, rig.now().getTime(), areaId, opts.method ?? 'surface'));
  if (opts.masteryXp) {
    rig.store.masteries.push({
      user_id: A, mastery_id: 'gathering.extraction',
      mastery_xp: opts.masteryXp, mastery_level: masteryLevelForXp(opts.masteryXp),
    });
  }
}

const SAFE_NOW = ((): Date => {
  const testAreas = new Set(['dustwaste_frontier', 'helixworks_labyrinth', 'redline_circuit']);
  for (let d = 0; d < 30; d++) {
    const date = new Date(T0.getTime() + d * 86_400_000);
    if (!testAreas.has(hotAreaIdForDate(date))) return date;
  }
  throw new Error('no safe hot-area date found');
})();

function settleInput(rig: GameplayRig, over: Partial<{ maxAdvanceMs: number | null; cacheRankXpFraction: number }> = {}) {
  return {
    levers: LEVERS,
    hotAreaMaterialBonus: 0.2,
    maxAdvanceMs: over.maxAdvanceMs ?? null,
    cacheRankXpFraction: over.cacheRankXpFraction ?? 0,
    now: SAFE_NOW,
  };
}

describe('extraction gameplay store: accrual + finalization', () => {
  it('accrues only while extraction holds the slot; paused time earns nothing', async () => {
    const rig = makeGameplayRig(T0);
    seedExtractionRun(rig);
    rig.advance(11);
    const state1 = await rig.store.getExtractionState(A);
    expect(state1?.pending_passes.length).toBe(1);
    expect(state1?.accrued_ms).toBe(60_000);

    // Roaming takes the slot for 30 minutes: nothing accrues.
    const action = rig.store.activeActions.get(A)!;
    action.active_action = 'roaming_loot';
    rig.advance(30);
    const state2 = await rig.store.getExtractionState(A);
    expect(state2?.pending_passes.length).toBe(1);
    expect(state2?.accrued_ms).toBe(60_000);

    // Back on extraction for 9 minutes: the second pass completes.
    action.active_action = 'extraction';
    rig.advance(9);
    const state3 = await rig.store.getExtractionState(A);
    expect(state3?.pending_passes.length).toBe(2);
    expect(state3?.accrued_ms).toBe(0);
  });

  it('settlement pays the pegged XP + finds once; a replay pays nothing', async () => {
    const rig = makeGameplayRig(T0);
    seedExtractionRun(rig, { level: 25 });
    rig.advance(11);
    const settled = await rig.store.settleExtraction(A, settleInput(rig));
    expect(settled.passes.length).toBe(1);
    expect(settled.xpAwarded).toBe(360);
    // No shield at L25: the gear factor prices below 1, and the
    // draws follow it exactly (content math at the settled factor).
    const atFactor = extractionPassDraws({
      method: 'surface', masteryLevel: 1, gearFactor: settled.passes[0].gearFactor,
      isHot: false, levers: LEVERS, hotAreaMaterialBonus: 0.2,
    });
    expect(settled.passes[0].draws).toBe(atFactor.draws);
    expect(settled.passes[0].draws).toBeLessThan(32);
    const profile = rig.store.profiles.get(A)!;
    const materialTotal = Object.values(settled.materials).reduce((a, b) => a + b, 0);
    const essenceTotal = Object.values(settled.essences).reduce((a, b) => a + b, 0);
    expect(materialTotal + essenceTotal).toBeGreaterThan(0);
    expect(materialTotal + essenceTotal).toBeLessThanOrEqual(settled.passes[0].draws);
    expect(Object.values(profile.materials).reduce((a, b) => a + b, 0)).toBe(materialTotal);
    expect(Object.values(profile.essences).reduce((a, b) => a + b, 0)).toBe(essenceTotal);
    const mastery = rig.store.masteries.find((m) => m.mastery_id === 'gathering.extraction');
    expect(mastery?.mastery_xp).toBe(20);

    const replay = await rig.store.settleExtraction(A, settleInput(rig));
    expect(replay.passes.length).toBe(0);
    expect(replay.xpAwarded).toBe(0);
    expect(Object.values(rig.store.profiles.get(A)!.materials).reduce((a, b) => a + b, 0))
      .toBe(Object.values(profile.materials).reduce((a, b) => a + b, 0));
  });

  it('Cache Rank composes exactly once (no double-count)', async () => {
    const rig = makeGameplayRig(T0);
    seedExtractionRun(rig, { level: 25 });
    rig.store.profiles.get(A)!.cache_rank_spends = { xp: 4 };
    const fraction = cacheRankBonuses({ xp: 4 }).xp;
    expect(fraction).toBeGreaterThan(0);
    rig.advance(11);
    const settled = await rig.store.settleExtraction(A, settleInput(rig));
    expect(settled.xpAwarded).toBe(Math.round(360 * (1 + fraction)));
    expect(settled.xpAwarded).not.toBe(Math.round(360 * (1 + fraction) * (1 + fraction)));
  });

  it('deep delve at mastery 5 pays deep draws while the factor holds; weak gear degrades it', async () => {
    // Mastery 5 = 3000 XP on the n^2 x 100 ladder. A big shield at
    // Dustwaste saturates the factor at 1.00 -> full deep rate.
    const strong = makeGameplayRig(T0);
    seedExtractionRun(strong, { level: 25, method: 'deep', masteryXp: 3000 });
    strong.store.seedItem({
      id: 'shield-strong', owner_user_id: A, kind: 'shield',
      payload: { kind: 'shield', hp: 100000, mitigation: 0.9, element: null },
      runtime_state: 'equipped', equipped_slot: 'shield',
    });
    strong.advance(11);
    const strongSettled = await strong.store.settleExtraction(A, settleInput(strong));
    expect(strongSettled.passes[0].method).toBe('deep');
    expect(strongSettled.passes[0].deepDegraded).toBe(false);
    // 32 x 1.5 (deep) x 1.02 (mastery 5 yield) = 49 draws.
    expect(strongSettled.passes[0].draws).toBe(49);

    // Same mastery, no shield, late area: the factor falls below
    // 0.80 and the pass pays as surface, flagged.
    const weak = makeGameplayRig(T0);
    seedExtractionRun(weak, { level: 25, areaId: 'helixworks_labyrinth', method: 'deep', masteryXp: 3000 });
    weak.advance(11);
    const weakSettled = await weak.store.settleExtraction(A, settleInput(weak));
    expect(weakSettled.passes[0].deepDegraded).toBe(true);
    const surfaceAtFactor = extractionPassDraws({
      method: 'surface', masteryLevel: 5, gearFactor: weakSettled.passes[0].gearFactor,
      isHot: false, levers: LEVERS, hotAreaMaterialBonus: 0.2,
    });
    expect(weakSettled.passes[0].draws).toBe(surfaceAtFactor.draws);
  });

  it('mid-session degradation: a gear swap reprices the unfinished pass at completion', async () => {
    const rig = makeGameplayRig(T0);
    seedExtractionRun(rig, { level: 25, method: 'deep', masteryXp: 3000 });
    rig.store.seedItem({
      id: 'shield-strong', owner_user_id: A, kind: 'shield',
      payload: { kind: 'shield', hp: 100000, mitigation: 0.9, element: null },
      runtime_state: 'equipped', equipped_slot: 'shield',
    });
    rig.advance(5);
    // Swap the shield OUT mid-pass (unequip): the pass that completes
    // now prices on the loadout at completion — deliberate divergence
    // from crafting's snapshot rule, per the brief.
    const item = rig.store.items.get('shield-strong')!;
    (item as { runtime_state: string }).runtime_state = 'inventory';
    rig.advance(6);
    const settled = await rig.store.settleExtraction(A, settleInput(rig));
    expect(settled.passes.length).toBe(1);
    expect(settled.passes[0].gearFactor).toBeLessThan(1);
    expect(settled.passes[0].deepDegraded).toBe(true);
  });

  it('vehicles do not apply: an equipped vehicle changes no number', async () => {
    const rig = makeGameplayRig(T0);
    seedExtractionRun(rig, { level: 25 });
    rig.advance(11);
    const before = await rig.store.settleExtraction(A, settleInput(rig));
    rig.store.seedItem({
      id: 'vehicle-hauler', owner_user_id: A, kind: 'vehicle',
      payload: { kind: 'vehicle', vehicleClassId: 'cargo_hauler', cargoBonus: 0.6 },
      runtime_state: 'equipped', equipped_slot: 'vehicle',
    });
    rig.advance(10);
    const after = await rig.store.settleExtraction(A, settleInput(rig));
    expect(after.passes.length).toBe(1);
    expect(after.passes[0].draws).toBe(before.passes[0].draws);
    expect(after.passes[0].gearFactor).toBe(before.passes[0].gearFactor);
    expect(after.xpAwarded).toBe(before.xpAwarded);
  });

  it('offline settlement honors the explicit max-advance cap exactly', async () => {
    const rig = makeGameplayRig(T0);
    seedExtractionRun(rig, { level: 25 });
    rig.advance(60);
    // Cap the settle at 25 minutes: 2 passes + 5 minutes accrued,
    // even though an hour of attended time stands behind it.
    const settled = await rig.store.settleExtraction(A, settleInput(rig, { maxAdvanceMs: 25 * 60_000 }));
    expect(settled.passes.length).toBe(2);
    const state = await rig.store.getExtractionState(A);
    expect(state?.accrued_ms).toBe(5 * 60_000);
  });
});

// ---------------------------------------------- writes twin (the slot)

let wClock = T0.getTime();
let wNonce = 0;
const nextNonce = () => `extract-nonce-${++wNonce}-abcdefgh`;

function writeProfile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'digger', display_name: null, player_level: 25, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'digger@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function makeWriteStore(): { store: InMemoryWriteStore; seed: WriteSeed } {
  // The store clones its seed; tests observe the live clone.
  wClock = T0.getTime();
  const seed = emptyWriteSeed();
  seed.profiles = [
    writeProfile({ id: A }),
    writeProfile({ id: '22222222-2222-4222-8222-222222222222', account_type: 'guest', email_verified_at: null }),
    writeProfile({ id: '33333333-3333-4333-8333-333333333333', player_level: 1 }),
  ];
  const store = new InMemoryWriteStore(seed, {
    now: () => new Date(wClock),
    rng: () => 0.5,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
  });
  return { store, seed: store.seed };
}

function heartbeat(seed: WriteSeed): void {
  for (const row of seed.activeActions) row.last_heartbeat_at = new Date(wClock).toISOString();
}

const startExtraction = (store: InMemoryWriteStore, player: string, area = 'dustwaste_frontier', payload: Json = { method: 'surface' }) =>
  store.setActiveAction(player, nextNonce(), {
    activity_kind: 'extraction', target_type: 'roaming_area', target_id: area,
    activity_payload: payload,
  });

describe('extraction writes twin: slot transitions in all orders', () => {
  it('roam -> extract -> craft -> extract -> clear accrues only extraction minutes', async () => {
    const { store, seed } = makeWriteStore();
    const setKind = (kind: string, target?: string) => store.setActiveAction(A, nextNonce(), {
      activity_kind: kind, target_type: target ? 'roaming_area' : null, target_id: target ?? null,
      activity_payload: {},
    });

    await setKind('roaming_loot', 'dustwaste_frontier');
    wClock += 10 * 60_000; heartbeat(seed);
    await startExtraction(store, A);
    expect(seed.extractionStates.length).toBe(1);
    expect(seed.extractionStates[0].accrued_ms).toBe(0);

    wClock += 11 * 60_000; heartbeat(seed);
    await setKind('crafting');
    let state = seed.extractionStates[0];
    expect(state.pending_passes.length).toBe(1);
    expect(state.accrued_ms).toBe(60_000);

    wClock += 30 * 60_000; heartbeat(seed);
    await startExtraction(store, A);
    state = seed.extractionStates[0];
    expect(state.pending_passes.length).toBe(1);
    expect(state.accrued_ms).toBe(60_000);

    wClock += 9 * 60_000; heartbeat(seed);
    await store.clearActiveAction(A, nextNonce());
    state = seed.extractionStates[0];
    expect(state.pending_passes.length).toBe(2);
    expect(state.accrued_ms).toBe(0);

    // Standby earns nothing, and the rebase keeps it that way.
    wClock += 60 * 60_000; heartbeat(seed);
    await startExtraction(store, A);
    state = seed.extractionStates[0];
    expect(state.pending_passes.length).toBe(2);
  });

  it('start gates read server records: guest, death, level, mastery — forged payload fields change nothing', async () => {
    const { store, seed } = makeWriteStore();
    const GUEST = '22222222-2222-4222-8222-222222222222';
    const LOW = '33333333-3333-4333-8333-333333333333';

    await expect(startExtraction(store, GUEST)).rejects.toThrow('Verified account required');
    await expect(startExtraction(store, LOW, 'blastforge_yards')).rejects.toThrow('Area locked for this hunter level');
    await expect(startExtraction(store, A, 'not_a_real_area')).rejects.toThrow('Unknown extraction area');
    await expect(startExtraction(store, A, 'dustwaste_frontier', { method: 'deep' }))
      .rejects.toThrow('Deep Delve requires Extraction mastery 5');
    // Forged claims ride the same payload and are ignored: the
    // mastery on record is still 1, so deep still refuses.
    await expect(startExtraction(store, A, 'dustwaste_frontier', {
      method: 'deep', masteryLevel: 99, gearFactor: 1, masteryXp: 999999,
    })).rejects.toThrow('Deep Delve requires Extraction mastery 5');

    const dead = seed.profiles.find((p) => p.id === A)!;
    (dead as unknown as Record<string, unknown>).death_state = { cause: 'test' };
    await expect(startExtraction(store, A)).rejects.toThrow('dead');
    expect(seed.extractionStates.length).toBe(0);
  });

  it('a site/method switch settles the outgoing pass on its starting terms', async () => {
    const { store, seed } = makeWriteStore();
    await startExtraction(store, A, 'dustwaste_frontier', { method: 'surface' });
    wClock += 11 * 60_000; heartbeat(seed);
    await startExtraction(store, A, 'redline_circuit', { method: 'surface' });
    const state = seed.extractionStates[0];
    expect(state.pending_passes.length).toBe(1);
    expect(state.pending_passes[0].areaId).toBe('dustwaste_frontier');
    // The standing selection moves at once; the IN-PROGRESS pass
    // (60s in, on Dustwaste terms) keeps its terms until it lands.
    expect(state.area_id).toBe('redline_circuit');
    expect(state.pass_area_id).toBe('dustwaste_frontier');

    // 9 more minutes: pass 2 completes on Dustwaste terms, and only
    // then does the next pass adopt the Redline selection.
    wClock += 9 * 60_000; heartbeat(seed);
    await store.clearActiveAction(A, nextNonce());
    expect(state.pending_passes.length).toBe(2);
    expect(state.pending_passes[1].areaId).toBe('dustwaste_frontier');
    expect(state.pass_area_id).toBe('redline_circuit');
  });
});

// ------------------------------------------------------------ the route

describe('extraction route: GET /api/extraction/state settles first, then reads', () => {
  async function makeServer(rig: GameplayRig): Promise<{ base: string }> {
    const app = express();
    app.use(express.json());
    mountExtractionRoutes(app, rig.store, { jwtSecret: SECRET, now: rig.now } as never);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = server.address() as AddressInfo;
    return { base: `http://127.0.0.1:${port}` };
  }

  it('401 without a token; 200 with the settled batch + preview for the owner', async () => {
    const rig = makeGameplayRig(T0);
    seedExtractionRun(rig, { level: 25 });
    rig.advance(11);
    const { base } = await makeServer(rig);

    const anon = await fetch(`${base}/api/extraction/state`);
    expect(anon.status).toBe(401);

    const token = issueAccessToken(SECRET, A, false);
    const res = await fetch(`${base}/api/extraction/state`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Json;
    const extraction = json.extraction as Json;
    expect(extraction.active).toBe(true);
    expect(extraction.hasState).toBe(true);
    const settled = extraction.settled as Json;
    expect((settled.passes as unknown[]).length).toBe(1);
    expect(settled.xpAwarded).toBe(360);
    const preview = extraction.preview as Json;
    const previewDraws = extractionPassDraws({
      method: 'surface', masteryLevel: 1, gearFactor: preview.gearFactor as number,
      isHot: preview.isHot as boolean, levers: LEVERS, hotAreaMaterialBonus: 0.2,
    });
    expect(preview.drawsPerPass).toBe(previewDraws.draws);
    expect(preview.xpPerPass).toBe(360);
    expect((extraction.mastery as Json).level).toBe(1);
  });

  it('a player who never started reads hasState=false and settles nothing', async () => {
    const rig = makeGameplayRig(T0);
    rig.store.seedProfile({ id: A, player_level: 10 });
    const { base } = await makeServer(rig);
    const token = issueAccessToken(SECRET, A, false);
    const res = await fetch(`${base}/api/extraction/state`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Json;
    const extraction = json.extraction as Json;
    expect(extraction.hasState).toBe(false);
    expect(extraction.active).toBe(false);
    expect(((extraction.settled as Json).passes as unknown[]).length).toBe(0);
  });
});

// ------------------------------------------------- lever registry pin

import { ECONOMY_CONFIG_DEFAULTS, ECONOMY_CONFIG_KEYS } from '../server/economy/config';

describe('extraction levers: the economy registry mirrors the content owner', () => {
  it('defaults and clamp ranges are pinned equal', () => {
    const keys = [
      'extractXpRate', 'extractFindsPerHour', 'extractSignatureChance',
      'extractDeepYieldMult', 'extractGearFactorFloor', 'extractMasteryYieldPerLevel',
    ] as const;
    for (const key of keys) {
      expect(ECONOMY_CONFIG_DEFAULTS[key], key).toBe(EXTRACTION_LEVER_DEFAULTS[key]);
      expect(ECONOMY_CONFIG_KEYS[key].defaultOwner, key).toContain('src/content/extraction.ts');
    }
    expect([ECONOMY_CONFIG_KEYS.extractXpRate.min, ECONOMY_CONFIG_KEYS.extractXpRate.max]).toEqual([0.7, 0.85]);
    expect([ECONOMY_CONFIG_KEYS.extractFindsPerHour.min, ECONOMY_CONFIG_KEYS.extractFindsPerHour.max]).toEqual([48, 480]);
    expect(ECONOMY_CONFIG_KEYS.extractFindsPerHour.integer).toBe(true);
    expect([ECONOMY_CONFIG_KEYS.extractSignatureChance.min, ECONOMY_CONFIG_KEYS.extractSignatureChance.max]).toEqual([0, 0.4]);
    expect([ECONOMY_CONFIG_KEYS.extractDeepYieldMult.min, ECONOMY_CONFIG_KEYS.extractDeepYieldMult.max]).toEqual([1, 2.5]);
    expect([ECONOMY_CONFIG_KEYS.extractGearFactorFloor.min, ECONOMY_CONFIG_KEYS.extractGearFactorFloor.max]).toEqual([0, 1]);
    expect([ECONOMY_CONFIG_KEYS.extractMasteryYieldPerLevel.min, ECONOMY_CONFIG_KEYS.extractMasteryYieldPerLevel.max]).toEqual([0, 0.02]);
  });
});
