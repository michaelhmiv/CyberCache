import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MarketFilter, Listing, MarketHistory } from '../../types/market';

interface MarketState {
  activeTab: 'buy' | 'sell' | 'mylistings' | 'history';
  listings: Listing[]; // simulated + player listings
  history: MarketHistory[];
  filters: MarketFilter;
  watchlist: string[];
  setActiveTab: (tab: 'buy' | 'sell' | 'mylistings' | 'history') => void;
  addListing: (listing: Listing) => void;
  removeListing: (id: string) => void;
  addHistory: (entry: MarketHistory) => void;
  setFilters: (f: Partial<MarketFilter>) => void;
  toggleWatchlist: (id: string) => void;
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set, get) => ({
      activeTab: 'buy',
      listings: [],
      history: [],
      filters: { sortBy: 'newest', sortDir: 'desc' },
      watchlist: [],
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
    }),
    {
      name: 'cc-market',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
