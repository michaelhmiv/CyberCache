import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { CONSUMABLES, CONSUMABLE_SLOTS, getConsumableQualityBand } from '@/constants/consumables';
import type { ConsumableDef, ConsumableFamily } from '@/constants/consumables';
import { getConsumableFamilyVisual } from '@/constants/consumableFamilyVisuals';
import { useLoadoutStore, useMarketStore, usePlayerStore } from '@/store';
import { ConsumableInspectSheet } from '@/components/consumables/ConsumableInspectSheet';

const FAMILY_GLYPHS: Record<ConsumableFamily, string> = {
  survival: getConsumableFamilyVisual('survival').glyph,
  ammo: getConsumableFamilyVisual('ammo').glyph,
  ordnance: getConsumableFamilyVisual('ordnance').glyph,
  tactical: getConsumableFamilyVisual('tactical').glyph,
  economy: getConsumableFamilyVisual('economy').glyph,
  corrupted: getConsumableFamilyVisual('corrupted').glyph,
};

const FAMILY_COLORS: Record<ConsumableFamily, string> = {
  survival: 'text-green border-green/30 bg-green/10',
  ammo: 'text-red border-red/30 bg-red/10',
  ordnance: 'text-orange border-orange/30 bg-orange/10',
  tactical: 'text-cyan border-cyan/30 bg-cyan/10',
  economy: 'text-amber border-amber/30 bg-amber/10',
  corrupted: 'text-purple border-purple/30 bg-purple/10',
};

const FAMILY_LABELS: Record<ConsumableFamily, string> = {
  survival: 'Survival',
  ammo: 'Ammunition',
  ordnance: 'Ordnance',
  tactical: 'Tactical',
  economy: 'Economy',
  corrupted: 'Corrupted',
};

const FAMILY_ORDER: ConsumableFamily[] = ['survival', 'ammo', 'ordnance', 'tactical', 'economy', 'corrupted'];

export const ConsumablesScreen: React.FC<{ onNavigate?: (screen: string) => void }> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const market = useMarketStore();
  const [inspecting, setInspecting] = useState<ConsumableDef | null>(null);
  const [filterFamily, setFilterFamily] = useState<ConsumableFamily | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'count' | 'quality' | 'name'>('count');
  const [notice, setNotice] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const result: Record<ConsumableFamily, { def: ConsumableDef; count: number; bestQuality: number }[]> = {
      survival: [],
      ammo: [],
      ordnance: [],
      tactical: [],
      economy: [],
      corrupted: [],
    };

    Object.values(CONSUMABLES).forEach((def) => {
      const count = player.getConsumableCount(def.id);
      if (count > 0) {
        result[def.family].push({ def, count, bestQuality: player.getBestConsumableQuality(def.id) });
      }
    });

    return result;
  }, [player]);

  const totalOwned = useMemo(
    () => Object.values(grouped).reduce((sum, items) => sum + items.reduce((s, i) => s + i.count, 0), 0),
    [grouped],
  );

  const displayItems = useMemo(() => {
    let result: Array<{ def: ConsumableDef; count: number; bestQuality: number }> =
      filterFamily === 'all' ? Object.values(grouped).flat() : grouped[filterFamily];

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(({ def }) =>
        def.name.toLowerCase().includes(q) ||
        def.shortDescription.toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      if (sortBy === 'count') return b.count - a.count;
      if (sortBy === 'quality') return b.bestQuality - a.bestQuality;
      return a.def.name.localeCompare(b.def.name);
    });

    return result;
  }, [grouped, filterFamily, search, sortBy]);

  const handleEquip = (id: string) => {
    const def = CONSUMABLES[id];
    if (!def) {
      setNotice('This consumable cannot be equipped.');
      return;
    }
    if (player.getConsumableCount(id) <= 0) {
      setNotice('You do not own any of this consumable.');
      return;
    }
    // Find first empty slot, or first slot already holding this consumable.
    const slots = CONSUMABLE_SLOTS;
    let targetSlot = slots.find((s) => !loadout.consumables[s]);
    if (!targetSlot) {
      // All slots full — replace the first slot
      targetSlot = slots[0];
    }
    loadout.setConsumableSlot(targetSlot, id);
    setNotice(`${def.name} equipped to Slot ${slots.indexOf(targetSlot) + 1}.`);
    setInspecting(null);
  };

  const openVendor = () => {
    market.setActiveTab('vendor');
    onNavigate?.('market');
  };

  return (
    <div className="space-y-3 p-3 pb-20">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-black text-text-primary">Consumables</div>
          <div className="text-[10px] text-text-muted">Tap any item to inspect effects, quality batches, triggers, and loadout slots.</div>
        </div>
        <button type="button" onClick={openVendor} className="rounded-full border border-amber/40 bg-amber/10 px-2 py-1 text-[10px] font-black text-amber">
          <span className="inline-flex items-center gap-1"><span style={{ fontSize: '11px' }}>$</span> Vendor</span>
        </button>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2">
        <div className="text-[10px] text-text-muted">Total owned</div>
        <div className="text-xs font-black text-amber">{totalOwned}</div>
      </div>

      {notice && <div className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-[10px] text-amber">{notice}</div>}

      <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
        <button
          type="button"
          onClick={() => setFilterFamily('all')}
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black transition-colors ${
            filterFamily === 'all' ? 'border-amber bg-amber/15 text-amber' : 'border-border bg-surface text-text-muted'
          }`}
        >
          All ({totalOwned})
        </button>
        {FAMILY_ORDER.map((family) => {
          const items = grouped[family];
          const familyTotal = items.reduce((s, i) => s + i.count, 0);
          if (familyTotal === 0) return null;
          const familyGlyph = FAMILY_GLYPHS[family];
          const active = filterFamily === family;
          return (
            <button
              key={family}
              type="button"
              onClick={() => setFilterFamily(family)}
              className={`shrink-0 flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black transition-colors ${
                active ? 'border-amber bg-amber/15 text-amber' : 'border-border bg-surface text-text-muted'
              }`}
            >
              <span style={{ fontSize: '10px' }}>{familyGlyph}</span>
              <span>{FAMILY_LABELS[family]} ({familyTotal})</span>
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
            placeholder="Search consumables…"
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
          onChange={(e) => setSortBy(e.target.value as 'count' | 'quality' | 'name')}
          className="shrink-0 text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
        >
          <option value="count">Most Owned</option>
          <option value="quality">Best Quality</option>
          <option value="name">Name A-Z</option>
        </select>
      </div>

      {displayItems.length === 0 ? (
        <div className="py-10 text-center">
          <div className="text-sm text-text-muted">
            {search || filterFamily !== 'all' ? 'No consumables match your search or filter.' : 'No consumables in inventory.'}
          </div>
          {totalOwned === 0 && (
            <button type="button" onClick={openVendor} className="mt-3 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-xs font-black text-amber">
              Open Vendor
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {displayItems.map(({ def, count, bestQuality }) => {
            const colorClass = FAMILY_COLORS[def.family];
            return (
              <button
                key={def.id}
                type="button"
                onClick={() => setInspecting(def)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-bg/60 p-2.5 text-left active:scale-[0.98] transition-transform"
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-lg font-black ${colorClass.split(' ').slice(1).join(' ')}`}>
                  {def.visual.glyph}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-black text-text-primary">{def.name}</div>
                  <div className="text-[9px] text-text-muted">{def.shortDescription}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <span className="rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[8px] font-bold text-amber">{def.tacticalRole}</span>
                    <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-[8px] text-text-muted">Q{bestQuality.toFixed(0)}% · {getConsumableQualityBand(bestQuality)}</span>
                    {CONSUMABLE_SLOTS.some(slot => loadout.consumables[slot] === def.id) && (
                      <span className="rounded border border-green/30 bg-green/10 px-1.5 py-0.5 text-[8px] font-bold text-green">Equipped</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-black text-text-primary">x{count}</div>
                  <div className="text-[9px] text-text-muted">owned</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <ConsumableInspectSheet
        consumable={inspecting}
        open={!!inspecting}
        onClose={() => setInspecting(null)}
        onEquip={handleEquip}
      />
    </div>
  );
};
