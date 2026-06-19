import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import type { Weapon } from '@/types/items';

// Simplified reproduction of the dashboard weapon-selection logic
function useDashboardWeapons() {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const equippedWeapon =
    loadout.getWeapon('primary') ??
    loadout.getWeapon('secondary') ??
    loadout.getWeapon('heavy') ??
    undefined;
  const equippedWeapons = [
    loadout.getWeapon('primary'),
    loadout.getWeapon('secondary'),
    loadout.getWeapon('heavy'),
  ].filter((w): w is Weapon => !!w);
  const bestWeapon = inventory.getWeapons().sort((a, b) => b.combatPower - a.combatPower)[0];
  return { equippedWeapon, statWeapons: equippedWeapons, bestWeapon };
}

describe('Dashboard weapon logic', () => {
  it('does not fall back to the best inventory weapon when no weapon is equipped', () => {
    useInventoryStore.setState({
      items: [
        {
          id: 'w1',
          name: 'Best Gun',
          rarity: 'Rare',
          combatPower: 999,
          weaponType: 'Pistol',
        } as unknown as Weapon,
      ],
    });
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });

    const { result } = renderHook(() => useDashboardWeapons());
    expect(result.current.equippedWeapon).toBeUndefined();
    expect(result.current.statWeapons).toHaveLength(0);
    expect(result.current.bestWeapon).toBeDefined();
  });

  it('includes only actually equipped weapons in statWeapons', () => {
    const equipped = {
      id: 'w2',
      name: 'Equipped Gun',
      rarity: 'Rare',
      combatPower: 100,
      weaponType: 'Pistol',
    } as unknown as Weapon;
    useInventoryStore.setState({ items: [equipped] });
    useLoadoutStore.setState({
      slots: { primary: 'w2', secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });

    const { result } = renderHook(() => useDashboardWeapons());
    expect(result.current.equippedWeapon?.id).toBe('w2');
    expect(result.current.statWeapons).toHaveLength(1);
    expect(result.current.statWeapons[0].id).toBe('w2');
  });
});
