import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Tag, List, History, Search, Filter, X, Wallet } from 'lucide-react';
import { useMarketStore, useInventoryStore, usePlayerStore } from '@/store';
import { WeaponCard } from '@/components/common/WeaponCard';
import { MobileCard } from '@/components/layout/MobileCard';
import { Listing, MarketHistory } from '@/types/market';
import { GearItem, Weapon } from '@/types/items';
import { RARITIES } from '@/constants/rarities';

// ── NPC seller name lookup (mirrors marketSlice NPC_SELLERS) ────────────
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
  return id; // fallback
}

// ── Tabs ─────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'buy', label: 'Buy', icon: ShoppingCart },
  { id: 'sell', label: 'Sell', icon: Tag },
  { id: 'mylistings', label: 'My Listings', icon: List },
  { id: 'history', label: 'History', icon: History },
] as const;

// ── Small helper for rarity color on non-weapon items ────────────────────
function rarityColor(rarity: string | undefined): string {
  if (!rarity) return '#9CA3AF';
  return (RARITIES as Record<string, { color: string }>)[rarity]?.color ?? '#9CA3AF';
}

// ── Component ────────────────────────────────────────────────────────────
export const MarketScreen: React.FC = () => {
  const market = useMarketStore();
  const inventory = useInventoryStore();
  const player = usePlayerStore();

  const [search, setSearch] = useState('');
  const [listingPrice, setListingPrice] = useState<Record<string, number>>({});
  const [filterRarity, setFilterRarity] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Seed NPC market on first load ──────────────────────────────────
  useEffect(() => {
    if (!market.seeded) {
      market.seedMarket();
    }
  }, [market.seeded, market.seedMarket]);

  // ── Auto-dismiss toast ─────────────────────────────────────────────
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // ── Derived state ──────────────────────────────────────────────────
  const tradeableItems = inventory.items.filter((i) => !i.isLocked);
  const myListings = market.listings.filter((l) => l.sellerId === 'player_1');

  const filteredListings = market.listings
    .filter((l) => l.sellerId !== 'player_1')
    .filter((l) => {
      if (search && !l.itemSnapshot.name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterRarity && l.itemSnapshot.rarity !== filterRarity) return false;
      return true;
    });

  // ── Actions ────────────────────────────────────────────────────────

  /** List an item for sale */
  const handleList = (itemId: string) => {
    const item = inventory.getById(itemId);
    if (!item) return;

    // Price default: weapons use combatPower/rollQuality, others use level*rarity
    const isWeapon = 'weaponType' in item;
    const defaultPrice = isWeapon
      ? Math.round((item as Weapon).combatPower * 10 + (item as Weapon).rollQuality * 50)
      : Math.round((item.level ?? 1) * 200);

    const price = listingPrice[itemId] || defaultPrice;
    const fee = Math.round(price * 0.1);
    if (player.credits < fee) {
      setToastMessage('Not enough credits to cover the listing fee.');
      return;
    }

    player.removeCredits(fee);

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
    setToastMessage(`Listed "${item.name}" for ${price.toLocaleString()}cr.`);
  };

  /** Buy a listing */
  const handleBuy = (listing: Listing) => {
    if (player.credits < listing.price) {
      setToastMessage('Not enough credits.');
      return;
    }
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
    setToastMessage(`Bought "${listing.itemSnapshot.name}" for ${listing.price.toLocaleString()}cr.`);
  };

  /** Cancel a player listing — returns item to inventory */
  const handleCancelListing = (listing: Listing) => {
    market.removeListing(listing.id);
    inventory.addItem(listing.itemSnapshot);
    setToastMessage('Listing cancelled. Item returned to inventory.');
  };

  // ── Helper: format "Bought from …" / "Sold to …" for history ──────
  const historyPartyLabel = (h: MarketHistory): string => {
    const name = resolveOtherPartyName(h.otherPartyId, player.name);
    return h.type === 'buy' ? `Bought from ${name}` : `Sold to ${name}`;
  };

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="p-4 space-y-3 pb-20">
      {/* ── Header with credits ──────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="text-lg font-black text-text-primary">Market</div>
        <div className="flex items-center gap-1.5 bg-surface-raised rounded-lg px-2.5 py-1 border border-border">
          <Wallet size={14} className="text-amber" />
          <span className="text-xs font-bold text-amber">{player.credits.toLocaleString()}cr</span>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => market.setActiveTab(t.id)}
            className={`flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-bold border transition-colors ${
              market.activeTab === t.id
                ? 'bg-amber text-bg border-amber'
                : 'bg-surface-raised text-text-secondary border-border'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Buy Tab ───────────────────────────────────────────────── */}
      {market.activeTab === 'buy' && (
        <div className="space-y-3">
          {/* Subtitle */}
          <div className="text-[10px] text-text-muted italic text-center">
            Local NPC Market — simulated traders only
          </div>

          {/* Search + Filter */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search caches…"
                className="w-full bg-surface-raised border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-text-primary placeholder:text-text-muted"
              />
            </div>
            <button className="px-3 py-2 rounded-lg bg-surface-raised border border-border text-text-muted">
              <Filter size={14} />
            </button>
          </div>

          {/* Rarity filter pills */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map((r) => (
              <button
                key={r}
                onClick={() => setFilterRarity(filterRarity === r ? null : r)}
                className={`px-2 py-1 rounded-full text-[10px] font-bold whitespace-nowrap border ${
                  filterRarity === r
                    ? 'bg-amber text-bg border-amber'
                    : 'bg-surface-raised text-text-secondary border-border'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Listings */}
          <div className="space-y-2">
            {filteredListings.length === 0 && (
              <div className="text-center text-xs text-text-muted py-8">
                No listings found. List your own gear from the Sell tab!
              </div>
            )}
            {filteredListings.map((l) => (
              <MobileCard key={l.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-text-primary">{l.itemSnapshot.name}</div>
                    <div className="text-[10px] text-text-muted">Seller: {l.sellerName}</div>
                  </div>
                  <div className="text-xs text-amber font-black">{l.price.toLocaleString()}cr</div>
                </div>
                <div className="text-[10px] text-text-muted">
                  {l.itemSnapshot.rarity}
                  {l.itemSnapshot.level != null && <> • Lv.{l.itemSnapshot.level}</>}
                  {l.itemSnapshot.weaponType && <> • {l.itemSnapshot.weaponType}</>}
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

      {/* ── Sell Tab ───────────────────────────────────────────────── */}
      {market.activeTab === 'sell' && (
        <div className="space-y-2">
          {tradeableItems.length === 0 && (
            <div className="text-center text-xs text-text-muted py-8">
              No tradeable items. Unlock items from your inventory to list them.
            </div>
          )}
          {tradeableItems.map((item) => {
            const isWeapon = 'weaponType' in item;
            const weapon = item as Weapon;
            const defaultPrice = isWeapon
              ? Math.round(weapon.combatPower * 10 + weapon.rollQuality * 50)
              : Math.round((item.level ?? 1) * 200);
            const price = listingPrice[item.id] || defaultPrice;
            const fee = Math.round(price * 0.1);

            return (
              <MobileCard key={item.id} className="space-y-2">
                {/* Item display */}
                {isWeapon ? (
                  <WeaponCard weapon={weapon} />
                ) : (
                  <div className="flex items-center gap-3 py-1">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-[10px] font-bold text-bg shrink-0"
                      style={{ backgroundColor: rarityColor(item.rarity) }}
                    >
                      {item.rarity ? item.rarity[0] : '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-xs font-bold truncate"
                        style={{ color: rarityColor(item.rarity) }}
                      >
                        {item.name}
                      </div>
                      <div className="text-[10px] text-text-muted">
                        {item.rarity} • Lv.{item.level ?? 1}
                        {'hp' in item && <> • Shield</>}
                        {'treeBonus' in item && <> • Class Mod</>}
                        {'effect' in item && 'damage' in item && <> • Ordnance</>}
                        {!('hp' in item) && !('treeBonus' in item) && !('effect' in item) && !isWeapon && <> • Relic</>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Price input + List button */}
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={price}
                    onChange={(e) =>
                      setListingPrice((p) => ({ ...p, [item.id]: Number(e.target.value) }))
                    }
                    className="flex-1 bg-surface-raised border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary"
                  />
                  <button
                    onClick={() => handleList(item.id)}
                    className="px-3 py-1.5 rounded-lg bg-amber text-bg font-bold text-xs"
                  >
                    List
                  </button>
                </div>
                <div className="text-[10px] text-text-muted">
                  Listing fee: {fee.toLocaleString()}cr (10%)
                </div>
              </MobileCard>
            );
          })}
        </div>
      )}

      {/* ── My Listings ─────────────────────────────────────────────── */}
      {market.activeTab === 'mylistings' && (
        <div className="space-y-2">
          {myListings.length === 0 && (
            <div className="text-center text-xs text-text-muted py-8">
              You have no active listings.
            </div>
          )}
          {myListings.map((l) => (
            <MobileCard key={l.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-text-primary">{l.itemSnapshot.name}</div>
                <div className="text-xs text-amber font-black">{l.price.toLocaleString()}cr</div>
              </div>
              <div className="text-[10px] text-text-muted">
                {l.itemSnapshot.rarity}
                {l.itemSnapshot.level != null && <> • Lv.{l.itemSnapshot.level}</>}
                {l.itemSnapshot.weaponType && <> • {l.itemSnapshot.weaponType}</>}
                {'hp' in l.itemSnapshot && <> • Shield</>}
                {'treeBonus' in l.itemSnapshot && <> • Class Mod</>}
                {'effect' in l.itemSnapshot && 'damage' in l.itemSnapshot && <> • Ordnance</>}
              </div>
              <button
                onClick={() => handleCancelListing(l)}
                className="w-full py-2 rounded-lg bg-red-600 text-bg font-bold text-xs hover:bg-red-500 transition-colors"
              >
                Cancel Listing
              </button>
            </MobileCard>
          ))}
        </div>
      )}

      {/* ── History ─────────────────────────────────────────────────── */}
      {market.activeTab === 'history' && (
        <div className="space-y-2">
          {market.history.length === 0 && (
            <div className="text-center text-xs text-text-muted py-8">
              No transactions yet.
            </div>
          )}
          {market.history.map((h) => (
            <MobileCard key={h.id} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-text-primary">{h.itemName}</div>
                <div className={`text-xs font-black ${h.type === 'buy' ? 'text-red-400' : 'text-green-400'}`}>
                  {h.type === 'buy' ? '-' : '+'}{h.price.toLocaleString()}cr
                </div>
              </div>
              <div className="flex items-center justify-between text-[10px] text-text-muted">
                <span>{historyPartyLabel(h)}</span>
                <span>{h.itemRarity}</span>
              </div>
            </MobileCard>
          ))}
        </div>
      )}

      {/* ── Toast / confirmation ───────────────────────────────────── */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-surface-raised border border-border rounded-xl px-4 py-2.5 shadow-lg max-w-[90vw]"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-primary">{toastMessage}</span>
              <button onClick={() => setToastMessage(null)} className="text-text-muted hover:text-text-primary">
                <X size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
