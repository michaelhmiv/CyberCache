import { ConsumableLoadout, ConsumableSlot, ConsumableType } from '../types/game';

export type ConsumableFamily = 'survival' | 'ammo' | 'ordnance' | 'tactical' | 'economy' | 'corrupted';
export type ConsumableTrigger =
  | 'fightStart'
  | 'shieldPhase'
  | 'armorPhase'
  | 'bossMechanic'
  | 'survivalFailure'
  | 'hpBelowThreshold'
  | 'shieldBelowThreshold'
  | 'activityStart'
  | 'ammoInterval'
  | 'craftStart'
  | 'scrapStart'
  | 'repairStart'
  | 'victory'
  | 'defeat'
  | 'lootRoll'
  | 'manual';
export type ConsumePolicy = 'onAttempt' | 'onTrigger' | 'onVictory' | 'onDefeat' | 'ifUsed' | 'perInterval';
export type CounterTag =
  | 'shield'
  | 'armor'
  | 'enrage'
  | 'phase'
  | 'repair'
  | 'burn'
  | 'burst'
  | 'elite'
  | 'loot'
  | 'deathFee'
  | 'ammo'
  | 'reload'
  | 'crit'
  | 'salvage'
  | 'crafting'
  | 'accuracy'
  | 'cache'
  | 'mechanical'
  | 'stagger';
export type ImplementationStatus = 'implemented' | 'approximated' | 'legacy';

export type ConsumableActivityScope = 'roaming' | 'boss' | 'crafting' | 'scrapping' | 'repair' | 'market';
export type ConsumableLayoutChannel = 'ammo' | 'emergency' | 'ordnance' | 'tactical' | 'utility' | 'workshop';
export type ConsumableZeroBehavior = 'inactive_continue' | 'block_activity' | 'warn_continue' | 'auto_unequip';
export type ConsumableBatchOrigin = 'vendor' | 'crafted' | 'market' | 'reward' | 'admin';
export type ConsumableQualityScaling = 'none' | 'flat' | 'duration' | 'chance' | 'multiplierDelta' | 'inverseMultiplierDelta';

export interface ConsumableEffectRules {
  survivalFlat?: number;
  survivalMultiplier?: number;
  shieldBreakMultiplier?: number;
  armorBreakMultiplier?: number;
  dpsMultiplier?: number;
  mechanicMultiplier?: number;
  mechanicFlat?: number;
  deathFeeReduction?: number;
  bonusLootChance?: number;
  extraLootRollChance?: number;
  bossSlowMultiplier?: number;
  freeOrdnanceUses?: number;
  ammoWindowUses?: number;
  recommendationIntel?: number;
}

export interface ConsumableDrawbackRules {
  survivalMultiplier?: number;
  rewardMultiplier?: number;
}

export interface ConsumableVisual {
  glyph: string;
  accent: 'green' | 'red' | 'orange' | 'cyan' | 'amber' | 'purple' | 'blue';
  silhouette: 'vial' | 'cell' | 'swarm' | 'syringe' | 'magazine' | 'rounds' | 'grenade' | 'scanner' | 'beacon' | 'contract' | 'ticket';
  frame: 'standard' | 'reinforced' | 'volatile' | 'signal' | 'market';
}

export interface ConsumableQualityConfig {
  vendorQuality: number;
  craftMin: number;
  craftMax: number;
  scalingSummary: string;
  cap?: number;
  highQualityBreakpoint?: number;
  perfectQualityBreakpoint?: number;
}

export interface ConsumableRuntimeEffectScaling {
  mode: ConsumableQualityScaling;
  factor?: number;
  cap?: number;
  floor?: number;
}

export interface ConsumableRuntimeEffects {
  healHp?: number;
  shieldRestore?: number;
  /** Flat damage reduction (0-1) while active — roaming Shield Cell resistance. */
  damageReductionPct?: number;
  /** Flat bonus DPS per ordnance fire while roaming (interval burst). */
  ordnanceBonusDps?: number;
  repairTotalHp?: number;
  repairDurationSeconds?: number;
  dotDamageReduction?: number;
  overhealToRegenPct?: number;
  survivalFlat?: number;
  survivalMultiplier?: number;
  dpsMultiplier?: number;
  shieldBreakMultiplier?: number;
  armorBreakMultiplier?: number;
  mechanicMultiplier?: number;
  mechanicScoreFlat?: number;
  mechanicReduction?: number;
  repairSuppression?: number;
  reloadPenaltyReduction?: number;
  critChanceBonus?: number;
  incomingDpsMultiplier?: number;
  incomingAccuracyMultiplier?: number;
  ammoCoveredSeconds?: number;
  ammoWindowUses?: number;
  freeOrdnanceUses?: number;
  armorBypass?: number;
  ordnanceBoostMultiplier?: number;
  boostedOrdnanceUses?: number;
  deathFeeReduction?: number;
  bonusLootChance?: number;
  extraLootRollChance?: number;
  rareMaterialChance?: number;
  rarityBias?: number;
  eventChanceBonus?: number;
  /** Roaming event table re-weighting toward find/material events (Data Skimmer). */
  eventFindWeightBonus?: number;
  /** Signal hint: the next roaming event's family is foreshadowed one tick early (Data Skimmer). */
  eventForeshadow?: number;
  /** Material-find roaming events pay this fraction more (Salvage Contract). */
  materialEventYieldBonus?: number;
  /** Buried-cache / convoy-style roaming events gain this weight bonus (Magnetized Payload). */
  cacheEventWeightBonus?: number;
  enemyPressureMultiplier?: number;
  yieldMultiplier?: number;
  timeReduction?: number;
  creditFeeReduction?: number;
  fatigueDamagePct?: number;
  protectedConsumableLosses?: number;
  recommendationIntel?: number;
  scannerIntelTier?: number;
  shieldRegenInterruptChance?: number;
  staggerChance?: number;
  dodgeChanceBonus?: number;
  /** Fuel units one cell loads into the vehicle tank (cc_refuel_vehicle). */
  fuelUnits?: number;
  /** Vehicle condition points one kit restores at 100% quality (cc_use_patch_kit). */
  conditionRestore?: number;
  /** Calibration points one core carries at 100% quality (shield-tech jobs, migration 0044). */
  calibrationPoints?: number;
}

export interface ConsumableHighQualityPerk {
  minQuality: number;
  label: string;
  effects: ConsumableRuntimeEffects;
}

export interface ConsumableActivityRule {
  trigger?: ConsumableTrigger;
  consumePolicy?: ConsumePolicy;
  zeroBehavior?: ConsumableZeroBehavior;
  durationSeconds?: number;
  threshold?: number;
}

export interface ConsumableRuntimeConfig {
  activityScopes: ConsumableActivityScope[];
  layoutChannel: ConsumableLayoutChannel;
  trigger: ConsumableTrigger;
  consumePolicy: ConsumePolicy;
  zeroBehavior: ConsumableZeroBehavior;
  threshold?: number;
  baseEffects: ConsumableRuntimeEffects;
  qualityScaling: Partial<Record<keyof ConsumableRuntimeEffects, ConsumableRuntimeEffectScaling>>;
  highQualityPerks?: ConsumableHighQualityPerk[];
  activityRules?: Partial<Record<ConsumableActivityScope, ConsumableActivityRule>>;
  ledgerText: string;
}

export interface ConsumableMarketConfig {
  vendorStocked: boolean;
  vendorPrice: number;
  vendorQuality: number;
  craftable: boolean;
  playerMarketAllowed: boolean;
  rotatingVendorOnly?: boolean;
  /**
   * Never sold by the NPC vendor in ANY channel (staples or rotation):
   * the type exists only from crafters and the player market
   * (crafting-as-occupation §2.5d — Field/Master patch kits and the
   * crafted Fuel Cell). The vendorPrice still anchors buyback value.
   */
  vendorExcluded?: boolean;
}

export interface ConsumableDef {
  id: string;
  name: string;
  family: ConsumableFamily;
  shortDescription: string;
  tacticalRole: string;
  trigger: ConsumableTrigger;
  consumePolicy: ConsumePolicy;
  counterTags: CounterTag[];
  effectRules: ConsumableEffectRules;
  drawbackRules?: ConsumableDrawbackRules;
  basePrice: number;
  craftCategory: string;
  uiHints: string[];
  implementationStatus: ImplementationStatus;
  isBossPrepVisible: boolean;
  isVendorStocked: boolean;
  visual: ConsumableVisual;
  quality: ConsumableQualityConfig;
  runtime: ConsumableRuntimeConfig;
  market: ConsumableMarketConfig;
  category: 'survival' | 'offense' | 'utility';
  description: string;
  effect: string;
}

export const CONSUMABLE_SLOTS: ConsumableSlot[] = [
  ConsumableSlot.PreFight,
  ConsumableSlot.MidFight,
  ConsumableSlot.Emergency,
];

export const EMPTY_CONSUMABLE_LOADOUT: ConsumableLoadout = {
  [ConsumableSlot.PreFight]: null,
  [ConsumableSlot.MidFight]: null,
  [ConsumableSlot.Emergency]: null,
};

type ConsumableDefInput = Omit<ConsumableDef, 'description' | 'effect' | 'category' | 'basePrice' | 'isVendorStocked'> & {
  description?: string;
  effect?: string;
  category?: ConsumableDef['category'];
};

const VENDOR_QUALITY = 100;

const FULL_FLAT = { mode: 'flat' } satisfies ConsumableRuntimeEffectScaling;
const FULL_DURATION = { mode: 'duration' } satisfies ConsumableRuntimeEffectScaling;
const FULL_CHANCE = (cap?: number): ConsumableRuntimeEffectScaling => ({ mode: 'chance', cap });
const DELTA = (cap?: number): ConsumableRuntimeEffectScaling => ({ mode: 'multiplierDelta', cap });
const PARTIAL_DELTA = (cap?: number): ConsumableRuntimeEffectScaling => ({ mode: 'multiplierDelta', factor: 0.5, cap });
const INVERSE_DELTA = (floor?: number): ConsumableRuntimeEffectScaling => ({ mode: 'inverseMultiplierDelta', floor });

function defineConsumable(def: ConsumableDefInput): ConsumableDef {
  return {
    ...def,
    basePrice: def.market.vendorPrice,
    isVendorStocked: def.market.vendorStocked,
    description: def.description || def.shortDescription,
    effect: def.effect || def.runtime.ledgerText,
    category:
      def.category ||
      (def.family === 'survival' ? 'survival' : def.family === 'economy' || def.family === 'tactical' ? 'utility' : 'offense'),
  };
}

function quality(_vendorPrice: number, craftMin: number, craftMax: number, scalingSummary: string, cap = 175): ConsumableQualityConfig {
  return {
    vendorQuality: VENDOR_QUALITY,
    craftMin,
    craftMax,
    cap,
    highQualityBreakpoint: 125,
    perfectQualityBreakpoint: 150,
    scalingSummary,
  };
}

function market(vendorStocked: boolean, vendorPrice: number, craftable = true, playerMarketAllowed = true, rotatingVendorOnly = false, vendorExcluded = false): ConsumableMarketConfig {
  return {
    vendorStocked,
    vendorPrice,
    vendorQuality: VENDOR_QUALITY,
    craftable,
    playerMarketAllowed,
    rotatingVendorOnly,
    vendorExcluded,
  };
}

function visual(glyph: string, accent: ConsumableVisual['accent'], silhouette: ConsumableVisual['silhouette'], frame: ConsumableVisual['frame'] = 'standard'): ConsumableVisual {
  return { glyph, accent, silhouette, frame };
}

function runtime(
  activityScopes: ConsumableActivityScope[],
  layoutChannel: ConsumableLayoutChannel,
  trigger: ConsumableTrigger,
  consumePolicy: ConsumePolicy,
  zeroBehavior: ConsumableZeroBehavior,
  baseEffects: ConsumableRuntimeEffects,
  qualityScaling: ConsumableRuntimeConfig['qualityScaling'],
  ledgerText: string,
  options?: Pick<ConsumableRuntimeConfig, 'threshold' | 'highQualityPerks' | 'activityRules'>
): ConsumableRuntimeConfig {
  return {
    activityScopes,
    layoutChannel,
    trigger,
    consumePolicy,
    zeroBehavior,
    baseEffects,
    qualityScaling,
    ledgerText,
    ...options,
  };
}

export const CONSUMABLES: Record<string, ConsumableDef> = {
  [ConsumableType.MedKit]: defineConsumable({
    id: ConsumableType.MedKit,
    name: 'Med Kit',
    family: 'survival',
    shortDescription: 'Basic emergency heal that auto-fires when HP crosses the configured danger threshold.',
    tacticalRole: 'Emergency Heal',
    trigger: 'hpBelowThreshold',
    consumePolicy: 'ifUsed',
    counterTags: ['burst'],
    effectRules: { survivalFlat: 150 },
    craftCategory: 'survival',
    uiHints: ['Auto-used at 50% HP by default.', 'Quality scales actual HP restored.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('✚', 'green', 'vial'),
    quality: quality(250, 75, 125, 'Heal amount scales directly with quality.'),
    runtime: runtime(
      ['roaming', 'boss'],
      'emergency',
      'hpBelowThreshold',
      'ifUsed',
      'inactive_continue',
      { healHp: 150 },
      { healHp: FULL_FLAT },
      'Med Kit consumed: restored emergency HP.',
      {
        threshold: 0.5,
        highQualityPerks: [{ minQuality: 125, label: 'Overheal converts to short regeneration.', effects: { overhealToRegenPct: 0.25, repairDurationSeconds: 9 } }],
      }
    ),
    market: market(true, 250),
  }),
  [ConsumableType.MedKitRefined]: defineConsumable({
    id: ConsumableType.MedKitRefined,
    name: 'Med Kit (Refined)',
    family: 'survival',
    shortDescription: 'Crafted stronger emergency heal for harder boss tiers and deeper roaming sessions.',
    tacticalRole: 'Premium Emergency Heal',
    trigger: 'hpBelowThreshold',
    consumePolicy: 'ifUsed',
    counterTags: ['burst', 'elite'],
    effectRules: { survivalFlat: 260 },
    craftCategory: 'survival',
    uiHints: ['Auto-used at 50% HP by default.', 'High-quality batches add damage-over-time mitigation.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('✚', 'green', 'vial', 'reinforced'),
    quality: quality(600, 80, 140, 'Heal amount scales directly with quality.'),
    runtime: runtime(
      ['roaming', 'boss'],
      'emergency',
      'hpBelowThreshold',
      'ifUsed',
      'inactive_continue',
      { healHp: 260 },
      { healHp: FULL_FLAT },
      'Refined Med Kit consumed: restored heavy emergency HP.',
      {
        threshold: 0.5,
        highQualityPerks: [{ minQuality: 125, label: 'Cleanses minor damage-over-time pressure.', effects: { dotDamageReduction: 0.35, repairDurationSeconds: 12 } }],
      }
    ),
    market: market(false, 600),
  }),
  [ConsumableType.ShieldCell]: defineConsumable({
    id: ConsumableType.ShieldCell,
    name: 'Shield Cell',
    family: 'survival',
    shortDescription: 'Emergency shield restore for burst, shield-break, and attrition pressure.',
    tacticalRole: 'Shield Sustain',
    trigger: 'shieldBelowThreshold',
    consumePolicy: 'ifUsed',
    counterTags: ['shield', 'burst'],
    effectRules: { survivalFlat: 120 },
    craftCategory: 'survival',
    uiHints: ['Auto-used when shield breaks or drops below 25%.', 'Quality scales shield restored.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('⬡', 'cyan', 'cell'),
    quality: quality(300, 75, 130, 'Shield restored scales directly with quality.'),
    runtime: runtime(
      ['roaming', 'boss'],
      'emergency',
      'shieldBelowThreshold',
      'ifUsed',
      'inactive_continue',
      { shieldRestore: 120, damageReductionPct: 0.15 },
      { shieldRestore: FULL_FLAT },
      'Shield Cell consumed: restored shield capacity.',
      {
        threshold: 0.25,
        activityRules: {
          roaming: { durationSeconds: 180 },
        },
        highQualityPerks: [{ minQuality: 125, label: 'Temporary recharge acceleration.', effects: { survivalMultiplier: 1.04, repairDurationSeconds: 15 } }],
      }
    ),
    market: market(true, 300),
  }),
  [ConsumableType.NanoSwarm]: defineConsumable({
    id: ConsumableType.NanoSwarm,
    name: 'Nano Swarm',
    family: 'survival',
    shortDescription: 'Repair cloud for sustained damage and burn/corrosive pressure.',
    tacticalRole: 'Attrition Repair',
    trigger: 'hpBelowThreshold',
    consumePolicy: 'ifUsed',
    counterTags: ['burn', 'burst'],
    effectRules: { survivalFlat: 300, survivalMultiplier: 1.04 },
    craftCategory: 'survival',
    uiHints: ['Best when repeated hits or damage-over-time are the failure cause.', 'Quality scales total repair and duration.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('✦', 'green', 'swarm'),
    quality: quality(800, 80, 145, 'Total repair and repair duration scale with quality.'),
    runtime: runtime(
      ['roaming', 'boss'],
      'emergency',
      'hpBelowThreshold',
      'ifUsed',
      'inactive_continue',
      { repairTotalHp: 300, repairDurationSeconds: 30, survivalMultiplier: 1.04 },
      { repairTotalHp: FULL_FLAT, repairDurationSeconds: FULL_DURATION, survivalMultiplier: PARTIAL_DELTA(1.08) },
      'Nano Swarm consumed: deployed repair-over-time cloud.',
      {
        threshold: 0.6,
        highQualityPerks: [{ minQuality: 130, label: 'Reduces burn/corrosive damage-over-time while active.', effects: { dotDamageReduction: 0.3 } }],
      }
    ),
    market: market(false, 800),
  }),
  [ConsumableType.AdrenalineShot]: defineConsumable({
    id: ConsumableType.AdrenalineShot,
    name: 'Adrenaline Shot',
    family: 'survival',
    shortDescription: 'Near-death survival injection that trades stability for a short damage push.',
    tacticalRole: 'Last-Stand Save',
    trigger: 'hpBelowThreshold',
    consumePolicy: 'ifUsed',
    counterTags: ['elite', 'burst'],
    effectRules: { survivalFlat: 80, survivalMultiplier: 1.1, dpsMultiplier: 1.1 },
    drawbackRules: { rewardMultiplier: 0.95 },
    craftCategory: 'survival',
    uiHints: ['Triggers at 20% HP or lethal survival checks.', 'Quality scales restore and burst duration.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('⚡', 'red', 'syringe', 'volatile'),
    quality: quality(1200, 75, 150, 'Restore and burst duration scale with quality.'),
    runtime: runtime(
      ['roaming', 'boss'],
      'emergency',
      'hpBelowThreshold',
      'ifUsed',
      'inactive_continue',
      { healHp: 80, dpsMultiplier: 1.1, repairDurationSeconds: 20, fatigueDamagePct: 0.05 },
      { healHp: FULL_FLAT, dpsMultiplier: PARTIAL_DELTA(1.18), repairDurationSeconds: FULL_DURATION, fatigueDamagePct: { mode: 'none' } },
      'Adrenaline Shot consumed: survived a lethal window and gained short DPS.',
      {
        threshold: 0.2,
        highQualityPerks: [{ minQuality: 130, label: 'Reduces post-shot fatigue.', effects: { fatigueDamagePct: -0.025 } }],
      }
    ),
    market: market(false, 1200),
  }),
  [ConsumableType.AmmoPack]: defineConsumable({
    id: ConsumableType.AmmoPack,
    name: 'Ammo Pack',
    family: 'ammo',
    shortDescription: 'Baseline sustained ammo supply for roaming coverage and boss ammo windows.',
    tacticalRole: 'Sustained DPS Supply',
    trigger: 'ammoInterval',
    consumePolicy: 'onAttempt',
    counterTags: ['ammo', 'reload', 'enrage'],
    effectRules: { dpsMultiplier: 1.05, ammoWindowUses: 1 },
    craftCategory: 'offense',
    uiHints: ['Boss: consumes one per attempt for an ammo window.', 'Roaming: one 100% pack covers 10 minutes of ammo bonus.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('▣', 'red', 'magazine'),
    quality: quality(150, 70, 125, 'Roaming duration and boss DPS window scale with quality.'),
    runtime: runtime(
      ['roaming', 'boss'],
      'ammo',
      'ammoInterval',
      'perInterval',
      'inactive_continue',
      { dpsMultiplier: 1.05, ammoCoveredSeconds: 600, ammoWindowUses: 1 },
      { dpsMultiplier: DELTA(1.1), ammoCoveredSeconds: FULL_DURATION, ammoWindowUses: { mode: 'none' } },
      'Ammo Pack consumed: supplied sustained ammunition coverage.',
      {
        activityRules: {
          boss: { trigger: 'fightStart', consumePolicy: 'onAttempt', zeroBehavior: 'inactive_continue' },
          roaming: { trigger: 'ammoInterval', consumePolicy: 'perInterval', durationSeconds: 600, zeroBehavior: 'inactive_continue' },
        },
        highQualityPerks: [{ minQuality: 130, label: 'Reduces reload penalty during covered windows.', effects: { reloadPenaltyReduction: 0.05 } }],
      }
    ),
    market: market(true, 150),
  }),
  [ConsumableType.HighCapacityAmmoPack]: defineConsumable({
    id: ConsumableType.HighCapacityAmmoPack,
    name: 'High-Capacity Ammo Pack',
    family: 'ammo',
    shortDescription: 'Crafted extended ammo supply for long idle sessions and boss DPS consistency.',
    tacticalRole: 'Extended Ammo Supply',
    trigger: 'ammoInterval',
    consumePolicy: 'perInterval',
    counterTags: ['ammo', 'reload', 'enrage'],
    effectRules: { dpsMultiplier: 1.05, ammoWindowUses: 2 },
    craftCategory: 'offense',
    uiHints: ['Roaming: one 100% pack covers 20 minutes.', 'High-quality batches add crit chance while covered.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('▤', 'red', 'magazine', 'reinforced'),
    quality: quality(375, 75, 140, 'Coverage duration scales strongly with quality.'),
    runtime: runtime(
      ['roaming', 'boss'],
      'ammo',
      'ammoInterval',
      'perInterval',
      'inactive_continue',
      { dpsMultiplier: 1.05, ammoCoveredSeconds: 1200, ammoWindowUses: 2 },
      { dpsMultiplier: DELTA(1.1), ammoCoveredSeconds: FULL_DURATION, ammoWindowUses: { mode: 'none' } },
      'High-Capacity Ammo Pack consumed: supplied extended ammo coverage.',
      {
        activityRules: {
          boss: { trigger: 'fightStart', consumePolicy: 'onAttempt', zeroBehavior: 'inactive_continue' },
          roaming: { trigger: 'ammoInterval', consumePolicy: 'perInterval', durationSeconds: 1200, zeroBehavior: 'inactive_continue' },
        },
        highQualityPerks: [{ minQuality: 130, label: 'Adds crit chance while ammo coverage is active.', effects: { critChanceBonus: 0.02 } }],
      }
    ),
    market: market(false, 375),
  }),
  [ConsumableType.ArmorPiercingAmmo]: defineConsumable({
    id: ConsumableType.ArmorPiercingAmmo,
    name: 'Armor-Piercing Ammo',
    family: 'ammo',
    shortDescription: 'Specialized rounds for armor phases and armored targets.',
    tacticalRole: 'Armor Break',
    trigger: 'armorPhase',
    consumePolicy: 'onTrigger',
    counterTags: ['armor'],
    effectRules: { armorBreakMultiplier: 1.25, ammoWindowUses: 1 },
    craftCategory: 'offense',
    uiHints: ['Consumes when an armor phase or armored elite actually needs it.', 'Quality scales armor-break multiplier.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('◈', 'orange', 'rounds'),
    quality: quality(400, 75, 135, 'Armor-break bonus scales with quality.'),
    runtime: runtime(
      ['boss'],
      'ammo',
      'armorPhase',
      'onTrigger',
      'inactive_continue',
      { armorBreakMultiplier: 1.25, ammoWindowUses: 1 },
      { armorBreakMultiplier: DELTA(1.4), ammoWindowUses: { mode: 'none' } },
      'Armor-Piercing Ammo consumed: increased armor-break output.'
    ),
    market: market(false, 400),
  }),
  [ConsumableType.IncendiaryAmmo]: defineConsumable({
    id: ConsumableType.IncendiaryAmmo,
    name: 'Incendiary Ammo',
    family: 'ammo',
    shortDescription: 'Burn rounds for sustained damage when armor is not the main problem.',
    tacticalRole: 'Burn DPS',
    trigger: 'activityStart',
    consumePolicy: 'onTrigger',
    counterTags: ['burn', 'elite'],
    effectRules: { dpsMultiplier: 1.08, ammoWindowUses: 1 },
    craftCategory: 'offense',
    uiHints: ['Weak into armor until armor is broken.', 'Quality scales burn DPS contribution.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('◇', 'orange', 'rounds', 'volatile'),
    quality: quality(450, 75, 140, 'Burn DPS contribution scales with quality.'),
    runtime: runtime(
      ['roaming', 'boss'],
      'ammo',
      'activityStart',
      'onTrigger',
      'inactive_continue',
      { dpsMultiplier: 1.08, ammoWindowUses: 1, ammoCoveredSeconds: 600 },
      { dpsMultiplier: DELTA(1.16), ammoWindowUses: { mode: 'none' } },
      'Incendiary Ammo consumed: added burn DPS pressure.',
      {
        highQualityPerks: [{ minQuality: 130, label: 'Burn persists through one phase transition.', effects: { repairDurationSeconds: 6 } }],
      }
    ),
    market: market(false, 450),
  }),
  [ConsumableType.ShockAmmo]: defineConsumable({
    id: ConsumableType.ShockAmmo,
    name: 'Shock Ammo',
    family: 'ammo',
    shortDescription: 'Focused shield-break rounds for shield-heavy bosses and shielded elites.',
    tacticalRole: 'Shield Break',
    trigger: 'shieldPhase',
    consumePolicy: 'onTrigger',
    counterTags: ['shield'],
    effectRules: { shieldBreakMultiplier: 1.3, ammoWindowUses: 1 },
    craftCategory: 'offense',
    uiHints: ['Consumes when shield pressure exists.', 'Quality scales shield-break multiplier.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('◇', 'cyan', 'rounds'),
    quality: quality(450, 75, 140, 'Shield-break bonus scales with quality.'),
    runtime: runtime(
      ['boss'],
      'ammo',
      'shieldPhase',
      'onTrigger',
      'inactive_continue',
      { shieldBreakMultiplier: 1.3, ammoWindowUses: 1 },
      { shieldBreakMultiplier: DELTA(1.5), ammoWindowUses: { mode: 'none' } },
      'Shock Ammo consumed: increased shield-break output.',
      {
        highQualityPerks: [{ minQuality: 130, label: 'Can interrupt shield regeneration.', effects: { shieldRegenInterruptChance: 0.12 } }],
      }
    ),
    market: market(false, 450),
  }),
  [ConsumableType.CorrosiveAmmo]: defineConsumable({
    id: ConsumableType.CorrosiveAmmo,
    name: 'Corrosive Ammo',
    family: 'ammo',
    shortDescription: 'Armor-break rounds that also suppress armor repair mechanics.',
    tacticalRole: 'Armor / Repair Counter',
    trigger: 'armorPhase',
    consumePolicy: 'onTrigger',
    counterTags: ['armor', 'repair'],
    effectRules: { armorBreakMultiplier: 1.3, mechanicFlat: 0.08, ammoWindowUses: 1 },
    craftCategory: 'offense',
    uiHints: ['Best against armor and repair bosses.', 'Repair suppression is capped for balance.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('◇', 'green', 'rounds'),
    quality: quality(450, 75, 140, 'Armor-break and repair suppression scale with quality.'),
    runtime: runtime(
      ['boss'],
      'ammo',
      'armorPhase',
      'onTrigger',
      'inactive_continue',
      { armorBreakMultiplier: 1.3, repairSuppression: 0.08, mechanicScoreFlat: 0.08, ammoWindowUses: 1 },
      { armorBreakMultiplier: DELTA(1.5), repairSuppression: FULL_CHANCE(0.14), mechanicScoreFlat: FULL_CHANCE(0.14), ammoWindowUses: { mode: 'none' } },
      'Corrosive Ammo consumed: increased armor break and repair suppression.',
      {
        highQualityPerks: [{ minQuality: 130, label: 'Repair suppression lasts one extra mechanic window.', effects: { repairDurationSeconds: 10 } }],
      }
    ),
    market: market(false, 450),
  }),
  [ConsumableType.CryoAmmo]: defineConsumable({
    id: ConsumableType.CryoAmmo,
    name: 'Cryo Ammo',
    family: 'ammo',
    shortDescription: 'Control rounds that slow enemy pressure and improve survival stability.',
    tacticalRole: 'Survival Control',
    trigger: 'activityStart',
    consumePolicy: 'onTrigger',
    counterTags: ['burst'],
    effectRules: { survivalMultiplier: 1.11, ammoWindowUses: 1 },
    craftCategory: 'offense',
    uiHints: ['Use when survival is close but Emergency is reserved.', 'Quality lowers incoming pressure further.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('◇', 'blue', 'rounds'),
    quality: quality(450, 75, 140, 'Incoming pressure reduction scales with quality.'),
    runtime: runtime(
      ['roaming', 'boss'],
      'ammo',
      'activityStart',
      'onTrigger',
      'inactive_continue',
      { incomingDpsMultiplier: 0.9, ammoWindowUses: 1, ammoCoveredSeconds: 600 },
      { incomingDpsMultiplier: INVERSE_DELTA(0.82), ammoWindowUses: { mode: 'none' } },
      'Cryo Ammo consumed: reduced incoming enemy pressure.',
      {
        highQualityPerks: [{ minQuality: 130, label: 'Also improves dodge chance while active.', effects: { dodgeChanceBonus: 0.03 } }],
      }
    ),
    market: market(false, 450),
  }),
  [ConsumableType.VoidAmmo]: defineConsumable({
    id: ConsumableType.VoidAmmo,
    name: 'Void Ammo',
    family: 'corrupted',
    shortDescription: 'Risk/reward rounds for DPS races; higher quality adds more damage and more instability.',
    tacticalRole: 'High-Risk DPS',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['enrage', 'elite'],
    effectRules: { dpsMultiplier: 1.22, ammoWindowUses: 1 },
    drawbackRules: { survivalMultiplier: 0.9 },
    craftCategory: 'offense',
    uiHints: ['Best against enrage and DPS-race bosses.', 'Quality scales both the damage and the survival drawback.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('◆', 'purple', 'rounds', 'volatile'),
    quality: quality(700, 70, 155, 'DPS bonus and survival risk both scale with quality.'),
    runtime: runtime(
      ['boss'],
      'ammo',
      'fightStart',
      'onAttempt',
      'inactive_continue',
      { dpsMultiplier: 1.22, survivalMultiplier: 0.9, ammoWindowUses: 1 },
      { dpsMultiplier: DELTA(1.38), survivalMultiplier: INVERSE_DELTA(0.84), ammoWindowUses: { mode: 'none' } },
      'Void Ammo consumed: increased DPS and reduced survival stability.'
    ),
    market: market(false, 700),
  }),
  [ConsumableType.Grenade]: defineConsumable({
    id: ConsumableType.Grenade,
    name: 'Ordnance Charge',
    family: 'ordnance',
    shortDescription: 'Vendor baseline ordnance for shield, armor, and stagger checks.',
    tacticalRole: 'Burst Break',
    trigger: 'shieldPhase',
    consumePolicy: 'onAttempt',
    counterTags: ['shield', 'armor', 'burst', 'stagger'],
    effectRules: { shieldBreakMultiplier: 1.15, armorBreakMultiplier: 1.15, mechanicFlat: 0.04, freeOrdnanceUses: 1 },
    craftCategory: 'offense',
    uiHints: ['Legacy Grenade ID remains for save compatibility.', 'Use crafted Ordnance Charge for player-market batches.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('●', 'orange', 'grenade'),
    quality: quality(400, 75, 125, 'Burst break effects scale with quality.'),
    runtime: runtime(
      ['boss'],
      'ordnance',
      'shieldPhase',
      'onAttempt',
      'inactive_continue',
      { shieldBreakMultiplier: 1.15, armorBreakMultiplier: 1.15, mechanicScoreFlat: 0.04, ammoWindowUses: 0 },
      { shieldBreakMultiplier: DELTA(1.25), armorBreakMultiplier: DELTA(1.25), mechanicScoreFlat: FULL_CHANCE(0.08) },
      'Ordnance Charge consumed: applied burst break pressure.',
      {
        highQualityPerks: [{ minQuality: 130, label: 'Adds stagger chance.', effects: { staggerChance: 0.05 } }],
      }
    ),
    market: market(true, 400),
  }),
  [ConsumableType.OrdnanceCharge]: defineConsumable({
    id: ConsumableType.OrdnanceCharge,
    name: 'Ordnance Charge',
    family: 'ordnance',
    shortDescription: 'Crafted ordnance burst for shield, armor, and stagger checks.',
    tacticalRole: 'Burst Break',
    trigger: 'shieldPhase',
    consumePolicy: 'onAttempt',
    counterTags: ['shield', 'armor', 'burst', 'stagger'],
    effectRules: { shieldBreakMultiplier: 1.15, armorBreakMultiplier: 1.15, mechanicFlat: 0.04, freeOrdnanceUses: 1 },
    craftCategory: 'offense',
    uiHints: ['Player-crafted replacement for vendor baseline ordnance.', 'Quality scales shield, armor, and stagger mechanics.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('●', 'orange', 'grenade', 'reinforced'),
    quality: quality(400, 75, 145, 'Burst break effects scale with quality.'),
    runtime: runtime(
      ['boss', 'roaming'],
      'ordnance',
      'shieldPhase',
      'onAttempt',
      'inactive_continue',
      { shieldBreakMultiplier: 1.15, armorBreakMultiplier: 1.15, mechanicScoreFlat: 0.04, ammoWindowUses: 0, ordnanceBonusDps: 50 },
      { shieldBreakMultiplier: DELTA(1.3), armorBreakMultiplier: DELTA(1.3), mechanicScoreFlat: FULL_CHANCE(0.09) },
      'Ordnance Charge consumed: applied crafted burst break pressure.',
      {
        highQualityPerks: [{ minQuality: 130, label: 'Adds stagger chance.', effects: { staggerChance: 0.05 } }],
      }
    ),
    market: market(false, 400),
  }),
  [ConsumableType.EMPCharge]: defineConsumable({
    id: ConsumableType.EMPCharge,
    name: 'EMP Charge',
    family: 'ordnance',
    shortDescription: 'Shield and mechanical countercharge for shielded or machine-type bosses.',
    tacticalRole: 'Shield / Mechanical Counter',
    trigger: 'shieldPhase',
    consumePolicy: 'onTrigger',
    counterTags: ['shield', 'mechanical', 'phase'],
    effectRules: { shieldBreakMultiplier: 1.35, mechanicFlat: 0.1 },
    craftCategory: 'offense',
    uiHints: ['Consumes on shield or mechanical mechanic windows.', 'Quality scales shield break and jam strength.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('◉', 'cyan', 'grenade', 'signal'),
    quality: quality(650, 75, 145, 'Shield break scales fully; mechanic suppression is capped.'),
    runtime: runtime(
      ['boss', 'roaming'],
      'ordnance',
      'shieldPhase',
      'onTrigger',
      'inactive_continue',
      { shieldBreakMultiplier: 1.35, mechanicReduction: 0.1, mechanicScoreFlat: 0.1, ordnanceBonusDps: 60 },
      { shieldBreakMultiplier: DELTA(1.55), mechanicReduction: FULL_CHANCE(0.18), mechanicScoreFlat: FULL_CHANCE(0.18) },
      'EMP Charge consumed: broke shield pressure and suppressed mechanical mechanics.',
      {
        highQualityPerks: [{ minQuality: 130, label: 'Can interrupt shield regeneration.', effects: { shieldRegenInterruptChance: 0.18 } }],
      }
    ),
    market: market(false, 650),
  }),
  [ConsumableType.CorrosiveCharge]: defineConsumable({
    id: ConsumableType.CorrosiveCharge,
    name: 'Corrosive Charge',
    family: 'ordnance',
    shortDescription: 'Heavy armor burst and repair suppression charge.',
    tacticalRole: 'Armor / Repair Burst',
    trigger: 'armorPhase',
    consumePolicy: 'onTrigger',
    counterTags: ['armor', 'repair'],
    effectRules: { armorBreakMultiplier: 1.35, mechanicFlat: 0.1 },
    craftCategory: 'offense',
    uiHints: ['Consumes on armor or repair windows.', 'Quality scales armor break and repair suppression.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('◉', 'green', 'grenade', 'volatile'),
    quality: quality(650, 75, 145, 'Armor break scales fully; repair suppression is capped.'),
    runtime: runtime(
      ['boss', 'roaming'],
      'ordnance',
      'armorPhase',
      'onTrigger',
      'inactive_continue',
      { armorBreakMultiplier: 1.35, repairSuppression: 0.1, mechanicScoreFlat: 0.1, ordnanceBonusDps: 70 },
      { armorBreakMultiplier: DELTA(1.55), repairSuppression: FULL_CHANCE(0.18), mechanicScoreFlat: FULL_CHANCE(0.18) },
      'Corrosive Charge consumed: cracked armor and suppressed repair.',
      {
        highQualityPerks: [{ minQuality: 130, label: 'Armor-break effect persists into the next phase.', effects: { repairDurationSeconds: 8 } }],
      }
    ),
    market: market(false, 650),
  }),
  [ConsumableType.PhaseShiftGrenade]: defineConsumable({
    id: ConsumableType.PhaseShiftGrenade,
    name: 'Phase Shift Grenade',
    family: 'ordnance',
    shortDescription: 'High-tier grenade that bypasses part of an armor phase.',
    tacticalRole: 'Armor Phase Bypass',
    trigger: 'armorPhase',
    consumePolicy: 'onTrigger',
    counterTags: ['armor', 'phase'],
    effectRules: { armorBreakMultiplier: 1.5, mechanicFlat: 0.05 },
    craftCategory: 'offense',
    uiHints: ['Consumes only when an armor phase exists.', 'Quality scales armor bypass up to a cap.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('◌', 'purple', 'grenade', 'volatile'),
    quality: quality(1000, 75, 155, 'Armor bypass scales with quality up to a cap.'),
    runtime: runtime(
      ['boss', 'roaming'],
      'ordnance',
      'armorPhase',
      'onTrigger',
      'inactive_continue',
      { armorBreakMultiplier: 1.5, armorBypass: 0.4, mechanicScoreFlat: 0.05, ordnanceBonusDps: 80 },
      { armorBreakMultiplier: DELTA(1.75), armorBypass: FULL_CHANCE(0.65), mechanicScoreFlat: FULL_CHANCE(0.1) },
      'Phase Shift Grenade consumed: bypassed part of the armor phase.'
    ),
    market: market(false, 1000),
  }),
  [ConsumableType.MagnetizedPayload]: defineConsumable({
    id: ConsumableType.MagnetizedPayload,
    name: 'Magnetized Payload',
    family: 'ordnance',
    shortDescription: 'Pre-fight loader that strengthens upcoming ordnance windows.',
    tacticalRole: 'Ordnance Support',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['shield', 'armor', 'burst'],
    effectRules: { freeOrdnanceUses: 2 },
    craftCategory: 'utility',
    uiHints: ['Best when ordnance is your strongest break tool.', 'Quality scales the ordnance boost.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('⌾', 'orange', 'grenade', 'reinforced'),
    quality: quality(650, 75, 150, 'Ordnance boost scales with quality.'),
    runtime: runtime(
      ['boss', 'roaming'],
      'ordnance',
      'fightStart',
      'onAttempt',
      'inactive_continue',
      { ordnanceBoostMultiplier: 1.2, boostedOrdnanceUses: 2, freeOrdnanceUses: 2, ordnanceBonusDps: 90, cacheEventWeightBonus: 1 },
      { ordnanceBoostMultiplier: DELTA(1.35), boostedOrdnanceUses: { mode: 'none' }, freeOrdnanceUses: { mode: 'none' } },
      'Magnetized Payload consumed: boosted loaded ordnance.',
      {
        highQualityPerks: [{ minQuality: 150, label: 'Boosts one additional ordnance effect.', effects: { boostedOrdnanceUses: 1, freeOrdnanceUses: 1 } }],
      }
    ),
    market: market(false, 650),
  }),
  [ConsumableType.OverchargeStim]: defineConsumable({
    id: ConsumableType.OverchargeStim,
    name: 'Overcharge Stim',
    family: 'corrupted',
    shortDescription: 'Pre-fight burst injection for short boss DPS checks.',
    tacticalRole: 'Burst DPS',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['burst', 'enrage'],
    effectRules: { dpsMultiplier: 1.12 },
    craftCategory: 'offense',
    uiHints: ['Best when a boss barely survives the DPS window.', 'Quality scales burst DPS.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('↯', 'purple', 'syringe', 'volatile'),
    quality: quality(800, 70, 150, 'Burst DPS scales with quality.'),
    runtime: runtime(
      ['boss'],
      'tactical',
      'fightStart',
      'onAttempt',
      'inactive_continue',
      { dpsMultiplier: 1.12 },
      { dpsMultiplier: DELTA(1.24) },
      'Overcharge Stim consumed: increased short-window DPS.'
    ),
    market: market(false, 800),
  }),
  [ConsumableType.TargetPainter]: defineConsumable({
    id: ConsumableType.TargetPainter,
    name: 'Target Painter',
    family: 'tactical',
    shortDescription: 'Pre-fight mark that improves focused boss DPS.',
    tacticalRole: 'Focused DPS',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['enrage', 'elite', 'crit'],
    effectRules: { dpsMultiplier: 1.15 },
    craftCategory: 'offense',
    uiHints: ['Best against DPS races and enrage bosses.', 'Quality scales focused DPS and can add crit chance.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('⌖', 'red', 'scanner', 'signal'),
    quality: quality(600, 75, 145, 'Focused DPS scales with quality.'),
    runtime: runtime(
      ['boss'],
      'tactical',
      'fightStart',
      'onAttempt',
      'inactive_continue',
      { dpsMultiplier: 1.15 },
      { dpsMultiplier: DELTA(1.28) },
      'Target Painter consumed: marked the boss for focused fire.',
      {
        highQualityPerks: [{ minQuality: 130, label: 'Adds crit chance against weak phases.', effects: { critChanceBonus: 0.05 } }],
      }
    ),
    market: market(false, 600),
  }),
  [ConsumableType.BossScanner]: defineConsumable({
    id: ConsumableType.BossScanner,
    name: 'Boss Scanner',
    family: 'tactical',
    shortDescription: 'Intel pass that reveals failure categories, counters, and high-quality phase warnings.',
    tacticalRole: 'Boss Intel',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['phase', 'elite'],
    effectRules: { recommendationIntel: 1, mechanicFlat: 0.04 },
    craftCategory: 'utility',
    uiHints: ['100% reveals likely failure category.', 'Higher quality unlocks channel recommendations, win delta, burn projection, and phase warnings.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('▧', 'cyan', 'scanner', 'signal'),
    quality: quality(600, 80, 160, 'Quality unlocks deeper scanner tiers.'),
    runtime: runtime(
      ['boss'],
      'tactical',
      'fightStart',
      'onAttempt',
      'inactive_continue',
      { recommendationIntel: 1, scannerIntelTier: 1, mechanicScoreFlat: 0.04 },
      { recommendationIntel: { mode: 'none' }, scannerIntelTier: { mode: 'none' }, mechanicScoreFlat: FULL_CHANCE(0.08) },
      'Boss Scanner consumed: generated boss prep intelligence.',
      {
        highQualityPerks: [
          { minQuality: 115, label: 'Reveals recommended consumable channel.', effects: { scannerIntelTier: 2 } },
          { minQuality: 130, label: 'Reveals estimated win chance delta.', effects: { scannerIntelTier: 3 } },
          { minQuality: 145, label: 'Reveals projected consumable burn.', effects: { scannerIntelTier: 4 } },
          { minQuality: 160, label: 'Reveals phase-specific warnings.', effects: { scannerIntelTier: 5 } },
        ],
      }
    ),
    market: market(true, 600),
  }),
  [ConsumableType.Jammer]: defineConsumable({
    id: ConsumableType.Jammer,
    name: 'Jammer',
    family: 'tactical',
    shortDescription: 'Countermeasure for one matching boss mechanic window.',
    tacticalRole: 'Mechanic Counter',
    trigger: 'bossMechanic',
    consumePolicy: 'onTrigger',
    counterTags: ['enrage', 'phase', 'repair'],
    effectRules: { mechanicMultiplier: 1.2, mechanicFlat: 0.12 },
    craftCategory: 'utility',
    uiHints: ['Only consumes when a matching mechanic fires.', 'Quality scales mechanic reduction up to a cap.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('≋', 'cyan', 'scanner', 'signal'),
    quality: quality(750, 75, 150, 'Mechanic reduction scales with quality.'),
    runtime: runtime(
      ['boss'],
      'tactical',
      'bossMechanic',
      'onTrigger',
      'inactive_continue',
      { mechanicMultiplier: 1.2, mechanicScoreFlat: 0.12, mechanicReduction: 0.2 },
      { mechanicMultiplier: DELTA(1.35), mechanicScoreFlat: FULL_CHANCE(0.2), mechanicReduction: FULL_CHANCE(0.35) },
      'Jammer consumed: weakened a boss mechanic.',
      {
        highQualityPerks: [{ minQuality: 140, label: 'Can fully cancel minor mechanics.', effects: { mechanicReduction: 0.15 } }],
      }
    ),
    market: market(false, 750),
  }),
  [ConsumableType.SignalScrambler]: defineConsumable({
    id: ConsumableType.SignalScrambler,
    name: 'Signal Scrambler',
    family: 'tactical',
    shortDescription: 'Roaming countermeasure that lowers incoming enemy accuracy during covered time.',
    tacticalRole: 'Roaming Defense',
    trigger: 'activityStart',
    consumePolicy: 'perInterval',
    counterTags: ['accuracy', 'burst'],
    effectRules: { survivalMultiplier: 1.1 },
    craftCategory: 'utility',
    uiHints: ['Roaming only.', 'Quality scales coverage duration; high quality improves accuracy reduction.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('≋', 'blue', 'scanner', 'signal'),
    quality: quality(500, 75, 145, 'Coverage duration scales with quality.'),
    runtime: runtime(
      ['roaming'],
      'tactical',
      'activityStart',
      'perInterval',
      'inactive_continue',
      { incomingAccuracyMultiplier: 0.9, ammoCoveredSeconds: 600 },
      { incomingAccuracyMultiplier: { mode: 'none' }, ammoCoveredSeconds: FULL_DURATION },
      'Signal Scrambler consumed: reduced roaming enemy accuracy.',
      {
        activityRules: { roaming: { trigger: 'activityStart', consumePolicy: 'perInterval', durationSeconds: 600, zeroBehavior: 'inactive_continue' } },
        highQualityPerks: [{ minQuality: 130, label: 'Improves enemy accuracy reduction.', effects: { incomingAccuracyMultiplier: 0.95 } }],
      }
    ),
    market: market(false, 500),
  }),
  [ConsumableType.LootBeacon]: defineConsumable({
    id: ConsumableType.LootBeacon,
    name: 'Loot Beacon',
    family: 'economy',
    shortDescription: 'Roaming lure that raises gear drop chance while raising enemy pressure.',
    tacticalRole: 'Roaming Loot Risk',
    trigger: 'activityStart',
    consumePolicy: 'perInterval',
    counterTags: ['loot', 'cache', 'elite'],
    effectRules: { bonusLootChance: 0.1 },
    craftCategory: 'utility',
    uiHints: ['Roaming only.', 'While active: +3% roaming event chance (its designed home since the event system landed).', 'Quality scales the bonus loot chance; enemy pressure is an explicit drawback.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('◍', 'amber', 'beacon', 'market'),
    quality: quality(900, 70, 150, 'Bonus loot chance scales with quality and remains capped.'),
    runtime: runtime(
      ['roaming'],
      'utility',
      'activityStart',
      'perInterval',
      'inactive_continue',
      { bonusLootChance: 0.1, eventChanceBonus: 0.03, ammoCoveredSeconds: 600, enemyPressureMultiplier: 1.05 },
      { bonusLootChance: FULL_CHANCE(0.18), ammoCoveredSeconds: FULL_DURATION, enemyPressureMultiplier: { mode: 'none' } },
      'Loot Beacon consumed: increased roaming gear drop chance, event chance, and enemy pressure.',
      {
        activityRules: { roaming: { trigger: 'activityStart', consumePolicy: 'perInterval', durationSeconds: 600, zeroBehavior: 'inactive_continue' } },
        highQualityPerks: [{ minQuality: 140, label: 'Adds a small loot rarity bias to beacon events.', effects: { rarityBias: 0.05 } }],
      }
    ),
    market: market(false, 900),
  }),
  [ConsumableType.InsuranceToken]: defineConsumable({
    id: ConsumableType.InsuranceToken,
    name: 'Insurance Token',
    family: 'economy',
    shortDescription: 'Defeat-only coverage that reduces boss death fees.',
    tacticalRole: 'Death Fee Cover',
    trigger: 'defeat',
    consumePolicy: 'onDefeat',
    counterTags: ['deathFee', 'elite'],
    effectRules: { deathFeeReduction: 0.5 },
    craftCategory: 'utility',
    uiHints: ['Consumed only on defeat.', 'Quality scales fee reduction up to a cap.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('▰', 'amber', 'contract', 'market'),
    quality: quality(800, 80, 145, 'Death-fee reduction scales with quality and caps at 70%.'),
    runtime: runtime(
      ['boss'],
      'utility',
      'defeat',
      'onDefeat',
      'inactive_continue',
      { deathFeeReduction: 0.5 },
      { deathFeeReduction: FULL_CHANCE(0.7) },
      'Insurance Token consumed: reduced defeat death fee.',
      {
        highQualityPerks: [{ minQuality: 150, label: 'Protects one equipped consumable from loss when loss penalties are active.', effects: { protectedConsumableLosses: 1 } }],
      }
    ),
    market: market(true, 800),
  }),
  [ConsumableType.DataSkimmer]: defineConsumable({
    id: ConsumableType.DataSkimmer,
    name: 'Data Skimmer',
    family: 'economy',
    shortDescription: 'Loot utility that can add an extra loot roll after a successful drop.',
    tacticalRole: 'Extra Loot Roll',
    trigger: 'lootRoll',
    consumePolicy: 'onVictory',
    counterTags: ['loot'],
    effectRules: { extraLootRollChance: 0.25 },
    craftCategory: 'utility',
    uiHints: ['Only consumes on victory.', 'Quality scales extra-roll chance up to a cap.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('▧', 'amber', 'scanner', 'market'),
    quality: quality(900, 75, 150, 'Extra-roll chance scales with quality and caps at 40%.'),
    runtime: runtime(
      ['boss', 'roaming'],
      'utility',
      'lootRoll',
      'onVictory',
      'inactive_continue',
      { extraLootRollChance: 0.25, eventFindWeightBonus: 0.5, eventForeshadow: 1, ammoCoveredSeconds: 600 },
      { extraLootRollChance: FULL_CHANCE(0.4) },
      'Data Skimmer consumed: attempted an extra victory loot roll; roaming events skew toward finds and the next event is foreshadowed.',
      {
        highQualityPerks: [{ minQuality: 150, label: 'Extra roll gains a small rarity bias.', effects: { rarityBias: 0.05 } }],
      }
    ),
    market: market(false, 900),
  }),
  [ConsumableType.LuckBooster]: defineConsumable({
    id: ConsumableType.LuckBooster,
    name: 'Luck Booster',
    family: 'economy',
    shortDescription: 'Post-success loot quality booster that never changes win chance.',
    tacticalRole: 'Loot Quality',
    trigger: 'lootRoll',
    consumePolicy: 'onVictory',
    counterTags: ['loot'],
    effectRules: { bonusLootChance: 0.25 },
    craftCategory: 'utility',
    uiHints: ['Best when the fight is already farmable.', 'Quality scales bonus loot chance up to a cap.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('★', 'amber', 'beacon', 'market'),
    quality: quality(350, 75, 135, 'Bonus loot chance scales with quality and caps at 40%.'),
    runtime: runtime(
      ['boss', 'roaming'],
      'utility',
      'lootRoll',
      'onVictory',
      'inactive_continue',
      { bonusLootChance: 0.25, ammoCoveredSeconds: 600 },
      { bonusLootChance: FULL_CHANCE(0.4) },
      'Luck Booster consumed: improved post-success loot chance.'
    ),
    market: market(true, 350),
  }),
  [ConsumableType.SalvageContract]: defineConsumable({
    id: ConsumableType.SalvageContract,
    name: 'Salvage Contract',
    family: 'economy',
    shortDescription: 'Scrapping contract that improves scrap and material yield for a limited number of actions.',
    tacticalRole: 'Scrap Yield',
    trigger: 'scrapStart',
    consumePolicy: 'onAttempt',
    counterTags: ['salvage'],
    effectRules: {},
    craftCategory: 'utility',
    uiHints: ['Scrapping, and roaming salvage: material-find roaming events pay +50% while a contract is active.', 'Quality scales yield multiplier and can add rare material chance.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('▱', 'amber', 'contract', 'market'),
    quality: quality(700, 75, 150, 'Yield multiplier scales with quality.'),
    runtime: runtime(
      ['scrapping', 'roaming'],
      'utility',
      'scrapStart',
      'onAttempt',
      'inactive_continue',
      { yieldMultiplier: 1.15, materialEventYieldBonus: 0.5 },
      { yieldMultiplier: DELTA(1.3) },
      'Salvage Contract consumed: increased scrap/material yield.',
      {
        activityRules: { roaming: { trigger: 'activityStart', consumePolicy: 'perInterval', durationSeconds: 600, zeroBehavior: 'inactive_continue' } },
        highQualityPerks: [{ minQuality: 130, label: 'Adds rare material return chance.', effects: { rareMaterialChance: 0.05 } }],
      }
    ),
    market: market(false, 700),
  }),
  [ConsumableType.WorkshopRushTicket]: defineConsumable({
    id: ConsumableType.WorkshopRushTicket,
    name: 'Workshop Rush Ticket',
    family: 'economy',
    shortDescription: 'Workshop ticket that reduces crafting or repair duration.',
    tacticalRole: 'Workshop Acceleration',
    trigger: 'craftStart',
    consumePolicy: 'onAttempt',
    counterTags: ['crafting'],
    effectRules: {},
    craftCategory: 'utility',
    uiHints: ['Crafting and repair only.', 'Quality scales time reduction up to a cap.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('▻', 'blue', 'ticket', 'market'),
    quality: quality(1000, 75, 150, 'Time reduction scales with quality and caps at 45%.'),
    runtime: runtime(
      ['crafting', 'repair'],
      'workshop',
      'craftStart',
      'onAttempt',
      'inactive_continue',
      { timeReduction: 0.2 },
      { timeReduction: FULL_CHANCE(0.45) },
      'Workshop Rush Ticket consumed: reduced workshop duration.',
      {
        activityRules: {
          crafting: { trigger: 'craftStart', consumePolicy: 'onAttempt', zeroBehavior: 'inactive_continue' },
          repair: { trigger: 'repairStart', consumePolicy: 'onAttempt', zeroBehavior: 'inactive_continue' },
        },
        highQualityPerks: [{ minQuality: 140, label: 'Also reduces credit fee.', effects: { creditFeeReduction: 0.05 } }],
      }
    ),
    market: market(false, 1000, true, true, true),
  }),
  [ConsumableType.ElementalCoating]: defineConsumable({
    id: ConsumableType.ElementalCoating,
    name: 'Elemental Coating',
    family: 'ammo',
    shortDescription: 'Legacy elemental buff retained only for old saves; no longer vendor-stocked.',
    tacticalRole: 'Legacy Element',
    trigger: 'manual',
    consumePolicy: 'onAttempt',
    counterTags: ['shield', 'armor'],
    effectRules: { shieldBreakMultiplier: 1.08, armorBreakMultiplier: 1.08 },
    craftCategory: 'legacy',
    uiHints: ['Legacy compatibility item.', 'New economy uses elemental ammo batches instead.'],
    implementationStatus: 'legacy',
    isBossPrepVisible: false,
    visual: visual('◌', 'purple', 'rounds'),
    quality: quality(500, 100, 100, 'Legacy items do not roll quality.', 100),
    runtime: runtime(
      ['boss'],
      'ammo',
      'manual',
      'onAttempt',
      'auto_unequip',
      { shieldBreakMultiplier: 1.08, armorBreakMultiplier: 1.08 },
      { shieldBreakMultiplier: { mode: 'none' }, armorBreakMultiplier: { mode: 'none' } },
      'Elemental Coating consumed: applied legacy elemental break bonus.'
    ),
    market: market(false, 500, false, false),
  }),
  // Vehicle consumables (Phase 2b): neither activates in the roaming
  // consumable engine or boss prep — fuel cells load the tank through
  // cc_refuel_vehicle and patch kits restore condition through
  // cc_use_patch_kit, so their only runtime scope is 'repair' (the
  // vehicle-maintenance activity). Both are vendor staples (Michael's
  // baseline-goods principle: the NPC sells the baseline version);
  // richer crafted cells arrive with the crafting slice, so craftable
  // stays false in this slice.
  [ConsumableType.GenericFuelCell]: defineConsumable({
    id: ConsumableType.GenericFuelCell,
    name: 'Generic Fuel Cell',
    family: 'economy',
    shortDescription: 'Baseline fuel cell. Load it into your vehicle tank to keep the yield bonus running.',
    tacticalRole: 'Vehicle Fuel',
    trigger: 'manual',
    consumePolicy: 'onAttempt',
    counterTags: ['mechanical'],
    effectRules: {},
    craftCategory: 'utility',
    uiHints: ['Loads 100 fuel units per cell from the Garage.', 'Out of fuel never stops roaming — the vehicle bonus just turns off.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('▣', 'amber', 'cell'),
    quality: quality(40, 100, 100, 'Baseline cells are flat 100% quality.', 100),
    runtime: runtime(
      ['repair'],
      'utility',
      'manual',
      'onAttempt',
      'inactive_continue',
      { fuelUnits: 100 },
      {},
      'Fuel cell loaded into the vehicle tank.',
    ),
    market: market(true, 40, false, true),
  }),
  [ConsumableType.PatchKit]: defineConsumable({
    id: ConsumableType.PatchKit,
    name: 'Patch Kit',
    family: 'economy',
    shortDescription: 'Baseline repair kit. Restores vehicle condition at the untrained rate.',
    tacticalRole: 'Vehicle Repair',
    trigger: 'manual',
    consumePolicy: 'onAttempt',
    counterTags: ['mechanical', 'repair'],
    effectRules: {},
    craftCategory: 'utility',
    uiHints: ['Restores 30 condition at 100% quality.', 'Trained mechanics restore more per kit — repair services come later.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('✚', 'orange', 'vial', 'reinforced'),
    quality: quality(150, 75, 150, 'Condition restored scales directly with quality.'),
    runtime: runtime(
      ['repair'],
      'utility',
      'manual',
      'onAttempt',
      'inactive_continue',
      { conditionRestore: 30 },
      {},
      'Patch Kit consumed: restored vehicle condition.',
    ),
    // Craftable since the crafting-as-occupation slice (recipe_patch_kit,
    // rolled 75–130 — see CRAFT_QUALITY_BOUND_OVERRIDES); the vendor
    // staple above stays the flat-100% baseline.
    market: market(true, 150, true, true),
  }),
  // Crafted vehicle consumables (crafting-as-occupation §2.5d): NOT
  // vendor-stocked — the >100% / non-vendor exclusivity law means these
  // exist only from crafters and the player market. Patch-kit restore
  // is read by cc_use_patch_kit as base × consumed-batch quality.
  [ConsumableType.FieldPatchKit]: defineConsumable({
    id: ConsumableType.FieldPatchKit,
    name: 'Field Patch Kit',
    family: 'economy',
    shortDescription: 'Crafter-made repair kit. Restores more condition per kit than the vendor baseline.',
    tacticalRole: 'Vehicle Repair',
    trigger: 'manual',
    consumePolicy: 'onAttempt',
    counterTags: ['mechanical', 'repair'],
    effectRules: {},
    craftCategory: 'utility',
    uiHints: ['Restores 45 condition at 100% quality.', 'Crafted in the Workshop — never sold by the vendor.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('✚', 'orange', 'vial', 'reinforced'),
    quality: quality(400, 75, 140, 'Condition restored scales directly with quality.'),
    runtime: runtime(
      ['repair'],
      'utility',
      'manual',
      'onAttempt',
      'inactive_continue',
      { conditionRestore: 45 },
      {},
      'Field Patch Kit consumed: restored vehicle condition.',
    ),
    market: market(false, 400, true, true, false, true),
  }),
  [ConsumableType.MasterPatchKit]: defineConsumable({
    id: ConsumableType.MasterPatchKit,
    name: 'Master Patch Kit',
    family: 'economy',
    shortDescription: 'Master-crafted repair kit. The deepest condition restore a single kit can carry.',
    tacticalRole: 'Vehicle Repair',
    trigger: 'manual',
    consumePolicy: 'onAttempt',
    counterTags: ['mechanical', 'repair'],
    effectRules: {},
    craftCategory: 'utility',
    uiHints: ['Restores 80 condition at 100% quality.', 'Requires Consumable Crafting mastery 15 to produce.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('✚', 'amber', 'vial', 'reinforced'),
    quality: quality(1200, 80, 160, 'Condition restored scales directly with quality.'),
    runtime: runtime(
      ['repair'],
      'utility',
      'manual',
      'onAttempt',
      'inactive_continue',
      { conditionRestore: 80 },
      {},
      'Master Patch Kit consumed: restored vehicle condition.',
    ),
    market: market(false, 1200, true, true, false, true),
  }),
  [ConsumableType.FuelCell]: defineConsumable({
    id: ConsumableType.FuelCell,
    name: 'Fuel Cell',
    family: 'economy',
    shortDescription: 'Crafter-made fuel cell. Loads fuel scaled by its quality — a 130% cell carries 130 units.',
    tacticalRole: 'Vehicle Fuel',
    trigger: 'manual',
    consumePolicy: 'onAttempt',
    counterTags: ['mechanical'],
    effectRules: {},
    craftCategory: 'utility',
    uiHints: ['Loads 100 × quality fuel units through the Garage refuel path.', 'Crafted in the Workshop — the vendor sells only the flat Generic cell.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('▣', 'amber', 'cell', 'reinforced'),
    quality: quality(120, 75, 150, 'Fuel loaded scales directly with quality.'),
    runtime: runtime(
      ['repair'],
      'utility',
      'manual',
      'onAttempt',
      'inactive_continue',
      { fuelUnits: 100 },
      { fuelUnits: FULL_FLAT },
      'Fuel cell loaded into the vehicle tank.',
    ),
    market: market(false, 120, true, true, false, true),
  }),
  // Shield-Tech services (0044, brief §2.4): the Calibration Core —
  // the consumable a shield tech burns while recalibrating a shield's
  // behavior. Crafter-only on the #219 pattern: never vendor-stocked
  // in any channel; the 900 cr vendorPrice anchors buyback between
  // Field Patch Kit (400) and Master Patch Kit (1,200). One core
  // carries 2,500 calibration points at 100% quality (the capacity
  // model is owned by src/content/shieldTech.ts and read by the
  // shield-tech settlers — quality is read by the engine here).
  [ConsumableType.CalibrationCore]: defineConsumable({
    id: ConsumableType.CalibrationCore,
    name: 'Calibration Core',
    family: 'economy',
    shortDescription: 'Crafter-made shield calibration core. A shield tech burns these to re-tune a shield\u2019s behavior archetype.',
    tacticalRole: 'Shield Recalibration',
    trigger: 'manual',
    consumePolicy: 'onAttempt',
    counterTags: ['mechanical'],
    effectRules: {},
    craftCategory: 'utility',
    uiHints: ['Carries 2,500 calibration points at 100% quality — higher quality carries more.', 'Burned by shield-tech jobs; crafted in the Workshop — never sold by the vendor.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('◈', 'cyan', 'cell', 'reinforced'),
    quality: quality(900, 75, 150, 'Calibration capacity scales directly with quality.'),
    runtime: runtime(
      ['repair'],
      'utility',
      'manual',
      'onAttempt',
      'inactive_continue',
      { calibrationPoints: 2500 },
      { calibrationPoints: { mode: 'flat' } },
      'Calibration Core consumed: shield recalibration work applied.',
    ),
    market: market(false, 900, true, true, false, true),
  }),
  // ---------------------------------------------------------------------
  // Manufacturer Standing exclusives (0043). Each is craftable ONLY by a
  // hunter at rank 2+ on that manufacturer's ladder (the recipe carries
  // requiresStanding; cc_enqueue_craft_job enforces it server-side) and
  // is vendorExcluded — the vendor never stocks them at any quality.
  // Runtime effects are ordinary engine-read fields: standing grants
  // access to the recipe, never a stronger effect.
  // ---------------------------------------------------------------------
  [ConsumableType.RedlineTonic]: defineConsumable({
    id: ConsumableType.RedlineTonic,
    name: 'Redline Tonic',
    family: 'corrupted',
    shortDescription: 'Redline factory stim: a sustained damage tonic blended from Nitrocell Gel. Rank-2 Redline recipe.',
    tacticalRole: 'Sustained DPS',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['burst', 'enrage'],
    effectRules: { dpsMultiplier: 1.1 },
    craftCategory: 'offense',
    uiHints: ['Crafted at the bench by Redline rank 2+ hunters.', 'Quality scales the damage bonus.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('↯', 'red', 'syringe', 'volatile'),
    quality: quality(900, 70, 150, 'Damage bonus scales with quality.'),
    runtime: runtime(
      ['boss', 'roaming'],
      'tactical',
      'fightStart',
      'onAttempt',
      'inactive_continue',
      { dpsMultiplier: 1.1 },
      { dpsMultiplier: DELTA(1.22) },
      'Redline Tonic consumed: sustained damage up.'
    ),
    market: market(false, 900, true, true, false, true),
  }),
  [ConsumableType.HeartwoodSightOil]: defineConsumable({
    id: ConsumableType.HeartwoodSightOil,
    name: 'Heartwood Sight Oil',
    family: 'tactical',
    shortDescription: 'Ironwood lens oil pressed from Heartwood Resin — steadier aim, sharper crits. Rank-2 Ironwood recipe.',
    tacticalRole: 'Crit Focus',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['crit', 'elite'],
    effectRules: { dpsMultiplier: 1.05 },
    craftCategory: 'offense',
    uiHints: ['Crafted at the bench by Ironwood rank 2+ hunters.', 'Quality scales crit chance and the damage bonus.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('◎', 'green', 'vial'),
    quality: quality(750, 75, 150, 'Crit chance scales with quality.'),
    runtime: runtime(
      ['boss'],
      'tactical',
      'fightStart',
      'onAttempt',
      'inactive_continue',
      { critChanceBonus: 0.05, dpsMultiplier: 1.05 },
      { critChanceBonus: FULL_CHANCE(0.09), dpsMultiplier: DELTA(1.12) },
      'Heartwood Sight Oil consumed: crit focus sharpened.'
    ),
    market: market(false, 750, true, true, false, true),
  }),
  [ConsumableType.ForgeheartCharge]: defineConsumable({
    id: ConsumableType.ForgeheartCharge,
    name: 'Forgeheart Charge',
    family: 'ordnance',
    shortDescription: 'BlastForge heavy charge cast around a Forgeheart ingot core — bigger booms, better armor break. Rank-2 BlastForge recipe.',
    tacticalRole: 'Heavy Ordnance',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['armor', 'burst'],
    effectRules: { armorBreakMultiplier: 1.15 },
    craftCategory: 'offense',
    uiHints: ['Crafted at the bench by BlastForge rank 2+ hunters.', 'Quality scales ordnance damage and armor break.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('✸', 'orange', 'grenade', 'volatile'),
    quality: quality(650, 70, 150, 'Ordnance damage and armor break scale with quality.'),
    runtime: runtime(
      ['boss', 'roaming'],
      'tactical',
      'fightStart',
      'onAttempt',
      'inactive_continue',
      { ordnanceBonusDps: 25, armorBreakMultiplier: 1.15 },
      { ordnanceBonusDps: FULL_FLAT, armorBreakMultiplier: DELTA(1.3) },
      'Forgeheart Charge consumed: heavy ordnance primed.'
    ),
    market: market(false, 650, true, true, false, true),
  }),
  [ConsumableType.PrismCoating]: defineConsumable({
    id: ConsumableType.PrismCoating,
    name: 'Prism Coating',
    family: 'ammo',
    shortDescription: 'Prismatek elemental coating ground from Prism Shards — rounds bite through shields and armor alike. Rank-2 Prismatek recipe.',
    tacticalRole: 'Elemental Coating',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['shield', 'armor'],
    effectRules: { shieldBreakMultiplier: 1.12, armorBreakMultiplier: 1.12 },
    craftCategory: 'offense',
    uiHints: ['Crafted at the bench by Prismatek rank 2+ hunters.', 'Quality scales shield and armor break.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('◆', 'purple', 'rounds'),
    quality: quality(800, 75, 150, 'Shield and armor break scale with quality.'),
    runtime: runtime(
      ['boss'],
      'tactical',
      'fightStart',
      'onAttempt',
      'inactive_continue',
      { shieldBreakMultiplier: 1.12, armorBreakMultiplier: 1.12 },
      { shieldBreakMultiplier: DELTA(1.24), armorBreakMultiplier: DELTA(1.24) },
      'Prism Coating consumed: rounds coated in elemental grit.'
    ),
    market: market(false, 800, true, true, false, true),
  }),
  [ConsumableType.ThrowTechDecoyKit]: defineConsumable({
    id: ConsumableType.ThrowTechDecoyKit,
    name: 'ThrowTech Decoy Kit',
    family: 'tactical',
    shortDescription: 'ThrowTech deployable decoy: a magnetite-core mannequin that draws fire off the hunter. Rank-2 ThrowTech recipe.',
    tacticalRole: 'Decoy Deployable',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['burst', 'elite'],
    effectRules: { survivalMultiplier: 1.09 },
    craftCategory: 'utility',
    uiHints: ['Crafted at the bench by ThrowTech rank 2+ hunters.', 'Quality deepens the damage drawn off you.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('♟', 'cyan', 'beacon', 'signal'),
    quality: quality(700, 75, 150, 'Damage reduction scales with quality.'),
    runtime: runtime(
      ['boss', 'roaming'],
      'tactical',
      'fightStart',
      'onAttempt',
      'inactive_continue',
      { incomingDpsMultiplier: 0.92 },
      { incomingDpsMultiplier: INVERSE_DELTA(0.82) },
      'ThrowTech Decoy Kit deployed: fire drawn off the hunter.'
    ),
    market: market(false, 700, true, true, false, true),
  }),
  [ConsumableType.HelixCalibrationKit]: defineConsumable({
    id: ConsumableType.HelixCalibrationKit,
    name: 'Helix Calibration Kit',
    family: 'economy',
    shortDescription: 'HelixWorks bench kit: Siltglass shims and a calibration sweep that coaxes better rolls out of a win. Rank-2 HelixWorks recipe.',
    tacticalRole: 'Loot Calibration',
    trigger: 'lootRoll',
    consumePolicy: 'onVictory',
    counterTags: ['loot'],
    effectRules: { bonusLootChance: 0.2 },
    craftCategory: 'utility',
    uiHints: ['Crafted at the bench by HelixWorks rank 2+ hunters.', 'Quality scales bonus loot chance up to a cap.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    visual: visual('✦', 'blue', 'ticket', 'market'),
    quality: quality(500, 75, 150, 'Bonus loot chance scales with quality and caps at 35%.'),
    runtime: runtime(
      ['boss', 'roaming'],
      'utility',
      'lootRoll',
      'onVictory',
      'inactive_continue',
      { bonusLootChance: 0.2 },
      { bonusLootChance: FULL_CHANCE(0.35) },
      'Helix Calibration Kit consumed: loot rolls calibrated.'
    ),
    market: market(false, 500, true, true, false, true),
  }),
};

export const BOSS_PREP_CONSUMABLES = Object.values(CONSUMABLES).filter((c) => c.isBossPrepVisible);
export const VENDOR_CONSUMABLES = Object.values(CONSUMABLES).filter((c) => c.market.vendorStocked);
export const PLAYER_MARKET_CONSUMABLES = Object.values(CONSUMABLES).filter((c) => c.market.playerMarketAllowed);
export const CRAFTABLE_CONSUMABLES = Object.values(CONSUMABLES).filter((c) => c.market.craftable);

const RUNTIME_MULTIPLIER_FIELDS = new Set<keyof ConsumableRuntimeEffects>([
  'survivalMultiplier',
  'dpsMultiplier',
  'shieldBreakMultiplier',
  'armorBreakMultiplier',
  'mechanicMultiplier',
  'incomingDpsMultiplier',
  'incomingAccuracyMultiplier',
  'enemyPressureMultiplier',
  'yieldMultiplier',
  'ordnanceBoostMultiplier',
]);

function clamp(value: number, floor: number, cap: number): number {
  return Math.max(floor, Math.min(cap, value));
}

function applyScaling(value: number, qualityPercent: number, scaling?: ConsumableRuntimeEffectScaling): number {
  if (!scaling || scaling.mode === 'none') return value;
  const qualityRatio = clamp(qualityPercent, 1, 250) / 100;
  const factor = scaling.factor ?? 1;
  const effectiveRatio = 1 + (qualityRatio - 1) * factor;

  let scaled = value;
  if (scaling.mode === 'flat' || scaling.mode === 'duration' || scaling.mode === 'chance') {
    scaled = value * effectiveRatio;
  } else if (scaling.mode === 'multiplierDelta') {
    scaled = 1 + (value - 1) * effectiveRatio;
  } else if (scaling.mode === 'inverseMultiplierDelta') {
    scaled = 1 - (1 - value) * effectiveRatio;
  }

  if (scaling.cap !== undefined) scaled = Math.min(scaled, scaling.cap);
  if (scaling.floor !== undefined) scaled = Math.max(scaled, scaling.floor);
  return scaled;
}

function mergeEffects(base: ConsumableRuntimeEffects, addition: ConsumableRuntimeEffects): ConsumableRuntimeEffects {
  const next: Record<string, number> = { ...(base as Record<string, number>) };
  for (const [key, value] of Object.entries(addition)) {
    if (typeof value !== 'number') continue;
    const typedKey = key as keyof ConsumableRuntimeEffects;
    if (RUNTIME_MULTIPLIER_FIELDS.has(typedKey)) {
      next[key] = next[key] === undefined ? value : next[key] * value;
    } else {
      next[key] = (next[key] ?? 0) + value;
    }
  }
  return next as ConsumableRuntimeEffects;
}

export function getConsumableQualityBand(qualityPercent: number): string {
  if (qualityPercent >= 160) return 'Anomalous';
  if (qualityPercent >= 140) return 'Prototype';
  if (qualityPercent >= 120) return 'Superior';
  if (qualityPercent >= 106) return 'Refined';
  if (qualityPercent >= 95) return 'Standard';
  if (qualityPercent >= 85) return 'Rough';
  return 'Crude';
}

export function getConsumableRuntimeEffects(consumableId: string, qualityPercent = VENDOR_QUALITY): ConsumableRuntimeEffects {
  const def = CONSUMABLES[consumableId];
  if (!def) return {};
  const effects: Record<string, number> = {};
  const cappedQuality = clamp(qualityPercent, 1, def.quality.cap ?? 250);

  for (const [key, value] of Object.entries(def.runtime.baseEffects)) {
    if (typeof value !== 'number') continue;
    const scaling = def.runtime.qualityScaling[key as keyof ConsumableRuntimeEffects];
    effects[key] = applyScaling(value, cappedQuality, scaling);
  }

  for (const perk of def.runtime.highQualityPerks ?? []) {
    if (cappedQuality >= perk.minQuality) {
      const perkEffects = mergeEffects({}, perk.effects);
      for (const [key, value] of Object.entries(perkEffects)) {
        if (typeof value === 'number') {
          effects[key] = RUNTIME_MULTIPLIER_FIELDS.has(key as keyof ConsumableRuntimeEffects)
            ? (effects[key] === undefined ? value : effects[key] * value)
            : (effects[key] ?? 0) + value;
        }
      }
    }
  }

  return effects as ConsumableRuntimeEffects;
}

export function getConsumableRuntimeEffectTotals(
  consumableCounts: Record<string, number>,
  qualityByConsumable: Record<string, number> = {}
): ConsumableRuntimeEffects {
  return Object.entries(consumableCounts).reduce<ConsumableRuntimeEffects>((totals, [id, count]) => {
    if (count <= 0) return totals;
    const qualityPercent = qualityByConsumable[id] ?? VENDOR_QUALITY;
    const effects = getConsumableRuntimeEffects(id, qualityPercent);
    let next = totals;
    for (let i = 0; i < count; i += 1) {
      next = mergeEffects(next, effects);
    }
    return next;
  }, {});
}

export function getDpsConsumableEffectMap(qualityPercent = VENDOR_QUALITY): Record<string, number> {
  return Object.values(CONSUMABLES).reduce<Record<string, number>>((effects, def) => {
    const dpsMultiplier = getConsumableRuntimeEffects(def.id, qualityPercent).dpsMultiplier;
    if (dpsMultiplier && dpsMultiplier !== 1) {
      effects[def.id] = dpsMultiplier - 1;
    }
    return effects;
  }, {});
}

export function getConsumablesForActivity(activity: ConsumableActivityScope): ConsumableDef[] {
  return Object.values(CONSUMABLES).filter((c) => c.runtime.activityScopes.includes(activity));
}

export function getConsumablesForLayoutChannel(channel: ConsumableLayoutChannel, activity?: ConsumableActivityScope): ConsumableDef[] {
  return Object.values(CONSUMABLES).filter((c) =>
    c.runtime.layoutChannel === channel && (!activity || c.runtime.activityScopes.includes(activity))
  );
}

export function getConsumableActivityRule(consumableId: string, activity: ConsumableActivityScope): ConsumableActivityRule | undefined {
  const def = CONSUMABLES[consumableId];
  if (!def) return undefined;
  return {
    trigger: def.runtime.trigger,
    consumePolicy: def.runtime.consumePolicy,
    zeroBehavior: def.runtime.zeroBehavior,
    threshold: def.runtime.threshold,
    ...def.runtime.activityRules?.[activity],
  };
}

export function consumableLoadoutToCounts(loadout: ConsumableLoadout): Record<string, number> {
  return Object.values(loadout).reduce<Record<string, number>>((counts, id) => {
    if (!id) return counts;
    counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});
}

export function getConsumablesForSlot(_slot?: ConsumableSlot): ConsumableDef[] {
  return Object.values(CONSUMABLES);
}
