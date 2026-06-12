/**
 * GearHub — full-featured inventory management component.
 *
 * Features:
 *   - Text search (name, element, manufacturer, weapon type, rarity)
 *   - Multi-filter chips (rarity, element, manufacturer, weapon type, source, lock)
 *   - Sort options (combat power, boss power, farm power, economy, level, rarity, roll quality, name, recent)
 *   - Grid / List view toggle
 *   - Multi-select mode with bulk salvage + bulk lock/unlock
 *   - Compare view (select two items side-by-side)
 *   - Junk marking system with "salvage all junk" action
 *   - Inspect sheet on tap
 */
import React, { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, ArrowUpDown, X, LayoutGrid, List, Trash2, Lock, Unlock,
  CheckSquare, Square, ArrowLeftRight, Sword,
} from 'lucide-react';
import { GearInspectSheet } from '@/components/gear/GearInspectSheet';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { useInventoryStore, useLoadoutStore } from '@/store';
import { useSalvageFeedStore } from '@/store/slices/salvageFeedSlice';
import { RARITIES } from '@/constants/rarities';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import type { GearItem, Weapon } from '@/types/items';

// ── Constants ────────────────────────────────────────────────────────────────

const RARITY_RANK: Record<string, number> = {
  Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5,
};
const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const ELEMENTS = ['Kinetic', 'Fire', 'Shock', 'Corrosive', 'Cryo', 'Void'];
const MANUFACTURERS = ['Redline', 'Ironwood', 'BlastForge', 'Prismatek', 'ThrowTech', 'HelixWorks'];
const WEAPON_TYPES = ['Pistol', 'SMG', 'Shotgun', 'Sniper', 'Launcher', 'Beam'];
const SOURCES = ['World Drop', 'Boss Drop', 'Cache-Forged', 'Crafted'];

type SortKey = 'combatPower' | 'bossPower' | 'farmPower' | 'economy' | 'level' | 'rarity' | 'rollQuality' | 'name' | 'recent';
type ViewMode = 'list' | 'grid';

const SORT_LABELS: Record<SortKey, string> = {
  combatPower: 'Combat Power', bossPower: 'Boss Power', farmPower: 'Farm Power',
  economy: 'Economy', level: 'Level', rarity: 'Rarity', rollQuality: 'Roll',
  name: 'Name A-Z', recent: 'Recent',
};

// ── Type Guards ──────────────────────────────────────────────────────────────

const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
const kindOf = (item: GearItem): string =>
  isWeapon(item) ? 'Weapon'
    : 'hp' in item ? 'Shield'
    : 'treeBonus' in item ? 'Class Mod'
    : 'effect' in item && 'damage' in item ? 'Ordnance'
    : 'Relic';

const colorOf = (item: GearItem) => RARITIES[item.rarity]?.color ?? '#F5B544';

// ── Sort / Filter Helpers ────────────────────────────────────────────────────

function itemComparable(item: GearItem, key: SortKey): number {
  switch (key) {
    case 'combatPower': return isWeapon(item) ? item.combatPower : ('hp' in item ? (item as { hp: number }).hp : ('damage' in item ? (item as { damage: number }).damage : 0));
    case 'bossPower': return isWeapon(item) ? item.bossPower : 0;
    case 'farmPower': return isWeapon(item) ? item.farmPower : 0;
    case 'economy': return isWeapon(item) ? item.economyScore : 0;
    case 'level': return item.level ?? 1;
    case 'rarity': return RARITY_RANK[item.rarity] ?? 0;
    case 'rollQuality': return isWeapon(item) ? item.rollQuality : 0;
    case 'name': return 0; // handled separately
    case 'recent': return 0;
    default: return 0;
  }
}

function itemElement(item: GearItem): string | null {
  if ('element' in item && typeof item.element === 'string') return item.element;
  return null;
}

function itemManufacturer(item: GearItem): string | null {
  if ('manufacturer' in item && typeof item.manufacturer === 'string') return item.manufacturer;
  return null;
}

function itemWeaponType(item: GearItem): string | null {
  if ('weaponType' in item && typeof item.weaponType === 'string') return item.weaponType;
  return null;
}

function itemNameSearch(item: GearItem, query: string): boolean {
  const q = query.toLowerCase();
  if (item.name.toLowerCase().includes(q)) return true;
  if (item.rarity.toLowerCase().includes(q)) return true;
  if (item.sourceTag.toLowerCase().includes(q)) return true;
  const el = itemElement(item);
  if (el && el.toLowerCase().includes(q)) return true;
  const mfg = itemManufacturer(item);
  if (mfg && mfg.toLowerCase().includes(q)) return true;
  const wt = itemWeaponType(item);
  if (wt && wt.toLowerCase().includes(q)) return true;
  return false;
}

function itemStatLine(item: GearItem): string {
  if (isWeapon(item)) return `PWR ${item.combatPower} · ${item.element} · ${item.manufacturer}`;
  if ('hp' in item) return `HP ${(item as { hp: number }).hp} · Mit ${Math.round((item as { mitigation: number }).mitigation * 100)}%`;
  if ('treeBonus' in item) return `${(item as { treeBonus: string }).treeBonus} · ${Object.keys((item as { nodeBoosts: Record<string, number> }).nodeBoosts).length} nodes`;
  if ('damage' in item && 'effect' in item) return `DMG ${(item as { damage: number }).damage} · ${(item as { element: string }).element} · ${(item as { effect: string }).effect}`;
  return `${item.affixes?.length ?? 0} affixes · ${item.sourceTag}`;
}

// ── Compare ──────────────────────────────────────────────────────────────────

function compareDiff(a: number, b: number, higherIsBetter = true): string {
  if (a === b) return '=';
  const diff = b - a;
  if (diff === 0) return '=';
  const better = higherIsBetter ? diff > 0 : diff < 0;
  return better ? `↑ ${diff > 0 ? '+' : ''}${Math.round(diff)}` : `↓ ${diff > 0 ? '+' : ''}${Math.round(diff)}`;
}

// ── Component ────────────────────────────────────────────────────────────────

interface GearHubProps {
  onNavigate?: (screen: string) => void;
}

export const GearHub: React.FC<GearHubProps> = ({ onNavigate }) => {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();

  // Filters
  const [search, setSearch] = useState('');
  const [filterRarity, setFilterRarity] = useState<Set<string>>(new Set());
  const [filterElement, setFilterElement] = useState<Set<string>>(new Set());
  const [filterMfg, setFilterMfg] = useState<Set<string>>(new Set());
  const [filterWtype, setFilterWtype] = useState<Set<string>>(new Set());
  const [filterSource, setFilterSource] = useState<Set<string>>(new Set());
  const [filterLocked, setFilterLocked] = useState<'all' | 'locked' | 'unlocked'>('all');
  const [filterJunk, setFilterJunk] = useState(false);

  // Sort & View
  const [sort, setSort] = useState<SortKey>('combatPower');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showSort, setShowSort] = useState(false);

  // Multi-select
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingScrapIds, setPendingScrapIds] = useState<Set<string>>(new Set());

  // Compare
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);

  // Inspect
  const [inspectItem, setInspectItem] = useState<GearItem | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────

  const equippedIds = useMemo(
    () => new Set(Object.values(loadout.slots).filter(Boolean) as string[]),
    [loadout.slots],
  );

  const hasAnyFilter = search !== '' || filterRarity.size > 0 || filterElement.size > 0
    || filterMfg.size > 0 || filterWtype.size > 0 || filterSource.size > 0
    || filterLocked !== 'all' || filterJunk;

  const clearFilters = useCallback(() => {
    setSearch('');
    setFilterRarity(new Set());
    setFilterElement(new Set());
    setFilterMfg(new Set());
    setFilterWtype(new Set());
    setFilterSource(new Set());
    setFilterLocked('all');
    setFilterJunk(false);
  }, []);

  const items = useMemo(() => {
    let result = [...inventory.items];

    // Search
    if (search) result = result.filter((i) => itemNameSearch(i, search));

    // Rarity filter
    if (filterRarity.size > 0) result = result.filter((i) => filterRarity.has(i.rarity));

    // Element filter (only items with element)
    if (filterElement.size > 0) {
      result = result.filter((i) => {
        const el = itemElement(i);
        return el && filterElement.has(el);
      });
    }

    // Manufacturer filter (only weapons)
    if (filterMfg.size > 0) {
      result = result.filter((i) => {
        const mfg = itemManufacturer(i);
        return mfg && filterMfg.has(mfg);
      });
    }

    // Weapon type filter
    if (filterWtype.size > 0) {
      result = result.filter((i) => {
        const wt = itemWeaponType(i);
        return wt && filterWtype.has(wt);
      });
    }

    // Source filter
    if (filterSource.size > 0) result = result.filter((i) => filterSource.has(i.sourceTag));

    // Lock filter
    if (filterLocked === 'locked') result = result.filter((i) => i.isLocked);
    if (filterLocked === 'unlocked') result = result.filter((i) => !i.isLocked);

    // Junk filter — show only non-equipped, non-locked items (scrap candidates)
    if (filterJunk) result = result.filter((i) => !i.isLocked && !equippedIds.has(i.id));

    // Sort
    result.sort((a, b) => {
      // Equipped items always first
      const aEq = equippedIds.has(a.id) ? 1 : 0;
      const bEq = equippedIds.has(b.id) ? 1 : 0;
      if (aEq !== bEq) return bEq - aEq;

      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'recent') return 0; // preserve array order (newest first)
      if (sort === 'rarity') {
        const ra = RARITY_RANK[a.rarity] ?? 0;
        const rb = RARITY_RANK[b.rarity] ?? 0;
        if (ra !== rb) return rb - ra;
      }
      const ca = itemComparable(a, sort);
      const cb = itemComparable(b, sort);
      return cb - ca;
    });

    return result;
  }, [inventory.items, search, filterRarity, filterElement, filterMfg, filterWtype, filterSource, filterLocked, filterJunk, sort, equippedIds]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const equip = (item: GearItem) => {
    if ('hp' in item && !isWeapon(item)) { loadout.setSlot('shield', item.id); setInspectItem(null); return; }
    if ('treeBonus' in item) { loadout.setSlot('classMod', item.id); setInspectItem(null); return; }
    if ('effect' in item && 'damage' in item && !isWeapon(item)) { loadout.setSlot('ordnance', item.id); setInspectItem(null); return; }
    if (!isWeapon(item) && 'affixes' in item) { loadout.setSlot('relic', item.id); setInspectItem(null); return; }
    const weaponSlots: Array<'primary' | 'secondary' | 'heavy'> = ['primary', 'secondary', 'heavy'];
    const firstEmpty = weaponSlots.find((s) => !loadout.slots[s]);
    if (firstEmpty) {
      loadout.setSlot(firstEmpty, item.id);
    } else {
      onNavigate?.('loadout');
    }
    setInspectItem(null);
  };

  const scrap = async (item: GearItem) => {
    if (pendingScrapIds.has(item.id)) return;
    setPendingScrapIds((prev) => new Set(prev).add(item.id));
    try {
      const result = await verifiedOps.recycleItem(item.id);
      const scrapAward = Number(result.scrap_award ?? 0);
      useSalvageFeedStore.getState().push(item, {
        scrapValue: scrapAward,
        scrapAlloy: 0,
        ballisticParts: 0,
        reactiveComponents: 0,
        techFragments: 0,
        voidDust: 0,
        essences: {},
      });
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    } catch (error) {
      console.warn('[GearHub] verified salvage failed:', error instanceof Error ? error.message : error);
    } finally {
      setPendingScrapIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const bulkScrap = () => {
    void (async () => {
      for (const id of selectedIds) {
        const item = inventory.getById(id);
        if (item) await scrap(item);
      }
      setSelectedIds(new Set());
      setSelectMode(false);
    })();
  };

  const bulkLock = () => {
    selectedIds.forEach((id) => inventory.lockItem(id));
    setSelectedIds(new Set());
    setSelectMode(false);
  };

  const bulkUnlock = () => {
    selectedIds.forEach((id) => inventory.unlockItem(id));
    setSelectedIds(new Set());
    setSelectMode(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(items.map((i) => i.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleItemTap = (item: GearItem) => {
    if (selectMode) {
      toggleSelect(item.id);
      return;
    }
    // Compare mode
    if (compareA !== null && compareA !== item.id) {
      setCompareB(item.id);
      return;
    }
    setInspectItem(item);
  };

  const startCompare = (id: string) => {
    setCompareA(id);
    setCompareB(null);
  };

  const compareItemA = compareA ? inventory.getById(compareA) : null;
  const compareItemB = compareB ? inventory.getById(compareB) : null;

  // ── Salvage all junk ───────────────────────────────────────────────────────

  const junkItems = useMemo(
    () => inventory.items.filter((i) => !i.isLocked && !equippedIds.has(i.id)),
    [inventory.items, equippedIds],
  );

  const salvageAllJunk = () => {
    void (async () => {
      for (const item of junkItems) {
        await scrap(item);
      }
    })();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const toggleFilter = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  return (
    <div className="space-y-3 p-3 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-black text-text-primary">Cache Inventory</div>
          <div className="text-[10px] text-text-muted">Search, filter, compare, and manage all gear.</div>
        </div>
        <div className="flex items-center gap-1.5">
          {hasAnyFilter && (
            <button onClick={clearFilters} className="rounded-full border border-red/30 bg-red/10 px-2 py-1 text-[9px] font-black text-red">
              Clear all
            </button>
          )}
          <div className="rounded-full border border-border bg-surface px-2 py-1 text-[10px] font-black text-amber">
            {items.length} / {inventory.items.length}
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, element, manufacturer, rarity..."
          className="w-full rounded-lg border border-border bg-surface-raised py-2 pl-8 pr-8 text-xs text-text-primary placeholder:text-text-muted"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="space-y-1.5">
        {/* Rarity */}
        <div className="flex flex-wrap gap-1">
          {RARITY_ORDER.map((r) => (
            <button
              key={r}
              onClick={() => toggleFilter(setFilterRarity, r)}
              className="rounded-full border px-2 py-0.5 text-[9px] font-black transition-colors"
              style={{
                borderColor: filterRarity.has(r) ? RARITIES[r]?.color ?? '#F5B544' : undefined,
                backgroundColor: filterRarity.has(r) ? `${RARITIES[r]?.color ?? '#F5B544'}20` : undefined,
                color: filterRarity.has(r) ? RARITIES[r]?.color ?? '#F5B544' : undefined,
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Element */}
        <div className="flex flex-wrap gap-1">
          {ELEMENTS.map((el) => (
            <button
              key={el}
              onClick={() => toggleFilter(setFilterElement, el)}
              className={`rounded-full border px-2 py-0.5 text-[9px] font-black transition-colors ${
                filterElement.has(el) ? 'border-cyan bg-cyan/10 text-cyan' : 'border-border bg-surface text-text-muted'
              }`}
            >
              {el}
            </button>
          ))}
        </div>

        {/* Manufacturer */}
        <div className="flex flex-wrap gap-1">
          {MANUFACTURERS.map((m) => (
            <button
              key={m}
              onClick={() => toggleFilter(setFilterMfg, m)}
              className={`rounded-full border px-2 py-0.5 text-[9px] font-black transition-colors ${
                filterMfg.has(m) ? 'border-orange bg-orange/10 text-orange' : 'border-border bg-surface text-text-muted'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Weapon Type */}
        <div className="flex flex-wrap gap-1">
          {WEAPON_TYPES.map((w) => (
            <button
              key={w}
              onClick={() => toggleFilter(setFilterWtype, w)}
              className={`rounded-full border px-2 py-0.5 text-[9px] font-black transition-colors ${
                filterWtype.has(w) ? 'border-red bg-red/10 text-red' : 'border-border bg-surface text-text-muted'
              }`}
            >
              {w}
            </button>
          ))}
        </div>

        {/* Source */}
        <div className="flex flex-wrap gap-1">
          {SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => toggleFilter(setFilterSource, s)}
              className={`rounded-full border px-2 py-0.5 text-[9px] font-black transition-colors ${
                filterSource.has(s) ? 'border-purple bg-purple/10 text-purple' : 'border-border bg-surface text-text-muted'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Lock + Junk */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilterLocked((p) => (p === 'locked' ? 'all' : 'locked'))}
            className={`rounded-full border px-2 py-0.5 text-[9px] font-black transition-colors ${
              filterLocked === 'locked' ? 'border-red bg-red/10 text-red' : 'border-border bg-surface text-text-muted'
            }`}
          >
            🔒 Locked
          </button>
          <button
            onClick={() => setFilterJunk((p) => !p)}
            className={`rounded-full border px-2 py-0.5 text-[9px] font-black transition-colors ${
              filterJunk ? 'border-amber bg-amber/10 text-amber' : 'border-border bg-surface text-text-muted'
            }`}
          >
            ♻ Scrap candidates
          </button>
        </div>
      </div>

      {/* Sort + View + Select toolbar */}
      <div className="flex items-center gap-2">
        {/* Sort */}
        <div className="relative">
          <button
            onClick={() => setShowSort((p) => !p)}
            className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[10px] font-black text-text-muted"
          >
            <ArrowUpDown size={12} />
            {SORT_LABELS[sort]}
          </button>
          {showSort && (
            <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-xl border border-border bg-surface shadow-lg overflow-hidden">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => { setSort(key); setShowSort(false); }}
                  className={`w-full px-3 py-1.5 text-left text-[10px] font-black transition-colors ${
                    sort === key ? 'bg-amber/15 text-amber' : 'text-text-muted hover:bg-surface-raised'
                  }`}
                >
                  {SORT_LABELS[key]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View toggle */}
        <button
          onClick={() => setViewMode((v) => (v === 'list' ? 'grid' : 'list'))}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-text-muted"
        >
          {viewMode === 'list' ? <LayoutGrid size={14} /> : <List size={14} />}
        </button>

        {/* Select mode */}
        <button
          onClick={() => { setSelectMode((p) => !p); setSelectedIds(new Set()); }}
          className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-black transition-colors ${
            selectMode ? 'border-amber bg-amber/10 text-amber' : 'border-border bg-surface text-text-muted'
          }`}
        >
          {selectMode ? 'Done' : 'Select'}
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Salvage all junk */}
        {junkItems.length > 0 && (
          <button
            onClick={salvageAllJunk}
            className="flex items-center gap-1 rounded-lg border border-red/30 bg-red/10 px-2 py-1 text-[9px] font-black text-red"
          >
            <Trash2 size={11} />
            Salvage {junkItems.length}
          </button>
        )}
      </div>

      {/* Bulk action bar (when in select mode with items selected) */}
      <AnimatePresence>
        {selectMode && selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 rounded-xl border border-amber/40 bg-amber/10 p-2"
          >
            <span className="text-[10px] font-black text-amber">{selectedIds.size} selected</span>
            <button onClick={selectAll} className="text-[9px] text-text-muted">All</button>
            <button onClick={deselectAll} className="text-[9px] text-text-muted">None</button>
            <div className="flex-1" />
            <button onClick={bulkLock} className="rounded-lg border border-border bg-surface px-2 py-1 text-[9px] font-black text-text-muted">
              <Lock size={12} />
            </button>
            <button onClick={bulkUnlock} className="rounded-lg border border-border bg-surface px-2 py-1 text-[9px] font-black text-text-muted">
              <Unlock size={12} />
            </button>
            <button onClick={bulkScrap} className="rounded-lg border border-red/40 bg-red/10 px-2 py-1 text-[9px] font-black text-red">
              <Trash2 size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Item list */}
      {items.length === 0 && (
        <div className="py-10 text-center">
          <div className="text-sm text-text-muted">
            {hasAnyFilter ? 'No gear matches these filters.' : 'No gear in inventory.'}
          </div>
          {hasAnyFilter && (
            <button onClick={clearFilters} className="mt-2 text-xs font-black text-amber">Clear all filters</button>
          )}
        </div>
      )}

      <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
        {items.map((item) => {
          const selected = selectedIds.has(item.id);
          const equipped = equippedIds.has(item.id);
          const color = colorOf(item);

          if (viewMode === 'grid') {
            return (
              <motion.button
                key={item.id}
                layout
                whileTap={{ scale: 0.97 }}
                onClick={() => handleItemTap(item)}
                className={`relative flex flex-col items-center gap-1.5 rounded-xl border bg-surface p-2.5 text-center ${
                  selected ? 'border-amber ring-1 ring-amber/40' : equipped ? 'border-amber/50' : 'border-border'
                }`}
                style={{ borderLeftColor: color, borderLeftWidth: 3 }}
              >
                {selectMode && (
                  <div className="absolute top-1.5 right-1.5 z-10">
                    {selected ? <CheckSquare size={14} className="text-amber" /> : <Square size={14} className="text-text-muted" />}
                  </div>
                )}
                {equipped && !selectMode && (
                  <div className="absolute top-1.5 left-1.5 rounded-full bg-amber px-1.5 py-0.5 text-[7px] font-black text-bg">EQ</div>
                )}
                <div className="flex h-16 w-16 items-center justify-center">
                  <GearIllustration item={item} size={58} showBadges={false} />
                </div>
                <div className="w-full min-w-0">
                  <div className="truncate text-[10px] font-black" style={{ color }}>{item.name}</div>
                  <div className="text-[8px] text-text-muted">{item.rarity} · Lv.{item.level}</div>
                  <div className="mt-0.5 truncate text-[8px] text-amber">{itemStatLine(item)}</div>
                </div>
              </motion.button>
            );
          }

          return (
            <motion.button
              key={item.id}
              layout
              whileTap={{ scale: 0.98 }}
              onClick={() => handleItemTap(item)}
              className={`relative flex w-full items-center gap-3 border bg-surface p-3 text-left ${
                selected ? 'border-amber ring-1 ring-amber/40' : equipped ? 'border-amber/50' : 'border-border'
              }`}
              style={{ borderLeftColor: color, borderLeftWidth: 4 }}
            >
              {selectMode && (
                <div className="shrink-0">
                  {selected ? <CheckSquare size={16} className="text-amber" /> : <Square size={16} className="text-text-muted" />}
                </div>
              )}
              <div className="flex h-14 w-14 shrink-0 items-center justify-center border border-border bg-bg">
                <GearIllustration item={item} size={50} showBadges={false} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="truncate text-xs font-black" style={{ color }}>{item.name}</div>
                  {equipped && <span className="shrink-0 rounded-full bg-amber px-1.5 py-0.5 text-[7px] font-black text-bg">EQ</span>}
                  {item.isLocked && <Lock size={10} className="shrink-0 text-red" />}
                </div>
                <div className="mt-0.5 text-[10px] text-text-muted">
                  {item.rarity} · Lv.{item.level} · {kindOf(item)}
                </div>
                <div className="mt-1 truncate text-[10px] text-text-secondary">{itemStatLine(item)}</div>
              </div>
              {!selectMode && (
                <button
                  onClick={(e) => { e.stopPropagation(); startCompare(item.id); }}
                  className="shrink-0 rounded-lg border border-border bg-surface p-1.5 text-text-muted"
                >
                  <ArrowLeftRight size={13} />
                </button>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Compare sheet */}
      <AnimatePresence>
        {compareA && compareB && compareItemA && compareItemB && (
          <motion.div
            className="fixed inset-0 z-[75] flex items-end justify-center bg-black/85"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { setCompareA(null); setCompareB(null); }}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl border-t-2 border-border bg-bg p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-black text-text-primary">Compare Gear</div>
                <button onClick={() => { setCompareA(null); setCompareB(null); }} className="text-text-muted"><X size={18} /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* Item A */}
                <div className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex justify-center mb-2">
                    <GearIllustration item={compareItemA} size={72} showBadges={false} />
                  </div>
                  <div className="text-[10px] font-black" style={{ color: colorOf(compareItemA) }}>{compareItemA.name}</div>
                  <div className="text-[9px] text-text-muted">{compareItemA.rarity} · Lv.{compareItemA.level}</div>
                  {isWeapon(compareItemA) && (
                    <div className="mt-1 space-y-0.5 text-[9px]">
                      <div className="text-text-muted">PWR: {compareItemA.combatPower}</div>
                      <div className="text-text-muted">DMG: {compareItemA.baseDamage}</div>
                      <div className="text-text-muted">Crit: {Math.round(compareItemA.critChance * 100)}%</div>
                    </div>
                  )}
                </div>
                {/* Item B */}
                <div className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex justify-center mb-2">
                    <GearIllustration item={compareItemB} size={72} showBadges={false} />
                  </div>
                  <div className="text-[10px] font-black" style={{ color: colorOf(compareItemB) }}>{compareItemB.name}</div>
                  <div className="text-[9px] text-text-muted">{compareItemB.rarity} · Lv.{compareItemB.level}</div>
                  {isWeapon(compareItemB) && isWeapon(compareItemA) && (
                    <div className="mt-1 space-y-0.5 text-[9px]">
                      <div className={compareItemB.combatPower > compareItemA.combatPower ? 'text-green' : compareItemB.combatPower < compareItemA.combatPower ? 'text-red' : 'text-text-muted'}>
                        PWR: {compareItemB.combatPower} ({compareDiff(compareItemA.combatPower, compareItemB.combatPower)})
                      </div>
                      <div className={compareItemB.baseDamage > compareItemA.baseDamage ? 'text-green' : compareItemB.baseDamage < compareItemA.baseDamage ? 'text-red' : 'text-text-muted'}>
                        DMG: {compareItemB.baseDamage} ({compareDiff(compareItemA.baseDamage, compareItemB.baseDamage)})
                      </div>
                      <div className={compareItemB.critChance > compareItemA.critChance ? 'text-green' : compareItemB.critChance < compareItemA.critChance ? 'text-red' : 'text-text-muted'}>
                        Crit: {Math.round(compareItemB.critChance * 100)}% ({compareDiff(compareItemA.critChance, compareItemB.critChance)})
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 text-center text-[10px] text-text-muted">
                {compareItemA.name} vs {compareItemB.name}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inspect sheet */}
      <GearInspectSheet
        item={inspectItem}
        open={!!inspectItem}
        onClose={() => setInspectItem(null)}
        contextLabel="Inventory Inspect"
        actions={inspectItem ? (
          <div className="grid grid-cols-4 gap-2">
            <button type="button" onClick={() => equip(inspectItem!)} className="flex flex-col items-center gap-1 border border-amber/40 bg-amber/10 py-2 text-[9px] font-black text-amber">
              <Sword size={15} />Equip
            </button>
            <button type="button" onClick={() => onNavigate?.('market')} className="flex flex-col items-center gap-1 border border-green/40 bg-green/10 py-2 text-[9px] font-black text-green">
              <ArrowLeftRight size={15} />Market
            </button>
            <button type="button" onClick={() => inspectItem!.isLocked ? inventory.unlockItem(inspectItem!.id) : inventory.lockItem(inspectItem!.id)} className="flex flex-col items-center gap-1 border border-border bg-surface py-2 text-[9px] font-black text-text-secondary">
              {inspectItem!.isLocked ? <Unlock size={15} /> : <Lock size={15} />}
              {inspectItem!.isLocked ? 'Unlock' : 'Lock'}
            </button>
            <button type="button" onClick={() => void scrap(inspectItem!)} className="flex flex-col items-center gap-1 border border-red/40 bg-red/10 py-2 text-[9px] font-black text-red">
              <Trash2 size={15} />Scrap
            </button>
          </div>
        ) : undefined}
      />
    </div>
  );
};
