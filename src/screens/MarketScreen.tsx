import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Tag, List, History, Search, Filter } from 'lucide-react';
import { useMarketStore, useInventoryStore, usePlayerStore } from '@/store';
import { WeaponCard } from '@/components/common/WeaponCard';
import { MobileCard } from '@/components/layout/MobileCard';
import { Listing } from '@/types/market';

const TABS = [
  { id: 'buy', label: 'Buy', icon: ShoppingCart },
  { id: 'sell', label: 'Sell', icon: Tag },
  { id: 'mylistings', label: 'My Listings', icon: List },
  { id: 'history', label: 'History', icon: History },
] as const;

export const MarketScreen: React.FC = () => {
  const market = useMarketStore();
  const inventory = useInventoryStore();
  const player = usePlayerStore();
  const [search, setSearch] = useState('');
  const [listingPrice, setListingPrice] = useState<Record<string, number>>({});
  const [filterRarity, setFilterRarity] = useState<string | null>(null);

  const playerWeapons = inventory.getWeapons().filter((w) => !w.isLocked);
  const myListings = market.listings.filter((l) => l.sellerId === 'player_1');

  const handleList = (itemId: string) => {
    const price = listingPrice[itemId] || 1000;
    const fee = Math.round(price * 0.1);
    if (player.credits < fee) return;
    player.removeCredits(fee);
    const item = inventory.getById(itemId);
    if (!item) return;
    const listing: Listing = {
      id: crypto.randomUUID?.() || String(Date.now()),
      sellerId: 'player_1',
      sellerName: player.name,
      itemId,
      itemSnapshot: JSON.parse(JSON.stringify(item)),
      price,
      listedAt: Date.now(),
      feePaid: fee,
    };
    market.addListing(listing);
    inventory.removeItem(itemId);
  };

  const handleBuy = (listing: Listing) => {
    if (player.credits < listing.price) return;
    player.removeCredits(listing.price);
    inventory.addItem(listing.itemSnapshot);
    market.removeListing(listing.id);
    market.addHistory({
      id: crypto.randomUUID?.() || String(Date.now()),
      type: 'buy',
      itemId: listing.itemId,
      itemName: listing.itemSnapshot.name || 'Unknown',
      itemRarity: listing.itemSnapshot.rarity || 'Common',
      price: listing.price,
      fee: 0,
      otherPartyId: listing.sellerId,
      timestamp: Date.now(),
    });
  };

  const filteredListings = market.listings
    .filter((l) => l.sellerId !== 'player_1')
    .filter((l) => {
      if (search && !l.itemSnapshot.name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterRarity && l.itemSnapshot.rarity !== filterRarity) return false;
      return true;
    });

  return (
    <div className="p-4 space-y-3 pb-20">
      <div className="text-lg font-black text-text-primary">Market</div>

      {/* Tabs */}
      <div className="grid grid-cols-4 gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => market.setActiveTab(t.id)}
            className={`flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-bold border transition-colors ${
              market.activeTab === t.id ? 'bg-amber text-bg border-amber' : 'bg-surface-raised text-text-secondary border-border'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Buy Tab */}
      {market.activeTab === 'buy' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search caches..."
                className="w-full bg-surface-raised border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-text-primary placeholder:text-text-muted"
              />
            </div>
            <button className="px-3 py-2 rounded-lg bg-surface-raised border border-border text-text-muted">
              <Filter size={14} />
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map((r) => (
              <button
                key={r}
                onClick={() => setFilterRarity(filterRarity === r ? null : r)}
                className={`px-2 py-1 rounded-full text-[10px] font-bold whitespace-nowrap border ${
                  filterRarity === r ? 'bg-amber text-bg border-amber' : 'bg-surface-raised text-text-secondary border-border'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {filteredListings.length === 0 && (
              <div className="text-center text-xs text-text-muted py-8">No listings found. List your own gear!</div>
            )}
            {filteredListings.map((l) => (
              <MobileCard key={l.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-text-primary">{l.itemSnapshot.name}</div>
                  <div className="text-xs text-amber font-black">{l.price.toLocaleString()}cr</div>
                </div>
                <div className="text-[10px] text-text-muted">
                  {l.itemSnapshot.rarity} • Lv.{l.itemSnapshot.level} • {l.itemSnapshot.weaponType}
                </div>
                <button
                  onClick={() => handleBuy(l)}
                  disabled={player.credits < l.price}
                  className="w-full py-2 rounded-lg bg-green text-bg font-bold text-xs disabled:opacity-40"
                >
                  Buy Now
                </button>
              </MobileCard>
            ))}
          </div>
        </div>
      )}

      {/* Sell Tab */}
      {market.activeTab === 'sell' && (
        <div className="space-y-2">
          {playerWeapons.length === 0 && (
            <div className="text-center text-xs text-text-muted py-8">No tradeable items. Unlock items from your inventory.</div>
          )}
          {playerWeapons.map((w) => (
            <MobileCard key={w.id} className="space-y-2">
              <WeaponCard weapon={w} />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={listingPrice[w.id] || Math.round(w.combatPower * 10 + w.rollQuality * 50)}
                  onChange={(e) => setListingPrice((p) => ({ ...p, [w.id]: Number(e.target.value) }))}
                  className="flex-1 bg-surface-raised border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary"
                />
                <button
                  onClick={() => handleList(w.id)}
                  className="px-3 py-1.5 rounded-lg bg-amber text-bg font-bold text-xs"
                >
                  List
                </button>
              </div>
              <div className="text-[10px] text-text-muted">
                Fee: {Math.round((listingPrice[w.id] || Math.round(w.combatPower * 10 + w.rollQuality * 50)) * 0.1)}cr (10%)
              </div>
            </MobileCard>
          ))}
        </div>
      )}

      {/* My Listings */}
      {market.activeTab === 'mylistings' && (
        <div className="space-y-2">
          {myListings.length === 0 && (
            <div className="text-center text-xs text-text-muted py-8">You have no active listings.</div>
          )}
          {myListings.map((l) => (
            <MobileCard key={l.id} className="flex items-center justify-between">
              <div className="text-xs font-bold text-text-primary">{l.itemSnapshot.name}</div>
              <div className="text-xs text-amber font-bold">{l.price.toLocaleString()}cr</div>
            </MobileCard>
          ))}
        </div>
      )}

      {/* History */}
      {market.activeTab === 'history' && (
        <div className="space-y-2">
          {market.history.length === 0 && (
            <div className="text-center text-xs text-text-muted py-8">No transactions yet.</div>
          )}
          {market.history.map((h) => (
            <MobileCard key={h.id} className="flex items-center justify-between">
              <div className="text-xs text-text-primary">
                <span className={h.type === 'buy' ? 'text-green' : 'text-amber'}>{h.type.toUpperCase()}</span>{' '}
                {h.itemName}
              </div>
              <div className="text-xs text-text-muted">{h.price.toLocaleString()}cr</div>
            </MobileCard>
          ))}
        </div>
      )}
    </div>
  );
};
