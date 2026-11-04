/**
 * Hero rundown — builder pins (Home consolidation, owner steers
 * 2026-11-03; two-row stack + percentage deltas, owner device
 * review 2026-11-03).
 *
 * The rundown replaced the stage ribbon's ~15-entry stats-band
 * scroller with tappable heroes, stacked two rows of four:
 * DPS · Dmg/tick · Crit % · Crit × over HP · Shield · Mit ·
 * Shield Break. The pins carry the numbers-emphasis law across
 * the move: the EFFECTIVE value is the hero; where the model
 * carries a true base→effective pair (DPS, HP) the delta rides
 * beside it AS A PERCENTAGE OF BASE (green gains, red losses),
 * derived from the same pair the breakdown sheet prints;
 * unmodified stats print plain; and the stats with no base pair
 * in the math (crit, shield, mitigation, shield break) never
 * invent one.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCritMetric,
  buildHeroRundown,
  buildMitigationMetric,
  buildShieldMetric,
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
const snapshotOf = (over: Partial<Record<'standardWeaponDps' | 'bossRelativeDps' | 'mitigation' | 'shield', number>> = {}): CharacterMechanicsSnapshot =>
  ({
    standardWeaponDps: scalar(over.standardWeaponDps ?? 0),
    bossRelativeDps: scalar(over.bossRelativeDps ?? 0),
    mitigation: scalar(over.mitigation ?? 0),
    shield: scalar(over.shield ?? 0),
  }) as unknown as CharacterMechanicsSnapshot;

/** The health metric the way buildCharacterStatSummary builds
 *  it: the chassis row carries bucket 'base', gear rows stack
 *  on top, and the metric value is the effective pool. */
const healthMetric = (base: number, value: number): StatMetric => ({
  key: 'health',
  label: 'HP',
  value,
  display: `${value}`,
  detail: '',
  tone: 'green',
  contributions: [
    { source: 'Hunter chassis', detail: 'Base + level', value: base, display: `${base}`, tone: 'muted', bucket: 'base' },
    { source: 'Aegis', detail: 'Shield HP pool', value: value - base, display: `${value - base}`, tone: 'cyan', bucket: 'gear' },
  ],
});

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

describe('buildHeroRundown — the two rows', () => {
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

  it('Crit splits into chance and multiplier cells, both plain — no invented delta', () => {
    const model = buildHeroRundown(baseInput());
    expect(model.critChance?.display).toBe('20%');
    expect(model.critDamage?.display).toBe('×2.5');
    expect(model.critChance?.delta).toBeUndefined();
    expect(model.critDamage?.delta).toBeUndefined();
  });

  it('HP prints current/max with fraction tone; shield and mitigation are their own cells now', () => {
    const model = buildHeroRundown(baseInput({
      snapshot: snapshotOf({ standardWeaponDps: 504, mitigation: 0.08, shield: 260 }),
    }));
    expect(model.hp.display).toBe('812/1,040');
    expect(model.hp.tone).toBe('green');
    expect(model.hp.fraction).toBeCloseTo(812 / 1040);
    expect(model.shield.display).toBe('260');
    expect(model.mitigation.display).toBe('8%');
  });

  it('HP tone follows the fraction: amber under 60%, red under 30%, dead prints Dead', () => {
    expect(buildHeroRundown(baseInput({ survival: { currentHp: 500, maxHp: 1040, shieldHp: 0, isDead: false } })).hp.tone).toBe('amber');
    expect(buildHeroRundown(baseInput({ survival: { currentHp: 200, maxHp: 1040, shieldHp: 0, isDead: false } })).hp.tone).toBe('red');
    const dead = buildHeroRundown(baseInput({ survival: { currentHp: 0, maxHp: 1040, shieldHp: 0, isDead: true } }));
    expect(dead.hp.display).toContain('Dead');
  });

  it('unarmed: row 1 empties, row 2 still renders in full', () => {
    const model = buildHeroRundown(baseInput({
      weapons: [],
      snapshot: snapshotOf({ mitigation: 0.08, shield: 260 }),
      summary: summaryOf([metric('shieldBreak', 0, '0', 'cyan')]),
    }));
    expect(model.unarmed).toBe(true);
    expect(model.dps).toBeNull();
    expect(model.dmgTick).toBeNull();
    expect(model.critChance).toBeNull();
    expect(model.critDamage).toBeNull();
    expect(model.hp.display).toBe('812/1,040');
    expect(model.shield.display).toBe('260');
    expect(model.mitigation.display).toBe('8%');
    expect(model.shieldBreak?.display).toBe('0');
  });
});

describe('buildHeroRundown — percentage-over-base deltas', () => {
  it('HP delta is the health metric\u2019s own percentage: base-bucket vs value, whole-rounded', () => {
    // The sheet's figure (characterStats): round((effective −
    // base) / base × 100) off the chassis base. The rundown
    // must print the identical number for the same metric.
    for (const [base, value] of [[880, 1040], [880, 700]] as const) {
      const sheetPct = Math.round(((value - base) / base) * 100);
      const model = buildHeroRundown(baseInput({
        summary: summaryOf([metric('dps', 595, '595'), healthMetric(base, value)]),
      }));
      expect(model.hp.delta?.display).toBe(`${sheetPct > 0 ? '+' : ''}${sheetPct}%`);
    }
    const gain = buildHeroRundown(baseInput({
      summary: summaryOf([metric('dps', 595, '595'), healthMetric(880, 1040)]),
    }));
    expect(gain.hp.delta).toEqual({ display: '+18%', tone: 'green' });
    const loss = buildHeroRundown(baseInput({
      summary: summaryOf([metric('dps', 595, '595'), healthMetric(880, 700)]),
    }));
    expect(loss.hp.delta).toEqual({ display: '-20%', tone: 'red' });
  });

  it('HP at exactly base prints plain — and a missing health metric invents nothing', () => {
    const atBase = buildHeroRundown(baseInput({
      summary: summaryOf([metric('dps', 595, '595'), healthMetric(880, 880)]),
    }));
    expect(atBase.hp.delta).toBeUndefined();
    const noMetric = buildHeroRundown(baseInput());
    expect(noMetric.hp.delta).toBeUndefined();
  });

  it('shield, mitigation, and shield break print plain — their models carry no base pair', () => {
    const model = buildHeroRundown(baseInput({
      snapshot: snapshotOf({ standardWeaponDps: 504, mitigation: 0.08, shield: 260 }),
      summary: summaryOf([metric('dps', 595, '595'), metric('shieldBreak', 1240, '1,240', 'cyan')]),
    }));
    expect(model.shield).toMatchObject({ display: '260' });
    expect(model.shield.delta).toBeUndefined();
    expect(model.mitigation).toMatchObject({ display: '8%' });
    expect(model.mitigation.delta).toBeUndefined();
    expect(model.shieldBreak).toMatchObject({ display: '1,240', tone: 'cyan' });
    expect(model.shieldBreak?.delta).toBeUndefined();
  });

  it('no shield equipped reads as honest zeroes, still tappable cells', () => {
    const model = buildHeroRundown(baseInput({
      snapshot: snapshotOf({ standardWeaponDps: 504 }),
    }));
    expect(model.shield.display).toBe('0');
    expect(model.mitigation.display).toBe('0%');
  });
});

describe('pooledCrit + buildCritMetric — the Crit sheet', () => {
  it('pools by standard-DPS weight, not a flat average', () => {
    // Both weapons carry the same crit factor in the DPS chain
    // (1 + chance × damage = 1.2), so their standard-DPS weights
    // are exactly their damage weights, 3:1 — a flat average of
    // the chances would read 0.15, the pool must read 0.175.
    const heavy = makeWeapon({ id: 'heavy', baseDamage: 300, attackSpeed: 5, critChance: 0.2, critDamage: 1.0 });
    const light = makeWeapon({ id: 'light', baseDamage: 100, attackSpeed: 5, critChance: 0.1, critDamage: 2.0 });
    const pool = pooledCrit([heavy, light]);
    expect(pool).not.toBeNull();
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

describe('buildShieldMetric + buildMitigationMetric — the row-2 sheets', () => {
  const snapWithShield = {
    standardWeaponDps: scalar(0),
    bossRelativeDps: scalar(0),
    shield: {
      value: 260,
      contributions: [{ bucket: 'gear', source: 'Aegis Plate', stat: 'shieldHp', value: 260 }],
      buckets: {},
    },
    mitigation: {
      value: 0.08,
      contributions: [{ bucket: 'gear', source: 'Aegis Plate', stat: 'mitigation', value: 0.08 }],
      buckets: {},
    },
  } as unknown as CharacterMechanicsSnapshot;

  it('the shield metric carries the snapshot scalar\u2019s own rows', () => {
    const shieldMetric = buildShieldMetric(snapWithShield);
    expect(shieldMetric).toMatchObject({ key: 'shield', value: 260, display: '260', tone: 'cyan' });
    expect(shieldMetric.contributions).toHaveLength(1);
    expect(shieldMetric.contributions[0]).toMatchObject({ source: 'Aegis Plate', display: '260', bucket: 'gear' });
  });

  it('the mitigation metric formats its rate and rows as percents', () => {
    const mitMetric = buildMitigationMetric(snapWithShield);
    expect(mitMetric).toMatchObject({ key: 'mitigation', display: '8%', tone: 'cyan' });
    expect(mitMetric.contributions[0]).toMatchObject({ source: 'Aegis Plate', display: '8%' });
  });
});
