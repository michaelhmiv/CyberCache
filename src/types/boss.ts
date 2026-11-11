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
  /**
   * Composite demand (slice C2): a mechanic whose leg is the min
   * over several axis ratios instead of one threshold — the Scrap
   * Bishop's three-phase siege. The numbers mirror the boss's
   * phase targets (prep prints those); a suite pin keeps the two
   * from drifting. Generated Chamber encounters are presented
   * WITHOUT this field, so the Chamber never collects it.
   */
  composite?: { shieldBreak: number; armorBreak: number; dps: number };
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

/**
 * Boss attack cadence (owner ruling 2026-11-10 — boss cadence slice
 * C1): the boss's authored hit timeline. Regular hits land every
 * `hitIntervalSeconds`; a named special lands every
 * `specialEverySeconds` (the first one full cycle in), preceded by
 * `windupSeconds` of damage-free telegraph. `specialShare` is the
 * fraction of the boss's TOTAL damage budget the specials carry —
 * the regular hits carry the rest, so a cadence never changes how
 * much damage a boss deals, only when it lands. The boss sim folds
 * the timeline into its pooled model (see `bossCadenceTimeline` in
 * bossSimulator.ts): the damage-free ticks it creates are where
 * passive shield recharge lives inside a boss fight.
 */
export interface BossCadence {
  /** Seconds between regular hits. */
  hitIntervalSeconds: number;
  /** Player-facing name of the special, e.g. 'Refraction Burst'. Shown in prep + attempt reasons. */
  specialName: string;
  /** Seconds between specials; the first special lands one full cycle in. */
  specialEverySeconds: number;
  /** Fraction of the boss's total damage budget carried by specials (0..1). The rest rides regular hits. */
  specialShare: number;
  /** Telegraph beat before each special lands, in seconds. Damage-free; presentation + the honest source of the widest gaps. */
  windupSeconds: number;
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
  /**
   * Attack cadence (slice C1). Absent = the continuous damage model,
   * bit-identical to the pre-cadence sim — generated Endless
   * encounters carry no cadence by design (owner ruling D3).
   */
  cadence?: BossCadence;
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
  /**
   * Action skill fired in this attempt (Action Skill slice, 0030):
   * the signature's tree + name, whether its effect resolved, and —
   * for Cache Surge — the surge rolls and what they produced. Absent
   * when no signature fired. Player's own data only (intel law).
   */
  actionSkill?: {
    tree: string;
    name: string;
    fired: boolean;
    surgeRolls?: number;
    surgeLoot?: string[];
    qualityMultiplier?: number;
  };
  /**
   * AL-1 (0070): the dedicated-drop facts for this attempt, merged
   * into the stored attempt record — the claim-resolved dedicated
   * chance (economy lever + research bonus, before drop luck),
   * whether the dedicated roll hit, and the drop-luck buff fraction
   * in force. The effective roll chance was
   * dedicatedChance × (1 + dropLuckBonus). Recorded so the activity
   * log answers "what were the chances of that drop?" from the
   * attempt itself; absent on attempts recorded before AL-1.
   */
  dedicatedChance?: number;
  dedicatedDropAwarded?: boolean;
  dropLuckBonus?: number;
}
