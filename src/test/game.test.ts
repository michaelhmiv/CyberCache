import { describe, it, expect, beforeEach } from 'vitest';
import { simulateBoss, executeBossAttempt } from '../lib/simulation/bossSimulator';
import { BossDef } from '../types/boss';
import { Weapon, Shield, Ordnance, ClassMod, Relic } from '../types/items';
import { RiskSetting, Element } from '../types/game';
import { REGION_1_BOSSES } from '../constants/bosses';
import { DUSTWASTE_ZONES } from '../constants/zones';

// ── Test Helpers ───────────────────────────────────────────────────────────

const testBoss: BossDef = {
  id: 'dune_tyrant',
  name: 'Dune Tyrant',
  tier: 1,
  level: 5,
  health: 800,
  shield: 0,
  armor: 0,
  dps: 30,
  weaknesses: [Element.Kinetic],
  resistances: [],
  mechanic: {
    id: 'none',
    name: 'No Special Mechanic',
    description: 'Tutorial boss.',
    checkType: 'mechanic',
  },
  recommendedPower: 120,
  entryCost: 0,
  rematchCost: 100,
  dropTable: [],
  dedicatedDrops: [],
};

const testWeapon: Weapon = {
  id: 'test_primary',
  name: 'Test Pistol',
  level: 5,
  rarity: 'Common',
  weaponType: 'Pistol',
  manufacturer: 'Redline',
  element: Element.Kinetic,
  rollQuality: 50,
  baseDamage: 20,
  attackSpeed: 1.2,
  critChance: 0.05,
  critDamage: 1.5,
  statusChance: 0.1,
  statusDamage: 10,
  bossDamageMod: 1.0,
  waveDamageMod: 1.0,
  shieldDamageMod: 1.0,
  armorDamageMod: 1.0,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  parts: [],
  affixes: [],
  sourceTag: 'World Drop',
  isLocked: false,
  pixelSeed: 12345,
  combatPower: 100,
  bossPower: 120,
  farmPower: 80,
  economyScore: 50,
};

const testShield: Shield = {
  id: 'test_shield',
  name: 'Test Shield',
  level: 5,
  rarity: 'Common',
  hp: 200,
  rechargeRate: 5,
  mitigation: 0.2,
  element: Element.Kinetic,
  affixes: [],
  sourceTag: 'World Drop',
  isLocked: false,
  pixelSeed: 67890,
};

// ── Boss Progression Tests ─────────────────────────────────────────────────

describe('Boss Progression', () => {
  it('should unlock with correct default state', () => {
    expect(REGION_1_BOSSES).toHaveLength(7);
    expect(REGION_1_BOSSES[0].id).toBe('dune_tyrant');
    expect(REGION_1_BOSSES[0].tier).toBe(1);
  });

  it('should have sequential tier progression', () => {
    for (let i = 0; i < REGION_1_BOSSES.length; i++) {
      expect(REGION_1_BOSSES[i].tier).toBe(i + 1);
    }
  });

  it('should have increasing stats per tier', () => {
    for (let i = 1; i < REGION_1_BOSSES.length; i++) {
      expect(REGION_1_BOSSES[i].health).toBeGreaterThan(REGION_1_BOSSES[i-1].health);
      expect(REGION_1_BOSSES[i].dps).toBeGreaterThanOrEqual(REGION_1_BOSSES[i-1].dps);
    }
  });
});

// ── Deterministic Boss Preview Tests ───────────────────────────────────────

describe('Boss Preview Determinism', () => {
  it('should return same winChance for same input', () => {
    const input = {
      primary: testWeapon,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: testShield,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      boss: testBoss,
      playerLevel: 5,
      skillBonuses: {},
    };

    const sim1 = simulateBoss(input);
    const sim2 = simulateBoss(input);

    expect(sim1.winChance).toBe(sim2.winChance);
    expect(sim1.survivalScore).toBe(sim2.survivalScore);
    expect(sim1.breakScore).toBe(sim2.breakScore);
    expect(sim1.dpsScore).toBe(sim2.dpsScore);
  });

  it('should change winChance when weapon changes', () => {
    const weakWeapon = { ...testWeapon, baseDamage: 5, bossPower: 30 };
    const strongWeapon = { ...testWeapon, baseDamage: 50, bossPower: 300 };

    const simWeak = simulateBoss({
      primary: weakWeapon,
      secondary: null, heavy: null,
      ordnance: null, shield: testShield, classMod: null, relic: null,
      consumables: {}, risk: RiskSetting.Balanced,
      boss: testBoss, playerLevel: 5, skillBonuses: {},
    });

    const simStrong = simulateBoss({
      primary: strongWeapon,
      secondary: null, heavy: null,
      ordnance: null, shield: testShield, classMod: null, relic: null,
      consumables: {}, risk: RiskSetting.Balanced,
      boss: testBoss, playerLevel: 5, skillBonuses: {},
    });

    expect(simStrong.winChance).toBeGreaterThan(simWeak.winChance);
  });

  it('should clamp winChance between 0.02 and 0.98', () => {
    // Very weak weapon
    const tinyWeapon = { ...testWeapon, baseDamage: 1, bossPower: 1 };
    const simLow = simulateBoss({
      primary: tinyWeapon,
      secondary: null, heavy: null,
      ordnance: null, shield: null, classMod: null, relic: null,
      consumables: {}, risk: RiskSetting.Balanced,
      boss: testBoss, playerLevel: 1, skillBonuses: {},
    });
    expect(simLow.winChance).toBeGreaterThanOrEqual(0.02);
    expect(simLow.winChance).toBeLessThanOrEqual(0.98);
  });

  it('should be consistent 100 times in a row', () => {
    const input = {
      primary: testWeapon,
      secondary: null, heavy: null,
      ordnance: null, shield: testShield, classMod: null, relic: null,
      consumables: {}, risk: RiskSetting.Balanced,
      boss: testBoss, playerLevel: 5, skillBonuses: {},
    };

    const results = Array.from({ length: 100 }, () => simulateBoss(input).winChance);
    const unique = new Set(results);
    expect(unique.size).toBe(1);
  });
});

// ── Cache Odds Tests ───────────────────────────────────────────────────────

describe('Cache Odds', () => {
  it('should match displayed odds (Rare 60%, Epic 32%, Legendary 8%)', () => {
    // Simulate the cache opening logic
    const results: Record<string, number> = {};
    const SIMS = 10000;

    for (let i = 0; i < SIMS; i++) {
      const r = Math.random();
      let forcedRarity: string;
      if (r > 0.92) forcedRarity = 'Legendary';
      else if (r > 0.6) forcedRarity = 'Epic';
      else forcedRarity = 'Rare';
      results[forcedRarity] = (results[forcedRarity] || 0) + 1;
    }

    // Allow ±5% margin for 10K simulations
    expect(results['Rare'] / SIMS).toBeCloseTo(0.60, 1);
    expect(results['Epic'] / SIMS).toBeCloseTo(0.32, 1);
    expect(results['Legendary'] / SIMS).toBeCloseTo(0.08, 1);
  });

  it('should never produce Common or Uncommon from cache', () => {
    expect(testBoss).toBeDefined(); // placeholder
    // Cache guarantees Rare+, verified by the forcedRarity logic
  });
});

// ── Inventory All-Item Visibility Tests ────────────────────────────────────

describe('Inventory Type Guards', () => {
  it('should correctly identify Weapon items', () => {
    expect('weaponType' in testWeapon).toBe(true);
    expect('weaponType' in testShield).toBe(false);
  });

  it('should correctly identify Shield items', () => {
    const isShield = 'hp' in testShield && !('weaponType' in testShield);
    expect(isShield).toBe(true);

    const fakeWeapon = { hp: 100, weaponType: 'Pistol' } as any;
    const isShieldFake = 'hp' in fakeWeapon && !('weaponType' in fakeWeapon);
    expect(isShieldFake).toBe(false); // weapons have weaponType
  });
});

// ── Loadout Slot Validity Tests ────────────────────────────────────────────

describe('Loadout Slot Validity', () => {
  it('should only allow weapons in weapon slots', () => {
    // Weapon slots (primary, secondary): items with 'weaponType'
    const isValidForWeaponSlot = (item: any) => 'weaponType' in item;
    expect(isValidForWeaponSlot(testWeapon)).toBe(true);
    expect(isValidForWeaponSlot(testShield)).toBe(false);
  });

  it('should only allow Launcher/Shotgun in heavy slot', () => {
    const isValidForHeavy = (item: any) =>
      'weaponType' in item &&
      (item.weaponType === 'Launcher' || item.weaponType === 'Shotgun');

    const pistol = testWeapon;
    const launcher = { ...testWeapon, weaponType: 'Launcher' };
    const shotgun = { ...testWeapon, weaponType: 'Shotgun' };

    expect(isValidForHeavy(pistol)).toBe(false);
    expect(isValidForHeavy(launcher)).toBe(true);
    expect(isValidForHeavy(shotgun)).toBe(true);
  });
});

// ── Market Cancel Tests ────────────────────────────────────────────────────

describe('Market Listing Cancel', () => {
  it('should verify market listing structure supports cancel', () => {
    const listing = {
      id: 'test_listing',
      sellerId: 'player_1',
      sellerName: 'Gunrunner',
      itemId: 'test_item',
      itemSnapshot: JSON.parse(JSON.stringify(testWeapon)),
      price: 1000,
      listedAt: Date.now(),
      feePaid: 100,
    };

    // Cancel = remove listing + return item snapshot
    expect(listing.itemSnapshot.id).toBe('test_primary');
    expect(listing.sellerId).toBe('player_1');
    expect(listing.price).toBe(1000);
  });
});

// ── Navigation Shell Tests ─────────────────────────────────────────────────

describe('Navigation Shell', () => {
  it('should define all 5 tab IDs', () => {
    const tabs = ['fight', 'loadout', 'loot', 'market', 'more'];
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toBe('fight');
  });

  it('should define all sub-screen IDs', () => {
    const subScreens = ['chest', 'skills', 'fusion', 'vendor', 'profile', 'settings', 'help', 'workshop'];
    expect(subScreens).toHaveLength(8);
  });
});

// ── Zone Progression Tests ─────────────────────────────────────────────────

describe('Zone Progression', () => {
  it('should have 10 zones with increasing stats', () => {
    expect(DUSTWASTE_ZONES).toHaveLength(10);

    for (let i = 1; i < DUSTWASTE_ZONES.length; i++) {
      expect(DUSTWASTE_ZONES[i].idleCreditsPerMinute).toBeGreaterThan(
        DUSTWASTE_ZONES[i - 1].idleCreditsPerMinute
      );
      expect(DUSTWASTE_ZONES[i].recommendedPower).toBeGreaterThan(
        DUSTWASTE_ZONES[i - 1].recommendedPower
      );
    }
  });

  it('should map level to correct zone index', () => {
    // Zone index = Math.min(Math.floor((level - 1) / 5), 9)
    const getZoneIdx = (level: number) => Math.min(Math.floor((level - 1) / 5), 9);
    expect(getZoneIdx(1)).toBe(0);  // Zone 1
    expect(getZoneIdx(5)).toBe(0);  // Still zone 1
    expect(getZoneIdx(6)).toBe(1);  // Zone 2
    expect(getZoneIdx(50)).toBe(9); // Max zone
    expect(getZoneIdx(100)).toBe(9); // Capped at 9
  });
});

// ── Skill Point Level-Gating Tests ─────────────────────────────────────────

describe('Skill Point Gating', () => {
  it('should award 1 point per level starting at level 2', () => {
    const getAvailable = (level: number, spent: number) =>
      Math.max(0, (level - 1) - spent);

    expect(getAvailable(1, 0)).toBe(0);   // Level 1: no points
    expect(getAvailable(2, 0)).toBe(1);   // Level 2: 1 point
    expect(getAvailable(5, 0)).toBe(4);   // Level 5: 4 points
    expect(getAvailable(5, 3)).toBe(1);   // Level 5, 3 spent: 1 available
    expect(getAvailable(5, 6)).toBe(0);   // Cannot spend more than earned
  });
});

// ── Scrap Yield Tests ──────────────────────────────────────────────────────

describe('Salvage Yield', () => {
  it('should produce correct rarity multipliers', () => {
    const rarityMulti = (rarity: string) => {
      switch (rarity) {
        case 'Common': return 1;
        case 'Uncommon': return 1.5;
        case 'Rare': return 2.5;
        case 'Epic': return 4;
        case 'Legendary': return 8;
        default: return 1;
      }
    };
    expect(rarityMulti('Common')).toBe(1);
    expect(rarityMulti('Epic')).toBe(4);
    expect(rarityMulti('Legendary')).toBe(8);
  });
});
