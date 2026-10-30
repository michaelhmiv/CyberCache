import { describe, expect, it } from 'vitest';
import { serverItemRowToDisplayGear } from '@/lib/api/serverItemAdapter';
import { isItemCompatibleWithSlot } from '@/lib/loadout/loadoutSlotCompat';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import type { Weapon, Shield } from '@/types/items';

const weaponPayload = {
  id: 'w1',
  name: 'Gun',
  level: 1,
  rarity: 'Rare',
  weaponType: 'Pistol',
  manufacturer: 'HelixWorks',
  element: 'Kinetic',
  baseDamage: 10,
  attackSpeed: 1,
  critChance: 0.05,
  critDamage: 1.5,
  statusChance: 0,
  statusDamage: 0,
  bossDamageMod: 1,
  waveDamageMod: 1,
  shieldDamageMod: 1,
  armorDamageMod: 1,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  rollQuality: 50,
  combatPower: 15,
  bossPower: 15,
  farmPower: 15,
  economyScore: 0,
  sourceTag: 'Cache-Forged',
  parts: [],
  affixes: [],
  pixelSeed: 1,
};

describe('Loadout consistency smoke', () => {
  it('hides placeholder cache rows without a weapon type', () => {
    expect(serverItemRowToDisplayGear({ id: 'bad', payload: { odds: {} } })).toBeNull();
  });

  it('recognizes real cache weapons', () => {
    const item = serverItemRowToDisplayGear({ id: 'w1', payload: weaponPayload });
    expect(item && 'weaponType' in item).toBe(true);
  });

  it('matches client/server slot rules', () => {
    expect(isItemCompatibleWithSlot(weaponPayload as unknown as Weapon, 'primary')).toBe(true);
    expect(isItemCompatibleWithSlot({ hp: 100 } as unknown as Shield, 'primary')).toBe(false);
    expect(isItemCompatibleWithSlot({ hp: 100 } as unknown as Shield, 'shield')).toBe(true);
  });

  it('dashboard statWeapons only includes equipped weapons', () => {
    useInventoryStore.setState({ items: [weaponPayload as unknown as Weapon] });
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });

    const equipped = [
      useLoadoutStore.getState().getWeapon('primary'),
      useLoadoutStore.getState().getWeapon('secondary'),
      useLoadoutStore.getState().getWeapon('heavy'),
    ].filter((w): w is Weapon => !!w);

    expect(equipped).toHaveLength(0);
  });
});
