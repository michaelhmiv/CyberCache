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

  // ---- Small-node consumer wired by the crafting slice (§2.7, F7) ----
  // Registered although the node is small: this key spent years with
  // two client-side display hacks pretending to consume it while the
  // number changed nothing. The real consumer is the server craft
  // engine — unit duration x(1 - min(0.20, 0.02 x points)),
  // snapshotted at enqueue in BOTH store implementations.
  consumableEfficiency: [
    { engine: 'craft job duration snapshot (TS settler/enqueue)', file: 'src/server/writes/craftEngine.ts', needle: 'consumableEfficiencyDurationMultiplier' },
    { engine: 'craft job duration snapshot (SQL twin, trusted server parameter)', file: 'db/migrations/0024_crafting_occupation.sql', needle: 'p_efficiency_bonus' },
  ],

  // ---- Small-node consumer wired by the Extraction slice (0033) ----
  // lootQuantity (Scavenger small) already fed the Chef's roaming
  // material finds; extraction is its second call site — the pass
  // roller reads the same resolved total through the content owner,
  // rolled per find on its own stream, gated on > 0 exactly like the
  // Chef gate so stream identity holds for players without the node.
  lootQuantity: [
    { engine: 'Chef roaming claim material finds', file: CHEF, needle: 'skillBonuses.lootQuantity' },
    { engine: 'extraction pass finds (per-find quantity roll)', file: 'src/content/extraction.ts', needle: 'lootQuantityBonus' },
  ],

  // ---- Small-node consumer wired by the Cache Rank slice (0031) ----
  // cacheQuality (Encrypted Payloads, Scavenger small) waited for a
  // cache-lane consumer since the keystone slice (#216). The cache
  // draw now reads it: total quality = this skill effect (skill
  // spends x node definitions; class-mod boosts do not feed the
  // draw) + the Cache Rank Cache Optimizer track, shifting the
  // cache_primary_rarity draw weights above the table's lowest tier.
  cacheQuality: [
    { engine: 'cache draw weight shift (TS write mirror of cc_make_item)', file: 'src/server/writes/memory.ts', needle: 'cacheQualityAdjustedWeights' },
    { engine: 'cache draw weight shift in cc_make_item (0031 restatement)', file: 'db/migrations/0031_cache_rank.sql', needle: 'cache_quality' },
    { engine: 'resolved-bonus derivation (the Cache Rank track of the same total)', file: 'src/content/cacheRank.ts', needle: 'cacheQuality' },
  ],

  // ---- Fixer majors / keystone (migration 0029) ----
  // Every Fixer term derives server-side from the actor's own
  // records (profiles.skill_spends + equipped class mod) through
  // computeSkillBonuses in TS and the cc_skill_effective_points
  // helper in SQL — never from a request body.
  craftTemperBonus: [
    { engine: 'crafted gear temper roll at completion (Master Artificer)', file: 'src/server/writes/craftEngine.ts', needle: 'craftTemperBonus' },
    { engine: 'crafted gear temper roll in cc_complete_craft_unit', file: 'db/migrations/0029_fixer_tree.sql', needle: 'craft_temper_bonus' },
  ],
  vehicleDecayReduction: [
    { engine: 'vehicle condition decay per fueled tick (Fleet Engineer)', file: 'src/lib/vehicles/vehicles.ts', needle: 'vehicleDecayReduction' },
    { engine: 'Chef roaming claim vehicle tick (online + offline parity)', file: CHEF, needle: 'vehicleDecayReduction' },
  ],
  craftedItemFeeReduction: [
    { engine: 'market sale fee, crafted gate (House Brand)', file: 'src/lib/market/marketFee.ts', needle: 'craftedItemFeeReduction' },
    { engine: 'market sale fee in cc_accept_listing (House Brand)', file: 'db/migrations/0029_fixer_tree.sql', needle: 'fix_major_3' },
  ],
  bonusRepairJobs: [
    { engine: 'self-repair concurrency cap at enqueue (Second Shift)', file: 'src/server/writes/craftEngine.ts', needle: 'bonusRepairJobs' },
    { engine: 'self-repair concurrency cap in cc_enqueue_repair_job', file: 'db/migrations/0029_fixer_tree.sql', needle: 'fix_major_4' },
  ],
  coreCatalystDrawBonus: [
    { engine: 'core-catalyst gear generation draws (The Fixer, snapshotted at enqueue)', file: 'src/server/writes/craftEngine.ts', needle: 'coreCatalystDrawBonus' },
    { engine: 'core-catalyst draws in cc_complete_craft_unit', file: 'db/migrations/0029_fixer_tree.sql', needle: 'coreCatalystDrawBonus' },
  ],
  workshopQueueBonus: [
    { engine: 'bench queue depth at enqueue (The Fixer)', file: 'src/server/writes/craftEngine.ts', needle: 'workshopQueueBonus' },
    { engine: 'bench queue depth in cc_enqueue_craft_job', file: 'db/migrations/0029_fixer_tree.sql', needle: 'workshop_queue_bonus' },
  ],
  rushReductionCapBonus: [
    { engine: 'rush ticket reduction cap at enqueue (The Fixer)', file: 'src/server/writes/craftEngine.ts', needle: 'rushReductionCapBonus' },
    { engine: 'rush ticket reduction cap in cc_enqueue_craft_job', file: 'db/migrations/0029_fixer_tree.sql', needle: 'rush_cap_bonus' },
  ],

  // ---- Fixer small nodes (registered voluntarily, same law) ----
  craftSpeedBonus: [
    { engine: 'craft job duration snapshot, second multiplier (Assembly Rhythm / Parallel Hands)', file: 'src/server/writes/craftEngine.ts', needle: 'craftSpeedBonus' },
    { engine: 'craft job duration snapshot in cc_enqueue_craft_job', file: 'db/migrations/0029_fixer_tree.sql', needle: 'craft_speed_bonus' },
  ],
  craftQualityBonus: [
    { engine: 'crafted quality shift at completion (Calibrated Eye / Tolerance Stacking)', file: 'src/server/writes/craftEngine.ts', needle: 'craftQualityBonus' },
    { engine: 'crafted quality shift in cc_complete_craft_unit', file: 'db/migrations/0029_fixer_tree.sql', needle: 'craft_quality_bonus' },
  ],
  repairSpeedBonus: [
    { engine: 'self-repair unit duration snapshot (Torque Discipline / Bay Choreography)', file: 'src/server/writes/craftEngine.ts', needle: 'repairSpeedBonus' },
    { engine: 'board accept work-rate snapshot (mechanic)', file: 'src/server/writes/memory.ts', needle: 'repairSpeedBonus' },
    { engine: 'repair speed in cc_enqueue_repair_job / cc_accept_repair_job', file: 'db/migrations/0029_fixer_tree.sql', needle: 'repair_speed_bonus' },
  ],
  repairEfficiencyBonus: [
    { engine: 'per-kit restoration composition (Kit Stretching / Salvage Solder)', file: 'src/content/repair.ts', needle: 'repairEfficiencyWithSkill' },
    { engine: 'repair efficiency in cc_enqueue_repair_job / cc_accept_repair_job', file: 'db/migrations/0029_fixer_tree.sql', needle: 'repair_efficiency_bonus' },
  ],
  vehicleYieldBonus: [
    { engine: 'vehicle yield bracket (Rig Tuning / Aero Fairings)', file: 'src/lib/vehicles/vehicles.ts', needle: 'vehicleYieldBonus' },
    { engine: 'Chef roaming claim vehicle tick', file: CHEF, needle: 'vehicleYieldBonus' },
  ],
  vehicleFuelBonus: [
    { engine: 'vehicle fuel burn per tick (Lean Burn)', file: 'src/lib/vehicles/vehicles.ts', needle: 'vehicleFuelBonus' },
    { engine: 'Chef roaming claim vehicle tick', file: CHEF, needle: 'vehicleFuelBonus' },
  ],
  vendorBuybackBonus: [
    { engine: 'vendor buyback rate (Appraiser\'s Eye)', file: 'src/server/writes/memory.ts', needle: 'vendorBuybackBonus' },
    { engine: 'vendor buyback rate in cc_vendor_sell', file: 'db/migrations/0029_fixer_tree.sql', needle: 'vendor_buyback_bonus' },
  ],
};

/**
 * The Cache Rank bonus registry (Cache Rank slice, 0031) — the same
 * discipline as SKILL_EFFECT_CONSUMERS, applied to the seven Cache
 * Rank tracks (content owner: src/content/cacheRank.ts). Every
 * track must name the real engines that read its resolved fraction,
 * TS and SQL twins alike; the Cache Rank structural test fails if a
 * track lacks an entry, if an entry's needle no longer appears in
 * its file, or if the registry's keys drift from
 * CACHE_RANK_BONUS_IDS. A bonus that stops being read anywhere is a
 * dead bonus, and this registry is where that gets caught.
 */
export const CACHE_RANK_BONUS_CONSUMERS: Record<string, SkillEffectConsumer[]> = {
  credits: [
    { engine: 'Chef roaming claim credit rate (multiplies last)', file: CHEF, needle: 'cacheRank?.credits' },
    { engine: 'Chef boss attempt victory credits', file: CHEF, needle: 'cacheRankBonuses?.credits' },
    { engine: 'Chef endless encounter escrow credits', file: CHEF, needle: 'endlessCacheRank?.credits' },
  ],
  xp: [
    { engine: 'Chef roaming claim XP rate (multiplies last)', file: CHEF, needle: 'cacheRank?.xp' },
    { engine: 'Chef boss attempt victory XP', file: CHEF, needle: 'cacheRankBonuses?.xp' },
    { engine: 'Chef endless encounter escrow XP', file: CHEF, needle: 'endlessCacheRank?.xp' },
    { engine: 'craft unit XP at completion (TS settler)', file: 'src/server/writes/craftEngine.ts', needle: 'cacheRankXpBonus' },
    { engine: 'craft unit XP in cc_complete_craft_unit', file: 'db/migrations/0031_cache_rank.sql', needle: "cc_cache_rank_bonus_fraction(p.cache_rank_spends, 'xp')" },
    { engine: 'board repair XP at finalize (TS mirror)', file: 'src/server/writes/memory.ts', needle: 'cacheRankBonusesFor(provider).xp' },
    { engine: 'board repair XP in cc_repair_finalize_job', file: 'db/migrations/0031_cache_rank.sql', needle: "cc_cache_rank_bonus_fraction(provider.cache_rank_spends, 'xp')" },
  ],
  scrap: [
    { engine: 'Chef roaming claim scrap rate (multiplies last)', file: CHEF, needle: 'cacheRank?.scrap' },
    { engine: 'Chef boss attempt Second Opinion scrap', file: CHEF, needle: 'cacheRankBonuses?.scrap' },
    { engine: 'Chef endless encounter escrow scrap', file: CHEF, needle: 'endlessCacheRank?.scrap' },
  ],
  damage: [
    { engine: 'Chef roaming claim derived DPS', file: CHEF, needle: 'cacheRank?.damage' },
    { engine: 'boss sim DPS (merged skillBonuses key)', file: BOSS_SIM, needle: 'cacheRankDamageBonus' },
    { engine: 'mechanics snapshot simulated boss DPS', file: 'src/lib/mechanics/buildCharacterMechanicsSnapshot.ts', needle: 'cacheRankDamageBonus' },
  ],
  maxHp: [
    { engine: 'boss sim survival HP (merged skillBonuses key)', file: BOSS_SIM, needle: 'cacheRankMaxHpBonus' },
    { engine: 'mechanics snapshot max HP (base HP part only)', file: 'src/lib/mechanics/buildCharacterMechanicsSnapshot.ts', needle: 'cacheRankMaxHpBonus' },
  ],
  cacheQuality: [
    { engine: 'cache draw weight shift (TS write mirror of cc_make_item)', file: 'src/server/writes/memory.ts', needle: 'cacheQualityAdjustedWeights' },
    { engine: 'cache draw weight shift in cc_make_item (0031 restatement)', file: 'db/migrations/0031_cache_rank.sql', needle: 'cache_quality' },
  ],
  marketProceeds: [
    { engine: 'market fee breakdown, post-fee uplift (TS)', file: 'src/lib/market/marketFee.ts', needle: 'proceedsBonus' },
    { engine: 'market completion uplift in cc_accept_listing', file: 'db/migrations/0031_cache_rank.sql', needle: 'cache_rank_proceeds_bonus' },
    { engine: 'minted uplift folds into credits_minted_other (SQL metrics)', file: 'db/migrations/0031_cache_rank.sql', needle: 'cache_rank_proceeds_bonus' },
    { engine: 'minted uplift folds into credits_minted_other (TS metrics mirror)', file: 'src/server/economy/memory.ts', needle: 'cache_rank_proceeds_bonus' },
  ],
};

