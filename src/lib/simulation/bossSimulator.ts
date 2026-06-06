import { BossDef, BossAttemptResult } from '../../types/boss';
import { Weapon, Shield, Ordnance, ClassMod, Relic } from '../../types/items';
import { RiskSetting, Element } from '../../types/game';
import { getElementMatchup } from '../../constants/elements';

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

function calculateAmmoWindows(
  weapon: Weapon | null,
  ammoPacksLoaded: number,
  fightDuration: number = 30
): { fullDuration: number; reloadDuration: number; ammoPacksUsed: number } {
  if (!weapon) return { fullDuration: 0, reloadDuration: 0, ammoPacksUsed: 0 };

  const typeDef = weapon as any;
  const magDuration = (typeDef.magDurationSeconds || 10) / (typeDef.ammoDrainRate || 1);
  const reloadTime = typeDef.reloadSeconds || 2;

  let time = 0;
  let packsUsed = 0;
  let fullDuration = 0;
  let reloadDuration = 0;

  while (time < fightDuration) {
    const windowEnd = Math.min(time + magDuration, fightDuration);
    fullDuration += windowEnd - time;
    time = windowEnd;
    if (time >= fightDuration) break;

    if (packsUsed < ammoPacksLoaded) {
      packsUsed++;
      // Ammo pack extends mag duration
      const extraEnd = Math.min(time + 10, fightDuration);
      fullDuration += extraEnd - time;
      time = extraEnd;
      if (time >= fightDuration) break;
    }

    const reloadEnd = Math.min(time + reloadTime, fightDuration);
    reloadDuration += reloadEnd - time;
    time = reloadEnd;
  }

  return { fullDuration, reloadDuration, ammoPacksUsed: packsUsed };
}

function applySignatureMechanic(
  weapon: Weapon | null,
  fullDuration: number,
  reloadDuration: number,
  fightDuration: number
): { dpsMult: number; statusMult: number; armorBreakMult: number; staggerAttempts: number } {
  if (!weapon) return { dpsMult: 1, statusMult: 1, armorBreakMult: 1, staggerAttempts: 0 };

  const mechanic = (weapon as any).signatureMechanic || '';

  switch (mechanic) {
    case 'sidearm_recovery':
      // Pistol: minimal reload penalty
      return { dpsMult: 1, statusMult: 1, armorBreakMult: 1, staggerAttempts: 0 };

    case 'overheat': {
      // SMG: 8s active at 1.5x, 3s cooldown at 0.1x
      const cycle = 11; // 8 + 3
      const cycles = fightDuration / cycle;
      const activeRatio = (cycles * 8) / fightDuration;
      const cooldownRatio = (cycles * 3) / fightDuration;
      const avgMult = activeRatio * 1.5 + cooldownRatio * 0.1;
      return { dpsMult: avgMult, statusMult: 1.2, armorBreakMult: 1, staggerAttempts: 0 };
    }

    case 'multi_proc': {
      // Shotgun: 8 pseudo-pellets, higher effective status
      return { dpsMult: 1, statusMult: 2.2, armorBreakMult: 1.25, staggerAttempts: 0 };
    }

    case 'precision_window': {
      // Sniper: first 3s of each phase +40%
      const phases = 3; // shield, armor, health (approx)
      const bonusTime = Math.min(phases * 3, fightDuration);
      const avgMult = 1 + (bonusTime / fightDuration) * 0.4;
      return { dpsMult: avgMult, statusMult: 1, armorBreakMult: 1, staggerAttempts: 0 };
    }

    case 'reload_lock_stagger': {
      // Launcher: each shot is a stagger attempt, low sustained DPS
      const shots = Math.floor(fightDuration / 6); // 2s mag + 4s reload
      return { dpsMult: 0.85, statusMult: 1.2, armorBreakMult: 1.3, staggerAttempts: shots };
    }

    case 'ramp_sustain': {
      // Beam: ramps from 0.3 to 1.5 over 10s, avg ~0.9 over long fights
      const avgMult = fightDuration > 20 ? 1.1 : 0.85;
      return { dpsMult: avgMult, statusMult: 1.15, armorBreakMult: 1, staggerAttempts: 0 };
    }

    default:
      return { dpsMult: 1, statusMult: 1, armorBreakMult: 1, staggerAttempts: 0 };
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

  const medkits = consumables['MedKit'] || 0;
  const shieldCells = consumables['ShieldCell'] || 0;
  const insurance = consumables['InsuranceToken'] || 0;
  const nanoSwarms = consumables['NanoSwarm'] || 0;
  const adrenaline = consumables['AdrenalineShot'] || 0;

  const medkitHealing = medkits * 150;
  const shieldCellBoost = shieldCells * 100;
  const nanoSwarmRepair = nanoSwarms * 250;

  let totalSurvival = (playerHP + playerShieldHP + medkitHealing + shieldCellBoost + nanoSwarmRepair) * rm.survivalMult * (1 + (skillBonuses.survival || 0));

  // Emergency consumables boost survival
  if (adrenaline > 0) {
    totalSurvival *= 1.25;
  }

  const bossTotalDamage = boss.dps * 30;
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
  const grenades = consumables['OrdnanceCharge'] || 0;
  const phaseShift = consumables['PhaseShiftGrenade'] || 0;

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
    armorBreak += heavy.baseDamage * heavy.armorDamageMod * 1.5;
  }
  if (ordnance) {
    shieldBreak += ordnance.shieldDamage * grenades;
    armorBreak += ordnance.armorDamage * grenades;
  }

  // Elemental ammo modifiers
  if (consumables['ShockAmmo'] > 0) {
    shieldBreak *= 1.3;
  }
  if (consumables['CorrosiveAmmo'] > 0) {
    armorBreak *= 1.25;
  }
  if (consumables['ArmorPiercingAmmo'] > 0) {
    armorBreak *= 1.25;
  }
  if (phaseShift > 0) {
    armorBreak *= 1.5; // Phase Shift ignores armor for 5s
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

  // 3. DPS Check with Ammo Windows
  const ammoPacks = (consumables['AmmoPack'] || 0) +
    (consumables['ArmorPiercingAmmo'] || 0) +
    (consumables['IncendiaryAmmo'] || 0) +
    (consumables['ShockAmmo'] || 0) +
    (consumables['CorrosiveAmmo'] || 0) +
    (consumables['CryoAmmo'] || 0) +
    (consumables['VoidAmmo'] || 0);

  const primaryAmmo = calculateAmmoWindows(primary, ammoPacks, 30);
  const secondaryAmmo = calculateAmmoWindows(secondary, 0, 30); // secondary doesn't use ammo packs

  let primaryDPS = 0;
  if (primary) {
    const elemMatch = getElementMatchup(primary.element, boss.weaknesses[0] || 'flesh');
    const rawDPS = primary.baseDamage * primary.attackSpeed * (1 + primary.critChance * primary.critDamage) * primary.bossDamageMod * elemMatch;
    const sig = applySignatureMechanic(primary, primaryAmmo.fullDuration, primaryAmmo.reloadDuration, 30);
    const reloadPenalty = primaryAmmo.reloadDuration > 0 ? 0.3 : 1.0; // 30% DPS during reload
    const effectiveTime = primaryAmmo.fullDuration + primaryAmmo.reloadDuration * reloadPenalty;
    const ammoEfficiency = effectiveTime / 30;
    primaryDPS = rawDPS * ammoEfficiency * sig.dpsMult;
  }

  let secondaryDPS = 0;
  if (secondary) {
    const rawDPS = secondary.baseDamage * secondary.attackSpeed * 0.3 * secondary.bossDamageMod;
    const sig = applySignatureMechanic(secondary, secondaryAmmo.fullDuration, secondaryAmmo.reloadDuration, 30);
    secondaryDPS = rawDPS * sig.dpsMult;
  }

  let heavyDPS = 0;
  if (heavy) {
    heavyDPS = heavy.baseDamage * heavy.attackSpeed * 0.5 * heavy.bossDamageMod;
  }

  let dps = primaryDPS + secondaryDPS + heavyDPS;

  // Pre-fight consumables
  if (consumables['TargetPainter'] > 0) {
    dps *= 1.15; // +20% crit ≈ +15% DPS
  }
  if (consumables['OverchargeStim'] > 0) {
    dps *= 1.12; // Next 3 shots +100% averaged over 30s ≈ +12%
  }

  dps *= rm.dpsMult * (1 + (skillBonuses.dps || 0));

  const timeToKill = boss.health / (dps || 1);
  const dpsScore = 30 / timeToKill;

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

  // Jammer cancels enrage/phase mechanics
  if (consumables['Jammer'] > 0 && boss.mechanic.id && (boss.mechanic.id.includes('enrage') || boss.mechanic.id.includes('phase'))) {
    mechanicScore = 1;
  }

  // 5. Chaos / RNG — only applied during actual combat, not preview
  const baseChance = Math.min(survivalScore, 1) * Math.min(breakScore, 1) * Math.min(dpsScore, 1.5) * mechanicScore;
  let winChance = Math.max(0.02, Math.min(0.98, baseChance));

  // In actual combat (called from executeBossAttempt), chaos roll is applied there

  // Luck booster doesn't affect win chance but affects loot
  const luckBoosters = consumables['LuckBooster'] || 0;

  // Death fee
  const deathFeePercent = boss.tier <= 1 ? 0.03 : boss.tier <= 2 ? 0.05 : boss.tier <= 3 ? 0.07 : 0.10;
  const deathFeeCap = boss.tier <= 1 ? 2500 : boss.tier <= 2 ? 10000 : boss.tier <= 3 ? 25000 : 50000;
  let deathFee = 0;

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
): { result: BossAttemptResult; creditsDelta: number; loot: Weapon[]; consumedConsumables: Record<string, number> } {
  const sim = simulateBoss(input);
  // Apply chaos/RNG in actual combat (not in preview)
  const chaosRoll = (Math.random() - 0.5) * 0.1 + (input.risk === 'Conservative' ? -0.02 : input.risk === 'Greedy' ? 0.02 : input.risk === 'AllIn' ? 0.04 : 0);
  const adjustedChance = Math.max(0.02, Math.min(0.98, sim.winChance + chaosRoll));
  const win = Math.random() < adjustedChance;

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

  // Consumables actually consumed
  const consumedConsumables: Record<string, number> = {};
  if (!win) {
    // On defeat, all loaded consumables are consumed
    Object.entries(input.consumables).forEach(([type, count]) => {
      if (count > 0) consumedConsumables[type] = count;
    });
  } else {
    // On victory: pre-fight and mid-fight are consumed, emergency only if used
    Object.entries(input.consumables).forEach(([type, count]) => {
      if (count > 0 && type !== 'AdrenalineShot' && type !== 'NanoSwarm' && type !== 'MedKit' && type !== 'MedKitRefined') {
        consumedConsumables[type] = count;
      }
    });
  }

  const result: BossAttemptResult = {
    id: crypto.randomUUID?.() || String(Date.now()),
    bossId: input.boss.id,
    timestamp: Date.now(),
    victory: win,
    winChance: sim.winChance,
    phaseFailed,
    bossHpRemaining,
    consumablesUsed: consumedConsumables,
    consumablesLost: consumedConsumables,
    creditsGained: win ? creditsDelta : 0,
    creditsLost: win ? 0 : deathFee,
    loot: [],
    reasons: sim.reasons,
    recommendations: sim.recommendations,
  };

  return { result, creditsDelta, loot: [], consumedConsumables };
}
