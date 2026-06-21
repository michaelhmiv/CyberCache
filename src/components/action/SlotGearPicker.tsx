/**
 * SlotGearPicker — full-height bottom sheet for equipping a loadout slot.
 *
 * Refactored on top of useFilterSort + PickerSheet so gear selection stays
 * consistent across the app. Still uses gearCardSummary for display and
 * GearCompare for deltas vs the currently equipped item.
 */
import React, { useMemo, useState } from 'react';
import { Search, ArrowUpDown, X, LayoutGrid, List } from 'lucide-react';
import { useInventoryStore } from '@/store';
import { Element, Rarity, Manufacturer, WeaponType } from '@/types/game';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';
import type { GearItem, Weapon } from '@/types/items';
import { GearCompare } from '@/components/gear/GearCompare';
import { gearCardSummary } from '@/lib/gear/gearCardSummary';
import { isItemCompatibleWithSlot } from '@/lib/loadout/loadoutSlotCompat';
import { PickerSheet } from '@/components/common/PickerSheet';
import { ChipRail } from '@/components/common/ChipRail';
import { signClip, chipClip } from '@/lib/ui/clips';
import { useFilterSort, type Facet, type SortOption } from '@/lib/hooks/useFilterSort';

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

const SLOT_LABEL: Record<LoadoutSlot, string> = {
  primary: 'Primary Weapon', secondary: 'Secondary Weapon', heavy: 'Heavy Weapon',
  shield: 'Shield', classMod: 'Class Mod', relic: 'Relic', ordnance: 'Ordnance',
};

type SortKey =
  | 'combatPower' | 'bossPower' | 'farmPower' | 'economy' | 'rollQuality' | 'level' | 'rarity' | 'name'
  | 'shieldHp' | 'mitigation' | 'recharge'
  | 'skillBoost' | 'nodeCount' | 'idleValue' | 'dropValue' | 'scrapValue' | 'affixCount'
  | 'payload' | 'shieldBreak' | 'armorBreak';

type SortSpec = { key: SortKey; label: string };

const SLOT_SORT_SPECS: Record<LoadoutSlot, SortSpec[]> = {
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
// Copy primary options to secondary and heavy so they share weapon-specific sort keys.
SLOT_SORT_SPECS.secondary = SLOT_SORT_SPECS.primary;
SLOT_SORT_SPECS.heavy = SLOT_SORT_SPECS.primary;

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

function itemSortValue(item: GearItem, key: SortKey): number {
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

function makeSortOptions(slot: LoadoutSlot): SortOption<GearItem>[] {
  return (SLOT_SORT_SPECS[slot] ?? SLOT_SORT_SPECS.primary).map((spec) => ({
    key: spec.key,
    label: spec.label,
    compare: (a, b) => {
      if (spec.key === 'name') return a.name.localeCompare(b.name);
      return itemSortValue(b, spec.key) - itemSortValue(a, spec.key);
    },
  }));
}

const WeaponSlots = new Set<LoadoutSlot>(['primary', 'secondary', 'heavy']);

export const SlotGearPicker: React.FC<SlotGearPickerProps> = ({
  slot, currentItemId, onClose, onEquip, onUnequip, busy = false, error = null,
}) => {
  const inventory = useInventoryStore();
  const allItems = inventory.items;

  const compatibleItems = useMemo(
    () => allItems.filter((item) => isItemCompatibleWithSlot(item, slot)),
    [allItems, slot],
  );

  const isWeaponSlot = WeaponSlots.has(slot);

  const facets: Facet<GearItem>[] = useMemo(() => {
    const result: Facet<GearItem>[] = [
      {
        key: 'rarity',
        label: 'Rarity',
        values: () => Object.values(Rarity),
        matches: (item, value) => item.rarity === value,
      },
      {
        key: 'element',
        label: 'Element',
        values: () => Object.values(Element).filter((e) => e !== Element.Kinetic),
        matches: (item, value) => getItemElement(item) === value,
      },
    ];

    if (isWeaponSlot) {
      result.push(
        {
          key: 'manufacturer',
          label: 'Mfg',
          values: () => Object.values(Manufacturer),
          matches: (item, value) => getItemManufacturer(item) === value,
        },
        {
          key: 'weaponType',
          label: 'Type',
          values: () => Object.values(WeaponType),
          matches: (item, value) => getItemWeaponType(item) === value,
        },
      );
    }

    const sources = Array.from(new Set(
      compatibleItems
        .filter((i) => 'sourceTag' in i)
        .map((i) => (i as { sourceTag: string }).sourceTag),
    )).sort();
    if (sources.length > 0) {
      result.push({
        key: 'source',
        label: 'Src',
        values: () => sources,
        matches: (item, value) => 'sourceTag' in item && (item as { sourceTag: string }).sourceTag === value,
      });
    }

    return result;
  }, [compatibleItems, isWeaponSlot]);

  const sortOptions = useMemo(() => makeSortOptions(slot), [slot]);

  const defaultSortKey = useMemo(
    () => sortOptions[0]?.key,
    [sortOptions],
  );

  const { search, setSearch, activeFacets, toggleFacet, clearFacets, sortKey, setSortKey, filtered } = useFilterSort<GearItem>({
    items: compatibleItems,
    searchFields: [
      (item) => item.name,
      (item) => item.rarity,
      (item) => getItemElement(item) ?? '',
      (item) => getItemManufacturer(item) ?? '',
      (item) => getItemWeaponType(item) ?? '',
    ],
    facets,
    sorts: sortOptions,
    defaultSortKey,
  });

  const currentItem = useMemo(
    () => (currentItemId ? allItems.find((i) => i.id === currentItemId) ?? null : null),
    [allItems, currentItemId],
  );

  const hasActiveFilters = search.trim().length > 0 || Object.values(activeFacets).some((s) => s.size > 0);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const renderChipRow = (facet: Facet<GearItem>) => (
    <ChipRail key={facet.key} className="py-0.5">
      <span className="text-[8px] font-black uppercase tracking-wider text-text-muted shrink-0">{facet.label}</span>
      {facet.values(compatibleItems).map((value) => {
        const active = activeFacets[facet.key]?.has(value) ?? false;
        return (
          <button
            key={value}
            type="button"
            onClick={() => toggleFacet(facet.key, value)}
            className={`shrink-0 px-2 py-0.5 text-[9px] font-black border transition-colors ${
              active
                ? 'border-amber/60 bg-amber/10 text-amber'
                : 'border-border/50 bg-bg/50 text-text-muted hover:border-amber/30'
            }`}
            style={chipClip}
          >
            {value}
          </button>
        );
      })}
    </ChipRail>
  );

  const header = (
    <>
      {/* Search bar */}
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

      {/* Filter chips */}
      <div className="space-y-1.5">{facets.map(renderChipRow)}</div>

      {/* Sort + clear row */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-1.5">
          <ArrowUpDown size={11} className="text-text-muted" />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            className="text-[9px] font-black uppercase border border-border/50 bg-bg/50 text-text-primary px-1.5 py-0.5 focus:outline-none"
            style={chipClip}
          >
            {sortOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button type="button" onClick={clearFacets} className="text-[9px] font-black text-red hover:text-red/80">
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={() => setViewMode((v) => (v === 'list' ? 'grid' : 'list'))}
            aria-label={viewMode === 'list' ? 'Switch to grid view' : 'Switch to list view'}
            className="bl-secondary p-1.5 text-text-muted"
          >
            {viewMode === 'list' ? <LayoutGrid size={14} /> : <List size={14} />}
          </button>
        </div>
      </div>
    </>
  );

  const candidateItems = filtered.filter((item) => item.id !== currentItemId);

  return (
    <PickerSheet
      title={SLOT_LABEL[slot]}
      subtitle={`${filtered.length} of ${compatibleItems.length} items`}
      header={header}
      onClose={onClose}
    >
      {/* Error banner */}
      {error && (
        <div className="mb-2">
          <div className="border-2 border-red/40 bg-red/10 p-2 text-[11px] font-bold text-red-light" style={signClip}>
            {error}
          </div>
        </div>
      )}

      {/* Currently equipped */}
      {currentItem && (
        <div className="mb-2">
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

      {/* Item list */}
      {candidateItems.length === 0 ? (
        <div className="border border-border bg-bg/70 p-6 text-center text-xs text-text-muted" style={signClip}>
          {hasActiveFilters ? 'No items match your search or filters.' : `No compatible ${SLOT_LABEL[slot].toLowerCase()} items in your inventory.`}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 gap-2">
          {candidateItems.map((item) => {
            const accent = RARITY_COLORS[item.rarity] ?? '#A5A7B5';
            const summary = gearCardSummary(item);
            const topStat = summary.primaryStats[0];
            return (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                onClick={() => onEquip(item.id)}
                className="border-2 border-border bg-surface/90 p-2 text-left active:scale-[0.99] transition-transform hover:border-amber/30 disabled:opacity-50 disabled:scale-100"
                style={{ ...signClip, borderColor: `${accent}40` }}
              >
                <div className="min-w-0">
                  <div className="text-xs font-black truncate" style={{ color: accent }}>{item.name}</div>
                  <div className="text-[9px] text-text-muted">{item.rarity} · Lv.{item.level}</div>
                  {topStat && (
                    <div className="mt-1 text-[9px]">
                      <span className="text-text-muted">{topStat.label}</span>
                      <span className={`font-bold ml-1 ${topStat.tone ?? 'text-text-primary'}`}>{topStat.value}</span>
                    </div>
                  )}
                  {currentItem && (
                    <GearCompare current={currentItem} candidate={item} compact />
                  )}
                </div>
                <div className="mt-2 bl-primary px-3 py-1 text-[9px] font-black w-fit">
                  {busy ? 'Equipping…' : 'Equip'}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1.5">
          {candidateItems.map((item) => {
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
    </PickerSheet>
  );
};
