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
}

export interface ConsumableDef {
  id: string;
  name: string;
  family: ConsumableFamily;
  allowedSlots: ConsumableSlot[];
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

function market(vendorStocked: boolean, vendorPrice: number, craftable = true, playerMarketAllowed = true, rotatingVendorOnly = false): ConsumableMarketConfig {
  return {
    vendorStocked,
    vendorPrice,
    vendorQuality: VENDOR_QUALITY,
    craftable,
    playerMarketAllowed,
    rotatingVendorOnly,
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
    allowedSlots: [ConsumableSlot.Emergency],
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
    allowedSlots: [ConsumableSlot.Emergency],
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
    allowedSlots: [ConsumableSlot.Emergency],
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
      { shieldRestore: 120 },
      { shieldRestore: FULL_FLAT },
      'Shield Cell consumed: restored shield capacity.',
      {
        threshold: 0.25,
        highQualityPerks: [{ minQuality: 125, label: 'Temporary recharge acceleration.', effects: { survivalMultiplier: 1.04, repairDurationSeconds: 15 } }],
      }
    ),
    market: market(true, 300),
  }),
  [ConsumableType.NanoSwarm]: defineConsumable({
    id: ConsumableType.NanoSwarm,
    name: 'Nano Swarm',
    family: 'survival',
    allowedSlots: [ConsumableSlot.Emergency],
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
    allowedSlots: [ConsumableSlot.Emergency],
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
    allowedSlots: [ConsumableSlot.MidFight],
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
    allowedSlots: [ConsumableSlot.MidFight],
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
    allowedSlots: [ConsumableSlot.MidFight],
    shortDescription: 'Specialized rounds for armor phases and armored roaming elites.',
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
      ['roaming', 'boss'],
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
    allowedSlots: [ConsumableSlot.MidFight],
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
      { dpsMultiplier: 1.08, ammoWindowUses: 1 },
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
    allowedSlots: [ConsumableSlot.MidFight],
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
      ['roaming', 'boss'],
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
    allowedSlots: [ConsumableSlot.MidFight],
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
      ['roaming', 'boss'],
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
    allowedSlots: [ConsumableSlot.MidFight],
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
      { incomingDpsMultiplier: 0.9, ammoWindowUses: 1 },
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
    allowedSlots: [ConsumableSlot.MidFight],
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
    allowedSlots: [ConsumableSlot.PreFight, ConsumableSlot.MidFight],
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
    allowedSlots: [ConsumableSlot.PreFight, ConsumableSlot.MidFight],
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
      ['boss'],
      'ordnance',
      'shieldPhase',
      'onAttempt',
      'inactive_continue',
      { shieldBreakMultiplier: 1.15, armorBreakMultiplier: 1.15, mechanicScoreFlat: 0.04, ammoWindowUses: 0 },
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
    allowedSlots: [ConsumableSlot.MidFight],
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
      ['boss'],
      'ordnance',
      'shieldPhase',
      'onTrigger',
      'inactive_continue',
      { shieldBreakMultiplier: 1.35, mechanicReduction: 0.1, mechanicScoreFlat: 0.1 },
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
    allowedSlots: [ConsumableSlot.MidFight],
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
      ['boss'],
      'ordnance',
      'armorPhase',
      'onTrigger',
      'inactive_continue',
      { armorBreakMultiplier: 1.35, repairSuppression: 0.1, mechanicScoreFlat: 0.1 },
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
    allowedSlots: [ConsumableSlot.MidFight],
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
      ['boss'],
      'ordnance',
      'armorPhase',
      'onTrigger',
      'inactive_continue',
      { armorBreakMultiplier: 1.5, armorBypass: 0.4, mechanicScoreFlat: 0.05 },
      { armorBreakMultiplier: DELTA(1.75), armorBypass: FULL_CHANCE(0.65), mechanicScoreFlat: FULL_CHANCE(0.1) },
      'Phase Shift Grenade consumed: bypassed part of the armor phase.'
    ),
    market: market(false, 1000),
  }),
  [ConsumableType.MagnetizedPayload]: defineConsumable({
    id: ConsumableType.MagnetizedPayload,
    name: 'Magnetized Payload',
    family: 'ordnance',
    allowedSlots: [ConsumableSlot.PreFight],
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
      ['boss'],
      'ordnance',
      'fightStart',
      'onAttempt',
      'inactive_continue',
      { ordnanceBoostMultiplier: 1.2, boostedOrdnanceUses: 2, freeOrdnanceUses: 2 },
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
    allowedSlots: [ConsumableSlot.PreFight],
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
    allowedSlots: [ConsumableSlot.PreFight],
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
    allowedSlots: [ConsumableSlot.PreFight],
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
    allowedSlots: [ConsumableSlot.MidFight],
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
    allowedSlots: [ConsumableSlot.PreFight, ConsumableSlot.MidFight],
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
    allowedSlots: [ConsumableSlot.PreFight],
    shortDescription: 'Roaming event lure that increases elite/cache event chance while raising enemy pressure.',
    tacticalRole: 'Roaming Loot Risk',
    trigger: 'activityStart',
    consumePolicy: 'perInterval',
    counterTags: ['loot', 'cache', 'elite'],
    effectRules: { bonusLootChance: 0.1 },
    craftCategory: 'utility',
    uiHints: ['Roaming only.', 'Quality scales event chance; enemy pressure is an explicit drawback.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('◍', 'amber', 'beacon', 'market'),
    quality: quality(900, 70, 150, 'Event chance scales with quality and remains capped.'),
    runtime: runtime(
      ['roaming'],
      'utility',
      'activityStart',
      'perInterval',
      'inactive_continue',
      { eventChanceBonus: 0.1, ammoCoveredSeconds: 600, enemyPressureMultiplier: 1.05 },
      { eventChanceBonus: FULL_CHANCE(0.18), ammoCoveredSeconds: FULL_DURATION, enemyPressureMultiplier: { mode: 'none' } },
      'Loot Beacon consumed: increased roaming event chance and enemy pressure.',
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
    allowedSlots: [ConsumableSlot.PreFight],
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
    allowedSlots: [ConsumableSlot.PreFight],
    shortDescription: 'Victory-only utility that can add an extra boss loot roll.',
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
      ['boss'],
      'utility',
      'lootRoll',
      'onVictory',
      'inactive_continue',
      { extraLootRollChance: 0.25 },
      { extraLootRollChance: FULL_CHANCE(0.4) },
      'Data Skimmer consumed: attempted an extra victory loot roll.',
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
    allowedSlots: [ConsumableSlot.PreFight],
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
      { bonusLootChance: 0.25 },
      { bonusLootChance: FULL_CHANCE(0.4) },
      'Luck Booster consumed: improved post-success loot chance.'
    ),
    market: market(true, 350),
  }),
  [ConsumableType.SalvageContract]: defineConsumable({
    id: ConsumableType.SalvageContract,
    name: 'Salvage Contract',
    family: 'economy',
    allowedSlots: [ConsumableSlot.PreFight],
    shortDescription: 'Scrapping contract that improves scrap and material yield for a limited number of actions.',
    tacticalRole: 'Scrap Yield',
    trigger: 'scrapStart',
    consumePolicy: 'onAttempt',
    counterTags: ['salvage'],
    effectRules: {},
    craftCategory: 'utility',
    uiHints: ['Scrapping only.', 'Quality scales yield multiplier and can add rare material chance.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: false,
    visual: visual('▱', 'amber', 'contract', 'market'),
    quality: quality(700, 75, 150, 'Yield multiplier scales with quality.'),
    runtime: runtime(
      ['scrapping'],
      'utility',
      'scrapStart',
      'onAttempt',
      'inactive_continue',
      { yieldMultiplier: 1.15 },
      { yieldMultiplier: DELTA(1.3) },
      'Salvage Contract consumed: increased scrap/material yield.',
      {
        highQualityPerks: [{ minQuality: 130, label: 'Adds rare material return chance.', effects: { rareMaterialChance: 0.05 } }],
      }
    ),
    market: market(false, 700),
  }),
  [ConsumableType.WorkshopRushTicket]: defineConsumable({
    id: ConsumableType.WorkshopRushTicket,
    name: 'Workshop Rush Ticket',
    family: 'economy',
    allowedSlots: [ConsumableSlot.PreFight],
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
    allowedSlots: [ConsumableSlot.MidFight],
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

export function getConsumablesForSlot(_slot: ConsumableSlot): ConsumableDef[] {
  return BOSS_PREP_CONSUMABLES;
}
