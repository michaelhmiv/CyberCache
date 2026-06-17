/**
 * SlotGearPicker — full-height bottom sheet for equipping a loadout slot.
 *
 * Features:
 *   - Search bar (name, element, manufacturer, weapon type, rarity)
 *   - Filter chips (rarity, element, manufacturer, weapon type)
 *   - Sort options (power, rarity, level, name)
 *   - Full-height layout (not scrunched at bottom)
 */
import React, { useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Search, ArrowUpDown, X } from 'lucide-react';
import { useInventoryStore } from '@/store';
import { Element, Rarity, Manufacturer, WeaponType } from '@/types/game';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';
import type { GearItem, Weapon } from '@/types/items';
import { GearCompare } from '@/components/gear/GearCompare';
import { gearCardSummary } from '@/lib/gear/gearCardSummary';

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };
const chipClip = { clipPath: 'polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%)' };

const RARITY_RANK: Record<string, number> = {
  Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5,
};
const RARITY_COLORS: Record<string, string> = {
  Common: '#A5A7B5', Uncommon: '#7CFC00', Rare: '#5AA7FF', Epic: '#FF9DF5', Legendary: '#FFEA3A',
};

interface SlotGearPickerProps {
  slot: LoadoutSlot;
  currentItemId: string | null;
  onClose: () => void;
  onEquip: (itemId: string) => Promise<void>;
  onUnequip: () => Promise<void>;
  busy?: boolean;
  error?: string | null;
}

function isSlotCompatible(item: GearItem, slot: LoadoutSlot): boolean {
  switch (slot) {
    case 'primary': case 'secondary': case 'heavy':
      return 'weaponType' in item;
    case 'shield':
      return 'hp' in item && !('weaponType' in item) && !('effect' in item);
    case 'classMod':
      return 'treeBonus' in item;
    case 'relic':
      return 'affixes' in item && !('weaponType' in item) && !('hp' in item) && !('treeBonus' in item) && !('effect' in item);
    case 'ordnance':
      return 'damage' in item && 'effect' in item;
    default:
      return false;
  }
}

const SLOT_LABEL: Record<LoadoutSlot, string> = {
  primary: 'Primary Weapon', secondary: 'Secondary Weapon', heavy: 'Heavy Weapon',
  shield: 'Shield', classMod: 'Class Mod', relic: 'Relic', ordnance: 'Ordnance',
};

const SLOT_SORT_OPTIONS: Record<LoadoutSlot, Array<{ key: string; label: string }>> = {
  primary: [
    { key: 'combatPower', label: 'DPS ↓' },
    { key: 'bossPower', label: 'Boss ↓' },
    { key: 'farmPower', label: 'Farm ↓' },
    { key: 'economy', label: 'Economy ↓' },
    { key: 'rollQuality', label: 'Roll ↓' },
    { key: 'level', label: 'Level ↓' },
    { key: 'rarity', label: 'Rarity ↓' },
    { key: 'name', label: 'Name A-Z' },
  ],
  secondary: [],
  heavy: [],
  shield: [
    { key: 'shieldHp', label: 'HP ↓' },
    { key: 'mitigation', label: 'Mitigation ↓' },
    { key: 'recharge', label: 'Recharge ↓' },
    { key: 'level', label: 'Level ↓' },
    { key: 'rarity', label: 'Rarity ↓' },
    { key: 'name', label: 'Name A-Z' },
  ],
  classMod: [
    { key: 'skillBoost', label: 'Skill Boost ↓' },
    { key: 'nodeCount', label: 'Nodes ↓' },
    { key: 'level', label: 'Level ↓' },
    { key: 'rarity', label: 'Rarity ↓' },
    { key: 'name', label: 'Name A-Z' },
  ],
  relic: [
    { key: 'idleValue', label: 'Idle Value ↓' },
    { key: 'dropValue', label: 'Drop Value ↓' },
    { key: 'scrapValue', label: 'Scrap Value ↓' },
    { key: 'affixCount', label: 'Affix Count ↓' },
    { key: 'level', label: 'Level ↓' },
    { key: 'rarity', label: 'Rarity ↓' },
    { key: 'name', label: 'Name A-Z' },
  ],
  ordnance: [
    { key: 'payload', label: 'Payload ↓' },
    { key: 'shieldBreak', label: 'Shield Break ↓' },
    { key: 'armorBreak', label: 'Armor Break ↓' },
    { key: 'level', label: 'Level ↓' },
    { key: 'rarity', label: 'Rarity ↓' },
    { key: 'name', label: 'Name A-Z' },
  ],
};
// Copy primary options to secondary and heavy
SLOT_SORT_OPTIONS.secondary = SLOT_SORT_OPTIONS.primary;
SLOT_SORT_OPTIONS.heavy = SLOT_SORT_OPTIONS.primary;

function getItemElement(item: GearItem): string | null {
  if ('element' in item) return (item as { element?: string }).element ?? null;
  return null;
}

function getItemManufacturer(item: GearItem): string | null {
  if ('manufacturer' in item) return (item as Weapon).manufacturer ?? null;
  return null;
}

function getItemWeaponType(item: GearItem): string | null {
  if ('weaponType' in item) return (item as Weapon).weaponType ?? null;
  return null;
}

function itemSortValue(item: GearItem, key: string): number {
  if (key === 'combatPower') return 'combatPower' in item ? (item as Weapon).combatPower : 0;
  if (key === 'bossPower') return 'bossPower' in item ? (item as Weapon).bossPower : 0;
  if (key === 'farmPower') return 'farmPower' in item ? (item as Weapon).farmPower : 0;
  if (key === 'economy') return 'economyScore' in item ? (item as Weapon).economyScore : 0;
  if (key === 'level') return item.level ?? 1;
  if (key === 'rarity') return RARITY_RANK[item.rarity] ?? 0;
  if (key === 'rollQuality') return 'rollQuality' in item ? (item as Weapon).rollQuality : 0;
  if (key === 'shieldHp') return 'hp' in item && !('weaponType' in item) ? (item as { hp: number }).hp : 0;
  if (key === 'mitigation') return 'mitigation' in item ? (item as { mitigation: number }).mitigation : 0;
  if (key === 'recharge') return 'rechargeRate' in item ? (item as { rechargeRate: number }).rechargeRate : 0;
  if (key === 'skillBoost') { const summary = gearCardSummary(item); return summary.primaryStats.length; }
  if (key === 'nodeCount') return 'nodeBoosts' in item ? Object.keys((item as { nodeBoosts: Record<string, number> }).nodeBoosts).length : 0;
  if (key === 'idleValue') { const summary = gearCardSummary(item); return parseInt(summary.primaryStats[1]?.value || '0') || 0; }
  if (key === 'dropValue') { const summary = gearCardSummary(item); return parseInt(summary.primaryStats[2]?.value || '0') || 0; }
  if (key === 'scrapValue') { const summary = gearCardSummary(item); return parseInt(summary.secondaryStats[0]?.value || '0') || 0; }
  if (key === 'affixCount') return 'affixes' in item && Array.isArray(item.affixes) ? item.affixes.length : 0;
  if (key === 'payload') return 'damage' in item && !('weaponType' in item) ? (item as { damage: number }).damage : 0;
  if (key === 'shieldBreak') return 'shieldDamage' in item ? (item as { shieldDamage: number }).shieldDamage : 0;
  if (key === 'armorBreak') return 'armorDamage' in item ? (item as { armorDamage: number }).armorDamage : 0;
  return 0;
}

export const SlotGearPicker: React.FC<SlotGearPickerProps> = ({
  slot, currentItemId, onClose, onEquip, onUnequip, busy = false, error = null,
}) => {
  const inventory = useInventoryStore();
  const allItems = inventory.items;

  // ── State ──────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const defaultSort = SLOT_SORT_OPTIONS[slot]?.[0]?.key ?? 'combatPower';
  const [sortBy, setSortBy] = useState<string>(defaultSort);
  const [filters, setFilters] = useState<{
    rarities: Set<string>;
    elements: Set<string>;
    manufacturers: Set<string>;
    weaponTypes: Set<string>;
    sources: Set<string>;
  }>({ rarities: new Set(), elements: new Set(), manufacturers: new Set(), weaponTypes: new Set(), sources: new Set() });

  const toggleFilter = useCallback((category: keyof typeof filters, value: string) => {
    setFilters((prev) => {
      const next = new Set(prev[category]);
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...prev, [category]: next };
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ rarities: new Set(), elements: new Set(), manufacturers: new Set(), weaponTypes: new Set(), sources: new Set() });
    setSearch('');
  }, []);

  // ── Filter + sort ──────────────────────────────────────────────
  const results = useMemo(() => {
    let items = allItems.filter((item) => isSlotCompatible(item, slot));

    // Search
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      items = items.filter((item) => {
        if (item.name.toLowerCase().includes(q)) return true;
        if (item.rarity.toLowerCase().includes(q)) return true;
        const el = getItemElement(item);
        if (el && el.toLowerCase().includes(q)) return true;
        const mfg = getItemManufacturer(item);
        if (mfg && mfg.toLowerCase().includes(q)) return true;
        const wt = getItemWeaponType(item);
        if (wt && wt.toLowerCase().includes(q)) return true;
        return false;
      });
    }

    // Filter chips
    if (filters.rarities.size > 0) items = items.filter((i) => filters.rarities.has(i.rarity));
    if (filters.elements.size > 0) items = items.filter((i) => {
      const el = getItemElement(i);
      return el && filters.elements.has(el);
    });
    if (filters.manufacturers.size > 0) items = items.filter((i) => {
      const mfg = getItemManufacturer(i);
      return mfg && filters.manufacturers.has(mfg);
    });
    if (filters.weaponTypes.size > 0) items = items.filter((i) => {
      const wt = getItemWeaponType(i);
      return wt && filters.weaponTypes.has(wt);
    });

    // Source filter
    if (filters.sources.size > 0) items = items.filter((i) => {
      const src = 'sourceTag' in i ? (i as { sourceTag: string }).sourceTag : null;
      return src && filters.sources.has(src);
    });

    // Sort
    items = [...items].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return itemSortValue(b, sortBy) - itemSortValue(a, sortBy);
    });

    return items;
  }, [allItems, slot, search, filters, sortBy]);

  const currentItem = useMemo(
    () => (currentItemId ? allItems.find((i) => i.id === currentItemId) ?? null : null),
    [allItems, currentItemId],
  );

  // ── Filter chip options ────────────────────────────────────────
  const allRarities = Object.values(Rarity);
  const allElements = Object.values(Element).filter((e) => e !== Element.Kinetic);
  const allManufacturers = Object.values(Manufacturer);
  const allWeaponTypes = Object.values(WeaponType);

  const allSources = useMemo(() => {
    const srcs = new Set<string>();
    allItems.filter(i => isSlotCompatible(i, slot)).forEach(i => {
      if ('sourceTag' in i) srcs.add((i as { sourceTag: string }).sourceTag);
    });
    return Array.from(srcs).sort();
  }, [allItems, slot]);

  const hasFilters = filters.rarities.size > 0 || filters.elements.size > 0 || filters.manufacturers.size > 0 || filters.weaponTypes.size > 0 || filters.sources.size > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end bg-black/75"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="h-[92vh] w-full flex flex-col border-t-2 border-border bg-bg"
        onClick={(event) => event.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-3 border-b border-border/50">
          <div>
            <div className="bl-title text-2xl text-text-primary">{SLOT_LABEL[slot]}</div>
            <div className="text-[10px] text-text-muted">
              {results.length} of {allItems.filter((i) => isSlotCompatible(i, slot)).length} items
            </div>
          </div>
          <button type="button" onClick={onClose} className="bl-secondary p-2 text-text-muted">
            <ChevronDown size={16} />
          </button>
        </div>

        {/* ── Search bar ──────────────────────────────────────── */}
        <div className="shrink-0 px-4 py-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, element, rarity, manufacturer…"
              className="w-full h-9 pl-8 pr-3 border-2 border-border bg-bg/80 text-sm font-bold text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-amber/60"
              style={signClip}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* ── Filter chips ────────────────────────────────────── */}
        <div className="shrink-0 px-4 pb-2 space-y-1.5">
          {/* Rarity chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="text-[8px] font-black uppercase tracking-wider text-text-muted shrink-0">Rarity</span>
            {allRarities.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => toggleFilter('rarities', r)}
                className={`shrink-0 px-2 py-0.5 text-[9px] font-black border transition-colors ${
                  filters.rarities.has(r)
                    ? 'border-amber/60 bg-amber/10 text-amber'
                    : 'border-border/50 bg-bg/50 text-text-muted hover:border-amber/30'
                }`}
                style={chipClip}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Element chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="text-[8px] font-black uppercase tracking-wider text-text-muted shrink-0">Element</span>
            {allElements.map((el) => (
              <button
                key={el}
                type="button"
                onClick={() => toggleFilter('elements', el)}
                className={`shrink-0 px-2 py-0.5 text-[9px] font-black border transition-colors ${
                  filters.elements.has(el)
                    ? 'border-amber/60 bg-amber/10 text-amber'
                    : 'border-border/50 bg-bg/50 text-text-muted hover:border-amber/30'
                }`}
                style={chipClip}
              >
                {el}
              </button>
            ))}
          </div>

          {/* Source chips */}
          {allSources.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <span className="text-[8px] font-black uppercase tracking-wider text-text-muted shrink-0">Src</span>
              {allSources.map((src) => (
                <button
                  key={src} type="button" onClick={() => toggleFilter('sources', src)}
                  className={`shrink-0 px-2 py-0.5 text-[9px] font-black border transition-colors ${
                    filters.sources.has(src)
                      ? 'border-amber/60 bg-amber/10 text-amber'
                      : 'border-border/50 bg-bg/50 text-text-muted hover:border-amber/30'
                  }`}
                  style={chipClip}
                >
                  {src}
                </button>
              ))}
            </div>
          )}

          {/* Manufacturer + WeaponType chips (only for weapon slots) */}
          {(slot === 'primary' || slot === 'secondary' || slot === 'heavy') && (
            <>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <span className="text-[8px] font-black uppercase tracking-wider text-text-muted shrink-0">Mfg</span>
                {allManufacturers.map((m) => (
                  <button
                    key={m} type="button" onClick={() => toggleFilter('manufacturers', m)}
                    className={`shrink-0 px-2 py-0.5 text-[9px] font-black border transition-colors ${
                      filters.manufacturers.has(m)
                        ? 'border-amber/60 bg-amber/10 text-amber'
                        : 'border-border/50 bg-bg/50 text-text-muted hover:border-amber/30'
                    }`}
                    style={chipClip}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <span className="text-[8px] font-black uppercase tracking-wider text-text-muted shrink-0">Type</span>
                {allWeaponTypes.map((wt) => (
                  <button
                    key={wt} type="button" onClick={() => toggleFilter('weaponTypes', wt)}
                    className={`shrink-0 px-2 py-0.5 text-[9px] font-black border transition-colors ${
                      filters.weaponTypes.has(wt)
                        ? 'border-amber/60 bg-amber/10 text-amber'
                        : 'border-border/50 bg-bg/50 text-text-muted hover:border-amber/30'
                    }`}
                    style={chipClip}
                  >
                    {wt}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Clear + sort row */}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-1.5">
              <ArrowUpDown size={11} className="text-text-muted" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="text-[9px] font-black uppercase border border-border/50 bg-bg/50 text-text-primary px-1.5 py-0.5 focus:outline-none"
                style={chipClip}
              >
                {SLOT_SORT_OPTIONS[slot].map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </div>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="text-[9px] font-black text-red hover:text-red/80">
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* ── Currently equipped ───────────────────────────────── */}
        {error && (
          <div className="shrink-0 px-4 pb-2">
            <div className="border-2 border-red/40 bg-red/10 p-2 text-[11px] font-bold text-red-light" style={signClip}>
              {error}
            </div>
          </div>
        )}

        {currentItem && (
          <div className="shrink-0 px-4 pb-2">
            <div className="text-[8px] font-black uppercase tracking-[0.18em] text-amber mb-1">Currently Equipped</div>
            <div className="border-2 border-amber/50 bg-amber/5 p-2.5 flex items-center justify-between gap-2" style={signClip}>
              <div className="min-w-0">
                <div className="text-sm font-black text-text-primary truncate">{currentItem.name}</div>
                <div className="text-[10px] text-text-muted">{currentItem.rarity} · Lv.{currentItem.level}</div>
              </div>
              <button type="button" onClick={onUnequip} disabled={busy} className="bl-secondary px-2 py-1 text-[9px] font-black text-red shrink-0 disabled:opacity-50">
                {busy ? 'Working…' : 'Unequip'}
              </button>
            </div>
          </div>
        )}

        {/* ── Item list ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {results.filter((item) => item.id !== currentItemId).length === 0 ? (
            <div className="border border-border bg-bg/70 p-6 text-center text-xs text-text-muted" style={signClip}>
              {search || hasFilters ? 'No items match your search or filters.' : `No compatible ${SLOT_LABEL[slot].toLowerCase()} items in your inventory.`}
            </div>
          ) : (
            <div className="space-y-1.5">
              {results
                .filter((item) => item.id !== currentItemId)
                .map((item) => {
                  const accent = RARITY_COLORS[item.rarity] ?? '#A5A7B5';
                  const summary = gearCardSummary(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={busy}
                      onClick={() => onEquip(item.id)}
                      className="w-full border-2 border-border bg-surface/90 p-2.5 text-left active:scale-[0.99] transition-transform hover:border-amber/30 disabled:opacity-50 disabled:scale-100"
                      style={{ ...signClip, borderColor: `${accent}40` }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-black truncate" style={{ color: accent }}>{item.name}</span>
                            <span className="text-[9px] text-text-muted shrink-0">{item.rarity} · Lv.{item.level}</span>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {summary.primaryStats.map((stat) => (
                              <span key={stat.label} className="inline-flex items-center gap-0.5 rounded border border-border bg-bg px-1 py-0.5 text-[9px]">
                                <span className="text-text-muted">{stat.label}</span>
                                <span className={`font-bold ${stat.tone ?? 'text-text-primary'}`}>{stat.value}</span>
                              </span>
                            ))}
                          </div>
                          {summary.badges[0] && (
                            <div className="text-[9px] text-amber mt-0.5 truncate">{summary.badges[0]}</div>
                          )}
                          {currentItem && (
                            <GearCompare current={currentItem} candidate={item} compact />
                          )}
                        </div>
                        <div className="bl-primary px-3 py-1 text-[9px] font-black shrink-0">
                          {busy ? 'Equipping…' : 'Equip'}
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
