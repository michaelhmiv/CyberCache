/**
 * Hero rundown — builder pins (Home consolidation, owner steers
 * 2026-11-03).
 *
 * The rundown replaced the stage ribbon's ~15-entry stats-band
 * scroller with four tappable heroes: DPS · Dmg/tick · Crit · HP.
 * The pins carry the numbers-emphasis law across the move: the
 * EFFECTIVE value is the hero, the delta vs base rides beside it
 * (green gains, red losses), unmodified stats print plain, and
 * crit — which has no base→effective derivation in the math —
 * never invents one.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCritMetric,
  buildHeroRundown,
  pooledCrit,
  stageStatDelta,
  type HeroRundownInput,
} from '../lib/stats/heroRundown';
import type { CharacterStatSummary, StatMetric, StatTone } from '../lib/stats/characterStats';
import type { CharacterMechanicsSnapshot } from '../lib/mechanics/buildCharacterMechanicsSnapshot';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '../types/game';
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

const metric = (key: string, value: number, display: string, tone: StatTone = 'red'): StatMetric => ({
  key,
  label: key,
  value,
  display,
  detail: '',
  tone,
  contributions: [],
});

const summaryOf = (metrics: StatMetric[]): CharacterStatSummary =>
  ({ headline: [], all: metrics }) as unknown as CharacterStatSummary;

const scalar = (value: number) => ({ value, contributions: [] });
const snapshotOf = (over: Partial<Record<'standardWeaponDps' | 'bossRelativeDps' | 'mitigation', number>> = {}): CharacterMechanicsSnapshot =>
  ({
    standardWeaponDps: scalar(over.standardWeaponDps ?? 0),
    bossRelativeDps: scalar(over.bossRelativeDps ?? 0),
    mitigation: scalar(over.mitigation ?? 0),
  }) as unknown as CharacterMechanicsSnapshot;

function baseInput(over: Partial<HeroRundownInput> = {}): HeroRundownInput {
  return {
    summary: summaryOf([metric('dps', 595, '595')]),
    snapshot: snapshotOf({ standardWeaponDps: 504 }),
    weapons: [makeWeapon()],
    survival: { currentHp: 812, maxHp: 1040, shieldHp: 260, isDead: false },
    bossContext: false,
    ...over,
  };
}

describe('stageStatDelta (carried verbatim from the band)', () => {
  it('prints a signed whole percent for large moves, one decimal for small', () => {
    expect(stageStatDelta(100, 150)).toEqual({ display: '+50%', tone: 'green' });
    expect(stageStatDelta(100, 104.2)).toEqual({ display: '+4.2%', tone: 'green' });
    expect(stageStatDelta(200, 100)).toEqual({ display: '-50%', tone: 'red' });
  });

  it('is null for no base, no change, or a sub-printable change', () => {
    expect(stageStatDelta(0, 100)).toBeNull();
    expect(stageStatDelta(100, 100)).toBeNull();
    expect(stageStatDelta(100, 100.04)).toBeNull();
  });
});

describe('buildHeroRundown — the four heroes', () => {
  it('DPS is the effective value with its gain delta beside it; Dmg/tick mirrors it at ×3s', () => {
    const model = buildHeroRundown(baseInput());
    expect(model.unarmed).toBe(false);
    expect(model.dps).toMatchObject({ label: 'DPS', display: '595' });
    expect(model.dps?.delta).toEqual({ display: '+18%', tone: 'green' });
    expect(model.dmgTick?.display).toBe('1,785');
    expect(model.dmgTick?.delta).toEqual({ display: '+18%', tone: 'green' });
  });

  it('an unmodified DPS prints plain — no delta', () => {
    const model = buildHeroRundown(baseInput({
      summary: summaryOf([metric('dps', 504, '504')]),
    }));
    expect(model.dps?.display).toBe('504');
    expect(model.dps?.delta).toBeUndefined();
    expect(model.dmgTick?.delta).toBeUndefined();
  });

  it('a debuffed DPS carries a red loss delta', () => {
    const model = buildHeroRundown(baseInput({
      summary: summaryOf([metric('dps', 400, '400')]),
    }));
    expect(model.dps?.delta).toEqual({ display: '-21%', tone: 'red' });
  });

  it('boss context reads Eff. DPS and deltas against the boss-relative pool', () => {
    const model = buildHeroRundown(baseInput({
      bossContext: true,
      snapshot: snapshotOf({ standardWeaponDps: 504, bossRelativeDps: 700 }),
      summary: summaryOf([metric('dps', 595, '595')]),
    }));
    expect(model.dps?.label).toBe('Eff. DPS');
    expect(model.dps?.delta).toEqual({ display: '-15%', tone: 'red' });
  });

  it('Crit pools across weapons and prints plain — no invented delta', () => {
    const model = buildHeroRundown(baseInput());
    expect(model.crit?.display).toBe('20% · ×2.5');
    expect(model.crit?.delta).toBeUndefined();
  });

  it('HP prints current/max with the shield + mitigation microline and fraction tone', () => {
    const model = buildHeroRundown(baseInput({
      snapshot: snapshotOf({ standardWeaponDps: 504, mitigation: 0.08 }),
    }));
    expect(model.hp.display).toBe('812/1,040');
    expect(model.hp.microline).toBe('Shield 260 · Mit 8%');
    expect(model.hp.tone).toBe('green');
    expect(model.hp.fraction).toBeCloseTo(812 / 1040);
  });

  it('HP tone follows the fraction: amber under 60%, red under 30%, dead prints Dead', () => {
    expect(buildHeroRundown(baseInput({ survival: { currentHp: 500, maxHp: 1040, shieldHp: 0, isDead: false } })).hp.tone).toBe('amber');
    expect(buildHeroRundown(baseInput({ survival: { currentHp: 200, maxHp: 1040, shieldHp: 0, isDead: false } })).hp.tone).toBe('red');
    const dead = buildHeroRundown(baseInput({ survival: { currentHp: 0, maxHp: 1040, shieldHp: 0, isDead: true } }));
    expect(dead.hp.display).toContain('Dead');
    expect(dead.hp.microline).toBeNull();
  });

  it('unarmed: no combat cells, HP still reads', () => {
    const model = buildHeroRundown(baseInput({ weapons: [] }));
    expect(model.unarmed).toBe(true);
    expect(model.dps).toBeNull();
    expect(model.dmgTick).toBeNull();
    expect(model.crit).toBeNull();
    expect(model.hp.display).toBe('812/1,040');
  });
});

describe('pooledCrit + buildCritMetric — the Crit sheet', () => {
  it('pools by standard-DPS weight, not a flat average', () => {
    const heavy = makeWeapon({ id: 'heavy', baseDamage: 300, attackSpeed: 5, critChance: 0.1, critDamage: 1.0 });
    const light = makeWeapon({ id: 'light', baseDamage: 100, attackSpeed: 5, critChance: 0.4, critDamage: 2.0 });
    const pool = pooledCrit([heavy, light]);
    expect(pool).not.toBeNull();
    // Standard DPS ∝ baseDamage × attackSpeed here (equal speeds):
    // weights 3:1 → chance (3×0.1 + 1×0.4)/4 = 0.175.
    expect(pool?.chance).toBeCloseTo(0.175);
    expect(pool?.damage).toBeCloseTo((3 * 1.0 + 1 * 2.0) / 4);
  });

  it('the sheet metric carries one weapon-bucket row per equipped weapon', () => {
    const critMetric = buildCritMetric([makeWeapon({ name: 'Widowmaker', critChance: 0.25, critDamage: 1.2 })]);
    expect(critMetric?.key).toBe('crit');
    expect(critMetric?.display).toBe('25% · ×2.2');
    expect(critMetric?.contributions).toHaveLength(1);
    expect(critMetric?.contributions[0]).toMatchObject({ source: 'Widowmaker', bucket: 'weapon', display: '25% · ×2.2' });
  });

  it('no weapons → no crit metric', () => {
    expect(buildCritMetric([])).toBeNull();
    expect(pooledCrit([])).toBeNull();
  });
});
