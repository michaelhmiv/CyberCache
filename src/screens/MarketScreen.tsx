import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Filter, Lock, RefreshCw, Search, X } from 'lucide-react';
import { GearInspectSheet } from '@/components/gear/GearInspectSheet';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { GearCompare } from '@/components/gear/GearCompare';
import { useAuth } from '@/auth/AuthProvider';
import { useInventoryStore, useLoadoutStore, useMarketStore, usePlayerStore, useSkillStore } from '@/store';
import { useCosmeticsStore } from '@/store/slices/cosmeticsSlice';
import { CosmeticMiniCard } from '@/components/market/CosmeticMiniCard';
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
  vehicleIdentityKey,
  type MarketCategory,
} from '@/lib/market/identityKey';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { conditionFraction, getVehicleClass } from '@/lib/vehicles/vehicles';
import { VehicleSprite } from '@/components/gear/GaragePanel';
import type { PriceStats } from '@/lib/market/priceStats';
import type { MarketListingQuery, MarketSort } from '@/lib/market/listingQuery';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { ChipRail } from '@/components/common/ChipRail';
import { PickerSheet } from '@/components/common/PickerSheet';
import { listEntranceProps, stopTransitionProps } from '@/lib/animation/uiMotion';
import { VendorScreen } from './VendorScreen';
import { RepDeskPanel } from '@/components/vendor/RepDeskPanel';
import { DataSlotsPanel } from '@/components/vendor/DataSlotsPanel';
import { sellerDisplayName, historyPartyName } from '@/lib/market/sellerDisplay';
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

/**
 * The Market rail (DESIGN.md §2/§6): one horizontally scrolling
 * rail of stops at honest type size — it replaces the 3×2 tile
 * grid that ate the whole first viewport (the alignment audit's
 * #1 space tax). Every stop shares one height, one left edge, one
 * gap (the ChipRail track); the rail scrolls, labels never shrink
 * below the 11px floor. Rep Desk and Slots are first-class stops:
 * standing's canonical door and the slot machine's canonical home.
 * The rail carries exactly §2's seven stops — My Listings and
 * History are segments of the Sell stop (SELL_SEGMENTS below),
 * not stops of their own.
 */
const STOPS: { id: string; label: string; px: PxIconName }[] = [
  { id: 'buy', label: 'Buy', px: 'basket' },
  { id: 'sell', label: 'Sell', px: 'tag' },
  { id: 'vendor', label: 'Vendor', px: 'vendor' },
  { id: 'repair', label: 'Repair', px: 'wrench' },
  { id: 'shieldTech', label: 'Shield Tech', px: 'shield' },
  { id: 'repdesk', label: 'Rep Desk', px: 'badge' },
  { id: 'slots', label: 'Slots', px: 'bolt' },
];

/** The Sell stop's segments (DESIGN.md §2): the listing form, the
 *  seller's own live listings ("Mine"), and their trade History.
 *  One stop, three segments — the segment control at the top of
 *  the stop switches between them. */
type SellSegment = 'sell' | 'mine' | 'history';
const SELL_SEGMENTS: { id: SellSegment; label: string }[] = [
  { id: 'sell', label: 'Sell' },
  { id: 'mine', label: 'Mine' },
  { id: 'history', label: 'History' },
];

/** One chip geometry for every chip row in the tab (§6: one left
 *  edge, one height, one gap — rows ride the ChipRail track). */
const chipCls = (active: boolean) =>
  `flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-[11px] font-bold ${active ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`;

/** The Sell stop's segment control shares the rail's rectangular
 *  geometry (§6): one height, square corners, active = amber fill —
 *  no skewed or rounded sibling shapes in the same row system. */
const segmentCls = (active: boolean) =>
  `flex min-h-[44px] flex-1 items-center justify-center border px-3 text-[11px] font-black transition-colors ${active ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`;

const BUY_CATEGORIES: { id: MarketCategory | null; label: string }[] = [
  { id: null, label: 'All' },
  ...Object.entries(MARKET_CATEGORY_LABELS).map(([id, label]) => ({ id: id as MarketCategory, label })),
];

/** Short sort names for the Filters door on the Buy lane (F3): the
 *  door prints the CURRENT sort so the query state is visible
 *  without opening the sheet. */
const BUY_SORT_LABELS: Record<MarketSort, string> = {
  newest: 'Newest',
  price_asc: 'Cheapest',
  price_desc: 'Priciest',
  rarity: 'Rarity',
  level: 'Level',
  name: 'Name',
};

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
          <div className="text-xs font-black leading-snug" style={{ color }}>{item.name}</div>
          <div className="text-[11px] text-text-muted">{item.rarity} · Lv.{item.level ?? 1} · {itemKind(item)}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {summary.primaryStats.slice(0, 3).map((stat) => (
              <span key={stat.label} className="inline-flex items-center gap-0.5 whitespace-nowrap rounded border border-border bg-bg px-1 py-0.5 text-[11px]">
                <span className="text-text-muted">{stat.label}</span>
                <span className={`font-bold ${stat.tone ?? 'text-text-primary'}`}>{stat.value}</span>
              </span>
            ))}
          </div>
          {summary.badges[0] && (
            // QC A8: the badge line carries stat values (activity
            // module rates) — it wraps, never ellipsizes. Values on
            // a card print in full or not at all.
            <div className="text-[11px] text-amber mt-0.5 leading-snug">{summary.badges[0]}</div>
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

/**
 * Card for vehicle listings and sell candidates (0021): the ACTUAL
 * instance's sprite — class profile with its rolled affix overlays
 * and condition wear, the same derivation the Garage draws — plus
 * the class stats a buyer compares (yield, fuel burn) and the
 * instance's live condition. Vehicles are pure market goods (owner
 * ruling 2026-11-02): no level requirement appears here because
 * there is none — if you can buy it, you can drive it.
 */
function VehicleMiniCard({ vehicle }: { vehicle: VehicleDisplay }) {
  const def = getVehicleClass(vehicle.vehicleClassId);
  const color = rarityColor(vehicle.rarity);
  const conditionPct = Math.round(conditionFraction(vehicle.conditionCurrent, vehicle.conditionMax) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="flex w-[88px] shrink-0 items-center justify-center border border-border bg-bg p-1">
        <VehicleSprite vehicle={vehicle} widthClass="w-[80px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-black leading-snug" style={{ color }}>{vehicle.name}</div>
        <div className="text-[11px] text-text-muted">{vehicle.rarity} · Lv.{vehicle.level ?? 1} · {def?.displayName ?? vehicle.vehicleClassId}</div>
        <div className="flex flex-wrap gap-1 mt-1">
          {def && (
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded border border-border bg-bg px-1 py-0.5 text-[11px]">
              <span className="text-text-muted">Yield</span>
              <span className="font-bold text-text-primary">×{def.baseYield.toFixed(2)}</span>
            </span>
          )}
          {def && (
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded border border-border bg-bg px-1 py-0.5 text-[11px]">
              <span className="text-text-muted">Burn</span>
              <span className="font-bold text-text-primary">{def.fuelBurnPerTick.toFixed(1)}/tick</span>
            </span>
          )}
          <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded border border-border bg-bg px-1 py-0.5 text-[11px]">
            <span className="text-text-muted">Condition</span>
            <span className="font-bold text-text-primary">{conditionPct}%</span>
          </span>
          {def && def.materialYieldBonus > 0 && (
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded border border-border bg-bg px-1 py-0.5 text-[11px]">
              <span className="text-text-muted">Materials</span>
              <span className="font-bold text-text-primary">+{Math.round(def.materialYieldBonus * 100)}%</span>
            </span>
          )}
        </div>
        {vehicle.affixes.length > 0 && (
          <div className="text-[11px] text-amber mt-0.5 leading-snug">{vehicle.affixes[0].displayText}</div>
        )}
      </div>
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
        <div className="text-xs font-black leading-snug text-text-primary">{listing.displayName}</div>
        <div className="text-[11px] text-text-muted">{meta}</div>
        {listing.unitPrice > 0 && <div className="text-[11px] text-text-muted">{Math.round(listing.unitPrice).toLocaleString()}cr each</div>}
        {listing.kind === 'material' && listing.materialId && onShowUsage && (
          <button
            type="button"
            onClick={() => onShowUsage(listing.materialId!)}
            className="mt-0.5 text-[11px] font-black uppercase tracking-wide text-amber"
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
    <div className={`flex items-center gap-1.5 text-[11px] ${tone}`}>
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
    <div className="text-[11px] text-text-muted">
      Recent sales: median {Math.round(stats.medianUnitPrice ?? 0).toLocaleString()}cr{unit}
      {stats.lastUnitPrice !== null && <> · last {Math.round(stats.lastUnitPrice).toLocaleString()}cr{unit}</>}
      {' '}· {stats.salesCount} sold
    </div>
  );
}

interface MarketScreenProps {
  /** App navigation (the Strip's settings resident, DESIGN.md §1). */
  onNavigate?: (screen: string) => void;
}

const EMPTY_PARTS: import('@/content/skins').CosmeticPartItemView[] = [];

export const MarketScreen: React.FC<MarketScreenProps> = ({ onNavigate }) => {
  const market = useMarketStore();
  const reduceMotion = useReducedMotion();
  const inventory = useInventoryStore();
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const vehicles = useVehicleStore((s) => s.vehicles);
  const equippedVehicleId = useLoadoutStore((s) => s.slots.vehicle);
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
  // The Sell stop's active segment (§2): 'sell' the listing form,
  // 'mine' the player's own listings, 'history' their trade record.
  const [sellSegment, setSellSegment] = useState<SellSegment>('sell');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [inspectItem, setInspectItem] = useState<GearItem | null>(null);
  const [loadingListings, setLoadingListings] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [buyListings, setBuyListings] = useState<Listing[]>([]);
  const [buyTotal, setBuyTotal] = useState(0);
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [priceStats, setPriceStats] = useState<Record<string, PriceStats>>({});
  const [usageMaterialId, setUsageMaterialId] = useState<string | null>(null);
  const [showBuyFilters, setShowBuyFilters] = useState(false);
  const [pendingBuyId, setPendingBuyId] = useState<string | null>(null);
  const [pendingListId, setPendingListId] = useState<string | null>(null);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);

  // Guests land wherever the tab state points — every tab is
  // viewable now, so there is no vendor redirect on mount (the old
  // bounce existed only to keep guests from greeting the Locked
  // panel, which no longer exists).

  // Tab→stop deep link: consume the one-shot intent App recorded
  // for a 'market:<stop>' route (e.g. Home's Slots card) — land on
  // the named stop, then clear it so the intent never re-fires on
  // a later plain visit to the tab.
  const marketStopIntent = useMarketStore((s) => s.marketStopIntent);
  useEffect(() => {
    if (!marketStopIntent) return;
    useMarketStore.getState().setActiveTab(marketStopIntent.stop);
    useMarketStore.getState().clearMarketStopIntent();
  }, [marketStopIntent]);

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
    for (const vehicle of vehicles) keys.add(vehicleIdentityKey(vehicle.vehicleClassId, vehicle.rarity));
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
  }, [buyListings, myListings, inventory.items, vehicles, player.consumableBatches, player.materials, player.cacheKeyFragments, player.legendaryCores, player.essences]);

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

  // Vehicles list from their own store (they are not GearItem): an
  // owned, unlocked, spare vehicle can be listed like any other
  // instance — the server refuses equipped/in-service items, so
  // those never reach the button. The equip gate is ownership only
  // (owner ruling 2026-11-02), so no level filter applies here.
  const listableVehicles = vehicles
    .filter((v) => !v.isLocked && v.id !== equippedVehicleId && (!v.runtimeState || v.runtimeState === 'available'))
    .filter((v) => !sellSearch || v.name.toLowerCase().includes(sellSearch.toLowerCase())
      || (getVehicleClass(v.vehicleClassId)?.displayName ?? '').toLowerCase().includes(sellSearch.toLowerCase()))
    .filter((v) => !sellFilterRarity || v.rarity === sellFilterRarity);

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

  // Skin parts (0053): owned parts from the cosmetics view; listing
  // goes through the same market-create op (the server auto-unequips
  // a worn part inside the create). Default price guidance: the
  // part's identity median when stats know it, else 1,000cr.
  const cosmeticParts = useCosmeticsStore((st) => st.view?.parts ?? EMPTY_PARTS);
  const loadCosmetics = useCosmeticsStore((st) => st.load);
  const refreshCosmetics = useCosmeticsStore((st) => st.refresh);
  useEffect(() => { void loadCosmetics(); }, [loadCosmetics]);
  const handleListCosmetic = async (partItemId: string, displayName: string, price: number) => {
    if (price <= 0) {
      setToastMessage('Price must be positive.');
      return;
    }
    setPendingListId(partItemId);
    try {
      await verifiedOps.marketCreate(partItemId, price);
      setToastMessage(`Listed "${displayName}" for ${price.toLocaleString()}cr.`);
      await Promise.all([refreshListings(), refreshCosmetics()]);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to list part.');
    } finally {
      setPendingListId(null);
    }
  };

  // Vehicles list through the same market-create op as gear (the
  // server stamps kind/category/identity from the item itself).
  // Default price: the class+rarity median when stats know it, else
  // the gear-style level fallback with a floor — a Leviathan should
  // never prefill at pocket change.
  const handleListVehicle = async (vehicle: VehicleDisplay, price: number) => {
    if (price <= 0) {
      setToastMessage('Price must be positive.');
      return;
    }
    setPendingListId(vehicle.id);
    try {
      await verifiedOps.marketCreate(vehicle.id, price);
      setToastMessage(`Listed "${vehicle.name}" for ${price.toLocaleString()}cr.`);
      await refreshListings();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Unable to list vehicle.');
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
      void refreshCosmetics();
      market.addHistory({ id: listing.id, type: 'buy', itemId: listing.itemId ?? listing.id, itemName: listing.displayName || 'Unknown', itemRarity: listing.rarity || (listing.kind === 'consumable' ? 'Consumable' : listing.kind === 'material' ? 'Material' : listing.kind === 'fragment' ? 'Cache Fragment' : listing.kind === 'core' ? 'Legendary Core' : listing.kind === 'essence' ? 'Essence' : listing.kind === 'cosmetic' ? 'Skin Part' : 'Common'), price: listing.price, fee: 0, otherPartyId: listing.sellerId, timestamp: getNow() });
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
      setToastMessage(listing.kind === 'gear' || listing.kind === 'cosmetic' || listing.kind === 'vehicle' ? 'Listing cancelled. Item returned to inventory.' : 'Listing cancelled. Stack returned.');
      await refreshListings();
      if (listing.kind === 'cosmetic') void refreshCosmetics();
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

  // The Filters door's badge count (F3): only the detailed filters
  // that live inside the sheet — search, category and sort stay on
  // the lane itself and are not counted here.
  const activeBuyFilterCount = [filterRarity, buyWeaponType, buyElement, buyLevelMin, buyLevelMax, buyPriceMin, buyPriceMax].filter(Boolean).length;

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
    const name = historyPartyName(h.otherPartyId, player.name, currentUserId);
    return h.type === 'buy' ? `Bought from ${name}` : `Sold to ${name}`;
  };

  const filterInputCls = 'w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-muted';

  return (
    // Horizontal page pad is px-2.5 (0.625rem), NOT p-4: every other
    // Strip-bearing tab sits under .bl-page, whose density layer
    // (index.css) normalizes the page pad to --cc-page-pad 0.625rem,
    // giving the Strip a 386px column at the 412px reference width
    // (F1's fit invariant: row scrollWidth == clientWidth at
    // ordinary balances). Market's root is not a .bl-page, so a
    // true 16px p-4 narrowed the column to 374px — and the same
    // missing layer left the Strip row's gaps at 8px instead of
    // the normalized 6px (that half is pinned in ResourceBar
    // itself). Together they overflowed the row by ~13px and the
    // level digit clipped at the bar's right edge (parent-verified
    // on the F3 Buy capture; pinned in marketComposition.test.tsx).
    <div className="space-y-3 px-2.5 pt-4 pb-20">
      <ResourceBar onOpenSettings={onNavigate ? () => onNavigate('settings') : undefined} />

      {/* The rail: stops are destinations, current state lit.
          Listings now start in the first viewport — the rail is
          one row, not a tile grid. */}
      <ChipRail>
        {STOPS.map((t) => (
          <button
            key={t.id}
            onClick={() => market.setActiveTab(t.id)}
            aria-label={t.label}
            aria-pressed={market.activeTab === t.id}
            className={`flex min-h-[44px] shrink-0 items-center gap-1.5 border px-3 text-[11px] font-black transition-colors ${market.activeTab === t.id ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`}
          >
            <PxIcon name={t.px} size={17} />
            <span className="whitespace-nowrap">{t.label}</span>
          </button>
        ))}
      </ChipRail>

      {transactLockPrompt}

      {/* Stop transitions (§10): stops enter with weight instead of
          hard-cutting — the Gear tab's pattern (AnimatePresence
          mode="wait", fade + rise, collapsed under reduced motion). */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={market.activeTab} {...stopTransitionProps(reduceMotion)}>
      {market.activeTab === 'vendor' && <VendorScreen />}

      {market.activeTab === 'repdesk' && <RepDeskPanel />}

      {market.activeTab === 'slots' && <DataSlotsPanel />}

      {market.activeTab !== 'vendor' && market.activeTab !== 'repdesk' && market.activeTab !== 'slots' && (
        <>
      {market.activeTab === 'buy' && (
        <div className="space-y-3">
          {/* Listings-first chrome (drift-fix F3, mock m39;
              DESIGN.md §3: "Buy — filters in one sheet"). The lane
              itself keeps search, the category chips, the result
              count and the refresh; the detailed filters (rarity,
              weapon type, element, level/price ranges) and the sort
              move into ONE sheet behind the Filters door — the same
              state and handlers, so the query behavior is unchanged.
              The door prints the active-filter count and the current
              sort, so the query state is never hidden. */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" className="w-full rounded-lg border border-border bg-surface-raised py-2 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-muted" />
            </div>
            <button
              type="button"
              onClick={() => setShowBuyFilters(true)}
              aria-label="Open market filters"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-2 text-[11px] font-black text-text-primary transition-colors active:border-amber"
            >
              <Filter size={14} />
              <span className="whitespace-nowrap">Filters{activeBuyFilterCount > 0 ? ` (${activeBuyFilterCount})` : ''} · Sort: {BUY_SORT_LABELS[buySort]}</span>
              <PxIcon name="chevD" size={13} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <ChipRail className="min-w-0 flex-1">
              {BUY_CATEGORIES.map((c) => <button key={c.label} onClick={() => setBuyCategory(c.id)} className={chipCls(buyCategory === c.id)}>{c.label}</button>)}
            </ChipRail>
            <div className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-[11px] text-text-muted">{loadingListings ? 'Loading…' : `${buyTotal.toLocaleString()} listing${buyTotal === 1 ? '' : 's'}`}</span>
              <button
                type="button"
                onClick={refreshListings}
                disabled={loadingListings}
                aria-label="Refresh listings"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-raised text-text-secondary transition-colors hover:text-amber active:text-amber disabled:opacity-50"
              >
                <RefreshCw size={13} className={loadingListings ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {!loadingListings && filteredListings.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No listings found. List your own gear from the Sell stop.</div>}
            {filteredListings.map((listing, index) => {
              const seller = sellerDisplayName(listing, currentUserId);
              const stats = listing.identityKey ? priceStats[listing.identityKey] : undefined;
              return (
                <motion.div key={listing.id} {...listEntranceProps(index, reduceMotion)} className="bl-card p-2.5">
                  {/* Compact row (F3, mock m39; M4 adds the cosmetic
                      branch): item + seller/trend
                      in the flexible middle, price over a SMALL Buy
                      button in a fixed right column — the full-width
                      button band is gone, so rows run ~half the old
                      height and listings start high. Same handler,
                      same disabled rule, same lock-on-the-action. */}
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {listing.kind === 'gear' && listing.itemSnapshot ? (
                        <GearMiniCard item={listing.itemSnapshot} compareItem={equippedForComparison(listing.itemSnapshot, loadout)} onInspect={() => setInspectItem(listing.itemSnapshot)} />
                      ) : listing.kind === 'vehicle' && listing.vehicleSnapshot ? (
                        <VehicleMiniCard vehicle={listing.vehicleSnapshot} />
                      ) : listing.kind === 'cosmetic' ? (
                        <CosmeticMiniCard partId={listing.partId} name={listing.displayName} qualityPercent={listing.qualityPercent} tintPaletteId={listing.tintPaletteId} />
                      ) : (
                        <StackMiniCard listing={listing} onShowUsage={setUsageMaterialId} />
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <span className="text-[11px] text-text-muted">Seller · {seller}</span>
                        <PriceTrend stats={stats} />
                      </div>
                    </div>
                    <div className="flex w-[92px] shrink-0 flex-col items-end gap-1.5">
                      <div className="text-right text-xs font-black text-amber">{listing.price.toLocaleString()}cr</div>
                      <button onClick={() => guardTransact('buy', () => void handleBuy(listing))} disabled={pendingBuyId === listing.id || (!marketLocked && player.credits < listing.price)} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber px-2 py-2 text-[11px] font-bold text-bg disabled:opacity-40">
                        {pendingBuyId === listing.id ? 'Buying…' : (<>Buy Now{marketLocked && <PxIcon name="lock" size={13} aria-hidden />}</>)}
                      </button>
                    </div>
                  </div>
                </motion.div>
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

      {/* The Sell stop's segment control (§2): Sell · Mine ·
          History share the stop; the control sits at its top in
          the rail's rectangular geometry. */}
      {market.activeTab === 'sell' && (
        <div className="flex gap-2" role="tablist" aria-label="Sell">
          {SELL_SEGMENTS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={sellSegment === s.id}
              onClick={() => setSellSegment(s.id)}
              className={segmentCls(sellSegment === s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {market.activeTab === 'sell' && sellSegment === 'sell' && (
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
          {/* F3 chrome compression: the sort rides the rarity
              rail's row instead of taking a row of its own — same
              control, same options, one row higher for the items. */}
          <div className="flex items-center gap-2">
            <ChipRail className="min-w-0 flex-1">
              {['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map((r) => <button key={r} onClick={() => setSellFilterRarity(sellFilterRarity === r ? null : r)} className={chipCls(sellFilterRarity === r)}>{r}</button>)}
            </ChipRail>
            <select
              value={sellSort}
              onChange={(e) => setSellSort(e.target.value as SellSort)}
              className="shrink-0 border border-border bg-surface rounded-lg px-2 py-1.5 text-[11px] font-black uppercase text-text-primary"
            >
              <option value="power">Sort: Power ↓</option>
              <option value="rarity">Sort: Rarity ↓</option>
              <option value="name">Sort: Name A-Z</option>
            </select>
          </div>
          {sortedTradeableItems.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No tradeable items match. Unlock items from your inventory to list them.</div>}
          {sortedTradeableItems.map((item) => {
            const price = listingPrice[item.id] || defaultPrice(item);
            const preview = feePreview(price, skillBonuses, item.sourceTag);
            const stats = priceStats[gearIdentityKeyForItem(item)];
            return (
              <div key={item.id} className="bl-card space-y-2 p-2.5">
                <GearMiniCard item={item} onInspect={() => setInspectItem(item)} />
                <div className="flex items-center gap-2">
                  <input type="number" value={price} onChange={(e) => setListingPrice((p) => ({ ...p, [item.id]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" />
                  <button onClick={() => guardTransact('sell', () => void handleList(item.id))} disabled={pendingListId === item.id} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                    {pendingListId === item.id ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                  </button>
                </div>
                <SalesGuidance stats={stats} />
                <div className="text-[11px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
              </div>
            );
          })}

          {listableVehicles.length > 0 && (
            <>
              <div className="pt-2 text-[11px] font-black uppercase tracking-wider text-text-muted">Vehicles</div>
              {listableVehicles.map((vehicle) => {
                const stats = priceStats[vehicleIdentityKey(vehicle.vehicleClassId, vehicle.rarity)];
                const price = listingPrice[vehicle.id] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice) : Math.max(500, (vehicle.level ?? 1) * 200));
                const preview = feePreview(Math.max(0, price), skillBonuses, vehicle.sourceTag);
                return (
                  <div key={vehicle.id} className="bl-card space-y-2 p-2.5" data-testid={`sell-vehicle-${vehicle.id}`}>
                    <VehicleMiniCard vehicle={vehicle} />
                    <div className="flex items-center gap-2">
                      <input type="number" value={price} onChange={(e) => setListingPrice((p) => ({ ...p, [vehicle.id]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Price" />
                      <button onClick={() => guardTransact('sell', () => void handleListVehicle(vehicle, price))} disabled={pendingListId === vehicle.id} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === vehicle.id ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} />
                    <div className="text-[11px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })}
            </>
          )}

          {cosmeticParts.length > 0 && (
            <>
              <div className="pt-2 text-[10px] font-black uppercase tracking-wider text-text-muted">Skin Parts</div>
              {cosmeticParts.map((part) => {
                const key = `cosmetic:${part.partId}`;
                const stats = priceStats[key];
                const price = listingPrice[part.id] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice) : 1000);
                const preview = feePreview(Math.max(0, price), skillBonuses);
                const worn = Object.values(useCosmeticsStore.getState().view?.selection.equipped ?? {}).includes(part.id);
                return (
                  <div key={part.id} className="bl-card space-y-2" data-testid={`sell-cosmetic-${part.id}`}>
                    <CosmeticMiniCard partId={part.partId} name={part.name} qualityPercent={part.quality} tintPaletteId={part.tintPaletteId} />
                    {worn && <div className="text-[10px] font-bold text-amber">Currently worn — listing removes it from your hunter.</div>}
                    <div className="flex items-center gap-2">
                      <input type="number" value={price} onChange={(e) => setListingPrice((p) => ({ ...p, [part.id]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Price" />
                      <button onClick={() => guardTransact('sell', () => void handleListCosmetic(part.id, part.name, price))} disabled={pendingListId === part.id} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === part.id ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} />
                    <div className="text-[10px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })}
            </>
          )}

          {sellableBatches.length > 0 && (
            <>
              <div className="pt-2 text-[11px] font-black uppercase tracking-wider text-text-muted">Consumables</div>
              {sellableBatches.map((batch) => {
                const key = consumableIdentityKey(batch.consumable_type, batch.quality_percent);
                const stats = priceStats[key];
                const qty = Math.max(1, Math.min(batch.quantity, Math.floor(stackQty[batch.id] ?? batch.quantity)));
                const fallback = Math.round((CONSUMABLES[batch.consumable_type]?.market.vendorPrice ?? 100) * qty);
                const price = stackPrice[batch.id] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : fallback);
                const preview = feePreview(Math.max(0, price), skillBonuses);
                return (
                  <div key={batch.id} className="bl-card space-y-2 p-2.5">
                    <StackMiniCard onShowUsage={setUsageMaterialId} listing={{ id: batch.id, sellerId: currentUserId ?? '', sellerName: '', sellerType: 'player', kind: 'consumable', itemId: null, itemSnapshot: null, vehicleSnapshot: null, category: 'consumable', displayName: CONSUMABLES[batch.consumable_type]?.name ?? batch.consumable_type, quantity: batch.quantity, qualityPercent: batch.quality_percent, consumableType: batch.consumable_type, materialId: null, essenceId: null, partId: null, tintPaletteId: null, identityKey: key, weaponType: null, element: null, rarity: null, itemLevel: null, price: 0, unitPrice: 0, listedAt: 0, feePaid: 0 }} />
                    <div className="flex items-center gap-2">
                      <input type="number" value={qty} min={1} max={batch.quantity} onChange={(e) => setStackQty((p) => ({ ...p, [batch.id]: Number(e.target.value) }))} className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Quantity" />
                      <input type="number" value={price} onChange={(e) => setStackPrice((p) => ({ ...p, [batch.id]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Total price" />
                      <button onClick={() => guardTransact('sell', () => void handleListConsumable(batch.id))} disabled={pendingListId === batch.id} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === batch.id ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} perUnit />
                    <div className="text-[11px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })}
            </>
          )}

          {sellableMaterials.length > 0 && (
            <>
              <div className="pt-2 text-[11px] font-black uppercase tracking-wider text-text-muted">Materials</div>
              {sellableMaterials.map(([materialId, owned]) => {
                const key = materialIdentityKey(materialId);
                const stats = priceStats[key];
                const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[materialId] ?? owned)));
                const price = stackPrice[materialId] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 100);
                const preview = feePreview(Math.max(0, price), skillBonuses);
                return (
                  <div key={materialId} className="bl-card space-y-2 p-2.5">
                    <StackMiniCard onShowUsage={setUsageMaterialId} listing={{ id: materialId, sellerId: currentUserId ?? '', sellerName: '', sellerType: 'player', kind: 'material', itemId: null, itemSnapshot: null, vehicleSnapshot: null, category: 'material', displayName: materialId, quantity: owned, qualityPercent: null, consumableType: null, materialId, essenceId: null, partId: null, tintPaletteId: null, identityKey: key, weaponType: null, element: null, rarity: null, itemLevel: null, price: 0, unitPrice: 0, listedAt: 0, feePaid: 0 }} />
                    <div className="flex items-center gap-2">
                      <input type="number" value={qty} min={1} max={owned} onChange={(e) => setStackQty((p) => ({ ...p, [materialId]: Number(e.target.value) }))} className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Quantity" />
                      <input type="number" value={price} onChange={(e) => setStackPrice((p) => ({ ...p, [materialId]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Total price" />
                      <button onClick={() => guardTransact('sell', () => void handleListMaterial(materialId))} disabled={pendingListId === materialId} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === materialId ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} perUnit />
                    <div className="text-[11px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })}
            </>
          )}

          {player.cacheKeyFragments > 0 && (
            <>
              <div className="pt-2 text-[11px] font-black uppercase tracking-wider text-text-muted">Cache Fragments</div>
              {(() => {
                const key = FRAGMENT_IDENTITY_KEY;
                const owned = player.cacheKeyFragments;
                const stats = priceStats[key];
                const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[key] ?? owned)));
                const price = stackPrice[key] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 250);
                const preview = feePreview(Math.max(0, price), skillBonuses);
                return (
                  <div className="bl-card space-y-2 p-2.5">
                    <StackMiniCard listing={{ id: key, sellerId: currentUserId ?? '', sellerName: '', sellerType: 'player', kind: 'fragment', itemId: null, itemSnapshot: null, vehicleSnapshot: null, category: 'fragment', displayName: FRAGMENT_DISPLAY_NAME, quantity: owned, qualityPercent: null, consumableType: null, materialId: null, essenceId: null, partId: null, tintPaletteId: null, identityKey: key, weaponType: null, element: null, rarity: null, itemLevel: null, price: 0, unitPrice: 0, listedAt: 0, feePaid: 0 }} />
                    <div className="flex items-center gap-2">
                      <input type="number" value={qty} min={1} max={owned} onChange={(e) => setStackQty((p) => ({ ...p, [key]: Number(e.target.value) }))} className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Quantity" />
                      <input type="number" value={price} onChange={(e) => setStackPrice((p) => ({ ...p, [key]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Total price" />
                      <button onClick={() => guardTransact('sell', () => void handleListFragment())} disabled={pendingListId === key} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === key ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} perUnit />
                    <div className="text-[11px] text-text-muted">Listed fragments are held in escrow — they can't auto-convert into cache keys while listed.</div>
                    <div className="text-[11px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })()}
            </>
          )}

          {player.legendaryCores > 0 && (
            <>
              <div className="pt-2 text-[11px] font-black uppercase tracking-wider text-text-muted">Legendary Cores</div>
              {(() => {
                const key = CORE_IDENTITY_KEY;
                const owned = player.legendaryCores;
                const stats = priceStats[key];
                const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[key] ?? owned)));
                const price = stackPrice[key] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 2500);
                const preview = feePreview(Math.max(0, price), skillBonuses);
                return (
                  <div className="bl-card space-y-2 p-2.5">
                    <StackMiniCard listing={{ id: key, sellerId: currentUserId ?? '', sellerName: '', sellerType: 'player', kind: 'core', itemId: null, itemSnapshot: null, vehicleSnapshot: null, category: 'core', displayName: CORE_DISPLAY_NAME, quantity: owned, qualityPercent: null, consumableType: null, materialId: null, essenceId: null, partId: null, tintPaletteId: null, identityKey: key, weaponType: null, element: null, rarity: null, itemLevel: null, price: 0, unitPrice: 0, listedAt: 0, feePaid: 0 }} />
                    <div className="flex items-center gap-2">
                      <input type="number" value={qty} min={1} max={owned} onChange={(e) => setStackQty((p) => ({ ...p, [key]: Number(e.target.value) }))} className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Quantity" />
                      <input type="number" value={price} onChange={(e) => setStackPrice((p) => ({ ...p, [key]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Total price" />
                      <button onClick={() => guardTransact('sell', () => void handleListCore())} disabled={pendingListId === key} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === key ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} perUnit />
                    <div className="text-[11px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })()}
            </>
          )}

          {sellableEssences.length > 0 && (
            <>
              <div className="pt-2 text-[11px] font-black uppercase tracking-wider text-text-muted">Essences</div>
              {sellableEssences.map(([essenceId, owned]) => {
                const key = essenceIdentityKey(essenceId);
                const stats = priceStats[key];
                const qty = Math.max(1, Math.min(owned, Math.floor(stackQty[key] ?? owned)));
                const price = stackPrice[key] ?? (stats?.medianUnitPrice ? Math.round(stats.medianUnitPrice * qty) : qty * 500);
                const preview = feePreview(Math.max(0, price), skillBonuses);
                return (
                  <div key={essenceId} className="bl-card space-y-2 p-2.5">
                    <StackMiniCard listing={{ id: essenceId, sellerId: currentUserId ?? '', sellerName: '', sellerType: 'player', kind: 'essence', itemId: null, itemSnapshot: null, vehicleSnapshot: null, category: 'essence', displayName: essenceDisplayName(essenceId), quantity: owned, qualityPercent: null, consumableType: null, materialId: null, essenceId, partId: null, tintPaletteId: null, identityKey: key, weaponType: null, element: null, rarity: null, itemLevel: null, price: 0, unitPrice: 0, listedAt: 0, feePaid: 0 }} />
                    <div className="flex items-center gap-2">
                      <input type="number" value={qty} min={1} max={owned} onChange={(e) => setStackQty((p) => ({ ...p, [key]: Number(e.target.value) }))} className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Quantity" />
                      <input type="number" value={price} onChange={(e) => setStackPrice((p) => ({ ...p, [key]: Number(e.target.value) }))} className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary" aria-label="Total price" />
                      <button onClick={() => guardTransact('sell', () => void handleListEssence(essenceId))} disabled={pendingListId === key} className="rounded-lg bg-amber px-3 py-1.5 text-xs font-bold text-bg disabled:opacity-50">
                        {pendingListId === key ? 'Listing…' : (<>List{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                      </button>
                    </div>
                    <SalesGuidance stats={stats} perUnit />
                    <div className="text-[11px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {market.activeTab === 'sell' && sellSegment === 'mine' && (
        <div className="space-y-3">
          {/* F3 chrome compression: the refresh joins the search
              row as an icon button (spins while loading, same
              handler) and the sort rides the rarity rail's row —
              the listings start two rows higher; no control lost. */}
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
            <button
              type="button"
              onClick={refreshListings}
              disabled={loadingListings}
              aria-label="Refresh my listings"
              className="flex items-center justify-center rounded-lg border border-border bg-surface-raised px-3 py-2 text-text-secondary transition-colors hover:text-amber active:text-amber disabled:opacity-50"
            >
              <RefreshCw size={14} className={loadingListings ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <ChipRail className="min-w-0 flex-1">
              {['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map((r) => <button key={r} onClick={() => setMyListFilterRarity(myListFilterRarity === r ? null : r)} className={chipCls(myListFilterRarity === r)}>{r}</button>)}
            </ChipRail>
            <select
              value={myListSort}
              onChange={(e) => setMyListSort(e.target.value as MyListSort)}
              className="shrink-0 border border-border bg-surface rounded-lg px-2 py-1.5 text-[11px] font-black uppercase text-text-primary"
            >
              <option value="price">Sort: Price ↓</option>
              <option value="rarity">Sort: Rarity ↓</option>
              <option value="name">Sort: Name A-Z</option>
            </select>
          </div>
          {sortedMyListings.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No active listings match.</div>}
          {sortedMyListings.map((listing, index) => {
            const preview = feePreview(listing.price, skillBonuses, listing.itemSnapshot?.sourceTag);
            return (
            <motion.div key={listing.id} {...listEntranceProps(index, reduceMotion)} className="bl-card p-2.5">
              {/* Compact row (F3, same anatomy as Buy; M4 adds the
                  cosmetic branch): item + fee
                  line in the middle, price over a SMALL Cancel in
                  the right column — the full-width red band is
                  gone. Same handler, same lock-on-the-action. */}
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  {listing.kind === 'gear' && listing.itemSnapshot ? (
                    <GearMiniCard item={listing.itemSnapshot} onInspect={() => setInspectItem(listing.itemSnapshot)} />
                  ) : listing.kind === 'vehicle' && listing.vehicleSnapshot ? (
                    <VehicleMiniCard vehicle={listing.vehicleSnapshot} />
                  ) : listing.kind === 'cosmetic' ? (
                    <CosmeticMiniCard partId={listing.partId} name={listing.displayName} qualityPercent={listing.qualityPercent} tintPaletteId={listing.tintPaletteId} />
                  ) : (
                    <StackMiniCard listing={listing} onShowUsage={setUsageMaterialId} />
                  )}
                  <div className="text-[11px] text-text-muted">You receive {preview.sellerProceeds.toLocaleString()}cr after the {preview.pctLabel}% market fee (−{preview.fee.toLocaleString()}cr)</div>
                </div>
                <div className="flex w-[92px] shrink-0 flex-col items-end gap-1.5">
                  <div className="text-right text-xs font-black text-amber">{listing.price.toLocaleString()}cr</div>
                  <button onClick={() => guardTransact('cancel a listing', () => void handleCancelListing(listing))} disabled={pendingCancelId === listing.id} className="w-full rounded-lg bg-red-600 px-2 py-2 text-[11px] font-bold text-bg hover:bg-red-500 disabled:opacity-50">
                    {pendingCancelId === listing.id ? 'Cancelling…' : (<>Cancel Listing{marketLocked && <Lock size={11} className="ml-1 inline" aria-hidden />}</>)}
                  </button>
                </div>
              </div>
            </motion.div>
            );
          })}
        </div>
      )}

      {market.activeTab === 'repair' && <RepairBoard />}
      {market.activeTab === 'shieldTech' && <ShieldTechBoard />}

      {market.activeTab === 'sell' && sellSegment === 'history' && (
        <div className="space-y-2">
          {market.history.length === 0 && <div className="py-8 text-center text-xs text-text-muted">No transactions yet.</div>}
          {market.history.map((h, index) => <motion.div key={h.id} {...listEntranceProps(index, reduceMotion)} className="bl-card space-y-1.5 p-2.5"><div className="flex items-center justify-between"><div className="text-xs font-bold text-text-primary">{h.itemName}</div><div className={`text-xs font-black ${h.type === 'buy' ? 'text-red-400' : 'text-green-400'}`}>{h.type === 'buy' ? '-' : '+'}{h.price.toLocaleString()}cr</div></div><div className="flex items-center justify-between text-[11px] text-text-muted"><span>{historyPartyLabel(h)}</span><span>{h.itemRarity}</span></div></motion.div>)}
        </div>
      )}

        </>
      )}
        </motion.div>
      </AnimatePresence>

      {/* The Buy lane's ONE filters sheet (DESIGN.md §3; drift-fix
          F3). Every control that used to stack above the listings
          lives here on the same state: sort, rarity chips, weapon
          type + element (weapon searches), level and price ranges,
          and Clear all (the lane's old clear-filters handler,
          unchanged). */}
      {showBuyFilters && (
        <PickerSheet
          title="Market Filters"
          subtitle="Player market — narrow the listings"
          onClose={() => setShowBuyFilters(false)}
        >
          <div className="space-y-3 pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-black uppercase tracking-wide text-text-muted">Sort listings</span>
              <select
                value={buySort}
                onChange={(e) => setBuySort(e.target.value as MarketSort)}
                className="border border-border bg-surface rounded-lg px-2 py-1.5 text-[11px] font-black uppercase text-text-primary"
              >
                <option value="newest">Sort: Newest</option>
                <option value="price_asc">Sort: Cheapest</option>
                <option value="price_desc">Sort: Priciest</option>
                <option value="rarity">Sort: Rarity ↓</option>
                <option value="level">Sort: Level ↓</option>
                <option value="name">Sort: Name A-Z</option>
              </select>
            </div>
            <div>
              <div className="pb-1.5 text-[11px] font-black uppercase tracking-wide text-text-muted">Rarity</div>
              <ChipRail>
                {['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map((r) => <button key={r} onClick={() => setFilterRarity(filterRarity === r ? null : r)} className={chipCls(filterRarity === r)}>{r}</button>)}
              </ChipRail>
            </div>
            {(buyCategory === null || buyCategory === 'weapon') && (
              <div className="flex gap-2">
                <select
                  value={buyWeaponType ?? ''}
                  onChange={(e) => setBuyWeaponType(e.target.value || null)}
                  className="flex-1 border border-border bg-surface rounded-lg px-2 py-1.5 text-[11px] font-black uppercase text-text-primary"
                >
                  <option value="">Any weapon type</option>
                  {Object.values(WEAPON_TYPES).map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
                </select>
                <select
                  value={buyElement ?? ''}
                  onChange={(e) => setBuyElement(e.target.value || null)}
                  className="flex-1 border border-border bg-surface rounded-lg px-2 py-1.5 text-[11px] font-black uppercase text-text-primary"
                >
                  <option value="">Any element</option>
                  {Object.keys(ELEMENTS).map((el) => <option key={el} value={el}>{el}</option>)}
                </select>
              </div>
            )}
            <div>
              <div className="pb-1.5 text-[11px] font-black uppercase tracking-wide text-text-muted">Level &amp; price</div>
              <div className="flex gap-2">
                <input value={buyLevelMin} onChange={(e) => setBuyLevelMin(e.target.value)} inputMode="numeric" placeholder="Lv min" className={filterInputCls} />
                <input value={buyLevelMax} onChange={(e) => setBuyLevelMax(e.target.value)} inputMode="numeric" placeholder="Lv max" className={filterInputCls} />
                <input value={buyPriceMin} onChange={(e) => setBuyPriceMin(e.target.value)} inputMode="numeric" placeholder="Min cr" className={filterInputCls} />
                <input value={buyPriceMax} onChange={(e) => setBuyPriceMax(e.target.value)} inputMode="numeric" placeholder="Max cr" className={filterInputCls} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={clearBuyFilters}
                disabled={!hasBuyFilters}
                className="flex-1 rounded-lg border border-border bg-surface-raised py-2 text-[11px] font-bold text-text-secondary transition-colors active:text-amber disabled:opacity-40"
              >
                Clear all filters
              </button>
              <button
                type="button"
                onClick={() => setShowBuyFilters(false)}
                className="flex-1 rounded-lg bg-amber py-2 text-[11px] font-bold text-bg"
              >
                Done
              </button>
            </div>
          </div>
        </PickerSheet>
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
