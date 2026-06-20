import type { Weapon } from '@/types/items';

export type WeaponLoadoutReader = {
  getWeapon: (slot: 'primary' | 'secondary' | 'heavy') => Weapon | undefined;
};

export const WEAPON_SLOT_ORDER = ['primary', 'secondary', 'heavy'] as const;

export function selectEquippedWeapons(loadout: WeaponLoadoutReader): Weapon[] {
  return WEAPON_SLOT_ORDER
    .map((slot) => loadout.getWeapon(slot))
    .filter((weapon): weapon is Weapon => !!weapon);
}

export function selectPrimaryEquippedWeapon(loadout: WeaponLoadoutReader): Weapon | undefined {
  return selectEquippedWeapons(loadout)[0];
}
