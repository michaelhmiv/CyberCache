import { describe, expect, it } from 'vitest';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { LEGENDARY_EFFECTS } from '@/constants/legendaryEffects';
import {
  BESPOKE_LEGENDARY_SPRITES,
  bespokeSpriteIdForLegendaryEffect,
  bespokeSpriteIdForWeapon,
  getPixelSprite,
  normalizeLegendaryName,
} from '@/lib/pixel/manifest';
import { LEGENDARY_FLAVOR_OVERRIDES, legendaryFlavorOverride, lootCardData, lootFlavor } from '@/lib/pixel/lootMoment';

/**
 * P4 wave 2 — bespoke legendary coverage.
 *
 * The game's named legendaries are the effects in LEGENDARY_EFFECTS: a
 * legendary weapon's named identity is the effect it carries (its rolled
 * name is procedural). Every named legendary must resolve to a bespoke
 * sprite AND a hand-written flavor line; anything else keeps the
 * compositor / effect-description fallbacks.
 */

const makeWeapon = (overrides: Partial<Weapon> = {}): Weapon =>
  ({
    id: 'w-leg',
    name: 'Scorched HelixWorks Rail Prototype',
    level: 12,
    rarity: Rarity.Legendary,
    weaponType: WeaponType.Sniper,
    manufacturer: Manufacturer.HelixWorks,
    element: Element.Fire,
    rollQuality: 88,
    baseDamage: 3214,
    attackSpeed: 1.4,
    critChance: 22,
    critDamage: 210,
    statusChance: 30,
    statusDamage: 60,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 0,
    armorDamageMod: 0,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: DropSource.BossDrop,
    isLocked: false,
    pixelSeed: 11,
    combatPower: 500,
    bossPower: 480,
    farmPower: 300,
    economyScore: 90,
    ...overrides,
  }) as Weapon;

describe('named legendary enumeration — game data', () => {
  it('the named legendary set is the LEGENDARY_EFFECTS table (25)', () => {
    expect(LEGENDARY_EFFECTS.length).toBe(25);
    expect(new Set(LEGENDARY_EFFECTS.map((effect) => effect.id)).size).toBe(25);
    expect(new Set(LEGENDARY_EFFECTS.map((effect) => normalizeLegendaryName(effect.name))).size).toBe(25);
  });
});

describe('bespoke sprite coverage — every named legendary resolves', () => {
  it('every legendary effect resolves to a registered weapon-legendary sprite', () => {
    for (const effect of LEGENDARY_EFFECTS) {
      const spriteId = bespokeSpriteIdForLegendaryEffect(effect.id);
      expect(spriteId, `${effect.id} (${effect.name}) has no bespoke sprite`).toBeDefined();
      expect(getPixelSprite(spriteId!)?.kind, `${effect.id} sprite kind`).toBe('weapon-legendary');
    }
  });

  it('the bespoke map covers exactly the 25 effect names plus Emberfall', () => {
    const keys = Object.keys(BESPOKE_LEGENDARY_SPRITES);
    expect(keys.length).toBe(26);
    for (const effect of LEGENDARY_EFFECTS) {
      expect(keys).toContain(normalizeLegendaryName(effect.name));
    }
    expect(keys).toContain('emberfall');
  });

  it('a dropped legendary resolves its bespoke sprite through its effect, not its rolled name', () => {
    for (const effect of LEGENDARY_EFFECTS) {
      const dropped = makeWeapon({ legendaryEffectId: effect.id });
      expect(bespokeSpriteIdForWeapon(dropped), `${effect.id} drop resolution`).toBe(
        bespokeSpriteIdForLegendaryEffect(effect.id),
      );
      expect(lootCardData(dropped).bespokeSpriteId, `${effect.id} card resolution`).toBe(
        bespokeSpriteIdForLegendaryEffect(effect.id),
      );
    }
  });

  it('a weapon carrying the legendary name itself wins over its effect', () => {
    const emberfall = makeWeapon({ name: 'Emberfall', legendaryEffectId: 'glass_sun' });
    expect(bespokeSpriteIdForWeapon(emberfall)).toBe('legendary-emberfall');
    expect(lootCardData(emberfall).bespokeSpriteId).toBe('legendary-emberfall');
  });

  it('fallbacks stay intact for anything that is not a named legendary', () => {
    expect(bespokeSpriteIdForLegendaryEffect(undefined)).toBeUndefined();
    expect(bespokeSpriteIdForLegendaryEffect('not_a_real_effect')).toBeUndefined();
    expect(bespokeSpriteIdForWeapon(makeWeapon({ legendaryEffectId: undefined }))).toBeUndefined();
    expect(bespokeSpriteIdForWeapon(makeWeapon({ legendaryEffectId: 'not_a_real_effect' }))).toBeUndefined();
    expect(lootCardData(makeWeapon({ rarity: Rarity.Epic, legendaryEffectId: undefined })).bespokeSpriteId).toBeUndefined();
  });
});

describe('flavor overrides — every named legendary has its line', () => {
  it('every legendary effect name has a hand-written override, distinct from its description', () => {
    for (const effect of LEGENDARY_EFFECTS) {
      const line = legendaryFlavorOverride(effect.name);
      expect(line, `${effect.id} (${effect.name}) has no flavor override`).toBeDefined();
      expect(line).not.toBe(effect.description);
      expect(line!.length).toBeGreaterThan(10);
    }
  });

  it('the flavor map covers exactly the 25 effect names plus Emberfall', () => {
    const keys = Object.keys(LEGENDARY_FLAVOR_OVERRIDES);
    expect(keys.length).toBe(26);
    for (const effect of LEGENDARY_EFFECTS) {
      expect(keys).toContain(normalizeLegendaryName(effect.name));
    }
    expect(LEGENDARY_FLAVOR_OVERRIDES.emberfall).toBe('Sets the sky on fire. Literally.');
  });

  it('a dropped legendary’s card carries its override line, not the effect description', () => {
    for (const effect of LEGENDARY_EFFECTS) {
      const dropped = makeWeapon({ legendaryEffectId: effect.id });
      expect(lootFlavor(dropped), `${effect.id} flavor`).toBe(legendaryFlavorOverride(effect.name));
      expect(lootCardData(dropped).flavor, `${effect.id} card flavor`).toBe(legendaryFlavorOverride(effect.name));
    }
  });

  it('the name override wins for Emberfall; unknown legendaries fall back cleanly', () => {
    const emberfall = makeWeapon({ name: 'Emberfall', legendaryEffectId: 'glass_sun' });
    expect(lootFlavor(emberfall)).toBe('Sets the sky on fire. Literally.');
    // Unknown effect id: no override, no description — no flavor, never a crash.
    expect(lootFlavor(makeWeapon({ legendaryEffectId: 'not_a_real_effect' }))).toBeUndefined();
    // Non-legendaries never get a flavor line.
    expect(lootFlavor(makeWeapon({ rarity: Rarity.Epic, legendaryEffectId: 'glass_sun' }))).toBeUndefined();
    expect(legendaryFlavorOverride('Some Procedural Rifle')).toBeUndefined();
    expect(legendaryFlavorOverride(undefined)).toBeUndefined();
  });
});
