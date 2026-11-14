import { describe, expect, it } from 'vitest';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { enemyDropHold } from '@/lib/pixel/roamChoreography';
import type { TickEvent } from '@/store/slices/tickSlice';

const makeWeapon = (overrides: Partial<Weapon> = {}): Weapon =>
  ({
    id: 'w-1',
    name: 'Volt Carbine',
    level: 7,
    rarity: Rarity.Rare,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Prismatek,
    element: Element.Shock,
    rollQuality: 62,
    baseDamage: 2847,
    attackSpeed: 6.2,
    critChance: 0.15,
    critDamage: 150,
    statusChance: 20,
    statusDamage: 45,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 0,
    armorDamageMod: 0,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 7,
    combatPower: 100,
    bossPower: 90,
    farmPower: 80,
    economyScore: 10,
    ...overrides,
  }) as Weapon;

const event = (overrides: Partial<TickEvent>): TickEvent => ({
  id: 'tick:1',
  at: Date.now(),
  tone: 'loot',
  label: 'Volt Carbine',
  detail: 'Rare SMG',
  ...overrides,
});

const gearEvent = () => event({ tone: 'loot', label: 'Volt Carbine', gear: makeWeapon() });

describe('enemyDropHold — the enemy slot holds empty for a standing drop', () => {
  it('holds for a gear drop even when the store already advanced to a full-HP target', () => {
    expect(enemyDropHold(gearEvent(), 60)).toBe('gear');
  });

  it('holds for a gear drop over a corpse target', () => {
    expect(enemyDropHold(gearEvent(), 0)).toBe('gear');
  });

  it('holds for a material rise over a corpse', () => {
    expect(enemyDropHold(event({ tone: 'material', label: 'Scrap Cache', detail: 'material' }), 0)).toBe('material');
  });

  it('does not hold for a material rise over a living target', () => {
    expect(enemyDropHold(event({ tone: 'material', label: 'Scrap Cache', detail: 'material' }), 40)).toBeNull();
  });

  it('holds for a kill event (the scrap payout belongs to the corpse)', () => {
    // lootMoment maps tone 'kill' → 'scrap', a non-crate rise.
    expect(enemyDropHold(event({ tone: 'kill', label: 'Brute felled', detail: '+12 XP' }), 0)).toBe('material');
  });

  it('does not hold for a kill payout over a living enemy', () => {
    expect(enemyDropHold(event({ tone: 'kill', label: 'Brute felled', detail: '+12 XP' }), 40)).toBeNull();
  });

  it('holds nothing for a non-drop tick or a missing event', () => {
    // 'shot' is not a drop tone — the rise mapping falls through to null.
    const shot = { id: 'tick:shot', at: Date.now(), tone: 'shot', label: '-12', detail: 'hit' } as unknown as TickEvent;
    expect(enemyDropHold(shot, 0)).toBeNull();
    expect(enemyDropHold(null, 0)).toBeNull();
    expect(enemyDropHold(undefined, undefined)).toBeNull();
  });
});
