/**
 * Tuning slice T6 — Overclock Serum, the P6 tempo item (owner ruling
 * 2026-11-10 supplementing the economy tuning brief's P6, which
 * PR #473 deliberately stopped on for lack of a spec).
 *
 * The owner's spec, verbatim: a NEW crafter-only consumable named
 * Overclock Serum — +15% attack speed for a 60-second window —
 * recipe 30 Scrap + 2 Ballistic Parts.
 *
 * Pins, at the shipped seams:
 *   - the def: crafter-only acquisition (vendorExcluded, never a
 *     vendor staple; craftable; player-market allowed), family /
 *     channel / scopes mirroring the corrupted stim siblings;
 *   - the new runtime channel: attackSpeedMultiplier at Q100 = 1.15
 *     and at the Q175 cap = 1.2625 (DELTA mode, cap 1.30 — the
 *     sibling %-buff convention: cap = 1 + 2 x base delta);
 *   - the recipe in BOTH catalogs: TS registry (30 Scrap +
 *     2 Ballistic Parts, 20 min) and migration 0087's restated SQL
 *     catalog (deep-compared: 0086's 83 objects + exactly this one);
 *   - roaming: the engine's mods carry the cadence factor for
 *     exactly the 60s window (20 ticks at the 3s tick), one unit
 *     burned per window, auto-renewed while stock lasts, baseline
 *     (1) restored after the window lapses without stock;
 *   - composition: serum + Redline Tonic together give BOTH mods
 *     (cadence 1.15 AND dps 1.14) — no double count, no fold of one
 *     channel into the other;
 *   - the DPS chain: the cadence term scales step 1 exactly (the
 *     boosted output is 1.15x the same context without it) and
 *     defaults to identity when absent;
 *   - the boss sim: a prepared serum raises effective DPS, and a
 *     higher-quality serum raises it further (the per-type
 *     aggregate reads the def at the prepared quality);
 *   - vendor staple list unchanged (9 staples; the serum is not
 *     among them).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONSUMABLES,
  CRAFTABLE_CONSUMABLES,
  VENDOR_CONSUMABLES,
  getConsumableRuntimeEffects,
} from '../constants/consumables';
import { CRAFTING_RECIPES } from '../constants/craftingRecipes';
import { ALL_CRAFT_RECIPES } from '../content/crafting';
import {
  activateFromInventory,
  processTick,
  type RoamingConsumableState,
  type TickContext,
} from '../lib/consumables/roamingConsumableEngine';
import { computeWeaponDps } from '../lib/stats/dpsChain';
import { simulateBoss, type BossSimulationInput } from '../lib/simulation/bossSimulator';
import { REGION_1_BOSSES } from '../constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';

const SERUM = 'OverclockSerum';

describe('T6 — the def: crafter-only tempo serum', () => {
  it('exists with the owner-ruled identity', () => {
    const def = CONSUMABLES[SERUM];
    expect(def).toBeTruthy();
    expect(def.name).toBe('Overclock Serum');
    expect(def.family).toBe('corrupted');
    expect(def.effect).toBe('Overclock Serum consumed: attack speed up for a minute.');
    expect(def.basePrice).toBe(400);
    expect(def.effectRules.attackSpeedMultiplier).toBe(1.15);
    expect(def.isBossPrepVisible).toBe(true);
  });

  it('is crafter-only: never vendor-stocked, vendor-excluded, craftable, market-allowed', () => {
    const def = CONSUMABLES[SERUM];
    expect(def.market.vendorStocked).toBe(false);
    expect(def.market.vendorExcluded).toBe(true);
    expect(def.market.craftable).toBe(true);
    expect(def.market.playerMarketAllowed).toBe(true);
    expect(VENDOR_CONSUMABLES.some((c) => c.id === SERUM)).toBe(false);
    expect(CRAFTABLE_CONSUMABLES.some((c) => c.id === SERUM)).toBe(true);
  });

  it('leaves the vendor staple list exactly as shipped (9 staples)', () => {
    expect(VENDOR_CONSUMABLES.map((c) => c.id).sort()).toEqual([
      'AmmoPack', 'BossScanner', 'GenericFuelCell', 'InsuranceToken', 'LuckBooster',
      'MedKit', 'OrdnanceCharge', 'PatchKit', 'ShieldCell',
    ]);
  });

  it('carries the roaming window and boss scope the engines read', () => {
    const def = CONSUMABLES[SERUM];
    expect(def.runtime.activityScopes).toEqual(['roaming', 'boss']);
    expect(def.runtime.activityRules?.roaming?.durationSeconds).toBe(60);
    expect(def.runtime.activityRules?.boss?.consumePolicy).toBe('onAttempt');
  });
});

describe('T6 — quality scaling pins (DELTA convention)', () => {
  it('Q100 = 1.15 and the Q175 cap lands at 1.2625, hard cap 1.30', () => {
    expect(getConsumableRuntimeEffects(SERUM, 100).attackSpeedMultiplier).toBeCloseTo(1.15, 10);
    expect(getConsumableRuntimeEffects(SERUM, 175).attackSpeedMultiplier).toBeCloseTo(1.2625, 10);
    expect(getConsumableRuntimeEffects(SERUM, 250).attackSpeedMultiplier).toBeCloseTo(1.2625, 10);
    expect(CONSUMABLES[SERUM].runtime.qualityScaling.attackSpeedMultiplier).toEqual({ mode: 'multiplierDelta', cap: 1.3 });
    expect(CONSUMABLES[SERUM].quality).toMatchObject({ craftMin: 70, craftMax: 150, cap: 175 });
  });

  it('declares no dpsMultiplier — the cadence channel is not a DPS fold', () => {
    expect(getConsumableRuntimeEffects(SERUM, 100).dpsMultiplier).toBeUndefined();
    expect(CONSUMABLES[SERUM].effectRules.dpsMultiplier).toBeUndefined();
  });
});

describe('T6 — the recipe in both catalogs', () => {
  it('TS registry: 30 Scrap + 2 Ballistic Parts, 20 minutes, offense', () => {
    const recipe = CRAFTING_RECIPES.find((r) => r.id === 'recipe_overclock_serum');
    expect(recipe).toBeTruthy();
    expect(recipe?.consumableType).toBe(SERUM);
    expect(recipe?.materials).toEqual({ Scrap: 30, BallisticParts: 2 });
    expect(recipe?.craftTimeMs).toBe(20 * 60 * 1000);
    expect(recipe?.category).toBe('offense');
    const unified = ALL_CRAFT_RECIPES.find((r) => r.id === 'recipe_overclock_serum');
    expect(unified?.inputs).toEqual({ Scrap: 30, BallisticParts: 2 });
    expect(unified?.unitDurationMs).toBe(1200000);
  });

  it('migration 0087 restates the SQL catalog: 0086 + exactly this recipe', () => {
    const sql0086 = readFileSync(join(process.cwd(), 'db', 'migrations', '0086_retire_mfr_helm_recipes.sql'), 'utf8');
    const sql0087 = readFileSync(join(process.cwd(), 'db', 'migrations', '0087_overclock_serum_recipe.sql'), 'utf8');
    const cat86 = JSON.parse(sql0086.split('$')[1]) as Array<Record<string, unknown>>;
    const cat87 = JSON.parse(sql0087.split('$')[1]) as Array<Record<string, unknown>>;
    expect(cat86).toHaveLength(83);
    expect(cat87).toHaveLength(84);
    const serum = cat87.find((r) => r.id === 'recipe_overclock_serum');
    expect(serum).toMatchObject({
      kind: 'consumable', name: 'Overclock Serum', category: 'offense',
      inputs: { Scrap: 30, BallisticParts: 2 }, unitDurationMs: 1200000,
      requiresLevel: 1, requiresBench: 1, station: 'bench', consumableType: SERUM,
    });
    expect(cat87.indexOf(serum!)).toBe(cat87.findIndex((r) => r.id === 'recipe_overcharge') + 1);
    for (const row of cat87) {
      if (row.id === 'recipe_overclock_serum') continue;
      expect(row).toEqual(cat86.find((r) => r.id === row.id));
    }
  });
});

function tickCtx(state: RoamingConsumableState, tickIndex: number, inventory: Record<string, number>): TickContext {
  return { tickIndex, currentHp: 940, maxHp: 940, shieldCapacity: 180, inventory, masteryLevels: {} };
  void state;
}

describe('T6 — roaming: the cadence window runs 60 seconds and lapses', () => {
  it('one unit covers exactly 20 ticks (60s at the 3s tick), then baseline returns', () => {
    const inventory = { [SERUM]: 1 };
    let state = activateFromInventory(inventory, 0);
    expect(state.slots.some((s) => s.consumableId === SERUM)).toBe(true);
    let lastConsumed: Array<{ id: string; count: number }> = [];
    for (let tick = 1; tick <= 21; tick += 1) {
      const result = processTick(state, tickCtx(state, tick, inventory));
      state = result.state;
      lastConsumed = result.consumed;
      if (tick <= 20) {
        expect(result.mods.attackSpeedMultiplier, ).toBeCloseTo(1.15, 10);
        expect(result.mods.dpsMultiplier, ).toBe(1);
      } else {
        expect(result.mods.attackSpeedMultiplier).toBe(1);
      }
    }
    expect(lastConsumed.some((c) => c.id === SERUM)).toBe(true);
  });

  it('auto-renews while stock lasts: 2 units cover 40 ticks', () => {
    const inventory = { [SERUM]: 2 };
    let state = activateFromInventory(inventory, 0);
    for (let tick = 1; tick <= 40; tick += 1) {
      const result = processTick(state, tickCtx(state, tick, inventory));
      state = result.state;
      expect(result.mods.attackSpeedMultiplier, ).toBeCloseTo(1.15, 10);
    }
    const after = processTick(state, tickCtx(state, 41, inventory));
    expect(after.mods.attackSpeedMultiplier).toBe(1);
  });

  it('composes with a DPS buff: cadence AND damage both apply, neither folds into the other', () => {
    const inventory = { [SERUM]: 1, RedlineTonic: 1 };
    const state = activateFromInventory(inventory, 0);
    const result = processTick(state, tickCtx(state, 1, inventory));
    expect(result.mods.attackSpeedMultiplier).toBeCloseTo(1.15, 10);
    expect(result.mods.dpsMultiplier).toBeCloseTo(1.14, 10);
  });
});

function weapon(): Weapon {
  return {
    id: 't6-test-gun', name: 'T6 Test Gun', level: 22, rarity: Rarity.Rare,
    weaponType: WeaponType.SMG, manufacturer: Manufacturer.Redline, element: Element.Fire,
    rollQuality: 100, baseDamage: 60, attackSpeed: 2, critChance: 0.2, critDamage: 1.5,
    statusChance: 0, statusDamage: 0, bossDamageMod: 0.2, waveDamageMod: 0,
    shieldDamageMod: 1, armorDamageMod: 1, offlineEarningsMod: 0, rareDropChanceMod: 0,
    scrapYieldMod: 0, parts: [], affixes: [], sourceTag: DropSource.WorldDrop,
    isLocked: false, pixelSeed: 1, combatPower: 0, bossPower: 0, farmPower: 0, economyScore: 0,
  } as Weapon;
}

describe('T6 — the DPS chain cadence term', () => {
  it('scales step 1 exactly: boosted = 1.15x the identical context without it', () => {
    const w = weapon();
    const bare = computeWeaponDps({ weapon: w });
    const boosted = computeWeaponDps({ weapon: w, attackSpeedMultiplier: 1.15 });
    expect(boosted / bare).toBeCloseTo(1.15, 10);
  });

  it('an explicit 1 is bit-identical to the absent field (default identity)', () => {
    const w = weapon();
    expect(computeWeaponDps({ weapon: w, attackSpeedMultiplier: 1 })).toBe(computeWeaponDps({ weapon: w }));
  });
});

describe('T6 — the boss sim prices the serum through the per-type aggregate', () => {
  const base: BossSimulationInput = {
    primary: weapon(), secondary: null, heavy: null, ordnance: null, shield: null,
    classMod: null, relic: null, consumables: {},
    risk: RiskSetting.Balanced, boss: REGION_1_BOSSES[3], playerLevel: 22,
    skillBonuses: {}, pityCount: 0, playerCredits: 0,
  };

  it('a prepared serum raises effective DPS; a better batch raises it further', () => {
    const bare = simulateBoss(base);
    const kitted = simulateBoss({ ...base, consumables: { [SERUM]: 1 } });
    const crafted = simulateBoss({ ...base, consumables: { [SERUM]: 1 }, consumableQuality: { [SERUM]: 175 } });
    expect(kitted.effectiveDPS).toBeGreaterThan(bare.effectiveDPS);
    expect(crafted.effectiveDPS).toBeGreaterThan(kitted.effectiveDPS);
    expect(kitted.expectedConsumableUsage[SERUM]).toBe(1);
  });
});
