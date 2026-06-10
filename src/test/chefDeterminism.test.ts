/**
 * Chef Determinism Tests
 *
 * Verifies that the Chef's item generation is deterministic — the same
 * (playerId, areaId, tickCount) tuple always produces the same items
 * when using the same RNG seed (Mulberry32).
 */

import { describe, it, expect } from 'vitest';
import { createTickRng } from '@/lib/rng/tickRng';
import { generateWeapon } from '@/lib/generators/weaponGenerator';
import { generateShield } from '@/lib/generators/shieldGenerator';
import { generateClassMod } from '@/lib/generators/classModGenerator';
import { generateRelic } from '@/lib/generators/relicGenerator';
import { generateOrdnance } from '@/lib/generators/ordnanceGenerator';
describe('Chef determinism', () => {
  const PLAYER = '00000000-0000-0000-0000-000000000001';
  const AREA = 'dustwaste_frontier';
  const TICK = 42;

  it('same seed produces identical RNG stream', () => {
    const a = createTickRng(PLAYER, AREA, TICK);
    const b = createTickRng(PLAYER, AREA, TICK);

    for (let i = 0; i < 20; i++) {
      expect(a()).toBe(b());
    }
  });

  it('different tick produces different RNG stream', () => {
    const a = createTickRng(PLAYER, AREA, 42);
    const b = createTickRng(PLAYER, AREA, 43);
    expect(a()).not.toBe(b());
  });

  it('different player produces different RNG stream', () => {
    const a = createTickRng(PLAYER, AREA, TICK);
    const b = createTickRng('ffffffff-ffff-ffff-ffff-ffffffffffff', AREA, TICK);
    expect(a()).not.toBe(b());
  });

  it('weapon generator produces deterministically with same RNG', () => {
    // Use explicit options (no buildAreaWeaponDropOptions, which consumes
    // variable RNG calls depending on area bias rolls)
    const rng1 = createTickRng(PLAYER, AREA, TICK);
    const rng2 = createTickRng(PLAYER, AREA, TICK);

    const opts = {
      source: 'World Drop' as const,
      level: 5,
      forcedType: undefined,
      forcedRarity: undefined,
    };

    const a = generateWeapon(opts, rng1);
    const b = generateWeapon(opts, rng2);

    // Same opts + same RNG seed → same weapon
    expect(a.name).toBe(b.name);
    expect(a.rarity).toBe(b.rarity);
    expect(a.weaponType).toBe(b.weaponType);
    expect(a.manufacturer).toBe(b.manufacturer);
    expect(a.element).toBe(b.element);
    expect(a.baseDamage).toBe(b.baseDamage);
    expect(a.combatPower).toBe(b.combatPower);
  });

  it('shield generator produces deterministically', () => {
    const rng1 = createTickRng(PLAYER, AREA, TICK);
    const rng2 = createTickRng(PLAYER, AREA, TICK);

    const a = generateShield(5, rng1);
    const b = generateShield(5, rng2);

    expect(a.name).toBe(b.name);
    expect(a.rarity).toBe(b.rarity);
    expect(a.hp).toBe(b.hp);
    expect(a.element).toBe(b.element);
  });

  it('classMod generator produces deterministically', () => {
    const rng1 = createTickRng(PLAYER, AREA, TICK);
    const rng2 = createTickRng(PLAYER, AREA, TICK);

    const a = generateClassMod(5, rng1);
    const b = generateClassMod(5, rng2);

    expect(a.name).toBe(b.name);
    expect(a.rarity).toBe(b.rarity);
    expect(a.treeBonus).toBe(b.treeBonus);
  });

  it('relic generator produces deterministically', () => {
    const rng1 = createTickRng(PLAYER, AREA, TICK);
    const rng2 = createTickRng(PLAYER, AREA, TICK);

    const a = generateRelic(5, rng1);
    const b = generateRelic(5, rng2);

    expect(a.name).toBe(b.name);
    expect(a.rarity).toBe(b.rarity);
    expect(a.affixes.length).toBe(b.affixes.length);
  });

  it('ordnance generator produces deterministically', () => {
    const rng1 = createTickRng(PLAYER, AREA, TICK);
    const rng2 = createTickRng(PLAYER, AREA, TICK);

    const a = generateOrdnance(5, rng1);
    const b = generateOrdnance(5, rng2);

    expect(a.name).toBe(b.name);
    expect(a.rarity).toBe(b.rarity);
    expect(a.damage).toBe(b.damage);
    expect(a.element).toBe(b.element);
    expect(a.effect).toBe(b.effect);
  });
});
