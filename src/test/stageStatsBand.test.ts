/**
 * Stage stats band — builder composition pins.
 *
 * The band prints EFFECTIVE values as hero numbers, and where a
 * base→effective derivation exists (owner refinement 2026-11-02),
 * the delta rides beside the hero: green for gains, red for
 * losses, present exactly when effective ≠ base, absent when the
 * stat is unmodified. Numbers people play for should POP — and
 * they should never lie about where they came from.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStageStatsBand,
  stageStatDelta,
  type StageStatsBandInput,
} from '../lib/stats/stageStatsBand';
import type { CharacterStatSummary, StatMetric, StatTone } from '../lib/stats/characterStats';
import type { CharacterMechanicsSnapshot } from '../lib/mechanics/buildCharacterMechanicsSnapshot';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';
import { ALL_CRAFT_RECIPES, craftQualityBounds, craftUnitXp, CRAFT_XP_RATE_DEFAULT } from '../content/crafting';

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

const metric = (
  key: string,
  value: number,
  display: string,
  opts: { tone?: StatTone; sourceActivity?: StatMetric['sourceActivity'] } = {},
): StatMetric => ({
  key,
  label: key,
  value,
  display,
  detail: '',
  tone: opts.tone ?? 'muted',
  contributions: [],
  sourceActivity: opts.sourceActivity,
});

const summaryOf = (metrics: StatMetric[]): CharacterStatSummary =>
  ({ headline: [], all: metrics }) as unknown as CharacterStatSummary;

const scalar = (value: number) => ({ value, contributions: [] });
const snapshotOf = (over: Partial<Record<'standardWeaponDps' | 'bossRelativeDps' | 'mitigation' | 'xpModifier', number>> = {}): CharacterMechanicsSnapshot =>
  ({
    standardWeaponDps: scalar(over.standardWeaponDps ?? 0),
    bossRelativeDps: scalar(over.bossRelativeDps ?? 0),
    mitigation: scalar(over.mitigation ?? 0),
    xpModifier: scalar(over.xpModifier ?? 0),
  }) as unknown as CharacterMechanicsSnapshot;

function baseInput(over: Partial<StageStatsBandInput> = {}): StageStatsBandInput {
  return {
    kind: 'roaming_loot',
    summary: summaryOf([
      metric('dps', 100, '100', { tone: 'red' }),
      metric('offline', 0, '+0%', { tone: 'green' }),
      metric('scrap', 0, '+0%', { tone: 'cyan' }),
      metric('rareFind', 0, '+0%', { tone: 'amber' }),
    ]),
    snapshot: snapshotOf({ standardWeaponDps: 100 }),
    weapons: [makeWeapon()],
    area: { idleCreditsPerMinute: 15, idleScrapPerMinute: 3, idleXpPerTick: 1, dangerRating: 'Low' },
    survival: { currentHp: 900, maxHp: 1000, shieldHp: 0, isDead: false },
    vehicle: {
      equipped: false,
      active: false,
      factor: 1,
      potentialFactor: 1,
      fuelUnits: 0,
      fuelTicks: 0,
      inactiveReason: null,
      scannerPct: 0,
      cargoChance: 0,
    },
    boss: null,
    crafting: { runningJob: null, benchesFree: 1, masteries: {}, playerLevel: 5 },
    extraction: null,
    offlineCapHours: 2,
    ...over,
  };
}

const byKey = (entries: ReturnType<typeof buildStageStatsBand>, key: string) => entries.find((e) => e.key === key);

describe('stageStatDelta — the base→effective delta', () => {
  it("owner's example: 100 → 150 prints +50% in green", () => {
    expect(stageStatDelta(100, 150)).toEqual({ display: '+50%', tone: 'green' });
  });
  it('unmodified prints nothing', () => {
    expect(stageStatDelta(100, 100)).toBeNull();
  });
  it('a loss prints in red', () => {
    expect(stageStatDelta(100, 80)).toEqual({ display: '-20%', tone: 'red' });
  });
  it('no base, no delta', () => {
    expect(stageStatDelta(0, 50)).toBeNull();
  });
  it('sub-half-percent float dust is not a story', () => {
    expect(stageStatDelta(100, 100.01)).toBeNull();
  });
});

describe('buildStageStatsBand — roaming', () => {
  it('DPS is first, effective is the hero, +50% rides beside it in green', () => {
    const entries = buildStageStatsBand(baseInput({
      summary: summaryOf([
        metric('dps', 150, '150', { tone: 'red' }),
        metric('offline', 0, '+0%'),
        metric('scrap', 0, '+0%'),
        metric('rareFind', 0, '+0%'),
      ]),
    }));
    const dps = entries[0];
    expect(dps.key).toBe('dps');
    expect(dps.display).toBe('150');
    expect(dps.delta).toEqual({ display: '+50%', tone: 'green' });
    // Damage/tick is the same derivation over the 3s tick.
    const dmg = byKey(entries, 'dmgTick');
    expect(dmg?.display).toBe('450');
    expect(dmg?.delta).toEqual({ display: '+50%', tone: 'green' });
  });

  it('unmodified DPS prints plain — no delta anywhere on the faucet', () => {
    const entries = buildStageStatsBand(baseInput());
    expect(byKey(entries, 'dps')?.delta).toBeUndefined();
    expect(byKey(entries, 'credits')?.delta).toBeUndefined();
    expect(byKey(entries, 'gearChance')?.delta).toBeUndefined();
    // The honest base rates still print: 15/min ÷ 20 ticks, 22% gear.
    expect(byKey(entries, 'credits')?.display).toBe('+0.75');
    expect(byKey(entries, 'gearChance')?.display).toBe('22%');
    // Fragment chance never rounds up to a lying 1%: 0.8% it is.
    expect(byKey(entries, 'fragChance')?.display).toBe('0.8%');
  });

  it('the vehicle factor lifts every faucet and each prints its gain', () => {
    const entries = buildStageStatsBand(baseInput({
      vehicle: {
        equipped: true, active: true, factor: 1.35, potentialFactor: 1.35,
        fuelUnits: 90, fuelTicks: 100, inactiveReason: null, scannerPct: 0, cargoChance: 0,
      },
    }));
    expect(byKey(entries, 'credits')?.display).toBe('+1.01');
    expect(byKey(entries, 'credits')?.delta).toEqual({ display: '+35%', tone: 'green' });
    expect(byKey(entries, 'gearChance')?.delta).toEqual({ display: '+35%', tone: 'green' });
    const vehicle = byKey(entries, 'vehicle');
    expect(vehicle?.display).toBe('×1.35');
    expect(vehicle?.delta).toEqual({ display: '+35%', tone: 'green' });
    expect(byKey(entries, 'fuel')?.display).toBe('90u · ~100 ticks');
  });

  it('rare-find folds into the gear chance with its delta', () => {
    const entries = buildStageStatsBand(baseInput({
      summary: summaryOf([
        metric('dps', 100, '100'),
        metric('offline', 0, '+0%'),
        metric('scrap', 0, '+0%'),
        metric('rareFind', 0.5, '+50%', { tone: 'amber' }),
      ]),
    }));
    const gear = byKey(entries, 'gearChance');
    expect(gear?.display).toBe('33%');
    expect(gear?.delta).toEqual({ display: '+50%', tone: 'green' });
  });

  it('an empty tank shows the yield loss in red against the fueled potential', () => {
    const entries = buildStageStatsBand(baseInput({
      vehicle: {
        equipped: true, active: false, factor: 1, potentialFactor: 1.35,
        fuelUnits: 0, fuelTicks: 0, inactiveReason: 'empty', scannerPct: 0, cargoChance: 0,
      },
    }));
    const vehicle = byKey(entries, 'vehicle');
    expect(vehicle?.display).toBe('×1.00 · Empty');
    expect(vehicle?.delta).toEqual({ display: '-26%', tone: 'red' });
  });

  it('crit prints plain — the math has no base→effective crit derivation (skills convert crit into the DPS aggregate instead)', () => {
    const entries = buildStageStatsBand(baseInput());
    const crit = byKey(entries, 'crit');
    expect(crit?.display).toBe('20% · ×2.5');
    expect(crit?.delta).toBeUndefined();
  });

  it('unarmed: the honest line replaces the combat block', () => {
    const entries = buildStageStatsBand(baseInput({ weapons: [] }));
    expect(entries[0]).toMatchObject({ key: 'weapon', display: 'No weapon equipped' });
    expect(byKey(entries, 'dps')).toBeUndefined();
  });

  it('survival state rides along: HP ratio, shield, mitigation', () => {
    const entries = buildStageStatsBand(baseInput({
      survival: { currentHp: 250, maxHp: 1000, shieldHp: 120, isDead: false },
      snapshot: snapshotOf({ standardWeaponDps: 100, mitigation: 0.25 }),
    }));
    expect(byKey(entries, 'hp')).toMatchObject({ display: '250/1,000', tone: 'red' });
    expect(byKey(entries, 'shieldHp')?.display).toBe('120');
    expect(byKey(entries, 'mitigation')?.display).toBe('25%');
  });
});

describe('buildStageStatsBand — standby', () => {
  it('shows the roaming set the loadout WILL roam with, plus offline + AFK cap', () => {
    const entries = buildStageStatsBand(baseInput({
      kind: 'idle_standby',
      summary: summaryOf([
        metric('dps', 100, '100'),
        metric('offline', 0.25, '+25%', { tone: 'green' }),
        metric('scrap', 0, '+0%'),
        metric('rareFind', 0, '+0%'),
      ]),
      offlineCapHours: 6,
    }));
    expect(byKey(entries, 'dps')).toBeTruthy();
    expect(byKey(entries, 'credits')).toBeTruthy();
    expect(byKey(entries, 'offline')?.display).toBe('+25%');
    expect(byKey(entries, 'afkCap')?.display).toBe('6h');
    // The offline modifier lifts the standby credit preview too.
    expect(byKey(entries, 'credits')?.delta).toEqual({ display: '+25%', tone: 'green' });
  });
});

describe('buildStageStatsBand — boss', () => {
  it('boss set: effective DPS vs the boss pool with its delta, sim, breaks, boss facts', () => {
    const entries = buildStageStatsBand(baseInput({
      kind: 'boss_fight',
      summary: summaryOf([
        metric('dps', 200, '200', { tone: 'red' }),
        metric('boss', 180, '180', { tone: 'amber' }),
        metric('shieldBreak', 40, '40', { tone: 'cyan' }),
        metric('armorBreak', 25, '25', { tone: 'purple' }),
        metric('offline', 0, '+0%'),
        metric('scrap', 0, '+0%'),
        metric('rareFind', 0, '+0%'),
      ]),
      snapshot: snapshotOf({ standardWeaponDps: 100, bossRelativeDps: 160 }),
      boss: { recommendedPower: 300, dps: 45 },
    }));
    const dps = byKey(entries, 'dps');
    expect(dps?.label).toBe('Eff. DPS');
    expect(dps?.display).toBe('200');
    expect(dps?.delta).toEqual({ display: '+25%', tone: 'green' });
    expect(byKey(entries, 'simDps')?.display).toBe('180');
    expect(byKey(entries, 'shieldBreak')?.display).toBe('40');
    expect(byKey(entries, 'armorBreak')?.display).toBe('25');
    expect(byKey(entries, 'bossDps')?.display).toBe('45');
    expect(byKey(entries, 'recPower')?.display).toBe('300');
    // No gathering faucet in a boss fight.
    expect(byKey(entries, 'credits')).toBeUndefined();
  });
});

describe('buildStageStatsBand — crafting', () => {
  const recipe = ALL_CRAFT_RECIPES.find((r) => r.kind === 'consumable')!;

  it('a running job: bench, mastery, quality bounds, units, XP/unit, time left', () => {
    const job = {
      name: recipe.name,
      bench: 1,
      kind: 'consumable',
      recipeId: recipe.id,
      state: 'running',
      unitsTotal: 4,
      unitsCompleted: 1,
      unitDurationMs: recipe.unitDurationMs,
      remainingMs: 5 * 60000,
      catalystMaterialId: null,
    };
    const entries = buildStageStatsBand(baseInput({
      kind: 'crafting',
      crafting: { runningJob: job, benchesFree: 0, masteries: { crafting_consumables: { level: 3, xp: 40 } }, playerLevel: 5 },
    }));
    const bounds = craftQualityBounds({ consumableType: recipe.consumableType, masteryLevel: 3, bench: 1, catalyst: false });
    expect(byKey(entries, 'job')?.display).toBe(recipe.name);
    expect(byKey(entries, 'bench')?.display).toBe('1');
    expect(byKey(entries, 'mastery')?.display).toBe('Lv 3');
    expect(byKey(entries, 'quality')?.display).toBe(`${Math.round(bounds.min)}–${Math.round(bounds.max)}%`);
    expect(byKey(entries, 'units')?.display).toBe('1/4');
    expect(byKey(entries, 'jobXp')?.display).toBe(`${parseFloat(craftUnitXp(recipe.unitDurationMs, 5, CRAFT_XP_RATE_DEFAULT).toFixed(2))}`);
    expect(byKey(entries, 'jobLeft')?.display).toBe('5m');
  });

  it('a paused job says so instead of counting down', () => {
    const job = {
      name: recipe.name, bench: 2, kind: 'consumable', recipeId: recipe.id, state: 'paused',
      unitsTotal: 2, unitsCompleted: 0, unitDurationMs: recipe.unitDurationMs, remainingMs: 60000, catalystMaterialId: null,
    };
    const entries = buildStageStatsBand(baseInput({
      kind: 'crafting',
      crafting: { runningJob: job, benchesFree: 0, masteries: {}, playerLevel: 5 },
    }));
    expect(byKey(entries, 'jobLeft')).toMatchObject({ display: 'Paused', tone: 'red' });
  });

  it('no job: free benches + the mastery tracks the player actually holds', () => {
    const entries = buildStageStatsBand(baseInput({
      kind: 'crafting',
      crafting: {
        runningJob: null,
        benchesFree: 2,
        masteries: { 'crafting.gear': { level: 4, xp: 10 }, 'crafting.cosmetics': { level: 1, xp: 15 } },
        playerLevel: 5,
      },
    }));
    expect(byKey(entries, 'benches')?.display).toBe('2 free');
    expect(byKey(entries, 'mastery-crafting.gear')?.display).toBe('Lv 4');
    expect(byKey(entries, 'mastery-crafting.cosmetics')?.display).toBe('Lv 1');
    expect(byKey(entries, 'mastery-crafting_consumables')).toBeUndefined();
  });
});

describe('buildStageStatsBand — extraction', () => {
  it('pass facts: duration, gear factor vs the deep gate, pool vs expected damage', () => {
    const entries = buildStageStatsBand(baseInput({
      kind: 'extraction',
      extraction: { passMs: 600000, gearFactor: 0.92, pool: 2400, expectedPassDamage: 210, deepGateFactor: 0.8 },
    }));
    expect(byKey(entries, 'pass')?.display).toBe('10m');
    expect(byKey(entries, 'gearFactor')).toMatchObject({ display: '×0.92', tone: 'green' });
    expect(byKey(entries, 'pool')?.display).toBe('2,400');
    expect(byKey(entries, 'dmgPass')?.display).toBe('210');
    expect(byKey(entries, 'deepGate')?.display).toBe('×0.80');
  });
});
