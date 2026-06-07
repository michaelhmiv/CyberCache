import { ConsumableLoadout, ConsumableSlot, ConsumableType } from '../types/game';

export type ConsumableFamily = 'survival' | 'ammo' | 'ordnance' | 'tactical' | 'economy' | 'corrupted';
export type ConsumableTrigger =
  | 'fightStart'
  | 'shieldPhase'
  | 'armorPhase'
  | 'bossMechanic'
  | 'survivalFailure'
  | 'victory'
  | 'defeat'
  | 'lootRoll'
  | 'manual';
export type ConsumePolicy = 'onAttempt' | 'onTrigger' | 'onVictory' | 'onDefeat' | 'ifUsed';
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
  | 'deathFee';
export type ImplementationStatus = 'implemented' | 'approximated' | 'legacy';

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

function defineConsumable(def: Omit<ConsumableDef, 'description' | 'effect' | 'category'> & {
  description?: string;
  effect?: string;
  category?: ConsumableDef['category'];
}): ConsumableDef {
  return {
    ...def,
    description: def.description || def.shortDescription,
    effect: def.effect || def.tacticalRole,
    category:
      def.category ||
      (def.family === 'survival' ? 'survival' : def.family === 'economy' || def.family === 'tactical' ? 'utility' : 'offense'),
  };
}

export const CONSUMABLES: Record<string, ConsumableDef> = {
  [ConsumableType.MedKit]: defineConsumable({
    id: ConsumableType.MedKit,
    name: 'Med Kit',
    family: 'survival',
    allowedSlots: [ConsumableSlot.Emergency],
    shortDescription: 'Basic emergency sustain when the survival check collapses.',
    tacticalRole: 'Emergency Save',
    trigger: 'survivalFailure',
    consumePolicy: 'ifUsed',
    counterTags: ['burst'],
    effectRules: { survivalFlat: 220 },
    basePrice: 250,
    craftCategory: 'survival',
    uiHints: ['Helps when the projected failure is survival.', 'Consumed when the emergency save is needed or on defeat.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: true,
  }),
  MedKitRefined: defineConsumable({
    id: 'MedKitRefined',
    name: 'Med Kit (Refined)',
    family: 'survival',
    allowedSlots: [ConsumableSlot.Emergency],
    shortDescription: 'Enhanced emergency sustain for harder boss tiers.',
    tacticalRole: 'Emergency Save',
    trigger: 'survivalFailure',
    consumePolicy: 'ifUsed',
    counterTags: ['burst', 'elite'],
    effectRules: { survivalFlat: 360 },
    basePrice: 600,
    craftCategory: 'survival',
    uiHints: ['Best when a normal Med Kit is not enough.', 'Workshop-crafted and consumed when used.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  [ConsumableType.ShieldCell]: defineConsumable({
    id: ConsumableType.ShieldCell,
    name: 'Shield Cell',
    family: 'survival',
    allowedSlots: [ConsumableSlot.Emergency],
    shortDescription: 'Emergency shield sustain for burst and shield attrition.',
    tacticalRole: 'Shield Sustain',
    trigger: 'survivalFailure',
    consumePolicy: 'ifUsed',
    counterTags: ['shield', 'burst'],
    effectRules: { survivalFlat: 260 },
    basePrice: 300,
    craftCategory: 'survival',
    uiHints: ['Best when boss damage is shield pressure rather than a DPS race.', 'Consumed when the emergency trigger fires or on defeat.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: true,
  }),
  [ConsumableType.NanoSwarm]: defineConsumable({
    id: ConsumableType.NanoSwarm,
    name: 'Nano Swarm',
    family: 'survival',
    allowedSlots: [ConsumableSlot.Emergency],
    shortDescription: 'Stronger repair cloud for sustained damage and burn pressure.',
    tacticalRole: 'Attrition Repair',
    trigger: 'survivalFailure',
    consumePolicy: 'ifUsed',
    counterTags: ['burn', 'burst'],
    effectRules: { survivalFlat: 420, survivalMultiplier: 1.04 },
    basePrice: 800,
    craftCategory: 'survival',
    uiHints: ['Best against bosses that grind you down over time.', 'Current simulator applies this as a survival buffer.'],
    implementationStatus: 'approximated',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  [ConsumableType.AdrenalineShot]: defineConsumable({
    id: ConsumableType.AdrenalineShot,
    name: 'Adrenaline Shot',
    family: 'survival',
    allowedSlots: [ConsumableSlot.Emergency],
    shortDescription: 'High-value one-time save for dangerous boss attempts.',
    tacticalRole: 'Emergency Save',
    trigger: 'survivalFailure',
    consumePolicy: 'ifUsed',
    counterTags: ['elite', 'burst'],
    effectRules: { survivalFlat: 180, survivalMultiplier: 1.16 },
    drawbackRules: { rewardMultiplier: 0.95 },
    basePrice: 1200,
    craftCategory: 'survival',
    uiHints: ['Best when you barely fail survival.', 'Powerful but expensive.'],
    implementationStatus: 'approximated',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  [ConsumableType.AmmoPack]: defineConsumable({
    id: ConsumableType.AmmoPack,
    name: 'Ammo Pack',
    family: 'ammo',
    allowedSlots: [ConsumableSlot.MidFight],
    shortDescription: 'Legacy sustained DPS consumable kept for old save compatibility.',
    tacticalRole: 'Legacy DPS',
    trigger: 'manual',
    consumePolicy: 'onAttempt',
    counterTags: ['enrage'],
    effectRules: { dpsMultiplier: 1.05, ammoWindowUses: 1 },
    basePrice: 150,
    craftCategory: 'offense',
    uiHints: ['Use Target Painter or Void Ammo for tactical V2 boss prep.'],
    implementationStatus: 'legacy',
    isBossPrepVisible: false,
    isVendorStocked: true,
  }),
  ArmorPiercingAmmo: defineConsumable({
    id: 'ArmorPiercingAmmo',
    name: 'Armor-Piercing Ammo',
    family: 'ammo',
    allowedSlots: [ConsumableSlot.MidFight],
    shortDescription: 'Workshop ammo for armored targets.',
    tacticalRole: 'Armor Break',
    trigger: 'armorPhase',
    consumePolicy: 'onTrigger',
    counterTags: ['armor'],
    effectRules: { armorBreakMultiplier: 1.25, ammoWindowUses: 1 },
    basePrice: 400,
    craftCategory: 'offense',
    uiHints: ['Best against armored bosses before Corrosive Ammo is available.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  IncendiaryAmmo: defineConsumable({
    id: 'IncendiaryAmmo',
    name: 'Incendiary Ammo',
    family: 'ammo',
    allowedSlots: [ConsumableSlot.MidFight],
    shortDescription: 'Burn ammo for extra sustained boss damage.',
    tacticalRole: 'Burn DPS',
    trigger: 'manual',
    consumePolicy: 'onTrigger',
    counterTags: ['burn', 'elite'],
    effectRules: { dpsMultiplier: 1.08, ammoWindowUses: 1 },
    basePrice: 450,
    craftCategory: 'offense',
    uiHints: ['Best when a fight is close on DPS and the boss does not resist fire.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  [ConsumableType.ShockAmmo]: defineConsumable({
    id: ConsumableType.ShockAmmo,
    name: 'Shock Ammo',
    family: 'ammo',
    allowedSlots: [ConsumableSlot.MidFight],
    shortDescription: 'Focused shield-break ammo for shield-heavy bosses.',
    tacticalRole: 'Shield Break',
    trigger: 'shieldPhase',
    consumePolicy: 'onTrigger',
    counterTags: ['shield'],
    effectRules: { shieldBreakMultiplier: 1.3, ammoWindowUses: 1 },
    basePrice: 450,
    craftCategory: 'offense',
    uiHints: ['Best against shield-heavy bosses.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  [ConsumableType.CorrosiveAmmo]: defineConsumable({
    id: ConsumableType.CorrosiveAmmo,
    name: 'Corrosive Ammo',
    family: 'ammo',
    allowedSlots: [ConsumableSlot.MidFight],
    shortDescription: 'Armor-break ammo that also helps against repair mechanics.',
    tacticalRole: 'Armor Break',
    trigger: 'armorPhase',
    consumePolicy: 'onTrigger',
    counterTags: ['armor', 'repair'],
    effectRules: { armorBreakMultiplier: 1.3, mechanicFlat: 0.08, ammoWindowUses: 1 },
    basePrice: 450,
    craftCategory: 'offense',
    uiHints: ['Best against armor and repair bosses.', 'Repair counter is represented through mechanic score.'],
    implementationStatus: 'approximated',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  CryoAmmo: defineConsumable({
    id: 'CryoAmmo',
    name: 'Cryo Ammo',
    family: 'ammo',
    allowedSlots: [ConsumableSlot.MidFight],
    shortDescription: 'Slows boss pressure to improve survivability.',
    tacticalRole: 'Survival Control',
    trigger: 'manual',
    consumePolicy: 'onTrigger',
    counterTags: ['burst'],
    effectRules: { survivalMultiplier: 1.15, ammoWindowUses: 1 },
    basePrice: 450,
    craftCategory: 'offense',
    uiHints: ['Best when survival is close but Emergency is reserved for a save.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  [ConsumableType.VoidAmmo]: defineConsumable({
    id: ConsumableType.VoidAmmo,
    name: 'Void Ammo',
    family: 'corrupted',
    allowedSlots: [ConsumableSlot.MidFight],
    shortDescription: 'Risky damage spike when DPS is the projected failure.',
    tacticalRole: 'High-Risk DPS',
    trigger: 'manual',
    consumePolicy: 'onAttempt',
    counterTags: ['enrage', 'elite'],
    effectRules: { dpsMultiplier: 1.22, ammoWindowUses: 1 },
    drawbackRules: { survivalMultiplier: 0.9 },
    basePrice: 700,
    craftCategory: 'offense',
    uiHints: ['Best against DPS races and enrage bosses.', 'Reduces survival stability.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  [ConsumableType.Grenade]: defineConsumable({
    id: ConsumableType.Grenade,
    name: 'Ordnance Charge',
    family: 'ordnance',
    allowedSlots: [ConsumableSlot.PreFight, ConsumableSlot.MidFight],
    shortDescription: 'Vendor ordnance for shield, armor, and stagger checks.',
    tacticalRole: 'Burst Break',
    trigger: 'shieldPhase',
    consumePolicy: 'onAttempt',
    counterTags: ['shield', 'armor', 'burst'],
    effectRules: { shieldBreakMultiplier: 1.15, armorBreakMultiplier: 1.15, mechanicFlat: 0.04, freeOrdnanceUses: 1 },
    basePrice: 400,
    craftCategory: 'offense',
    uiHints: ['Best when either break score is the projected failure.', 'Uses the legacy Grenade ID for save compatibility.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: true,
  }),
  OrdnanceCharge: defineConsumable({
    id: 'OrdnanceCharge',
    name: 'Ordnance Charge',
    family: 'ordnance',
    allowedSlots: [ConsumableSlot.PreFight, ConsumableSlot.MidFight],
    shortDescription: 'Crafted ordnance burst for shield, armor, and stagger checks.',
    tacticalRole: 'Burst Break',
    trigger: 'shieldPhase',
    consumePolicy: 'onAttempt',
    counterTags: ['shield', 'armor', 'burst'],
    effectRules: { shieldBreakMultiplier: 1.15, armorBreakMultiplier: 1.15, mechanicFlat: 0.04, freeOrdnanceUses: 1 },
    basePrice: 400,
    craftCategory: 'offense',
    uiHints: ['Best when either break score is the projected failure.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  OverchargeStim: defineConsumable({
    id: 'OverchargeStim',
    name: 'Overcharge Stim',
    family: 'corrupted',
    allowedSlots: [ConsumableSlot.PreFight],
    shortDescription: 'Pre-fight burst injection for short damage checks.',
    tacticalRole: 'Burst DPS',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['burst', 'enrage'],
    effectRules: { dpsMultiplier: 1.12 },
    basePrice: 800,
    craftCategory: 'offense',
    uiHints: ['Best when a boss narrowly survives the DPS window.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: false,
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
    counterTags: ['enrage', 'elite'],
    effectRules: { dpsMultiplier: 1.15 },
    basePrice: 600,
    craftCategory: 'offense',
    uiHints: ['Best against DPS races and enrage bosses.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  PhaseShiftGrenade: defineConsumable({
    id: 'PhaseShiftGrenade',
    name: 'Phase Shift Grenade',
    family: 'ordnance',
    allowedSlots: [ConsumableSlot.MidFight],
    shortDescription: 'Bypasses armor pressure during a short phase window.',
    tacticalRole: 'Armor Phase',
    trigger: 'armorPhase',
    consumePolicy: 'onTrigger',
    counterTags: ['armor', 'phase'],
    effectRules: { armorBreakMultiplier: 1.5, mechanicFlat: 0.05 },
    basePrice: 1000,
    craftCategory: 'offense',
    uiHints: ['Best against armor phase bosses.'],
    implementationStatus: 'approximated',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  [ConsumableType.BossScanner]: defineConsumable({
    id: ConsumableType.BossScanner,
    name: 'Boss Scanner',
    family: 'tactical',
    allowedSlots: [ConsumableSlot.PreFight],
    shortDescription: 'Intel pass that clarifies likely failure and counter recommendations.',
    tacticalRole: 'Boss Intel',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['phase', 'elite'],
    effectRules: { recommendationIntel: 1, mechanicFlat: 0.04 },
    basePrice: 600,
    craftCategory: 'utility',
    uiHints: ['Best against unknown bosses and phase mechanics.', 'Does not reveal a full event timeline yet.'],
    implementationStatus: 'approximated',
    isBossPrepVisible: true,
    isVendorStocked: true,
  }),
  [ConsumableType.Jammer]: defineConsumable({
    id: ConsumableType.Jammer,
    name: 'Jammer',
    family: 'tactical',
    allowedSlots: [ConsumableSlot.MidFight],
    shortDescription: 'Countermeasure for one boss mechanic window.',
    tacticalRole: 'Mechanic Counter',
    trigger: 'bossMechanic',
    consumePolicy: 'onTrigger',
    counterTags: ['enrage', 'phase', 'repair'],
    effectRules: { mechanicMultiplier: 1.2, mechanicFlat: 0.12 },
    basePrice: 750,
    craftCategory: 'utility',
    uiHints: ['Best against enrage, phase, shield regen, and armor repair mechanics.', 'Current simulator applies this through mechanic score.'],
    implementationStatus: 'approximated',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  MagnetizedPayload: defineConsumable({
    id: 'MagnetizedPayload',
    name: 'Magnetized Payload',
    family: 'ordnance',
    allowedSlots: [ConsumableSlot.PreFight],
    shortDescription: 'Pre-fight ordnance loader for extra burst windows.',
    tacticalRole: 'Ordnance Support',
    trigger: 'fightStart',
    consumePolicy: 'onAttempt',
    counterTags: ['shield', 'armor', 'burst'],
    effectRules: { freeOrdnanceUses: 2 },
    basePrice: 650,
    craftCategory: 'utility',
    uiHints: ['Best when ordnance is your strongest break tool.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  [ConsumableType.InsuranceToken]: defineConsumable({
    id: ConsumableType.InsuranceToken,
    name: 'Insurance Token',
    family: 'economy',
    allowedSlots: [ConsumableSlot.PreFight],
    shortDescription: 'Reduces the credit death fee on failed boss attempts.',
    tacticalRole: 'Death Fee Cover',
    trigger: 'defeat',
    consumePolicy: 'onDefeat',
    counterTags: ['deathFee', 'elite'],
    effectRules: { deathFeeReduction: 0.5 },
    basePrice: 800,
    craftCategory: 'utility',
    uiHints: ['Best for risky first attempts.', 'Consumed only on defeat.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: true,
  }),
  [ConsumableType.DataSkimmer]: defineConsumable({
    id: ConsumableType.DataSkimmer,
    name: 'Data Skimmer',
    family: 'economy',
    allowedSlots: [ConsumableSlot.PreFight],
    shortDescription: 'Victory utility that can add a bonus boss loot roll.',
    tacticalRole: 'Loot Risk',
    trigger: 'lootRoll',
    consumePolicy: 'onVictory',
    counterTags: ['loot'],
    effectRules: { extraLootRollChance: 0.25 },
    basePrice: 900,
    craftCategory: 'utility',
    uiHints: ['Best for farmable bosses.', 'Consumes on victory when the loot roll is reached.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: false,
  }),
  [ConsumableType.LuckBooster]: defineConsumable({
    id: ConsumableType.LuckBooster,
    name: 'Luck Booster',
    family: 'economy',
    allowedSlots: [ConsumableSlot.PreFight],
    shortDescription: 'Improves bonus boss loot chance on victory.',
    tacticalRole: 'Loot Quality',
    trigger: 'lootRoll',
    consumePolicy: 'onVictory',
    counterTags: ['loot'],
    effectRules: { bonusLootChance: 0.25 },
    basePrice: 350,
    craftCategory: 'utility',
    uiHints: ['Best when the fight is already farmable.', 'Does not increase win chance.'],
    implementationStatus: 'implemented',
    isBossPrepVisible: true,
    isVendorStocked: true,
  }),
  [ConsumableType.ElementalCoating]: defineConsumable({
    id: ConsumableType.ElementalCoating,
    name: 'Elemental Coating',
    family: 'ammo',
    allowedSlots: [ConsumableSlot.MidFight],
    shortDescription: 'Legacy elemental buff kept for old save compatibility.',
    tacticalRole: 'Legacy Element',
    trigger: 'manual',
    consumePolicy: 'onAttempt',
    counterTags: ['shield', 'armor'],
    effectRules: { shieldBreakMultiplier: 1.08, armorBreakMultiplier: 1.08 },
    basePrice: 500,
    craftCategory: 'legacy',
    uiHints: ['Legacy item. Use Shock Ammo or Corrosive Ammo for V2 boss prep.'],
    implementationStatus: 'legacy',
    isBossPrepVisible: false,
    isVendorStocked: true,
  }),
};

export const BOSS_PREP_CONSUMABLES = Object.values(CONSUMABLES).filter((c) => c.isBossPrepVisible);
export const VENDOR_CONSUMABLES = Object.values(CONSUMABLES).filter((c) => c.isVendorStocked);

export function consumableLoadoutToCounts(loadout: ConsumableLoadout): Record<string, number> {
  return Object.values(loadout).reduce<Record<string, number>>((counts, id) => {
    if (!id) return counts;
    counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});
}

export function getConsumablesForSlot(slot: ConsumableSlot): ConsumableDef[] {
  return BOSS_PREP_CONSUMABLES.filter((c) => c.allowedSlots.includes(slot));
}
