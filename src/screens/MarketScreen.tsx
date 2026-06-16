import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter, History, List, RefreshCw, Search, ShoppingCart, Store, Tag, X } from 'lucide-react';
import { GearInspectSheet } from '@/components/gear/GearInspectSheet';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { useInventoryStore, useMarketStore, usePlayerStore } from '@/store';
import { RARITIES } from '@/constants/rarities';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { VendorScreen } from './VendorScreen';
import type { GearItem, Weapon } from '@/types/items';
import type { Listing, MarketHistory } from '@/types/market';
import { gearCardSummary } from '@/lib/gear/gearCardSummary';

const generateId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const getNow = () => Date.now();

const NPC_NAMES: Record<string, string> = {
  npc_scrapbaron: 'ScrapBaron',
  npc_techrunner: 'TechRunner_77',
  npc_cachevault: 'CacheVault',
  npc_circuitghost: 'CircuitGhost',
  npc_ironsage: 'IronSage',
  npc_rustmerchant: 'RustMerchant',
  npc_gridwitch: 'GridWitch',
  npc_datasmith: 'DataSmith',
};

function resolveOtherPartyName(id: string, playerName: string): string {
  if (NPC_NAMES[id]) return NPC_NAMES[id];
  if (id === 'player_1') return playerName;
  return id;
}

const TABS = [
  { id: 'buy', label: 'Buy', icon: ShoppingCart },
  { id: 'vendor', label: 'Vendor', icon: Store },
  { id: 'sell', label: 'Sell', icon: Tag },
  { id: 'mylistings', label: 'My Listings', icon: List },
  { id: 'history', label: 'History', icon: History },
] as const;

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

function GearMiniCard({ item, right, onInspect }: { item: GearItem; right?: React.ReactNode; onInspect: () => void }) {
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
  const [search, setSearch] = useState('');
  const [listingPrice, setListingPrice] = useState<Record<string, number>>({});
  const [filterRarity, setFilterRarity] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [inspectItem, setInspectItem] = useState<GearItem | null>(null);

  useEffect(() => {
    market.rotateListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const tradeableItems = inventory.items.filter((i) => !i.isLocked);
  const myListings = market.listings.filter((l) => l.sellerId === 'player_1');
  const filteredListings = market.listings
    .filter((l) => l.sellerId !== 'player_1')
    .filter((l) => !search || l.itemSnapshot.name?.toLowerCase().includes(search.toLowerCase()))
    .filter((l) => !filterRarity || l.itemSnapshot.rarity === filterRarity);

  const handleList = (itemId: string) => {
    const item = inventory.getById(itemId);
    if (!item) return;
    const price = listingPrice[itemId] || defaultPrice(item);
    const fee = Math.round(price * 0.1);
    if (player.credits < fee) {
      setToastMessage('Not enough credits to cover the listing fee.');
      return;
    }
    player.removeCredits(fee);
    const listing: Listing = { id: generateId(), sellerId: 'player_1', sellerName: player.name, itemId, itemSnapshot: JSON.parse(JSON.stringify(item)), price, listedAt: getNow(), feePaid: fee };
    market.addListing(listing);
    inventory.removeItem(itemId);
    setToastMessage(`Listed "${item.name}" for ${price.toLocaleString()}cr.`);
  };

  const handleBuy = (listing: Listing) => {
    if (player.credits < listing.price) {
      setToastMessage('Not enough credits.');
      return;
    }
    player.removeCredits(listing.price);
    inventory.addItem(listing.itemSnapshot);
    market.removeListing(listing.id);
    market.addHistory({ id: generateId(), type: 'buy', itemId: listing.itemId, itemName: listing.itemSnapshot.name || 'Unknown', itemRarity: listing.itemSnapshot.rarity || 'Common', price: listing.price, fee: 0, otherPartyId: listing.sellerId, timestamp: getNow() });
    setToastMessage(`Bought "${listing.itemSnapshot.name}" for ${listing.price.toLocaleString()}cr.`);
  };

  const handleCancelListing = (listing: Listing) => {
    market.removeListing(listing.id);
    inventory.addItem(listing.itemSnapshot);
    setToastMessage('Listing cancelled. Item returned to inventory.');
  };

  const clearBuyFilters = () => {
    setSearch('');
    setFilterRarity(null);
    setToastMessage('Market filters cleared.');
  };

  const historyPartyLabel = (h: MarketHistory): string => {
    const name = resolveOtherPartyName(h.otherPartyId, player.name);
    return h.type === 'buy' ? `Bought from ${name}` : `Sold to ${name}`;
  };

  return (
    <div className="space-y-3 p-4 pb-20">
      <ResourceBar />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => market.setActiveTab(t.id)} className={`flex flex-1 flex-col items-center gap-1 rounded-xl border py-2 min-w-[60px] text-[10px] font-bold transition-colors ${market.activeTab === t.id ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`}>
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {market.activeTab === 'vendor' && <VendorScreen />}

      {market.activeTab === 'buy' && (
        <div className="space-y-3">
          <button
            onClick={() => market.rotateListings()}
            className="flex items-center justify-center gap-1 text-center text-[10px] italic text-text-muted hover:text-amber active:text-amber transition-colors mx-auto"
          >
            <RefreshCw size={12} className={market.rotateCount > 0 ? '' : 'animate-spin'} />
            NPC Market — tap to refresh listings
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
          <div className="space-y-2">
            {filteredListings.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No listings found. List your own gear from the Sell tab.</div>}
            {filteredListings.map((listing) => <div key={listing.id} className="bl-card space-y-2"><GearMiniCard item={listing.itemSnapshot} onInspect={() => setInspectItem(listing.itemSnapshot)} right={<div className="text-right text-xs font-black text-amber">{listing.price.toLocaleString()}cr<div className="text-[9px] text-text-muted">{listing.sellerName}</div></div>} /><button onClick={() => handleBuy(listing)} disabled={player.credits < listing.price} className="w-full rounded-lg bg-green py-2 text-xs font-bold text-bg disabled:opacity-40">Buy Now</button></div>)}
          </div>
        </div>
      )}

      {market.activeTab === 'sell' && (
        <div className="space-y-2">
          {tradeableItems.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No tradeable items. Unlock items from your inventory to list them.</div>}
          {tradeableItems.map((item) => {
            const price = listingPrice[item.id] || defaultPrice(item);
            const fee = Math.round(price * 0.1);
            return <div key={item.id} className="bl-card space-y-2"><GearMiniCard item={item} onInspect={() => setInspectItem(item)} /><div className="flex items-center gap-2"><input type="number" value={price} onChange={(e) => setListingPrice((p) => ({ ...p, [item.id]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" /><button onClick={() => handleList(item.id)} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg">List</button></div><div className="text-[10px] text-text-muted">Listing fee: {fee.toLocaleString()}cr (10%)</div></div>;
          })}
        </div>
      )}

      {market.activeTab === 'mylistings' && (
        <div className="space-y-2">
          {myListings.length === 0 && <div className="py-8 text-center text-xs text-text-muted">You have no active listings.</div>}
          {myListings.map((listing) => <div key={listing.id} className="bl-card space-y-2"><GearMiniCard item={listing.itemSnapshot} onInspect={() => setInspectItem(listing.itemSnapshot)} right={<div className="text-right text-xs font-black text-amber">{listing.price.toLocaleString()}cr</div>} /><button onClick={() => handleCancelListing(listing)} className="w-full rounded-lg bg-red-600 py-2 text-xs font-bold text-bg hover:bg-red-500">Cancel Listing</button></div>)}
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
