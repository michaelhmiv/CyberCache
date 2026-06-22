import { create } from 'zustand';
import type { Listing, MarketHistory as MarketHistoryEntry, MarketFilter as MarketFilters } from '@/types/market';

interface MarketState {
  activeTab: string;
  listings: Listing[];
  history: MarketHistoryEntry[];
  filters: MarketFilters;
  watchlist: string[];
  /** Timestamp (ms) of last NPC listing rotation. */
  lastRotated: number;
  /** How many times NPC listings have been rotated this session. */
  rotateCount: number;
  setActiveTab: (tab: string) => void;
  setListings: (listings: Listing[]) => void;
  addListing: (listing: Listing) => void;
  removeListing: (id: string) => void;
  addHistory: (entry: MarketHistoryEntry) => void;
  setFilters: (f: Partial<MarketFilters>) => void;
  toggleWatchlist: (id: string) => void;
}

export const useMarketStore = create<MarketState>()((set) => ({
  activeTab: 'buy',
  listings: [],
  history: [],
  filters: { sortBy: 'newest', sortDir: 'desc' },
  watchlist: [],
  lastRotated: 0,
  rotateCount: 0,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setListings: (listings) => set({ listings }),
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
}));
