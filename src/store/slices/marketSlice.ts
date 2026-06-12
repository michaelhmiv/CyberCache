import { create } from 'zustand';
import type { MarketListing, MarketHistoryEntry, MarketFilters } from '@/types/market';
import { generateWeapon } from '@/lib/generators/weaponGenerator';
import { createTickRng } from '@/lib/rng/tickRng';

interface MarketState {
  activeTab: string;
  listings: MarketListing[];
  history: MarketHistoryEntry[];
  filters: MarketFilters;
  watchlist: string[];
  /** Timestamp (ms) of last NPC listing rotation. */
  lastRotated: number;
  /** How many times NPC listings have been rotated this session. */
  rotateCount: number;
  setActiveTab: (tab: string) => void;
  addListing: (listing: MarketListing) => void;
  removeListing: (id: string) => void;
  addHistory: (entry: MarketHistoryEntry) => void;
  setFilters: (f: Partial<MarketFilters>) => void;
  toggleWatchlist: (id: string) => void;
  /** Rotate NPC vendor listings. Call on market tab mount / manual refresh. */
  rotateListings: () => void;
}

function generateSeedListings(): MarketListing[] {
  const rng = createTickRng('market_npc', 'vendor', Date.now());
  const weapons = Array.from({ length: 12 }, (_, i) => {
    const level = 1 + Math.floor(rng() * 15);
    const weapon = generateWeapon({
      source: 'BossDrop' as never,
      level,
      bossTier: 1,
    }, rng);
    const price = Math.round(weapon.combatPower * 8 + weapon.rollQuality * 40 + 200 + rng() * 500);
    return {
      id: `npc_${i}_${Date.now()}`,
      itemSnapshot: weapon,
      priceCredits: price,
      sellerId: 'npc_vendor',
      sellerName: 'Vault Trader',
      listedAt: Date.now() - Math.floor(rng() * 86_400_000),
    } satisfies MarketListing;
  });
  return weapons;
}

export const useMarketStore = create<MarketState>()((set, get) => ({
  activeTab: 'buy',
  listings: [],
  history: [],
  filters: { sortBy: 'newest', sortDir: 'desc' },
  watchlist: [],
  lastRotated: 0,
  rotateCount: 0,

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
  rotateListings: () => {
    const fresh = generateSeedListings();
    const playerListings = get().listings.filter((l) => l.sellerId !== 'npc_vendor');
    set({
      listings: [...fresh, ...playerListings],
      lastRotated: Date.now(),
      rotateCount: get().rotateCount + 1,
    });
  },
}));
