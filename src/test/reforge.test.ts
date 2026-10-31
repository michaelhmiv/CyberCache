/**
 * Reforge (migration 0027) — shipped-path tests.
 *
 * The laws under test:
 *  - Costs come from the one formula (src/content/reforge.ts):
 *    scrap = ceil(salvage value × 3 × reforgeScrapScalar), salvage
 *    value being cc_salvage_scrap; legendary cores are charged ONLY
 *    on Legendary rarity (default 2 — roughly one salvaged
 *    legendary). Both currencies are destroyed and metered.
 *  - The replacement affix rolls from the SAME pools the generators
 *    use (src/lib/gear/affixPools.ts is the one source — the
 *    generators import it too), never duplicates a stat the item's
 *    other affixes carry, and never returns the identical affix.
 *  - Baked stats are recomputed exactly: unbake → swap → rebake
 *    recovers the identical pre-affix base the generator baked from
 *    (bit-identical for weapons/ordnance; shields too, with the
 *    Turtle recharge-rate grid note in shieldBehaviors.ts).
 *  - Identity never changes: rarity, level, type, manufacturer,
 *    element, rollQuality, parts, boosts, shield behavior, and
 *    legendaryEffectId are bit-identical after a reforge; a
 *    non-legendary can never gain an effect.
 *  - The op is one atomic, nonce-idempotent server write: equipped /
 *    listed / in-service / locked / affixless / module-only /
 *    vehicle items are refused; insufficient funds change nothing;
 *    a replayed nonce charges once.
 *  - Collections: reforging never writes or alters discoveries.
 *  - Metrics: reforge rows move reforges_completed,
 *    scrap_destroyed_reforge, legendary_cores_destroyed_reforge,
 *    and extend legendary_cores_spent exactly once.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REFORGE_LEGENDARY_CORE_COST_DEFAULT,
  REFORGE_SCRAP_SCALAR_DEFAULT,
  reforgeCostFor,
  salvageValueFor,
} from '../content/reforge';
import {
  affixCategoryFor,
  affixPoolDefsFor,
  applyReforgeToItem,
  bakeOrdnanceAffixes,
  bakeShieldAffixes,
  bakeWeaponAffixes,
  computeWeaponPowerScores,
  isReforgeableAffix,
  unbakeOrdnanceAffixes,
  unbakeShieldAffixes,
  unbakeWeaponAffixes,
  type ReforgeKind,
  type OrdnanceStatBag,
  type ShieldStatBag,
  type WeaponStatBag,
} from '../lib/gear/affixPools';
import {
  applyShieldBehaviorGenerationStats,
  invertShieldBehaviorGenerationStats,
  shieldBehaviorOf,
} from '../lib/combat/shieldBehaviors';
import { createRNG } from '../lib/utils/rng';
import { computeStandardDps } from '../lib/stats/dpsChain';
import { DropSource, Element, Rarity } from '../types/game';
import type { Affix, GearItem, Ordnance, Shield, Weapon } from '../types/items';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { generateShield } from '../server/lib/generators/shieldGenerator';
import { generateClassMod } from '../server/lib/generators/classModGenerator';
import { generateRelic } from '../server/lib/generators/relicGenerator';
import { generateOrdnance } from '../server/lib/generators/ordnanceGenerator';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import {
  emptyWriteSeed,
  salvageScrap,
  type WriteItemData,
  type WriteSeed,
} from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { InMemoryEconomyStore } from '../server/economy/memory';
import { resolveEconomyConfigValues } from '../server/economy/config';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const RARITY_CYCLE = [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary];
const onlyRarity = (rarity: Rarity) => ({
  Common: 0, Uncommon: 0, Rare: 0, Epic: 0, Legendary: 0, [rarity]: 1,
}) as Partial<Record<Rarity, number>>;

function genItem(kind: ReforgeKind, seed: number, level = 30): GearItem {
  const rng = createRNG(seed);
  const rarity = RARITY_CYCLE[seed % RARITY_CYCLE.length];
  switch (kind) {
    case 'weapon':
      return generateWeapon({ source: DropSource.WorldDrop, level, forcedRarity: rarity }, rng);
    case 'shield':
      return generateShield(level, rng, onlyRarity(rarity));
    case 'classMod':
      return generateClassMod(level, rng, onlyRarity(rarity));
    case 'relic':
      return generateRelic(level, rng, onlyRarity(rarity));
    case 'ordnance':
      return generateOrdnance(level, rng, onlyRarity(rarity));
  }
}

// ─── Cost rules ──────────────────────────────────────────────────────

describe('reforge costs — one formula, lever-priced', () => {
  it('salvage value mirrors cc_salvage_scrap exactly', () => {
    for (const rarity of Object.values(Rarity)) {
      for (const level of [1, 7, 25, 50, 100]) {
        expect(salvageValueFor(rarity, level)).toBe(salvageScrap(rarity, level));
      }
    }
  });

  it.each([
    [{ rarity: 'Common', level: 1 }, { scrap: 45, cores: 0 }],
    [{ rarity: 'Uncommon', level: 10 }, { scrap: 270, cores: 0 }],
    [{ rarity: 'Rare', level: 25 }, { scrap: 1014, cores: 0 }],
    [{ rarity: 'Epic', level: 50 }, { scrap: 3120, cores: 0 }],
    [{ rarity: 'Legendary', level: 10 }, { scrap: 1440, cores: 2 }],
    [{ rarity: 'Legendary', level: 50 }, { scrap: 6240, cores: 2 }],
    [{ rarity: 'Legendary', level: 100 }, { scrap: 12240, cores: 2 }],
  ])('cost for %s', (item, expected) => {
    expect(reforgeCostFor(item)).toEqual(expected);
  });

  it('cores are charged on Legendary rarity only, at every level', () => {
    for (const rarity of Object.values(Rarity)) {
      for (const level of [1, 30, 99]) {
        const cost = reforgeCostFor({ rarity, level });
        expect(cost.cores).toBe(rarity === Rarity.Legendary ? REFORGE_LEGENDARY_CORE_COST_DEFAULT : 0);
      }
    }
  });

  it('the core cost is a meaningful fraction of one salvaged legendary', () => {
    // Salvage yield is 1 + (L>=25) + (L>=50) + (effect weapon): 2–3
    // at the levels legendaries get reforged. Cost 2 ≈ one salvaged
    // legendary per reforge — the loop stays tight.
    expect(REFORGE_LEGENDARY_CORE_COST_DEFAULT).toBe(2);
    expect(REFORGE_SCRAP_SCALAR_DEFAULT).toBe(1);
  });

  it('levers scale the price (scalar multiplies scrap; core lever is flat)', () => {
    expect(reforgeCostFor({ rarity: 'Epic', level: 50 }, { reforgeScrapScalar: 2 }).scrap).toBe(6240);
    expect(reforgeCostFor({ rarity: 'Epic', level: 50 }, { reforgeScrapScalar: 0 }).scrap).toBe(0);
    expect(reforgeCostFor({ rarity: 'Legendary', level: 50 }, { reforgeLegendaryCoreCost: 3 }).cores).toBe(3);
    expect(reforgeCostFor({ rarity: 'Rare', level: 50 }, { reforgeLegendaryCoreCost: 3 }).cores).toBe(0);
  });

  it('the lever registry carries both reforge levers at the content defaults', () => {
    const values = resolveEconomyConfigValues(null);
    expect(values.reforgeScrapScalar).toBe(REFORGE_SCRAP_SCALAR_DEFAULT);
    expect(values.reforgeLegendaryCoreCost).toBe(REFORGE_LEGENDARY_CORE_COST_DEFAULT);
  });
});

// ─── Pools — one source with the generators ─────────────────────────

describe('affix pools — the generators and reforge share one source', () => {
  const kinds: ReforgeKind[] = ['weapon', 'shield', 'classMod', 'relic', 'ordnance'];
  for (const kind of kinds) {
    it(`${kind}: every generated pool affix is in-pool, in-band, generator-formatted`, () => {
      const defs = affixPoolDefsFor(kind);
      let checked = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const item = genItem(kind, seed * 7919);
        for (const affix of item.affixes) {
          if (!isReforgeableAffix(affix)) continue;
          const def = defs.find((d) => d.stat === affix.stat);
          expect(def, `${kind} affix ${affix.stat}`).toBeDefined();
          const rollVal = Math.round(affix.value * 100);
          expect(rollVal).toBeGreaterThanOrEqual(def!.min);
          expect(rollVal).toBeLessThanOrEqual(def!.max);
          expect(affix.value).toBe(rollVal / 100);
          expect(affix.displayText).toBe(def!.text.replace('{v}', String(rollVal)));
          expect(affix.category).toBe(affixCategoryFor(kind, def!));
          expect(affix.id).toBe(`${affix.stat}_${item.affixes.indexOf(affix)}`);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(40);
    });
  }
});

// ─── Bake / unbake round trips ──────────────────────────────────────

describe('bake/unbake — exact inverses over generated corpora', () => {
  it('weapon stat blocks round-trip bit-identically', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const weapon = genItem('weapon', seed * 104729) as Weapon;
      const bag: WeaponStatBag = {
        baseDamage: weapon.baseDamage, attackSpeed: weapon.attackSpeed,
        critChance: weapon.critChance, critDamage: weapon.critDamage,
        bossDamageMod: weapon.bossDamageMod, waveDamageMod: weapon.waveDamageMod,
        shieldDamageMod: weapon.shieldDamageMod, armorDamageMod: weapon.armorDamageMod,
        offlineEarningsMod: weapon.offlineEarningsMod,
        rareDropChanceMod: weapon.rareDropChanceMod, scrapYieldMod: weapon.scrapYieldMod,
      };
      const original = { ...bag };
      unbakeWeaponAffixes(bag, weapon.affixes);
      bakeWeaponAffixes(bag, weapon.affixes);
      expect(bag).toEqual(original);
    }
  });

  it('ordnance stat blocks round-trip bit-identically', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const ordnance = genItem('ordnance', seed * 31337) as Ordnance;
      const bag: OrdnanceStatBag = {
        damage: ordnance.damage, shieldDamage: ordnance.shieldDamage, armorDamage: ordnance.armorDamage,
      };
      const original = { ...bag };
      unbakeOrdnanceAffixes(bag, ordnance.affixes);
      bakeOrdnanceAffixes(bag, ordnance.affixes);
      expect(bag).toEqual(original);
    }
  });

  it('shield stat blocks round-trip (behavior transform included)', () => {
    let turtles = 0;
    for (let seed = 1; seed <= 160; seed++) {
      const shield = genItem('shield', seed * 15485863) as Shield;
      const behavior = shieldBehaviorOf(shield);
      if (behavior === 'turtle') turtles++;
      const inverted = invertShieldBehaviorGenerationStats(behavior, shield);
      const bag: ShieldStatBag = {
        hp: inverted.hp, rechargeRate: inverted.rechargeRate, mitigation: shield.mitigation,
      };
      unbakeShieldAffixes(bag, shield.affixes);
      bakeShieldAffixes(bag, shield.affixes);
      const reapplied = applyShieldBehaviorGenerationStats(behavior, bag);
      expect(reapplied.hp).toBe(shield.hp);
      expect(bag.mitigation).toBe(shield.mitigation);
      // Recharge rate is exact except the documented Turtle half-step
      // grid ambiguity (<= 0.1); it is consumed by no engine.
      if (behavior === 'turtle') {
        expect(Math.abs(reapplied.rechargeRate - shield.rechargeRate)).toBeLessThanOrEqual(0.1 + 1e-9);
      } else {
        expect(reapplied.rechargeRate).toBe(shield.rechargeRate);
      }
    }
    expect(turtles).toBeGreaterThan(0); // the corpus really covers Turtle
  });
});

// ─── The roll + invariants ──────────────────────────────────────────

const DERIVED_FIELDS: Record<ReforgeKind, string[]> = {
  weapon: ['affixes', 'baseDamage', 'attackSpeed', 'critChance', 'critDamage', 'bossDamageMod', 'waveDamageMod', 'shieldDamageMod', 'armorDamageMod', 'offlineEarningsMod', 'rareDropChanceMod', 'scrapYieldMod', 'combatPower', 'bossPower', 'farmPower', 'economyScore'],
  shield: ['affixes', 'hp', 'rechargeRate', 'mitigation'],
  ordnance: ['affixes', 'damage', 'shieldDamage', 'armorDamage'],
  classMod: ['affixes'],
  relic: ['affixes'],
};

function maskedIdentity(kind: ReforgeKind, item: GearItem): Record<string, unknown> {
  const clone = structuredClone(item) as unknown as Record<string, unknown>;
  for (const field of DERIVED_FIELDS[kind]) delete clone[field];
  return clone;
}

describe('applyReforgeToItem — invariants over generated corpora', () => {
  const kinds: ReforgeKind[] = ['weapon', 'shield', 'classMod', 'relic', 'ordnance'];
  for (const kind of kinds) {
    it(`${kind}: identity bit-identical, replacement always legal`, () => {
      let reforges = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const item = genItem(kind, seed * 2654435761 % 100000, 45);
        const poolIndices = item.affixes
          .map((affix, index) => (isReforgeableAffix(affix) ? index : -1))
          .filter((i) => i >= 0);
        if (poolIndices.length === 0) continue;
        const affixIndex = poolIndices[seed % poolIndices.length];
        const rng = createRNG(seed * 97 + 13);
        const { item: next, oldAffix, newAffix } = applyReforgeToItem(kind, item, affixIndex, rng);
        reforges++;

        // Identity: everything but affixes + derived stats is untouched.
        expect(maskedIdentity(kind, next)).toEqual(maskedIdentity(kind, item));
        expect(next.legendaryEffectId).toBe(item.legendaryEffectId);
        expect(next.rarity).toBe(item.rarity);
        expect(next.level).toBe(item.level);
        if (kind === 'weapon') expect((next as Weapon).rollQuality).toBe((item as Weapon).rollQuality);

        // The other affixes are bit-identical; only the slot changed.
        expect(next.affixes).toHaveLength(item.affixes.length);
        next.affixes.forEach((affix, i) => {
          if (i !== affixIndex) expect(affix).toEqual(item.affixes[i]);
        });
        expect(oldAffix).toEqual(item.affixes[affixIndex]);

        // The replacement is a legal pool roll that differs.
        expect(newAffix).not.toEqual(oldAffix);
        expect(next.affixes[affixIndex]).toEqual(newAffix);
        const defs = affixPoolDefsFor(kind);
        const def = defs.find((d) => d.stat === newAffix.stat)!;
        expect(def).toBeDefined();
        const rollVal = Math.round(newAffix.value * 100);
        expect(rollVal).toBeGreaterThanOrEqual(def.min);
        expect(rollVal).toBeLessThanOrEqual(def.max);
        expect(newAffix.id).toBe(`${newAffix.stat}_${affixIndex}`);
        expect(newAffix.category).toBe(affixCategoryFor(kind, def));
        expect(newAffix.displayText).toBe(def.text.replace('{v}', String(rollVal)));

        // No-duplicate rule, with the pool-exhausted fallback shape:
        // a stat the other affixes carry may only reappear when it is
        // the replaced affix's own stat, and then with a new value.
        const otherStats = new Set(item.affixes.filter((_, i) => i !== affixIndex).map((a) => a.stat));
        if (otherStats.has(newAffix.stat)) {
          expect(newAffix.stat).toBe(oldAffix.stat);
          expect(newAffix.value).not.toBe(oldAffix.value);
        }
        if (newAffix.stat === oldAffix.stat) {
          expect(newAffix.value).not.toBe(oldAffix.value);
        }

        // Weapons: derived scores are the chain's own output.
        if (kind === 'weapon') {
          const w = next as Weapon;
          expect(w.combatPower).toBe(Math.round(computeStandardDps(w)));
          expect({ combatPower: w.combatPower, bossPower: w.bossPower, farmPower: w.farmPower, economyScore: w.economyScore })
            .toEqual(computeWeaponPowerScores(w));
        }
      }
      expect(reforges).toBeGreaterThan(10);
    });
  }

  it('weapon: the recovered pre-affix base is identical before and after', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const weapon = genItem('weapon', seed * 40503, 60) as Weapon;
      const poolIndices = weapon.affixes
        .map((affix, index) => (isReforgeableAffix(affix) ? index : -1))
        .filter((i) => i >= 0);
      if (poolIndices.length === 0) continue;
      const { item: next } = applyReforgeToItem('weapon', weapon, poolIndices[0], createRNG(seed));
      const baseOf = (w: Weapon): WeaponStatBag => {
        const bag: WeaponStatBag = {
          baseDamage: w.baseDamage, attackSpeed: w.attackSpeed, critChance: w.critChance,
          critDamage: w.critDamage, bossDamageMod: w.bossDamageMod, waveDamageMod: w.waveDamageMod,
          shieldDamageMod: w.shieldDamageMod, armorDamageMod: w.armorDamageMod,
          offlineEarningsMod: w.offlineEarningsMod, rareDropChanceMod: w.rareDropChanceMod,
          scrapYieldMod: w.scrapYieldMod,
        };
        unbakeWeaponAffixes(bag, w.affixes);
        return bag;
      };
      const beforeBase = baseOf(weapon);
      const afterBase = baseOf(next as Weapon);
      // The toFixed(3) additive mods recover bit-identically. The
      // part-scaled fields recover within one bake-grid step of the
      // generator's fractional base (see affixPools.ts): baseDamage
      // is unrounded-divided (error < 1), attackSpeed / critDamage
      // snap to their toFixed(2) bake grid (error <= 0.01).
      for (const field of ['critChance', 'bossDamageMod', 'waveDamageMod', 'shieldDamageMod', 'armorDamageMod', 'offlineEarningsMod', 'rareDropChanceMod', 'scrapYieldMod'] as const) {
        expect(afterBase[field]).toBe(beforeBase[field]);
      }
      expect(Math.abs(afterBase.baseDamage - beforeBase.baseDamage)).toBeLessThanOrEqual(1);
      expect(Math.abs(afterBase.attackSpeed - beforeBase.attackSpeed)).toBeLessThanOrEqual(0.01 + 1e-9);
      expect(Math.abs(afterBase.critDamage - beforeBase.critDamage)).toBeLessThanOrEqual(0.01 + 1e-9);
    }
  });

  it('shield: the recovered pre-affix base survives a reforge', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const shield = genItem('shield', seed * 65599, 40) as Shield;
      const poolIndices = shield.affixes
        .map((affix, index) => (isReforgeableAffix(affix) ? index : -1))
        .filter((i) => i >= 0);
      if (poolIndices.length === 0) continue;
      const { item: next } = applyReforgeToItem('shield', shield, poolIndices[0], createRNG(seed * 3));
      const baseOf = (s: Shield): ShieldStatBag => {
        const behavior = shieldBehaviorOf(s);
        const inverted = invertShieldBehaviorGenerationStats(behavior, s);
        const bag: ShieldStatBag = { hp: inverted.hp, rechargeRate: inverted.rechargeRate, mitigation: s.mitigation };
        unbakeShieldAffixes(bag, s.affixes);
        return bag;
      };
      const before = baseOf(shield);
      const after = baseOf(next as Shield);
      expect(after.hp).toBe(before.hp);
      expect(after.mitigation).toBe(before.mitigation);
      expect(Math.abs(after.rechargeRate - before.rechargeRate)).toBeLessThanOrEqual(0.1 + 1e-9);
      expect((next as Shield).behavior).toBe(shield.behavior);
    }
  });
});

// ─── The exclusion ladder (pool-exhausted shapes) ───────────────────

function bareShield(affixes: Affix[]): Shield {
  return {
    id: 'bare-shield', name: 'Bare Shield', level: 20, rarity: Rarity.Epic,
    hp: 500, rechargeRate: 20, mitigation: 0.1, element: Element.Kinetic,
    affixes, sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 1,
  } as Shield;
}
const poolAffix = (stat: string, index: number, value: number): Affix => ({
  id: `${stat}_${index}`, category: 'combat', stat, value,
  displayText: `+${Math.round(value * 100)}% ${stat}`,
});

describe('reforge roll — exclusion ladder', () => {
  it('full shield pool: the replaced stat re-rolls with a different value', () => {
    const item = bareShield([poolAffix('hp', 0, 0.1), poolAffix('rechargeRate', 1, 0.1), poolAffix('mitigation', 2, 0.05)]);
    for (let seed = 1; seed <= 25; seed++) {
      const { newAffix } = applyReforgeToItem('shield', item, 2, createRNG(seed));
      expect(newAffix.stat).toBe('mitigation');
      expect(newAffix.value).not.toBe(0.05);
    }
  });

  it('duplicated shield pool: last-resort same-stat roll still changes the value', () => {
    const item = bareShield([
      poolAffix('hp', 0, 0.1), poolAffix('hp', 1, 0.12),
      poolAffix('rechargeRate', 2, 0.1), poolAffix('mitigation', 3, 0.05),
    ]);
    for (let seed = 1; seed <= 25; seed++) {
      const { newAffix } = applyReforgeToItem('shield', item, 0, createRNG(seed));
      expect(newAffix.stat).toBe('hp');
      expect(newAffix.value).not.toBe(0.1);
    }
  });

  it('single-affix weapon: the new stat always differs from the old', () => {
    const weapon = genItem('weapon', 424242, 20) as Weapon;
    const single: Weapon = {
      ...weapon,
      affixes: [{ id: 'critChance_0', category: 'combat', stat: 'critChance', value: 0.05, displayText: '+5% Crit Chance' }],
    };
    for (let seed = 1; seed <= 25; seed++) {
      const { newAffix } = applyReforgeToItem('weapon', single, 0, createRNG(seed));
      expect(newAffix.stat).not.toBe('critChance');
    }
  });

  it('class mod skillPoints fallback: value moves within its 1–3 band', () => {
    const mod = genItem('classMod', 777, 20);
    const full = {
      ...mod,
      affixes: [
        { id: 'weaponDamage_0', category: 'skill', stat: 'weaponDamage', value: 0.05, displayText: '+5% Weapon Damage' },
        { id: 'critChance_1', category: 'skill', stat: 'critChance', value: 0.04, displayText: '+4% Crit Chance' },
        { id: 'bossDamageMod_2', category: 'skill', stat: 'bossDamageMod', value: 0.08, displayText: '+8% Boss Damage' },
        { id: 'skillPoints_3', category: 'skill', stat: 'skillPoints', value: 0.02, displayText: '+2 Bonus Skill Points' },
      ] as Affix[],
    };
    for (let seed = 1; seed <= 25; seed++) {
      const { newAffix } = applyReforgeToItem('classMod', full, 3, createRNG(seed));
      expect(newAffix.stat).toBe('skillPoints');
      expect([0.01, 0.03]).toContain(newAffix.value);
    }
  });
});

// ─── The op through the shipped write paths ─────────────────────────

const P = '11111111-1111-4111-8111-111111111111';
const BROKE = '33333333-3333-4333-8333-333333333333';
const COREPOOR = '44444444-4444-4444-8444-444444444444';
const WPN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const SHD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const EQD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const LST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const SVC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
const LCK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6';
const MOD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7';
const VEH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8';
const AFFLESS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9';
const POORWPN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbc01';
const COREWPN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbc02';

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 60, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 3, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function rowFor(id: string, owner: string, kind: string, payload: GearItem, over: Partial<WriteItemData> = {}): WriteItemData {
  return {
    id, owner_user_id: owner, kind, static_item_id: null,
    item_level: payload.level ?? 1, rarity: payload.rarity,
    quality: null, material_tier: null, condition_state: null,
    condition_current: null, condition_max: null,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null,
    payload: payload as unknown as Record<string, unknown>,
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 5000,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  } as WriteItemData;
}

function writeSeed(): WriteSeed {
  const s = emptyWriteSeed();
  const legendaryWeapon = genItem('weapon', 9001, 50) as Weapon;
  // Fixture: pin rarity/level/effect (the generator's rarity cycle
  // is seed-driven; the op's laws key off the row's rarity/level).
  const wpnPayload = { ...legendaryWeapon, rarity: Rarity.Legendary, level: 50, legendaryEffectId: 'glass_sun' } as Weapon;
  const epicShield = { ...genItem('shield', 9002, 40), rarity: Rarity.Epic, level: 40 } as Shield;
  const rareWeapon = { ...genItem('weapon', 9003, 20), rarity: Rarity.Rare, level: 20 } as Weapon;
  const rareRelic = { ...genItem('relic', 9004, 20), rarity: Rarity.Rare, level: 20 };
  const epicOrdnance = { ...genItem('ordnance', 9005, 30), rarity: Rarity.Epic, level: 30 };
  const rareMod = { ...genItem('classMod', 9006, 20), rarity: Rarity.Rare, level: 20 };
  const moduleWeapon = genItem('weapon', 9007, 10) as Weapon;
  const moduleOnly: Weapon = {
    ...moduleWeapon,
    rarity: Rarity.Rare, level: 10,
    affixes: [{
      id: 'activity_salvage_weapon', category: 'activity', stat: 'salvageModule',
      value: 0.5, subStats: { scrapYield: 0.2 }, displayText: 'Salvage Module',
    }],
  };
  const affixless: Weapon = { ...moduleWeapon, rarity: Rarity.Common, level: 5, affixes: [] };
  const poorWeapon = { ...genItem('weapon', 9008, 20), rarity: Rarity.Rare, level: 20 } as Weapon;
  const coreWeapon = { ...genItem('weapon', 9009, 50), rarity: Rarity.Legendary, level: 50 } as Weapon;

  s.profiles = [
    profile({ id: P, scrap: 100_000, legendary_cores: 5 }),
    profile({ id: BROKE, scrap: 10, legendary_cores: 0 }),
    profile({ id: COREPOOR, scrap: 100_000, legendary_cores: 1 }),
  ];
  s.items = [
    rowFor(WPN, P, 'weapon', wpnPayload),
    rowFor(SHD, P, 'shield', epicShield),
    rowFor(EQD, P, 'weapon', rareWeapon, { runtime_state: 'equipped', equipped_slot: 'primary' }),
    rowFor(LST, P, 'relic', rareRelic, { runtime_state: 'listed' }),
    rowFor(SVC, P, 'ordnance', epicOrdnance, { runtime_state: 'in_service' }),
    rowFor(LCK, P, 'classMod', rareMod, { is_locked: true }),
    rowFor(MOD, P, 'weapon', moduleOnly),
    rowFor(VEH, P, 'vehicle', {
      id: 'veh-fixture', name: 'Dune Buggy', vehicleClassId: 'dune_buggy', level: 10,
      rarity: Rarity.Rare, sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 7,
      affixes: [{ id: 'speed_0', category: 'activity', stat: 'speed', value: 0.1, displayText: '+10% Speed' }],
    } as unknown as GearItem),
    rowFor(AFFLESS, P, 'weapon', affixless),
    rowFor(POORWPN, BROKE, 'weapon', poorWeapon),
    rowFor(COREWPN, COREPOOR, 'weapon', coreWeapon),
  ];
  return s;
}

interface Harness { store: InMemoryWriteStore; base: string; close: () => Promise<void>; tokens: Record<string, string> }
let h: Harness;
let nonceN = 0;
const nonce = () => `reforge-nonce-${++nonceN}-abcdefgh`;

async function makeServer(store?: InMemoryWriteStore): Promise<Harness> {
  const writeStore = store ?? new InMemoryWriteStore(writeSeed(), {
    now: () => new Date('2026-10-31T12:00:00.000Z'),
    rng: () => 0.5,
  });
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, writeStore, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((r) => server.on('listening', r));
  const { port } = server.address() as AddressInfo;
  const tokens: Record<string, string> = {};
  for (const id of [P, BROKE, COREPOOR]) tokens[id] = issueAccessToken(SECRET, id, false);
  return { store: writeStore, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())), tokens };
}

async function post(path: string, token: string, payload: unknown) {
  const res = await fetch(`${h.base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
const prof = (id: string) => h.store.seed.profiles.find((p) => p.id === id)!;
const itemRow = (id: string) => h.store.seed.items.find((i) => i.id === id)!;
const payloadOf = (id: string) => itemRow(id).payload as unknown as GearItem;
const firstPoolAffixId = (id: string) => payloadOf(id).affixes.find(isReforgeableAffix)!.id;

describe('reforge op — shipped write paths', () => {
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('happy path: a Legendary weapon reforges — scrap + 2 cores destroyed, effect untouched', async () => {
    const before = payloadOf(WPN);
    const affixId = firstPoolAffixId(WPN);
    const index = before.affixes.findIndex((a) => a.id === affixId);
    const cost = reforgeCostFor({ rarity: 'Legendary', level: 50 });
    const res = await post('/api/ops/reforge-item', h.tokens[P], { nonce: nonce(), item_id: WPN, affix_id: affixId });
    expect(res.status).toBe(200);
    expect(res.json.action_type).toBe('cc_reforge_item');
    expect(res.json.scrap_charged).toBe(cost.scrap);
    expect(res.json.cores_charged).toBe(2);
    expect(res.json.old_affix).toEqual(before.affixes[index]);
    expect(res.json.new_affix).not.toEqual(before.affixes[index]);
    expect(prof(P).scrap).toBe(100_000 - cost.scrap);
    expect(prof(P).legendary_cores).toBe(3);
    const after = payloadOf(WPN);
    expect(after.affixes[index]).toEqual(res.json.new_affix);
    expect(after.legendaryEffectId).toBe('glass_sun');
    expect(after.rarity).toBe('Legendary');
    expect(after.level).toBe(50);
    expect((after as Weapon).rollQuality).toBe((before as Weapon).rollQuality);
  });

  it('a non-legendary reforge charges scrap only — cores untouched', async () => {
    const affixId = firstPoolAffixId(SHD);
    const cost = reforgeCostFor({ rarity: 'Epic', level: 40 });
    const scrapBefore = prof(P).scrap;
    const res = await post('/api/ops/reforge-item', h.tokens[P], { nonce: nonce(), item_id: SHD, affix_id: affixId });
    expect(res.status).toBe(200);
    expect(res.json.cores_charged).toBe(0);
    expect(res.json.scrap_charged).toBe(cost.scrap);
    expect(prof(P).scrap).toBe(scrapBefore - cost.scrap);
    expect(prof(P).legendary_cores).toBe(3);
  });

  it('nonce idempotency: a replayed tap returns the recorded result and charges once', async () => {
    const affixId = firstPoolAffixId(SHD);
    const n = nonce();
    const scrapBefore = prof(P).scrap;
    const first = await post('/api/ops/reforge-item', h.tokens[P], { nonce: n, item_id: SHD, affix_id: affixId });
    expect(first.status).toBe(200);
    const second = await post('/api/ops/reforge-item', h.tokens[P], { nonce: n, item_id: SHD, affix_id: affixId });
    expect(second.status).toBe(200);
    expect(second.json).toEqual(first.json);
    expect(prof(P).scrap).toBe(scrapBefore - Number(first.json.scrap_charged));
  });

  it.each([
    ['equipped', EQD, 409, 'Item state invalid'],
    ['market-listed', LST, 409, 'Item state invalid'],
    ['escrowed in a service job', SVC, 409, 'Item state invalid'],
    ['locked', LCK, 400, 'Locked item'],
    ['vehicle (out of scope)', VEH, 400, 'Item cannot be reforged'],
  ])('eligibility: %s items are refused', async (_label, itemId, status, message) => {
    const affixId = payloadOf(itemId).affixes[0]?.id ?? 'whatever_0';
    const scrapBefore = prof(P).scrap;
    const res = await post('/api/ops/reforge-item', h.tokens[P], { nonce: nonce(), item_id: itemId, affix_id: affixId });
    expect(res.status).toBe(status);
    expect(res.json.message).toBe(message);
    expect(prof(P).scrap).toBe(scrapBefore);
  });

  it('eligibility: an activity module affix cannot be reforged', async () => {
    const res = await post('/api/ops/reforge-item', h.tokens[P], { nonce: nonce(), item_id: MOD, affix_id: 'activity_salvage_weapon' });
    expect(res.status).toBe(400);
    expect(res.json.message).toBe('Affix cannot be reforged');
  });

  it('eligibility: an affixless item has nothing to reforge', async () => {
    const res = await post('/api/ops/reforge-item', h.tokens[P], { nonce: nonce(), item_id: AFFLESS, affix_id: 'baseDamage_0' });
    expect(res.status).toBe(404);
    expect(res.json.message).toBe('Affix not found');
  });

  it('eligibility: another player\'s item does not exist for the caller', async () => {
    const res = await post('/api/ops/reforge-item', h.tokens[BROKE], { nonce: nonce(), item_id: WPN, affix_id: 'baseDamage_0' });
    expect(res.status).toBe(404);
    expect(res.json.message).toBe('Item not found');
  });

  it('insufficient scrap changes nothing', async () => {
    const before = structuredClone(payloadOf(POORWPN));
    const res = await post('/api/ops/reforge-item', h.tokens[BROKE], { nonce: nonce(), item_id: POORWPN, affix_id: firstPoolAffixId(POORWPN) });
    expect(res.status).toBe(400);
    expect(res.json.message).toBe('Insufficient scrap');
    expect(payloadOf(POORWPN)).toEqual(before);
    expect(prof(BROKE).scrap).toBe(10);
  });

  it('insufficient legendary cores changes nothing (scrap included)', async () => {
    const before = structuredClone(payloadOf(COREWPN));
    const res = await post('/api/ops/reforge-item', h.tokens[COREPOOR], { nonce: nonce(), item_id: COREWPN, affix_id: firstPoolAffixId(COREWPN) });
    expect(res.status).toBe(400);
    expect(res.json.message).toBe('Insufficient legendary cores');
    expect(payloadOf(COREWPN)).toEqual(before);
    expect(prof(COREPOOR).scrap).toBe(100_000);
    expect(prof(COREPOOR).legendary_cores).toBe(1);
  });

  it('collections interplay: reforging writes no discoveries and alters none', async () => {
    await h.store.recordDiscoveries(P, [
      { family: 'legendary_effect', entry_key: 'glass_sun', source: 'drop' },
      { family: 'weapon_frame', entry_key: 'Sniper:Prismatek', source: 'drop' },
    ]);
    const before = h.store.discoveriesFor(P).map((d) => `${d.family}:${d.entry_key}`).sort();
    const res = await post('/api/ops/reforge-item', h.tokens[P], { nonce: nonce(), item_id: WPN, affix_id: firstPoolAffixId(WPN) });
    expect(res.status).toBe(200);
    const after = h.store.discoveriesFor(P).map((d) => `${d.family}:${d.entry_key}`).sort();
    expect(after).toEqual(before);
  });

  it('the scrap lever prices the op through the store provider', async () => {
    const store = new InMemoryWriteStore(writeSeed(), {
      now: () => new Date('2026-10-31T12:00:00.000Z'),
      reforgeLeverProvider: () => ({ reforgeScrapScalar: 2 }),
    });
    const affixId = (store.seed.items.find((i) => i.id === SHD)!.payload as unknown as GearItem)
      .affixes.find(isReforgeableAffix)!.id;
    const result = await store.reforgeItem(P, 'lever-test-nonce-123456', SHD, affixId);
    expect(result.scrap_charged).toBe(reforgeCostFor({ rarity: 'Epic', level: 40 }).scrap * 2);
  });
});

// ─── Metrics ────────────────────────────────────────────────────────

describe('reforge — daily economy metrics', () => {
  it('reforge ledger rows move the reforge meters and extend cores spent exactly once', async () => {
    const store = new InMemoryWriteStore(writeSeed(), { now: () => new Date('2026-10-31T12:00:00.000Z') });
    const wpnAffix = (store.seed.items.find((i) => i.id === WPN)!.payload as unknown as GearItem)
      .affixes.find(isReforgeableAffix)!.id;
    const shdAffix = (store.seed.items.find((i) => i.id === SHD)!.payload as unknown as GearItem)
      .affixes.find(isReforgeableAffix)!.id;
    const r1 = await store.reforgeItem(P, 'metrics-nonce-00000001', WPN, wpnAffix);
    const r2 = await store.reforgeItem(P, 'metrics-nonce-00000002', SHD, shdAffix);
    // The economy store reads the same ledger shape the SQL metrics
    // read (verified_action_ledger rows carry created_at in SQL).
    const economy = new InMemoryEconomyStore({
      ledger: [r1, r2].map((result_payload) => ({
        action_type: 'cc_reforge_item',
        created_at: '2026-10-31T12:00:00.000Z',
        result_payload: result_payload as Record<string, unknown>,
      })),
      items: [],
      config: {},
    });
    const row = await economy.computeMetricsForDay('2026-10-31');
    expect(row.reforgesCompleted).toBe(2);
    expect(row.scrapDestroyedReforge).toBe(Number(r1.scrap_charged) + Number(r2.scrap_charged));
    expect(row.legendaryCoresDestroyedReforge).toBe(2);
    expect(row.legendaryCoresSpent).toBe(2); // extended, not double-counted
    expect(row.creditsDestroyedTotal).toBe(0); // scrap is not a credits meter
  });
});

// ─── Migration parity ───────────────────────────────────────────────

describe('migration 0027 — SQL parity with the TS owners', () => {
  const sql = readFileSync(resolve(process.cwd(), 'db/migrations/0027_reforge.sql'), 'utf8');

  it('carries the applier, the lever reads, and the validation vocabulary', () => {
    expect(sql).toContain('cc_reforge_item');
    expect(sql).toContain("cc_economy_config_number('reforgeScrapScalar', 1)");
    expect(sql).toContain("cc_economy_config_number('reforgeLegendaryCoreCost', 2)");
    expect(sql).toContain('cc_salvage_scrap(item.rarity, item.item_level) * 3');
    for (const message of ['Item not found', 'Locked item', 'Item state invalid', 'Item cannot be reforged', 'Affix not found', 'Affix cannot be reforged', 'Insufficient scrap', 'Insufficient legendary cores']) {
      expect(sql).toContain(`raise exception '${message}'`);
    }
  });

  it('meters reforge from the ledger and extends cores spent once', () => {
    expect(sql).toContain('reforges_completed');
    expect(sql).toContain('scrap_destroyed_reforge');
    expect(sql).toContain('legendary_cores_destroyed_reforge');
    expect(sql).toContain("(result_payload ->> 'cores_charged')::bigint");
    expect(sql).toContain("(result_payload ->> 'scrap_charged')::bigint");
    expect(sql).toContain("action_type = 'cc_reforge_item'");
  });

  it('pins the identity invariants in the applier', () => {
    expect(sql).toContain("'legendaryEffectId'");
    expect(sql).toContain("'rollQuality'");
    expect(sql).toContain('cc_compute_item_estimated_value');
    expect(sql).toContain('APPLY ORDER');
  });
});
