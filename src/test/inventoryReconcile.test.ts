import { describe, it, expect, beforeEach } from 'vitest';
import { useInventoryStore } from '../store/slices/inventorySlice';
import type { Weapon } from '../types/items';

function makeWeapon(id: string): Weapon {
  return {
    id,
    weaponType: 'Pistol',
    name: id,
    level: 1,
    rarity: 'Common',
    element: 'Kinetic',
    manufacturer: 'Redline',
    rollQuality: 50,
    baseDamage: 10,
    attackSpeed: 1.0,
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
    parts: [],
    affixes: [],
    sourceTag: 'RoamingDrop',
    isLocked: false,
    pixelSeed: 0,
    combatPower: 5,
    bossPower: 3,
    farmPower: 10,
    economyScore: 0,
  };
}

describe('receiveServerItems reconciliation', () => {
  beforeEach(() => {
    useInventoryStore.getState().setItems([]);
  });

  it('REPLACES inventory with server items (not merge)', () => {
    const store = useInventoryStore.getState();
    // First batch: two items
    store.receiveServerItems([makeWeapon('old-1'), makeWeapon('old-2')]);
    expect(useInventoryStore.getState().items).toHaveLength(2);

    // Second batch: only 1 item — old phantoms should be gone
    store.receiveServerItems([makeWeapon('real-1')]);
    const items = useInventoryStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('real-1');
  });

  it('clears inventory when server returns empty array', () => {
    const store = useInventoryStore.getState();
    store.receiveServerItems([makeWeapon('phantom-1'), makeWeapon('phantom-2')]);
    expect(useInventoryStore.getState().items).toHaveLength(2);

    store.receiveServerItems([]);
    expect(useInventoryStore.getState().items).toHaveLength(0);
  });

  it('does not accumulate items across multiple receiveServerItems calls', () => {
    const store = useInventoryStore.getState();
    // Simulate 5 roaming claims, each producing 2 items
    for (let i = 0; i < 5; i++) {
      store.receiveServerItems([
        makeWeapon(`item-${i}-a`),
        makeWeapon(`item-${i}-b`),
      ]);
    }
    // If merging: would have 10 items. If reconciling: only last batch (2).
    expect(useInventoryStore.getState().items).toHaveLength(2);
  });
});
