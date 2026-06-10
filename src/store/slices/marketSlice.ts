import { create } from 'zustand';
import { MarketFilter, Listing, MarketHistory } from '../../types/market';
import { generateWeapon } from '../../lib/generators/weaponGenerator';
import { DropSource } from '../../types/game';

export interface MarketState {
  activeTab: 'buy' | 'vendor' | 'sell' | 'mylistings' | 'history';
  listings: Listing[];
  history: MarketHistory[];
  filters: MarketFilter;
  watchlist: string[];
  seeded: boolean;
  setActiveTab: (tab: 'buy' | 'vendor' | 'sell' | 'mylistings' | 'history') => void;
  addListing: (listing: Listing) => void;
  removeListing: (id: string) => void;
  addHistory: (entry: MarketHistory) => void;
  setFilters: (f: Partial<MarketFilter>) => void;
  toggleWatchlist: (id: string) => void;
  seedMarket: () => void;
}

const NPC_SELLERS = [
  { id: 'npc_scrapbaron', name: 'ScrapBaron' },
  { id: 'npc_techrunner', name: 'TechRunner_77' },
  { id: 'npc_cachevault', name: 'CacheVault' },
  { id: 'npc_circuitghost', name: 'CircuitGhost' },
  { id: 'npc_ironsage', name: 'IronSage' },
  { id: 'npc_rustmerchant', name: 'RustMerchant' },
  { id: 'npc_gridwitch', name: 'GridWitch' },
  { id: 'npc_datasmith', name: 'DataSmith' },
];

function generateSeedListings(): Listing[] {
  const listings: Listing[] = [];
  for (let i = 0; i < 25; i++) {
    const seller = NPC_SELLERS[i % NPC_SELLERS.length];
    const level = 1 + Math.floor(Math.random() * 15);
    const weapon = generateWeapon({ source: DropSource.WorldDrop, level });
    const price = Math.round(weapon.combatPower * 8 + weapon.rollQuality * 40 + 200 + Math.random() * 500);
    listings.push({
      id: `seed_${i}_${Date.now()}`,
      sellerId: seller.id,
      sellerName: seller.name,
      itemId: weapon.id,
      itemSnapshot: JSON.parse(JSON.stringify(weapon)),
      price,
      listedAt: Date.now() - Math.floor(Math.random() * 86400000),
      feePaid: Math.round(price * 0.1),
    });
  }
  return listings;
}

export const useMarketStore = create<MarketState>()((set, get) => ({
  activeTab: 'buy',
  listings: [],
  history: [],
  filters: { sortBy: 'newest', sortDir: 'desc' },
  watchlist: [],
  seeded: false,

  setActiveTab: (tab) => set({ activeTab: tab }),
  addListing: (listing) => set((s) => ({ listings: [listing, ...s.listings] })),
  removeListing: (id) => set((s) => ({ listings: s.listings.filter((l) => l.id !== id) })),
  addHistory: (entry) => set((s) => ({ history: [entry, ...s.history].slice(0, 50) })),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  toggleWatchlist: (id) =>
    set((s) => ({
      watchlist: s.watchlist.includes(id)
        ? s.watchlist.filter((w) => w !== id)
        : [...s.watchlist, id],
    })),
  seedMarket: () => {
    const state = get();
    if (state.seeded) return;
    const seedListings = generateSeedListings();
    set({ listings: seedListings, seeded: true });
  },
}));
