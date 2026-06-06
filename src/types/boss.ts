import { Element } from './game';

export interface BossMechanic {
  id: string;
  name: string;
  description: string;
  checkType: 'survival' | 'shieldBreak' | 'armorBreak' | 'dps' | 'mechanic';
  requiredLoadoutTrait?: string;
  threshold?: number;
}

export interface BossDef {
  id: string;
  name: string;
  tier: number;
  level: number;
  health: number;
  shield: number;
  armor: number;
  dps: number;
  weaknesses: Element[];
  resistances: Element[];
  mechanic: BossMechanic;
  recommendedPower: number;
  entryCost: number;
  rematchCost: number;
  dropTable: string[]; // legendary effect IDs eligible
  dedicatedDrops: string[];
}

export interface BossAttemptResult {
  id: string;
  bossId: string;
  timestamp: number;
  victory: boolean;
  winChance: number;
  phaseFailed?: string;
  bossHpRemaining?: number;
  consumablesUsed: Record<string, number>;
  consumablesLost: Record<string, number>;
  creditsGained: number;
  creditsLost: number;
  loot: string[]; // item IDs
  reasons: string[];
  recommendations: string[];
}
