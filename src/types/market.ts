import { GearItem } from './items';
import type { MarketCategory } from '@/lib/market/identityKey';

export interface MarketFilter {
  rarity?: string[];
  levelMin?: number;
  levelMax?: number;
  weaponType?: string[];
  manufacturer?: string[];
  element?: string[];
  rollQualityMin?: number;
  rollQualityMax?: number;
  priceMin?: number;
  priceMax?: number;
  affixes?: string[];
  legendaryEffect?: string[];
  sourceTag?: string[];
  sortBy: 'price' | 'rollQuality' | 'power' | 'newest' | 'rarity' | 'level';
  sortDir: 'asc' | 'desc';
}

export type ListingKind = 'gear' | 'consumable' | 'material' | 'fragment' | 'core' | 'essence';

export interface Listing {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerType: 'player' | 'npc';
  /** Market depth (0019): gear listings carry an item; consumable and
   * material listings carry an escrowed stack instead. */
  kind: ListingKind;
  /** Gear listings: the item id. Null for stack listings. */
  itemId: string | null;
  /** Gear listings: the serialized item. Null for stack listings. */
  itemSnapshot: GearItem | null;
  category: MarketCategory | null;
  displayName: string;
  /** Stack size (1 for gear). */
  quantity: number;
  /** Consumable listings: the batch quality %. Null otherwise. */
  qualityPercent: number | null;
  consumableType: string | null;
  materialId: string | null;
  /** Essence listings (0050): the essence type id. Null otherwise. */
  essenceId: string | null;
  /** Price-history identity key (src/lib/market/identityKey.ts). */
  identityKey: string | null;
  weaponType: string | null;
  element: string | null;
  rarity: string | null;
  itemLevel: number | null;
  /** Total price for the whole listing. */
  price: number;
  /** price ÷ quantity. */
  unitPrice: number;
  listedAt: number;
  feePaid: number;
}

export interface MarketHistory {
  id: string;
  type: 'buy' | 'sell';
  itemId: string;
  itemName: string;
  itemRarity: string;
  price: number;
  fee: number;
  otherPartyId: string;
  timestamp: number;
}
