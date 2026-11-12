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
  fightCrit,
  stageStatDelta,
  type HeroRundownInput,
} from '../lib/stats/heroRundown';
import { computeEffectiveCritChance } from '../lib/stats/dpsChain';
import { computeSkillBonuses } from '../lib/skills/skillBonuses';
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
    primary: makeWeapon(),
    skillBonuses: {},
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
      primary: null,
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

describe('fightCrit + buildCritMetric — the fight number (audit HTR-04)', () => {
  it('the audit fixture: primary 25% + both crit nodes maxed (+30%) displays 55%', () => {
    // gs_crit_1 / gs_crit_2 grant +3% crit chance per point, five
    // points each — priced through the real node derivation
    // (computeSkillBonuses), not a hand-fed 0.30, so the pin
    // breaks if either the node table or the display drifts.
    // On the pre-fix display this fixture read 25% (weapon-only
    // pool) while the boss sim settled 55%.
    const skillBonuses = computeSkillBonuses({ gs_crit_1: 5, gs_crit_2: 5 });
    expect(skillBonuses.critChance).toBeCloseTo(0.30);
    const primary = makeWeapon({ name: 'Widowmaker', critChance: 0.25, critDamage: 1.2 });
    const model = buildHeroRundown(baseInput({ weapons: [primary], primary, skillBonuses }));
    expect(model.critChance?.display).toBe('55%');
    expect(model.critDamage?.display).toBe('×2.2');
    const critMetric = buildCritMetric(primary, skillBonuses);
    expect(critMetric?.key).toBe('crit');
    expect(critMetric?.value).toBeCloseTo(0.55);
    expect(critMetric?.display).toBe('55% · ×2.2');
  });

  it('display and keystone clause read the same value — the shared composition', () => {
    // simulateBoss feeds its high-crit clause (effective crit
    // > 0.5) the output of computeEffectiveCritChance; the
    // display must equal that function's output for the same
    // build, consumables excluded (a standing display never
    // prices transient buffs).
    const primary = makeWeapon({ critChance: 0.25 });
    const skillBonuses = { critChance: 0.30 };
    expect(buildCritMetric(primary, skillBonuses)?.value)
      .toBeCloseTo(computeEffectiveCritChance(primary, skillBonuses));
    // The clause boundary is shared too: 0.20 + 0.30 lands
    // exactly on 0.50 — strictly-over means the clause does not
    // fire, and the display prints the same 50% it declined.
    const edge = makeWeapon({ critChance: 0.20 });
    expect(computeEffectiveCritChance(edge, skillBonuses)).toBeCloseTo(0.50);
    expect(buildHeroRundown(baseInput({ weapons: [edge], primary: edge, skillBonuses })).critChance?.display).toBe('50%');
  });

  it('only the primary counts — a high-crit secondary never moves the display', () => {
    const primary = makeWeapon({ name: 'Primary', critChance: 0.25, critDamage: 1.0 });
    const secondary = makeWeapon({ id: 'secondary', name: 'Sidearm', critChance: 0.9, critDamage: 3.0 });
    const model = buildHeroRundown(baseInput({ weapons: [primary, secondary], primary, skillBonuses: {} }));
    expect(model.critChance?.display).toBe('25%');
    // Crit × is the primary's own multiplier, not a blend.
    expect(model.critDamage?.display).toBe('×2.0');
  });

  it('the sheet rows are the two terms the engine adds: primary + skill nodes', () => {
    const primary = makeWeapon({ name: 'Widowmaker', critChance: 0.25, critDamage: 1.2 });
    const critMetric = buildCritMetric(primary, { critChance: 0.30 });
    expect(critMetric?.contributions).toHaveLength(2);
    expect(critMetric?.contributions[0]).toMatchObject({ source: 'Widowmaker', bucket: 'weapon', display: '25% · ×2.2' });
    expect(critMetric?.contributions[1]).toMatchObject({ bucket: 'skill', display: '+30%' });
    // No skill crit → no skill row, just the weapon's own term.
    const weaponOnly = buildCritMetric(primary, {});
    expect(weaponOnly?.contributions).toHaveLength(1);
    expect(weaponOnly?.display).toBe('25% · ×2.2');
  });

  it('no primary: skill crit alone still prints a chance, never a multiplier', () => {
    expect(fightCrit(null, { critChance: 0.30 })).toMatchObject({ chance: 0.30, damage: null, skillChance: 0.30 });
    expect(buildCritMetric(null, { critChance: 0.30 })?.display).toBe('30%');
  });

  it('nothing to print: no primary and no skill crit → no crit', () => {
    expect(fightCrit(null, {})).toBeNull();
    expect(fightCrit(undefined, { critChance: 0 })).toBeNull();
    expect(buildCritMetric(null, {})).toBeNull();
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
