import { beforeEach, describe, expect, it } from 'vitest';
import { syncVerifiedResult } from '@/lib/supabase/verifiedStateSync';
import { emptySlots, useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';

const weaponRow = (id: string, equippedSlot: string | null) => ({
  id,
  item_level: 10,
  rarity: 'Rare',
  is_locked: false,
  runtime_state: equippedSlot ? 'equipped' : 'available',
  equipped_slot: equippedSlot,
  payload: {
    id,
    name: `Weapon ${id}`,
    level: 10,
    rarity: 'Rare',
    weaponType: 'Pistol',
    manufacturer: 'HelixWorks',
    element: 'Kinetic',
    rollQuality: 70,
    baseDamage: 100,
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
    parts: [],
    affixes: [],
    sourceTag: 'cache_forged',
    pixelSeed: 1,
    combatPower: 100,
    bossPower: 100,
    farmPower: 100,
    economyScore: 100,
  },
});

describe('syncVerifiedResult loadout wiring', () => {
  beforeEach(() => {
    useLoadoutStore.setState({ slots: { ...emptySlots } });
    useInventoryStore.setState({ items: [] });
  });

  it('moves an equipped item between slots when an RPC returns only the changed item row', () => {
    useLoadoutStore.getState().setSlot('primary', 'weapon-a');

    syncVerifiedResult({
      action_type: 'cc_equip_item',
      item: weaponRow('weapon-a', 'secondary'),
    });

    expect(useLoadoutStore.getState().slots.primary).toBeNull();
    expect(useLoadoutStore.getState().slots.secondary).toBe('weapon-a');
  });

  it('clears an unequipped item row from whichever local slot still references it', () => {
    useLoadoutStore.getState().setSlot('primary', 'weapon-a');

    syncVerifiedResult({
      action_type: 'cc_equip_item',
      item: weaponRow('weapon-a', null),
    });

    expect(useLoadoutStore.getState().slots.primary).toBeNull();
  });

  it('honors the server loadout snapshot as the final source of truth', () => {
    useLoadoutStore.getState().setSlot('primary', 'stale-primary');
    useLoadoutStore.getState().setSlot('secondary', 'stale-secondary');

    syncVerifiedResult({
      action_type: 'cc_equip_item',
      items: [weaponRow('weapon-b', 'secondary')],
      loadout: { ...emptySlots, primary: null, secondary: 'weapon-b' },
    });

    expect(useLoadoutStore.getState().slots).toMatchObject({
      primary: null,
      secondary: 'weapon-b',
    });
  });
});
