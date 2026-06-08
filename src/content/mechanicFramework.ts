import type { ContentStatus, QualityTier, SupplyMode } from './gameContent';
import type { ProductiveActionKind } from './runtimeModel';

export type GearSlotId = 'primary_weapon' | 'secondary_weapon' | 'heavy_weapon' | 'shield' | 'armor' | 'ordnance' | 'repkit' | 'class_mod' | 'enhancement' | 'vehicle';
export type UiSurfaceId = 'fight_screen' | 'boss_prep' | 'inventory' | 'item_detail' | 'market' | 'workshop' | 'profession_screen' | 'service_jobs' | 'shop_profile' | 'vehicle_screen' | 'starter_store' | 'admin_economy';

export interface GearSlotRule { id: GearSlotId; displayName: string; role: string; primaryVarianceLayers: string[]; firstEraPolicy: string; }
export interface StarterStoreItem { id: string; itemId: string; displayName: string; quality: QualityTier; dailyLimit: number; priceCredits: number; supplyMode: SupplyMode; accountBound: boolean; resellable: boolean; reason: string; }
export interface VehicleClassDef { id: string; displayName: string; unlockLevel: number; travelSpeedMultiplier: number; fuelUseMultiplier: number; conditionLossMultiplier: number; role: string; firstEraScope: string; }
export interface ActionSlotRule { id: ProductiveActionKind; consumesActiveSlot: boolean; canRunWhileOffline: boolean; examples: string[]; rule: string; }
export interface ServiceMarketRule { id: string; status: ContentStatus; rule: string; implementationNote: string; }
export interface CoreProcessingRule { id: string; sourceState: 'damaged' | 'broken' | 'unstable' | 'stable'; resultState: 'stable' | 'bound'; professionId: string; minimumProfessionLevel: number; qualitySensitive: boolean; canCreateFromScratch: boolean; rule: string; }
export interface DurabilityPolicy { id: string; targetKind: string; firstEraStatus: ContentStatus; conditionLossSource: string; playerImpact: string; repairPath: string; }
export interface GunsmithingBoundaryRule { id: string; allowed: boolean; serviceName: string; rule: string; }
export interface UiSurfaceMapping { mechanicId: string; surfaceId: UiSurfaceId; playerFacingFields: string[]; requiredBeforeImplementation: boolean; }
export interface MarketControlRule { id: string; risk: string; mitigation: string; requiredData: string[]; }

export const GEAR_SLOT_RULES: GearSlotRule[] = [
  { id: 'primary_weapon', displayName: 'Primary Weapon', role: 'Main damage source for roaming and boss checks.', primaryVarianceLayers: ['weapon type', 'manufacturer', 'element', 'rarity', 'item level', 'parts', 'affixes', 'legendary effect'], firstEraPolicy: 'Combat-dropped; players may tune or modify but not freely create top-tier weapons.' },
  { id: 'secondary_weapon', displayName: 'Secondary Weapon', role: 'Backup damage profile and counter coverage.', primaryVarianceLayers: ['weapon type', 'manufacturer', 'element', 'item level', 'affixes'], firstEraPolicy: 'Combat-dropped; contributes secondary simulator value.' },
  { id: 'heavy_weapon', displayName: 'Heavy Weapon', role: 'Burst, boss break, or heavy utility profile.', primaryVarianceLayers: ['heavy behavior', 'cooldown window', 'element', 'break tags'], firstEraPolicy: 'Combat-dropped; not a player-made consumable.' },
  { id: 'shield', displayName: 'Shield', role: 'Rechargeable defense and build-effect layer.', primaryVarianceLayers: ['capacity', 'recharge', 'mitigation', 'break effect', 'full-shield effect', 'firmware'], firstEraPolicy: 'Combat-dropped or tuned by Shield Tech; should be visible in boss prep.' },
  { id: 'armor', displayName: 'Armor', role: 'CyberCache-specific mitigation and anti-burst layer.', primaryVarianceLayers: ['mitigation', 'condition', 'resistance', 'repair plating', 'boss counter tags'], firstEraPolicy: 'Accepted as a defensive axis distinct from shields.' },
  { id: 'ordnance', displayName: 'Ordnance', role: 'Cooldown or consumable burst utility for boss phases.', primaryVarianceLayers: ['payload type', 'cooldown', 'charge count', 'break tags', 'area behavior'], firstEraPolicy: 'Equipped ordnance and player-made ordnance consumables remain separate concepts.' },
  { id: 'repkit', displayName: 'Repkit', role: 'Persistent healing/recovery gear distinct from one-use medkits.', primaryVarianceLayers: ['heal amount', 'cooldown', 'trigger condition', 'secondary restore effect'], firstEraPolicy: 'Model as gear later; medkits cover initial consumable loop.' },
  { id: 'class_mod', displayName: 'Class Mod', role: 'Build-tag and skill-tree amplifier.', primaryVarianceLayers: ['tree bonus', 'node boosts', 'build tags', 'affixes'], firstEraPolicy: 'Supports build identity; should not be just generic stat power.' },
  { id: 'enhancement', displayName: 'Enhancement', role: 'Build-tuning slot targeting manufacturer, element, part, or boss-farm synergy.', primaryVarianceLayers: ['target family', 'trigger', 'stat payload', 'compatibility'], firstEraPolicy: 'Useful long-term buildcraft, but should be added after core combat loop is stable.' },
  { id: 'vehicle', displayName: 'Vehicle', role: 'Travel-speed and light maintenance layer.', primaryVarianceLayers: ['class', 'speed', 'fuel use', 'condition', 'repair difficulty'], firstEraPolicy: 'Keep to roughly six vehicle classes and avoid deep vehicle RPG scope initially.' },
];

export const STARTER_STORE_ITEMS: StarterStoreItem[] = [
  { id: 'starter_field_medkit', itemId: 'field_medkit_npc', displayName: 'Starter Field Med Kit', quality: 'Crude', dailyLimit: 6, priceCredits: 60, supplyMode: 'npc_starter', accountBound: true, resellable: false, reason: 'Prevents new-player survival lockout before the player economy has supply.' },
  { id: 'starter_shield_cell', itemId: 'shield_cell_npc', displayName: 'Starter Shield Cell', quality: 'Crude', dailyLimit: 4, priceCredits: 75, supplyMode: 'npc_starter', accountBound: true, resellable: false, reason: 'Starter safety valve; player-made versions should be better value and quality.' },
  { id: 'starter_ammo_pack', itemId: 'ammo_pack_npc', displayName: 'Starter Ammo Pack', quality: 'Crude', dailyLimit: 4, priceCredits: 55, supplyMode: 'npc_starter', accountBound: true, resellable: false, reason: 'Keeps early boss attempts possible even when the player market is empty.' },
  { id: 'starter_basic_fuel_cell', itemId: 'basic_fuel_cell_npc', displayName: 'Starter Basic Fuel Cell', quality: 'Crude', dailyLimit: 3, priceCredits: 40, supplyMode: 'npc_starter', accountBound: true, resellable: false, reason: 'Allows early travel without undermining Vehicle Mechanics supply.' },
];

export const VEHICLE_CLASSES_FIRST_ERA: VehicleClassDef[] = [
  { id: 'scrap_bike', displayName: 'Scrap Bike', unlockLevel: 1, travelSpeedMultiplier: 1.15, fuelUseMultiplier: 0.8, conditionLossMultiplier: 1.1, role: 'Starter mobility.', firstEraScope: 'Simple speed boost with low fuel use and low durability.' },
  { id: 'dune_buggy', displayName: 'Dune Buggy', unlockLevel: 8, travelSpeedMultiplier: 1.35, fuelUseMultiplier: 1, conditionLossMultiplier: 1, role: 'General roaming travel.', firstEraScope: 'Baseline midgame vehicle.' },
  { id: 'utility_rover', displayName: 'Utility Rover', unlockLevel: 18, travelSpeedMultiplier: 1.25, fuelUseMultiplier: 0.9, conditionLossMultiplier: 0.85, role: 'Balanced farming and reliability.', firstEraScope: 'Good for longer trips with reduced maintenance.' },
  { id: 'cargo_hauler', displayName: 'Cargo Hauler', unlockLevel: 28, travelSpeedMultiplier: 1.1, fuelUseMultiplier: 1.2, conditionLossMultiplier: 0.95, role: 'Material farming support.', firstEraScope: 'Cargo effects can stay deferred; use travel modifier initially.' },
  { id: 'armored_crawler', displayName: 'Armored Crawler', unlockLevel: 42, travelSpeedMultiplier: 1.05, fuelUseMultiplier: 1.35, conditionLossMultiplier: 0.6, role: 'Dangerous-zone reliability.', firstEraScope: 'Slow but durable; reduces future travel-risk penalties.' },
  { id: 'relay_skimmer', displayName: 'Relay Skimmer', unlockLevel: 60, travelSpeedMultiplier: 1.6, fuelUseMultiplier: 1.5, conditionLossMultiplier: 1.25, role: 'Fast advanced scouting.', firstEraScope: 'High speed, high operating cost.' },
];

export const ACTION_SLOT_RULES: ActionSlotRule[] = [
  { id: 'none', consumesActiveSlot: false, canRunWhileOffline: true, examples: ['idle'], rule: 'No productive output is progressing.' },
  { id: 'roaming', consumesActiveSlot: true, canRunWhileOffline: true, examples: ['highest unlocked area farming'], rule: 'Player cannot craft, repair, refine, travel, or perform service work while roaming progresses.' },
  { id: 'boss_fight', consumesActiveSlot: true, canRunWhileOffline: false, examples: ['intentional boss attempt'], rule: 'Boss fights are resolved events and should lock conflicting productive work during the attempt.' },
  { id: 'crafting', consumesActiveSlot: true, canRunWhileOffline: true, examples: ['medkit batch', 'ammo pack batch'], rule: 'Crafting progress occupies the productive action slot.' },
  { id: 'refining', consumesActiveSlot: true, canRunWhileOffline: true, examples: ['raw scrap to refined alloy'], rule: 'Refining competes directly with hunting and crafting.' },
  { id: 'repairing', consumesActiveSlot: true, canRunWhileOffline: true, examples: ['vehicle patch', 'armor repair'], rule: 'Repair work occupies the productive action slot whether self-owned or service work.' },
  { id: 'traveling', consumesActiveSlot: true, canRunWhileOffline: true, examples: ['move to region', 'vehicle travel'], rule: 'Travel occupies the slot and may consume fuel/condition.' },
  { id: 'service_work', consumesActiveSlot: true, canRunWhileOffline: true, examples: ['repair quote job', 'core processing job'], rule: 'Accepted shop jobs only progress while active in the provider queue.' },
];

export const SERVICE_MARKET_RULES: ServiceMarketRule[] = [
  { id: 'bid_flow', status: 'accepted', rule: 'Owners may list damaged or unstable items as service requests and providers may bid.', implementationNote: 'Requires service job record, bid/quote UI, and escrow acceptance.' },
  { id: 'quote_flow', status: 'accepted', rule: 'Owners may request a quote from a specific shop/provider.', implementationNote: 'Requires shop profile and provider queue visibility.' },
  { id: 'escrow_required', status: 'accepted', rule: 'Accepted service jobs lock target item, payment, and supplied materials until completion or cancellation.', implementationNote: 'Prevents unsafe service handoffs and quote abuse.' },
  { id: 'one_active_service_job', status: 'accepted', rule: 'A provider may queue multiple jobs, but only one job progresses per active action slot.', implementationNote: 'Queue upgrades can be deferred; default is one active bay.' },
];

export const CORE_PROCESSING_RULES: CoreProcessingRule[] = [
  { id: 'damaged_weapon_core_restore', sourceState: 'damaged', resultState: 'stable', professionId: 'gunsmithing', minimumProfessionLevel: 10, qualitySensitive: true, canCreateFromScratch: false, rule: 'Restores a dropped damaged weapon core into a usable component or weapon base.' },
  { id: 'broken_component_repair', sourceState: 'broken', resultState: 'stable', professionId: 'refining', minimumProfessionLevel: 15, qualitySensitive: true, canCreateFromScratch: false, rule: 'Repairs broken components into usable crafting inputs with quality based on effective skill.' },
  { id: 'unstable_legendary_core_processing', sourceState: 'unstable', resultState: 'stable', professionId: 'gunsmithing', minimumProfessionLevel: 55, qualitySensitive: true, canCreateFromScratch: false, rule: 'Converts loot-only unstable legendary effect cores into stable socket/binding components.' },
  { id: 'legendary_core_binding', sourceState: 'stable', resultState: 'bound', professionId: 'gunsmithing', minimumProfessionLevel: 65, qualitySensitive: true, canCreateFromScratch: false, rule: 'Binds a stable legendary core to an eligible dropped weapon base.' },
];

export const DURABILITY_POLICIES: DurabilityPolicy[] = [
  { id: 'weapon_use_durability', targetKind: 'equipped_weapon', firstEraStatus: 'rejected', conditionLossSource: 'none', playerImpact: 'No normal-use weapon breakage.', repairPath: 'Use damaged-core restoration instead of equipped weapon repairs.' },
  { id: 'vehicle_condition', targetKind: 'vehicle', firstEraStatus: 'accepted', conditionLossSource: 'travel time, vehicle class, zone danger', playerImpact: 'Low condition can slow or block vehicle travel until patched.', repairPath: 'Vehicle Mechanics service job or self repair.' },
  { id: 'armor_condition', targetKind: 'armor', firstEraStatus: 'deferred', conditionLossSource: 'boss damage and armor-break mechanics', playerImpact: 'Potential mitigation loss if later accepted.', repairPath: 'Armor Fabrication repair service.' },
  { id: 'shield_condition', targetKind: 'shield', firstEraStatus: 'deferred', conditionLossSource: 'EMP/break events only if accepted', playerImpact: 'Avoid broad shield maintenance until UX is proven.', repairPath: 'Shield Tech tuning/repair service.' },
];

export const GUNSMITHING_BOUNDARIES: GunsmithingBoundaryRule[] = [
  { id: 'extract_parts', allowed: true, serviceName: 'Part Extraction', rule: 'Can extract parts from eligible dropped/scrapped weapons with material loss and quality variance.' },
  { id: 'reroll_one_affix', allowed: true, serviceName: 'Affix Tuning', rule: 'Can reroll or tune one affix within rarity/item-level caps.' },
  { id: 'improve_roll_quality', allowed: true, serviceName: 'Calibration', rule: 'Can improve roll quality within a cap; cannot make low-level items endgame-viable.' },
  { id: 'restore_damaged_core', allowed: true, serviceName: 'Core Restoration', rule: 'Can restore damaged/broken weapon cores that dropped from combat or bosses.' },
  { id: 'process_legendary_core', allowed: true, serviceName: 'Legendary Core Processing', rule: 'Can process loot-only unstable legendary cores; cannot create legendary cores from raw materials.' },
  { id: 'create_top_tier_weapon', allowed: false, serviceName: 'Full Weapon Creation', rule: 'Rejected for First Era because it risks oversupply and weakens the loot chase.' },
];

export const UI_SURFACE_MAPPINGS: UiSurfaceMapping[] = [
  { mechanicId: 'quality_tier', surfaceId: 'item_detail', playerFacingFields: ['quality', 'effect multiplier', 'creator'], requiredBeforeImplementation: true },
  { mechanicId: 'starter_store_safety_valve', surfaceId: 'starter_store', playerFacingFields: ['daily limit', 'account-bound', 'non-resellable'], requiredBeforeImplementation: true },
  { mechanicId: 'one_active_productive_action', surfaceId: 'workshop', playerFacingFields: ['active action', 'time remaining', 'blocked actions'], requiredBeforeImplementation: true },
  { mechanicId: 'service_jobs', surfaceId: 'service_jobs', playerFacingFields: ['job status', 'escrow status', 'quote', 'queue position'], requiredBeforeImplementation: true },
  { mechanicId: 'vehicle_condition', surfaceId: 'vehicle_screen', playerFacingFields: ['condition', 'fuel', 'travel speed', 'repair need'], requiredBeforeImplementation: true },
  { mechanicId: 'loot_table_odds', surfaceId: 'boss_prep', playerFacingFields: ['dedicated source', 'possible materials', 'possible cores'], requiredBeforeImplementation: false },
  { mechanicId: 'market_supply_mode', surfaceId: 'market', playerFacingFields: ['player-made', 'combat drop', 'account-bound', 'service-only'], requiredBeforeImplementation: true },
];

export const MARKET_CONTROL_RULES: MarketControlRule[] = [
  { id: 'starter_store_flipping', risk: 'NPC starter goods entering the player market.', mitigation: 'Starter goods are account-bound and non-resellable.', requiredData: ['supplyMode', 'accountBound', 'tradeable'] },
  { id: 'service_item_handoff', risk: 'Unsafe service handoffs for repair or processing jobs.', mitigation: 'Service jobs require escrow-locked target items and release rules.', requiredData: ['escrowId', 'lockedItemInstanceIds', 'serviceJobStatus'] },
  { id: 'wash_trading', risk: 'Users creating unreliable price history through related-account trades.', mitigation: 'Log buyer/seller, price deviation, account age, and repeated counterparties.', requiredData: ['buyerUserId', 'sellerUserId', 'priceCredits', 'marketHistory'] },
  { id: 'quote_spam', risk: 'Players flooding high-level shops with low-value quote requests.', mitigation: 'Rate-limit quote requests and allow shops to set minimum job value.', requiredData: ['requesterUserId', 'shopId', 'createdAt', 'quotedPriceCredits'] },
  { id: 'passive_production_inflation', risk: 'Players producing goods while also hunting or repairing.', mitigation: 'One productive action slot; queues do not progress unless active.', requiredData: ['activeAction', 'startedAt', 'completesAt'] },
];
