import { create } from 'zustand';
import type { Listing, MarketHistory as MarketHistoryEntry, MarketFilter as MarketFilters } from '@/types/market';
import type { ServiceBoardQuery } from '@/lib/market/boardQuery';

/** The Market rail stops (DESIGN.md §2) — the only values the tab's
 *  stop state and the tab→stop deep link may name. My Listings and
 *  History are NOT stops: they are segments of the Sell stop (§2). */
export type MarketStopId = 'buy' | 'sell' | 'vendor' | 'repair' | 'shieldTech' | 'repdesk' | 'slots';
export const MARKET_STOP_IDS: readonly MarketStopId[] = ['buy', 'sell', 'vendor', 'repair', 'shieldTech', 'repdesk', 'slots'];

export const isMarketStopId = (value: string): value is MarketStopId =>
  (MARKET_STOP_IDS as readonly string[]).includes(value);

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
  /** Tab→stop deep link (DESIGN.md §9): a one-shot intent naming
   *  the Market stop a launcher elsewhere in the app wants to land
   *  ON — e.g. Home's Slots card asks for 'slots' so the player
   *  arrives at the wheel, not at the Market tab's last stop.
   *  App's handleNavigate records it for a 'market:<stop>' route;
   *  MarketScreen consumes it on arrival (applies + clears), so a
   *  later plain Market visit keeps the player's own stop. `seq`
   *  makes a repeat intent re-apply even while Market is mounted. */
  marketStopIntent: { stop: MarketStopId; seq: number } | null;
  requestMarketStop: (stop: MarketStopId) => void;
  clearMarketStopIntent: () => void;
  /** Shield-tech deep link (0044): a shield id handed from the gear
   *  inspect sheet to the Shield Tech tab's post form, consumed once. */
  shieldTechPreselect: string | null;
  setShieldTechPreselect: (itemId: string | null) => void;
  /** Service-board browse state (market-lane parity): the boards'
   *  filter/sort/search lives here — not in the components, which
   *  unmount on tab switch — so it survives tab switches the way
   *  the Buy lane's browsing does. */
  repairBoardQuery: ServiceBoardQuery;
  setRepairBoardQuery: (q: Partial<ServiceBoardQuery>) => void;
  shieldTechBoardQuery: ServiceBoardQuery;
  setShieldTechBoardQuery: (q: Partial<ServiceBoardQuery>) => void;
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
  marketStopIntent: null,
  requestMarketStop: (stop) => set({ marketStopIntent: { stop, seq: Date.now() } }),
  clearMarketStopIntent: () => set({ marketStopIntent: null }),
  shieldTechPreselect: null,
  setShieldTechPreselect: (itemId) => set({ shieldTechPreselect: itemId }),
  repairBoardQuery: {},
  setRepairBoardQuery: (q) => set((s) => ({ repairBoardQuery: { ...s.repairBoardQuery, ...q } })),
  shieldTechBoardQuery: {},
  setShieldTechBoardQuery: (q) => set((s) => ({ shieldTechBoardQuery: { ...s.shieldTechBoardQuery, ...q } })),
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
