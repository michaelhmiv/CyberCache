import { describe, it, expect } from 'vitest';
import { isItemCompatibleWithSlot } from '@/lib/loadout/loadoutSlotCompat';
import type { GearItem, Weapon, Shield, ClassMod, Relic, Ordnance } from '@/types/items';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

// This test verifies that the client-side isItemCompatibleWithSlot function
// matches the server-side cc_item_accepts_slot SQL rules. The SQL rules are:
//   primary/secondary/heavy → payload ? 'weaponType'
//   shield                   → payload ? 'hp' and not payload ? 'weaponType'
//   classMod                 → payload ? 'treeBonus'
//   ordnance                 → payload ? 'damage' and payload ? 'effect' and not payload ? 'weaponType'
//   relic                    → payload ? 'affixes' and not weaponType/hp/treeBonus/damage

// Minimal mock items — only the discriminator fields matter for slot compat.
const weapon = { weaponType: 'Pistol', id: 'w1' } as unknown as Weapon;
const shield = { hp: 100, id: 's1' } as unknown as Shield;
const classMod = { treeBonus: 'Gunslinger', id: 'c1' } as unknown as ClassMod;
const relic = { affixes: [], id: 'r1' } as unknown as Relic;
const ordnance = { damage: 50, effect: 'explode', id: 'o1' } as unknown as Ordnance;

// An item with only 'odds' (broken cache draw) — should be rejected by all slots.
const oddsOnly = { odds: { outcome: 'Rare' }, id: 'x1' } as unknown as GearItem;

const allSlots: LoadoutSlot[] = ['primary', 'secondary', 'heavy', 'shield', 'classMod', 'relic', 'ordnance'];

describe('client/server slot compatibility parity', () => {
  describe('weapon', () => {
    it('accepted by primary, secondary, heavy', () => {
      expect(isItemCompatibleWithSlot(weapon, 'primary')).toBe(true);
      expect(isItemCompatibleWithSlot(weapon, 'secondary')).toBe(true);
      expect(isItemCompatibleWithSlot(weapon, 'heavy')).toBe(true);
    });
    it('rejected by shield, classMod, relic, ordnance', () => {
      expect(isItemCompatibleWithSlot(weapon, 'shield')).toBe(false);
      expect(isItemCompatibleWithSlot(weapon, 'classMod')).toBe(false);
      expect(isItemCompatibleWithSlot(weapon, 'relic')).toBe(false);
      expect(isItemCompatibleWithSlot(weapon, 'ordnance')).toBe(false);
    });
  });

  describe('shield', () => {
    it('accepted by shield slot', () => {
      expect(isItemCompatibleWithSlot(shield, 'shield')).toBe(true);
    });
    it('rejected by all weapon slots and others', () => {
      expect(isItemCompatibleWithSlot(shield, 'primary')).toBe(false);
      expect(isItemCompatibleWithSlot(shield, 'classMod')).toBe(false);
      expect(isItemCompatibleWithSlot(shield, 'ordnance')).toBe(false);
    });
  });

  describe('classMod', () => {
    it('accepted by classMod slot', () => {
      expect(isItemCompatibleWithSlot(classMod, 'classMod')).toBe(true);
    });
    it('rejected by weapon slots', () => {
      expect(isItemCompatibleWithSlot(classMod, 'primary')).toBe(false);
    });
  });

  describe('relic', () => {
    it('accepted by relic slot', () => {
      expect(isItemCompatibleWithSlot(relic, 'relic')).toBe(true);
    });
    it('rejected by weapon slots', () => {
      expect(isItemCompatibleWithSlot(relic, 'primary')).toBe(false);
    });
  });

  describe('ordnance', () => {
    it('accepted by ordnance slot', () => {
      expect(isItemCompatibleWithSlot(ordnance, 'ordnance')).toBe(true);
    });
    it('rejected by weapon slots', () => {
      expect(isItemCompatibleWithSlot(ordnance, 'primary')).toBe(false);
    });
  });

  describe('odds-only broken cache item', () => {
    it('rejected by ALL slots', () => {
      for (const slot of allSlots) {
        expect(isItemCompatibleWithSlot(oddsOnly, slot)).toBe(false);
      }
    });
  });
});
