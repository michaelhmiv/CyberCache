export type ContentStatus = 'accepted' | 'deferred' | 'rejected' | 'needs_decision';
export type QualityTier = 'Crude' | 'Standard' | 'Refined' | 'Superior' | 'Prototype';
export type SupplyMode = 'player_made' | 'combat_drop' | 'npc_starter' | 'service_only' | 'account_bound';
export type MaterialTier = 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

export interface ProfessionTrack {
  id: string;
  name: string;
  role: string;
  levelCap: number;
  produces: string[];
  firstEraPolicy: string;
}

export interface MaterialDef {
  id: string;
  name: string;
  tier: MaterialTier;
  sourceTags: string[];
  usedByProfessions: string[];
}

export interface MaterialQualityDef {
  tier: QualityTier;
  materialQualityBonus: number;
  outputMultiplier: number;
  marketValueMultiplier: number;
}

export interface QualityBand {
  effectiveSkillMin: number;
  chances: Record<QualityTier, number>;
}

export interface RecipeInput {
  materialId: string;
  quantity: number;
  minimumQuality?: QualityTier;
}

export interface RecipeOutput {
  itemId: string;
  quantity: number;
  supplyMode: SupplyMode;
}

export interface RecipeDef {
  id: string;
  name: string;
  professionId: string;
  requiredProfessionLevel: number;
  recipeDifficulty: number;
  stationId: string;
  craftMinutes: number;
  actionSlot: 'crafting' | 'refining' | 'repairing' | 'service';
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
  xpReward: number;
  status: ContentStatus;
}

export interface LootEntry {
  entryId: string;
  entryType: 'material' | 'component' | 'gear' | 'legendary_core' | 'recipe_blueprint';
  weight: number;
}

export interface LootPool {
  id: string;
  name: string;
  entries: LootEntry[];
}

export interface LootRoll {
  id: string;
  chance: number;
  poolId: string;
  rolls: number;
}

export interface LootTable {
  id: string;
  sourceId: string;
  sourceType: 'roaming_area' | 'boss' | 'cache' | 'starter_store' | 'service_reward';
  rolls: LootRoll[];
}

export interface XpActionReward {
  actionId: string;
  xp: number;
  capPerDay?: number;
  notes: string;
}

export interface SimulationAssumptions {
  roamingHoursPerDay: number;
  tickSeconds: number;
  killsPerMinute: number;
  damageCreditsPerMinute: number;
  bossAttemptIntervalHours: number;
  bossWinRate: number;
  scrapsPerDay: number;
  craftsPerDay: number;
}

export interface MechanicDecision {
  id: string;
  status: ContentStatus;
  decision: string;
  reason: string;
}

export const PROFESSION_TRACKS: ProfessionTrack[] = [
  { id: 'medtech', name: 'Medtech', role: 'Creates healing and emergency survival consumables.', levelCap: 100, produces: ['medkits', 'shield cells', 'nano swarms', 'adrenaline shots'], firstEraPolicy: 'Player-made supply should outperform limited NPC starter goods.' },
  { id: 'ammo_fabrication', name: 'Ammo Fabrication', role: 'Creates elemental and tactical ammo consumables.', levelCap: 100, produces: ['shock ammo', 'corrosive ammo', 'cryo ammo', 'void ammo', 'armor-piercing ammo'], firstEraPolicy: 'Consumable output only; does not create permanent weapon power.' },
  { id: 'ordnance_engineering', name: 'Ordnance Engineering', role: 'Creates grenades, charges, payloads, and boss-prep ordnance.', levelCap: 100, produces: ['ordnance charges', 'phase-shift grenades', 'magnetized payloads'], firstEraPolicy: 'Cooldown/equipped ordnance and one-use ordnance both remain material-gated.' },
  { id: 'vehicle_mechanics', name: 'Vehicle Mechanics', role: 'Repairs vehicles and creates fuel, patch kits, and basic tune modules.', levelCap: 100, produces: ['fuel cells', 'vehicle repair kits', 'travel tune modules'], firstEraPolicy: 'Vehicles are simple travel accelerators in First Era.' },
  { id: 'refining', name: 'Refining', role: 'Converts raw drops into refined materials used by other professions.', levelCap: 100, produces: ['refined alloys', 'reagent bundles', 'stabilized components'], firstEraPolicy: 'Backbone profession for the player-made economy.' },
  { id: 'firmware_engineering', name: 'Firmware Engineering', role: 'Transfers, stabilizes, and upgrades firmware set bonuses.', levelCap: 100, produces: ['firmware transfer kits', 'firmware stabilizers'], firstEraPolicy: 'High-value service profession; cannot create boss-only firmware from nothing.' },
  { id: 'enhancement_tuning', name: 'Enhancement Tuning', role: 'Creates and improves enhancement chips for build specialization.', levelCap: 100, produces: ['manufacturer enhancements', 'element enhancements', 'boss-farm enhancements'], firstEraPolicy: 'Supports buildcraft without replacing loot drops.' },
  { id: 'shield_tech', name: 'Shield Tech', role: 'Repairs and tunes shields and shield components.', levelCap: 100, produces: ['shield cells', 'shield cores', 'shield tuning services'], firstEraPolicy: 'May improve dropped shields but should not print best-in-slot shields.' },
  { id: 'armor_fabrication', name: 'Armor Fabrication', role: 'Creates armor plates, mitigation layers, and armor repair services.', levelCap: 100, produces: ['armor plates', 'repair plating', 'anti-burst layers'], firstEraPolicy: 'Armor is CyberCache-specific mitigation and service-market depth.' },
  { id: 'gunsmithing', name: 'Gunsmithing', role: 'Restores damaged weapon cores, extracts parts, and tunes dropped weapons.', levelCap: 100, produces: ['part extraction', 'affix tuning', 'core restoration', 'legendary core binding'], firstEraPolicy: 'Cannot create infinite top-tier guns from raw materials.' },
];

export const MATERIALS: MaterialDef[] = [
  { id: 'scrap_alloy', name: 'Scrap Alloy', tier: 'T1', sourceTags: ['starter', 'roaming'], usedByProfessions: ['refining', 'medtech', 'vehicle_mechanics'] },
  { id: 'basic_reagent', name: 'Basic Reagent', tier: 'T1', sourceTags: ['organic', 'starter'], usedByProfessions: ['medtech'] },
  { id: 'weak_battery', name: 'Weak Battery', tier: 'T1', sourceTags: ['tech', 'starter'], usedByProfessions: ['ammo_fabrication', 'vehicle_mechanics'] },
  { id: 'ballistic_parts', name: 'Ballistic Parts', tier: 'T2', sourceTags: ['weapon', 'roaming'], usedByProfessions: ['ammo_fabrication', 'gunsmithing'] },
  { id: 'reactive_components', name: 'Reactive Components', tier: 'T2', sourceTags: ['ordnance', 'blastforge'], usedByProfessions: ['ordnance_engineering', 'vehicle_mechanics'] },
  { id: 'refined_reagent', name: 'Refined Reagent', tier: 'T2', sourceTags: ['crafted', 'organic'], usedByProfessions: ['medtech'] },
  { id: 'tech_fragments', name: 'Tech Fragments', tier: 'T3', sourceTags: ['tech', 'boss'], usedByProfessions: ['firmware_engineering', 'enhancement_tuning', 'shield_tech'] },
  { id: 'armor_plating', name: 'Armor Plating', tier: 'T3', sourceTags: ['armor', 'mechanical'], usedByProfessions: ['armor_fabrication', 'vehicle_mechanics'] },
  { id: 'stabilized_chemicals', name: 'Stabilized Chemicals', tier: 'T3', sourceTags: ['crafted', 'medtech'], usedByProfessions: ['medtech', 'ammo_fabrication'] },
  { id: 'void_dust', name: 'Void Dust', tier: 'T4', sourceTags: ['void', 'boss'], usedByProfessions: ['firmware_engineering', 'enhancement_tuning', 'gunsmithing'] },
  { id: 'elemental_essence', name: 'Elemental Essence', tier: 'T4', sourceTags: ['elemental', 'boss'], usedByProfessions: ['ammo_fabrication', 'enhancement_tuning', 'gunsmithing'] },
  { id: 'boss_fragment', name: 'Boss Fragment', tier: 'T4', sourceTags: ['boss'], usedByProfessions: ['gunsmithing', 'firmware_engineering', 'enhancement_tuning'] },
  { id: 'prime_core', name: 'Prime Core', tier: 'T5', sourceTags: ['elite', 'boss'], usedByProfessions: ['gunsmithing', 'firmware_engineering'] },
  { id: 'legendary_residue', name: 'Legendary Residue', tier: 'T5', sourceTags: ['legendary', 'salvage'], usedByProfessions: ['gunsmithing', 'enhancement_tuning'] },
  { id: 'calibrated_components', name: 'Calibrated Components', tier: 'T5', sourceTags: ['refined', 'elite'], usedByProfessions: ['vehicle_mechanics', 'firmware_engineering', 'armor_fabrication'] },
];

export const MATERIAL_QUALITY: MaterialQualityDef[] = [
  { tier: 'Crude', materialQualityBonus: -10, outputMultiplier: 0.85, marketValueMultiplier: 0.65 },
  { tier: 'Standard', materialQualityBonus: 0, outputMultiplier: 1, marketValueMultiplier: 1 },
  { tier: 'Refined', materialQualityBonus: 8, outputMultiplier: 1.15, marketValueMultiplier: 1.35 },
  { tier: 'Superior', materialQualityBonus: 16, outputMultiplier: 1.3, marketValueMultiplier: 1.85 },
  { tier: 'Prototype', materialQualityBonus: 28, outputMultiplier: 1.5, marketValueMultiplier: 3 },
];

export const OUTPUT_QUALITY_CURVE: QualityBand[] = [
  { effectiveSkillMin: -999, chances: { Crude: 0.6, Standard: 0.35, Refined: 0.05, Superior: 0, Prototype: 0 } },
  { effectiveSkillMin: 0, chances: { Crude: 0.35, Standard: 0.55, Refined: 0.1, Superior: 0, Prototype: 0 } },
  { effectiveSkillMin: 20, chances: { Crude: 0.15, Standard: 0.6, Refined: 0.22, Superior: 0.03, Prototype: 0 } },
  { effectiveSkillMin: 40, chances: { Crude: 0.05, Standard: 0.5, Refined: 0.35, Superior: 0.09, Prototype: 0.01 } },
  { effectiveSkillMin: 60, chances: { Crude: 0, Standard: 0.35, Refined: 0.42, Superior: 0.2, Prototype: 0.03 } },
  { effectiveSkillMin: 80, chances: { Crude: 0, Standard: 0.2, Refined: 0.4, Superior: 0.33, Prototype: 0.07 } },
  { effectiveSkillMin: 100, chances: { Crude: 0, Standard: 0.1, Refined: 0.35, Superior: 0.4, Prototype: 0.15 } },
];

export const RECIPES: RecipeDef[] = [
  { id: 'medkit_field_t1', name: 'Field Med Kit', professionId: 'medtech', requiredProfessionLevel: 1, recipeDifficulty: 5, stationId: 'chem_bench_1', craftMinutes: 5, actionSlot: 'crafting', inputs: [{ materialId: 'scrap_alloy', quantity: 2 }, { materialId: 'basic_reagent', quantity: 3 }], outputs: [{ itemId: 'field_medkit', quantity: 3, supplyMode: 'player_made' }], xpReward: 40, status: 'accepted' },
  { id: 'medkit_refined_t2', name: 'Refined Med Kit', professionId: 'medtech', requiredProfessionLevel: 15, recipeDifficulty: 22, stationId: 'chem_bench_2', craftMinutes: 20, actionSlot: 'crafting', inputs: [{ materialId: 'refined_reagent', quantity: 4, minimumQuality: 'Standard' }, { materialId: 'scrap_alloy', quantity: 3 }], outputs: [{ itemId: 'refined_medkit', quantity: 2, supplyMode: 'player_made' }], xpReward: 95, status: 'accepted' },
  { id: 'shock_ammo_t1', name: 'Shock Ammo Pack', professionId: 'ammo_fabrication', requiredProfessionLevel: 1, recipeDifficulty: 8, stationId: 'ammo_press_1', craftMinutes: 8, actionSlot: 'crafting', inputs: [{ materialId: 'weak_battery', quantity: 2 }, { materialId: 'ballistic_parts', quantity: 1 }], outputs: [{ itemId: 'shock_ammo_pack', quantity: 2, supplyMode: 'player_made' }], xpReward: 45, status: 'accepted' },
  { id: 'vehicle_patch_t1', name: 'Vehicle Patch Kit', professionId: 'vehicle_mechanics', requiredProfessionLevel: 1, recipeDifficulty: 10, stationId: 'vehicle_bay_1', craftMinutes: 12, actionSlot: 'crafting', inputs: [{ materialId: 'scrap_alloy', quantity: 4 }, { materialId: 'reactive_components', quantity: 1 }], outputs: [{ itemId: 'vehicle_patch_kit', quantity: 1, supplyMode: 'player_made' }], xpReward: 55, status: 'accepted' },
  { id: 'fuel_cell_t1', name: 'Basic Fuel Cell', professionId: 'vehicle_mechanics', requiredProfessionLevel: 1, recipeDifficulty: 6, stationId: 'vehicle_bay_1', craftMinutes: 6, actionSlot: 'crafting', inputs: [{ materialId: 'weak_battery', quantity: 1 }, { materialId: 'scrap_alloy', quantity: 1 }], outputs: [{ itemId: 'basic_fuel_cell', quantity: 2, supplyMode: 'player_made' }], xpReward: 35, status: 'accepted' },
  { id: 'legendary_core_processing_t4', name: 'Legendary Core Processing', professionId: 'gunsmithing', requiredProfessionLevel: 55, recipeDifficulty: 75, stationId: 'gunsmith_bench_4', craftMinutes: 180, actionSlot: 'service', inputs: [{ materialId: 'void_dust', quantity: 5, minimumQuality: 'Refined' }, { materialId: 'boss_fragment', quantity: 3 }, { materialId: 'elemental_essence', quantity: 2 }], outputs: [{ itemId: 'stable_legendary_core_service', quantity: 1, supplyMode: 'service_only' }], xpReward: 500, status: 'accepted' },
];

export const LOOT_POOLS: LootPool[] = [
  { id: 'starter_roaming_materials', name: 'Starter Roaming Materials', entries: [{ entryId: 'scrap_alloy', entryType: 'material', weight: 55 }, { entryId: 'basic_reagent', entryType: 'material', weight: 25 }, { entryId: 'weak_battery', entryType: 'material', weight: 20 }] },
  { id: 'tier_1_boss_materials', name: 'Tier 1 Boss Materials', entries: [{ entryId: 'ballistic_parts', entryType: 'material', weight: 40 }, { entryId: 'reactive_components', entryType: 'material', weight: 35 }, { entryId: 'boss_fragment', entryType: 'material', weight: 25 }] },
  { id: 'tier_1_dedicated_cores', name: 'Tier 1 Dedicated Cores', entries: [{ entryId: 'unstable_core_debt_collector', entryType: 'legendary_core', weight: 40 }, { entryId: 'unstable_core_warranty_void', entryType: 'legendary_core', weight: 35 }, { entryId: 'unstable_core_ricochet_gospel', entryType: 'legendary_core', weight: 25 }] },
];

export const LOOT_TABLES: LootTable[] = [
  { id: 'roaming_dustwaste_materials', sourceId: 'dustwaste_frontier', sourceType: 'roaming_area', rolls: [{ id: 'material_tick', chance: 0.08, poolId: 'starter_roaming_materials', rolls: 1 }] },
  { id: 'boss_dune_tyrant_rewards', sourceId: 'dune_tyrant', sourceType: 'boss', rolls: [{ id: 'guaranteed_boss_material', chance: 1, poolId: 'tier_1_boss_materials', rolls: 1 }, { id: 'dedicated_core', chance: 0.08, poolId: 'tier_1_dedicated_cores', rolls: 1 }] },
];

export const XP_ACTION_REWARDS: XpActionReward[] = [
  { actionId: 'roaming_tick', xp: 0.02, notes: 'Small trickle for active roaming; intentionally tiny because ticks are frequent.' },
  { actionId: 'enemy_defeated', xp: 16, notes: 'Primary roaming combat XP source.' },
  { actionId: 'damage_credit', xp: 4, notes: 'Capped resolved damage credit, not raw per-damage XP.' },
  { actionId: 'boss_attempt', xp: 250, notes: 'Granted on resolved boss attempt.' },
  { actionId: 'boss_victory', xp: 1000, notes: 'Granted on boss victory in addition to attempt XP.' },
  { actionId: 'scrap_item', xp: 3, notes: 'Small salvage XP, capped by available items and action loops.' },
  { actionId: 'craft_complete', xp: 60, notes: 'Generic production XP; recipe-specific XP still applies for professions.' },
];

export const DEFAULT_SIMULATION_ASSUMPTIONS: SimulationAssumptions = { roamingHoursPerDay: 24, tickSeconds: 3, killsPerMinute: 1, damageCreditsPerMinute: 1, bossAttemptIntervalHours: 4, bossWinRate: 0.8, scrapsPerDay: 200, craftsPerDay: 3 };

export const MECHANIC_DECISIONS: MechanicDecision[] = [
  { id: 'weapon_normal_use_durability', status: 'rejected', decision: 'Equipped weapons do not lose condition from normal use in First Era.', reason: 'Prevents maintenance friction from undermining the looter fantasy.' },
  { id: 'damaged_weapon_core_restoration', status: 'accepted', decision: 'Dropped weapon cores/components may be damaged and restored by Gunsmithing.', reason: 'Creates service-market value without making equipped weapons annoying to use.' },
  { id: 'legendary_core_processing', status: 'accepted', decision: 'Legendary cores are loot-only and can be stabilized/bound by professions.', reason: 'Preserves boss farming while allowing a player-made service economy.' },
  { id: 'vehicle_condition', status: 'accepted', decision: 'Vehicles have condition and can require player repair services.', reason: 'Travel wear is intuitive and creates recurring demand for mechanics.' },
  { id: 'one_active_productive_action', status: 'accepted', decision: 'Only one productive action progresses at a time: hunting, crafting, refining, repairing, traveling, or service work.', reason: 'Creates opportunity cost and prevents passive economy inflation.' },
  { id: 'starter_store_safety_valve', status: 'accepted', decision: 'NPC store sells limited, low-quality, non-resellable starter goods only.', reason: 'Prevents new-player lockout without replacing the player economy.' },
];

export const GAME_CONTENT = {
  professions: PROFESSION_TRACKS,
  materials: MATERIALS,
  materialQuality: MATERIAL_QUALITY,
  qualityCurve: OUTPUT_QUALITY_CURVE,
  recipes: RECIPES,
  lootPools: LOOT_POOLS,
  lootTables: LOOT_TABLES,
  xpActionRewards: XP_ACTION_REWARDS,
  simulationAssumptions: DEFAULT_SIMULATION_ASSUMPTIONS,
  mechanicDecisions: MECHANIC_DECISIONS,
} as const;
