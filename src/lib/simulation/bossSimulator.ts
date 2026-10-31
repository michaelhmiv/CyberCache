import { BossDef, BossAttemptResult, BossPhase, BossPrepAnalysis, PhaseAnalysis } from '../../types/boss';
import { Weapon, Shield, Ordnance, ClassMod, Relic } from '../../types/items';
import { Element, Manufacturer, RiskSetting, WeaponType } from '../../types/game';
import { getElementMatchup } from '../../constants/elements';
import { CONSUMABLES, ConsumableDef, getConsumableRuntimeEffects } from '../../constants/consumables';
import { applyLegendaryEffects, applyBadDecisionBonus, getHotSwapperSecondaryMult, getInsuranceFraudRefundChance } from '../legendaryEffects';
import { computeWeaponDps } from '../stats/dpsChain';
import { computeHunterMaxHp } from '../combat/damageContract';
import {
  SHIELD_BEHAVIOR_TUNING,
  modelShieldBehaviorForBoss,
  shieldBehaviorOf,
} from '../combat/shieldBehaviors';
// Note: applySignatureMechanic used to be applied in the sim
// (one inline call per weapon). After PR E, the chain consumes the
// signature via the new src/lib/stats/signatureMechanic.ts module
// directly. The sim only needs ammoEfficiencyFromWindows for
// pre-computing the ammo-window efficiency it passes to the chain.

/**
 * A fired action skill's sim-native effect (Action Skill slice,
 * src/content/actionSkills.ts owns the magnitudes). Resolved by the
 * server route from the player's OWN records + live levers and handed
 * to the Chef engines — the sim only applies it. Every term resolves
 * through the sim's EXISTING machinery (stagger multiplier, break
 * totals, flat boss damage like ordnance/nova) — no parallel combat
 * math. Only Gunslinger (flat burst) and Demolition (saturation) have
 * sim effects; Scavenger bends drop odds in the Chef and the Fixer's
 * Overclock scales the consumableQuality input instead. Absent (every
 * client prep sim, every unfired attempt) = the shipped sim exactly.
 */
export interface ActionSkillSimEffect {
  /** SkillTreeType value of the fired signature. */
  tree: string;
  /**
   * Flat damage dealt to the boss: joins ordnance/nova flat damage
   * in netBossHp (the kill clock), and — because the survival model
   * prices a fixed exposure window — erases the same share of the
   * boss's total damage (the burst exposure fold on bossTotalDamage).
   */
  flatDamage?: number;
  /** Bonus shield-break damage added to the break totals. */
  shieldBreakBonus?: number;
  /** Bonus armor-break damage added to the break totals. */
  armorBreakBonus?: number;
  /** Stagger window: share of the fight the boss spends staggered. */
  staggerUptime?: number;
  /** Boss damage cut while staggered (the Concussive Payload term). */
  staggerMitigation?: number;
}

export interface BossSimulationInput {
  primary: Weapon | null;
  secondary: Weapon | null;
  heavy: Weapon | null;
  ordnance: Ordnance | null;
  shield: Shield | null;
  classMod: ClassMod | null;
  relic: Relic | null;
  consumables: Record<string, number>;
  /**
   * Per-type quality of the prepared consumables (crafting §2.4): the
   * quantity-weighted average quality of the units the applier will
   * burn, supplied by the verify-boss route from server batch rows.
   * Survival pools and the DPS chain read effects at this quality;
   * absent (client prep display, pre-slice callers) = flat 100, the
   * shipped sim exactly.
   */
  consumableQuality?: Record<string, number>;
  /**
   * A fired action skill's sim effect (Action Skill slice). Server
   * resolutions only — the client prep sim never passes it, so prep
   * output stays the shipped sim bit-for-bit.
   */
  actionSkill?: ActionSkillSimEffect;
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
  /** Echo of a fired action skill's tree (server resolutions only). */
  actionSkill?: { tree: string };
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

/**
 * Overclock Ramp tuning (boss roster expansion): a boss with the
 * `overclock_ramp` mechanic deals damage that scales with how long
 * the fight runs. The first GRACE seconds are unramped; past that,
 * total boss damage grows RATE per second of time-to-kill, capped at
 * MAX_MULT. Kill speed is the counter — the same pooled expected-
 * value style as the Amp shield model: at a 30s kill the ramp is
 * ×1.20, at 45s ×1.50, at 70s+ it caps at ×2.00.
 */
export const OVERCLOCK_RAMP = {
  graceSeconds: 20,
  ratePerSecond: 0.02,
  maxMult: 2,
} as const;

export function overclockRampMult(timeToKill: number): number {
  const over = Math.max(0, timeToKill - OVERCLOCK_RAMP.graceSeconds);
  return Math.min(OVERCLOCK_RAMP.maxMult, 1 + over * OVERCLOCK_RAMP.ratePerSecond);
}

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

/**
 * Consumption accounting for a boss attempt.
 *
 * The input map is the player's PREPARED set — the consumables they
 * deliberately chose to bring to this attempt (validated server-side
 * against owned inventory by the verify-boss route) — never the whole
 * inventory. For each prepared type, the def's consume policy decides
 * whether the prepared count is spent:
 *   onAttempt → always; onTrigger → always;
 *   onVictory → only on a win; onDefeat → only on a loss;
 *   ifUsed → on a loss, or on a win where the survival pool was
 *   actually stressed (survivalScore < 1);
 *   perInterval → never charged by a one-shot attempt.
 * The returned map is exactly what the Chef charges — a subset of the
 * prepared set, never more than was prepared.
 */
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

/**
 * Fraction of a weapon's chain DPS attributable to critical hits.
 * The chain's raw step is baseDamage × attackSpeed × (1 + cc × cd);
 * every later step multiplies uniformly, so the crit-attributable
 * share of the final figure is (cc × cd) / (1 + cc × cd). Used by
 * the Gunslinger major/keystone wiring (Weakspot Analysis, Death by
 * a Thousand Cuts) to price crit effects inside the pooled sim model
 * — the same expected-value style as the Amp shield model.
 */
function critShareOf(weapon: Weapon | null): number {
  if (!weapon) return 0;
  const critFactor = weapon.critChance * weapon.critDamage;
  if (critFactor <= 0) return 0;
  return critFactor / (1 + critFactor);
}

export function simulateBoss(input: BossSimulationInput): BossSimulationOutput {
  const { primary, secondary, shield, ordnance, heavy, consumables, risk, boss, playerLevel, skillBonuses, relic, classMod, pityCount = 0, playerCredits = 0 } = input;
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

  // Adaptive Plating (Mnemosyne Mirror, boss roster expansion): the
  // boss attunes to the PRIMARY weapon's element — it is struck from
  // her weaknesses and read as resisted for every DPS-chain call.
  // Sidearms and heavies of other elements are untouched, which is
  // exactly the build question the mechanic asks. The def's listed
  // profile stays the prep intel; the attunement applies on top of
  // it, and only while a primary is equipped.
  const adaptiveElement = boss.mechanic.id === 'adaptive_plating' ? primary?.element : undefined;
  const effectiveWeaknesses = adaptiveElement
    ? boss.weaknesses.filter((e) => e !== adaptiveElement)
    : boss.weaknesses;
  const effectiveResistances =
    adaptiveElement && !boss.resistances.includes(adaptiveElement)
      ? [...boss.resistances, adaptiveElement]
      : boss.resistances;
  if (adaptiveElement) {
    reasons.push(
      `Adaptive Plating: attuned to your primary's ${adaptiveElement} — it reads as resisted, never a weakness.`,
    );
  }

  // 1. Survival Check
  // ONE hunter HP formula everywhere: computeHunterMaxHp (700 + 60 per
  // level + shield HP) — the same formula the mechanics snapshot and
  // the roaming survival store use. The sim used to run its own
  // 500 + 40/level pool, so boss survival was silently ~27% lower
  // than the HP the player sees everywhere else.
  const playerHP = computeHunterMaxHp(playerLevel, 0);
  const playerShieldHP = shield?.hp || 0;

  const medkits = consumables['MedKit'] || 0;
  const shieldCells = consumables['ShieldCell'] || 0;
  const nanoSwarms = consumables['NanoSwarm'] || 0;
  const adrenaline = consumables['AdrenalineShot'] || 0;

  // Quality wiring (crafting §2.4): the pooled survival values below
  // are the sim's own baselines (150 / 100 / 250 per unit — the Shield
  // Cell's 100 is the sim's long-standing pool value, NOT the def's
  // 120 roaming restore; both are preserved). Each pool scales by the
  // ratio of the def's runtime effect at the prepared units' quality
  // to the def's base effect, so quality 100 leaves every pool
  // bit-identical and a 150% batch pays exactly 1.5× its pool share.
  const qualityScale = (type: string, field: 'healHp' | 'shieldRestore' | 'repairTotalHp'): number => {
    const quality = input.consumableQuality?.[type];
    if (quality === undefined) return 1;
    const base = CONSUMABLES[type]?.runtime.baseEffects[field];
    if (!base) return 1;
    const scaled = getConsumableRuntimeEffects(type, quality)[field];
    return scaled !== undefined ? scaled / base : 1;
  };

  const medkitHealing = medkits * 150 * qualityScale('MedKit', 'healHp');
  const shieldCellBoost = shieldCells * 100 * qualityScale('ShieldCell', 'shieldRestore');
  const nanoSwarmRepair = nanoSwarms * 250 * qualityScale('NanoSwarm', 'repairTotalHp');

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

  // Class mod affixes (Phase 0 boss-loop wiring — the class mod used to
  // be a dead sim input: present in BossSimulationInput, never read).
  // bossDamageMod / survivalBoost mirror the relic handling above; the
  // class-mod pool's weaponDamage / critChance convert to a DPS factor
  // exactly as the gear DPS derivation does (computeEffectiveDpsFromGear
  // in loadoutSurvival.ts: weaponDamage at full weight, critChance at
  // half weight). skillPoints affixes are progression, not combat.
  let classModBossDmgMod = 0;
  let classModSurvivalBoost = 0;
  let classModWeaponDamage = 0;
  let classModCritChance = 0;
  if (classMod) {
    for (const affix of classMod.affixes) {
      if (affix.stat === 'bossDamageMod') classModBossDmgMod += affix.value;
      if (affix.stat === 'survivalBoost') classModSurvivalBoost += affix.value;
      if (affix.stat === 'weaponDamage') classModWeaponDamage += affix.value;
      if (affix.stat === 'critChance') classModCritChance += affix.value;
    }
  }
  if (classModSurvivalBoost > 0) {
    totalSurvival *= (1 + classModSurvivalBoost);
  }
  const classModDpsMult = 1 + classModWeaponDamage + classModCritChance * 0.5;

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

  // Shield behavior (Phase 2c) — folded into the pooled model through
  // shieldBehaviors.ts, the same module the roaming seam resolves
  // per-hit. Standard / legacy shields (no behavior field) skip this
  // entirely and sim exactly as before. Absorb's negated damage is
  // computed in post-mitigation units, so it is converted into the
  // pool's raw-equivalent units by the same 1/(1-mitigation) factor
  // the pool itself received; Nova and Amp apply below (boss HP and
  // DPS respectively).
  const shieldBehavior = shieldBehaviorOf(shield);
  const bossShieldModel =
    shield && shieldBehavior !== 'standard'
      ? modelShieldBehaviorForBoss({
          behavior: shieldBehavior,
          capacity: playerShieldHP,
          refillPool: shieldCellBoost + nanoSwarmRepair,
          totalIncomingDamage: boss.dps * 30,
          mitigation: shieldMitigation,
        })
      : null;
  if (bossShieldModel) {
    if (bossShieldModel.absorbNegated > 0) {
      totalSurvival += bossShieldModel.absorbNegated / (1 - shieldMitigation);
    }
    if (shieldBehavior === 'nova' && bossShieldModel.novaDamage > 0) {
      reasons.push(
        `Nova shield: erupts for ${bossShieldModel.novaDamage} damage when it breaks${bossShieldModel.novaFirings > 1 ? ` (up to ${bossShieldModel.novaFirings} times with refills)` : ''}.`,
      );
    } else if (shieldBehavior === 'absorb') {
      reasons.push(
        `Absorb shield: negates about ${Math.round(SHIELD_BEHAVIOR_TUNING.absorbChance * 100)}% of the damage that lands on it.`,
      );
    } else if (shieldBehavior === 'amp') {
      reasons.push(
        `Amp shield: +${Math.round(SHIELD_BEHAVIOR_TUNING.ampPct * 100)}% damage while the shield holds (about ${Math.round(bossShieldModel.shieldUptimeFraction * 100)}% of this fight).`,
      );
    } else if (shieldBehavior === 'turtle') {
      reasons.push('Turtle shield: oversized capacity, slow recharge.');
    }
  }

  // Concussive Payload (Demolition major, Phase 2d): a staggered boss
  // deals reduced damage. Stagger uptime is modeled from the build's
  // stagger chance, stretched by staggerDuration; staggerMitigation
  // is the damage cut while staggered. Pooled expected value, the
  // same style as the Amp shield model — without the node, the
  // multiplier is exactly 1 and survival sims as before.
  const staggerMitigation = skillBonuses.staggerMitigation || 0;
  let staggerDamageMult = 1;
  if (staggerMitigation > 0) {
    const staggerUptime = Math.min(
      1,
      (skillBonuses.staggerChance || 0) * (1 + (skillBonuses.staggerDuration || 0)),
    );
    staggerDamageMult = 1 - staggerMitigation * staggerUptime;
    if (staggerUptime > 0) {
      reasons.push(
        `Concussive Payload: the boss is staggered ~${Math.round(staggerUptime * 100)}% of the fight, cutting its damage by ${Math.round(staggerMitigation * staggerUptime * 100)}%.`,
      );
    }
  }

  // Saturation Strike (Demolition action skill): the ordnance blanket
  // staggers the boss through the SAME stagger term — the windows
  // compose multiplicatively on the damage the boss deals, exactly
  // like a second Concussive Payload window. No new combat math.
  const saturation = input.actionSkill;
  if (
    saturation &&
    (saturation.staggerUptime ?? 0) > 0 &&
    (saturation.staggerMitigation ?? 0) > 0
  ) {
    const uptime = Math.min(1, Math.max(0, saturation.staggerUptime ?? 0));
    const mitigation = Math.max(0, saturation.staggerMitigation ?? 0);
    staggerDamageMult *= 1 - mitigation * uptime;
    reasons.push(
      `Saturation Strike: ordnance keeps the boss staggered ~${Math.round(uptime * 100)}% of the fight, cutting its damage by a further ${Math.round(mitigation * uptime * 100)}%.`,
    );
  }

  // Burst exposure (action skills with flat damage — Deadeye Salvo,
  // Saturation Strike): the survival model prices a fixed exposure
  // window; a burst that burns a share of the boss outright erases
  // that share of the window — the rounds that never happen deal no
  // damage. Priced as a multiplier on the boss's total damage in the
  // same slot as the stagger fold (no new combat math): survival
  // stays this one computation for every build.
  let burstExposureMult = 1;
  if (saturation && (saturation.flatDamage ?? 0) > 0 && boss.health > 0) {
    const erased = Math.min(0.9, Math.max(0, (saturation.flatDamage ?? 0) / boss.health));
    burstExposureMult = 1 - erased;
    if (erased > 0) {
      reasons.push(
        `${saturation.tree === 'Demolition' ? 'Saturation Strike' : 'Deadeye Salvo'}: ending the fight ~${Math.round(erased * 100)}% sooner means the boss deals ~${Math.round(erased * 100)}% less damage overall.`,
      );
    }
  }

  const bossTotalDamage = boss.dps * 30 * staggerDamageMult * burstExposureMult;
  const survivalScore = totalSurvival / bossTotalDamage;
  // Overclock Ramp may tax this score once the kill time is known
  // (see the ramp block after the DPS check); until then it is the
  // plain survival score and every other boss sims exactly as before.
  let effectiveSurvivalScore = survivalScore;

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
    // Scorched Earth (Demolition major, Phase 2d): a Launcher in the
    // heavy slot cracks armor harder.
    let heavyArmorBreak = heavy.baseDamage * heavy.armorDamageMod * 1.5;
    if (heavy.weaponType === WeaponType.Launcher) {
      heavyArmorBreak *= 1 + (skillBonuses.launcherArmorBreak || 0);
    }
    armorBreak += heavyArmorBreak;
  }
  // Ordnance contributions are accumulated separately so the
  // Demolition majors can scale the ordnance portion specifically
  // (Breaching Charge strips shield; Cluster Bombs re-trigger).
  let ordnanceShieldBreak = 0;
  let ordnanceArmorBreak = 0;
  if (ordnance) {
    ordnanceShieldBreak += ordnance.shieldDamage * grenades;
    ordnanceArmorBreak += ordnance.armorDamage * grenades;
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
      ordnanceShieldBreak += ordnance.shieldDamage * grenades * (ordElemMatch - 1);
      ordnanceArmorBreak += ordnance.armorDamage * grenades * (ordElemMatch - 1);
    }
  }

  // Breaching Charge (Demolition major, Phase 2d): ordnance strips an
  // additional share of shield before the DPS phase.
  const shieldStripBonus = skillBonuses.shieldStripBonus || 0;
  if (shieldStripBonus > 0) {
    ordnanceShieldBreak *= 1 + shieldStripBonus;
  }
  // Cluster Bombs (Demolition major, Phase 2d): each ordnance trigger
  // can re-trigger at reduced damage — priced at expected value
  // (1 + chance × second-trigger damage) across every ordnance
  // contribution, the pooled model's standard treatment of chance.
  const clusterEvMult = 1 + (skillBonuses.clusterChance || 0) * (skillBonuses.clusterDamage || 0);
  if (clusterEvMult !== 1) {
    ordnanceShieldBreak *= clusterEvMult;
    ordnanceArmorBreak *= clusterEvMult;
    ordnanceFlatDamage *= clusterEvMult;
  }
  shieldBreak += ordnanceShieldBreak;
  armorBreak += ordnanceArmorBreak;

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

  // Saturation Strike (Demolition action skill): the blanket adds raw
  // break damage to the totals BEFORE the scores price them — the
  // sim's own break machinery reads it, nothing is special-cased.
  if (saturation && ((saturation.shieldBreakBonus ?? 0) > 0 || (saturation.armorBreakBonus ?? 0) > 0)) {
    shieldBreak += Math.max(0, saturation.shieldBreakBonus ?? 0);
    armorBreak += Math.max(0, saturation.armorBreakBonus ?? 0);
    reasons.push(
      `Saturation Strike: the ordnance blanket adds ${Math.round(saturation.shieldBreakBonus ?? 0)} shield break and ${Math.round(saturation.armorBreakBonus ?? 0)} armor break.`,
    );
  }

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

  // Skill status chance (Procedural Loads) rides the chain's status
  // step for every slot — the chain owns status→DPS conversion.
  const skillStatusChance = skillBonuses.statusChance || 0;

  // Weakspot Analysis (Gunslinger major, Phase 2d): crit damage is
  // higher while the boss is below 50% HP. Under steady DPS the boss
  // spends half the fight in that phase, so the per-slot multiplier
  // is the phase average: 1 + ½ × bonus × (crit share of the slot).
  const sub50CritMult = (weapon: Weapon | null): number => {
    const bonus = skillBonuses.critDamageSub50 || 0;
    if (!weapon || bonus <= 0) return 1;
    return 1 + 0.5 * bonus * critShareOf(weapon);
  };

  let primaryDPS = 0;
  if (primary) {
    const ammoEff = ammoEfficiencyFromWindows(primaryAmmo.fullDuration, primaryAmmo.reloadDuration, 30);
    // The chain now handles signature + ammo efficiency + DPS-relevant
    // consumables internally. We pass the full `consumables` table
    // (Record<string, number>) and the chain looks up only the keys
    // in DPS_CONSUMABLE_EFFECTS.
    const chainDps = computeWeaponDps({
      weapon: primary,
      bossWeaknesses: effectiveWeaknesses,
      bossResistances: effectiveResistances,
      consumables,
      consumableQuality: input.consumableQuality,
      legendaryDamageMult: legendary.damageMult,
      ammoEfficiency: ammoEff,
      bossDamageMod: primary.bossDamageMod,
      bonusStatusChance: skillStatusChance,
    });
    primaryDPS = chainDps * sub50CritMult(primary);
  }

  let secondaryDPS = 0;
  if (secondary) {
    const secContrib = getHotSwapperSecondaryMult(primary); // 0.6 with Hot Swapper, 0.3 normally
    // Secondary doesn't have an ammo window in the sim (secondary
    // weapons don't consume ammo packs). ammoEfficiency stays at the
    // default 1.0 in the chain.
    const chainDps = computeWeaponDps({
      weapon: secondary,
      bossWeaknesses: effectiveWeaknesses,
      bossResistances: effectiveResistances,
      consumables,
      consumableQuality: input.consumableQuality,
      legendaryDamageMult: 1, // secondary doesn't get the primary's legendary bonus
      bossDamageMod: secondary.bossDamageMod,
      bonusStatusChance: skillStatusChance,
    });
    secondaryDPS = chainDps * secContrib * sub50CritMult(secondary);
  }

  let heavyDPS = 0;
  if (heavy) {
    // Heavy has a per-slot "0.5" contribution that lives in the sim
    // (not the chain) because it's a loadout-decision concern, not a
    // per-weapon property. The chain still gets boss context so the
    // element matchup applies.
    const chainDps = computeWeaponDps({
      weapon: heavy,
      bossWeaknesses: effectiveWeaknesses,
      bossResistances: effectiveResistances,
      consumables,
      consumableQuality: input.consumableQuality,
      legendaryDamageMult: 1,
      bossDamageMod: heavy.bossDamageMod,
      bonusStatusChance: skillStatusChance,
    });
    heavyDPS = chainDps * 0.5 * (1 + (skillBonuses.heavyDamageBonus || 0));
    // Heavy Weapon Burst small nodes (Phase 2d): the heavy slot's own
    // burst bonus, previously read by no engine.
    heavyDPS *= 1 + (skillBonuses.heavyWeaponBurst || 0);
    // Scorched Earth (Demolition major, Phase 2d): a Launcher in the
    // heavy slot also gains boss DPS.
    if (heavy.weaponType === WeaponType.Launcher) {
      heavyDPS *= 1 + (skillBonuses.launcherBossDps || 0);
    }
    // Unstable Power (Demolition keystone, Phase 2d): once the boss's
    // armor is broken (armor break check passed), the heavy burst
    // hits harder for the rest of the fight.
    if (armorBreakScore >= 1) {
      heavyDPS *= 1 + (skillBonuses.brokenArmorHeavyBonus || 0);
    }
    heavyDPS *= sub50CritMult(heavy);
  }

  let dps = primaryDPS + secondaryDPS + heavyDPS;

  // Player-level modifiers (not per-weapon) stay in the sim.
  // The chain's per-weapon DPS already includes signature, ammo
  // efficiency, and DPS-relevant consumables.
  //
  // Conditional Gunslinger major/keystone bonuses (Phase 2d) join the
  // boss-damage bracket only when their condition holds — the same
  // conditions the mechanics snapshot now displays:
  // - Focus Fire: the primary weapon is a Sniper or Pistol.
  // - Elemental Overclock: any equipped weapon matches a boss weakness.
  // - Death by a Thousand Cuts (second clause): the build's crit
  //   chance (primary weapon + skill crit) exceeds 50%.
  const focusFireBonus =
    primary && (primary.weaponType === WeaponType.Sniper || primary.weaponType === WeaponType.Pistol)
      ? (skillBonuses.bossDamageSniperPistol || 0)
      : 0;
  const weaknessMatchBonus =
    [primary, secondary, heavy].some((weapon) => weapon && effectiveWeaknesses.includes(weapon.element))
      ? (skillBonuses.weaknessMatchDamage || 0)
      : 0;
  const effectiveCritChance = (primary?.critChance || 0) + (skillBonuses.critChance || 0);
  const highCritBonus = effectiveCritChance > 0.5 ? (skillBonuses.highCritBossDamage || 0) : 0;
  dps *= rm.dpsMult * (1 + (skillBonuses.dps || 0)) * (1 + (skillBonuses.bossDamageMod || 0) + relicBossDmgMod + classModBossDmgMod + focusFireBonus + weaknessMatchBonus + highCritBonus) * classModDpsMult;

  // Amp behavior: fight-averaged DPS multiplier from the shield model.
  if (bossShieldModel) {
    dps *= bossShieldModel.ampDpsMultiplier;
  }

  // Nova behavior: bursts are flat damage to the boss, like ordnance.
  // A fired action skill's burst (Deadeye Salvo / Saturation Strike)
  // is flat damage through the same term — it shortens the kill clock
  // exactly like ordnance flat damage does.
  const actionSkillFlatDamage = Math.max(0, saturation?.flatDamage ?? 0);
  if (saturation && actionSkillFlatDamage > 0) {
    reasons.push(
      saturation.tree === 'Demolition'
        ? `Saturation Strike: the opening blanket burns ${Math.round(actionSkillFlatDamage)} health outright.`
        : `Deadeye Salvo: the burst burns ${Math.round(actionSkillFlatDamage)} health outright.`,
    );
  }
  const netBossHp = Math.max(1, boss.health - ordnanceFlatDamage - (bossShieldModel?.novaDamage ?? 0) - actionSkillFlatDamage);

  // Speedloader (Gunslinger major, Phase 2d): attack speed is boosted
  // for the first 10 seconds of the fight. The boost's fight-average
  // weight is the share of the kill time inside that window, priced
  // off the un-boosted time to kill.
  const openingAttackSpeed = skillBonuses.openingAttackSpeed || 0;
  let timeToKill = netBossHp / (dps || 1);
  if (openingAttackSpeed > 0 && dps > 0) {
    const openingShare = Math.min(10, timeToKill) / timeToKill;
    dps *= 1 + openingAttackSpeed * openingShare;
    timeToKill = netBossHp / (dps || 1);
    reasons.push(
      `Speedloader: +${Math.round(openingAttackSpeed * 100)}% attack speed for the first 10 seconds (about ${Math.round(openingShare * 100)}% of this fight).`,
    );
  }

  let dpsScore = 30 / timeToKill;

  // Death by a Thousand Cuts (Gunslinger keystone, Phase 2d): crits
  // count extra toward the DPS CHECK SCORE — the crit-attributable
  // share of DPS scores an additional critDpsBonus. This moves the
  // score (and so the win chance) only; effectiveDPS and timeToKill
  // above stay the physical values.
  const critDpsBonus = skillBonuses.critDpsBonus || 0;
  if (critDpsBonus > 0) {
    const totalSlotDps = primaryDPS + secondaryDPS + heavyDPS;
    if (totalSlotDps > 0) {
      const critShare =
        (primaryDPS * critShareOf(primary) +
          secondaryDPS * critShareOf(secondary) +
          heavyDPS * critShareOf(heavy)) /
        totalSlotDps;
      if (critShare > 0) {
        dpsScore *= 1 + critDpsBonus * critShare;
        reasons.push(
          `Death by a Thousand Cuts: critical hits (${Math.round(critShare * 100)}% of your DPS) count +${Math.round(critDpsBonus * 100)}% toward the DPS check.`,
        );
      }
    }
  }

  // Overclock Ramp (boss roster expansion): the boss's damage grows
  // with fight length, so the survival score is taxed by the ramp
  // multiplier priced off the final time-to-kill. Burst builds that
  // kill inside the grace window feel no ramp at all; sustain builds
  // pay for every extra second. Only the survival leg moves —
  // effectiveDPS / timeToKill stay the physical values.
  if (boss.mechanic.id === 'overclock_ramp' && dps > 0) {
    const rampMult = overclockRampMult(timeToKill);
    if (rampMult > 1) {
      effectiveSurvivalScore = survivalScore / rampMult;
      reasons.push(
        `${boss.mechanic.name}: at a ~${Math.round(timeToKill)}s kill, boss damage ramps to ${rampMult.toFixed(2)}× — kill speed is the counter.`,
      );
    }
  }

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
    { survivalScore: effectiveSurvivalScore, shieldBreakScore, armorBreakScore, dpsScore, mechanicScore },
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
  const baseChance = Math.min(effectiveSurvivalScore, 1) * Math.min(breakScore, 1) * Math.min(dpsScore, 1.5) * mechanicScore + pityBonus;
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
    survivalScore: effectiveSurvivalScore,
    breakScore,
    dpsScore,
    mechanicScore,
    reasons: unique(reasons),
    recommendations: unique(recommendations),
    expectedConsumableUsage: getBossConsumableUsage(consumables, winChance >= 0.5, effectiveSurvivalScore),
    deathFee,
    bonusLootChance: rules.bonusLootChance,
    extraLootRollChance: rules.extraLootRollChance,
    effectiveDPS: dps,
    timeToKill,
    actionSkill: saturation ? { tree: saturation.tree } : undefined,
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
  // Insurance Fraud (Scavenger major skill, Phase 2d): on victory,
  // each used consumable type has the recovery chance to be refunded
  // instead of charged — the skill twin of the legendary refund
  // above, wired identically in the Chef's processBossAttempt.
  const recoveryChance = win ? (input.skillBonuses.consumableRecovery || 0) : 0;
  if (recoveryChance > 0) {
    Object.keys(consumedConsumables).forEach((type) => {
      if (Math.random() < recoveryChance) {
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
    // Client-side twin only — entry fees are a Chef/route concern (the
    // authoritative path charges them in processBossAttempt).
    entryFee: 0,
    creditsGained: win ? creditsDelta : 0,
    creditsLost: win ? 0 : deathFee,
    loot: [],
    reasons: unique(resultReasons),
    recommendations: sim.recommendations,
  };

  return { result, creditsDelta: finalCredits, loot: [], consumedConsumables, extraLoot: bonusLootRolls > 0, bonusLootRolls };
}
