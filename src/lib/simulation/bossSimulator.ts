import { BossDef, BossAttemptResult, BossPhase, BossPrepAnalysis, PhaseAnalysis } from '../../types/boss';
import { Weapon, Shield, Ordnance, ClassMod, Relic } from '../../types/items';
import { Element, Manufacturer, RiskSetting } from '../../types/game';
import { getElementMatchup } from '../../constants/elements';
import { CONSUMABLES, ConsumableDef } from '../../constants/consumables';
import { applyLegendaryEffects, applyBadDecisionBonus, getHotSwapperSecondaryMult, getInsuranceFraudRefundChance } from '../legendaryEffects';
import { computeWeaponDps } from '../stats/dpsChain';
// Note: applySignatureMechanic used to be applied in the sim
// (one inline call per weapon). After PR E, the chain consumes the
// signature via the new src/lib/stats/signatureMechanic.ts module
// directly. The sim only needs ammoEfficiencyFromWindows for
// pre-computing the ammo-window efficiency it passes to the chain.
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
  pityCount?: number;
  playerCredits?: number;
}

export interface BossSimulationOutput extends BossPrepAnalysis {
  winChance: number;
  survivalScore: number;
  breakScore: number;
  dpsScore: number;
  mechanicScore: number;
  reasons: string[];
  recommendations: string[];
  expectedConsumableUsage: Record<string, number>;
  deathFee: number;
  bonusLootChance: number;
  extraLootRollChance: number;
  /**
   * Effective player DPS in damage/second. Already includes per-weapon
   * chain math, player-level skill bonuses, risk modifier, and the
   * penalty for dps=0. The HUD uses this to label the TTK card
   * ("@ 1,234 DPS") and to compute the recommended-power delta.
   */
  effectiveDPS: number;
  /**
   * Seconds to kill the boss at the current effective DPS. Already
   * guarded against division by zero — if effective DPS is 0 this
   * is boss.health (so the value is finite and large, not Infinity).
   */
  timeToKill: number;
}

interface RuleTotals {
  deathFeeReduction: number;
  bonusLootChance: number;
  extraLootRollChance: number;
  recommendationIntel: number;
}

type BossSimWeapon = Weapon & {
  magDurationSeconds?: number;
  ammoDrainRate?: number;
  reloadSeconds?: number;
  signatureMechanic?: string;
};

export function getBossRiskModifiers(risk: RiskSetting) {
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

function getRiskSummary(risk: RiskSetting): string {
  switch (risk) {
    case RiskSetting.Conservative:
      return 'Conservative: safer survival margins, more consumable usage, slightly lower DPS tempo.';
    case RiskSetting.Balanced:
      return 'Balanced: default safety and damage assumptions.';
    case RiskSetting.Greedy:
      return 'Greedy: higher DPS tempo, lower survival margin, fewer safety consumables.';
    case RiskSetting.AllIn:
      return 'All In: maximum DPS pressure with high consumption and high defeat risk.';
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function getStatus(score: number): PhaseAnalysis['status'] {
  if (score >= 1.25) return 'safe';
  if (score >= 1) return 'close';
  if (score >= 0.75) return 'risky';
  return 'failing';
}

function recommendationIsAnswered(recommendation: string, answers: string[]): boolean {
  const haystack = answers.join(' ').toLowerCase();
  return recommendation
    .toLowerCase()
    .split(/[ /-]+/)
    .filter((part) => part.length > 3)
    .some((part) => haystack.includes(part));
}

function getEquippedAnswers(input: BossSimulationInput, selectedDefs: ConsumableDef[]): string[] {
  const { primary, secondary, heavy, boss } = input;
  const weapons = [primary, secondary, heavy].filter((weapon): weapon is Weapon => Boolean(weapon));
  const answers: string[] = [];

  weapons.forEach((weapon, index) => {
    const slot = index === 0 ? 'Primary' : index === 1 ? 'Secondary' : 'Heavy';
    answers.push(`${slot}: ${weapon.element} ${weapon.weaponType}`);
    if (boss.weaknesses.includes(weapon.element)) answers.push(`${weapon.element} weakness match`);
    if (weapon.element === Element.Shock && boss.tags.includes('shield')) answers.push('Shock shield answer');
    if (weapon.element === Element.Corrosive && (boss.tags.includes('armor') || boss.tags.includes('repair'))) {
      answers.push('Corrosive armor/repair answer');
    }
    if (weapon.element === Element.Cryo && (boss.tags.includes('enrage') || boss.tags.includes('phase'))) {
      answers.push('Cryo control answer');
    }
    if (weapon.manufacturer === Manufacturer.Ironwood && (boss.tags.includes('enrage') || boss.tags.includes('burstCheck'))) {
      answers.push('Ironwood crit/burst pressure');
    }
    if (weapon.manufacturer === Manufacturer.BlastForge && (boss.tags.includes('armor') || boss.tags.includes('siege'))) {
      answers.push('BlastForge armor cracking');
    }
    if (weapon.bossDamageMod > 1.1) answers.push('boss-damage weapon affix');
    if (weapon.shieldDamageMod > 1.1 && boss.tags.includes('shield')) answers.push('shield-break weapon roll');
    if (weapon.armorDamageMod > 1.1 && boss.tags.includes('armor')) answers.push('armor-break weapon roll');
  });

  selectedDefs.forEach((def) => {
    answers.push(def.name);
    answers.push(def.tacticalRole);
  });

  return unique(answers);
}

type BossPhaseType = 'survival' | 'shieldBreak' | 'armorBreak' | 'dps' | 'mechanic';

function phaseScore(
  phaseType: BossPhaseType,
  scores: {
    survivalScore: number;
    shieldBreakScore: number;
    armorBreakScore: number;
    dpsScore: number;
    mechanicScore: number;
  }
): number {
  switch (phaseType) {
    case 'survival':
      return scores.survivalScore;
    case 'shieldBreak':
      return scores.shieldBreakScore;
    case 'armorBreak':
      return scores.armorBreakScore;
    case 'dps':
      return scores.dpsScore;
    case 'mechanic':
      return scores.mechanicScore;
    default:
      return 1;
  }
}

function getRelevantConsumables(input: BossSimulationInput, selectedDefs: ConsumableDef[], phaseType: BossPhaseType): string[] {
  const tagToPhase = {
    survival: ['burn', 'burst', 'elite'],
    shieldBreak: ['shield'],
    armorBreak: ['armor', 'repair'],
    dps: ['enrage', 'burst', 'elite'],
    mechanic: ['phase', 'repair', 'enrage'],
  } satisfies Record<BossPhaseType, string[]>;

  return selectedDefs
    .filter((def) => def.counterTags.some((tag) => input.boss.tags.includes(tag) || tagToPhase[phaseType].includes(tag)))
    .map((def) => `${def.name} x${input.consumables[def.id] || 1}`);
}

function buildPhaseAnalyses(
  input: BossSimulationInput,
  selectedDefs: ConsumableDef[],
  scores: {
    survivalScore: number;
    shieldBreakScore: number;
    armorBreakScore: number;
    dpsScore: number;
    mechanicScore: number;
  },
  equippedAnswers: string[]
): PhaseAnalysis[] {
  // This is intentionally approximate: phase/event labels are mapped onto the
  // current score model until a full combat scripting engine exists.
  const phases: BossPhase[] = input.boss.phases || [
    {
      id: input.boss.mechanic.id || 'legacy_check',
      name: input.boss.mechanic.name || 'Legacy Boss Check',
      description: input.boss.mechanic.description,
      type: input.boss.mechanic.checkType,
      targetValue: input.boss.mechanic.threshold || 1,
      recommendedCounters: ['stronger loadout', 'relevant consumables'],
      failureReason: input.boss.mechanic.description || 'The legacy boss check is underprepared.',
      successReason: 'Current prep is enough for this legacy boss check.',
      eventTrigger: 'bossMechanic',
    },
  ];

  return phases.map((phase) => {
    const normalizedScore = phaseScore(phase.type, scores) / phase.targetValue;
    const status = getStatus(normalizedScore);
    const relevantConsumables = getRelevantConsumables(input, selectedDefs, phase.type);
    const currentAnswers = equippedAnswers.filter((answer) =>
      phase.recommendedCounters.some((counter) => recommendationIsAnswered(counter, [answer]))
    );
    const missingCounters = phase.recommendedCounters.filter((counter) => !recommendationIsAnswered(counter, [...currentAnswers, ...relevantConsumables]));

    return {
      phaseId: phase.id,
      phaseName: phase.name,
      score: normalizedScore,
      status,
      currentAnswers: unique([...currentAnswers, ...relevantConsumables]),
      missingCounters,
      relevantConsumables,
      explanation: status === 'safe' || status === 'close' ? phase.successReason : phase.failureReason,
    };
  });
}

function selectProjectedFailurePhase(phaseAnalyses: PhaseAnalysis[]): PhaseAnalysis | undefined {
  return [...phaseAnalyses].sort((a, b) => {
    const severity = { failing: 0, risky: 1, close: 2, safe: 3 };
    const severityDelta = severity[a.status] - severity[b.status];
    if (severityDelta !== 0) return severityDelta;
    return a.score - b.score;
  })[0];
}

function getConsumablesAtRisk(input: BossSimulationInput, selectedDefs: ConsumableDef[], phaseAnalyses: PhaseAnalysis[]): string[] {
  const riskyPhaseTypes = new Set(
    phaseAnalyses
      .filter((phase) => phase.status === 'failing' || phase.status === 'risky')
      .map((phase) => input.boss.phases?.find((bossPhase) => bossPhase.id === phase.phaseId)?.type)
  );
  const tagToPhase = {
    survival: ['burn', 'burst', 'elite'],
    shieldBreak: ['shield'],
    armorBreak: ['armor', 'repair'],
    dps: ['enrage', 'burst', 'elite'],
    mechanic: ['phase', 'repair', 'enrage'],
  } satisfies Record<BossPhaseType, string[]>;

  return selectedDefs
    .filter((def) => {
      const relevantToRisk = Array.from(riskyPhaseTypes).some((phaseType) => {
        if (!phaseType) return false;
        return def.counterTags.some((tag) => tagToPhase[phaseType].includes(tag) || input.boss.tags.includes(tag));
      });
      return relevantToRisk || def.consumePolicy === 'onAttempt' || def.consumePolicy === 'onDefeat';
    })
    .map((def) => `${def.name} x${input.consumables[def.id] || 1}: ${def.uiHints[1] || def.shortDescription}`);
}

function selectedConsumableDefs(consumables: Record<string, number>): ConsumableDef[] {
  return Object.entries(consumables).flatMap(([id, count]) => {
    const def = CONSUMABLES[id];
    if (!def || count <= 0) return [];
    return Array.from({ length: count }, () => def);
  });
}

function getRuleTotals(defs: ConsumableDef[]): RuleTotals {
  return defs.reduce<RuleTotals>(
    (totals, def) => ({
      deathFeeReduction: Math.min(0.95, totals.deathFeeReduction + (def.effectRules.deathFeeReduction || 0)),
      bonusLootChance: Math.min(1, totals.bonusLootChance + (def.effectRules.bonusLootChance || 0)),
      extraLootRollChance: Math.min(1, totals.extraLootRollChance + (def.effectRules.extraLootRollChance || 0)),
      recommendationIntel: totals.recommendationIntel + (def.effectRules.recommendationIntel || 0),
    }),
    { deathFeeReduction: 0, bonusLootChance: 0, extraLootRollChance: 0, recommendationIntel: 0 }
  );
}

export function getBossConsumableUsage(consumables: Record<string, number>, win: boolean, survivalScore: number): Record<string, number> {
  const used: Record<string, number> = {};

  Object.entries(consumables).forEach(([type, count]) => {
    const def = CONSUMABLES[type];
    if (!def || count <= 0) return;

    const shouldUse =
      def.consumePolicy === 'onAttempt' ||
      (def.consumePolicy === 'onVictory' && win) ||
      (def.consumePolicy === 'onDefeat' && !win) ||
      def.consumePolicy === 'onTrigger' ||
      (def.consumePolicy === 'ifUsed' && (!win || survivalScore < 1));

    if (shouldUse) used[type] = count;
  });

  return used;
}

function calculateAmmoWindows(
  weapon: Weapon | null,
  ammoPacksLoaded: number,
  fightDuration: number = 30
): { fullDuration: number; reloadDuration: number; ammoPacksUsed: number } {
  if (!weapon) return { fullDuration: 0, reloadDuration: 0, ammoPacksUsed: 0 };

  const typeDef = weapon as BossSimWeapon;
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

/** Convert an ammo-window result to a single efficiency multiplier. */
function ammoEfficiencyFromWindows(fullDuration: number, reloadDuration: number, fightDuration: number = 30): number {
  const reloadPenalty = reloadDuration > 0 ? 0.3 : 1.0; // 30% DPS during reload
  const effectiveTime = fullDuration + reloadDuration * reloadPenalty;
  return effectiveTime / fightDuration;
}

export function simulateBoss(input: BossSimulationInput): BossSimulationOutput {
  const { primary, secondary, shield, ordnance, heavy, consumables, risk, boss, playerLevel, skillBonuses, relic, pityCount = 0, playerCredits = 0 } = input;
  const reasons: string[] = [];
  const recommendations: string[] = [];

  const rm = getBossRiskModifiers(risk);
  const selectedDefs = selectedConsumableDefs(consumables);
  const rules = getRuleTotals(selectedDefs);

  // Legendary effect modifiers (damage/survival/break/credit multipliers).
  // SIM PROXY note: several effects are approximated here as flat
  // multipliers — each proxy case is labelled in applyLegendaryEffects
  // (src/lib/legendaryEffects.ts) and in MECHANICS.md §1. Effects with
  // real economy hooks (second_opinion, salvage_rights, market_crash,
  // jackpot) are implemented in the Chef / Postgres appliers, not here.
  const legendary = applyLegendaryEffects(primary, pityCount);

  // 1. Survival Check
  const playerHP = 500 + playerLevel * 40;
  const playerShieldHP = shield?.hp || 0;

  const medkits = consumables['MedKit'] || 0;
  const shieldCells = consumables['ShieldCell'] || 0;
  const nanoSwarms = consumables['NanoSwarm'] || 0;
  const adrenaline = consumables['AdrenalineShot'] || 0;

  const medkitHealing = medkits * 150;
  const shieldCellBoost = shieldCells * 100;
  const nanoSwarmRepair = nanoSwarms * 250;

  let totalSurvival = (playerHP + playerShieldHP + medkitHealing + shieldCellBoost + nanoSwarmRepair) * rm.survivalMult * legendary.survivalMult * (1 + (skillBonuses.survival || 0));

  // Shield mitigation: % damage reduction effectively multiplies the survival pool.
  // Capped at 80% mitigation (i.e., max 5× effective HP multiplier).
  const shieldMitigation = Math.min(0.8, shield?.mitigation ?? 0);
  if (shieldMitigation > 0) {
    totalSurvival *= 1 / (1 - shieldMitigation);
  }

  // Relic affixes: sum bossDamageMod and survivalBoost (Phase 5c).
  let relicBossDmgMod = 0;
  let relicSurvivalBoost = 0;
  if (relic) {
    for (const affix of relic.affixes) {
      if (affix.stat === 'bossDamageMod') relicBossDmgMod += affix.value;
      if (affix.stat === 'survivalBoost') relicSurvivalBoost += affix.value;
    }
  }
  if (relicSurvivalBoost > 0) {
    totalSurvival *= (1 + relicSurvivalBoost);
  }

  // Emergency consumables boost survival
  if (adrenaline > 0) {
    totalSurvival *= 1.25;
  }

  // CryoAmmo slows boss by 15%
  if (consumables['CryoAmmo'] > 0) {
    totalSurvival *= 1.15; // Boss does 15% less damage
  }

  // VoidAmmo reduces self shield by 5%
  if (consumables['VoidAmmo'] > 0) {
    totalSurvival *= 0.95;
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
  let grenades = consumables['OrdnanceCharge'] || 0;
  const phaseShift = consumables['PhaseShiftGrenade'] || 0;

  // MagnetizedPayload: +2 free ordnance uses
  if (consumables['MagnetizedPayload'] > 0) {
    grenades += 2;
  }

  if (primary) {
    const element = primary.element;
    shieldBreak += primary.baseDamage * primary.shieldDamageMod * getElementMatchup(element, 'shield') * legendary.shieldBreakMult;
    armorBreak += primary.baseDamage * primary.armorDamageMod * getElementMatchup(element, 'armor') * legendary.armorBreakMult;
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

  // Ordnance flat damage: reduces boss effective HP (Phase 5a).
  let ordnanceFlatDamage = 0;
  if (ordnance && ordnance.damage > 0) {
    ordnanceFlatDamage = ordnance.damage * Math.max(1, grenades);
  }

  // Ordnance element matchup: modifies shield/armor break (Phase 5b).
  if (ordnance && ordnance.element) {
    const ordElemMatch = getElementMatchup(ordnance.element, 'shield');
    if (ordElemMatch !== 1) {
      shieldBreak += ordnance.shieldDamage * grenades * (ordElemMatch - 1);
      armorBreak += ordnance.armorDamage * grenades * (ordElemMatch - 1);
    }
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
  //
  // The per-weapon DPS now goes entirely through the chain
  // (src/lib/stats/dpsChain.ts). The chain is the single source of
  // truth for "how much damage does this weapon do per second against
  // a target with this element matchup, legendary bonus, ammo window,
  // signature mechanic, and consumable buffs". The sim's job is to
  // pre-compute the ammo windows (per-slot loadout decision) and
  // apply the per-slot contribution multipliers on top (secondary ×
  // 0.3 normally / 0.6 with Hot Swapper, heavy × 0.5).
  //
  // Risk modifier (rm.dpsMult) and skill bonus (skillBonuses.dps) are
  // player-level concerns and stay in the sim.
  const ammoPacks = (consumables['AmmoPack'] || 0) +
    (consumables['ArmorPiercingAmmo'] || 0) +
    (consumables['IncendiaryAmmo'] || 0) +
    (consumables['ShockAmmo'] || 0) +
    (consumables['CorrosiveAmmo'] || 0) +
    (consumables['CryoAmmo'] || 0) +
    (consumables['VoidAmmo'] || 0);

  const primaryAmmo = calculateAmmoWindows(primary, ammoPacks, 30);
  // Secondary doesn't use ammo packs and the chain handles secondary
  // signature internally now. No need to pre-compute its ammo window.
  // (Previously we called calculateAmmoWindows here to feed the
  // signature mechanic — now that's the chain's job.)

  let primaryDPS = 0;
  if (primary) {
    const ammoEff = ammoEfficiencyFromWindows(primaryAmmo.fullDuration, primaryAmmo.reloadDuration, 30);
    // The chain now handles signature + ammo efficiency + DPS-relevant
    // consumables internally. We pass the full `consumables` table
    // (Record<string, number>) and the chain looks up only the keys
    // in DPS_CONSUMABLE_EFFECTS.
    const chainDps = computeWeaponDps({
      weapon: primary,
      bossWeaknesses: boss.weaknesses,
      bossResistances: boss.resistances,
      consumables,
      legendaryDamageMult: legendary.damageMult,
      ammoEfficiency: ammoEff,
      bossDamageMod: primary.bossDamageMod,
    });
    primaryDPS = chainDps;
  }

  let secondaryDPS = 0;
  if (secondary) {
    const secContrib = getHotSwapperSecondaryMult(primary); // 0.6 with Hot Swapper, 0.3 normally
    // Secondary doesn't have an ammo window in the sim (secondary
    // weapons don't consume ammo packs). ammoEfficiency stays at the
    // default 1.0 in the chain.
    const chainDps = computeWeaponDps({
      weapon: secondary,
      bossWeaknesses: boss.weaknesses,
      bossResistances: boss.resistances,
      consumables,
      legendaryDamageMult: 1, // secondary doesn't get the primary's legendary bonus
      bossDamageMod: secondary.bossDamageMod,
    });
    secondaryDPS = chainDps * secContrib;
  }

  let heavyDPS = 0;
  if (heavy) {
    // Heavy has a per-slot "0.5" contribution that lives in the sim
    // (not the chain) because it's a loadout-decision concern, not a
    // per-weapon property. The chain still gets boss context so the
    // element matchup applies.
    const chainDps = computeWeaponDps({
      weapon: heavy,
      bossWeaknesses: boss.weaknesses,
      bossResistances: boss.resistances,
      consumables,
      legendaryDamageMult: 1,
      bossDamageMod: heavy.bossDamageMod,
    });
    heavyDPS = chainDps * 0.5 * (1 + (skillBonuses.heavyDamageBonus || 0));
  }

  let dps = primaryDPS + secondaryDPS + heavyDPS;

  // Player-level modifiers (not per-weapon) stay in the sim.
  // The chain's per-weapon DPS already includes signature, ammo
  // efficiency, and DPS-relevant consumables.
  dps *= rm.dpsMult * (1 + (skillBonuses.dps || 0)) * (1 + (skillBonuses.bossDamageMod || 0) + relicBossDmgMod);

  const netBossHp = Math.max(1, boss.health - ordnanceFlatDamage);
  const timeToKill = netBossHp / (dps || 1);
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

  if (rules.recommendationIntel > 0) {
    const weakest = [
      { label: 'survival', score: survivalScore },
      { label: 'break', score: breakScore },
      { label: 'DPS', score: dpsScore },
      { label: 'mechanic', score: mechanicScore },
    ].sort((a, b) => a.score - b.score)[0];
    recommendations.unshift(`Boss Scanner readout: ${weakest.label} is the weakest projected check.`);
  }

  const equippedAnswers = getEquippedAnswers(input, selectedDefs);
  const phaseAnalyses = buildPhaseAnalyses(
    input,
    selectedDefs,
    { survivalScore, shieldBreakScore, armorBreakScore, dpsScore, mechanicScore },
    equippedAnswers
  );
  const projectedFailurePhase = selectProjectedFailurePhase(phaseAnalyses);
  const missingCounters = unique(phaseAnalyses.flatMap((phase) => phase.missingCounters).slice(0, 10));
  const consumablesAtRisk = getConsumablesAtRisk(input, selectedDefs, phaseAnalyses);

  phaseAnalyses.forEach((phase) => {
    if (phase.status === 'failing') {
      reasons.push(`${phase.phaseName}: ${phase.explanation}`);
    } else if (phase.status === 'risky') {
      reasons.push(`${phase.phaseName}: risky. ${phase.explanation}`);
    } else if (phase.currentAnswers.length > 0) {
      reasons.push(`${phase.phaseName}: covered by ${phase.currentAnswers.slice(0, 2).join(', ')}.`);
    }
  });

  if (missingCounters.length > 0) {
    recommendations.push(`Recommended: ${missingCounters.slice(0, 3).join(', ')}.`);
  }

  // 5. Pity system: +3% win chance per failed attempt, capped at +30%
  const pityBonus = Math.min(0.30, pityCount * 0.03);
  
  // 6. Chaos / RNG — only applied during actual combat, not preview
  const baseChance = Math.min(survivalScore, 1) * Math.min(breakScore, 1) * Math.min(dpsScore, 1.5) * mechanicScore + pityBonus;
  const winChance = Math.max(0.02, Math.min(0.98, baseChance));

  // In actual combat (called from executeBossAttempt), chaos roll is applied there

  // Death fee (computed here for preview display)
  let deathFeePercent = boss.tier <= 1 ? 0.03 : boss.tier <= 2 ? 0.05 : boss.tier <= 3 ? 0.07 : 0.10;
  deathFeePercent *= 1 - rules.deathFeeReduction;
  
  const deathFeeCap = boss.tier <= 1 ? 2500 : boss.tier <= 2 ? 10000 : boss.tier <= 3 ? 25000 : 50000;
  const deathFee = Math.min(Math.round(playerCredits * deathFeePercent), deathFeeCap);

  return {
    winChance,
    projectedWinChance: winChance,
    projectedFailurePhase,
    phaseAnalyses,
    equippedAnswers,
    missingCounters,
    consumablesAtRisk,
    riskSummary: getRiskSummary(risk),
    survivalScore,
    breakScore,
    dpsScore,
    mechanicScore,
    reasons: unique(reasons),
    recommendations: unique(recommendations),
    expectedConsumableUsage: getBossConsumableUsage(consumables, winChance >= 0.5, survivalScore),
    deathFee,
    bonusLootChance: rules.bonusLootChance,
    extraLootRollChance: rules.extraLootRollChance,
    effectiveDPS: dps,
    timeToKill,
  };
}

export function executeBossAttempt(
  input: BossSimulationInput,
  playerCredits: number
): { result: BossAttemptResult; creditsDelta: number; loot: Weapon[]; consumedConsumables: Record<string, number>; extraLoot: boolean; bonusLootRolls: number } {
  const sim = simulateBoss(input);
  const selectedDefs = selectedConsumableDefs(input.consumables);
  const rules = getRuleTotals(selectedDefs);
  const legendary = applyLegendaryEffects(input.primary, input.pityCount || 0);
  // Apply chaos/RNG in actual combat (not in preview)
  const chaosRoll = (Math.random() - 0.5) * 0.1 + (input.risk === 'Conservative' ? -0.02 : input.risk === 'Greedy' ? 0.02 : input.risk === 'AllIn' ? 0.04 : 0);
  const adjustedChance = Math.max(0.02, Math.min(0.98, sim.winChance + chaosRoll));
  const win = Math.random() < adjustedChance;

  const bonusLootRolls = win
    ? (Math.random() < rules.bonusLootChance ? 1 : 0) + (Math.random() < rules.extraLootRollChance ? 1 : 0)
    : 0;

  let deathFeePercent = input.boss.tier <= 1 ? 0.03 : input.boss.tier <= 2 ? 0.05 : input.boss.tier <= 3 ? 0.07 : 0.10;
  deathFeePercent *= 1 - rules.deathFeeReduction;
  
  const deathFeeCap = input.boss.tier <= 1 ? 2500 : input.boss.tier <= 2 ? 10000 : input.boss.tier <= 3 ? 25000 : 50000;
  const deathFee = win ? 0 : Math.min(Math.round(playerCredits * deathFeePercent), deathFeeCap);

  const creditsDelta = win ? Math.round(input.boss.level * 150 * legendary.creditMult) : -deathFee;
  const finalCredits = applyBadDecisionBonus(creditsDelta, input.primary);
  const projectedPhase = sim.projectedFailurePhase;

  // Determine phase of failure if lost
  let phaseFailed: string | undefined;
  let bossHpRemaining: number | undefined;
  if (!win) {
    if (projectedPhase) phaseFailed = projectedPhase.phaseName;
    else if (sim.survivalScore < sim.breakScore && sim.survivalScore < sim.dpsScore) phaseFailed = 'survival';
    else if (sim.breakScore < sim.dpsScore) phaseFailed = 'break';
    else phaseFailed = 'dps';
    bossHpRemaining = Math.round((1 - Math.random() * 0.6) * 100);
  }

  const consumedConsumables = getBossConsumableUsage(input.consumables, win, sim.survivalScore);
  const insuranceRefundChance = getInsuranceFraudRefundChance(input.primary);
  if (insuranceRefundChance > 0) {
    Object.keys(consumedConsumables).forEach((type) => {
      if (Math.random() < insuranceRefundChance) {
        delete consumedConsumables[type];
      }
    });
  }

  const resultReasons = win
    ? [
        projectedPhase?.currentAnswers[0]
          ? `Victory: ${projectedPhase.phaseName} cleared with ${projectedPhase.currentAnswers[0]}.`
          : `Victory: ${input.boss.name} defeated with current prep.`,
        ...sim.reasons,
      ]
    : [
        projectedPhase
          ? `Defeat: Failed ${projectedPhase.phaseName}. ${projectedPhase.explanation}`
          : `Defeat: ${input.boss.name} outlasted your current prep.`,
        ...sim.reasons,
      ];

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
    reasons: unique(resultReasons),
    recommendations: sim.recommendations,
  };

  return { result, creditsDelta: finalCredits, loot: [], consumedConsumables, extraLoot: bonusLootRolls > 0, bonusLootRolls };
}
