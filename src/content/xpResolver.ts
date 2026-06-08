import { XP_ACTION_REWARDS, type XpActionReward } from './gameContent';
import { buildLevelCurve, calculateDailyXp, xpToNextLevel, type DailyXpBreakdown, type LevelCurvePoint } from './simulation';

export interface PlayerLevelState {
  level: number;
  xpIntoLevel: number;
  totalXp: number;
}

export interface XpGrantResult {
  previous: PlayerLevelState;
  next: PlayerLevelState;
  levelsGained: number;
  grantedXp: number;
}

export interface XpProgressionSummary {
  levelCap: number;
  dailyStressXp: DailyXpBreakdown;
  curve: LevelCurvePoint[];
  totalDaysToCap: number;
  totalYearsToCap: number;
}

export function getXpActionReward(actionId: string): XpActionReward | undefined {
  return XP_ACTION_REWARDS.find((reward) => reward.actionId === actionId);
}

export function requireXpActionReward(actionId: string): XpActionReward {
  const reward = getXpActionReward(actionId);
  if (!reward) throw new Error(`Missing XP action reward '${actionId}'.`);
  return reward;
}

export function getXpForAction(actionId: string): number {
  return requireXpActionReward(actionId).xp;
}

export function totalXpRequiredToReachLevel(level: number): number {
  if (level < 1) throw new Error('Level must be at least 1.');
  let total = 0;
  for (let currentLevel = 1; currentLevel < level; currentLevel++) {
    total += xpToNextLevel(currentLevel);
  }
  return total;
}

export function levelStateFromTotalXp(totalXp: number, levelCap = 100): PlayerLevelState {
  if (totalXp < 0) throw new Error('Total XP cannot be negative.');

  let remaining = totalXp;
  let level = 1;

  while (level < levelCap) {
    const needed = xpToNextLevel(level);
    if (remaining < needed) break;
    remaining -= needed;
    level += 1;
  }

  return {
    level,
    xpIntoLevel: level >= levelCap ? 0 : remaining,
    totalXp,
  };
}

export function grantXp(previous: PlayerLevelState, grantedXp: number, levelCap = 100): XpGrantResult {
  if (grantedXp < 0) throw new Error('Granted XP cannot be negative.');
  const next = levelStateFromTotalXp(previous.totalXp + grantedXp, levelCap);
  return {
    previous,
    next,
    levelsGained: next.level - previous.level,
    grantedXp,
  };
}

export function buildXpProgressionSummary(levelCap = 100): XpProgressionSummary {
  const dailyStressXp = calculateDailyXp();
  const curve = buildLevelCurve(levelCap);
  const totalDaysToCap = curve[curve.length - 1]?.cumulativeDaysAtStressAssumption ?? 0;

  return {
    levelCap,
    dailyStressXp,
    curve,
    totalDaysToCap,
    totalYearsToCap: totalDaysToCap / 365,
  };
}
