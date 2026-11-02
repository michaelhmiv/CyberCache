import { describe, expect, it } from 'vitest';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { LEGENDARY_EFFECTS } from '@/constants/legendaryEffects';
import { bespokeSpriteIdForLegendaryEffect } from '@/lib/pixel/manifest';
import { createRNG } from '@/lib/utils/rng';
import { DropSource, Rarity, WeaponType } from '@/types/game';

/**
 * S5 — legendary drops match their art (owner's ruling 2026-11-02).
 *
 * Every legendary effect has a bespoke sprite, and the sprite depicts
 * one specific weapon type (the def's `weaponType`, classified from
 * the shipped art). Generation resolves the effect before the type
 * roll and pins the type to the depicted one, so the sprite, the
 * loot card, and the item record can never disagree. These tests pin
 * that contract per effect, plus the boundaries around it: the pin
 * outranks a forced type, sources whose effect pool is empty assign
 * nothing, and non-legendary generation is bit-identical to before
 * (frozen stream pins at the bottom).
 */

const EFFECT_BY_ID = new Map(LEGENDARY_EFFECTS.map((eff) => [eff.id, eff]));

describe('legendary type match — the table', () => {
  it('covers exactly the 25 effects, each with a depicted type and a bespoke sprite', () => {
    expect(LEGENDARY_EFFECTS).toHaveLength(25);
    const types = Object.values(WeaponType);
    for (const eff of LEGENDARY_EFFECTS) {
      expect(types, `${eff.id} weaponType`).toContain(eff.weaponType);
      // The table's whole justification is the art: every effect in
      // it must resolve to a bespoke sprite.
      expect(bespokeSpriteIdForLegendaryEffect(eff.id), `${eff.id} sprite`).toBeTruthy();
    }
  });
});

describe('legendary type match — generation', () => {
  it('every effect drops as its depicted type across seeded rolls (boss path)', () => {
    for (const eff of LEGENDARY_EFFECTS) {
      for (const seed of [11, 222, 3333]) {
        const weapon = generateWeapon(
          {
            source: DropSource.BossDrop,
            level: 30,
            bossTier: 10,
            forcedRarity: Rarity.Legendary,
            forcedLegendaryEffectId: eff.id,
          },
          createRNG(seed),
        );
        expect(weapon.legendaryEffectId, `${eff.id} seed ${seed}`).toBe(eff.id);
        expect(weapon.weaponType, `${eff.id} seed ${seed}`).toBe(eff.weaponType);
      }
    }
  });

  it('the cache-forged-eligible subset is pinned on the CacheForged source too', () => {
    // Generator-level contract. (In the shipped game the forge paths
    // strip legendaryEffectId afterwards, so forged weapons still
    // never carry one — that invariant lives in craftGear and is
    // unchanged by the pin.)
    const cacheEligible = LEGENDARY_EFFECTS.filter((eff) => eff.eligibleSources.includes(DropSource.CacheForged));
    expect(cacheEligible.length).toBeGreaterThan(0);
    for (const eff of cacheEligible) {
      const weapon = generateWeapon(
        {
          source: DropSource.CacheForged,
          level: 30,
          forcedRarity: Rarity.Legendary,
          forcedLegendaryEffectId: eff.id,
        },
        createRNG(5),
      );
      expect(weapon.legendaryEffectId, eff.id).toBe(eff.id);
      expect(weapon.weaponType, eff.id).toBe(eff.weaponType);
    }
  });

  it('unforced legendary rolls always carry an effect, always on its depicted type', () => {
    const seenEffects = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const weapon = generateWeapon(
        { source: DropSource.BossDrop, level: 45, bossTier: 10, forcedRarity: Rarity.Legendary },
        createRNG(seed),
      );
      expect(weapon.legendaryEffectId).toBeTruthy();
      const eff = EFFECT_BY_ID.get(weapon.legendaryEffectId!);
      expect(eff, `seed ${seed}`).toBeTruthy();
      expect(weapon.weaponType, `${weapon.legendaryEffectId} seed ${seed}`).toBe(eff!.weaponType);
      seenEffects.add(weapon.legendaryEffectId!);
    }
    // 300 uniform draws over a 25-effect pool see ~all of it; a loose
    // floor keeps the test about coverage, not luck.
    expect(seenEffects.size).toBeGreaterThanOrEqual(15);
  });

  it('the art pin outranks an explicit forcedType when an effect is assigned', () => {
    const weapon = generateWeapon(
      {
        source: DropSource.BossDrop,
        level: 30,
        bossTier: 10,
        forcedRarity: Rarity.Legendary,
        forcedLegendaryEffectId: 'bad_decision',
        forcedType: WeaponType.Sniper,
      },
      createRNG(9),
    );
    expect(weapon.legendaryEffectId).toBe('bad_decision');
    expect(weapon.weaponType).toBe(WeaponType.Shotgun);
  });

  it('sources with an empty effect pool assign no effect and roll type freely', () => {
    for (const source of [DropSource.WorldDrop, DropSource.Crafted, DropSource.Marketplace, DropSource.Event]) {
      for (let seed = 1; seed <= 25; seed++) {
        const weapon = generateWeapon(
          { source, level: 20, forcedRarity: Rarity.Legendary },
          createRNG(seed),
        );
        expect(weapon.legendaryEffectId, `${source} seed ${seed}`).toBeUndefined();
      }
    }
  });
});

/**
 * Stream-preservation pins, captured from the generator BEFORE the
 * S5 change (id and pixelSeed stripped — both are ambient per
 * generation, not stream products). If a future edit so much as
 * reorders an RNG draw on the non-legendary path, these fail.
 */
const STREAM_PINS: Record<string, { options: Parameters<typeof generateWeapon>[0]; seed: number; expected: unknown }> = {
  'epic-world-42': {
    options: { source: DropSource.WorldDrop, level: 25, forcedRarity: Rarity.Epic },
    seed: 42,
    expected: {"name":"Null BlastForge Needle Mk.I","level":25,"rarity":"Epic","weaponType":"Sniper","manufacturer":"BlastForge","element":"Void","rollQuality":84,"baseDamage":978,"attackSpeed":1.27,"critChance":0.673,"critDamage":6.032,"statusChance":0.139,"statusDamage":2.8,"bossDamageMod":1.283,"waveDamageMod":0.75,"shieldDamageMod":1,"armorDamageMod":1.375,"offlineEarningsMod":0,"rareDropChanceMod":0,"scrapYieldMod":0,"parts":[{"slot":"Barrel","modifier":{"statusChance":0.955}},{"slot":"Grip","modifier":{"critDamage":0.975}},{"slot":"Core","modifier":{"critDamage":1.093}},{"slot":"Magazine","modifier":{"critChance":0.97}},{"slot":"Sight","modifier":{"bossDamageMod":1.069}},{"slot":"Chamber","modifier":{"attackSpeed":0.959}}],"affixes":[{"id":"attackSpeed_0","category":"combat","stat":"attackSpeed","value":0.03,"displayText":"+3% Attack Speed"},{"id":"waveDamageMod_1","category":"combat","stat":"waveDamageMod","value":0.05,"displayText":"+5% Wave Damage"},{"id":"baseDamage_2","category":"combat","stat":"baseDamage","value":0.05,"displayText":"+5% Damage"},{"id":"activity_salvaging_weapon","category":"activity","stat":"salvagingModule","value":0.967532093974296,"subStats":{"salvageYield":0.227,"rareMaterialChance":0.075,"essenceExtraction":0.097,"explosiveSalvage":0.239,"precisionExtraction":0.063},"displayText":"Salvage Module [97%] · +22.7% Salvage Yield · +7.5% Rare Material · +9.7% Essence Yield"}],"sourceTag":"World Drop","isLocked":false,"combatPower":7018,"bossPower":29421,"farmPower":15401,"economyScore":0},
  },
  'rare-boss-7': {
    options: { source: DropSource.BossDrop, level: 40, bossTier: 4, forcedRarity: Rarity.Rare },
    seed: 7,
    expected: {"name":"Dark Velocity Handcannon Spec","level":40,"rarity":"Rare","weaponType":"Pistol","manufacturer":"Redline","element":"Void","rollQuality":93,"baseDamage":453.879,"attackSpeed":6.04,"critChance":0.396,"critDamage":5.744,"statusChance":0.329,"statusDamage":4.75,"bossDamageMod":1,"waveDamageMod":1,"shieldDamageMod":1,"armorDamageMod":1,"offlineEarningsMod":0,"rareDropChanceMod":0,"scrapYieldMod":0.08,"parts":[{"slot":"Barrel","modifier":{"statusChance":1.024}},{"slot":"Grip","modifier":{"critChance":1.013}},{"slot":"Core","modifier":{"attackSpeed":1.031}},{"slot":"Magazine","modifier":{"statusChance":0.972}},{"slot":"Sight","modifier":{"baseDamage":1.073}},{"slot":"Chamber","modifier":{"critDamage":0.959}}],"affixes":[{"id":"attackSpeed_0","category":"combat","stat":"attackSpeed","value":0.05,"displayText":"+5% Attack Speed"},{"id":"scrapYieldMod_1","category":"idle","stat":"scrapYieldMod","value":0.08,"displayText":"+8% Scrap Yield"},{"id":"activity_salvaging_weapon","category":"activity","stat":"salvagingModule","value":0.8936426819651387,"subStats":{"salvageYield":0.267,"rareMaterialChance":0.081,"essenceExtraction":0.073},"displayText":"Salvage Module [89%] · +26.7% Salvage Yield · +8.1% Rare Material · +7.3% Essence Yield"}],"sourceTag":"Boss Drop","isLocked":false,"combatPower":13186,"bossPower":44569,"farmPower":58229,"economyScore":8},
  },
  'common-world-99': {
    options: { source: DropSource.WorldDrop, level: 3, forcedRarity: Rarity.Common },
    seed: 99,
    expected: {"name":"Venom Deploy Drum Blueprints","level":3,"rarity":"Common","weaponType":"SMG","manufacturer":"ThrowTech","element":"Corrosive","rollQuality":77,"baseDamage":46.192,"attackSpeed":2.27,"critChance":0.088,"critDamage":1.58,"statusChance":0.114,"statusDamage":1.22,"bossDamageMod":0.95,"waveDamageMod":1.38,"shieldDamageMod":1.05,"armorDamageMod":0.9,"offlineEarningsMod":0,"rareDropChanceMod":0,"scrapYieldMod":0,"parts":[{"slot":"Barrel","modifier":{"statusChance":0.92}},{"slot":"Grip","modifier":{"statusChance":0.922}},{"slot":"Core","modifier":{"baseDamage":0.999}},{"slot":"Magazine","modifier":{"statusChance":0.993}},{"slot":"Sight","modifier":{"baseDamage":0.988}},{"slot":"Chamber","modifier":{"statusChance":0.971}}],"affixes":[],"sourceTag":"World Drop","isLocked":false,"combatPower":124,"bossPower":404,"farmPower":429,"economyScore":0},
  },
};

describe('legendary type match — non-legendary generation is unchanged', () => {
  it('seeded non-legendary weapons are bit-identical to the pre-change stream', () => {
    for (const [label, pin] of Object.entries(STREAM_PINS)) {
      const weapon = generateWeapon(pin.options, createRNG(pin.seed));
      const { id: _id, pixelSeed: _pixelSeed, ...stripped } = weapon;
      expect(stripped, label).toEqual(pin.expected);
    }
  });

  it('non-legendary type distribution stays uniform over the six types', () => {
    const counts = new Map<WeaponType, number>();
    const rolls = 1200;
    for (let seed = 1; seed <= rolls; seed++) {
      const weapon = generateWeapon(
        { source: DropSource.WorldDrop, level: 20, forcedRarity: Rarity.Epic },
        createRNG(seed * 7919),
      );
      expect(weapon.legendaryEffectId).toBeUndefined();
      counts.set(weapon.weaponType, (counts.get(weapon.weaponType) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    // Expected 200 per type; the band is ~±6 sigma, so this fails on
    // real skew, never on luck.
    for (const [type, count] of counts) {
      expect(count, type).toBeGreaterThanOrEqual(120);
      expect(count, type).toBeLessThanOrEqual(280);
    }
  });
});
