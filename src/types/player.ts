import { WorkshopQueue } from './workshop';

export interface ConsumableBatch {
  id: string;
  consumable_type: string;
  quality_percent: number;
  quantity: number;
  origin: 'vendor' | 'crafted' | 'market' | 'reward';
  creator_user_id?: string | null;
  source_recipe_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface PlayerProfile {
  id: string;
  name: string;
  level: number;
  xp: number;
  credits: number;
  scrap: number;
  cacheKeys: number;
  cacheKeyFragments: number;
  /** Legendary core balance (0026) — server-owned, synced from the profile snapshot. */
  legendaryCores: number;
  /** Cache Rank token balance (0031) — server-owned, synced from the profile snapshot. */
  cacheRankTokens: number;
  /** Cache Rank per-track spend ranks (0031) — server-owned, synced from the profile snapshot. */
  cacheRankSpends: Record<string, number>;
  currentZoneId: string;
  highestZoneId: string;
  offlineCapHours: number;
  lastClaimTime: number;
  deathFeeInsurance: boolean;
  consumables: Record<string, number>;
  consumableBatches: ConsumableBatch[];
  materials: Record<string, number>;
  essences: Record<string, number>;
  workshopQueues: WorkshopQueue[];
  lastWorkshopTick: number;
  /** Server-authoritative tick counter — used to seed the client ticker on page load. */
  lastClaimedTick: number;
  /** Vehicle tank, in fuel units (0021). Server-side state; one Generic Fuel Cell = 100 units. */
  vehicleFuel: number;
}
