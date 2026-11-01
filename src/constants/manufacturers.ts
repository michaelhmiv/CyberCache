import { Manufacturer } from '../types/game';

export interface ManufacturerDef {
  id: Manufacturer;
  name: string;
  identity: string;
  mechanic: string;
  baseStatBias: Partial<Record<string, number>>;
  color: string;
}

export const MANUFACTURERS: Record<Manufacturer, ManufacturerDef> = {
  [Manufacturer.Redline]: {
    id: Manufacturer.Redline,
    name: 'Redline',
    identity: 'Attack speed, ramping damage, sustained DPS',
    mechanic: 'Attack speed +15% baked into every roll; its ramping damage is folded into base damage (+8%)',
    baseStatBias: { attackSpeed: 1.15, baseDamage: 0.95 },
    color: '#EF4444',
  },
  [Manufacturer.Ironwood]: {
    id: Manufacturer.Ironwood,
    name: 'Ironwood',
    identity: 'Crits, precision, boss killing',
    mechanic: 'High crit chance/damage; strong single-target modifiers (+20% crit damage vs bosses)',
    baseStatBias: { critChance: 1.2, critDamage: 1.25, baseDamage: 1.05 },
    color: '#22C55E',
  },
  [Manufacturer.BlastForge]: {
    id: Manufacturer.BlastForge,
    name: 'BlastForge',
    identity: 'Explosions, splash, stagger, armor cracking',
    mechanic: 'Explosive damage helps armor break and boss phase checks (+25% armor damage)',
    baseStatBias: { armorDamageMod: 1.25, baseDamage: 1.1, attackSpeed: 0.9 },
    color: '#F59E0B',
  },
  [Manufacturer.Prismatek]: {
    id: Manufacturer.Prismatek,
    name: 'Prismatek',
    identity: 'Elemental specialization',
    mechanic: 'Elemental specialization baked into every roll: +30% status chance and status damage, non-Kinetic elements favored',
    baseStatBias: { statusChance: 1.3, statusDamage: 1.3, baseDamage: 0.95 },
    color: '#A855F7',
  },
  [Manufacturer.ThrowTech]: {
    id: Manufacturer.ThrowTech,
    name: 'ThrowTech',
    identity: 'Deployables and disposable tech',
    mechanic: 'Deployable-tech frames: +20% wave damage baked into every roll',
    baseStatBias: { waveDamageMod: 1.2, baseDamage: 0.9 },
    color: '#06B6D4',
  },
  [Manufacturer.HelixWorks]: {
    id: Manufacturer.HelixWorks,
    name: 'HelixWorks',
    identity: 'Modular, flexible, better stat variance',
    mechanic: 'Modular frames: +10 roll quality floor on every roll',
    baseStatBias: { baseDamage: 1.0 },
    color: '#3B82F6',
  },
};
