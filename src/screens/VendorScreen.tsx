import React, { useMemo } from 'react';
import { Search, X, ArrowUpDown } from 'lucide-react';
import { usePlayerStore } from '@/store';
import { VENDOR_CONSUMABLES } from '@/constants/consumables';
import { FAMILY_COLORS, FAMILY_LABELS } from '@/lib/consumables/families';
import { MobileCard } from '@/components/layout/MobileCard';
import { ChipRail } from '@/components/common/ChipRail';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import { useFilterSort } from '@/lib/hooks/useFilterSort';
import type { ConsumableDef } from '@/types/consumables';
import { chipClip } from '@/lib/ui/clips';

type SortKey = 'price' | 'owned' | 'name';

export const VendorScreen: React.FC = () => {
  const player = usePlayerStore();
  const [notice, setNotice] = React.useState<string | null>(null);
  const [buyingId, setBuyingId] = React.useState<string | null>(null);

  const familyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    VENDOR_CONSUMABLES.forEach((c) => {
      counts[c.family] = (counts[c.family] || 0) + 1;
    });
    return counts;
  }, []);

  const sortOptions = useMemo(
    () => [
      { key: 'price', label: 'Cheapest First', compare: (a: ConsumableDef, b: ConsumableDef) => a.basePrice - b.basePrice },
      {
        key: 'owned',
        label: 'Most Owned',
        compare: (a: ConsumableDef, b: ConsumableDef) => player.getConsumableCount(b.id) - player.getConsumableCount(a.id),
      },
      { key: 'name', label: 'Name A-Z', compare: (a: ConsumableDef, b: ConsumableDef) => a.name.localeCompare(b.name) },
    ],
    [player],
  );

  const { filtered, search, setSearch, activeFacets, toggleFacet, clearFacets, sortKey, setSortKey, hasActiveFilters } = useFilterSort({
    items: VENDOR_CONSUMABLES,
    searchFields: [(c) => c.name, (c) => c.shortDescription, (c) => c.tacticalRole],
    facets: [
      {
        key: 'family',
        label: 'Family',
        values: () => Object.keys(FAMILY_LABELS).filter((family) => (familyCounts[family] ?? 0) > 0),
        matches: (item, value) => item.family === value,
      },
    ],
    sorts: sortOptions,
    defaultSortKey: 'price',
  });

  const handleBuy = async (type: string, price: number, name: string) => {
    if (player.credits < price) {
      setNotice('Not enough credits.');
      return;
    }
    setBuyingId(type);
    setNotice(null);
    try {
      await verifiedOps.vendorBuy(type, 1);
      setNotice(`${name} added to inventory.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Purchase failed.');
    } finally {
      setBuyingId(null);
    }
  };

  const activeFamilies = activeFacets.family ?? new Set<string>();

  return (
    <div className="bl-page p-4 space-y-4 pb-20">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Consumable Vendor</div>
          <div className="text-xs text-text-muted">Buy common boss-prep tools. Advanced ammo and payloads are crafted in the Workshop.</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-text-muted uppercase">Credits</div>
          <div className="text-sm font-black text-amber">{player.credits.toLocaleString()}</div>
        </div>
      </div>

      <ChipRail>
        {(Object.keys(FAMILY_LABELS) as Array<keyof typeof FAMILY_LABELS>)
          .filter((family) => (familyCounts[family] ?? 0) > 0)
          .map((family) => {
            const label = `${FAMILY_LABELS[family]} (${familyCounts[family]})`;
            const active = activeFamilies.has(family);
            return (
              <button
                key={family}
                type="button"
                onClick={() => toggleFacet('family', family)}
                className={`shrink-0 flex items-center gap-1 px-2.5 py-1 text-[10px] font-black border transition-colors ${
                  active ? 'border-amber bg-amber/15' : 'border-border bg-surface opacity-70 hover:opacity-100'
                } ${FAMILY_COLORS[family]}`}
                style={chipClip}
              >
                {label}
              </button>
            );
          })}
      </ChipRail>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor…"
            className="w-full h-9 pl-8 pr-8 rounded-lg border border-border bg-surface-raised text-xs text-text-primary placeholder:text-text-muted"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ArrowUpDown size={11} className="text-text-muted" />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            className="text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
          >
            {sortOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </div>
        {hasActiveFilters && (
          <button type="button" onClick={clearFacets} className="text-[10px] font-black text-red hover:text-red/80 shrink-0">
            Clear
          </button>
        )}
      </div>

      {notice && <div className="text-xs text-text-secondary">{notice}</div>}

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-xs text-text-muted">
            {hasActiveFilters ? 'No vendor items match your search or filter.' : 'No vendor items available.'}
          </div>
        ) : filtered.map((c) => {
          const owned = player.getConsumableCount(c.id);
          const buying = buyingId === c.id;
          return (
            <MobileCard key={c.id} className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="bl-well w-10 h-10 flex items-center justify-center shrink-0">
                    <span className={`text-[10px] font-black uppercase ${FAMILY_COLORS[c.family]}`}>
                      {FAMILY_LABELS[c.family].slice(0, 3)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-text-primary truncate">{c.name}</div>
                    <div className="text-[10px] text-amber">{c.tacticalRole}</div>
                    <div className="text-[10px] text-text-muted">{c.shortDescription}</div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-text-muted">Owned</div>
                  <div className="text-sm font-black text-text-primary">{owned}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-surface text-text-muted">{c.trigger}</span>
                {c.counterTags.map((tag) => (
                  <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded border border-amber/30 bg-amber/10 text-amber font-bold">{tag}</span>
                ))}
              </div>

              <button
                onClick={() => handleBuy(c.id, c.basePrice, c.name)}
                disabled={player.credits < c.basePrice || Boolean(buyingId)}
                className="w-full py-2 rounded-xl bl-primary text-xs font-black disabled:opacity-40"
              >
                {buying ? 'Buying…' : `Buy 1 • ${c.basePrice.toLocaleString()}cr`}
              </button>
            </MobileCard>
          );
        })}
      </div>
    </div>
  );
};
