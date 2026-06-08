import type { MaterialTier, QualityTier, SupplyMode } from './gameContent';

export type RuntimePersistence = 'static_content' | 'supabase_runtime' | 'local_preview_only';
export type ItemInstanceKind = 'weapon' | 'shield' | 'armor' | 'ordnance' | 'repkit' | 'class_mod' | 'enhancement' | 'firmware' | 'consumable' | 'material' | 'vehicle' | 'component' | 'legendary_core';
export type ItemConditionState = 'pristine' | 'worn' | 'damaged' | 'broken' | 'unstable' | 'stable' | 'bound';
export type ProductiveActionKind = 'none' | 'roaming' | 'boss_fight' | 'crafting' | 'refining' | 'repairing' | 'traveling' | 'service_work';
export type ServiceJobStatus = 'draft' | 'listed' | 'quoted' | 'accepted' | 'in_escrow' | 'active' | 'completed' | 'cancelled' | 'disputed';
export type EscrowStatus = 'none' | 'reserved' | 'locked' | 'released' | 'refunded' | 'disputed';

export interface StaticContentBoundary { category: string; persistence: RuntimePersistence; examples: string[]; rule: string; }

export interface ItemInstanceRecord {
  id: string;
  ownerUserId: string;
  kind: ItemInstanceKind;
  staticItemId?: string;
  itemLevel?: number;
  rarity?: string;
  quality?: QualityTier;
  materialTier?: MaterialTier;
  conditionState?: ItemConditionState;
  conditionCurrent?: number;
  conditionMax?: number;
  supplyMode: SupplyMode;
  sourceId?: string;
  creatorUserId?: string;
  createdAt: string;
  lockedUntil?: string;
  tradeable: boolean;
  accountBound: boolean;
  payload: Record<string, unknown>;
}

export interface PlayerProfessionState { userId: string; professionId: string; level: number; xp: number; totalCrafts: number; totalServicesCompleted: number; reputationScore: number; }
export interface ProductiveActionState { userId: string; activeAction: ProductiveActionKind; startedAt?: string; completesAt?: string; targetId?: string; notes?: string; }
export interface ServiceJobRecord { id: string; ownerUserId: string; providerUserId?: string; professionId: string; status: ServiceJobStatus; targetItemInstanceId: string; requestedServiceId: string; quotedPriceCredits?: number; quotedDurationMinutes?: number; ownerSuppliedMaterialIds: string[]; providerSuppliedMaterialIds: string[]; escrowId?: string; createdAt: string; acceptedAt?: string; completedAt?: string; }
export interface EscrowRecord { id: string; status: EscrowStatus; payerUserId: string; payeeUserId?: string; creditAmount: number; lockedItemInstanceIds: string[]; lockedMaterialInstanceIds: string[]; createdAt: string; releasedAt?: string; }
export interface MarketplaceListingRecord { id: string; sellerUserId: string; itemInstanceId: string; priceCredits: number; status: 'active' | 'sold' | 'cancelled' | 'expired'; listedAt: string; soldAt?: string; }

export interface ContentImplementationBacklogItem { id: string; priority: 'now' | 'next' | 'later'; title: string; description: string; acceptanceCriteria: string[]; }

export const CONTENT_BOUNDARIES: StaticContentBoundary[] = [
  { category: 'Static design content', persistence: 'static_content', examples: ['boss definitions', 'loot tables', 'recipe definitions', 'profession curves', 'quality curves'], rule: 'Version in GitHub as TypeScript/JSON and validate before gameplay uses it.' },
  { category: 'Runtime player state', persistence: 'supabase_runtime', examples: ['player inventory', 'profession XP', 'market listings', 'service jobs', 'escrow', 'boss attempts'], rule: 'Store in Supabase because it is player-specific, mutable, and security-sensitive.' },
  { category: 'Generated item instances', persistence: 'supabase_runtime', examples: ['specific weapon roll', 'specific material stack', 'specific unstable core', 'specific vehicle condition'], rule: 'Store as item instances with static IDs plus rolled payload data.' },
  { category: 'Documentation', persistence: 'static_content', examples: ['MECHANICS.md', 'content pipeline docs', 'agent rules'], rule: 'Documentation explains rules but must not be the source of probabilities.' },
];

export const IMPLEMENTATION_BACKLOG: ContentImplementationBacklogItem[] = [
  { id: 'content_pipeline_json_ts', priority: 'now', title: 'Create canonical content pipeline', description: 'Move spreadsheet-designed mechanics into validated TS/JSON files consumed by the app.', acceptanceCriteria: ['Static content imports from src/content without referencing Google Sheets at runtime.', 'Validation fails on duplicate IDs, missing references, invalid probabilities, and malformed recipes.', 'Future bosses/items can be added by data entry plus validation, not custom code edits.'] },
  { id: 'runtime_supabase_mapping', priority: 'now', title: 'Map content to Supabase runtime tables', description: 'Separate static game content from player-owned mutable state.', acceptanceCriteria: ['Player inventory stores item instances, not only static item IDs.', 'Profession levels, active actions, market listings, service jobs, and escrow have clear record shapes.', 'Security rules can distinguish account-bound starter goods from tradeable player-made goods.'] },
  { id: 'loot_xp_simulation', priority: 'now', title: 'Add loot and XP simulation harness', description: 'Run deterministic and Monte Carlo checks for drops, quality rolls, and progression pace.', acceptanceCriteria: ['Can simulate a loot table by ID.', 'Can estimate daily XP under stress assumptions.', 'Can validate quality roll bands and effective-skill calculations.'] },
  { id: 'ui_surface_mapping', priority: 'next', title: 'Map mechanics to UI surfaces', description: 'Define where each mechanic appears so deep systems do not become hidden math.', acceptanceCriteria: ['Each mechanic has at least one UI surface or is marked backend-only.', 'Player-facing quality/condition/tradeability are visible on item cards.', 'Service jobs and active action lock are visible before commitment.'] },
  { id: 'market_anti_abuse', priority: 'next', title: 'Define market anti-abuse checks', description: 'Design protections for alt farming, wash trading, quote spam, and starter-store flipping.', acceptanceCriteria: ['Starter-store goods are non-resellable/account-bound.', 'Escrow prevents item theft in service jobs.', 'Suspicious trades and extreme price deviations are loggable.'] },
  { id: 'new_player_bootstrap', priority: 'next', title: 'Define new-player bootstrap path', description: 'Ensure player-made economy does not lock new players out of basic survival items.', acceptanceCriteria: ['Starter store has limited account-bound basic goods.', 'First medkit, first fuel, first craft, first market purchase, and first boss attempt are guided.', 'New players can play even if the player economy is temporarily empty.'] },
];
