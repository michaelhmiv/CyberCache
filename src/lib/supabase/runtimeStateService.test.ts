import { describe, expect, it, vi, beforeEach } from 'vitest';
import { syncRuntimeItemsForUser } from './runtimeStateService';
import { supabase } from './client';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';

vi.mock('./client', () => {
  const order = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'listed-gun',
        item_level: 1,
        rarity: 'Rare',
        is_locked: false,
        runtime_state: 'listed',
        equipped_slot: null,
        payload: {
          id: 'listed-gun',
          name: 'Listed',
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
          isLocked: false,
        },
      },
      {
        id: 'available-gun',
        item_level: 1,
        rarity: 'Rare',
        is_locked: false,
        runtime_state: 'available',
        equipped_slot: null,
        payload: {
          id: 'available-gun',
          name: 'Available',
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
          pixelSeed: 2,
          isLocked: false,
        },
      },
      {
        id: 'ghost-item',
        item_level: 1,
        rarity: 'Rare',
        is_locked: false,
        runtime_state: 'available',
        equipped_slot: null,
        payload: { odds: { outcome: 'Rare' } },
      },
    ],
    error: null,
  });
  const builder = {
    neq: vi.fn((_column, _value) => builder),
    order,
  };

  return {
    supabase: {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn((_column, _value) => builder) })) })),
    },
  };
});

describe('syncRuntimeItemsForUser', () => {
  beforeEach(() => {
    useInventoryStore.setState({ items: [] });
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
  });

  it('filters listed rows at the query level and drops unrecognizable payloads', async () => {
    await syncRuntimeItemsForUser('user-1');
    const ids = useInventoryStore.getState().items.map((i) => i.id);
    expect(ids).toContain('available-gun');
    expect(ids).not.toContain('ghost-item');
    // `neq('runtime_state','listed')` guards against market-listed items being shown.
    const client = supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (column: string, value: string) => {
            neq: typeof vi.fn & { mock: { calls: Array<[string, string]> } };
          };
        };
      };
    };
    const builder = client.from('item_instances').select('*').eq('owner_user_id', 'user-1');
    expect(builder.neq.mock.calls.some(([col, val]) => col === 'runtime_state' && val === 'listed')).toBe(true);
  });
});
