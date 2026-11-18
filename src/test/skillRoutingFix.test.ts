/**
 * Skill-routing fix (migration 0102) — the 2026-11-17 audit's F1–F8
 * pins. The audit found whole skill families that displayed as owned
 * but never reached gameplay: consumableEfficiency was dead in the
 * Pg store (its derivation ran with no hunter context, so it always
 * read Vesper's empty subset), Doc Sutter's base perk existed only
 * in the TS derivation, half the economy's SQL read the full
 * skill_spends map ungated, and no surface showed the rate a job
 * would actually store.
 *
 * The one law (owner-approved 2026-11-17, APPROVAL-BRIEF §2.2 +
 * the action-instant refinement): a hunter's tree effects are live
 * only while that hunter is fielded, gating applies at the action
 * instant (enqueue / sale / repair start / draw), and a job's
 * completion consumes the terms snapshotted at its enqueue.
 *
 * Coverage split, stated plainly (F7): this suite pins the behavior
 * of the TS twin end-to-end, the Pg store's derivation parameters
 * through a fake pool (the exact F1 failure shape), the fee/quote
 * derivations as pure functions, and 0102's SQL text (gates, perk
 * terms, snapshot keys). The repo carries no in-CI Postgres, so the
 * LIVE SQL behavior is asserted by the mig0102 drill on staging +
 * production before merge (drill package:
 * ~/workspace/cybercache-prep/mig0102/), the same division the
 * login-streak SQL twin ships under.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryWriteStore } from '../server/writes/memory';
import { PgWriteStore, emptyWriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { computeHunterSkillBonuses } from '@/lib/hunters/hunters';
import { effectiveCraftUnitDurationMs, type CraftRateQuote } from '@/lib/workshop/effectiveCraftTime';
import { marketFeeForSeller } from '@/lib/market/marketFee';
import { consumableEfficiencyDurationMultiplier } from '@/content/crafting';
import { SKILL_NODES } from '@/constants/skillTrees';

const T0 = Date.parse('2026-11-17T12:00:00.000Z');
let clockMs = T0;
let nonceN = 0;
const nextNonce = (p: string) => `${p}-nonce-${String(++nonceN).padStart(4, '0')}`;
const P = '11111111-1111-4111-8111-111111111111';

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 40, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: { Scrap: 100_000, BallisticParts: 100_000 }, essences: {}, consumables: {},
    skill_spends: {}, boss_state: {}, action_skill_charge: 0,
    action_skill_selection: 'Gunslinger', active_hunter_id: 'vesper',
    last_idle_claim_at: '2026-11-17T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function makeStore(profiles: ProfileRowData[]): InMemoryWriteStore {
  clockMs = T0;
  const seed = emptyWriteSeed();
  seed.profiles = profiles;
  let n = 0;
  return new InMemoryWriteStore(seed, {
    now: () => new Date(clockMs),
    rng: () => 0.5,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
}

const HUNTERS = {
  vesper: { active_hunter_id: 'vesper', action_skill_selection: 'Gunslinger' },
  silas: { active_hunter_id: 'silas', action_skill_selection: 'Demolition' },
  josie: { active_hunter_id: 'josie', action_skill_selection: 'Scavenger' },
  doc: { active_hunter_id: 'doc', action_skill_selection: 'Fixer' },
} as const;

/** Enqueue one Ammo Pack (base 600,000 ms) and read its stored rate. */
async function storedAmmoRate(
  store: InMemoryWriteStore,
  playerId: string,
): Promise<number> {
  await store.enqueueCraftJob(playerId, nextNonce('enq'), {
    bench: 1, recipeId: 'recipe_ammo_pack', units: 1,
  });
  const state = await store.getWorkshopState(playerId);
  const job = (state.jobs as Array<{ recipeId: string; unitDurationMs: number }>).find(
    (j) => j.recipeId === 'recipe_ammo_pack',
  );
  expect(job, 'the Ammo Pack job exists').toBeTruthy();
  return job!.unitDurationMs;
}

describe('F2/F3/F1-twin — the stored craft rate obeys the gating law', () => {
  it('no spends, Vesper fielded: the raw base rate', async () => {
    const store = makeStore([profile({ id: P, ...HUNTERS.vesper })]);
    expect(await storedAmmoRate(store, P)).toBe(600_000);
  });

  it("Michael's case: Doc fielded with both craft-time nodes maxed stores 7.5 min/unit", async () => {
    const store = makeStore([profile({
      id: P, ...HUNTERS.doc,
      skill_spends: { fix_craft_time_1: 5, fix_craft_time_2: 5 },
    })]);
    expect(await storedAmmoRate(store, P)).toBe(450_000);
  });

  it('F3: Doc fielded with NO Fixer spends still stores the base-perk rate (0.975×)', async () => {
    const store = makeStore([profile({ id: P, ...HUNTERS.doc })]);
    expect(await storedAmmoRate(store, P)).toBe(585_000);
  });

  it('F2: the same Fixer spends store NOTHING while Vesper is fielded', async () => {
    const store = makeStore([profile({
      id: P, ...HUNTERS.vesper,
      skill_spends: { fix_craft_time_1: 5, fix_craft_time_2: 5 },
    })]);
    expect(await storedAmmoRate(store, P)).toBe(600_000);
  });

  it('F1 twin: Scavenger efficiency maxed under Josie stores −20%', async () => {
    const store = makeStore([profile({
      id: P, ...HUNTERS.josie,
      skill_spends: { scav_cons_1: 5, scav_cons_2: 5 },
    })]);
    expect(await storedAmmoRate(store, P)).toBe(480_000);
  });

  it('F6 truth: one Demolition supply node maxed under Silas stores −4%, not −20%', async () => {
    const store = makeStore([profile({
      id: P, ...HUNTERS.silas,
      skill_spends: { demo_cons_1: 5 },
    })]);
    expect(await storedAmmoRate(store, P)).toBe(576_000);
  });

  it('F6 truth: all five Demolition supply nodes maxed reach the −20% cap', async () => {
    const store = makeStore([profile({
      id: P, ...HUNTERS.silas,
      skill_spends: { demo_cons_1: 5, demo_cons_2: 5, demo_cons_3: 5, demo_cons_4: 5, demo_cons_5: 5 },
    })]);
    expect(await storedAmmoRate(store, P)).toBe(480_000);
  });

  it('F2: Demolition spends store nothing while Josie is fielded', async () => {
    const store = makeStore([profile({
      id: P, ...HUNTERS.josie,
      skill_spends: { demo_cons_1: 5, demo_cons_2: 5, demo_cons_3: 5, demo_cons_4: 5, demo_cons_5: 5 },
    })]);
    expect(await storedAmmoRate(store, P)).toBe(600_000);
  });
});

describe('F4 — the card quote equals the stored rate', () => {
  const quoteFor = (
    spends: Record<string, number>,
    hunter: 'vesper' | 'silas' | 'josie' | 'doc',
  ): CraftRateQuote => {
    const bonuses = computeHunterSkillBonuses(spends, undefined, hunter);
    return {
      consumableEfficiency: bonuses.consumableEfficiency ?? 0,
      craftSpeedBonus: bonuses.craftSpeedBonus ?? 0,
      toolDurationMultiplier: 1,
      craftTimeScalar: 1,
    };
  };

  it('quote == stored across the state matrix', async () => {
    const cases: Array<{
      hunter: keyof typeof HUNTERS;
      spends: Record<string, number>;
    }> = [
      { hunter: 'vesper', spends: {} },
      { hunter: 'doc', spends: {} },
      { hunter: 'doc', spends: { fix_craft_time_1: 5, fix_craft_time_2: 5 } },
      { hunter: 'vesper', spends: { fix_craft_time_1: 5, fix_craft_time_2: 5 } },
      { hunter: 'josie', spends: { scav_cons_1: 5, scav_cons_2: 5 } },
      { hunter: 'silas', spends: { demo_cons_1: 5 } },
      { hunter: 'silas', spends: { demo_cons_1: 5, demo_cons_2: 5, demo_cons_3: 5, demo_cons_4: 5, demo_cons_5: 5 } },
    ];
    for (const c of cases) {
      const store = makeStore([profile({ id: P, ...HUNTERS[c.hunter], skill_spends: c.spends })]);
      const stored = await storedAmmoRate(store, P);
      expect(
        effectiveCraftUnitDurationMs(600_000, quoteFor(c.spends, c.hunter)),
        `${c.hunter} ${JSON.stringify(c.spends)}`,
      ).toBe(stored);
    }
  });
});

describe('F2 completion — a job keeps the terms snapshotted at its enqueue', () => {
  async function completedAmmoQuality(
    enqueueHunter: keyof typeof HUNTERS,
    spends: Record<string, number>,
    completeHunter?: keyof typeof HUNTERS,
  ): Promise<number> {
    const store = makeStore([profile({ id: P, ...HUNTERS[enqueueHunter], skill_spends: spends })]);
    await store.enqueueCraftJob(P, nextNonce('enq'), {
      bench: 1, recipeId: 'recipe_ammo_pack', units: 1,
    });
    if (completeHunter && completeHunter !== enqueueHunter) {
      // The write seed's profile rows carry the hunter columns as
      // extension fields (the read-side ProfileRowData predates them).
      const row = store.seed.profiles.find((p) => p.id === P)! as ProfileRowData & {
        active_hunter_id?: string; action_skill_selection?: string;
      };
      row.active_hunter_id = HUNTERS[completeHunter].active_hunter_id;
      row.action_skill_selection = HUNTERS[completeHunter].action_skill_selection;
    }
    await store.setActiveAction(P, nextNonce('act'), { activity_kind: 'crafting' });
    clockMs += 600_000 + 5_000;
    await store.getWorkshopState(P);
    const batch = store.seed.consumableBatches.find(
      (b) => b.owner_user_id === P && b.consumable_type === 'AmmoPack',
    );
    expect(batch, 'the completed Ammo Pack batch exists').toBeTruthy();
    return batch!.quality_percent;
  }

  it('quality terms priced under Doc survive completing under Vesper', async () => {
    const spends = { fix_quality_2: 5 };
    const underDoc = await completedAmmoQuality('doc', spends, 'doc');
    const underVesper = await completedAmmoQuality('doc', spends, 'vesper');
    const gatedOff = await completedAmmoQuality('vesper', spends, 'vesper');
    // The completion hunter is irrelevant — the snapshot rules.
    expect(underVesper).toBe(underDoc);
    // And the snapshot is worth real quality: enqueued gated-off, the
    // same spends buy nothing.
    expect(underDoc).toBeGreaterThan(gatedOff);
  });
});

describe('F1 — the Pg store derivation carries the hunter context (fake pool)', () => {
  function pgStoreWith(row: Record<string, unknown>): {
    eff: (id: string) => Promise<number>;
    queue: (id: string) => Promise<number>;
  } {
    const pool = {
      async query(text: string) {
        if (text.includes('public.profiles')) return { rows: [row], rowCount: 1 };
        if (text.includes('public.item_instances')) return { rows: [], rowCount: 0 };
        throw new Error(`unexpected query: ${text.slice(0, 80)}`);
      },
    };
    const store = new PgWriteStore(pool as never);
    const internals = store as unknown as {
      consumableEfficiencyBonus(id: string): Promise<number>;
      fixerQueueBonus(id: string): Promise<number>;
    };
    return {
      eff: (id) => internals.consumableEfficiencyBonus(id),
      queue: (id) => internals.fixerQueueBonus(id),
    };
  }

  it('Demolition points count while Silas is fielded (the audit pin: 0.2)', async () => {
    const { eff } = pgStoreWith({
      skill_spends: { demo_cons_1: 5 }, active_hunter_id: 'silas', action_skill_selection: 'Demolition',
    });
    expect(await eff(P)).toBeCloseTo(0.2, 10);
  });

  it('Scavenger points count while Josie is fielded (the audit pin: 0.5)', async () => {
    const { eff } = pgStoreWith({
      skill_spends: { scav_cons_1: 5 }, active_hunter_id: 'josie', action_skill_selection: 'Scavenger',
    });
    expect(await eff(P)).toBeCloseTo(0.5, 10);
  });

  it('the pre-fix failure shape: Scavenger points under Vesper read 0 — by the gate, not by accident', async () => {
    const { eff } = pgStoreWith({
      skill_spends: { scav_cons_1: 5 }, active_hunter_id: 'vesper', action_skill_selection: 'Gunslinger',
    });
    expect(await eff(P)).toBe(0);
  });

  it('the sibling site: the Fixer queue bonus resolves gated too', async () => {
    const doc = pgStoreWith({
      skill_spends: { fix_keystone: 1 }, active_hunter_id: 'doc', action_skill_selection: 'Fixer',
    });
    expect(await doc.queue(P)).toBe(1);
    const vesper = pgStoreWith({
      skill_spends: { fix_keystone: 1 }, active_hunter_id: 'vesper', action_skill_selection: 'Gunslinger',
    });
    expect(await vesper.queue(P)).toBe(0);
  });
});

describe('F5 — the market fee resolves gated everywhere', () => {
  it('Darknet Broker pays only while Josie is fielded', () => {
    const base = { price: 10_000, skillSpends: { scav_fee_1: 5 }, foundBySeller: true };
    expect(marketFeeForSeller({ ...base, sellerHunter: 'josie' }).fee).toBe(375);
    expect(marketFeeForSeller({ ...base, sellerHunter: 'vesper' }).fee).toBe(500);
  });

  it('House Brand pays only while Doc is fielded', () => {
    const base = {
      price: 10_000, skillSpends: { fix_major_3: 1 }, foundBySeller: false, craftedBySeller: true,
    };
    expect(marketFeeForSeller({ ...base, sellerHunter: 'doc' }).fee).toBe(425);
    expect(marketFeeForSeller({ ...base, sellerHunter: 'josie' }).fee).toBe(500);
  });
});

describe('F6 — the quantized formula the corrected copy promises', () => {
  it('per-point truth: a single Demolition point buys 0%; one maxed node buys 4%; the family caps at 20%', () => {
    expect(consumableEfficiencyDurationMultiplier(0.04)).toBe(1);
    expect(consumableEfficiencyDurationMultiplier(0.2)).toBeCloseTo(0.96, 10);
    expect(consumableEfficiencyDurationMultiplier(1.0)).toBeCloseTo(0.8, 10);
  });

  it('the TS node copy and the 0102 description update carry the same words', () => {
    const sql = readFileSync(join(process.cwd(), 'db/migrations/0102_skill_routing.sql'), 'utf8');
    for (const id of ['demo_cons_1', 'demo_cons_2', 'demo_cons_3', 'demo_cons_4', 'demo_cons_5']) {
      const node = SKILL_NODES.find((n) => n.id === id)!;
      expect(sql).toContain(node.description);
    }
  });
});

describe('F2/F3 — migration 0102 carries the law in SQL', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0102_skill_routing.sql'), 'utf8');
  const bodyOf = (name: string): string => {
    // Case-insensitive: the chain heads mix styles (0082 shouts its
    // CREATE OR REPLACE; the rest whisper).
    const start = sql.toLowerCase().indexOf(`create or replace function public.${name}(`);
    expect(start, `${name} is restated`).toBeGreaterThanOrEqual(0);
    const ends = [sql.indexOf('$$;', start), sql.indexOf('$function$;', start)].filter((i) => i >= 0);
    return sql.slice(start, Math.min(...ends));
  };

  it('every restated function gates its tree at the action instant', () => {
    expect(bodyOf('cc_enqueue_craft_job')).toContain("cc_profile_active_tree(p) <> 'Fixer'");
    expect(bodyOf('cc_complete_craft_unit')).toContain("cc_profile_active_tree(p) <> 'Fixer'");
    expect(bodyOf('cc_enqueue_repair_job')).toContain("cc_profile_active_tree(p) <> 'Fixer'");
    expect(bodyOf('cc_accept_repair_job')).toContain("cc_profile_active_tree(p) <> 'Fixer'");
    // The vendor's skill term is Appraiser's Eye (fix_vendor_1) — a
    // Fixer node — so the sale gates on Doc, not Josie.
    expect(bodyOf('cc_vendor_sell')).toContain("cc_profile_active_tree(p) <> 'Fixer'");
    expect(bodyOf('cc_make_item')).toContain("cc_profile_active_tree(p) <> 'Scavenger'");
  });

  it("Doc Sutter's base perk enters the SQL craft derivations", () => {
    const enq = bodyOf('cc_enqueue_craft_job');
    expect(enq).toContain("cc_profile_active_hunter(p) = 'doc'");
    expect(enq).toContain('0.025');
    const done = bodyOf('cc_complete_craft_unit');
    expect(done).toContain("cc_profile_active_hunter(p) = 'doc'");
  });

  it('the enqueue snapshots its skill terms; completion consumes the snapshot first', () => {
    const enq = bodyOf('cc_enqueue_craft_job');
    expect(enq).toContain("'skillQualityBonus'");
    expect(enq).toContain("'skillTemperBonus'");
    const done = bodyOf('cc_complete_craft_unit');
    expect(done).toContain("job.snapshot ->> 'skillQualityBonus'");
    expect(done).toContain("job.snapshot ->> 'skillTemperBonus'");
  });

  it('0075 bench-bank gates survive the enqueue restatement', () => {
    const enq = bodyOf('cc_enqueue_craft_job');
    expect(enq).toContain('bench_time_bank');
    expect(enq).toContain('18 + 3 * v_workshop_queue_bonus');
  });

  it('the migration touches no streak machinery (0101 owns it)', () => {
    expect(sql).not.toContain('login_streak');
    expect(sql).not.toContain('cc_record_login_day');
  });

  it('each restated function is defined exactly once, and no neighbor is dragged along', () => {
    // Regression pin for the assembly accident this suite caught:
    // an early 0102 draft carried 0038's cc_accept_listing, which
    // would have silently repealed 0099's seller gating on apply.
    // 0102 restates ONLY its six functions — neighbors whose chain
    // heads live elsewhere (0099's accept_listing above all) must
    // never be redefined here.
    const lower = sql.toLowerCase();
    const count = (name: string) =>
      lower.split(`create or replace function public.${name}(`).length - 1;
    for (const name of [
      'cc_enqueue_craft_job', 'cc_complete_craft_unit', 'cc_enqueue_repair_job',
      'cc_accept_repair_job', 'cc_vendor_sell', 'cc_make_item',
    ]) {
      expect(count(name), name).toBe(1);
    }
    for (const name of [
      'cc_accept_listing', 'cc_cosmetics_view', 'cc_repair_finalize_job', 'cc_apply_chef_rewards',
    ]) {
      expect(count(name), name).toBe(0);
    }
  });
});
