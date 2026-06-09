import { DEFAULT_SIMULATION_ASSUMPTIONS, LOOT_POOLS, LOOT_TABLES, OUTPUT_QUALITY_CURVE, XP_ACTION_REWARDS, type LootEntry, type LootPool, type LootTable, type QualityBand, type QualityTier, type SimulationAssumptions } from './gameContent';

export interface RandomSource { next: () => number; }
export interface LootDropResult { rollId: string; poolId: string; entry: LootEntry; }
export interface DailyXpBreakdown { roamingTickXp: number; enemyDefeatXp: number; damageCreditXp: number; bossAttemptXp: number; bossVictoryXp: number; scrapXp: number; craftXp: number; totalXp: number; }
export interface QualityRollInput { professionLevel: number; stationBonus?: number; blueprintMastery?: number; materialQualityBonus?: number; recipeDifficulty: number; }
export interface QualityRollResult { effectiveSkill: number; selectedBand: QualityBand; quality: QualityTier; }
export interface LevelCurvePoint { level: number; xpToNext: number; cumulativeXpToReach: number; daysAtStressAssumption: number; cumulativeDaysAtStressAssumption: number; }

export function createSeededRng(seed = 1): RandomSource {
  let state = seed >>> 0;
  return { next: () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; } };
}

export function pickWeighted<T extends { weight: number }>(entries: T[], rng: RandomSource): T {
  if (entries.length === 0) throw new Error('Cannot pick from an empty weighted list.');
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) throw new Error('Weighted list must have positive total weight.');
  let roll = rng.next() * total;
  for (const entry of entries) { roll -= entry.weight; if (roll <= 0) return entry; }
  return entries[entries.length - 1];
}

export function getLootPool(poolId: string, pools: LootPool[] = LOOT_POOLS): LootPool {
  const pool = pools.find((item) => item.id === poolId);
  if (!pool) throw new Error(`Missing loot pool '${poolId}'.`);
  return pool;
}

export function getLootTable(tableId: string, tables: LootTable[] = LOOT_TABLES): LootTable {
  const table = tables.find((item) => item.id === tableId);
  if (!table) throw new Error(`Missing loot table '${tableId}'.`);
  return table;
}

export function simulateLootTable(tableId: string, seed = 1, tables: LootTable[] = LOOT_TABLES, pools: LootPool[] = LOOT_POOLS): LootDropResult[] {
  const table = getLootTable(tableId, tables);
  const rng = createSeededRng(seed);
  const drops: LootDropResult[] = [];
  for (const roll of table.rolls) {
    if (rng.next() > roll.chance) continue;
    const pool = getLootPool(roll.poolId, pools);
    for (let i = 0; i < roll.rolls; i++) drops.push({ rollId: roll.id, poolId: pool.id, entry: pickWeighted(pool.entries, rng) });
  }
  return drops;
}

export function calculateEffectiveSkill(input: QualityRollInput): number {
  return input.professionLevel + (input.stationBonus ?? 0) + (input.blueprintMastery ?? 0) + (input.materialQualityBonus ?? 0) - input.recipeDifficulty;
}

export function selectQualityBand(effectiveSkill: number, curve: QualityBand[] = OUTPUT_QUALITY_CURVE): QualityBand {
  const sorted = [...curve].sort((a, b) => a.effectiveSkillMin - b.effectiveSkillMin);
  let selected = sorted[0];
  for (const band of sorted) if (effectiveSkill >= band.effectiveSkillMin) selected = band;
  return selected;
}

export function rollOutputQuality(input: QualityRollInput, seed = 1): QualityRollResult {
  const effectiveSkill = calculateEffectiveSkill(input);
  const selectedBand = selectQualityBand(effectiveSkill);
  const rng = createSeededRng(seed);
  let roll = rng.next();
  const tiers: QualityTier[] = ['Crude', 'Standard', 'Refined', 'Superior', 'Prototype'];
  for (const tier of tiers) { roll -= selectedBand.chances[tier]; if (roll <= 0) return { effectiveSkill, selectedBand, quality: tier }; }
  return { effectiveSkill, selectedBand, quality: 'Prototype' };
}

function xpFor(actionId: string): number { return XP_ACTION_REWARDS.find((reward) => reward.actionId === actionId)?.xp ?? 0; }

export function calculateDailyXp(assumptions: SimulationAssumptions = DEFAULT_SIMULATION_ASSUMPTIONS): DailyXpBreakdown {
  const roamingTicksPerDay = (assumptions.roamingHoursPerDay * 60 * 60) / assumptions.tickSeconds;
  const roamingMinutesPerDay = assumptions.roamingHoursPerDay * 60;
  const bossAttemptsPerDay = 24 / assumptions.bossAttemptIntervalHours;
  const roamingTickXp = roamingTicksPerDay * xpFor('roaming_tick');
  const enemyDefeatXp = roamingMinutesPerDay * assumptions.killsPerMinute * xpFor('enemy_defeated');
  const damageCreditXp = roamingMinutesPerDay * assumptions.damageCreditsPerMinute * xpFor('damage_credit');
  const bossAttemptXp = bossAttemptsPerDay * xpFor('boss_attempt');
  const bossVictoryXp = bossAttemptsPerDay * assumptions.bossWinRate * xpFor('boss_victory');
  const scrapXp = assumptions.scrapsPerDay * xpFor('scrap_item');
  const craftXp = assumptions.craftsPerDay * xpFor('craft_complete');
  const totalXp = roamingTickXp + enemyDefeatXp + damageCreditXp + bossAttemptXp + bossVictoryXp + scrapXp + craftXp;
  return { roamingTickXp, enemyDefeatXp, damageCreditXp, bossAttemptXp, bossVictoryXp, scrapXp, craftXp, totalXp };
}

export function xpToNextLevel(level: number): number {
  if (level < 1) throw new Error('Level must be at least 1.');
  // Curve: 50*n + 20*n^1.4
  // Mirrored server-side in supabase/migrations/202606080057_xp_curve_and_wipe_slate.sql
  return Math.floor(50 * level + 20 * Math.pow(level, 1.4));
}

export function buildLevelCurve(maxLevel = 100, assumptions: SimulationAssumptions = DEFAULT_SIMULATION_ASSUMPTIONS): LevelCurvePoint[] {
  const dailyXp = calculateDailyXp(assumptions).totalXp;
  let cumulativeXpToReach = 0;
  let cumulativeDaysAtStressAssumption = 0;
  const curve: LevelCurvePoint[] = [];
  for (let level = 1; level <= maxLevel; level++) {
    const xpToNext = level === maxLevel ? 0 : xpToNextLevel(level);
    const daysAtStressAssumption = xpToNext === 0 ? 0 : xpToNext / dailyXp;
    curve.push({ level, xpToNext, cumulativeXpToReach, daysAtStressAssumption, cumulativeDaysAtStressAssumption });
    cumulativeXpToReach += xpToNext;
    cumulativeDaysAtStressAssumption += daysAtStressAssumption;
  }
  return curve;
}
