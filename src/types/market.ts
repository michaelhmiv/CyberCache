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

export interface Listing {
  id: string;
  sellerId: string;
  sellerName: string;
  itemId: string;
  itemSnapshot: any; // serialized item
  price: number;
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
