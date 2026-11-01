/**
 * EconomyConfig — the ONE accessor for the live economy levers
 * (economy observability slice, migration 0018).
 *
 * Levers live in the economy_config table so an operator can retune
 * the economy without a redeploy (POST /api/admin/economy/config,
 * behind the job secret). Every consumer reads through this accessor:
 *
 *   - values are cached in memory for at most CACHE_TTL_MS, so a
 *     change lands within a minute on every route;
 *   - a key with no row resolves to its code default — the defaults
 *     below ARE today's shipped constants (pinned against their
 *     owners by tests: marketFee.ts MARKET_FEE_RATE, chef.ts
 *     FRAGMENT_CHANCE / BOSS_DEDICATED_DROP_CHANCE, bossFees.ts
 *     REMATCH_FEE_MAX_MULTIPLIER);
 *   - a stored value that fails validation (wrong type, out of
 *     range — only possible via direct SQL) is ignored, never
 *     applied;
 *   - a store read failure resolves to the defaults (or the last
 *     good snapshot) — config can never take the game down.
 *
 * The SQL completion path (cc_accept_listing) reads the fee rate
 * from the table itself via cc_economy_config_number; this accessor
 * serves the TypeScript consumers (Chef claim/boss routes, the
 * in-memory write mirror, the admin report).
 */

export interface EconomyConfigValues {
  /** Fraction of a completed market sale destroyed as the fee. */
  marketFeeRate: number;
  /** Probability that a boss victory's first loot roll is a dedicated drop. */
  bossDedicatedChance: number;
  /** Per-tick chance a roaming tick pays cache fragments (before mods). */
  fragmentChance: number;
  /** Cap on the boss rematch fee escalation multiplier. */
  rematchEscalationCap: number;
  /** Multiplier on the Legendary weight of area drop tables at claim time. */
  roamingLegendaryScalar: number;
  /** Fraction of an item's vendor value the NPC vendor pays on buyback. */
  vendorBuybackRate: number;
  /** Multiplier on the equipped vehicle's yield bonus (1.0 = class table as shipped). */
  vehicleYieldScalar: number;
  /** Base per-tick roaming event chance before consumable/vehicle modifiers. */
  eventChanceBase: number;
  /** Chance an elite rotating into the kill cycle escalates into the area's named elite. */
  eliteEscalationChance: number;
  /** Anti-leak budget for the event system: max added EV as a fraction of a plain tick. */
  eventValueBudgetPct: number;
  /** Material-find chance bonus in the daily hot area. */
  hotAreaMaterialBonus: number;
  /** Credits/XP yield bonus in the daily hot area. */
  hotAreaYieldBonus: number;
  /** Absolute ceiling on offline settlement hours. Range-capped at [1, 24] by design. */
  absoluteOfflineCapHours: number;
  /**
   * Crafting XP as a fraction of roaming's XP/hour (crafting-as-
   * occupation §2.3). The [0.70, 0.85] range is LAW — the occupations
   * band — so validation hard-clamps to it: an operator can tune
   * inside the band, never outside it.
   */
  craftXpRate: number;
  /** Multiplier on snapshotted craft unit durations (future jobs). */
  craftTimeScalar: number;
  /** Flat shift applied to both craft quality bounds at roll time. */
  craftQualityShift: number;
  /** Base temper chance for crafted gear frames (before mastery). */
  gearTemperBaseChance: number;
  /** Base refining yield rate before the mastery term. */
  refineBaseYield: number;
  /** Base repair work rate, condition points per hour (mechanics 0025). */
  repairWorkRateBase: number;
  /** Repair work-rate gain per services.repair mastery level. */
  repairMasterySpeedPerLevel: number;
  /** Per-kit restoration gain per services.repair mastery level. */
  repairMasteryEfficiencyPerLevel: number;
  /** Player XP paid to a mechanic per condition point restored. */
  serviceXpPerPoint: number;
  /** Hours without progress before a repair job's owner may reclaim it. */
  repairAbandonWindowHours: number;
  /** Days an unaccepted repair posting stays open before refund. */
  repairListingExpiryDays: number;
  /** Multiplier on the reforge scrap cost (reforge slice, 0027). */
  reforgeScrapScalar: number;
  /** Flat legendary-core cost of reforging a Legendary (0027). */
  reforgeLegendaryCoreCost: number;
  // Endless mode (0028) — content owner: src/content/endless.ts.
  /** Enemy health/shield/armor multiplier per depth (compounding). */
  endlessHpGrowth: number;
  /** Enemy DPS multiplier per depth (compounding). */
  endlessDpsGrowth: number;
  /** Escrow XP per encounter, per encounter level. */
  endlessXpPerLevel: number;
  /** Escrow credits per encounter, per encounter level. */
  endlessCreditsPerLevel: number;
  /** Escrow scrap per encounter, per encounter level. */
  endlessScrapPerLevel: number;
  /** Per-depth additive growth on per-encounter escrow rewards. */
  endlessRewardDepthGrowth: number;
  /** Fraction of escrow paid when an endless run ends in death/abandonment. */
  endlessDeathPayoutFraction: number;
  /** Endless entry fee base, per player level. */
  endlessEntryFeePerLevel: number;
  /** Cap on the endless entry-fee escalation multiplier. */
  endlessFeeEscalationCap: number;
  /** Milestone Legendary rarity-weight growth per depth. */
  endlessMilestoneLegendaryPerDepth: number;
  /** Milestone Epic rarity-weight growth per depth. */
  endlessMilestoneEpicPerDepth: number;
  /** Hard cap on endless depth (anti-pathology valve). */
  endlessMaxDepth: number;
  // Action skills (0030) — content owner: src/content/actionSkills.ts
  // (ACTION_SKILL_LEVER_DEFAULTS / ACTION_SKILL_LEVER_CLAMPS, pinned
  // against these literals by tests).
  /** Charge granted by a resolved boss attempt that did not fire. */
  actionSkillChargePerBossAttempt: number;
  /** Charge granted by a resolved endless encounter that did not fire. */
  actionSkillChargePerEndlessEncounter: number;
  /** Charge per craft unit completed (Fixer-selected players only). */
  actionSkillChargePerCraftUnit: number;
  /** Charge per repair condition point restored (Fixer-selected only). */
  actionSkillChargePerRepairPoint: number;
  /** Deadeye Salvo: share of the target's max health dealt as damage. */
  gunslingerBurstBossHpShare: number;
  /** Saturation Strike: share of the target's max health dealt as damage. */
  demolitionSaturationBossHpShare: number;
  /** Saturation Strike: share of shield AND armor added as break damage. */
  demolitionSaturationBreakShare: number;
  /** Saturation Strike: stagger uptime (share of the fight staggered). */
  demolitionSaturationStaggerUptime: number;
  /** Saturation Strike: boss damage cut while staggered. */
  demolitionSaturationStaggerMitigation: number;
  /** Cache Surge: extra generic drop rolls on victory (integer). */
  scavengerSurgeBonusRolls: number;
  /** Cache Surge: Legendary rarity-weight multiplier (HARD clamp [1, 3]). */
  scavengerSurgeLegendaryWeightMult: number;
  /** Cache Surge: Epic rarity-weight multiplier. */
  scavengerSurgeEpicWeightMult: number;
  /** Overclock combat fire: consumable quality multiplier (Fixer brief §3.7). */
  overclockQualityMultiplier: number;
  // Cache Rank (0031) — content owner: src/content/cacheRank.ts
  // (CACHE_RANK_LEVER_DEFAULTS / CACHE_RANK_LEVER_CLAMPS, pinned
  // against these literals by tests).
  /** Cache Rank tokens granted per level gained. */
  cacheRankTokensPerLevel: number;
  /** Cache Rank bundle at the first milestone level (L10). */
  cacheRankMilestoneBundleBase: number;
  /** Cache Rank bundle growth per milestone step. */
  cacheRankMilestoneBundleStep: number;
  /** Cache Rank cost of rank 1 on any track. */
  cacheRankCostBase: number;
  /** Cache Rank cost growth per rank pair. */
  cacheRankCostGrowth: number;
  /** +credits fraction per Cache Rank Greed rank. */
  cacheRankCreditsPerRank: number;
  /** +XP fraction per Cache Rank Fast Learner rank. */
  cacheRankXpPerRank: number;
  /** +scrap fraction per Cache Rank Salvage Hound rank. */
  cacheRankScrapPerRank: number;
  /** +damage fraction per Cache Rank Heavy Hand rank. */
  cacheRankDamagePerRank: number;
  /** +max HP fraction per Cache Rank Thick Skin rank. */
  cacheRankMaxHpPerRank: number;
  /** +cache quality per Cache Rank Cache Optimizer rank. */
  cacheRankCacheQualityPerRank: number;
  /** +market proceeds fraction per Cache Rank Silver Tongue rank. */
  cacheRankMarketProceedsPerRank: number;
  // Dispatch + courier (0032) — content owner: src/content/dispatch.ts
  // (DISPATCH_LEVER_DEFAULTS / DISPATCH_LEVER_CLAMPS, pinned against
  // these literals by tests).
  /** Concurrent dispatch missions (foot + courier, one pool). */
  dispatchQueueSlots: number;
  /** Foot credit line as a fraction of roaming idle credits. */
  dispatchCreditRate: number;
  /** Foot scrap line as a fraction of roaming idle scrap. */
  dispatchScrapRate: number;
  /** Scalar on the foot material line's unit count. */
  dispatchMaterialRate: number;
  /** Courier credit premium over the same-duration foot line. */
  courierPremiumMultiplier: number;
  /** Route ticks per courier contract hour. */
  courierRouteTicksPerHour: number;
  // Extraction (0033) — content owner: src/content/extraction.ts
  // (EXTRACTION_LEVER_DEFAULTS / EXTRACTION_LEVER_CLAMPS, pinned
  // against these literals by tests).
  /**
   * Extraction XP as a fraction of roaming's XP/hour. The [0.70,
   * 0.85] range is LAW — the occupations band (DECISIONS R2) — so
   * validation hard-clamps to it, exactly like craftXpRate.
   */
  extractXpRate: number;
  /** Material/essence draws per hour at gear factor 1 (Surface). */
  extractFindsPerHour: number;
  /** Signature substitution chance for home-area material draws. */
  extractSignatureChance: number;
  /** Deep Delve draw multiplier. */
  extractDeepYieldMult: number;
  /** Floor on the settlement-time gear factor. */
  extractGearFactorFloor: number;
  /** Yield bonus per gathering.extraction mastery level past 1. */
  extractMasteryYieldPerLevel: number;
  // Login streak (0036) — content owner: src/content/loginStreak.ts
  // (LOGIN_STREAK_LEVER_DEFAULTS / LOGIN_STREAK_LEVER_CLAMPS, pinned
  // against these literals by tests; SQL reads them via
  // cc_economy_config_number with identical clamps).
  /** Scalar on every login-streak ladder credit amount. */
  streakCreditScalar: number;
  /** Scalar on every login-streak ladder fragment amount. */
  streakFragmentScalar: number;
  // Cache box lane (0037) — content owner: src/content/cacheLane.ts
  // (CACHE_LANE_LEVER_DEFAULTS / CACHE_LANE_LEVER_CLAMPS, pinned
  // against these literals by tests; cc_make_item reads it via
  // cc_economy_config_number with the identical clamp).
  /** Total cache boxes openable per UTC day, free box included. */
  cacheBoxDailyCap: number;
  // Contracts board (0042) — content owner: src/content/contracts.ts
  // (CONTRACT_LEVER_DEFAULTS / CONTRACT_LEVER_CLAMPS, pinned against
  // these literals by tests; cc_issue_contracts / cc_claim_contract_reward
  // / cc_reroll_contract read them via cc_economy_config_number with
  // identical clamps).
  /** Scalar on every contract credit/fragment reward, priced at issuance. */
  contractRewardScalar: number;
  /** Scalar on every contract target, priced at issuance. */
  contractTargetScalar: number;
  /** Contracts on the daily board. */
  contractDailyCount: number;
  /** Contracts on the weekly board. */
  contractWeeklyCount: number;
  /** Scrap destroyed by a non-free daily reroll. */
  contractRerollScrapDaily: number;
  /** Scrap destroyed by a non-free weekly reroll. */
  contractRerollScrapWeekly: number;
  /** Cache keys in the weekly full-set bonus. */
  contractWeeklyKeys: number;
  // Research (0038) — content owner: src/content/research.ts
  // (RESEARCH_LEVER_DEFAULTS / RESEARCH_LEVER_CLAMPS, pinned
  // against these literals by tests; SQL reads them via
  // cc_economy_config_number with identical clamps).
  /** Multiplies catalog course durations at enroll (snapshotted). */
  researchDurationScalar: number;
  /** Multiplies catalog course costs at enroll (snapshotted). */
  researchCostScalar: number;
}

export type EconomyConfigKey = keyof EconomyConfigValues;

/** Code defaults = the shipped constants at the time of this slice. */
export const ECONOMY_CONFIG_DEFAULTS: EconomyConfigValues = {
  marketFeeRate: 0.05,
  bossDedicatedChance: 0.1,
  fragmentChance: 0.008,
  rematchEscalationCap: 8,
  roamingLegendaryScalar: 1.0,
  vendorBuybackRate: 0.4,
  vehicleYieldScalar: 1.0,
  eventChanceBase: 0.05,
  eliteEscalationChance: 0.12,
  eventValueBudgetPct: 0.08,
  hotAreaMaterialBonus: 0.2,
  hotAreaYieldBonus: 0.1,
  absoluteOfflineCapHours: 24,
  craftXpRate: 0.775,
  craftTimeScalar: 1.0,
  craftQualityShift: 0,
  gearTemperBaseChance: 0.05,
  refineBaseYield: 0.8,
  repairWorkRateBase: 20,
  repairMasterySpeedPerLevel: 0.02,
  repairMasteryEfficiencyPerLevel: 0.02,
  serviceXpPerPoint: 2,
  repairAbandonWindowHours: 48,
  repairListingExpiryDays: 7,
  reforgeScrapScalar: 1,
  reforgeLegendaryCoreCost: 2,
  endlessHpGrowth: 1.12,
  endlessDpsGrowth: 1.1,
  endlessXpPerLevel: 6,
  endlessCreditsPerLevel: 22,
  endlessScrapPerLevel: 0.5,
  endlessRewardDepthGrowth: 0.04,
  endlessDeathPayoutFraction: 0.5,
  endlessEntryFeePerLevel: 10,
  endlessFeeEscalationCap: 8,
  endlessMilestoneLegendaryPerDepth: 0.1,
  endlessMilestoneEpicPerDepth: 0.05,
  endlessMaxDepth: 250,
  actionSkillChargePerBossAttempt: 34,
  actionSkillChargePerEndlessEncounter: 20,
  actionSkillChargePerCraftUnit: 3,
  actionSkillChargePerRepairPoint: 0.2,
  gunslingerBurstBossHpShare: 0.12,
  demolitionSaturationBossHpShare: 0.07,
  demolitionSaturationBreakShare: 0.35,
  demolitionSaturationStaggerUptime: 0.5,
  demolitionSaturationStaggerMitigation: 0.3,
  scavengerSurgeBonusRolls: 2,
  scavengerSurgeLegendaryWeightMult: 2,
  scavengerSurgeEpicWeightMult: 1.5,
  overclockQualityMultiplier: 1.25,
  cacheRankTokensPerLevel: 1,
  cacheRankMilestoneBundleBase: 5,
  cacheRankMilestoneBundleStep: 5,
  cacheRankCostBase: 1,
  cacheRankCostGrowth: 1,
  cacheRankCreditsPerRank: 0.01,
  cacheRankXpPerRank: 0.01,
  cacheRankScrapPerRank: 0.01,
  cacheRankDamagePerRank: 0.005,
  cacheRankMaxHpPerRank: 0.01,
  cacheRankCacheQualityPerRank: 0.02,
  cacheRankMarketProceedsPerRank: 0.005,
  dispatchQueueSlots: 2,
  dispatchCreditRate: 0.4,
  dispatchScrapRate: 0.4,
  dispatchMaterialRate: 1,
  courierPremiumMultiplier: 1.6,
  courierRouteTicksPerHour: 120,
  extractXpRate: 0.75,
  extractFindsPerHour: 192,
  extractSignatureChance: 0.15,
  extractDeepYieldMult: 1.5,
  extractGearFactorFloor: 0.4,
  extractMasteryYieldPerLevel: 0.005,
  streakCreditScalar: 1,
  streakFragmentScalar: 1,
  cacheBoxDailyCap: 10,
  contractRewardScalar: 1,
  contractTargetScalar: 1,
  contractDailyCount: 3,
  contractWeeklyCount: 5,
  contractRerollScrapDaily: 100,
  contractRerollScrapWeekly: 400,
  contractWeeklyKeys: 1,
  researchDurationScalar: 1,
  researchCostScalar: 1,
};

export interface EconomyConfigKeySpec {
  key: EconomyConfigKey;
  min: number;
  max: number;
  integer: boolean;
  /** Where the default lives when no lever is set (documentation). */
  defaultOwner: string;
}

/** The lever registry — the admin write path rejects anything else. */
export const ECONOMY_CONFIG_KEYS: Record<EconomyConfigKey, EconomyConfigKeySpec> = {
  marketFeeRate: {
    key: 'marketFeeRate', min: 0, max: 1, integer: false,
    defaultOwner: 'src/lib/market/marketFee.ts MARKET_FEE_RATE',
  },
  bossDedicatedChance: {
    key: 'bossDedicatedChance', min: 0, max: 1, integer: false,
    defaultOwner: 'src/server/chef.ts BOSS_DEDICATED_DROP_CHANCE',
  },
  fragmentChance: {
    key: 'fragmentChance', min: 0, max: 1, integer: false,
    defaultOwner: 'src/server/chef.ts FRAGMENT_CHANCE',
  },
  rematchEscalationCap: {
    key: 'rematchEscalationCap', min: 1, max: 64, integer: true,
    defaultOwner: 'src/lib/bossFees.ts REMATCH_FEE_MAX_MULTIPLIER',
  },
  roamingLegendaryScalar: {
    key: 'roamingLegendaryScalar', min: 0, max: 5, integer: false,
    defaultOwner: 'new lever; 1.0 = the shipped area drop tables unchanged',
  },
  vendorBuybackRate: {
    key: 'vendorBuybackRate', min: 0, max: 0.9, integer: false,
    defaultOwner: 'src/lib/vendor/catalog.ts VENDOR_BUYBACK_RATE_DEFAULT',
  },
  vehicleYieldScalar: {
    key: 'vehicleYieldScalar', min: 0, max: 3, integer: false,
    defaultOwner: 'src/lib/vehicles/vehicles.ts class table (1.0 = as shipped)',
  },
  eventChanceBase: {
    key: 'eventChanceBase', min: 0, max: 0.15, integer: false,
    defaultOwner: 'src/content/roamingEvents.ts EVENT_CHANCE_BASE',
  },
  eliteEscalationChance: {
    key: 'eliteEscalationChance', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/roamingEvents.ts ELITE_ESCALATION_CHANCE',
  },
  eventValueBudgetPct: {
    key: 'eventValueBudgetPct', min: 0, max: 0.5, integer: false,
    defaultOwner: 'src/content/roamingEvents.ts EVENT_VALUE_BUDGET_PCT',
  },
  hotAreaMaterialBonus: {
    key: 'hotAreaMaterialBonus', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/hotArea.ts HOT_AREA_MATERIAL_BONUS',
  },
  hotAreaYieldBonus: {
    key: 'hotAreaYieldBonus', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/hotArea.ts HOT_AREA_YIELD_BONUS',
  },
  absoluteOfflineCapHours: {
    key: 'absoluteOfflineCapHours', min: 1, max: 24, integer: true,
    defaultOwner: 'src/content/offlineCap.ts ABSOLUTE_OFFLINE_CAP_HOURS (24 is the hard ceiling — the lever range itself is capped there)',
  },
  craftXpRate: {
    key: 'craftXpRate', min: 0.7, max: 0.85, integer: false,
    defaultOwner: 'src/content/crafting.ts CRAFT_XP_RATE_DEFAULT (the [0.70, 0.85] band is the occupations law — validation clamps to it)',
  },
  craftTimeScalar: {
    key: 'craftTimeScalar', min: 0.5, max: 2, integer: false,
    defaultOwner: 'src/content/crafting.ts CRAFT_TIME_SCALAR_DEFAULT',
  },
  craftQualityShift: {
    key: 'craftQualityShift', min: -10, max: 10, integer: false,
    defaultOwner: 'src/content/crafting.ts CRAFT_QUALITY_SHIFT_DEFAULT',
  },
  gearTemperBaseChance: {
    key: 'gearTemperBaseChance', min: 0, max: 0.3, integer: false,
    defaultOwner: 'src/content/crafting.ts GEAR_TEMPER_BASE_CHANCE_DEFAULT',
  },
  refineBaseYield: {
    key: 'refineBaseYield', min: 0.5, max: 1, integer: false,
    defaultOwner: 'src/content/crafting.ts REFINE_BASE_YIELD_DEFAULT',
  },
  repairWorkRateBase: {
    key: 'repairWorkRateBase', min: 1, max: 200, integer: false,
    defaultOwner: 'src/content/repair.ts REPAIR_WORK_RATE_BASE_DEFAULT',
  },
  repairMasterySpeedPerLevel: {
    key: 'repairMasterySpeedPerLevel', min: 0, max: 0.1, integer: false,
    defaultOwner: 'src/content/repair.ts REPAIR_MASTERY_SPEED_PER_LEVEL_DEFAULT',
  },
  repairMasteryEfficiencyPerLevel: {
    key: 'repairMasteryEfficiencyPerLevel', min: 0, max: 0.1, integer: false,
    defaultOwner: 'src/content/repair.ts REPAIR_MASTERY_EFFICIENCY_PER_LEVEL_DEFAULT',
  },
  serviceXpPerPoint: {
    key: 'serviceXpPerPoint', min: 0, max: 10, integer: true,
    defaultOwner: 'src/content/repair.ts SERVICE_XP_PER_POINT_DEFAULT',
  },
  repairAbandonWindowHours: {
    key: 'repairAbandonWindowHours', min: 1, max: 720, integer: true,
    defaultOwner: 'src/content/repair.ts REPAIR_ABANDON_WINDOW_HOURS_DEFAULT',
  },
  repairListingExpiryDays: {
    key: 'repairListingExpiryDays', min: 1, max: 30, integer: true,
    defaultOwner: 'src/content/repair.ts REPAIR_LISTING_EXPIRY_DAYS_DEFAULT',
  },
  reforgeScrapScalar: {
    key: 'reforgeScrapScalar', min: 0, max: 5, integer: false,
    defaultOwner: 'src/content/reforge.ts REFORGE_SCRAP_SCALAR_DEFAULT',
  },
  reforgeLegendaryCoreCost: {
    key: 'reforgeLegendaryCoreCost', min: 0, max: 8, integer: true,
    defaultOwner: 'src/content/reforge.ts REFORGE_LEGENDARY_CORE_COST_DEFAULT',
  },
  endlessHpGrowth: {
    key: 'endlessHpGrowth', min: 1, max: 1.5, integer: false,
    defaultOwner: 'src/content/endless.ts ENDLESS_HP_GROWTH_DEFAULT',
  },
  endlessDpsGrowth: {
    key: 'endlessDpsGrowth', min: 1, max: 1.5, integer: false,
    defaultOwner: 'src/content/endless.ts ENDLESS_DPS_GROWTH_DEFAULT',
  },
  endlessXpPerLevel: {
    key: 'endlessXpPerLevel', min: 0, max: 50, integer: false,
    defaultOwner: 'src/content/endless.ts ENDLESS_XP_PER_LEVEL_DEFAULT',
  },
  endlessCreditsPerLevel: {
    key: 'endlessCreditsPerLevel', min: 0, max: 200, integer: false,
    defaultOwner: 'src/content/endless.ts ENDLESS_CREDITS_PER_LEVEL_DEFAULT',
  },
  endlessScrapPerLevel: {
    key: 'endlessScrapPerLevel', min: 0, max: 10, integer: false,
    defaultOwner: 'src/content/endless.ts ENDLESS_SCRAP_PER_LEVEL_DEFAULT',
  },
  endlessRewardDepthGrowth: {
    key: 'endlessRewardDepthGrowth', min: 0, max: 0.25, integer: false,
    defaultOwner: 'src/content/endless.ts ENDLESS_REWARD_DEPTH_GROWTH_DEFAULT',
  },
  endlessDeathPayoutFraction: {
    key: 'endlessDeathPayoutFraction', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/endless.ts ENDLESS_DEATH_PAYOUT_FRACTION_DEFAULT',
  },
  endlessEntryFeePerLevel: {
    key: 'endlessEntryFeePerLevel', min: 0, max: 100, integer: false,
    defaultOwner: 'src/content/endless.ts ENDLESS_ENTRY_FEE_PER_LEVEL_DEFAULT',
  },
  endlessFeeEscalationCap: {
    key: 'endlessFeeEscalationCap', min: 1, max: 64, integer: true,
    defaultOwner: 'src/content/endless.ts ENDLESS_FEE_ESCALATION_CAP_DEFAULT',
  },
  endlessMilestoneLegendaryPerDepth: {
    key: 'endlessMilestoneLegendaryPerDepth', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/endless.ts ENDLESS_MILESTONE_LEGENDARY_PER_DEPTH_DEFAULT',
  },
  endlessMilestoneEpicPerDepth: {
    key: 'endlessMilestoneEpicPerDepth', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/endless.ts ENDLESS_MILESTONE_EPIC_PER_DEPTH_DEFAULT',
  },
  endlessMaxDepth: {
    key: 'endlessMaxDepth', min: 10, max: 1000, integer: true,
    defaultOwner: 'src/content/endless.ts ENDLESS_MAX_DEPTH_DEFAULT',
  },
  actionSkillChargePerBossAttempt: {
    key: 'actionSkillChargePerBossAttempt', min: 0, max: 100, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  actionSkillChargePerEndlessEncounter: {
    key: 'actionSkillChargePerEndlessEncounter', min: 0, max: 100, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  actionSkillChargePerCraftUnit: {
    key: 'actionSkillChargePerCraftUnit', min: 0, max: 25, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  actionSkillChargePerRepairPoint: {
    key: 'actionSkillChargePerRepairPoint', min: 0, max: 2, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  gunslingerBurstBossHpShare: {
    key: 'gunslingerBurstBossHpShare', min: 0, max: 0.35, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  demolitionSaturationBossHpShare: {
    key: 'demolitionSaturationBossHpShare', min: 0, max: 0.25, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  demolitionSaturationBreakShare: {
    key: 'demolitionSaturationBreakShare', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  demolitionSaturationStaggerUptime: {
    key: 'demolitionSaturationStaggerUptime', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  demolitionSaturationStaggerMitigation: {
    key: 'demolitionSaturationStaggerMitigation', min: 0, max: 0.6, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  scavengerSurgeBonusRolls: {
    key: 'scavengerSurgeBonusRolls', min: 0, max: 5, integer: true,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  scavengerSurgeLegendaryWeightMult: {
    key: 'scavengerSurgeLegendaryWeightMult', min: 1, max: 3, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  scavengerSurgeEpicWeightMult: {
    key: 'scavengerSurgeEpicWeightMult', min: 1, max: 3, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  overclockQualityMultiplier: {
    key: 'overclockQualityMultiplier', min: 1.0, max: 1.5, integer: false,
    defaultOwner: 'src/content/actionSkills.ts ACTION_SKILL_LEVER_DEFAULTS',
  },
  cacheRankTokensPerLevel: {
    key: 'cacheRankTokensPerLevel', min: 0, max: 3, integer: true,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  cacheRankMilestoneBundleBase: {
    key: 'cacheRankMilestoneBundleBase', min: 0, max: 25, integer: true,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  cacheRankMilestoneBundleStep: {
    key: 'cacheRankMilestoneBundleStep', min: 0, max: 25, integer: true,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  cacheRankCostBase: {
    key: 'cacheRankCostBase', min: 1, max: 10, integer: true,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  cacheRankCostGrowth: {
    key: 'cacheRankCostGrowth', min: 0, max: 2, integer: false,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  cacheRankCreditsPerRank: {
    key: 'cacheRankCreditsPerRank', min: 0, max: 0.02, integer: false,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  cacheRankXpPerRank: {
    key: 'cacheRankXpPerRank', min: 0, max: 0.02, integer: false,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  cacheRankScrapPerRank: {
    key: 'cacheRankScrapPerRank', min: 0, max: 0.02, integer: false,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  cacheRankDamagePerRank: {
    key: 'cacheRankDamagePerRank', min: 0, max: 0.01, integer: false,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  cacheRankMaxHpPerRank: {
    key: 'cacheRankMaxHpPerRank', min: 0, max: 0.02, integer: false,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  cacheRankCacheQualityPerRank: {
    key: 'cacheRankCacheQualityPerRank', min: 0, max: 0.04, integer: false,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  cacheRankMarketProceedsPerRank: {
    key: 'cacheRankMarketProceedsPerRank', min: 0, max: 0.01, integer: false,
    defaultOwner: 'src/content/cacheRank.ts CACHE_RANK_LEVER_DEFAULTS',
  },
  dispatchQueueSlots: {
    key: 'dispatchQueueSlots', min: 1, max: 8, integer: true,
    defaultOwner: 'src/content/dispatch.ts DISPATCH_LEVER_DEFAULTS',
  },
  dispatchCreditRate: {
    key: 'dispatchCreditRate', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/dispatch.ts DISPATCH_LEVER_DEFAULTS',
  },
  dispatchScrapRate: {
    key: 'dispatchScrapRate', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/dispatch.ts DISPATCH_LEVER_DEFAULTS',
  },
  dispatchMaterialRate: {
    key: 'dispatchMaterialRate', min: 0, max: 3, integer: false,
    defaultOwner: 'src/content/dispatch.ts DISPATCH_LEVER_DEFAULTS',
  },
  courierPremiumMultiplier: {
    key: 'courierPremiumMultiplier', min: 1, max: 3, integer: false,
    defaultOwner: 'src/content/dispatch.ts DISPATCH_LEVER_DEFAULTS (courier brief §2.8)',
  },
  courierRouteTicksPerHour: {
    key: 'courierRouteTicksPerHour', min: 60, max: 240, integer: true,
    defaultOwner: 'src/content/dispatch.ts DISPATCH_LEVER_DEFAULTS (courier brief §2.8)',
  },
  extractXpRate: {
    key: 'extractXpRate', min: 0.7, max: 0.85, integer: false,
    defaultOwner: 'src/content/extraction.ts EXTRACTION_LEVER_DEFAULTS (the [0.70, 0.85] band is the occupations law — validation clamps to it)',
  },
  extractFindsPerHour: {
    key: 'extractFindsPerHour', min: 48, max: 480, integer: true,
    defaultOwner: 'src/content/extraction.ts EXTRACTION_LEVER_DEFAULTS',
  },
  extractSignatureChance: {
    key: 'extractSignatureChance', min: 0, max: 0.4, integer: false,
    defaultOwner: 'src/content/extraction.ts EXTRACTION_LEVER_DEFAULTS',
  },
  extractDeepYieldMult: {
    key: 'extractDeepYieldMult', min: 1, max: 2.5, integer: false,
    defaultOwner: 'src/content/extraction.ts EXTRACTION_LEVER_DEFAULTS',
  },
  extractGearFactorFloor: {
    key: 'extractGearFactorFloor', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/extraction.ts EXTRACTION_LEVER_DEFAULTS',
  },
  extractMasteryYieldPerLevel: {
    key: 'extractMasteryYieldPerLevel', min: 0, max: 0.02, integer: false,
    defaultOwner: 'src/content/extraction.ts EXTRACTION_LEVER_DEFAULTS',
  },
  streakCreditScalar: {
    key: 'streakCreditScalar', min: 0, max: 3, integer: false,
    defaultOwner: 'src/content/loginStreak.ts LOGIN_STREAK_LEVER_DEFAULTS',
  },
  streakFragmentScalar: {
    key: 'streakFragmentScalar', min: 0, max: 3, integer: false,
    defaultOwner: 'src/content/loginStreak.ts LOGIN_STREAK_LEVER_DEFAULTS',
  },
  cacheBoxDailyCap: {
    key: 'cacheBoxDailyCap', min: 1, max: 30, integer: true,
    defaultOwner: 'src/content/cacheLane.ts CACHE_LANE_LEVER_DEFAULTS',
  },
  contractRewardScalar: {
    key: 'contractRewardScalar', min: 0, max: 2, integer: false,
    defaultOwner: 'src/content/contracts.ts CONTRACT_LEVER_DEFAULTS',
  },
  contractTargetScalar: {
    key: 'contractTargetScalar', min: 0.5, max: 2, integer: false,
    defaultOwner: 'src/content/contracts.ts CONTRACT_LEVER_DEFAULTS',
  },
  contractDailyCount: {
    key: 'contractDailyCount', min: 1, max: 5, integer: true,
    defaultOwner: 'src/content/contracts.ts CONTRACT_LEVER_DEFAULTS',
  },
  contractWeeklyCount: {
    key: 'contractWeeklyCount', min: 1, max: 8, integer: true,
    defaultOwner: 'src/content/contracts.ts CONTRACT_LEVER_DEFAULTS',
  },
  contractRerollScrapDaily: {
    key: 'contractRerollScrapDaily', min: 0, max: 1000, integer: true,
    defaultOwner: 'src/content/contracts.ts CONTRACT_LEVER_DEFAULTS',
  },
  contractRerollScrapWeekly: {
    key: 'contractRerollScrapWeekly', min: 0, max: 5000, integer: true,
    defaultOwner: 'src/content/contracts.ts CONTRACT_LEVER_DEFAULTS',
  },
  contractWeeklyKeys: {
    key: 'contractWeeklyKeys', min: 0, max: 3, integer: true,
    defaultOwner: 'src/content/contracts.ts CONTRACT_LEVER_DEFAULTS',
  },
  researchDurationScalar: {
    key: 'researchDurationScalar', min: 0.5, max: 2, integer: false,
    defaultOwner: 'src/content/research.ts RESEARCH_LEVER_DEFAULTS',
  },
  researchCostScalar: {
    key: 'researchCostScalar', min: 0.5, max: 3, integer: false,
    defaultOwner: 'src/content/research.ts RESEARCH_LEVER_DEFAULTS',
  },
};

const CACHE_TTL_MS = 60_000;

/** Validate one raw stored/written value for a key. Null = invalid. */
export function validateEconomyConfigValue(key: string, value: unknown): number | null {
  const spec = (ECONOMY_CONFIG_KEYS as Record<string, EconomyConfigKeySpec>)[key];
  if (!spec) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < spec.min || value > spec.max) return null;
  if (spec.integer && !Number.isInteger(value)) return null;
  return value;
}

export function isEconomyConfigKey(key: string): key is EconomyConfigKey {
  return key in ECONOMY_CONFIG_KEYS;
}

/**
 * Merge raw stored values (key → unknown jsonb) over the defaults,
 * dropping anything invalid. The single merge used by the accessor
 * and the admin report, so they can never disagree.
 */
export function resolveEconomyConfigValues(
  stored: Record<string, unknown> | null | undefined,
): EconomyConfigValues {
  const values: EconomyConfigValues = { ...ECONOMY_CONFIG_DEFAULTS };
  if (!stored) return values;
  for (const key of Object.keys(ECONOMY_CONFIG_KEYS) as EconomyConfigKey[]) {
    if (!(key in stored)) continue;
    const valid = validateEconomyConfigValue(key, stored[key]);
    if (valid !== null) values[key] = valid;
  }
  return values;
}

/** The persistence seam behind the accessor (Pg + in-memory impls). */
export interface EconomyConfigSource {
  /** Raw stored lever values by key (jsonb-decoded). */
  loadConfigValues(): Promise<Record<string, unknown>>;
}

export class EconomyConfig {
  private cache: { values: EconomyConfigValues; loadedAt: number } | null = null;

  constructor(
    private readonly source: EconomyConfigSource | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Effective lever values, cached ≤60s; defaults on any failure. */
  async snapshot(): Promise<EconomyConfigValues> {
    if (this.cache && this.now() - this.cache.loadedAt < CACHE_TTL_MS) {
      return this.cache.values;
    }
    if (!this.source) {
      return { ...ECONOMY_CONFIG_DEFAULTS };
    }
    try {
      const stored = await this.source.loadConfigValues();
      const values = resolveEconomyConfigValues(stored);
      this.cache = { values, loadedAt: this.now() };
      return values;
    } catch {
      // Config must never take the game down: serve the last good
      // snapshot if we have one, else the shipped defaults.
      return this.cache ? this.cache.values : { ...ECONOMY_CONFIG_DEFAULTS };
    }
  }

  async get<K extends EconomyConfigKey>(key: K): Promise<number> {
    return (await this.snapshot())[key];
  }

  /** Drop the cache (admin writes call this so the writer sees it land). */
  invalidate(): void {
    this.cache = null;
  }
}
