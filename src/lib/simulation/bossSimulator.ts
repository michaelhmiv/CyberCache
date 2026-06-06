import { BossDef, BossAttemptResult } from '../../types/boss';
import { Weapon, Shield, Ordnance, ClassMod, Relic } from '../../types/items';
import { ConsumableType, RiskSetting, Element } from '../../types/game';
import { getElementMatchup } from '../../constants/elements';
import { CONSUMABLES } from '../../constants/consumables';

export interface BossSimulationInput {
  primary: Weapon | null;
  secondary: Weapon | null;
  heavy: Weapon | null;
  ordnance: Ordnance | null;
  shield: Shield | null;
  classMod: ClassMod | null;
  relic: Relic | null;
  consumables: Record<string, number>;
  risk: RiskSetting;
  boss: BossDef;
  playerLevel: number;
  skillBonuses: Record<string, number>;
}

export interface BossSimulationOutput {
  winChance: number;
  survivalScore: number;
  breakScore: number;
  dpsScore: number;
  mechanicScore: number;
  reasons: string[];
  recommendations: string[];
  expectedConsumableUsage: Record<string, number>;
  deathFee: number;
}

function getRiskModifiers(risk: RiskSetting) {
  switch (risk) {
    case RiskSetting.Conservative:
      return { survivalMult: 1.2, dpsMult: 0.95, consumableMult: 1.4, chaos: -0.02 };
    case RiskSetting.Balanced:
      return { survivalMult: 1.0, dpsMult: 1.0, consumableMult: 1.0, chaos: 0 };
    case RiskSetting.Greedy:
      return { survivalMult: 0.9, dpsMult: 1.05, consumableMult: 0.7, chaos: 0.02 };
    case RiskSetting.AllIn:
      return { survivalMult: 0.8, dpsMult: 1.15, consumableMult: 1.6, chaos: 0.04 };
  }
}

export function simulateBoss(input: BossSimulationInput): BossSimulationOutput {
  const { primary, shield, ordnance, heavy, consumables, risk, boss, playerLevel, skillBonuses, secondary } = input;
  const reasons: string[] = [];
  const recommendations: string[] = [];

  const rm = getRiskModifiers(risk);

  // 1. Survival Check
  let playerHP = 500 + playerLevel * 40;
  let playerShieldHP = (shield?.hp || 0) + 200 + playerLevel * 20;
  let mitigation = shield?.mitigation || 0.1;

  const medkits = consumables[ConsumableType.MedKit] || 0;
  const shieldCells = consumables[ConsumableType.ShieldCell] || 0;
  const insurance = consumables[ConsumableType.InsuranceToken] || 0;

  const medkitHealing = medkits * 150;
  const shieldCellBoost = shieldCells * 100;
  const totalSurvival = (playerHP + playerShieldHP + medkitHealing + shieldCellBoost) * rm.survivalMult * (1 + (skillBonuses.survival || 0));
  const bossTotalDamage = boss.dps * 30; // 30s fight baseline
  const survivalScore = totalSurvival / bossTotalDamage;

  if (survivalScore < 0.8) {
    reasons.push('Your survival is weak. Boss damage will overwhelm your shield.');
    recommendations.push('Equip a stronger shield or bring Med Kits / Shield Cells.');
  } else if (survivalScore > 1.5) {
    reasons.push('You can comfortably survive this encounter.');
  }

  // 2. Shield / Armor Break Check
  let shieldBreak = 0;
  let armorBreak = 0;
  const grenades = consumables[ConsumableType.Grenade] || 0;

  if (primary) {
    const element = primary.element;
    shieldBreak += primary.baseDamage * primary.shieldDamageMod * getElementMatchup(element, 'shield');
    armorBreak += primary.baseDamage * primary.armorDamageMod * getElementMatchup(element, 'armor');
  }
  if (secondary) {
    shieldBreak += secondary.baseDamage * secondary.shieldDamageMod * 0.3 * getElementMatchup(secondary.element, 'shield');
    armorBreak += secondary.baseDamage * secondary.armorDamageMod * 0.3 * getElementMatchup(secondary.element, 'armor');
  }
  if (heavy) {
    armorBreak += heavy.baseDamage * heavy.armorDamageMod * 1.5; // heavy burst
  }
  if (ordnance) {
    shieldBreak += ordnance.shieldDamage * grenades;
    armorBreak += ordnance.armorDamage * grenades;
  }

  shieldBreak *= (1 + (skillBonuses.shieldBreak || 0));
  armorBreak *= (1 + (skillBonuses.armorBreak || 0));

  const shieldBreakScore = boss.shield > 0 ? shieldBreak / boss.shield : 1;
  const armorBreakScore = boss.armor > 0 ? armorBreak / boss.armor : 1;
  const breakScore = Math.min(shieldBreakScore, armorBreakScore);

  if (boss.shield > 0 && shieldBreakScore < 1) {
    reasons.push(`Shield break is insufficient. Need ${Math.round(boss.shield - shieldBreak)} more shield damage.`);
    recommendations.push(`Consider Shock weapons or Ordnance Charges.`);
  }
  if (boss.armor > 0 && armorBreakScore < 1) {
    reasons.push(`Armor break is insufficient. Need ${Math.round(boss.armor - armorBreak)} more armor damage.`);
    recommendations.push(`Consider Corrosive weapons or grenades.`);
  }

  // 3. DPS Check
  let dps = 0;
  if (primary) {
    const elemMatch = getElementMatchup(primary.element, boss.weaknesses[0] || 'flesh');
    dps += primary.baseDamage * primary.attackSpeed * (1 + primary.critChance * primary.critDamage) * primary.bossDamageMod * elemMatch;
  }
  if (secondary) {
    dps += secondary.baseDamage * secondary.attackSpeed * 0.3 * secondary.bossDamageMod;
  }
  if (heavy) {
    dps += heavy.baseDamage * heavy.attackSpeed * 0.5 * heavy.bossDamageMod; // heavy contributes burst over time
  }

  const ammoBoost = 1 + ((consumables[ConsumableType.AmmoPack] || 0) * 0.05);
  dps *= ammoBoost * rm.dpsMult * (1 + (skillBonuses.dps || 0));

  const timeToKill = boss.health / (dps || 1);
  const dpsScore = 30 / timeToKill; // 30s baseline

  if (dpsScore < 0.8) {
    reasons.push('Your DPS is too low. You will not defeat the boss before timeout.');
    recommendations.push('Upgrade primary weapon or bring Ammo Packs.');
  } else if (dpsScore > 1.4) {
    reasons.push('Your damage output is excellent.');
  }

  // 4. Mechanic Check
  let mechanicScore = 1;
  if (boss.mechanic.requiredLoadoutTrait) {
    const traitValue = skillBonuses[boss.mechanic.requiredLoadoutTrait] || 0;
    mechanicScore = traitValue >= (boss.mechanic.threshold || 0) ? 1 : 0.5;
    if (mechanicScore < 1) {
      reasons.push(`Boss mechanic "${boss.mechanic.name}" is not fully countered.`);
      recommendations.push(`Increase ${boss.mechanic.requiredLoadoutTrait} through skills or gear.`);
    }
  }

  // 5. Chaos / RNG
  const baseChance = Math.min(survivalScore, 1) * Math.min(breakScore, 1) * Math.min(dpsScore, 1.5) * mechanicScore;
  const chaosRoll = (Math.random() - 0.5) * 0.1 + rm.chaos; // ±5% variance
  let winChance = Math.max(0.02, Math.min(0.98, baseChance + chaosRoll));

  // Luck booster doesn't affect win chance but affects loot
  const luckBoosters = consumables[ConsumableType.LuckBooster] || 0;

  // Death fee
  const deathFeePercent = boss.tier <= 1 ? 0.03 : boss.tier <= 2 ? 0.05 : boss.tier <= 3 ? 0.07 : 0.10;
  const deathFeeCap = boss.tier <= 1 ? 2500 : boss.tier <= 2 ? 10000 : boss.tier <= 3 ? 25000 : 50000;
  let deathFee = 0; // computed at attempt time based on credits

  return {
    winChance,
    survivalScore,
    breakScore,
    dpsScore,
    mechanicScore,
    reasons,
    recommendations,
    expectedConsumableUsage: {},
    deathFee: 0,
  };
}

export function executeBossAttempt(
  input: BossSimulationInput,
  playerCredits: number
): { result: BossAttemptResult; creditsDelta: number; loot: Weapon[] } {
  const sim = simulateBoss(input);
  const win = Math.random() < sim.winChance;

  const deathFeePercent = input.boss.tier <= 1 ? 0.03 : input.boss.tier <= 2 ? 0.05 : input.boss.tier <= 3 ? 0.07 : 0.10;
  const deathFeeCap = input.boss.tier <= 1 ? 2500 : input.boss.tier <= 2 ? 10000 : input.boss.tier <= 3 ? 25000 : 50000;
  const deathFee = win ? 0 : Math.min(Math.round(playerCredits * deathFeePercent), deathFeeCap);

  const creditsDelta = win ? Math.round(input.boss.level * 150) : -deathFee;

  // Determine phase of failure if lost
  let phaseFailed: string | undefined;
  let bossHpRemaining: number | undefined;
  if (!win) {
    if (sim.survivalScore < sim.breakScore && sim.survivalScore < sim.dpsScore) phaseFailed = 'survival';
    else if (sim.breakScore < sim.dpsScore) phaseFailed = 'break';
    else phaseFailed = 'dps';
    bossHpRemaining = Math.round((1 - Math.random() * 0.6) * 100);
  }

  const result: BossAttemptResult = {
    id: crypto.randomUUID?.() || String(Date.now()),
    bossId: input.boss.id,
    timestamp: Date.now(),
    victory: win,
    winChance: sim.winChance,
    phaseFailed,
    bossHpRemaining,
    consumablesUsed: win ? {} : input.consumables,
    consumablesLost: win ? {} : input.consumables,
    creditsGained: win ? creditsDelta : 0,
    creditsLost: win ? 0 : deathFee,
    loot: [],
    reasons: sim.reasons,
    recommendations: sim.recommendations,
  };

  return { result, creditsDelta, loot: [] };
}
