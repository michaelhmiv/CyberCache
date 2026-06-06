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
    mechanic: 'Damage or fire rate increases as the fight continues (+1% per 3s, max 15%)',
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
    mechanic: 'Stronger status chance, elemental matchup bonuses, weakness exploitation (+30% status damage)',
    baseStatBias: { statusChance: 1.3, statusDamage: 1.3, baseDamage: 0.95 },
    color: '#A855F7',
  },
  [Manufacturer.ThrowTech]: {
    id: Manufacturer.ThrowTech,
    name: 'ThrowTech',
    identity: 'Deployables and disposable tech',
    mechanic: 'Periodically deploys drones, turrets, bombs, or support effects (bonus wave damage)',
    baseStatBias: { waveDamageMod: 1.2, baseDamage: 0.9 },
    color: '#06B6D4',
  },
  [Manufacturer.HelixWorks]: {
    id: Manufacturer.HelixWorks,
    name: 'HelixWorks',
    identity: 'Modular, flexible, better stat variance',
    mechanic: 'Better affix flexibility, extra minor affix chance, or improved roll quality range (+10% roll quality floor)',
    baseStatBias: { baseDamage: 1.0 },
    color: '#3B82F6',
  },
};
