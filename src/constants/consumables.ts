import { ConsumableType } from '../types/game';

export interface ConsumableDef {
  id: ConsumableType;
  name: string;
  description: string;
  basePrice: number;
  effect: string;
  category: 'survival' | 'offense' | 'utility';
}

export const CONSUMABLES: Record<ConsumableType, ConsumableDef> = {
  [ConsumableType.MedKit]: {
    id: ConsumableType.MedKit,
    name: 'Med Kit',
    description: 'Improves survival check. Used when health is low during simulation.',
    basePrice: 250,
    effect: '+survival',
    category: 'survival',
  },
  [ConsumableType.Grenade]: {
    id: ConsumableType.Grenade,
    name: 'Ordnance Charge',
    description: 'Improves shield break, armor break, burst damage, or debuff checks.',
    basePrice: 400,
    effect: '+break/+burst',
    category: 'offense',
  },
  [ConsumableType.AmmoPack]: {
    id: ConsumableType.AmmoPack,
    name: 'Ammo Pack',
    description: 'Improves sustained DPS in longer fights.',
    basePrice: 150,
    effect: '+dps',
    category: 'offense',
  },
  [ConsumableType.ShieldCell]: {
    id: ConsumableType.ShieldCell,
    name: 'Shield Cell',
    description: 'Improves survivability and reduces burst death risk.',
    basePrice: 300,
    effect: '+shield',
    category: 'survival',
  },
  [ConsumableType.ElementalCoating]: {
    id: ConsumableType.ElementalCoating,
    name: 'Elemental Coating',
    description: 'Temporarily boost or alter elemental matchup.',
    basePrice: 500,
    effect: '+element',
    category: 'offense',
  },
  [ConsumableType.LuckBooster]: {
    id: ConsumableType.LuckBooster,
    name: 'Luck Booster',
    description: 'Improves loot/reward quality. Does not increase win chance.',
    basePrice: 350,
    effect: '+loot',
    category: 'utility',
  },
  [ConsumableType.BossScanner]: {
    id: ConsumableType.BossScanner,
    name: 'Boss Scanner',
    description: 'Improves information accuracy about boss weakness, resistance, and win chance.',
    basePrice: 600,
    effect: '+info',
    category: 'utility',
  },
  [ConsumableType.InsuranceToken]: {
    id: ConsumableType.InsuranceToken,
    name: 'Insurance Token',
    description: 'Reduces or prevents credit death fee on failure.',
    basePrice: 800,
    effect: '-deathfee',
    category: 'utility',
  },
};
