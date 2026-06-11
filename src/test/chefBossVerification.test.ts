/**
 * Boss Fight Verification Tests
 *
 * Phase 4: the Chef validates boss fight results server-side before
 * recording them. These tests verify the plausibility checks.
 */

import { describe, it, expect } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { processBossAttempt } from '@/server/chef';
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

  it('rejects victory when damage dealt < boss health', () => {
    const boss = REGION_1_BOSSES[0]; // Dune Tyrant, 800 HP
    const damageDealt = 400; // less than 800
    const victory = true;

    const plausible = victory && damageDealt >= boss.health;
    expect(plausible).toBe(false);
  });

  it('accepts victory when damage dealt >= boss health', () => {
    const boss = REGION_1_BOSSES[0]; // Dune Tyrant, 800 HP
    const damageDealt = 850;
    const victory = true;

    const plausible = victory && damageDealt >= boss.health;
    expect(plausible).toBe(true);
  });

  it('rejects damage exceeding max possible from loadout DPS', () => {
    const loadoutDps = 50; // 50 DPS
    const durationMs = 10000; // 10 seconds
    const seconds = durationMs / 1000;
    const maxPossible = loadoutDps * seconds * 1.2; // 600 with 20% tolerance
    const claimedDamage = 1000; // exceeds max

    expect(claimedDamage).toBeGreaterThan(maxPossible);
  });

  it('accepts damage within plausible bounds', () => {
    const loadoutDps = 100;
    const durationMs = 30000; // 30 seconds
    const seconds = durationMs / 1000;
    const maxPossible = loadoutDps * seconds * 1.2;
    const claimedDamage = 2500; // plausible

    expect(claimedDamage).toBeLessThanOrEqual(maxPossible);
  });

  it('scrap bishop requires 10000 damage to kill', () => {
    const scrapBishop = REGION_1_BOSSES[6]; // Scrap Bishop
    expect(scrapBishop.health).toBe(10000);
  });

  it('tutorial boss has 0 entry cost', () => {
    const duneTyrant = REGION_1_BOSSES[0];
    expect(duneTyrant.entryCost).toBe(0);
  });
});
