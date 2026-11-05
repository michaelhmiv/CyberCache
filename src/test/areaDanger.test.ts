/**
 * Areas without level locks (owner ruling 2026-11-02 — "warning,
 * never a wall") — the three mechanisms that replaced the gates:
 *
 *   1. `assessAreaDanger` (src/lib/combat/areaDanger): the duel math
 *      behind the picker warning. Lethal = dies before killing the
 *      baseline fodder; caution = a lethal brute/elite duel or an
 *      extreme fodder kill time; never a win-chance/readiness number
 *      (boss-intel law).
 *   2. The death-loop trickle guard in processRoamingClaim: the
 *      presence trickle (credits/scrap/XP + the per-tick loot roll)
 *      pays only after a kill since the last death. Without it, an
 *      opened top area would pay its full trickle to a hunter dying
 *      on loop — the audit's named precondition for removing G1.
 *   3. (HTTP level, in statsTruth.test.ts) the claim route serves
 *      under-level areas and offline settlement zeroes a lethal
 *      pairing instead of refusing it.
 */
import { describe, expect, it } from 'vitest';
import { getRoamingArea } from '../constants/roamingAreas';
import {
  EXTREME_KILL_TICKS,
  IMMEDIATE_DEATH_TICKS,
  assessAreaDanger,
  type AreaDangerStats,
} from '../lib/combat/areaDanger';
import { processRoamingClaim, type ClaimRequest } from '../server/chef';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';

const DUSTWASTE = getRoamingArea('dustwaste_frontier');
const HELIXWORKS = getRoamingArea('helixworks_labyrinth');

const stats = (overrides: Partial<AreaDangerStats> = {}): AreaDangerStats => ({
  effectiveDps: 5,
  maxHp: 760,
  shieldCapacity: 0,
  mitigation: 0,
  dodgeChance: 0,
  ...overrides,
});

describe('areaDanger — duel tiers from the real combat numbers', () => {
  it('a starter hunter in HelixWorks is LETHAL: dies before killing baseline fodder', () => {
    // Helix Researcher: 1400 HP / def 28 / atk 115. Starter: ~5 DPS,
    // 760 HP pool → ~8 ticks to die vs ~175 ticks to kill.
    const a = assessAreaDanger(HELIXWORKS, stats())!;
    expect(a.tier).toBe('lethal');
    expect(a.baseline.monsterId).toBe('helix_worker');
    expect(a.baseline.ticksToDie).toBeLessThanOrEqual(a.baseline.ticksToKill);
  });

  it('an unarmed hunter is lethal-matched even in the starter area (a kill is impossible)', () => {
    const a = assessAreaDanger(DUSTWASTE, stats({ effectiveDps: 0 }))!;
    expect(a.tier).toBe('lethal');
    expect(a.baseline.ticksToKill).toBe(Infinity);
  });

  it('caution names the elite when fodder is fine but the elite out-duels the hunter', () => {
    // Dustwaste: fodder 45 HP/atk 4 dies in 2 ticks and cannot kill a
    // 100 HP pool in time; the brute (80 HP/atk 6) also loses; the
    // Silt Marshal (220 HP/def 6/atk 14) kills the pool in ~8 ticks
    // while needing ~9 to drop.
    const a = assessAreaDanger(DUSTWASTE, stats({ effectiveDps: 10, maxHp: 100 }))!;
    expect(a.tier).toBe('caution');
    expect(a.threat?.kind).toBe('elite');
    expect(a.threat?.monsterId).toBe('dustwaste_elite');
    expect(a.extremeKillTime).toBe(false);
  });

  it('caution fires on an extreme fodder kill time when every duel is survivable', () => {
    const a = assessAreaDanger(DUSTWASTE, stats({ effectiveDps: 0.5, maxHp: 100_000 }))!;
    expect(a.tier).toBe('caution');
    expect(a.extremeKillTime).toBe(true);
    expect(a.threat).toBeUndefined();
    expect(a.baseline.ticksToKill).toBeGreaterThan(EXTREME_KILL_TICKS);
  });

  it('a hunter at strength sees NO warning — not in the top area, not at home', () => {
    const strong = stats({ effectiveDps: 3000, maxHp: 20_000 });
    expect(assessAreaDanger(HELIXWORKS, strong)!.tier).toBe('none');
    expect(assessAreaDanger(DUSTWASTE, strong)!.tier).toBe('none');
  });

  it('the settlement gate bound separates die-on-loop from merely outmatched', () => {
    // The offline zero-settlement fires only on lethal + immediate
    // death. Unarmed in Dustwaste: lethal by the duel (can never
    // kill) but the fodder needs ~200+ ticks to kill the hunter —
    // a legitimate state that must settle normally.
    const unarmedHome = assessAreaDanger(DUSTWASTE, stats({ effectiveDps: 0 }))!;
    expect(unarmedHome.tier).toBe('lethal');
    expect(unarmedHome.baseline.ticksToDie).toBeGreaterThan(IMMEDIATE_DEATH_TICKS);
    // Starter in HelixWorks: dead in ~8 ticks — the faucet profile.
    const starterTop = assessAreaDanger(HELIXWORKS, stats())!;
    expect(starterTop.tier).toBe('lethal');
    expect(starterTop.baseline.ticksToDie).toBeLessThanOrEqual(IMMEDIATE_DEATH_TICKS);
  });

  it('the assessment NEVER carries a win-chance or readiness figure (boss-intel law)', () => {
    const a = assessAreaDanger(HELIXWORKS, stats())!;
    const keys = Object.keys(a).join(' ') + ' ' + Object.keys(a.baseline).join(' ');
    expect(keys).not.toMatch(/chance|percent|readiness|score/i);
    expect(['none', 'caution', 'lethal']).toContain(a.tier);
  });
});

// ---------------------------------------------------------------- engine

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'test-weapon',
    name: 'Test Weapon',
    level: 10,
    rarity: Rarity.Epic,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic,
    rollQuality: 50,
    baseDamage: 100,
    attackSpeed: 5,
    critChance: 0.2,
    critDamage: 1.5,
    statusChance: 0.1,
    statusDamage: 1.0,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 0,
    armorDamageMod: 0,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    legendaryEffectId: undefined,
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 0,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

const PLAYER = '55555555-5555-4555-8555-555555555555';

function claimRequest(overrides: Partial<ClaimRequest> = {}): ClaimRequest {
  return {
    playerId: PLAYER,
    areaId: 'dustwaste_frontier',
    ticks: 50,
    tickCount: 5000,
    playerLevel: 10,
    survival: { currentHp: 100_000, maxHp: 100_000, shieldHp: 0, mitigation: 0 },
    ...overrides,
  };
}

describe('death-loop trickle guard — presence pays only after a kill since the last death', () => {
  it('a bare level-1 hunter dying on loop in HelixWorks earns only the ticks before the first death', () => {
    // Naive presence pay for 200 HelixWorks ticks would be ~210
    // credits and ~480 XP. The hunter dies inside ~8 ticks (atk 115+
    // vs a 760 pool), the death disarms the trickle, and the
    // remaining ~190 ticks pay nothing.
    const result = processRoamingClaim(claimRequest({
      areaId: 'helixworks_labyrinth',
      playerLevel: 1,
      ticks: 200,
      equippedGear: [],
      survival: { currentHp: 760, maxHp: 760, shieldHp: 0, mitigation: 0 },
    }));
    expect(result.survival.isDead).toBe(true);
    expect(result.survival.trickleArmed).toBe(false);
    expect(result.rewards.creditsAwarded).toBeLessThan(15);
    expect(result.rewards.xpAwarded).toBeLessThan(60);
  });

  it('entering a claim already dead pays exactly zero, even armed with a strong weapon', () => {
    // eventChanceBase 0 isolates the trickle contract: roaming EVENTS
    // are a separate, deliberately ungated faucet (the engine's own
    // documented call — death gates the kill cycle, not the event
    // roll, and offline settlement has no survival input to gate
    // with). What the death-loop guard owns is the per-tick trickle
    // and loot roll, and those pay exactly zero here.
    const result = processRoamingClaim(claimRequest({
      equippedGear: [makeWeapon()],
      economy: { eventChanceBase: 0 },
      survival: { currentHp: 0, maxHp: 100_000, shieldHp: 0, mitigation: 0 },
    }));
    expect(result.survival.isDead).toBe(true);
    expect(result.survival.trickleArmed).toBe(false);
    expect(result.rewards.creditsAwarded).toBe(0);
    expect(result.rewards.scrapAwarded).toBe(0);
    expect(result.rewards.xpAwarded).toBe(0);
    // (0082: the fragment field is abolished — whole keys are the
    // claim's cache currency now, and a dead claim pays none.)
    expect(result.rewards.cacheKeysAwarded).toBe(0);
    expect(result.rewards.materials).toEqual({});
    expect(result.items).toEqual([]);
  });

  it('a disarmed hunter who cannot kill earns nothing until a kill re-arms', () => {
    // Alive, disarmed (died last claim), unarmed: no kill is possible
    // at 0 DPS, so 50 ticks of pure presence pay zero (event faucet
    // zeroed via the lever, per the dead-entry test's note).
    const result = processRoamingClaim(claimRequest({
      equippedGear: [],
      economy: { eventChanceBase: 0 },
      survival: { currentHp: 100_000, maxHp: 100_000, shieldHp: 0, mitigation: 0, trickleArmed: false },
    }));
    expect(result.survival.isDead).toBe(false);
    expect(result.survival.trickleArmed).toBe(false);
    expect(result.rewards.creditsAwarded).toBe(0);
    expect(result.rewards.scrapAwarded).toBe(0);
    expect(result.rewards.xpAwarded).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('the first kill re-arms the trickle and earnings resume', () => {
    const result = processRoamingClaim(claimRequest({
      equippedGear: [makeWeapon()],
      survival: { currentHp: 100_000, maxHp: 100_000, shieldHp: 0, mitigation: 0, trickleArmed: false },
    }));
    expect(result.killCycle.totalKills).toBeGreaterThan(0);
    expect(result.survival.trickleArmed).toBe(true);
    expect(result.rewards.creditsAwarded).toBeGreaterThan(0);
  });

  it('a claim with NO survival block is not a dead hunter: it pays exactly as before the guard', () => {
    // Legacy routes and internal callers claim without survival
    // state; survHp defaults to 0 there, which is an absent input,
    // not a corpse. The guard reads death only from a modeled
    // survival state — this is the pre-guard Dustwaste baseline
    // (20 ticks × 0.75 cr = 15, the economyFractional pin).
    const req = claimRequest({ ticks: 20, survival: undefined, economy: { eventChanceBase: 0 } });
    const result = processRoamingClaim(req);
    expect(result.rewards.creditsAwarded).toBe(15);
    expect(result.rewards.creditsRemainder).toBe(0);
    expect(result.survival.trickleArmed).toBe(true);
  });

  it('normal play is untouched: an armed hunter\'s claim is bit-identical across runs', () => {
    const req = claimRequest({ equippedGear: [makeWeapon()], ticks: 100 });
    const a = processRoamingClaim(req);
    const b = processRoamingClaim(req);
    expect(b.rewards).toEqual(a.rewards);
    expect(b.items.length).toBe(a.items.length);
    expect(b.survival.trickleArmed).toBe(true);
    expect(a.rewards.creditsAwarded).toBeGreaterThan(0);
  });
});
