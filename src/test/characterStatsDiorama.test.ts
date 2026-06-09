import { describe, expect, it } from 'vitest';
import { buildCharacterStatSummary } from '../lib/stats/characterStats';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { BossDef } from '../types/boss';
import type { PlayerProfile } from '../types/player';
import type { Weapon } from '../types/items';

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'test-weapon',
    name: 'Test Gun',
    level: 50,
    rarity: Rarity.Epic,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Fire,
    rollQuality: 75,
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
    sourceTag: 'cacheKey' as DropSource,
    isLocked: false,
    pixelSeed: 12345,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    id: 'test-player',
    name: 'Test Hunter',
    level: 1,
    xp: 0,
    credits: 0,
    scrap: 0,
    cacheKeys: 0,
    cacheKeyFragments: 0,
    currentZoneId: 'dustwaste',
    highestZoneId: 'dustwaste',
    offlineCapHours: 0,
    lastClaimTime: 0,
    deathFeeInsurance: false,
    consumables: {},
    materials: {},
    essences: {},
    workshopQueues: [],
    lastWorkshopTick: 0,
    ...overrides,
  };
}

function makeBoss(weaknesses: Element[]): BossDef {
  return {
    id: 'test-boss',
    name: 'Infernal Forge',
    tier: 1,
    level: 10,
    health: 1000,
    shield: 0,
    armor: 0,
    dps: 100,
    weaknesses,
    resistances: [],
    mechanic: { id: 'enrage', name: 'Enrage', description: '', checkType: 'survival' },
    tags: [],
    phases: [],
    recommendedPower: 100,
    entryCost: 0,
    rematchCost: 0,
    dropTable: [],
    dedicatedDrops: [],
  };
}

describe('buildCharacterStatSummary — diorama DPS bugfix', () => {
  it('returns a non-zero DPS headline when at least one weapon is provided', () => {
    const player = makePlayer();
    const weapon = makeWeapon({ id: 'w1', element: Element.Fire });
    const summary = buildCharacterStatSummary({ player, weapons: [weapon], spentSkills: {} });
    const dpsMetric = summary.headline.find((metric) => metric.key === 'dps');
    expect(dpsMetric).toBeDefined();
    expect(dpsMetric!.value).toBeGreaterThan(0);
  });

  it('regression: the diorama no longer shows 0 DPS when only an inventory fallback weapon is in play (no loadout slots filled)', () => {
    // The bug was that the diorama passed loadout.getWeapon() for primary/
    // secondary/heavy. If those were all undefined, liveWeapons was empty
    // and DPS showed 0 — even though the animation was using a fallback
    // weapon. The fix unifies the two: when the caller passes a non-empty
    // weapons array, DPS must reflect it.
    const player = makePlayer();
    const weapon = makeWeapon({ id: 'w1', element: Element.Fire });
    const summary = buildCharacterStatSummary({ player, weapons: [weapon], spentSkills: {} });
    const dpsMetric = summary.headline.find((metric) => metric.key === 'dps');
    expect(dpsMetric!.value).toBeGreaterThan(0);
  });

  it('returns DPS detail "weapons + skills + affixes" when no boss is supplied', () => {
    const player = makePlayer();
    const weapon = makeWeapon({ id: 'w1' });
    const summary = buildCharacterStatSummary({ player, weapons: [weapon], spentSkills: {} });
    const dpsMetric = summary.headline.find((metric) => metric.key === 'dps');
    expect(dpsMetric!.detail).toBe('weapons + skills + affixes');
  });

  it('switches the DPS detail to "vs {boss.name} ({weakness})" when a boss is supplied', () => {
    const player = makePlayer();
    const weapon = makeWeapon({ id: 'w1', element: Element.Fire });
    const boss = makeBoss([Element.Fire]);
    const summary = buildCharacterStatSummary({ player, weapons: [weapon], spentSkills: {}, boss });
    const dpsMetric = summary.headline.find((metric) => metric.key === 'dps');
    expect(dpsMetric!.detail).toBe('vs Infernal Forge (fire)');
  });

  it('applies the boss-relative DPS when player element matches boss weakness', () => {
    const player = makePlayer();
    // Baseline weapon with neutral element: 100 * 5 * (1 + 0.2 * 1.5) = 100 * 5 * 1.3 = 650
    const fireWeapon = makeWeapon({ id: 'fire', element: Element.Fire });
    const neutralWeapon = makeWeapon({ id: 'neutral', element: Element.Kinetic });
    const boss = makeBoss([Element.Fire]);
    const fireSummary = buildCharacterStatSummary({ player, weapons: [fireWeapon], spentSkills: {}, boss });
    const neutralSummary = buildCharacterStatSummary({ player, weapons: [neutralWeapon], spentSkills: {}, boss });
    const fireDps = fireSummary.headline.find((m) => m.key === 'dps')!.value;
    const neutralDps = neutralSummary.headline.find((m) => m.key === 'dps')!.value;
    // 1.3x counter-element multiplier for matching element
    expect(fireDps / neutralDps).toBeCloseTo(1.3, 2);
  });

  it('falls back to "no weakness" detail when the boss has an empty weakness list', () => {
    const player = makePlayer();
    const weapon = makeWeapon({ id: 'w1' });
    const boss = makeBoss([]);
    const summary = buildCharacterStatSummary({ player, weapons: [weapon], spentSkills: {}, boss });
    const dpsMetric = summary.headline.find((metric) => metric.key === 'dps');
    expect(dpsMetric!.detail).toBe('vs Infernal Forge (no weakness)');
  });

  it('keeps the headline DPS the same as the standard-target total when no boss is supplied', () => {
    // Regression check: passing `boss: undefined` must produce the same
    // DPS value as the original (pre-boss-context) code path.
    const player = makePlayer();
    const weapon = makeWeapon({ id: 'w1', element: Element.Kinetic });
    const noBoss = buildCharacterStatSummary({ player, weapons: [weapon], spentSkills: {} });
    const explicitUndefined = buildCharacterStatSummary({ player, weapons: [weapon], spentSkills: {}, boss: undefined });
    expect(noBoss.headline.find((m) => m.key === 'dps')!.value).toBe(explicitUndefined.headline.find((m) => m.key === 'dps')!.value);
  });
});
