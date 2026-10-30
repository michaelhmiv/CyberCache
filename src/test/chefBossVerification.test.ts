/**
 * Boss Fight Verification Tests
 *
 * Phase 4: the Chef validates boss fight results server-side before
 * recording them. These tests verify the plausibility checks.
 */

import { describe, it, expect } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { processBossAttempt } from '@/server/chef';
import { simulateBoss } from '@/lib/simulation/bossSimulator';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

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

describe('Boss fight verification', () => {
  it('produces boss outcome telemetry and loot through the Chef server contract', () => {
    const boss = REGION_1_BOSSES[0];
    const result = processBossAttempt({
      playerId: 'test-player',
      bossId: boss.id,
      attemptNonce: 123,
      primary: strongWeapon(),
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      playerLevel: 50,
      skillBonuses: {},
      pityCount: 0,
      playerCredits: 10000,
    });

    expect(result.actionType).toBe('cc_apply_boss_attempt');
    expect(result.telemetry.serverRolled).toBe(true);
    expect(result.result.victory).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.sourceTag === DropSource.BossDrop)).toBe(true);
    expect(result.result.loot).toEqual(result.items.map((item) => item.id));
  });

  // The four tests below previously asserted local arithmetic
  // (`victory && damage >= boss.health` on literals) without touching
  // the system under test. They now exercise the real sim/Chef.

  it('gives an empty loadout almost no chance against the tutorial boss', () => {
    const boss = REGION_1_BOSSES[0]; // Dune Tyrant, 800 HP
    const sim = simulateBoss({
      primary: null,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: 5,
      skillBonuses: {},
      pityCount: 0,
      playerCredits: 0,
    });
    // No weapon → dpsScore ≈ 30 / (800 / 1) → winChance at the floor.
    expect(sim.effectiveDPS).toBe(0);
    expect(sim.winChance).toBeLessThanOrEqual(0.05);
  });

  it('gives the fixture loadout a decisive chance against the tutorial boss', () => {
    const boss = REGION_1_BOSSES[0];
    const sim = simulateBoss({
      primary: strongWeapon(),
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: 50,
      skillBonuses: {},
      pityCount: 0,
      playerCredits: 10000,
    });
    expect(sim.winChance).toBeGreaterThanOrEqual(0.9);
    expect(sim.timeToKill).toBeLessThan(30);
  });

  it('time-to-kill tracks real loadout damage output', () => {
    const boss = REGION_1_BOSSES[0];
    const weak: Weapon = { ...strongWeapon(), id: 'weak-gun', baseDamage: 5, attackSpeed: 1, critChance: 0, bossDamageMod: 0 };
    const base = {
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: 50,
      skillBonuses: {},
      pityCount: 0,
      playerCredits: 10000,
    } as const;
    const strongSim = simulateBoss({ ...base, primary: strongWeapon() });
    const weakSim = simulateBoss({ ...base, primary: weak });
    expect(strongSim.effectiveDPS).toBeGreaterThan(weakSim.effectiveDPS);
    expect(strongSim.timeToKill).toBeLessThan(weakSim.timeToKill);
    // The weak gun cannot kill 800 HP inside the 30s window.
    expect(weakSim.dpsScore).toBeLessThan(1);
  });

  it('the same loadout fares worse against Scrap Bishop than the tutorial boss', () => {
    const base = {
      primary: strongWeapon(),
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      playerLevel: 50,
      skillBonuses: {},
      pityCount: 0,
      playerCredits: 10000,
    } as const;
    const tutorial = simulateBoss({ ...base, boss: REGION_1_BOSSES[0] });
    const bishop = simulateBoss({ ...base, boss: REGION_1_BOSSES[6] }); // 10000 HP + shield/armor gates
    // Survival alone caps the Bishop attempt: 2500 HP vs 180 DPS x 30s.
    expect(bishop.survivalScore).toBeLessThan(tutorial.survivalScore);
    expect(bishop.winChance).toBeLessThan(tutorial.winChance);
  });

  it('tutorial boss has 0 entry cost', () => {
    const duneTyrant = REGION_1_BOSSES[0];
    expect(duneTyrant.entryCost).toBe(0);
  });
});
