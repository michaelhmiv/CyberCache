/**
 * Phase 0 Slice 1 — engine-level units for the boss-loop wiring:
 * prepared-set consumption accounting, the class mod entering the
 * sim, entry-fee math in the Chef, and dedicated-drop generation.
 * (The shipped HTTP path itself is covered by
 * bossLoopShippedPath.test.ts; the client flow by
 * bossEncounterFlow.test.tsx.)
 */
import { describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { getEligibleLegendaryEffects } from '@/constants/legendaryEffects';
import { getBossConsumableUsage, simulateBoss } from '@/lib/simulation/bossSimulator';
import { processBossAttempt } from '@/server/chef';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { ClassMod, Weapon } from '@/types/items';
import { createTickRng } from '@/lib/rng/tickRng';

function strongWeapon(): Weapon {
  return {
    id: 'server-owned-boss-gun',
    name: 'Server Owned Boss Gun',
    level: 50,
    rarity: Rarity.Legendary,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Fire,
    rollQuality: 100,
    baseDamage: 10000,
    attackSpeed: 10,
    critChance: 0.5,
    critDamage: 2,
    statusChance: 0,
    statusDamage: 0,
    bossDamageMod: 2,
    waveDamageMod: 0,
    shieldDamageMod: 1,
    armorDamageMod: 1,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 1,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
  };
}

describe('getBossConsumableUsage — policy-applied subset of the PREPARED set', () => {
  // MedKit: ifUsed · AmmoPack: onAttempt · LuckBooster: onVictory ·
  // InsuranceToken: onDefeat · DataSkimmer: onVictory
  const prepared = { MedKit: 2, AmmoPack: 1, LuckBooster: 1, InsuranceToken: 1, DataSkimmer: 3 };

  it('on a comfortable win, charges onAttempt + onVictory only', () => {
    expect(getBossConsumableUsage(prepared, true, 1.4)).toEqual({ AmmoPack: 1, LuckBooster: 1, DataSkimmer: 3 });
  });

  it('on a stressed win (survival < 1), ifUsed prep is spent too', () => {
    expect(getBossConsumableUsage(prepared, true, 0.6)).toEqual({ MedKit: 2, AmmoPack: 1, LuckBooster: 1, DataSkimmer: 3 });
  });

  it('on a loss, charges onAttempt + onDefeat + ifUsed — never the victory-only prep', () => {
    expect(getBossConsumableUsage(prepared, false, 0.4)).toEqual({ MedKit: 2, AmmoPack: 1, InsuranceToken: 1 });
  });

  it('never charges more than was prepared, and ignores unknown/zero entries', () => {
    expect(getBossConsumableUsage({ MedKit: 0, NotAConsumable: 5 }, false, 0)).toEqual({});
    const used = getBossConsumableUsage(prepared, false, 0);
    for (const [type, count] of Object.entries(used)) {
      expect(count).toBeLessThanOrEqual(prepared[type as keyof typeof prepared]);
    }
  });
});

describe('class mod in the boss sim (was a dead input)', () => {
  const boss = REGION_1_BOSSES[3]; // Ashgut — tough enough that bonuses move the needle
  const midWeapon: Weapon = { ...strongWeapon(), id: 'mid-gun', baseDamage: 60, attackSpeed: 2, critChance: 0.2, bossDamageMod: 0.2 };
  const baseInput = {
    primary: midWeapon,
    secondary: null,
    heavy: null,
    ordnance: null,
    shield: null,
    relic: null,
    consumables: {},
    risk: RiskSetting.Balanced,
    boss,
    playerLevel: 22,
    skillBonuses: {},
    pityCount: 0,
    playerCredits: 0,
  } as const;

  const classModWith = (affixes: ClassMod['affixes']): ClassMod => ({
    id: 'test-class-mod',
    name: 'Test Class Mod',
    level: 22,
    rarity: Rarity.Epic,
    treeBonus: 'Gunslinger',
    nodeBoosts: {},
    affixes,
    sourceTag: DropSource.BossDrop,
    isLocked: false,
  });

  it('bossDamageMod / weaponDamage affixes raise sim DPS and win chance', () => {
    const bare = simulateBoss({ ...baseInput, classMod: null });
    const modded = simulateBoss({
      ...baseInput,
      classMod: classModWith([
        { id: 'bossDamageMod_0', category: 'skill', stat: 'bossDamageMod', value: 0.12, displayText: '+12% Boss Damage' },
        { id: 'weaponDamage_1', category: 'skill', stat: 'weaponDamage', value: 0.1, displayText: '+10% Weapon Damage' },
      ]),
    });
    expect(modded.effectiveDPS).toBeGreaterThan(bare.effectiveDPS);
    expect(modded.winChance).toBeGreaterThan(bare.winChance);
  });

  it('survivalBoost affixes raise the survival score, mirroring the relic path', () => {
    const bare = simulateBoss({ ...baseInput, classMod: null });
    const modded = simulateBoss({
      ...baseInput,
      classMod: classModWith([{ id: 'survivalBoost_0', category: 'skill', stat: 'survivalBoost', value: 0.25, displayText: '+25% Survival' }]),
    });
    expect(modded.survivalScore).toBeCloseTo(bare.survivalScore * 1.25, 5);
  });

  it('an affix-free class mod changes nothing', () => {
    const bare = simulateBoss({ ...baseInput, classMod: null });
    const empty = simulateBoss({ ...baseInput, classMod: classModWith([]) });
    expect(empty.winChance).toBe(bare.winChance);
    expect(empty.effectiveDPS).toBe(bare.effectiveDPS);
  });
});

describe('entry fee in the Chef', () => {
  const boss = REGION_1_BOSSES[0]; // dune_tyrant, level 5 → 750 victory credits

  it('victory: the fee comes out of the net credits delta', () => {
    const free = processBossAttempt({
      playerId: 'fee-player', bossId: boss.id, attemptNonce: 42,
      primary: strongWeapon(), secondary: null, heavy: null, ordnance: null, shield: null,
      classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced,
      playerLevel: 50, skillBonuses: {}, pityCount: 0, playerCredits: 10000, entryFee: 0,
    });
    const charged = processBossAttempt({
      playerId: 'fee-player', bossId: boss.id, attemptNonce: 42,
      primary: strongWeapon(), secondary: null, heavy: null, ordnance: null, shield: null,
      classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced,
      playerLevel: 50, skillBonuses: {}, pityCount: 0, playerCredits: 10000, entryFee: 200,
    });
    expect(free.result.victory).toBe(true);
    expect(charged.entryFee).toBe(200);
    expect(charged.result.entryFee).toBe(200);
    expect(charged.creditsDelta).toBe(free.creditsDelta - 200);
    expect(charged.result.creditsGained).toBe(free.result.creditsGained - 200);
  });

  it('defeat: creditsLost itemizes death fee + entry fee', () => {
    const result = processBossAttempt({
      playerId: 'fee-player', bossId: boss.id, attemptNonce: 43,
      primary: null, secondary: null, heavy: null, ordnance: null, shield: null,
      classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced,
      playerLevel: 5, skillBonuses: {}, pityCount: 0, playerCredits: 10000, entryFee: 200,
    });
    // Tier 1 death fee: 3% of 10000 = 300. (A 2%-floor win is possible
    // in principle; this nonce is a defeat — pinned by the seeded RNG.)
    expect(result.result.victory).toBe(false);
    expect(result.result.creditsLost).toBe(300 + 200);
    expect(result.creditsDelta).toBe(-500);
  });
});

describe('dedicated drops in the generator', () => {
  it('a forced legendary effect is honored when eligible for the source/tier', () => {
    const rng = createTickRng('gen-player', 'dune_tyrant', 1);
    const weapon = generateWeapon(
      { source: DropSource.BossDrop, level: 5, bossTier: 1, forcedRarity: Rarity.Legendary, forcedLegendaryEffectId: 'debt_collector' },
      rng,
    );
    expect(weapon.rarity).toBe(Rarity.Legendary);
    expect(weapon.legendaryEffectId).toBe('debt_collector');
  });

  it('an ineligible forced effect falls back to the eligible pool', () => {
    const rng = createTickRng('gen-player', 'dune_tyrant', 2);
    const weapon = generateWeapon(
      { source: DropSource.BossDrop, level: 5, bossTier: 1, forcedRarity: Rarity.Legendary, forcedLegendaryEffectId: 'jackpot' },
      rng,
    );
    // jackpot is a tier-7 effect — it must not mint at tier 1.
    expect(weapon.legendaryEffectId).not.toBe('jackpot');
    const eligibleIds = getEligibleLegendaryEffects(DropSource.BossDrop, 1).map((eff) => eff.id);
    expect(eligibleIds).toContain(weapon.legendaryEffectId);
  });

  it('every boss dedicated drop is eligible at its own tier (data contract the Chef relies on)', () => {
    for (const boss of REGION_1_BOSSES) {
      const eligibleIds = getEligibleLegendaryEffects(DropSource.BossDrop, boss.tier).map((eff) => eff.id);
      for (const dropId of boss.dedicatedDrops) {
        expect(eligibleIds, `${boss.id} dedicated drop ${dropId}`).toContain(dropId);
      }
    }
  });
});
