import { describe, expect, it, vi, beforeEach } from 'vitest';

// Route B (B4): the transport is the Chef read route. The server
// excludes listed/salvaged/consumed rows itself (the old PostgREST
// query filtered `runtime_state != listed` client-side), so the
// fixture below is what /api/runtime/items actually returns: the
// available row and a row whose payload the adapter cannot recognize.
const apiRequestMock = vi.hoisted(() => vi.fn());
vi.mock('./http', () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  ApiError: class ApiError extends Error {},
  isApiError: () => false,
  isNotFoundError: () => false,
}));

import { syncRuntimeItemsForUser } from './runtimeStateService';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';

const gearPayload = (id: string, pixelSeed: number) => ({
  id,
  name: id === 'available-gun' ? 'Available' : id,
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
  pixelSeed,
  isLocked: false,
});

describe('syncRuntimeItemsForUser', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue([
      {
        id: 'available-gun',
        item_level: 1,
        rarity: 'Rare',
        is_locked: false,
        runtime_state: 'available',
        equipped_slot: null,
        payload: gearPayload('available-gun', 2),
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
    ]);
    useInventoryStore.setState({ items: [] });
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
  });

  it('reads own items from the Chef route and drops unrecognizable payloads', async () => {
    await syncRuntimeItemsForUser('user-1');
    const ids = useInventoryStore.getState().items.map((i) => i.id);
    expect(ids).toContain('available-gun');
    expect(ids).not.toContain('ghost-item');
    // Listed items never appear: the route excludes them server-side,
    // the same guarantee the neq('runtime_state','listed') filter gave.
    expect(ids).not.toContain('listed-gun');
    expect(apiRequestMock).toHaveBeenCalledWith('/runtime/items');
  });

  it('swallows transport failures and leaves local state untouched', async () => {
    apiRequestMock.mockRejectedValueOnce(new Error('offline'));
    await syncRuntimeItemsForUser('user-1');
    expect(useInventoryStore.getState().items).toEqual([]);
  });
});
