import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter, History, List, Lock, RefreshCw, Search, X } from 'lucide-react';
import { GearInspectSheet } from '@/components/gear/GearInspectSheet';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { GearCompare } from '@/components/gear/GearCompare';
import { useAuth } from '@/auth/AuthProvider';
import { useInventoryStore, useLoadoutStore, useMarketStore, usePlayerStore, useSkillStore } from '@/store';
import { RARITIES } from '@/constants/rarities';
import { CONSUMABLES } from '@/constants/consumables';
import { WEAPON_TYPES } from '@/constants/weaponTypes';
import { ELEMENTS } from '@/constants/elements';
import { isFoundSource, marketFeeForPrice, marketFeeReduction } from '@/lib/market/marketFee';
import {
  CORE_DISPLAY_NAME,
  CORE_IDENTITY_KEY,
  FRAGMENT_DISPLAY_NAME,
  FRAGMENT_IDENTITY_KEY,
  MARKET_CATEGORY_LABELS,
  consumableIdentityKey,
  essenceDisplayName,
  essenceIdentityKey,
  gearIdentityKeyForItem,
  materialIdentityKey,
  type MarketCategory,
} from '@/lib/market/identityKey';
import type { PriceStats } from '@/lib/market/priceStats';
import type { MarketListingQuery, MarketSort } from '@/lib/market/listingQuery';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { VendorScreen } from './VendorScreen';
import { RepairBoard } from '@/components/market/RepairBoard';
import { ShieldTechBoard } from '@/components/market/ShieldTechBoard';
import { useEconomyTransactLock } from '@/auth/useEconomyTransactLock';
import { MaterialUsageSheet } from '@/components/common/MaterialUsageSheet';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { fetchMarketListings, fetchMyMarketListings } from '@/lib/api/marketListings';
import { fetchPriceStats } from '@/lib/api/marketPriceStats';
import type { GearItem, Weapon } from '@/types/items';
import type { Listing, MarketHistory } from '@/types/market';
import { gearCardSummary } from '@/lib/gear/gearCardSummary';

const getNow = () => Date.now();

type SellSort = 'power' | 'rarity' | 'name';
type MyListSort = 'price' | 'rarity' | 'name';

const TABS: { id: string; label: string; px?: PxIconName; icon?: React.ElementType }[] = [
  { id: 'buy', label: 'Buy', px: 'coin' },
  { id: 'vendor', label: 'Vendor', px: 'vendor' },
  { id: 'sell', label: 'Sell', px: 'tag' },
  { id: 'mylistings', label: 'My Listings', icon: List },
  { id: 'history', label: 'History', icon: History },
  { id: 'repair', label: 'Repair Services', px: 'wrench' },
  { id: 'shieldTech', label: 'Shield Tech', px: 'shield' },
];

const BUY_CATEGORIES: { id: MarketCategory | null; label: string }[] = [
  { id: null, label: 'All' },
  ...Object.entries(MARKET_CATEGORY_LABELS).map(([id, label]) => ({ id: id as MarketCategory, label })),
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

/**
 * Display-only proceeds preview for the signed-in seller: the market
 * fee (lib/market/marketFee) net of their own Scavenger fee-reduction
 * bonuses. The server (cc_accept_listing) is the authority at sale
 * time; this only labels the price the seller is setting.
 */
function feePreview(price: number, bonuses: Record<string, number>, sourceTag?: string) {
  const breakdown = marketFeeForPrice(price, marketFeeReduction(bonuses, isFoundSource(sourceTag)));
  const pct = breakdown.effectiveRate * 100;
  const pctLabel = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0$/, '');
  return { ...breakdown, pctLabel };
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

/** Compact card for consumable/material/resource stack listings (0019, 0050). */
function StackMiniCard({ listing, right, onShowUsage }: { listing: Listing; right?: React.ReactNode; onShowUsage?: (materialId: string) => void }) {
  const icon: PxIconName = listing.kind === 'consumable'
    ? (listing.consumableType ? CONSUMABLES[listing.consumableType]?.visual.icon ?? 'flask' : 'flask')
    : listing.kind === 'fragment' ? 'frag'
    : listing.kind === 'core' ? 'core'
    : listing.kind === 'essence' ? 'gem'
    : 'pack';
  const meta = listing.kind === 'consumable'
    ? `Consumable · ${listing.quantity} × · ${Math.round(listing.qualityPercent ?? 100)}% quality`
    : listing.kind === 'fragment'
      ? `Cache Fragments · ${listing.quantity} ×`
      : listing.kind === 'core'
        ? `Legendary Cores · ${listing.quantity} ×`
        : listing.kind === 'essence'
          ? `Essence · ${listing.quantity} ×`
          : `Material · ${listing.quantity} ×`;
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-border bg-bg"><PxIcon name={icon} size={26} /></div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-black text-text-primary">{listing.displayName}</div>
        <div className="text-[10px] text-text-muted">{meta}</div>
        {listing.unitPrice > 0 && <div className="text-[9px] text-text-muted">{Math.round(listing.unitPrice).toLocaleString()}cr each</div>}
        {listing.kind === 'material' && listing.materialId && onShowUsage && (
          <button
            type="button"
            onClick={() => onShowUsage(listing.materialId!)}
            className="mt-0.5 text-[9px] font-black uppercase tracking-wide text-amber"
          >
            <span className="inline-flex items-center gap-0.5">Used in <PxIcon name="triR" size={13} /></span>
          </button>
        )}
      </div>
      {right}
    </div>
  );
}

/** Tiny price-history sparkline from real completed sales (0019). */
function PriceSparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 48;
  const h = 16;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const path = points
    .map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - 2 - ((p - min) / range) * (h - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden="true">
      <polyline points={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Sparkline + 7d trend for one identity key, from real sales. Renders nothing without sales. */
function PriceTrend({ stats }: { stats?: PriceStats }) {
  if (!stats || (stats.salesCount === 0 && stats.lastUnitPrice === null)) return null;
  const arrow = stats.trend === 'up' ? '▲' : stats.trend === 'down' ? '▼' : stats.trend === 'flat' ? '→' : '';
  const tone = stats.trend === 'up' ? 'text-green-400' : stats.trend === 'down' ? 'text-red-400' : 'text-text-muted';
  return (
    <div className={`flex items-center gap-1.5 text-[9px] ${tone}`}>
      <PriceSparkline points={stats.recentUnitPrices} />
      {stats.medianUnitPrice !== null && <span className="text-text-muted">median {Math.round(stats.medianUnitPrice).toLocaleString()}cr</span>}
      {arrow && stats.trendPct !== null && <span>{arrow} {Math.abs(Math.round(stats.trendPct * 100))}% / 7d</span>}
    </div>
  );
}

/** "Recent sales: median X · last Y · N sold" — the seller guidance line (0019). */
function SalesGuidance({ stats, perUnit }: { stats?: PriceStats; perUnit?: boolean }) {
  if (!stats || stats.salesCount === 0) return null;
  const unit = perUnit ? ' ea' : '';
  return (
    <div className="text-[10px] text-text-muted">
      Recent sales: median {Math.round(stats.medianUnitPrice ?? 0).toLocaleString()}cr{unit}
      {stats.lastUnitPrice !== null && <> · last {Math.round(stats.lastUnitPrice).toLocaleString()}cr{unit}</>}
      {' '}· {stats.salesCount} sold
    </div>
  );
}

export const MarketScreen: React.FC = () => {
  const market = useMarketStore();
  const inventory = useInventoryStore();
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const skillBonuses = useSkillStore().getBonuses();
  const { user } = useAuth();
  // Guest-visibility law (2026-11-01): every tab renders for every
  // session with real data — visibility is the enticement. The player-
  // economy lock lives on the TRANSACT actions only (Buy / List /
  // Cancel): a guest sees the button and its lock, and tapping it
  // raises the sign-in prompt instead of firing the op the server
  // would refuse ('Verified account required').
  const { locked: marketLocked, guardTransact, prompt: transactLockPrompt } = useEconomyTransactLock();
  const currentUserId = user?.id ?? null;
  const [search, setSearch] = useState('');
  const [sellSearch, setSellSearch] = useState('');
  const [myListSearch, setMyListSearch] = useState('');
  const [listingPrice, setListingPrice] = useState<Record<string, number>>({});
  const [stackQty, setStackQty] = useState<Record<string, number>>({});
  const [stackPrice, setStackPrice] = useState<Record<string, number>>({});
  const [filterRarity, setFilterRarity] = useState<string | null>(null);
  const [buyCategory, setBuyCategory] = useState<MarketCategory | null>(null);
  const [buyWeaponType, setBuyWeaponType] = useState<string | null>(null);
  const [buyElement, setBuyElement] = useState<string | null>(null);
  const [buyLevelMin, setBuyLevelMin] = useState('');
  const [buyLevelMax, setBuyLevelMax] = useState('');
  const [buyPriceMin, setBuyPriceMin] = useState('');
  const [buyPriceMax, setBuyPriceMax] = useState('');
  const [sellFilterRarity, setSellFilterRarity] = useState<string | null>(null);
  const [myListFilterRarity, setMyListFilterRarity] = useState<string | null>(null);
  const [buySort, setBuySort] = useState<MarketSort>('newest');
  const [sellSort, setSellSort] = useState<SellSort>('power');
  const [myListSort, setMyListSort] = useState<MyListSort>('price');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [inspectItem, setInspectItem] = useState<GearItem | null>(null);
  const [loadingListings, setLoadingListings] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [buyListings, setBuyListings] = useState<Listing[]>([]);
  const [buyTotal, setBuyTotal] = useState(0);
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [priceStats, setPriceStats] = useState<Record<string, PriceStats>>({});
  const [usageMaterialId, setUsageMaterialId] = useState<string | null>(null);
  const [pendingBuyId, setPendingBuyId] = useState<string | null>(null);
  const [pendingListId, setPendingListId] = useState<string | null>(null);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);

  // Guests land wherever the tab state points — every tab is
  // viewable now, so there is no vendor redirect on mount (the old
  // bounce existed only to keep guests from greeting the Locked
  // panel, which no longer exists).

  const buyQuery = useMemo<MarketListingQuery>(() => {
    const numOrUndef = (v: string) => {
      const n = Number(v);
      return v.trim() !== '' && Number.isFinite(n) ? n : undefined;
    };
    return {
      search: search || undefined,
      category: buyCategory ?? undefined,
      weaponType: buyWeaponType ?? undefined,
      element: buyElement ?? undefined,
      rarity: filterRarity ?? undefined,
      levelMin: numOrUndef(buyLevelMin),
      levelMax: numOrUndef(buyLevelMax),
      priceMin: numOrUndef(buyPriceMin),
      priceMax: numOrUndef(buyPriceMax),
      sort: buySort,
      excludeSellerId: currentUserId ?? undefined,
    };
  }, [search, buyCategory, buyWeaponType, buyElement, filterRarity, buyLevelMin, buyLevelMax, buyPriceMin, buyPriceMax, buySort, currentUserId]);

  // The displayed buy list: since 0019 the filtering happens
  // server-side, so the loaded page IS the filtered list (the name is
  // pinned by the visual-papercuts M1 source check).
  const filteredListings = buyListings;

  // Keep the shared market store stocked for surfaces that read it
  // (GearInspectSheet's market intel): the loaded buy page + mine.
  // Synced from the load callbacks (not an effect) via refs.
  const buyListingsRef = React.useRef<Listing[]>([]);
  const myListingsRef = React.useRef<Listing[]>([]);
  const setSharedListings = useMarketStore((s) => s.setListings);
  const syncSharedListings = useCallback(() => {
    setSharedListings([...buyListingsRef.current, ...myListingsRef.current]);
  }, [setSharedListings]);

  const fetchBuyPage = useCallback(async (offset: number, append: boolean) => {
    if (offset === 0) setLoadingListings(true);
    try {
      const page = await fetchMarketListings({ ...buyQuery, limit: 25, offset });
      setBuyTotal(page.total);
      const next = append ? [...buyListingsRef.current, ...page.listings] : page.listings;
      buyListingsRef.current = next;
      setBuyListings(next);
      syncSharedListings();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to load market listings.');
    } finally {
      if (offset === 0) setLoadingListings(false);
    }
  }, [buyQuery, setToastMessage, syncSharedListings]);

  const refreshMine = useCallback(async () => {
    if (!currentUserId) {
      myListingsRef.current = [];
      setMyListings([]);
      syncSharedListings();
      return;
    }
    try {
      const rows = await fetchMyMarketListings(currentUserId);
      myListingsRef.current = rows;
      setMyListings(rows);
      syncSharedListings();
    } catch {
      // My Listings failing must not take the Buy tab down with it.
    }
  }, [currentUserId, syncSharedListings]);

  // Debounced server browse: any filter/sort change restarts page 1.
  useEffect(() => {
    const t = setTimeout(() => { void fetchBuyPage(0, false); }, 200);
    return () => clearTimeout(t);
  }, [fetchBuyPage]);

  // Deferred a tick so the no-user branch's state reset is not a
  // synchronous setState inside the effect body.
  useEffect(() => {
    const t = setTimeout(() => { void refreshMine(); }, 0);
    return () => clearTimeout(t);
  }, [refreshMine]);

  // Price intelligence for everything on screen: buy rows, sell
  // candidates (gear, consumable batches, materials), my listings.
  const statsKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const l of buyListings) if (l.identityKey) keys.add(l.identityKey);
    for (const l of myListings) if (l.identityKey) keys.add(l.identityKey);
    for (const item of inventory.items) keys.add(gearIdentityKeyForItem(item));
    for (const batch of player.consumableBatches) keys.add(consumableIdentityKey(batch.consumable_type, batch.quality_percent));
    for (const key of Object.keys(player.materials)) keys.add(materialIdentityKey(key));
    // Sellable resources (0050): price guidance for the stacks the
    // player could list right now.
    if (player.cacheKeyFragments > 0) keys.add(FRAGMENT_IDENTITY_KEY);
    if (player.legendaryCores > 0) keys.add(CORE_IDENTITY_KEY);
    for (const [essenceId, count] of Object.entries(player.essences)) {
      if (count > 0) keys.add(essenceIdentityKey(essenceId));
    }
    return [...keys].sort().join(',');
  }, [buyListings, myListings, inventory.items, player.consumableBatches, player.materials, player.cacheKeyFragments, player.legendaryCores, player.essences]);

  useEffect(() => {
    if (!statsKeys) return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetchPriceStats(statsKeys.split(','))
        .then((stats) => { if (!cancelled) setPriceStats((prev) => ({ ...prev, ...stats })); })
        .catch(() => undefined);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [statsKeys]);

  const refreshListings = useCallback(async () => {
    await Promise.all([fetchBuyPage(0, false), refreshMine()]);
  }, [fetchBuyPage, refreshMine]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      await fetchBuyPage(buyListings.length, true);
    } finally {
      setLoadingMore(false);
    }
  };

  const tradeableItems = inventory.items.filter((i) => !i.isLocked);

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

  const sortedMyListings = useMemo(() => {
    return [...myListings]
      .filter((l) => !myListSearch || l.displayName.toLowerCase().includes(myListSearch.toLowerCase()))
      .filter((l) => !myListFilterRarity || l.rarity === myListFilterRarity)
      .sort((a, b) => {
        if (myListSort === 'price') return b.price - a.price;
        if (myListSort === 'rarity') {
          const rank: Record<string, number> = { Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5 };
          return (rank[b.rarity ?? ''] ?? 0) - (rank[a.rarity ?? ''] ?? 0);
        }
        return a.displayName.localeCompare(b.displayName);
      });
  }, [myListings, myListSearch, myListFilterRarity, myListSort]);

  const sellableBatches = player.consumableBatches.filter((b) => b.quantity > 0);
  const sellableMaterials = Object.entries(player.materials).filter(([, count]) => count > 0);
  const sellableEssences = Object.entries(player.essences).filter(([, count]) => count > 0);

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

  const handleListConsumable = async (batchId: string) => {
    const batch = player.consumableBatches.find((b) => b.id === batchId);
    if (!batch) return;
    const qty = Math.max(1, Math.min(batch.quantity, Math.floor(stackQty[batchId] ?? batch.quantity)));
    const stats = priceStats[consumableIdentityKey(batch.consumable_type, batch.quality_percent)];
    const fallback = Math.round((CONSUMABLES[batch.consumable_type]?.market.vendorPrice ?? 100) * qty);
    const price = stackPrice[batchId] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : fallback);
    if (price <= 0) {
      setToastMessage('Price must be positive.');
      return;
    }
    setPendingListId(batchId);
    try {
      await verifiedOps.marketCreateConsumable(batchId, qty, price);
      setToastMessage(`Listed ${qty} × ${batch.consumable_type} for ${price.toLocaleString()}cr.`);
      await refreshListings();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to list consumables.');
    } finally {
      setPendingListId(null);
    }
  };

  const handleListMaterial = async (materialId: string) => {
    const owned = player.materials[materialId] ?? 0;
    if (owned <= 0) return;
    const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[materialId] ?? owned)));
    const stats = priceStats[materialIdentityKey(materialId)];
    const price = stackPrice[materialId] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 100);
    if (price <= 0) {
      setToastMessage('Price must be positive.');
      return;
    }
    setPendingListId(materialId);
    try {
      await verifiedOps.marketCreateMaterial(materialId, qty, price);
      setToastMessage(`Listed ${qty} × ${materialId} for ${price.toLocaleString()}cr.`);
      await refreshListings();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to list materials.');
    } finally {
      setPendingListId(null);
    }
  };

  // Sellable resources (0050): fragment/core/essence stacks share the
  // materials qty/price state, keyed by their price-history identity
  // key ('frag:cache', 'core:legendary', 'ess:<id>') — collision-free
  // against batch uuids and material ids. The per-unit fallbacks only
  // seed the price field until real sales set a median.
  const handleListFragment = async () => {
    const owned = player.cacheKeyFragments;
    if (owned <= 0) return;
    const key = FRAGMENT_IDENTITY_KEY;
    const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[key] ?? owned)));
    const stats = priceStats[key];
    const price = stackPrice[key] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 250);
    if (price <= 0) {
      setToastMessage('Price must be positive.');
      return;
    }
    setPendingListId(key);
    try {
      await verifiedOps.marketCreateFragment(qty, price);
      setToastMessage(`Listed ${qty} × ${FRAGMENT_DISPLAY_NAME} for ${price.toLocaleString()}cr.`);
      await refreshListings();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to list fragments.');
    } finally {
      setPendingListId(null);
    }
  };

  const handleListCore = async () => {
    const owned = player.legendaryCores;
    if (owned <= 0) return;
    const key = CORE_IDENTITY_KEY;
    const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[key] ?? owned)));
    const stats = priceStats[key];
    const price = stackPrice[key] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 2500);
    if (price <= 0) {
      setToastMessage('Price must be positive.');
      return;
    }
    setPendingListId(key);
    try {
      await verifiedOps.marketCreateCore(qty, price);
      setToastMessage(`Listed ${qty} × ${CORE_DISPLAY_NAME} for ${price.toLocaleString()}cr.`);
      await refreshListings();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to list cores.');
    } finally {
      setPendingListId(null);
    }
  };

  const handleListEssence = async (essenceId: string) => {
    const owned = player.essences[essenceId] ?? 0;
    if (owned <= 0) return;
    const key = essenceIdentityKey(essenceId);
    const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[key] ?? owned)));
    const stats = priceStats[key];
    const price = stackPrice[key] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 500);
    if (price <= 0) {
      setToastMessage('Price must be positive.');
      return;
    }
    setPendingListId(key);
    try {
      await verifiedOps.marketCreateEssence(essenceId, qty, price);
      setToastMessage(`Listed ${qty} × ${essenceDisplayName(essenceId)} for ${price.toLocaleString()}cr.`);
      await refreshListings();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to list essences.');
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
      market.addHistory({ id: listing.id, type: 'buy', itemId: listing.itemId ?? listing.id, itemName: listing.displayName || 'Unknown', itemRarity: listing.rarity || (listing.kind === 'consumable' ? 'Consumable' : listing.kind === 'material' ? 'Material' : listing.kind === 'fragment' ? 'Cache Fragment' : listing.kind === 'core' ? 'Legendary Core' : listing.kind === 'essence' ? 'Essence' : 'Common'), price: listing.price, fee: 0, otherPartyId: listing.sellerId, timestamp: getNow() });
      setToastMessage(`Bought "${listing.displayName}" for ${listing.price.toLocaleString()}cr.`);
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
      setToastMessage(listing.kind === 'gear' ? 'Listing cancelled. Item returned to inventory.' : 'Listing cancelled. Stack returned.');
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
    setBuyCategory(null);
    setBuyWeaponType(null);
    setBuyElement(null);
    setBuyLevelMin('');
    setBuyLevelMax('');
    setBuyPriceMin('');
    setBuyPriceMax('');
    setToastMessage('Market filters cleared.');
  };

  const hasBuyFilters = Boolean(search || filterRarity || buyCategory || buyWeaponType || buyElement || buyLevelMin || buyLevelMax || buyPriceMin || buyPriceMax);

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

  const filterInputCls = 'w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-muted';

  return (
    <div className="space-y-3 p-4 pb-20">
      <ResourceBar />

      {/* Phone-width contract (device feedback r2): six tabs in an
          even 3×2 grid — the old flex-wrap broke 4+2 with uneven tab
          widths, and "Repair Services" squeezed against its 60px
          floor. Grid cells give every label room and ≥44px targets. */}
      <div className="grid grid-cols-3 gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => market.setActiveTab(t.id)}
            aria-label={t.label}
            className={`relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl border py-2 text-[10px] font-bold transition-colors ${market.activeTab === t.id ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`}
          >
            {t.icon ? <t.icon size={16} /> : t.px ? <PxIcon name={t.px} size={17} /> : null}
            <span className="flex items-center gap-1 whitespace-nowrap">
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {transactLockPrompt}

      {market.activeTab === 'vendor' && <VendorScreen />}

      {market.activeTab !== 'vendor' && (
        <>
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
              disabled={!hasBuyFilters}
              aria-label="Clear market filters"
              className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-text-muted transition-colors active:text-amber disabled:opacity-40"
            >
              <Filter size={14} />
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {BUY_CATEGORIES.map((c) => <button key={c.label} onClick={() => setBuyCategory(c.id)} className={`whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-bold ${buyCategory === c.id ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`}>{c.label}</button>)}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map((r) => <button key={r} onClick={() => setFilterRarity(filterRarity === r ? null : r)} className={`whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-bold ${filterRarity === r ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`}>{r}</button>)}
          </div>
          {(buyCategory === null || buyCategory === 'weapon') && (
            <div className="flex gap-2">
              <select
                value={buyWeaponType ?? ''}
                onChange={(e) => setBuyWeaponType(e.target.value || null)}
                className="flex-1 text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
              >
                <option value="">Any weapon type</option>
                {Object.values(WEAPON_TYPES).map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
              </select>
              <select
                value={buyElement ?? ''}
                onChange={(e) => setBuyElement(e.target.value || null)}
                className="flex-1 text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
              >
                <option value="">Any element</option>
                {Object.keys(ELEMENTS).map((el) => <option key={el} value={el}>{el}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2">
            <input value={buyLevelMin} onChange={(e) => setBuyLevelMin(e.target.value)} inputMode="numeric" placeholder="Lv min" className={filterInputCls} />
            <input value={buyLevelMax} onChange={(e) => setBuyLevelMax(e.target.value)} inputMode="numeric" placeholder="Lv max" className={filterInputCls} />
            <input value={buyPriceMin} onChange={(e) => setBuyPriceMin(e.target.value)} inputMode="numeric" placeholder="Min cr" className={filterInputCls} />
            <input value={buyPriceMax} onChange={(e) => setBuyPriceMax(e.target.value)} inputMode="numeric" placeholder="Max cr" className={filterInputCls} />
          </div>
          <div className="flex items-center justify-between">
            <select
              value={buySort}
              onChange={(e) => setBuySort(e.target.value as MarketSort)}
              className="text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
            >
              <option value="newest">Sort: Newest</option>
              <option value="price_asc">Sort: Cheapest</option>
              <option value="price_desc">Sort: Priciest</option>
              <option value="rarity">Sort: Rarity ↓</option>
              <option value="level">Sort: Level ↓</option>
              <option value="name">Sort: Name A-Z</option>
            </select>
            {!loadingListings && <span className="text-[10px] text-text-muted">{buyTotal.toLocaleString()} listing{buyTotal === 1 ? '' : 's'}</span>}
          </div>
          <div className="space-y-2">
            {!loadingListings && filteredListings.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No listings found. List your own gear from the Sell tab.</div>}
            {filteredListings.map((listing) => {
              const seller = formatSellerName(listing.sellerId, player.name, currentUserId);
              const stats = listing.identityKey ? priceStats[listing.identityKey] : undefined;
              return (
                <div key={listing.id} className="bl-card space-y-2">
                  {listing.kind === 'gear' && listing.itemSnapshot ? (
                    <GearMiniCard item={listing.itemSnapshot} compareItem={equippedForComparison(listing.itemSnapshot, loadout)} onInspect={() => setInspectItem(listing.itemSnapshot)} right={<div className="text-right text-xs font-black text-amber">{listing.price.toLocaleString()}cr<div className="text-[9px] text-text-muted">{seller}</div></div>} />
                  ) : (
                    <StackMiniCard listing={listing} onShowUsage={setUsageMaterialId} right={<div className="text-right text-xs font-black text-amber">{listing.price.toLocaleString()}cr<div className="text-[9px] text-text-muted">{seller}</div></div>} />
                  )}
                  <PriceTrend stats={stats} />
                  <button onClick={() => guardTransact('buy', () => void handleBuy(listing))} disabled={pendingBuyId === listing.id || (!marketLocked && player.credits < listing.price)} className="w-full rounded-lg bg-green py-2 text-xs font-bold text-bg disabled:opacity-40">
                    {pendingBuyId === listing.id ? 'Buying…' : (<>Buy Now{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                  </button>
                </div>
              );
            })}
          </div>
          {buyListings.length < buyTotal && (
            <button onClick={loadMore} disabled={loadingMore} className="w-full rounded-lg border border-border bg-surface-raised py-2 text-xs font-bold text-text-secondary disabled:opacity-50">
              {loadingMore ? 'Loading…' : `Load more (${(buyTotal - buyListings.length).toLocaleString()} more)`}
            </button>
          )}
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
            const preview = feePreview(price, skillBonuses, item.sourceTag);
            const stats = priceStats[gearIdentityKeyForItem(item)];
            return (
              <div key={item.id} className="bl-card space-y-2">
                <GearMiniCard item={item} onInspect={() => setInspectItem(item)} />
                <div className="flex items-center gap-2">
                  <input type="number" value={price} onChange={(e) => setListingPrice((p) => ({ ...p, [item.id]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" />
                  <button onClick={() => guardTransact('sell', () => void handleList(item.id))} disabled={pendingListId === item.id} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                    {pendingListId === item.id ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                  </button>
                </div>
                <SalesGuidance stats={stats} />
                <div className="text-[10px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
              </div>
            );
          })}

          {sellableBatches.length > 0 && (
            <>
              <div className="pt-2 text-[10px] font-black uppercase tracking-wider text-text-muted">Consumables</div>
              {sellableBatches.map((batch) => {
                const key = consumableIdentityKey(batch.consumable_type, batch.quality_percent);
                const stats = priceStats[key];
                const qty = Math.max(1, Math.min(batch.quantity, Math.floor(stackQty[batch.id] ?? batch.quantity)));
                const fallback = Math.round((CONSUMABLES[batch.consumable_type]?.market.vendorPrice ?? 100) * qty);
                const price = stackPrice[batch.id] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : fallback);
                const preview = feePreview(Math.max(0, price), skillBonuses);
                return (
                  <div key={batch.id} className="bl-card space-y-2">
                    <StackMiniCard onShowUsage={setUsageMaterialId} listing={{ id: batch.id, sellerId: currentUserId ?? '', sellerName: '', sellerType: 'player', kind: 'consumable', itemId: null, itemSnapshot: null, category: 'consumable', displayName: CONSUMABLES[batch.consumable_type]?.name ?? batch.consumable_type, quantity: batch.quantity, qualityPercent: batch.quality_percent, consumableType: batch.consumable_type, materialId: null, essenceId: null, identityKey: key, weaponType: null, element: null, rarity: null, itemLevel: null, price: 0, unitPrice: 0, listedAt: 0, feePaid: 0 }} />
                    <div className="flex items-center gap-2">
                      <input type="number" value={qty} min={1} max={batch.quantity} onChange={(e) => setStackQty((p) => ({ ...p, [batch.id]: Number(e.target.value) }))} className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Quantity" />
                      <input type="number" value={price} onChange={(e) => setStackPrice((p) => ({ ...p, [batch.id]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Total price" />
                      <button onClick={() => guardTransact('sell', () => void handleListConsumable(batch.id))} disabled={pendingListId === batch.id} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === batch.id ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} perUnit />
                    <div className="text-[10px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })}
            </>
          )}

          {sellableMaterials.length > 0 && (
            <>
              <div className="pt-2 text-[10px] font-black uppercase tracking-wider text-text-muted">Materials</div>
              {sellableMaterials.map(([materialId, owned]) => {
                const key = materialIdentityKey(materialId);
                const stats = priceStats[key];
                const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[materialId] ?? owned)));
                const price = stackPrice[materialId] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 100);
                const preview = feePreview(Math.max(0, price), skillBonuses);
                return (
                  <div key={materialId} className="bl-card space-y-2">
                    <StackMiniCard onShowUsage={setUsageMaterialId} listing={{ id: materialId, sellerId: currentUserId ?? '', sellerName: '', sellerType: 'player', kind: 'material', itemId: null, itemSnapshot: null, category: 'material', displayName: materialId, quantity: owned, qualityPercent: null, consumableType: null, materialId, essenceId: null, identityKey: key, weaponType: null, element: null, rarity: null, itemLevel: null, price: 0, unitPrice: 0, listedAt: 0, feePaid: 0 }} />
                    <div className="flex items-center gap-2">
                      <input type="number" value={qty} min={1} max={owned} onChange={(e) => setStackQty((p) => ({ ...p, [materialId]: Number(e.target.value) }))} className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Quantity" />
                      <input type="number" value={price} onChange={(e) => setStackPrice((p) => ({ ...p, [materialId]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Total price" />
                      <button onClick={() => guardTransact('sell', () => void handleListMaterial(materialId))} disabled={pendingListId === materialId} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === materialId ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} perUnit />
                    <div className="text-[10px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })}
            </>
          )}

          {player.cacheKeyFragments > 0 && (
            <>
              <div className="pt-2 text-[10px] font-black uppercase tracking-wider text-text-muted">Cache Fragments</div>
              {(() => {
                const key = FRAGMENT_IDENTITY_KEY;
                const owned = player.cacheKeyFragments;
                const stats = priceStats[key];
                const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[key] ?? owned)));
                const price = stackPrice[key] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 250);
                const preview = feePreview(Math.max(0, price), skillBonuses);
                return (
                  <div className="bl-card space-y-2">
                    <StackMiniCard listing={{ id: key, sellerId: currentUserId ?? '', sellerName: '', sellerType: 'player', kind: 'fragment', itemId: null, itemSnapshot: null, category: 'fragment', displayName: FRAGMENT_DISPLAY_NAME, quantity: owned, qualityPercent: null, consumableType: null, materialId: null, essenceId: null, identityKey: key, weaponType: null, element: null, rarity: null, itemLevel: null, price: 0, unitPrice: 0, listedAt: 0, feePaid: 0 }} />
                    <div className="flex items-center gap-2">
                      <input type="number" value={qty} min={1} max={owned} onChange={(e) => setStackQty((p) => ({ ...p, [key]: Number(e.target.value) }))} className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Quantity" />
                      <input type="number" value={price} onChange={(e) => setStackPrice((p) => ({ ...p, [key]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Total price" />
                      <button onClick={() => guardTransact('sell', () => void handleListFragment())} disabled={pendingListId === key} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === key ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} perUnit />
                    <div className="text-[10px] text-text-muted">Listed fragments are held in escrow — they can't auto-convert into cache keys while listed.</div>
                    <div className="text-[10px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })()}
            </>
          )}

          {player.legendaryCores > 0 && (
            <>
              <div className="pt-2 text-[10px] font-black uppercase tracking-wider text-text-muted">Legendary Cores</div>
              {(() => {
                const key = CORE_IDENTITY_KEY;
                const owned = player.legendaryCores;
                const stats = priceStats[key];
                const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[key] ?? owned)));
                const price = stackPrice[key] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 2500);
                const preview = feePreview(Math.max(0, price), skillBonuses);
                return (
                  <div className="bl-card space-y-2">
                    <StackMiniCard listing={{ id: key, sellerId: currentUserId ?? '', sellerName: '', sellerType: 'player', kind: 'core', itemId: null, itemSnapshot: null, category: 'core', displayName: CORE_DISPLAY_NAME, quantity: owned, qualityPercent: null, consumableType: null, materialId: null, essenceId: null, identityKey: key, weaponType: null, element: null, rarity: null, itemLevel: null, price: 0, unitPrice: 0, listedAt: 0, feePaid: 0 }} />
                    <div className="flex items-center gap-2">
                      <input type="number" value={qty} min={1} max={owned} onChange={(e) => setStackQty((p) => ({ ...p, [key]: Number(e.target.value) }))} className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Quantity" />
                      <input type="number" value={price} onChange={(e) => setStackPrice((p) => ({ ...p, [key]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Total price" />
                      <button onClick={() => guardTransact('sell', () => void handleListCore())} disabled={pendingListId === key} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === key ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} perUnit />
                    <div className="text-[10px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })()}
            </>
          )}

          {sellableEssences.length > 0 && (
            <>
              <div className="pt-2 text-[10px] font-black uppercase tracking-wider text-text-muted">Essences</div>
              {sellableEssences.map(([essenceId, owned]) => {
                const key = essenceIdentityKey(essenceId);
                const stats = priceStats[key];
                const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[key] ?? owned)));
                const price = stackPrice[key] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 500);
                const preview = feePreview(Math.max(0, price), skillBonuses);
                return (
                  <div key={essenceId} className="bl-card space-y-2">
                    <StackMiniCard listing={{ id: essenceId, sellerId: currentUserId ?? '', sellerName: '', sellerType: 'player', kind: 'essence', itemId: null, itemSnapshot: null, category: 'essence', displayName: essenceDisplayName(essenceId), quantity: owned, qualityPercent: null, consumableType: null, materialId: null, essenceId, identityKey: key, weaponType: null, element: null, rarity: null, itemLevel: null, price: 0, unitPrice: 0, listedAt: 0, feePaid: 0 }} />
                    <div className="flex items-center gap-2">
                      <input type="number" value={qty} min={1} max={owned} onChange={(e) => setStackQty((p) => ({ ...p, [key]: Number(e.target.value) }))} className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Quantity" />
                      <input type="number" value={price} onChange={(e) => setStackPrice((p) => ({ ...p, [key]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Total price" />
                      <button onClick={() => guardTransact('sell', () => void handleListEssence(essenceId))} disabled={pendingListId === key} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === key ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} perUnit />
                    <div className="text-[10px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })}
            </>
          )}
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
          {sortedMyListings.map((listing) => {
            const preview = feePreview(listing.price, skillBonuses, listing.itemSnapshot?.sourceTag);
            return (
            <div key={listing.id} className="bl-card space-y-2">
              {listing.kind === 'gear' && listing.itemSnapshot ? (
                <GearMiniCard item={listing.itemSnapshot} onInspect={() => setInspectItem(listing.itemSnapshot)} right={<div className="text-right text-xs font-black text-amber">{listing.price.toLocaleString()}cr</div>} />
              ) : (
                <StackMiniCard listing={listing} onShowUsage={setUsageMaterialId} right={<div className="text-right text-xs font-black text-amber">{listing.price.toLocaleString()}cr</div>} />
              )}
              <div className="text-[10px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
              <button onClick={() => guardTransact('cancel a listing', () => void handleCancelListing(listing))} disabled={pendingCancelId === listing.id} className="w-full rounded-lg bg-red-600 py-2 text-xs font-bold text-bg hover:bg-red-500 disabled:opacity-50">
                {pendingCancelId === listing.id ? 'Cancelling…' : (<>Cancel Listing{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
              </button>
            </div>
            );
          })}
        </div>
      )}

      {market.activeTab === 'repair' && <RepairBoard />}
      {market.activeTab === 'shieldTech' && <ShieldTechBoard />}

      {market.activeTab === 'history' && (
        <div className="space-y-2">
          {market.history.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No transactions yet.</div>}
          {market.history.map((h) => <div key={h.id} className="bl-card space-y-1.5"><div className="flex items-center justify-between"><div className="text-xs font-bold text-text-primary">{h.itemName}</div><div className={`text-xs font-black ${h.type === 'buy' ? 'text-red-400' : 'text-green-400'}`}>{h.type === 'buy' ? '-' : '+'}{h.price.toLocaleString()}cr</div></div><div className="flex items-center justify-between text-[10px] text-text-muted"><span>{historyPartyLabel(h)}</span><span>{h.itemRarity}</span></div></div>)}
        </div>
      )}

        </>
      )}

      <GearInspectSheet item={inspectItem} open={!!inspectItem} onClose={() => setInspectItem(null)} contextLabel="Market Inspect" />

      <MaterialUsageSheet materialId={usageMaterialId} onClose={() => setUsageMaterialId(null)} />

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
