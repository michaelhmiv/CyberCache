/**
 * Gear-truth slice — claim items reach the inventory store.
 *
 * Foreground claim results carry the Chef's generated items as RAW
 * payloads (fields at top level); verified ops carry store ROWS
 * (item JSON nested under `payload`). The pre-fix sync fed both to
 * the row adapter, which found no `payload` on a claim item,
 * declared it unrecognizable, and removed it from the inventory
 * store — roaming drops were invisible in Gear while cache and
 * boss items (rows / direct upserts) showed fine. These tests pin
 * all four acquisition shapes landing in the one inventory.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { syncVerifiedResult } from '@/lib/api/verifiedStateSync';
import { coerceServerItemRow } from '@/lib/api/serverItemAdapter';
import { buildStarterWeaponPayload } from '@/server/lib/starterWeapon';
import { emptySlots, useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useVehicleStore } from '@/store/slices/vehicleSlice';

const weaponPayload = (id: string, name: string) => ({
  id,
  name,
  level: 3,
  rarity: 'Uncommon',
  weaponType: 'Revolver',
  manufacturer: 'Ionworks',
  element: 'Shock',
  rollQuality: 55,
  baseDamage: 42,
  attackSpeed: 1.1,
  critChance: 0.08,
  critDamage: 1.6,
  statusChance: 0.1,
  statusDamage: 0.4,
  bossDamageMod: 0,
  waveDamageMod: 0,
  shieldDamageMod: 0.2,
  armorDamageMod: 0.1,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  parts: [],
  affixes: [],
  sourceTag: 'World Drop',
  pixelSeed: 7,
  combatPower: 61,
  bossPower: 61,
  farmPower: 61,
  economyScore: 10,
});

const shieldPayload = (id: string, name: string) => ({
  id,
  name,
  level: 2,
  rarity: 'Common',
  hp: 140,
  mitigation: 0.08,
  rechargeRate: 4,
  element: 'Cryo',
  affixes: [],
  sourceTag: 'World Drop',
  pixelSeed: 3,
});

describe('coerceServerItemRow', () => {
  it('passes store rows through untouched', () => {
    const row = { id: 'r1', payload: weaponPayload('r1', 'Row Gun'), runtime_state: 'available', equipped_slot: null };
    expect(coerceServerItemRow(row)).toBe(row);
  });

  it('wraps a raw Chef item payload as its own row', () => {
    const raw = weaponPayload('w1', 'Ion Spectra Revolver Mk.I');
    const row = coerceServerItemRow(raw);
    expect(row).not.toBeNull();
    expect(row!.id).toBe('w1');
    expect(row!.payload).toBe(raw);
    expect(row!.runtime_state).toBe('available');
  });

  it('rejects shapeless entries', () => {
    expect(coerceServerItemRow(null)).toBeNull();
    expect(coerceServerItemRow({})).toBeNull();
    expect(coerceServerItemRow({ name: 'no id' })).toBeNull();
  });
});

describe('syncVerifiedResult with claim-shaped items', () => {
  beforeEach(() => {
    useLoadoutStore.setState({ slots: { ...emptySlots } });
    useInventoryStore.setState({ items: [] });
    useVehicleStore.setState({ vehicles: [] });
  });

  it('roaming drops (weapon + shield) land in the inventory store', () => {
    syncVerifiedResult({
      action_type: 'cc_claim_roaming_rewards',
      items: [weaponPayload('w1', 'Ion Spectra Revolver Mk.I'), shieldPayload('s1', 'Cryo Ironwood Shield Mk.1')],
    });
    const items = useInventoryStore.getState().items;
    expect(items.map((i) => i.id).sort()).toEqual(['s1', 'w1']);
    expect(useInventoryStore.getState().getWeapons().map((w) => w.id)).toEqual(['w1']);
  });

  it('a repeat claim sync does not duplicate or drop earlier drops', () => {
    syncVerifiedResult({ items: [weaponPayload('w1', 'Revolver')] });
    syncVerifiedResult({ items: [shieldPayload('s1', 'Shield')] });
    expect(useInventoryStore.getState().items.map((i) => i.id).sort()).toEqual(['s1', 'w1']);
  });

  it('a vehicle payload routes to the garage, never gear inventory', () => {
    syncVerifiedResult({
      items: [{ id: 'v1', vehicleClassId: 'scrap_bike', name: 'Scrap Bike', rarity: 'Common', level: 1, affixes: [] }],
    });
    expect(useInventoryStore.getState().items).toHaveLength(0);
    expect(useVehicleStore.getState().vehicles.map((v) => v.id)).toEqual(['v1']);
  });

  it('the repaired starter row (row shape) hydrates into the primary slot', () => {
    const rowId = '11111111-2222-3333-4444-555555555555';
    syncVerifiedResult({
      items: [{
        id: rowId,
        item_level: 1,
        rarity: 'Common',
        is_locked: false,
        runtime_state: 'equipped',
        equipped_slot: 'primary',
        payload: buildStarterWeaponPayload(rowId),
      }],
    });
    expect(useLoadoutStore.getState().slots.primary).toBe(rowId);
    expect(useInventoryStore.getState().getWeapons()).toHaveLength(1);
    expect(useLoadoutStore.getState().getWeapon('primary')?.name).toBe('Starter Pistol');
  });
});
