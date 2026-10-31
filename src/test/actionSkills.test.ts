/**
 * Action skills (migration 0030) — one signature charged ability per
 * skill tree, fired inside boss attempts and endless encounters, plus
 * the Fixer's workshop fire (Overclock, Fixer brief §3.7).
 *
 * Laws under test:
 *  - UNLOCK: the signature set derives SERVER-SIDE from skill spends
 *    + the equipped class mod (keystone ownership at effective
 *    points >= 1) — the #222/#225 derivation. A client-supplied tree
 *    is never trusted; forged tree/charge claims get honest results.
 *  - SELECTION: one active signature, server-recorded, changeable
 *    where respec happens; a selection whose keystone is respecced
 *    away stops resolving (and stops firing).
 *  - CHARGE: one pool, 0..100. Boss attempts accrue the boss rate,
 *    endless encounters the endless rate (carrying across encounters
 *    inside a run, resetting at run end); Fixer-selected players also
 *    accrue from craft units completed and repair points restored.
 *    Firing validates charge >= full inside the SAME server-owned
 *    resolution and zeroes the pool; a nonce replay never
 *    double-fires.
 *  - EFFECTS: Gunslinger burst = flat damage through the sim's
 *    netBossHp + burst-exposure fold; Demolition saturation = flat
 *    damage + break bonuses + the stagger term (no parallel combat
 *    math); Scavenger surge = extra rolls through the shipped drop
 *    pipeline only (never the dedicated roll, legendary odds bounded
 *    by a hard-clamped lever); Fixer combat fire reads prepared
 *    consumables at quality x1.25 (lever).
 *  - BALANCE (measured, generator par builds, bosses within +/-6
 *    levels, seeds 1-6): Deadeye Salvo cuts TTK 12.5-15.1% at every
 *    tier and moves winChance +0.00..+0.06 median (max +0.11) via
 *    the survival leg; Saturation Strike moves winChance +0.10
 *    median on strong builds and +0.24..+0.52 on under-geared
 *    builds, max +0.57, concentrated on break-gated fights. The band
 *    asserted here: never worse, single-fire delta <= +0.65, a
 *    hopeless fight (no weapons) stays at the 0.02 floor.
 *  - FIXER WORKSHOP FIRE: one pool, its own server op; completes
 *    exactly the in-progress unit on every active bench THROUGH the
 *    normal settler (same outputs/quality/XP — buys time, never
 *    output), and refuses (without spending) when nothing is in
 *    progress.
 *  - INTEL LAW: state/prep payloads carry the player's OWN signature
 *    state only — a recursive key-walk finds no odds/readiness keys.
 *  - ECONOMY: fires are metered per tree per day (in-memory twin
 *    here; SQL fold pinned textually); firing moves no currency.
 *
 * The SQL is exercised against real Postgres in the slice harness;
 * its lever keys and fold shapes are pinned textually below.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Rarity, RiskSetting, SkillTreeType } from '@/types/game';
import {
  ACTION_SKILL_CHARGE_MAX,
  ACTION_SKILL_DEFS,
  ACTION_SKILL_LEVER_CLAMPS,
  ACTION_SKILL_LEVER_DEFAULTS,
  ACTION_SKILL_TREES,
  NO_KEYSTONE_NOTE,
  accrueActionSkillCharge,
  actionSkillStateView,
  buildActionSkillFirePlan,
  qualifiedActionSkillTrees,
  resolveActionSkill,
  resolveActionSkillLevers,
  scaleConsumableQuality,
  surgeRarityWeights,
} from '@/content/actionSkills';
import { simulateBoss } from '@/lib/simulation/bossSimulator';
import { ECONOMY_CONFIG_DEFAULTS, ECONOMY_CONFIG_KEYS, validateEconomyConfigValue } from '../server/economy/config';
import { createTickRng } from '@/lib/rng/tickRng';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { generateShield } from '../server/lib/generators/shieldGenerator';
import { generateClassMod } from '../server/lib/generators/classModGenerator';
import { generateOrdnance } from '../server/lib/generators/ordnanceGenerator';
import { generateRelic } from '../server/lib/generators/relicGenerator';
import { processBossAttempt, type BossAttemptRequest } from '../server/chef';
import { mountActionSkillRoutes, mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type ProfileRowData } from '../server/writes/store';
import { InMemoryEconomyStore } from '../server/economy/memory';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------------------
// 1. Content: defs, qualification, plans, charge math
// ---------------------------------------------------------------------------

describe('action skill content', () => {
  it('defines exactly one signature per tree, keyed to its keystone', () => {
    expect(ACTION_SKILL_TREES).toHaveLength(4);
    for (const tree of ACTION_SKILL_TREES) {
      const def = ACTION_SKILL_DEFS[tree];
      expect(def.tree).toBe(tree);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.summary.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
    expect(ACTION_SKILL_DEFS[SkillTreeType.Gunslinger].keystoneNodeId).toBe('gs_keystone');
    expect(ACTION_SKILL_DEFS[SkillTreeType.Demolition].keystoneNodeId).toBe('demo_keystone');
    expect(ACTION_SKILL_DEFS[SkillTreeType.Scavenger].keystoneNodeId).toBe('scav_keystone');
    expect(ACTION_SKILL_DEFS[SkillTreeType.Fixer].keystoneNodeId).toBe('fix_keystone');
    expect(ACTION_SKILL_DEFS[SkillTreeType.Fixer].name).toBe('Overclock');
  });

  it('qualification derives from keystone ownership in server spends', () => {
    expect(qualifiedActionSkillTrees({})).toEqual([]);
    expect(qualifiedActionSkillTrees({ gs_keystone: 1 })).toEqual([SkillTreeType.Gunslinger]);
    expect(qualifiedActionSkillTrees({ gs_keystone: 1, fix_keystone: 1 })).toEqual([
      SkillTreeType.Gunslinger,
      SkillTreeType.Fixer,
    ]);
    // Points in non-keystone nodes never qualify.
    expect(qualifiedActionSkillTrees({ gs_major_1: 1, demo_major_2: 1 })).toEqual([]);
  });

  it('qualification counts class-mod boosts (nodeBoosts and treeBonus), like #222/#225', () => {
    // A mod boosting the keystone node qualifies with zero spends.
    expect(
      qualifiedActionSkillTrees({}, { nodeBoosts: { demo_keystone: 1 } }),
    ).toEqual([SkillTreeType.Demolition]);
    // A mod whose treeBonus matches the tree grants +1 to its keystone.
    expect(
      qualifiedActionSkillTrees({}, { nodeBoosts: {}, treeBonus: 'Scavenger' }),
    ).toEqual([SkillTreeType.Scavenger]);
    // A mod for another tree does not leak across trees.
    expect(
      qualifiedActionSkillTrees({}, { nodeBoosts: {}, treeBonus: 'Gunslinger' }),
    ).toEqual([SkillTreeType.Gunslinger]);
  });

  it('selection resolves only while qualified; respec-away stops it resolving', () => {
    const spent = { gs_keystone: 1 };
    expect(resolveActionSkill(spent, { nodeBoosts: {} }, 'Gunslinger').selected).toBe(
      SkillTreeType.Gunslinger,
    );
    // Recorded selection for a tree never qualified: no selection.
    expect(resolveActionSkill(spent, { nodeBoosts: {} }, 'Fixer').selected).toBeNull();
    // After a respec removes the keystone, the stored selection is inert.
    expect(resolveActionSkill({}, { nodeBoosts: {} }, 'Gunslinger').selected).toBeNull();
    // Garbage selections never resolve.
    expect(resolveActionSkill(spent, { nodeBoosts: {} }, 'Wizard').selected).toBeNull();
    expect(resolveActionSkill(spent, { nodeBoosts: {} }, null).selected).toBeNull();
  });

  it('charge accrual is capped at the pool max and ignores junk amounts', () => {
    expect(accrueActionSkillCharge(0, 34)).toBe(34);
    expect(accrueActionSkillCharge(66, 34)).toBe(100);
    expect(accrueActionSkillCharge(99, 34)).toBe(100);
    expect(accrueActionSkillCharge(100, 34)).toBe(100);
    expect(accrueActionSkillCharge(50, -10)).toBe(50);
    expect(accrueActionSkillCharge(50, Number.NaN)).toBe(50);
    expect(ACTION_SKILL_CHARGE_MAX).toBe(100);
  });

  it('fire plans carry the levered magnitudes per tree', () => {
    const target = { health: 20000, shield: 6000, armor: 3000 };
    const gs = buildActionSkillFirePlan(SkillTreeType.Gunslinger, target, ACTION_SKILL_LEVER_DEFAULTS);
    expect(gs.simEffect?.flatDamage).toBe(Math.round(0.12 * 20000));
    expect(gs.simEffect?.shieldBreakBonus).toBeUndefined();

    const demo = buildActionSkillFirePlan(SkillTreeType.Demolition, target, ACTION_SKILL_LEVER_DEFAULTS);
    expect(demo.simEffect?.flatDamage).toBe(Math.round(0.07 * 20000));
    expect(demo.simEffect?.shieldBreakBonus).toBe(Math.round(0.35 * 6000));
    expect(demo.simEffect?.armorBreakBonus).toBe(Math.round(0.35 * 3000));
    expect(demo.simEffect?.staggerUptime).toBe(0.5);
    expect(demo.simEffect?.staggerMitigation).toBe(0.3);

    const scav = buildActionSkillFirePlan(SkillTreeType.Scavenger, target, ACTION_SKILL_LEVER_DEFAULTS);
    expect(scav.simEffect).toBeUndefined();
    expect(scav.surgeRolls).toBe(2);

    const fixer = buildActionSkillFirePlan(SkillTreeType.Fixer, target, ACTION_SKILL_LEVER_DEFAULTS);
    expect(fixer.simEffect).toBeUndefined();
    expect(fixer.qualityMultiplier).toBe(1.25);
  });

  it('surge weights bend Epic/Legendary only, inside the shipped pipeline weights', () => {
    const weights = surgeRarityWeights(ACTION_SKILL_LEVER_DEFAULTS);
    // Base drop weights are 60/25/10/4/1 (Common..Legendary); the
    // surge multiplies Epic x1.5 and Legendary x2, nothing else.
    expect(weights[Rarity.Common]).toBe(60);
    expect(weights[Rarity.Uncommon]).toBe(25);
    expect(weights[Rarity.Rare]).toBe(10);
    expect(weights[Rarity.Epic]).toBe(6);
    expect(weights[Rarity.Legendary]).toBe(2);
    const total = Object.values(weights).reduce((sum, w) => sum + (w ?? 0), 0);
    expect((weights[Rarity.Legendary] ?? 0) / total).toBeLessThan(0.15);
    expect((weights[Rarity.Epic] ?? 0) / total).toBeLessThan(0.45);
  });

  it('scaleConsumableQuality multiplies prepared types by the lever', () => {
    expect(
      scaleConsumableQuality({ MedKit: 100, ShieldCell: 80 }, ['MedKit', 'ShieldCell'], 1.25),
    ).toEqual({ MedKit: 125, ShieldCell: 100 });
    // An absent quality reads as flat 100 before scaling (the shipped default).
    expect(scaleConsumableQuality({}, ['MedKit'], 1.25)).toEqual({ MedKit: 125 });
    expect(scaleConsumableQuality(undefined, [], 1.25)).toEqual({});
    expect(scaleConsumableQuality({ MedKit: 100 }, ['MedKit'], 1)).toEqual({ MedKit: 100 });
  });

  it('the state view states the no-keystone case plainly and marks charge honestly', () => {
    const none = actionSkillStateView({ spent: {}, classModBoosts: { nodeBoosts: {} }, selection: null, charge: 0 });
    expect(none.selected).toBeNull();
    expect(none.qualified).toEqual([]);
    expect(none.noKeystoneNote).toBe(NO_KEYSTONE_NOTE);
    expect(none.charged).toBe(false);

    const full = actionSkillStateView({
      spent: { fix_keystone: 1 },
      classModBoosts: { nodeBoosts: {} },
      selection: 'Fixer',
      charge: 140,
    });
    expect(full.charge).toBe(100); // clamped to the pool
    expect(full.selected).toBe(SkillTreeType.Fixer);
    expect(full.charged).toBe(true);
    expect(full.noKeystoneNote).toBeNull();
    const fixerSig = full.signatures.find((s) => s.tree === SkillTreeType.Fixer);
    expect(fixerSig?.sigil).toBe('⚒');
    expect(fixerSig?.color).toBe('#2EC4B6');
    expect(fixerSig?.selected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Levers: one registry, hard clamps, defaults in lockstep
// ---------------------------------------------------------------------------

describe('action skill levers', () => {
  it('every content lever is an economy config key with the same default and clamp', () => {
    for (const key of Object.keys(ACTION_SKILL_LEVER_DEFAULTS) as Array<keyof typeof ACTION_SKILL_LEVER_DEFAULTS>) {
      expect(ECONOMY_CONFIG_KEYS[key as string], key).toBeTruthy();
      expect(ECONOMY_CONFIG_DEFAULTS[key as string], key).toBe(ACTION_SKILL_LEVER_DEFAULTS[key]);
      const clamp = ACTION_SKILL_LEVER_CLAMPS[key];
      expect(ECONOMY_CONFIG_KEYS[key as string].min, key).toBe(clamp.min);
      expect(ECONOMY_CONFIG_KEYS[key as string].max, key).toBe(clamp.max);
    }
  });

  it('the surge legendary multiplier is hard-clamped to [1, 3] at both registries', () => {
    expect(ACTION_SKILL_LEVER_CLAMPS.scavengerSurgeLegendaryWeightMult).toEqual({ min: 1, max: 3 });
    expect(validateEconomyConfigValue('scavengerSurgeLegendaryWeightMult', 10)).toBeNull();
    expect(validateEconomyConfigValue('scavengerSurgeLegendaryWeightMult', 3)).toBe(3);
    expect(resolveActionSkillLevers({ scavengerSurgeLegendaryWeightMult: 99 }).scavengerSurgeLegendaryWeightMult).toBe(3);
    expect(resolveActionSkillLevers({ scavengerSurgeLegendaryWeightMult: 0.5 }).scavengerSurgeLegendaryWeightMult).toBe(1);
  });

  it('resolveActionSkillLevers clamps every lever and keeps defaults otherwise', () => {
    const resolved = resolveActionSkillLevers({
      gunslingerBurstBossHpShare: 5,
      actionSkillChargePerBossAttempt: -3,
      overclockQualityMultiplier: 2,
    });
    expect(resolved.gunslingerBurstBossHpShare).toBe(ACTION_SKILL_LEVER_CLAMPS.gunslingerBurstBossHpShare.max);
    expect(resolved.actionSkillChargePerBossAttempt).toBe(0);
    expect(resolved.overclockQualityMultiplier).toBe(1.5);
    expect(resolved.demolitionSaturationBreakShare).toBe(ACTION_SKILL_LEVER_DEFAULTS.demolitionSaturationBreakShare);
    // The Fixer brief's number: x1.25 inside [1.0, 1.5].
    expect(ACTION_SKILL_LEVER_DEFAULTS.overclockQualityMultiplier).toBe(1.25);
  });
});

// ---------------------------------------------------------------------------
// 3. Sim effects + the measured balance band
// ---------------------------------------------------------------------------

function parLoadout(level: number, seed: number, rarity: Rarity) {
  const rng = createTickRng('action-skill-balance', 'loadout', seed);
  return {
    primary: generateWeapon({ source: DropSource.WorldDrop, level, forcedRarity: rarity }, rng),
    secondary: generateWeapon({ source: DropSource.WorldDrop, level, forcedRarity: rarity }, rng),
    heavy: generateWeapon({ source: DropSource.WorldDrop, level, forcedRarity: rarity }, rng),
    ordnance: generateOrdnance(level, rng, { [rarity]: 1 }),
    shield: generateShield(level, rng, { [rarity]: 1 }),
    classMod: generateClassMod(level, rng, { [rarity]: 1 }),
    relic: generateRelic(level, rng, { [rarity]: 1 }),
  };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('action skill sim effects and balance band', () => {
  it('the burst and the saturation resolve inside the shipped sim, never outside it', () => {
    const boss = REGION_1_BOSSES.find((b) => b.shield > 0 && b.armor > 0) ?? REGION_1_BOSSES[0];
    const lo = parLoadout(boss.level, 7, Rarity.Epic);
    const base = { ...lo, consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: boss.level, skillBonuses: {} };
    const plain = simulateBoss(base);
    expect(plain.actionSkill).toBeUndefined();

    const demoPlan = buildActionSkillFirePlan(
      SkillTreeType.Demolition,
      { health: boss.health, shield: boss.shield, armor: boss.armor },
      ACTION_SKILL_LEVER_DEFAULTS,
    );
    const demo = simulateBoss({ ...base, actionSkill: demoPlan.simEffect });
    expect(demo.actionSkill).toEqual({ tree: 'Demolition' });
    // Saturation moves the BREAK leg — the sim's own totals.
    expect(demo.breakScore).toBeGreaterThan(plain.breakScore);
    expect(demo.winChance).toBeGreaterThanOrEqual(plain.winChance);

    const gsPlan = buildActionSkillFirePlan(
      SkillTreeType.Gunslinger,
      { health: boss.health, shield: boss.shield, armor: boss.armor },
      ACTION_SKILL_LEVER_DEFAULTS,
    );
    const gs = simulateBoss({ ...base, actionSkill: gsPlan.simEffect });
    expect(gs.actionSkill).toEqual({ tree: 'Gunslinger' });
    // The burst cuts the kill clock and the boss's total damage
    // (exposure fold) — survival score can only improve or hold.
    expect(gs.timeToKill).toBeLessThan(plain.timeToKill);
    expect(gs.survivalScore).toBeGreaterThanOrEqual(plain.survivalScore);
    expect(gs.winChance).toBeGreaterThanOrEqual(plain.winChance);
  });

  it('break bonuses are capped by the target pools (zero pools, zero bonus)', () => {
    const plan = buildActionSkillFirePlan(
      SkillTreeType.Demolition,
      { health: 10000, shield: 0, armor: 0 },
      ACTION_SKILL_LEVER_DEFAULTS,
    );
    expect(plan.simEffect?.shieldBreakBonus).toBe(0);
    expect(plan.simEffect?.armorBreakBonus).toBe(0);
  });

  it('balance band at L40/L60 (Rare par builds): never worse, TTK cut in band, single-fire delta capped', () => {
    for (const level of [40, 60]) {
      for (const tree of [SkillTreeType.Gunslinger, SkillTreeType.Demolition]) {
        const deltas: number[] = [];
        const ttkCuts: number[] = [];
        const bosses = REGION_1_BOSSES.filter((b) => Math.abs(b.level - level) <= 6);
        for (const boss of bosses) {
          for (let seed = 1; seed <= 6; seed++) {
            const lo = parLoadout(level, level * 1000 + seed, Rarity.Rare);
            const base = { ...lo, consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: level, skillBonuses: {} };
            const plain = simulateBoss(base);
            const plan = buildActionSkillFirePlan(
              tree,
              { health: boss.health, shield: boss.shield, armor: boss.armor },
              ACTION_SKILL_LEVER_DEFAULTS,
            );
            const fired = simulateBoss({ ...base, actionSkill: plan.simEffect });
            expect(fired.winChance).toBeGreaterThanOrEqual(plain.winChance - 1e-9);
            deltas.push(fired.winChance - plain.winChance);
            if (plain.timeToKill > 0) ttkCuts.push((plain.timeToKill - fired.timeToKill) / plain.timeToKill);
          }
        }
        // A single fire never swings more than the documented cap.
        expect(Math.max(...deltas)).toBeLessThanOrEqual(0.65);
        if (tree === SkillTreeType.Gunslinger) {
          // Measured: TTK cut 12.5-15.1% at every tier.
          expect(median(ttkCuts)).toBeGreaterThanOrEqual(0.08);
          expect(median(ttkCuts)).toBeLessThanOrEqual(0.25);
          expect(median(deltas)).toBeGreaterThanOrEqual(0);
        } else {
          // Measured: Demolition median +0.39..+0.42 at L40/L60 Rare.
          expect(median(deltas)).toBeGreaterThanOrEqual(0.05);
        }
      }
    }
  });

  it('a hopeless fight stays hopeless: flat damage cannot fabricate a win', () => {
    const boss = REGION_1_BOSSES[REGION_1_BOSSES.length - 1];
    const shield = generateShield(60, createTickRng('action-skill-hopeless', 'shield', 1), { [Rarity.Epic]: 1 });
    const base = {
      primary: null, secondary: null, heavy: null, ordnance: null,
      shield, classMod: null, relic: null,
      consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: 60, skillBonuses: {},
    };
    const plain = simulateBoss(base);
    for (const tree of [SkillTreeType.Gunslinger, SkillTreeType.Demolition]) {
      const plan = buildActionSkillFirePlan(
        tree,
        { health: boss.health, shield: boss.shield, armor: boss.armor },
        ACTION_SKILL_LEVER_DEFAULTS,
      );
      const fired = simulateBoss({ ...base, actionSkill: plan.simEffect });
      expect(fired.winChance).toBeLessThanOrEqual(0.05);
      expect(fired.winChance).toBeLessThanOrEqual(plain.winChance + 0.03);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. HTTP: boss accrual / fire / refusal / forgery, selection, intel law
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface Harness {
  store: InMemoryChefGameplayStore;
  writes: InMemoryWriteStore;
  base: string;
  tokenA: string;
  tokenB: string;
}

async function makeServer(
  store = new InMemoryChefGameplayStore(),
  writes = new InMemoryWriteStore(),
): Promise<Harness> {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, store, { jwtSecret: SECRET });
  mountActionSkillRoutes(app, store, writes, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return {
    store,
    writes,
    base: `http://127.0.0.1:${port}`,
    tokenA: issueAccessToken(SECRET, A, false),
    tokenB: issueAccessToken(SECRET, B, false),
  };
}

async function post(h: Harness, path: string, body: unknown, token: string): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${h.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function get(h: Harness, path: string, token: string): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${h.base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: (await res.json()) as Json };
}

const UNLOCKED = ['dune_tyrant', 'siltstalker', 'heap_guard', 'ashgut'];
function bossState() {
  return {
    attempts: {},
    unlockedBossIds: UNLOCKED,
    firstClearClaimedBossIds: [],
    consumableNeedsReview: false,
    consumableQuality: {},
    consumableBelt: [],
  };
}

function seedGear(store: InMemoryChefGameplayStore, playerId: string, level: number, seed: number) {
  const lo = parLoadout(level, seed, Rarity.Epic);
  const rows = [
    ['primary', lo.primary],
    ['secondary', lo.secondary],
    ['heavy', lo.heavy],
    ['ordnance', lo.ordnance],
    ['shield', lo.shield],
    ['classMod', lo.classMod],
    ['relic', lo.relic],
  ] as const;
  for (const [slot, item] of rows) {
    if (!item) continue;
    store.seedItem({
      id: item.id,
      owner_user_id: playerId,
      kind: slot,
      runtime_state: 'equipped',
      equipped_slot: slot,
      payload: item as unknown as Record<string, unknown>,
    });
  }
}

let nonceCounter = 0;
const nextNonce = (tag: string) => `${tag}-${++nonceCounter}-${Date.now()}`;

// verify-boss attempt nonces are numbers (the shipped route contract).
let bossNonceCounter = 0;
const nextBossNonce = () => ++bossNonceCounter;

describe('action skills over HTTP (boss attempts)', () => {
  it('a non-firing attempt accrues charge at the boss rate, capped at 100', async () => {
    const h = await makeServer();
    h.store.seedProfile({
      id: A, player_level: 40, credits: 5000,
      skill_spends: { gs_keystone: 1 },
      action_skill_charge: 66, action_skill_selection: 'Gunslinger',
      boss_state: bossState(),
    });
    seedGear(h.store, A, 40, 1);
    const res = await post(h, '/api/verify-boss', {
      bossId: 'dune_tyrant', attemptNonce: nextBossNonce(), consumables: {}, risk: 'Balanced',
    }, h.tokenA);
    expect(res.status).toBe(200);
    expect((res.json.actionSkill as Json).charge).toBe(100); // 66 + 34, capped
    expect(h.store.profiles.get(A)?.action_skill_charge).toBe(100);
  });

  it('firing spends the pool inside the attempt resolution; a replay never double-fires', async () => {
    const h = await makeServer();
    h.store.seedProfile({
      id: A, player_level: 40, credits: 5000,
      skill_spends: { gs_keystone: 1 },
      action_skill_charge: 100, action_skill_selection: 'Gunslinger',
      boss_state: bossState(),
    });
    seedGear(h.store, A, 40, 2);
    const nonce = nextBossNonce();
    const body = {
      bossId: 'dune_tyrant', attemptNonce: nonce, consumables: {}, risk: 'Balanced',
      fireActionSkill: true,
    };
    const res = await post(h, '/api/verify-boss', body, h.tokenA);
    expect(res.status).toBe(200);
    const result = res.json.result as Json;
    expect(result.actionSkill).toMatchObject({ tree: 'Gunslinger', fired: true });
    expect((res.json.actionSkill as Json).charge).toBe(0);
    expect(h.store.profiles.get(A)?.action_skill_charge).toBe(0);

    const replay = await post(h, '/api/verify-boss', body, h.tokenA);
    expect(replay.status).toBe(200);
    expect(replay.json.idempotentReplay).toBe(true);
    expect((replay.json.result as Json).actionSkill).toMatchObject({ tree: 'Gunslinger', fired: true });
    expect(h.store.profiles.get(A)?.action_skill_charge).toBe(0);
  });

  it('firing below full charge refuses BEFORE anything resolves (no fee, no attempt)', async () => {
    const h = await makeServer();
    h.store.seedProfile({
      id: A, player_level: 40, credits: 5000,
      skill_spends: { gs_keystone: 1 },
      action_skill_charge: 50, action_skill_selection: 'Gunslinger',
      boss_state: bossState(),
    });
    seedGear(h.store, A, 40, 3);
    const res = await post(h, '/api/verify-boss', {
      bossId: 'dune_tyrant', attemptNonce: nextBossNonce(), consumables: {}, risk: 'Balanced',
      fireActionSkill: true,
    }, h.tokenA);
    expect(res.status).toBe(400);
    expect(String(res.json.detail)).toMatch(/not charged/i);
    const profile = h.store.profiles.get(A)!;
    expect(profile.credits).toBe(5000);
    expect(profile.action_skill_charge).toBe(50);
    expect((profile.boss_state as Json).attempts).toEqual({});
  });

  it('forged tree/charge claims in the body are ignored — the server selection fires', async () => {
    const h = await makeServer();
    h.store.seedProfile({
      id: A, player_level: 40, credits: 5000,
      skill_spends: { gs_keystone: 1, demo_keystone: 1 },
      action_skill_charge: 100, action_skill_selection: 'Gunslinger',
      boss_state: bossState(),
    });
    seedGear(h.store, A, 40, 4);
    const res = await post(h, '/api/verify-boss', {
      bossId: 'dune_tyrant', attemptNonce: nextBossNonce(), consumables: {}, risk: 'Balanced',
      fireActionSkill: true,
      // Forgery attempts: claim Demolition, claim infinite charge.
      actionSkillTree: 'Demolition', action_skill_tree: 'Demolition', charge: 9999, actionSkillCharge: 9999,
    }, h.tokenA);
    expect(res.status).toBe(200);
    expect((res.json.result as Json).actionSkill).toMatchObject({ tree: 'Gunslinger', fired: true });
  });

  it('firing with no selection (or an unqualified one) refuses', async () => {
    const h = await makeServer();
    h.store.seedProfile({
      id: A, player_level: 40, credits: 5000,
      skill_spends: { gs_keystone: 1 },
      action_skill_charge: 100, action_skill_selection: null,
      boss_state: bossState(),
    });
    seedGear(h.store, A, 40, 5);
    const res = await post(h, '/api/verify-boss', {
      bossId: 'dune_tyrant', attemptNonce: nextBossNonce(), consumables: {}, risk: 'Balanced',
      fireActionSkill: true,
    }, h.tokenA);
    expect(res.status).toBe(400);
    expect(String(res.json.detail)).toMatch(/no active action skill/i);
  });
});

describe('action skill selection endpoints', () => {
  it('select validates qualification server-side, is nonce-idempotent, and clears with null', async () => {
    const h = await makeServer();
    h.store.seedProfile({
      id: A, player_level: 40, credits: 0,
      skill_spends: { gs_keystone: 1, fix_keystone: 1 },
      action_skill_charge: 25, action_skill_selection: null,
      boss_state: bossState(),
    });

    const bad = await post(h, '/api/action-skill/select', { tree: 'Scavenger', nonce: nextNonce('sel') }, h.tokenA);
    expect(bad.status).toBe(400);
    expect(String(bad.json.detail)).toMatch(/not qualified/i);
    expect(h.store.profiles.get(A)?.action_skill_selection).toBeNull();

    const nonce = nextNonce('sel');
    const ok = await post(h, '/api/action-skill/select', { tree: 'Fixer', nonce }, h.tokenA);
    expect(ok.status).toBe(200);
    expect((ok.json.actionSkill as Json).selected).toBe('Fixer');
    expect(h.store.profiles.get(A)?.action_skill_selection).toBe('Fixer');

    const replay = await post(h, '/api/action-skill/select', { tree: 'Fixer', nonce }, h.tokenA);
    expect(replay.status).toBe(200);
    expect(replay.json.idempotentReplay).toBe(true);

    const cleared = await post(h, '/api/action-skill/select', { tree: null, nonce: nextNonce('sel') }, h.tokenA);
    expect(cleared.status).toBe(200);
    expect((cleared.json.actionSkill as Json).selected).toBeNull();
    expect(h.store.profiles.get(A)?.action_skill_selection).toBeNull();
  });

  it('GET /api/action-skill/me returns the state view; unknown trees refuse', async () => {
    const h = await makeServer();
    h.store.seedProfile({
      id: A, player_level: 40, credits: 0,
      skill_spends: {}, action_skill_charge: 0, action_skill_selection: null,
      boss_state: bossState(),
    });
    const me = await get(h, '/api/action-skill/me', h.tokenA);
    expect(me.status).toBe(200);
    const state = me.json.actionSkill as Json;
    expect(state.selected).toBeNull();
    expect(state.noKeystoneNote).toBe(NO_KEYSTONE_NOTE);
    expect(Array.isArray(state.signatures)).toBe(true);

    const bad = await post(h, '/api/action-skill/select', { tree: 'Wizard', nonce: nextNonce('sel') }, h.tokenA);
    expect(bad.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 5. Intel law: payloads carry the player's own signature state only
// ---------------------------------------------------------------------------

const FORBIDDEN_KEY = /win|odds|chance|readiness|success/i;
function assertIntelClean(value: unknown, path = 'root'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertIntelClean(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      expect(FORBIDDEN_KEY.test(key), `${path}.${key}`).toBe(false);
      assertIntelClean(v, `${path}.${key}`);
    }
  }
}

describe('intel law', () => {
  it('action-skill payloads are clean (state, select, endless /me subtree)', async () => {
    const h = await makeServer();
    h.store.seedProfile({
      id: A, player_level: 40, credits: 100000,
      skill_spends: { gs_keystone: 1 },
      action_skill_charge: 80, action_skill_selection: 'Gunslinger',
      boss_state: bossState(),
    });
    const me = await get(h, '/api/action-skill/me', h.tokenA);
    assertIntelClean(me.json);
    const sel = await post(h, '/api/action-skill/select', { tree: 'Gunslinger', nonce: nextNonce('sel') }, h.tokenA);
    assertIntelClean(sel.json);
    const endlessMe = await get(h, '/api/endless/me', h.tokenA);
    expect(endlessMe.status).toBe(200);
    assertIntelClean((endlessMe.json as Json).actionSkill);
    expect(((endlessMe.json as Json).actionSkill as Json).charge).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// 6. Endless over HTTP: carry across encounters, fire, reset at run end
// ---------------------------------------------------------------------------

describe('action skills in endless runs', () => {
  it('charge carries across encounters, fires mid-run, and resets when the run banks', async () => {
    const h = await makeServer();
    h.store.seedProfile({
      id: A, player_level: 40, credits: 100000,
      skill_spends: { gs_keystone: 1 },
      action_skill_charge: 60, action_skill_selection: 'Gunslinger',
      boss_state: bossState(),
    });
    seedGear(h.store, A, 40, 11);

    const startRun = async () => {
      const res = await post(h, '/api/endless/start', { nonce: nextNonce('estart'), consumables: {}, risk: 'Balanced' }, h.tokenA);
      expect(res.status).toBe(200);
    };
    await startRun();

    // Invariant-driven: every victory accrues +20 (capped), death
    // resets to 0 and ends the run (restart it), until the pool is
    // full — proving carry across encounters within a run.
    let charge = 60;
    let sawCarry = false;
    for (let i = 0; i < 20 && charge < 100; i++) {
      const adv = await post(h, '/api/endless/encounter', { nonce: nextNonce('eadv') }, h.tokenA);
      if (adv.status !== 200) {
        await startRun(); // previous run ended (death) — pool was reset
        charge = 0;
        continue;
      }
      const result = adv.json.result as Json;
      const echoed = (adv.json.actionSkill as Json).charge as number;
      if (result.victory) {
        charge = Math.min(100, charge + 20);
        sawCarry = true;
      } else {
        charge = 0;
        await startRun();
      }
      expect(echoed).toBe(charge);
      expect(h.store.profiles.get(A)?.action_skill_charge).toBe(charge);
    }
    expect(sawCarry).toBe(true);
    expect(charge).toBe(100);

    // Fire mid-run: spends the pool inside the encounter resolution
    // (win or lose, the fired encounter grants no accrual).
    const fired = await post(h, '/api/endless/encounter', {
      nonce: nextNonce('eadv'), fireActionSkill: true,
    }, h.tokenA);
    expect(fired.status).toBe(200);
    expect((fired.json.result as Json).actionSkill).toMatchObject({ tree: 'Gunslinger', fired: true });
    expect((fired.json.actionSkill as Json).charge).toBe(0);
    expect(h.store.profiles.get(A)?.action_skill_charge).toBe(0);
  });

  it('banking a run resets the pool to zero', async () => {
    const h = await makeServer();
    h.store.seedProfile({
      id: A, player_level: 40, credits: 100000,
      skill_spends: { gs_keystone: 1 },
      action_skill_charge: 45, action_skill_selection: 'Gunslinger',
      boss_state: bossState(),
    });
    seedGear(h.store, A, 40, 12);
    const start = await post(h, '/api/endless/start', { nonce: nextNonce('estart'), consumables: {}, risk: 'Balanced' }, h.tokenA);
    expect(start.status).toBe(200);
    const bank = await post(h, '/api/endless/bank', { nonce: nextNonce('ebank') }, h.tokenA);
    expect(bank.status).toBe(200);
    expect((bank.json.actionSkill as Json).charge).toBe(0); // run end resets the pool
    expect(h.store.profiles.get(A)?.action_skill_charge).toBe(0);
  });

  it('death inside a run resets the pool (contained death, no roaming record)', async () => {
    const h = await makeServer();
    // A naked level-40 player loses essentially every endless
    // encounter; try a bounded set of fresh players until one dies.
    let sawDeath = false;
    for (let i = 0; i < 12 && !sawDeath; i++) {
      const pid = `33333333-3333-4333-8333-3333333333${String(i).padStart(2, '0')}`;
      const token = issueAccessToken(SECRET, pid, false);
      h.store.seedProfile({
        id: pid, player_level: 40, credits: 100000,
        skill_spends: { gs_keystone: 1 },
        action_skill_charge: 90, action_skill_selection: 'Gunslinger',
        boss_state: bossState(),
      });
      const start = await post(h, '/api/endless/start', { nonce: nextNonce('dstart'), consumables: {}, risk: 'Balanced' }, token);
      expect(start.status).toBe(200);
      const adv = await post(h, '/api/endless/encounter', { nonce: nextNonce('dadv') }, token);
      expect(adv.status).toBe(200);
      const result = adv.json.result as Json;
      if (result.victory === false) {
        sawDeath = true;
        expect((adv.json.actionSkill as Json).charge).toBe(0);
        expect(h.store.profiles.get(pid)?.action_skill_charge).toBe(0);
        const profile = h.store.profiles.get(pid)!;
        expect(profile.death_log ?? []).toHaveLength(0); // contained: no roaming death record
      }
    }
    expect(sawDeath).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Engine level: Fixer quality + Scavenger surge inside real resolutions
// ---------------------------------------------------------------------------

describe('per-tree effects inside processBossAttempt', () => {
  it('Fixer combat fire reads prepared consumables at quality x1.25', () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === 'dune_tyrant')!;
    const lo = parLoadout(40, 21, Rarity.Epic);
    const plan = buildActionSkillFirePlan(
      SkillTreeType.Fixer,
      { health: boss.health, shield: boss.shield, armor: boss.armor },
      ACTION_SKILL_LEVER_DEFAULTS,
    );
    // The route pre-scales the prepared quality map by the plan's
    // multiplier (the engine consumes the map as given).
    const scaled = scaleConsumableQuality({ MedKit: 100 }, ['MedKit'], plan.qualityMultiplier ?? 1);
    expect(scaled.MedKit).toBe(125);
    const req: BossAttemptRequest = {
      ...lo,
      playerId: B, bossId: 'dune_tyrant', attemptNonce: 4242,
      consumables: { MedKit: 1 }, consumableQuality: scaled,
      risk: RiskSetting.Balanced, playerLevel: 40, skillBonuses: {},
      actionSkillFire: plan,
    };
    const result = processBossAttempt(req);
    expect(result.result.actionSkill).toMatchObject({ tree: 'Fixer', fired: true, qualityMultiplier: 1.25 });

    // And the scaled quality is real sim input, not a label: on a
    // survival-bound build it raises the survival score.
    const weakShield = generateShield(40, createTickRng('fixer-quality', 'shield', 3), { [Rarity.Uncommon]: 1 });
    const simBase = {
      ...lo, shield: weakShield, consumables: { MedKit: 2 },
      risk: RiskSetting.Balanced, boss, playerLevel: 40, skillBonuses: {},
    };
    const plain = simulateBoss({ ...simBase, consumableQuality: { MedKit: 100 } });
    const overclocked = simulateBoss({ ...simBase, consumableQuality: { MedKit: 125 } });
    expect(overclocked.survivalScore).toBeGreaterThan(plain.survivalScore);
  });

  it('Scavenger surge appends pipeline rolls on victory and never touches the dedicated roll or credits', () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === 'dune_tyrant')!;
    const plan = buildActionSkillFirePlan(
      SkillTreeType.Scavenger,
      { health: boss.health, shield: boss.shield, armor: boss.armor },
      ACTION_SKILL_LEVER_DEFAULTS,
    );
    let victories = 0;
    for (let nonce = 1; nonce <= 60 && victories < 3; nonce++) {
      const lo = parLoadout(40, 31, Rarity.Epic);
      const req: BossAttemptRequest = {
        ...lo,
        playerId: B, bossId: 'dune_tyrant', attemptNonce: nonce,
        consumables: {}, risk: RiskSetting.Balanced, playerLevel: 40, skillBonuses: {},
        actionSkillFire: plan,
      };
      const result = processBossAttempt(req);
      expect(result.result.actionSkill).toMatchObject({ tree: 'Scavenger', fired: true, surgeRolls: 2 });
      if (result.result.victory) {
        victories++;
        // surgeLoot carries the surge items' IDs (BossAttemptResult
        // contract); resolve them against the chef result's loot.
        const surge = result.result.actionSkill?.surgeLoot ?? [];
        expect(surge).toHaveLength(2);
        for (const id of surge) {
          const item = result.loot.find((i) => i.id === id) as { weaponType?: unknown; level?: unknown } | undefined;
          expect(item).toBeDefined();
          expect(typeof item?.weaponType).toBe('string');
          expect(item?.level).toBe(boss.level);
        }
        // Surge items ride the normal loot array (stored by the applier).
        expect(result.loot.length).toBeGreaterThanOrEqual(2);
        // Firing moves no currency: the credits delta is the shipped
        // victory formula only (win credits + bounty, no fee here).
        expect(result.creditsDelta).toBeGreaterThan(0);
      } else {
        expect(result.result.actionSkill?.surgeLoot ?? []).toHaveLength(0);
      }
    }
    expect(victories).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Fixer workshop fire through the real settler (writes store level)
// ---------------------------------------------------------------------------

const T0 = new Date('2026-10-31T12:00:00.000Z').getTime();
let clockMs = T0;

function writeProfile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'fixer', display_name: null, player_level: 40, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: { ScrapAlloy: 1000, ReactiveComponents: 1000 }, essences: {}, consumables: {},
    skill_spends: { fix_keystone: 1 }, boss_state: {}, action_skill_charge: 100,
    action_skill_selection: 'Fixer',
    last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'fixer@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function makeWriteStore(profiles: ProfileRowData[]): InMemoryWriteStore {
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

async function startMedkitJob(store: InMemoryWriteStore, playerId: string, units = 2): Promise<void> {
  await store.enqueueCraftJob(playerId, nextNonce('enq'), { bench: 1, recipeId: 'recipe_medkit', units });
  await store.setActiveAction(playerId, nextNonce('act'), { activity_kind: 'crafting' });
}

describe('Overclock workshop fire (Fixer brief §3.7)', () => {
  it('completes exactly the in-progress unit through the settler — same outputs and XP, buys time only', async () => {
    const store = makeWriteStore([writeProfile({ id: A })]);
    await startMedkitJob(store, A, 2);
    clockMs += 6 * 60 * 1000; // half of unit 1 (12 min/unit): in progress, not complete
    const before = await store.getWorkshopState(A);
    const jobOf = (state: Json) =>
      (state.jobs as Array<Json & { recipeId: string }>).find((j) => j.recipeId === 'recipe_medkit')!;
    expect(jobOf(before).unitsCompleted).toBe(0);
    const xpBefore = store.seed.profiles.find((p) => p.id === A)!.player_xp;

    const fired = await store.fireOverclockWorkshop(A, nextNonce('oclock'));
    expect(fired.fired).toBe(true);
    expect((fired.completions as unknown[]).length).toBe(1); // exactly the in-progress unit

    const after = await store.getWorkshopState(A);
    const job = jobOf(after);
    expect(job.unitsCompleted).toBe(1); // exactly one unit — not the whole job
    expect(job.unitsTotal).toBe(2);
    const profile = store.seed.profiles.find((p) => p.id === A)!;
    expect(profile.consumables.MedKit).toBe(1); // the unit's normal output landed
    expect(profile.player_xp).toBeGreaterThan(xpBefore); // normal XP paid
    expect(profile.action_skill_charge).toBe(3);
  });

  it('a nonce replay does not complete a second unit; a fresh fire below full charge refuses', async () => {
    const store = makeWriteStore([writeProfile({ id: A })]);
    await startMedkitJob(store, A, 2);
    const nonce = nextNonce('oclock');
    await store.fireOverclockWorkshop(A, nonce);
    const replay = await store.fireOverclockWorkshop(A, nonce);
    // Writes-twin replay contract: the stored result returns verbatim
    // (the flag the SQL twin adds rides the HTTP layer, not this
    // store) — the property that matters is no second completion,
    // asserted via unitsCompleted below.
    expect(replay.fired).toBe(true);
    const state = await store.getWorkshopState(A);
    const job = (state.jobs as Array<Json & { recipeId: string }>).find((j) => j.recipeId === 'recipe_medkit')!;
    expect(job.unitsCompleted).toBe(1);
    await expect(store.fireOverclockWorkshop(A, nextNonce('oclock'))).rejects.toThrow(/not charged/i);
  });

  it('refuses without spending when nothing is in progress, and for non-Fixer selections', async () => {
    const store = makeWriteStore([
      writeProfile({ id: A }),
      writeProfile({ id: B, skill_spends: { gs_keystone: 1 }, action_skill_selection: 'Gunslinger' }),
    ]);
    await expect(store.fireOverclockWorkshop(A, nextNonce('oclock'))).rejects.toThrow(/no craft unit in progress/i);
    expect(store.seed.profiles.find((p) => p.id === A)!.action_skill_charge).toBe(100);

    await startMedkitJob(store, B, 1);
    await expect(store.fireOverclockWorkshop(B, nextNonce('oclock'))).rejects.toThrow(/Fixer signature/i);
    expect(store.seed.profiles.find((p) => p.id === B)!.action_skill_charge).toBe(100);
  });

  it('ordinary completions accrue charge for a Fixer-selected player at the per-unit rate', async () => {
    const store = makeWriteStore([writeProfile({ id: A, action_skill_charge: 10 })]);
    await startMedkitJob(store, A, 1);
    clockMs += 13 * 60 * 1000; // unit completes on settle
    await store.getWorkshopState(A);
    expect(store.seed.profiles.find((p) => p.id === A)!.action_skill_charge).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// 9. Economy meters: fires per tree per day (in-memory twin)
// ---------------------------------------------------------------------------

describe('action skill economy meters (in-memory twin)', () => {
  it('folds fired signatures per tree from ledger payloads; unfired rows never count', async () => {
    const day = '2026-10-31';
    const at = (time: string) => `${day}T${time}.000Z`;
    const store = new InMemoryEconomyStore({
      config: {},
      items: [],
      ledger: [
        { action_type: 'cc_apply_boss_attempt', created_at: at('01:00:00'), result_payload: { action_skill: { tree: 'Gunslinger', fired: true } } },
        { action_type: 'cc_apply_boss_attempt', created_at: at('01:05:00'), result_payload: { action_skill: { tree: 'Gunslinger', fired: false } } },
        { action_type: 'cc_apply_boss_attempt', created_at: at('02:00:00'), result_payload: {} },
        { action_type: 'cc_apply_endless_encounter', created_at: at('03:00:00'), result_payload: { action_skill: { tree: 'Demolition', fired: true } } },
        { action_type: 'cc_apply_endless_encounter', created_at: at('03:30:00'), result_payload: { action_skill: { tree: 'Scavenger', fired: true } } },
        { action_type: 'cc_fire_overclock_workshop', created_at: at('04:00:00'), result_payload: { fired: true, tree: 'Fixer' } },
      ],
    });
    const row = await store.computeMetricsForDay(day);
    expect(row.actionSkillFiresGunslinger).toBe(1);
    expect(row.actionSkillFiresDemolition).toBe(1);
    expect(row.actionSkillFiresScavenger).toBe(1);
    expect(row.actionSkillFiresFixer).toBe(1);
    // Firing moves no currency.
    expect(row.creditsMintedTotal).toBe(0);
    expect(row.creditsDestroyedTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. SQL parity pins (migration 0030)
// ---------------------------------------------------------------------------

describe('action skill SQL parity pins', () => {
  const migration = readFileSync(join(process.cwd(), 'db/migrations/0030_action_skills.sql'), 'utf8');

  it('creates the pool columns, the qualification helper, and both fire appliers', () => {
    expect(migration).toContain('action_skill_charge');
    expect(migration).toContain('action_skill_selection');
    expect(migration).toContain('cc_action_skill_qualified');
    expect(migration).toContain('cc_set_action_skill_selection');
    expect(migration).toContain('cc_fire_overclock_workshop');
    expect(migration).toContain('cc_complete_craft_unit');
    expect(migration).toContain('action_skill_fires_gunslinger');
    expect(migration).toContain('action_skill_fires_fixer');
  });

  it('the appliers read the charge rates from economy_config (live levers, not constants)', () => {
    expect(migration).toContain("cc_economy_config_number('actionSkillChargePerBossAttempt'");
    expect(migration).toContain("cc_economy_config_number('actionSkillChargePerEndlessEncounter'");
    expect(migration).toContain("cc_economy_config_number('actionSkillChargePerCraftUnit'");
    expect(migration).toContain("cc_economy_config_number('actionSkillChargePerRepairPoint'");
  });

  it('the workshop fire spends only after every refusal check, through the normal settler', () => {
    const fireStart = migration.indexOf('cc_fire_overclock_workshop');
    const spend = migration.indexOf('action_skill_charge = 0', fireStart);
    const settler = migration.indexOf('cc_complete_craft_unit(', fireStart);
    expect(spend).toBeGreaterThan(fireStart);
    expect(settler).toBeGreaterThan(spend); // spend first, then settle — checks all precede both
    expect(migration.slice(fireStart, spend)).toContain('No craft unit in progress');
    expect(migration.slice(fireStart, spend)).toContain('Action skill is not charged');
  });
});
