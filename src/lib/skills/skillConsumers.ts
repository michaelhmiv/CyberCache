/**
 * skillConsumers — the consumer registry for skill effect keys
 * (Phase 2d).
 *
 * Every effect key a major or keystone node advertises must have a
 * real consumer: an engine that reads the bonus (through the one
 * computeSkillBonuses derivation) and changes outcomes with it.
 * This registry is that claim, in assertable form — the structural
 * test in src/test/keystoneSkillLayer.test.ts collects every
 * major/keystone effect key from SKILL_NODES and fails if one lacks
 * an entry here, or if an entry's needle string no longer appears
 * in its consumer file (the wiring was removed or renamed).
 *
 * A key with no honest consumer must NOT be registered with a fake
 * one: replace the node's effect instead (see the Phase 2d
 * dispositions: autoSalvageBonus / autoSalvageConsumableChance /
 * postBossDropChance / postBossSessions were replaced, not wired).
 */
export interface SkillEffectConsumer {
  /** The engine surface that reads the bonus. */
  engine: string;
  /** Repo-relative file that must contain `needle`. */
  file: string;
  /** Literal string whose presence in `file` evidences the wiring. */
  needle: string;
}

const BOSS_SIM = 'src/lib/simulation/bossSimulator.ts';
const CHEF = 'src/server/chef.ts';
const SALVAGE = 'src/lib/skills/salvageBonuses.ts';
const SALVAGE_SQL = 'db/migrations/0022_salvage_skill_bonuses.sql';

export const SKILL_EFFECT_CONSUMERS: Record<string, SkillEffectConsumer[]> = {
  // ---- Gunslinger majors / keystone — boss simulator ----
  bossDamageSniperPistol: [
    { engine: 'boss sim DPS (Focus Fire: Sniper/Pistol primary)', file: BOSS_SIM, needle: 'bossDamageSniperPistol' },
  ],
  openingAttackSpeed: [
    { engine: 'boss sim DPS (Speedloader opening window)', file: BOSS_SIM, needle: 'openingAttackSpeed' },
  ],
  critDamageSub50: [
    { engine: 'boss sim DPS (Weakspot Analysis sub-50% phase)', file: BOSS_SIM, needle: 'critDamageSub50' },
  ],
  weaknessMatchDamage: [
    { engine: 'boss sim DPS (Elemental Overclock weakness match)', file: BOSS_SIM, needle: 'weaknessMatchDamage' },
  ],
  critDpsBonus: [
    { engine: 'boss sim DPS check score (Death by a Thousand Cuts)', file: BOSS_SIM, needle: 'critDpsBonus' },
  ],
  highCritBossDamage: [
    { engine: 'boss sim DPS (Death by a Thousand Cuts, >50% crit clause)', file: BOSS_SIM, needle: 'highCritBossDamage' },
  ],

  // ---- Demolition majors / keystone — boss simulator ----
  shieldStripBonus: [
    { engine: 'boss sim shield break (Breaching Charge ordnance strip)', file: BOSS_SIM, needle: 'shieldStripBonus' },
  ],
  staggerDuration: [
    { engine: 'boss sim survival (Concussive Payload stagger uptime)', file: BOSS_SIM, needle: 'staggerDuration' },
  ],
  staggerMitigation: [
    { engine: 'boss sim survival (Concussive Payload damage cut)', file: BOSS_SIM, needle: 'staggerMitigation' },
  ],
  launcherArmorBreak: [
    { engine: 'boss sim armor break (Scorched Earth Launcher heavy)', file: BOSS_SIM, needle: 'launcherArmorBreak' },
  ],
  launcherBossDps: [
    { engine: 'boss sim DPS (Scorched Earth Launcher heavy)', file: BOSS_SIM, needle: 'launcherBossDps' },
  ],
  clusterChance: [
    { engine: 'boss sim ordnance (Cluster Bombs re-trigger EV)', file: BOSS_SIM, needle: 'clusterChance' },
  ],
  clusterDamage: [
    { engine: 'boss sim ordnance (Cluster Bombs re-trigger EV)', file: BOSS_SIM, needle: 'clusterDamage' },
  ],
  explosiveArmorBreak: [
    { engine: 'computeSkillBonuses armorBreak composite', file: 'src/lib/skills/skillBonuses.ts', needle: 'explosiveArmorBreak' },
    { engine: 'boss sim armor break (via the armorBreak composite)', file: BOSS_SIM, needle: 'skillBonuses.armorBreak' },
  ],
  brokenArmorHeavyBonus: [
    { engine: 'boss sim DPS (Unstable Power: heavy burst vs broken armor)', file: BOSS_SIM, needle: 'brokenArmorHeavyBonus' },
  ],

  // ---- Scavenger majors / keystone ----
  salvageBonus: [
    { engine: 'salvage award (Hoarder\'s Instinct)', file: SALVAGE, needle: 'salvageBonus' },
    { engine: 'salvage award in cc_recycle_item', file: SALVAGE_SQL, needle: 'salvage_bonus' },
  ],
  consumableRecovery: [
    { engine: 'Chef boss attempt refunds (Insurance Fraud)', file: CHEF, needle: 'consumableRecovery' },
    { engine: 'boss sim twin refunds (Insurance Fraud)', file: BOSS_SIM, needle: 'consumableRecovery' },
  ],
  foundItemFeeReduction: [
    { engine: 'market sale fee (Market Manipulator)', file: 'src/lib/market/marketFee.ts', needle: 'foundItemFeeReduction' },
  ],
  rareDropChance: [
    { engine: 'Chef roaming claim gear threshold (also the small-node key; Lucky Find rides it)', file: CHEF, needle: 'skillBonuses.rareDropChance' },
  ],
  lowRarityScrapBonus: [
    { engine: 'salvage award (King of Scrap low-rarity multiplier)', file: SALVAGE, needle: 'lowRarityScrapBonus' },
    { engine: 'salvage award in cc_recycle_item', file: SALVAGE_SQL, needle: 'low_rarity_bonus' },
  ],
  commonMaterialChance: [
    { engine: 'salvage bonus material (King of Scrap)', file: SALVAGE, needle: 'commonMaterialChance' },
    { engine: 'salvage bonus material in cc_recycle_item', file: SALVAGE_SQL, needle: 'material_chance' },
  ],
  offlineCapBonus: [
    { engine: 'offline settlement cap (King of Scrap)', file: 'src/server/routes/settleOffline.ts', needle: 'offlineCapBonus' },
  ],
};
