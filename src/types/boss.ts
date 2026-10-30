import { Element } from './game';

export type BossTag =
  | 'tutorial'
  | 'simple'
  | 'shield'
  | 'armor'
  | 'enrage'
  | 'phase'
  | 'repair'
  | 'regen'
  | 'burn'
  | 'swarm'
  | 'elite'
  | 'mechanical'
  | 'organic'
  | 'multiPhase'
  | 'attrition'
  | 'burstCheck'
  | 'evasive'
  | 'siege';

export type BossEventType =
  | 'fightStart'
  | 'shieldPhase'
  | 'shieldBreak'
  | 'armorPhase'
  | 'armorBreak'
  | 'bossMechanic'
  | 'emergency'
  | 'victory'
  | 'defeat'
  | 'lootRoll';

export interface BossMechanic {
  id: string;
  name: string;
  description: string;
  checkType: 'survival' | 'shieldBreak' | 'armorBreak' | 'dps' | 'mechanic';
  requiredLoadoutTrait?: string;
  threshold?: number;
}

export interface BossPhase {
  id: string;
  name: string;
  description: string;
  type: 'survival' | 'shieldBreak' | 'armorBreak' | 'dps' | 'mechanic';
  targetValue: number;
  recommendedCounters: string[];
  failureReason: string;
  successReason: string;
  eventTrigger: BossEventType;
}

export interface PhaseAnalysis {
  phaseId: string;
  phaseName: string;
  score: number;
  status: 'safe' | 'close' | 'risky' | 'failing';
  currentAnswers: string[];
  missingCounters: string[];
  relevantConsumables: string[];
  explanation: string;
}

export interface BossPrepAnalysis {
  projectedWinChance: number;
  projectedFailurePhase?: PhaseAnalysis;
  phaseAnalyses: PhaseAnalysis[];
  equippedAnswers: string[];
  missingCounters: string[];
  consumablesAtRisk: string[];
  riskSummary: string;
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
  tags: BossTag[];
  phases: BossPhase[];
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
  /** Entry fee charged for the attempt (boss entryCost, or rematchCost on a repeat attempt). */
  entryFee: number;
  creditsGained: number;
  creditsLost: number;
  loot: string[]; // item IDs
  reasons: string[];
  recommendations: string[];
}
