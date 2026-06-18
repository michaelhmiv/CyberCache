import React, { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { usePlayerStore } from '@/store';
import { VENDOR_CONSUMABLES, type ConsumableFamily } from '@/constants/consumables';
import { MobileCard } from '@/components/layout/MobileCard';
import { verifiedOps } from '@/lib/supabase/verifiedOps';

const FAMILY_COLORS: Record<ConsumableFamily, string> = {
  survival: 'text-green',
  ammo: 'text-red',
  ordnance: 'text-orange',
  tactical: 'text-cyan',
  economy: 'text-amber',
  corrupted: 'text-purple',
};

const FAMILY_LABELS: Record<ConsumableFamily, string> = {
  survival: 'Survival',
  ammo: 'Ammunition',
  ordnance: 'Ordnance',
  tactical: 'Tactical',
  economy: 'Economy',
  corrupted: 'Corrupted',
};

export const VendorScreen: React.FC = () => {
  const player = usePlayerStore();
  const [notice, setNotice] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [filterFamily, setFilterFamily] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'price' | 'owned' | 'name'>('price');

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

  const familyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    VENDOR_CONSUMABLES.forEach(c => {
      counts[c.family] = (counts[c.family] || 0) + 1;
    });
    return counts;
  }, []);

  const displayItems = useMemo(() => {
    let result = [...VENDOR_CONSUMABLES];

    if (filterFamily !== 'all') {
      result = result.filter(c => c.family === filterFamily);
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.shortDescription.toLowerCase().includes(q) ||
        c.tacticalRole.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      if (sortBy === 'price') return a.basePrice - b.basePrice;
      if (sortBy === 'owned') {
        const aOwned = player.getConsumableCount(a.id);
        const bOwned = player.getConsumableCount(b.id);
        return bOwned - aOwned;
      }
      return a.name.localeCompare(b.name);
    });

    return result;
  }, [filterFamily, search, sortBy, player]);

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

      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        <button
          type="button"
          onClick={() => setFilterFamily('all')}
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black transition-colors ${
            filterFamily === 'all' ? 'border-amber bg-amber/15 text-amber' : 'border-border bg-surface text-text-muted'
          }`}
        >
          All ({VENDOR_CONSUMABLES.length})
        </button>
        {(Object.keys(FAMILY_LABELS) as ConsumableFamily[]).map((family) => {
          const count = familyCounts[family] || 0;
          if (count === 0) return null;
          const familyColor = FAMILY_COLORS[family];
          const active = filterFamily === family;
          return (
            <button
              key={family}
              type="button"
              onClick={() => setFilterFamily(family)}
              className={`shrink-0 flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black transition-colors ${
                active ? 'border-amber bg-amber/15' : 'border-border bg-surface opacity-70'
              } ${familyColor}`}
            >
              <span>{FAMILY_LABELS[family]} ({count})</span>
            </button>
          );
        })}
      </div>

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
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'price' | 'owned' | 'name')}
          className="shrink-0 text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
        >
          <option value="price">Cheapest First</option>
          <option value="owned">Most Owned</option>
          <option value="name">Name A-Z</option>
        </select>
      </div>

      {notice && <div className="text-xs text-text-secondary">{notice}</div>}

      <div className="space-y-2">
        {displayItems.length === 0 ? (
          <div className="py-8 text-center text-xs text-text-muted">
            {search || filterFamily !== 'all' ? 'No vendor items match your search or filter.' : 'No vendor items available.'}
          </div>
        ) : displayItems.map((c) => {
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
                {c.allowedSlots.map((slot) => (
                  <span key={slot} className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-surface text-text-muted">{slot}</span>
                ))}
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
