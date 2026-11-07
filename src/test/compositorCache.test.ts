/**
 * Compositor cache regression pin (2026-11-04 Gear tab freeze).
 *
 * The *Cached compositor wrappers keyed their lookup on the render's
 * own signature — a hash of the composed pixel rows, which cannot
 * exist before composition — so every call composed in full first
 * and the cache never hit. On a deep inventory every Gear mount
 * repaid ~26ms of card-density composition per weapon and the tab
 * froze for seconds (one 14.9s longtask at 385 items, measured).
 *
 * These tests pin the two properties the design promises:
 *   1. Identical input returns the identical render object, and a
 *      determinant-field change returns a different render (the key
 *      is exact — no wrong-art sharing).
 *   2. A warm pass over already-composed inputs is near-free
 *      compared with the cold pass. Pre-fix the warm pass cost
 *      ~70% of the cold pass; the bound below sits far from both
 *      regimes so it is stable on shared CI hardware.
 */
import { describe, expect, it } from 'vitest';
import {
  composeWeaponCardCached,
  type WeaponCardRender,
} from '@/lib/pixel/weaponCardCompositor';
import {
  composePixelWeaponCached,
} from '@/lib/pixel/weaponCompositor';
import { composeGearCached } from '@/lib/pixel/gearCardCompositor';
import { composeMaterialCached } from '@/lib/pixel/materialArt';
import { composeConsumableCached } from '@/lib/pixel/consumableArt';
import { smallItemCached } from '@/lib/pixel/smallItemCore';
import { GEAR_GRAMMARS } from '@/lib/pixel/gearDispatch';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';

function weaponInput(seed: number): PixelWeaponInput {
  return {
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.BlastForge,
    rarity: Rarity.Rare,
    element: Element.Fire,
    id: `cache-pin-${seed}`,
    pixelSeed: seed,
    rollQuality: 80,
    parts: [
      { slot: 'Barrel', modifier: { critDamage: 0.97 } },
      { slot: 'Grip', modifier: { critChance: 0.95 } },
      { slot: 'Core', modifier: { baseDamage: 1.02 } },
    ] as PixelWeaponInput['parts'],
    affixes: [] as PixelWeaponInput['affixes'],
  };
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('compositor caches actually hit', () => {
  it('weapon card: identical input returns the identical render object', () => {
    const a = composeWeaponCardCached(weaponInput(101));
    const b = composeWeaponCardCached(clone(weaponInput(101)));
    expect(b).toBe(a);
    expect(b.signature).toBe(a.signature);
  });

  it('weapon card: a determinant change returns a different render', () => {
    const a = composeWeaponCardCached(weaponInput(102));
    const hotter = weaponInput(102);
    hotter.rarity = Rarity.Legendary;
    const b = composeWeaponCardCached(hotter);
    expect(b).not.toBe(a);
    expect(b.signature).not.toBe(a.signature);
  });

  it('weapon card: a warm pass is near-free next to the cold pass', () => {
    const inputs = Array.from({ length: 30 }, (_, i) => weaponInput(1000 + i));
    const coldStart = performance.now();
    const cold: WeaponCardRender[] = inputs.map((input) => composeWeaponCardCached(input));
    const coldMs = performance.now() - coldStart;

    const warmStart = performance.now();
    const warm = inputs.map((input) => composeWeaponCardCached(clone(input)));
    const warmMs = performance.now() - warmStart;

    warm.forEach((render, i) => expect(render).toBe(cold[i]));
    // Pre-fix regime: warmMs ≈ 0.7 × coldMs. Fixed regime: warmMs is
    // a map lookup per item — orders of magnitude below coldMs.
    expect(warmMs).toBeLessThan(Math.max(coldMs / 5, 25));
  });

  it('weapon stage: identical input returns the identical render object', () => {
    const a = composePixelWeaponCached(weaponInput(103));
    const b = composePixelWeaponCached(clone(weaponInput(103)));
    expect(b).toBe(a);
    const hotter = weaponInput(103);
    hotter.rarity = Rarity.Legendary;
    const other = composePixelWeaponCached(hotter);
    expect(other).not.toBe(a);
    expect(other.signature).not.toBe(a.signature);
  });

  it('gear: identical input returns the identical render object per grammar + density', () => {
    const grammar = GEAR_GRAMMARS.shield;
    const input = {
      kind: 'shield' as const,
      rarity: Rarity.Epic,
      element: Element.Shock,
      seed: 4242,
      pips: 3,
    };
    const a = composeGearCached(clone(input), grammar, 'card');
    const b = composeGearCached(clone(input), grammar, 'card');
    expect(b).toBe(a);
    const thumb = composeGearCached(clone(input), grammar, 'thumb');
    expect(thumb).not.toBe(a);
    const reseeded = composeGearCached({ ...input, seed: 4243 }, grammar, 'card');
    expect(reseeded.signature).not.toBe(a.signature);
  });

  it('material: identical (id, density) returns the identical render object', () => {
    const a = composeMaterialCached('Scrap', 'object');
    const b = composeMaterialCached('Scrap', 'object');
    expect(b).toBe(a);
    const thumb = composeMaterialCached('Scrap', 'thumb');
    expect(thumb).not.toBe(a);
  });

  it('consumable: identical (id, density) returns the identical render object', () => {
    const a = composeConsumableCached('MedKit', 'object');
    const b = composeConsumableCached('MedKit', 'object');
    expect(b).toBe(a);
    const thumb = composeConsumableCached('MedKit', 'thumb');
    expect(thumb).not.toBe(a);
  });

  it('small-item core cache composes once per input key (S4: the consumable cache fix)', () => {
    // consumableArt's pre-S4 cache was signature-keyed — it composed
    // in full before every lookup and never hit. The shared core
    // helper is input-keyed; this counter pins the mechanism itself,
    // not just object identity (identity alone passed pre-fix too).
    const cache = new Map<string, { n: number }>();
    let composes = 0;
    const compose = () => ({ n: ++composes });
    const a = smallItemCached(cache, 'object|MedKit', compose);
    const b = smallItemCached(cache, 'object|MedKit', compose);
    expect(b).toBe(a);
    expect(composes).toBe(1);
    smallItemCached(cache, 'thumb|MedKit', compose);
    expect(composes).toBe(2);
  });
});
