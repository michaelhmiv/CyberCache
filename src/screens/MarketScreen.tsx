import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter, History, List, RefreshCw, Search, X } from 'lucide-react';
import { GearInspectSheet } from '@/components/gear/GearInspectSheet';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { GearCompare } from '@/components/gear/GearCompare';
import { useAuth } from '@/auth/AuthProvider';
import { useInventoryStore, useLoadoutStore, useMarketStore, usePlayerStore } from '@/store';
import { RARITIES } from '@/constants/rarities';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { VendorScreen } from './VendorScreen';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import { fetchActiveMarketListings } from '@/lib/supabase/marketListings';
import type { GearItem, Weapon } from '@/types/items';
import type { Listing, MarketHistory } from '@/types/market';
import { gearCardSummary } from '@/lib/gear/gearCardSummary';

const getNow = () => Date.now();

type BuySort = 'price' | 'rarity' | 'name';
type SellSort = 'power' | 'rarity' | 'name';
type MyListSort = 'price' | 'rarity' | 'name';

const TABS: { id: string; label: string; glyph?: string; icon?: React.ElementType }[] = [
  { id: 'buy', label: 'Buy', glyph: '$' },
  { id: 'vendor', label: 'Vendor', glyph: '🏪' },
  { id: 'sell', label: 'Sell', glyph: '🏷' },
  { id: 'mylistings', label: 'My Listings', icon: List },
  { id: 'history', label: 'History', icon: History },
];

function rarityColor(rarity: string | undefined): string {
  if (!rarity) return '#9CA3AF';
  return (RARITIES as Record<string, { color: string }>)[rarity]?.color ?? '#9CA3AF';
}

function isWeapon(item: GearItem): item is Weapon {
  return 'weaponType' in item;
}

function itemKind(item: GearItem): string {
  if (isWeapon(item)) return item.weaponType;
  if ('hp' in item) return 'Shield';
  if ('treeBonus' in item) return 'Class Mod';
  if ('effect' in item && 'damage' in item) return 'Ordnance';
  return 'Relic';
}

function defaultPrice(item: GearItem): number {
  return isWeapon(item) ? Math.round(item.combatPower * 10 + item.rollQuality * 50) : Math.round((item.level ?? 1) * 200);
}

function formatSellerName(id: string, playerName: string, currentUserId?: string | null): string {
  if (id === currentUserId) return 'You';
  if (id === 'player_1') return playerName;
  return id.slice(0, 8);
}

/** Returns the currently equipped item that is the same broad kind as the candidate. */
function equippedForComparison(item: GearItem, loadout: ReturnType<typeof useLoadoutStore>): GearItem | undefined {
  if (isWeapon(item)) return loadout.getWeapon('primary') ?? loadout.getWeapon('secondary') ?? loadout.getWeapon('heavy');
  if ('hp' in item) return loadout.getShield();
  if ('treeBonus' in item) return loadout.getClassMod();
  if ('damage' in item && 'effect' in item) return loadout.getOrdnance();
  return loadout.getRelic();
}

function GearMiniCard({ item, compareItem, right, onInspect }: { item: GearItem; compareItem?: GearItem; right?: React.ReactNode; onInspect: () => void }) {
  const color = rarityColor(item.rarity);
  const summary = gearCardSummary(item);
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onInspect} className="flex min-w-0 flex-1 items-center gap-3 text-left active:scale-[0.99]">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-border bg-bg">
          <GearIllustration item={item} size={46} showBadges={false} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-black" style={{ color }}>{item.name}</div>
          <div className="text-[10px] text-text-muted">{item.rarity} · Lv.{item.level ?? 1} · {itemKind(item)}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {summary.primaryStats.slice(0, 3).map((stat) => (
              <span key={stat.label} className="inline-flex items-center gap-0.5 rounded border border-border bg-bg px-1 py-0.5 text-[9px]">
                <span className="text-text-muted">{stat.label}</span>
                <span className={`font-bold ${stat.tone ?? 'text-text-primary'}`}>{stat.value}</span>
              </span>
            ))}
          </div>
          {summary.badges[0] && (
            <div className="text-[9px] text-amber mt-0.5 truncate">{summary.badges[0]}</div>
          )}
          {compareItem && (
            <GearCompare current={compareItem} candidate={item} compact />
          )}
        </div>
      </button>
      {right}
    </div>
  );
}

export const MarketScreen: React.FC = () => {
  const market = useMarketStore();
  const inventory = useInventoryStore();
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const [search, setSearch] = useState('');
  const [sellSearch, setSellSearch] = useState('');
  const [myListSearch, setMyListSearch] = useState('');
  const [listingPrice, setListingPrice] = useState<Record<string, number>>({});
  const [filterRarity, setFilterRarity] = useState<string | null>(null);
  const [sellFilterRarity, setSellFilterRarity] = useState<string | null>(null);
  const [myListFilterRarity, setMyListFilterRarity] = useState<string | null>(null);
  const [buySort, setBuySort] = useState<BuySort>('price');
  const [sellSort, setSellSort] = useState<SellSort>('power');
  const [myListSort, setMyListSort] = useState<MyListSort>('price');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [inspectItem, setInspectItem] = useState<GearItem | null>(null);
  const [loadingListings, setLoadingListings] = useState(true);
  const [pendingBuyId, setPendingBuyId] = useState<string | null>(null);
  const [pendingListId, setPendingListId] = useState<string | null>(null);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchActiveMarketListings()
      .then((listings) => {
        if (!cancelled) market.setListings(listings);
      })
      .catch((err) => {
        if (!cancelled) setToastMessage(err instanceof Error ? err.message : 'Unable to load market listings.');
      })
      .finally(() => {
        if (!cancelled) setLoadingListings(false);
      });
    return () => {
      cancelled = true;
    };
  }, [market]);

  const refreshListings = useCallback(async () => {
    setLoadingListings(true);
    try {
      const listings = await fetchActiveMarketListings();
      market.setListings(listings);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to load market listings.');
    } finally {
      setLoadingListings(false);
    }
  }, [market]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const tradeableItems = inventory.items.filter((i) => !i.isLocked);
  const myListings = market.listings.filter((l) => l.sellerId === currentUserId);
  const otherListings = market.listings.filter((l) => l.sellerId !== currentUserId);

  const sortedTradeableItems = useMemo(() => {
    return [...tradeableItems]
      .filter((item) => !sellSearch || item.name.toLowerCase().includes(sellSearch.toLowerCase()))
      .filter((item) => !sellFilterRarity || item.rarity === sellFilterRarity)
      .sort((a, b) => {
        if (sellSort === 'power') {
          const aPow = isWeapon(a) ? a.combatPower : 0;
          const bPow = isWeapon(b) ? b.combatPower : 0;
          return bPow - aPow;
        }
        if (sellSort === 'rarity') {
          const rank: Record<string, number> = { Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5 };
          return (rank[b.rarity] ?? 0) - (rank[a.rarity] ?? 0);
        }
        return a.name.localeCompare(b.name);
      });
  }, [tradeableItems, sellSearch, sellFilterRarity, sellSort]);

  const filteredListings = useMemo(() => {
    return [...otherListings]
      .filter((l) => !search || l.itemSnapshot.name?.toLowerCase().includes(search.toLowerCase()))
      .filter((l) => !filterRarity || l.itemSnapshot.rarity === filterRarity)
      .sort((a, b) => {
        if (buySort === 'price') return a.price - b.price;
        if (buySort === 'rarity') {
          const rank: Record<string, number> = { Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5 };
          return (rank[b.itemSnapshot.rarity] ?? 0) - (rank[a.itemSnapshot.rarity] ?? 0);
        }
        return (a.itemSnapshot.name || '').localeCompare(b.itemSnapshot.name || '');
      });
  }, [otherListings, search, filterRarity, buySort]);

  const sortedMyListings = useMemo(() => {
    return [...myListings]
      .filter((l) => !myListSearch || l.itemSnapshot.name?.toLowerCase().includes(myListSearch.toLowerCase()))
      .filter((l) => !myListFilterRarity || l.itemSnapshot.rarity === myListFilterRarity)
      .sort((a, b) => {
        if (myListSort === 'price') return b.price - a.price;
        if (myListSort === 'rarity') {
          const rank: Record<string, number> = { Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5 };
          return (rank[b.itemSnapshot.rarity] ?? 0) - (rank[a.itemSnapshot.rarity] ?? 0);
        }
        return (a.itemSnapshot.name || '').localeCompare(b.itemSnapshot.name || '');
      });
  }, [myListings, myListSearch, myListFilterRarity, myListSort]);

  const handleList = async (itemId: string) => {
    const item = inventory.getById(itemId);
    if (!item) return;
    const price = listingPrice[itemId] || defaultPrice(item);
    if (price <= 0) {
      setToastMessage('Price must be positive.');
      return;
    }
    setPendingListId(itemId);
    try {
      await verifiedOps.marketCreate(itemId, price);
      setToastMessage(`Listed "${item.name}" for ${price.toLocaleString()}cr.`);
      await refreshListings();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to list item.');
    } finally {
      setPendingListId(null);
    }
  };

  const handleBuy = async (listing: Listing) => {
    if (player.credits < listing.price) {
      setToastMessage('Not enough credits.');
      return;
    }
    setPendingBuyId(listing.id);
    try {
      await verifiedOps.acceptListing(listing.id);
      market.addHistory({ id: listing.id, type: 'buy', itemId: listing.itemId, itemName: listing.itemSnapshot.name || 'Unknown', itemRarity: listing.itemSnapshot.rarity || 'Common', price: listing.price, fee: 0, otherPartyId: listing.sellerId, timestamp: getNow() });
      setToastMessage(`Bought "${listing.itemSnapshot.name}" for ${listing.price.toLocaleString()}cr.`);
      await refreshListings();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to buy item.');
    } finally {
      setPendingBuyId(null);
    }
  };

  const handleCancelListing = async (listing: Listing) => {
    setPendingCancelId(listing.id);
    try {
      await verifiedOps.marketCancel(listing.id);
      setToastMessage('Listing cancelled. Item returned to inventory.');
      await refreshListings();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to cancel listing.');
    } finally {
      setPendingCancelId(null);
    }
  };

  const clearBuyFilters = () => {
    setSearch('');
    setFilterRarity(null);
    setToastMessage('Market filters cleared.');
  };

  const clearSellFilters = () => {
    setSellSearch('');
    setSellFilterRarity(null);
    setToastMessage('Sell filters cleared.');
  };

  const clearMyListFilters = () => {
    setMyListSearch('');
    setMyListFilterRarity(null);
    setToastMessage('My Listings filters cleared.');
  };

  const historyPartyLabel = (h: MarketHistory): string => {
    const name = formatSellerName(h.otherPartyId, player.name, currentUserId);
    return h.type === 'buy' ? `Bought from ${name}` : `Sold to ${name}`;
  };

  return (
    <div className="space-y-3 p-4 pb-20">
      <ResourceBar />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => market.setActiveTab(t.id)} className={`flex flex-1 flex-col items-center gap-1 rounded-xl border py-2 min-w-[60px] text-[10px] font-bold transition-colors ${market.activeTab === t.id ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`}>
            {t.icon ? <t.icon size={16} /> : <span className="font-black" style={{ fontSize: '16px' }}>{t.glyph}</span>}
            {t.label}
          </button>
        ))}
      </div>

      {market.activeTab === 'vendor' && <VendorScreen />}

      {market.activeTab === 'buy' && (
        <div className="space-y-3">
          <button
            onClick={refreshListings}
            disabled={loadingListings}
            className="flex items-center justify-center gap-1 text-center text-[10px] italic text-text-muted hover:text-amber active:text-amber transition-colors mx-auto disabled:opacity-50"
          >
            <RefreshCw size={12} className={loadingListings ? 'animate-spin' : ''} />
            {loadingListings ? 'Loading market…' : 'Player Market — tap to refresh'}
          </button>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search caches…" className="w-full rounded-lg border border-border bg-surface-raised py-2 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-muted" />
            </div>
            <button
              type="button"
              onClick={clearBuyFilters}
              disabled={!search && !filterRarity}
              aria-label="Clear market filters"
              className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-text-muted transition-colors active:text-amber disabled:opacity-40"
            >
              <Filter size={14} />
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map((r) => <button key={r} onClick={() => setFilterRarity(filterRarity === r ? null : r)} className={`whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-bold ${filterRarity === r ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`}>{r}</button>)}
          </div>
          <select
            value={buySort}
            onChange={(e) => setBuySort(e.target.value as BuySort)}
            className="text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
          >
            <option value="price">Sort: Cheapest</option>
            <option value="rarity">Sort: Rarity ↓</option>
            <option value="name">Sort: Name A-Z</option>
          </select>
          <div className="space-y-2">
            {filteredListings.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No listings found. List your own gear from the Sell tab.</div>}
            {filteredListings.map((listing) => {
              const seller = formatSellerName(listing.sellerId, player.name, currentUserId);
              return (
                <div key={listing.id} className="bl-card space-y-2">
                  <GearMiniCard item={listing.itemSnapshot} compareItem={equippedForComparison(listing.itemSnapshot, loadout)} onInspect={() => setInspectItem(listing.itemSnapshot)} right={<div className="text-right text-xs font-black text-amber">{listing.price.toLocaleString()}cr<div className="text-[9px] text-text-muted">{seller}</div></div>} />
                  <button onClick={() => handleBuy(listing)} disabled={player.credits < listing.price || pendingBuyId === listing.id} className="w-full rounded-lg bg-green py-2 text-xs font-bold text-bg disabled:opacity-40">
                    {pendingBuyId === listing.id ? 'Buying…' : 'Buy Now'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {market.activeTab === 'sell' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={sellSearch} onChange={(e) => setSellSearch(e.target.value)} placeholder="Search items to list…" className="w-full rounded-lg border border-border bg-surface-raised py-2 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-muted" />
            </div>
            <button
              type="button"
              onClick={clearSellFilters}
              disabled={!sellSearch && !sellFilterRarity}
              aria-label="Clear sell filters"
              className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-text-muted transition-colors active:text-amber disabled:opacity-40"
            >
              <Filter size={14} />
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map((r) => <button key={r} onClick={() => setSellFilterRarity(sellFilterRarity === r ? null : r)} className={`whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-bold ${sellFilterRarity === r ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`}>{r}</button>)}
          </div>
          <select
            value={sellSort}
            onChange={(e) => setSellSort(e.target.value as SellSort)}
            className="text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
          >
            <option value="power">Sort: Power ↓</option>
            <option value="rarity">Sort: Rarity ↓</option>
            <option value="name">Sort: Name A-Z</option>
          </select>
          {sortedTradeableItems.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No tradeable items match. Unlock items from your inventory to list them.</div>}
          {sortedTradeableItems.map((item) => {
            const price = listingPrice[item.id] || defaultPrice(item);
            return (
              <div key={item.id} className="bl-card space-y-2">
                <GearMiniCard item={item} onInspect={() => setInspectItem(item)} />
                <div className="flex items-center gap-2">
                  <input type="number" value={price} onChange={(e) => setListingPrice((p) => ({ ...p, [item.id]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" />
                  <button onClick={() => handleList(item.id)} disabled={pendingListId === item.id} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                    {pendingListId === item.id ? 'Listing…' : 'List'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {market.activeTab === 'mylistings' && (
        <div className="space-y-3">
          <button
            onClick={refreshListings}
            disabled={loadingListings}
            className="flex items-center justify-center gap-1 text-center text-[10px] italic text-text-muted hover:text-amber active:text-amber transition-colors mx-auto disabled:opacity-50"
          >
            <RefreshCw size={12} className={loadingListings ? 'animate-spin' : ''} />
            {loadingListings ? 'Loading…' : 'Refresh my listings'}
          </button>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={myListSearch} onChange={(e) => setMyListSearch(e.target.value)} placeholder="Search your listings…" className="w-full rounded-lg border border-border bg-surface-raised py-2 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-muted" />
            </div>
            <button
              type="button"
              onClick={clearMyListFilters}
              disabled={!myListSearch && !myListFilterRarity}
              aria-label="Clear my listings filters"
              className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-text-muted transition-colors active:text-amber disabled:opacity-40"
            >
              <Filter size={14} />
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map((r) => <button key={r} onClick={() => setMyListFilterRarity(myListFilterRarity === r ? null : r)} className={`whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-bold ${myListFilterRarity === r ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`}>{r}</button>)}
          </div>
          <select
            value={myListSort}
            onChange={(e) => setMyListSort(e.target.value as MyListSort)}
            className="text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
          >
            <option value="price">Sort: Price ↓</option>
            <option value="rarity">Sort: Rarity ↓</option>
            <option value="name">Sort: Name A-Z</option>
          </select>
          {sortedMyListings.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No active listings match.</div>}
          {sortedMyListings.map((listing) => (
            <div key={listing.id} className="bl-card space-y-2">
              <GearMiniCard item={listing.itemSnapshot} onInspect={() => setInspectItem(listing.itemSnapshot)} right={<div className="text-right text-xs font-black text-amber">{listing.price.toLocaleString()}cr</div>} />
              <button onClick={() => handleCancelListing(listing)} disabled={pendingCancelId === listing.id} className="w-full rounded-lg bg-red-600 py-2 text-xs font-bold text-bg hover:bg-red-500 disabled:opacity-50">
                {pendingCancelId === listing.id ? 'Cancelling…' : 'Cancel Listing'}
              </button>
            </div>
          ))}
        </div>
      )}

      {market.activeTab === 'history' && (
        <div className="space-y-2">
          {market.history.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No transactions yet.</div>}
          {market.history.map((h) => <div key={h.id} className="bl-card space-y-1.5"><div className="flex items-center justify-between"><div className="text-xs font-bold text-text-primary">{h.itemName}</div><div className={`text-xs font-black ${h.type === 'buy' ? 'text-red-400' : 'text-green-400'}`}>{h.type === 'buy' ? '-' : '+'}{h.price.toLocaleString()}cr</div></div><div className="flex items-center justify-between text-[10px] text-text-muted"><span>{historyPartyLabel(h)}</span><span>{h.itemRarity}</span></div></div>)}
        </div>
      )}

      <GearInspectSheet item={inspectItem} open={!!inspectItem} onClose={() => setInspectItem(null)} contextLabel="Market Inspect" />

      <AnimatePresence>
        {toastMessage && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="fixed bottom-20 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-xl border border-border bg-surface-raised px-4 py-2.5 shadow-lg">
            <div className="flex items-center gap-2"><span className="text-xs text-text-primary">{toastMessage}</span><button onClick={() => setToastMessage(null)} className="text-text-muted hover:text-text-primary"><X size={12} /></button></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
