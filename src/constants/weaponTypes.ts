import { WeaponType } from '../types/game';

export interface WeaponTypeDef {
  id: WeaponType;
  name: string;
  description: string;
  baseStats: {
    baseDamage: number;
    attackSpeed: number;
    critChance: number;
    critDamage: number;
    statusChance: number;
    statusDamage: number;
    bossDamageMod: number;
    waveDamageMod: number;
    shieldDamageMod: number;
    armorDamageMod: number;
  };
}

export const WEAPON_TYPES: Record<WeaponType, WeaponTypeDef> = {
  [WeaponType.Pistol]: {
    id: WeaponType.Pistol,
    name: 'Pistol',
    description: 'Balanced and flexible. Good general progression.',
    baseStats: {
      baseDamage: 80,
      attackSpeed: 1.2,
      critChance: 0.1,
      critDamage: 1.5,
      statusChance: 0.08,
      statusDamage: 1.2,
      bossDamageMod: 1.0,
      waveDamageMod: 1.0,
      shieldDamageMod: 1.0,
      armorDamageMod: 1.0,
    },
  },
  [WeaponType.SMG]: {
    id: WeaponType.SMG,
    name: 'SMG',
    description: 'Fast attack speed and ramping damage. Good for status and long fights.',
    baseStats: {
      baseDamage: 45,
      attackSpeed: 2.0,
      critChance: 0.08,
      critDamage: 1.4,
      statusChance: 0.12,
      statusDamage: 1.1,
      bossDamageMod: 0.95,
      waveDamageMod: 1.15,
      shieldDamageMod: 1.05,
      armorDamageMod: 0.9,
    },
  },
  [WeaponType.Shotgun]: {
    id: WeaponType.Shotgun,
    name: 'Shotgun',
    description: 'Burst and multi-hit. Good for wave clearing and close-range.',
    baseStats: {
      baseDamage: 140,
      attackSpeed: 0.7,
      critChance: 0.06,
      critDamage: 1.6,
      statusChance: 0.1,
      statusDamage: 1.3,
      bossDamageMod: 0.9,
      waveDamageMod: 1.3,
      shieldDamageMod: 0.95,
      armorDamageMod: 1.05,
    },
  },
  [WeaponType.Sniper]: {
    id: WeaponType.Sniper,
    name: 'Sniper',
    description: 'High crit and precision. Good for boss killing.',
    baseStats: {
      baseDamage: 200,
      attackSpeed: 0.5,
      critChance: 0.25,
      critDamage: 2.0,
      statusChance: 0.05,
      statusDamage: 1.0,
      bossDamageMod: 1.2,
      waveDamageMod: 0.7,
      shieldDamageMod: 1.0,
      armorDamageMod: 1.1,
    },
  },
  [WeaponType.Launcher]: {
    id: WeaponType.Launcher,
    name: 'Launcher',
    description: 'Slow but powerful. Good for explosive burst, armor break, stagger.',
    baseStats: {
      baseDamage: 300,
      attackSpeed: 0.35,
      critChance: 0.03,
      critDamage: 1.8,
      statusChance: 0.15,
      statusDamage: 1.5,
      bossDamageMod: 1.15,
      waveDamageMod: 1.1,
      shieldDamageMod: 0.85,
      armorDamageMod: 1.3,
    },
  },
  [WeaponType.Beam]: {
    id: WeaponType.Beam,
    name: 'Beam',
    description: 'Elemental/status specialist. Good for shield/armor matchups and DoT.',
    baseStats: {
      baseDamage: 60,
      attackSpeed: 1.5,
      critChance: 0.07,
      critDamage: 1.35,
      statusChance: 0.2,
      statusDamage: 1.4,
      bossDamageMod: 1.0,
      waveDamageMod: 0.95,
      shieldDamageMod: 1.15,
      armorDamageMod: 1.15,
    },
  },
};
