/**
 * Passive shield recharge (owner ruling 2026-11-10 — T1R).
 *
 * The arc: the economy tuning brief's D1 proposed SUPPRESSING a
 * shield recharge it believed existed; the T1 premise check proved
 * no engine consumed `rechargeRate` at all; the owner then ruled to
 * ADD Borderlands-style passive recharge deliberately, with the
 * suppression rule as its governing law:
 *
 *   - a tick restores rechargeRate × 3 (the 3-second tick) only when
 *     the hunter took zero damage (shield or HP) that tick;
 *   - the first damage-free tick recharges — no delay counter;
 *   - never above the equipped shield's capacity;
 *   - Shield Cell restores / Absorb procs / coolant restores are
 *     unchanged and stack beneath it.
 *
 * Determinism: the Chef resolves monster hits through
 * `computeMonsterDamageVsHunter` and `pickAreaMonster`, both of
 * which default to Math.random. Stubbing Math.random to a constant
 * pins every hit outcome in Dustwaste Frontier (weights 6/5/3/0.5):
 *   - 0.999 → the elite (accuracy 0.9) attacks and always misses;
 *   - 0.5   → the drone (attack 5, accuracy 0.9) always hits at
 *     variance exactly 1.0.
 * The event roll is silenced (eventChanceBase 0), the F3/overlap
 * fixtures' pattern, so no hazard event can add damage off-script.
 * Damage-amount assertions are written as relations between two
 * runs of the same claim (rechargeRate 25 vs 0) wherever the exact
 * per-hit number could drift with area data; the recharge amounts
 * themselves are pinned exactly — they are this slice's numbers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { processRoamingClaim, type ClaimRequest } from '../server/chef';
import {
  modelShieldRechargeForBoss,
  shieldRechargeAmount,
} from '@/lib/combat/shieldBehaviors';
import { simulateBoss, type BossSimulationInput } from '@/lib/simulation/bossSimulator';
import type { Shield } from '@/types/items';
import type { BossDef } from '@/types/boss';

const PLAYER = '22222222-2222-4222-8222-222222222222';
const AREA = 'dustwaste_frontier';

function makeShield(overrides: Partial<Shield> = {}): Shield {
  return {
    id: 'test-shield',
    name: 'Test Shield',
    level: 10,
    rarity: 'Rare',
    hp: 300,
    rechargeRate: 25, // the generator's level-10 rate: 10 + 1.5 × 10
    mitigation: 0,
    element: 'Kinetic',
    ...overrides,
  } as Shield;
}

function claimRequest(args: {
  shieldHp: number;
  ticks: number;
  rechargeRate?: number;
  consumableInventory?: Record<string, number>;
  maxTicks?: number;
}): ClaimRequest {
  return {
    playerId: PLAYER,
    areaId: AREA,
    ticks: args.ticks,
    tickCount: 1000,
    playerLevel: 10,
    equippedGear: [makeShield({ rechargeRate: args.rechargeRate ?? 25 })],
    survival: { currentHp: 1300, shieldHp: args.shieldHp, maxHp: 1300 },
    economy: { eventChanceBase: 0 },
    ...(args.maxTicks ? { maxTicks: args.maxTicks } : {}),
    ...(args.consumableInventory
      ? { consumableInventory: args.consumableInventory }
      : {}),
  } as ClaimRequest;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The rule itself (shieldBehaviors.ts — the one owner)
// ---------------------------------------------------------------------------

describe('shieldRechargeAmount — the suppression rule', () => {
  it('(a) a damage-free tick restores rate × tick seconds', () => {
    expect(
      shieldRechargeAmount({
        shieldHp: 100,
        capacity: 300,
        rechargeRate: 25,
        tookDamage: false,
        tickSeconds: 3,
      }),
    ).toBe(75);
  });

  it('(b) a tick with any damage taken restores nothing', () => {
    expect(
      shieldRechargeAmount({
        shieldHp: 100,
        capacity: 300,
        rechargeRate: 25,
        tookDamage: true,
        tickSeconds: 3,
      }),
    ).toBe(0);
  });

  it('(c) recharge never exceeds capacity', () => {
    expect(
      shieldRechargeAmount({
        shieldHp: 280,
        capacity: 300,
        rechargeRate: 25,
        tookDamage: false,
        tickSeconds: 3,
      }),
    ).toBe(20);
    expect(
      shieldRechargeAmount({
        shieldHp: 300,
        capacity: 300,
        rechargeRate: 25,
        tookDamage: false,
        tickSeconds: 3,
      }),
    ).toBe(0);
  });

  it('no shield / no rate restores nothing', () => {
    expect(
      shieldRechargeAmount({
        shieldHp: 0,
        capacity: 0,
        rechargeRate: 25,
        tookDamage: false,
        tickSeconds: 3,
      }),
    ).toBe(0);
    expect(
      shieldRechargeAmount({
        shieldHp: 100,
        capacity: 300,
        rechargeRate: 0,
        tookDamage: false,
        tickSeconds: 3,
      }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The Chef claim sim (roaming + offline-settlement engine)
// ---------------------------------------------------------------------------

describe('processRoamingClaim — passive recharge', () => {
  it('(a) damage-free ticks recharge rate × 3 per tick, up to cap', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // every attack misses
    const two = processRoamingClaim(claimRequest({ shieldHp: 100, ticks: 2 }));
    expect(two.survival.shieldHp).toBe(250); // 100 + 2 × (25 × 3)
    const four = processRoamingClaim(claimRequest({ shieldHp: 100, ticks: 4 }));
    expect(four.survival.shieldHp).toBe(300); // capped at capacity, never 400
    expect(four.survival.currentHp).toBe(1300);
  });

  it('(b) ticks where damage lands restore nothing — identical to a zero-rate shield', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // the drone always hits
    const live = processRoamingClaim(claimRequest({ shieldHp: 100, ticks: 4 }));
    const zeroRate = processRoamingClaim(
      claimRequest({ shieldHp: 100, ticks: 4, rechargeRate: 0 }),
    );
    // Damage really landed (the shield paid for every hit)…
    expect(zeroRate.survival.shieldHp).toBeLessThan(100);
    // …and the rechargeable shield ends EXACTLY where the zero-rate
    // shield ends: not one point of recharge leaked into a damage
    // tick. (The shield absorbed every hit, so HP is untouched too.)
    expect(live.survival.shieldHp).toBe(zeroRate.survival.shieldHp);
    expect(live.survival.currentHp).toBe(1300);
  });

  it('the Borderlands rhythm end-to-end: dented under fire, refilled in the quiet', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // hits land
    const dented = processRoamingClaim(claimRequest({ shieldHp: 300, ticks: 4 }));
    expect(dented.survival.shieldHp).toBeLessThan(300);
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // quiet ticks
    const refilled = processRoamingClaim({
      ...claimRequest({ shieldHp: dented.survival.shieldHp, ticks: 40 }),
      tickCount: 2000,
    });
    expect(refilled.survival.shieldHp).toBe(300); // back to full, capped
  });

  it('(d) Shield Cell behavior is unchanged: window burnout consumes it, the replacement restores', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // The cell's pre-existing claim-engine semantics (consumables.ts def,
    // untouched by this slice): a 180s resistance window (60 ticks at
    // 15% damage reduction); when the window burns out the cell is
    // consumed and the replacement's flat +120 restore lands. Run 62
    // ticks with 2 cells stocked so the burnout lands mid-run (the
    // claim's maxTicks is raised past the 20-tick foreground clamp so
    // the window can actually elapse). Per-tick hit/miss rolls are
    // seeded by tick number, so no cross-run equality is asserted —
    // suppression on damage ticks is test (b)'s job; this test pins
    // that the cell's own machinery is exactly as shipped.
    const run = (cells: number) =>
      processRoamingClaim(
        claimRequest({
          shieldHp: 300,
          ticks: 62,
          maxTicks: 100,
          rechargeRate: 25,
          consumableInventory: cells > 0 ? { ShieldCell: cells } : {},
        }),
      );
    const stocked = run(2);
    const noCell = run(0);
    // Exactly one cell burned (the second window is still running)…
    expect(stocked.consumedConsumables['ShieldCell']).toBe(1);
    // …and its restore + resistance did their pre-existing work: the
    // stocked run ends strictly above the cell-less run under the
    // identical seeded fire.
    expect(stocked.survival.shieldHp).toBeGreaterThan(noCell.survival.shieldHp);
  });

  it('claims without survival input (the offline settlement shape) never recharge', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const request = claimRequest({ shieldHp: 100, ticks: 4 });
    delete (request as { survival?: unknown }).survival;
    const result = processRoamingClaim(request);
    expect(result.survival.shieldHp).toBe(0); // unmodeled: untouched, as shipped
  });
});

// ---------------------------------------------------------------------------
// The boss sim's pooled fold (Endless rides the same sim)
// ---------------------------------------------------------------------------

describe('modelShieldRechargeForBoss — the pooled fold', () => {
  it('continuous boss damage leaves no damage-free tick: restores 0', () => {
    expect(
      modelShieldRechargeForBoss({
        capacity: 300,
        rechargeRate: 25,
        totalIncomingDamage: 3000,
        mitigation: 0,
      }),
    ).toBe(0);
    expect(
      modelShieldRechargeForBoss({
        capacity: 300,
        rechargeRate: 25,
        totalIncomingDamage: 3000,
        mitigation: 0.5,
      }),
    ).toBe(0);
  });

  it('no incoming damage means no dent to restore: 0', () => {
    expect(
      modelShieldRechargeForBoss({
        capacity: 300,
        rechargeRate: 25,
        totalIncomingDamage: 0,
        mitigation: 0,
      }),
    ).toBe(0);
  });

  it('no shield / no rate: 0', () => {
    expect(
      modelShieldRechargeForBoss({
        capacity: 0,
        rechargeRate: 25,
        totalIncomingDamage: 3000,
        mitigation: 0,
      }),
    ).toBe(0);
  });

  it('simulateBoss output is unchanged by the fold under continuous damage', () => {
    const boss: BossDef = {
      id: 'test-boss',
      name: 'Test Boss',
      tier: 1,
      level: 10,
      health: 1000,
      shield: 0,
      armor: 0,
      dps: 100,
      weaknesses: [],
      resistances: [],
      mechanic: { id: 'enrage', name: 'Enrage', description: '', checkType: 'dps' },
      tags: [],
      phases: [],
      recommendedPower: 0,
      entryCost: 0,
      rematchCost: 0,
      dropTable: [],
      dedicatedDrops: [],
    } as BossDef;
    const input = (rechargeRate: number): BossSimulationInput =>
      ({
        primary: null,
        secondary: null,
        heavy: null,
        ordnance: null,
        shield: makeShield({ rechargeRate }),
        classMod: null,
        relic: null,
        consumables: {},
        risk: 'Balanced',
        boss,
        playerLevel: 10,
        skillBonuses: {},
      }) as BossSimulationInput;
    const live = simulateBoss(input(25));
    const zeroRate = simulateBoss(input(0));
    expect(live.survivalScore).toBe(zeroRate.survivalScore);
    expect(live.winChance).toBe(zeroRate.winChance);
  });
});
