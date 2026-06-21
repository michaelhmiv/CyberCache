/**
 * ConsumablePicker — full-height bottom sheet for equipping a loadout consumable slot.
 *
 * Mirrors SlotGearPicker's chrome:
 *   - Search bar (name, family, tacticalRole, counterTag)
 *   - Family filter chips (with counts)
 *   - Sort options (owned count, family, name, "matches boss" when bossContext)
 *   - Inline ConsumableCompare vs the currently slotted item
 *   - Full-height layout (not scrunched at bottom)
 */
import React, { useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Search, ArrowUpDown, X } from 'lucide-react';
import { usePlayerStore } from '@/store';
import { CONSUMABLES } from '@/constants/consumables';
import type { ConsumableDef, ConsumableFamily } from '@/constants/consumables';
import type { ConsumableSlot } from '@/types/game';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';
import { ConsumableCompare } from '@/components/consumables/ConsumableCompare';
import { FAMILY_COLORS, FAMILY_LABELS } from '@/lib/consumables/families';

// ── Constants ────────────────────────────────────────────────────────────────

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' } as const;
const chipClip = { clipPath: 'polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%)' } as const;

const SLOT_LABEL: Record<ConsumableSlot, string> = {
  PreFight: 'Slot 1',
  MidFight: 'Slot 2',
  Emergency: 'Slot 3',
};

interface SortOption {
  key: string;
  label: string;
}

const BASE_SORT_OPTIONS: SortOption[] = [
  { key: 'owned', label: 'Owned ↓' },
  { key: 'family', label: 'Family A-Z' },
  { key: 'name', label: 'Name A-Z' },
];

// ── Boss-context sort (injected when bossContext prop is provided) ────────────

interface BossContext {
  missingCounters: string[];
  bossName: string;
}

// ── Component ────────────────────────────────────────────────────────────────

interface ConsumablePickerProps {
  slot: ConsumableSlot;
  currentId: string | null;
  onClose: () => void;
  onEquip: (consumableId: string) => Promise<void>;
  onUnequip: () => Promise<void>;
  busy?: boolean;
  error?: string | null;
  /** When present, picker adds a "Matches {bossName}" sort that surfaces
   *  counter-tags intersecting `missingCounters` first. */
  bossContext?: BossContext;
}

// Cast helper: CONSUMABLES is keyed by id, we want an iterable of defs.
function allConsumableDefs(): ConsumableDef[] {
  return Object.values(CONSUMABLES) as ConsumableDef[];
}

// Marked as LoadoutSlot for consumer-facing API parity, but the picker only
// needs the ConsumableSlot subset. The cast is transparent to callers.
export type { LoadoutSlot };

export const ConsumablePicker: React.FC<ConsumablePickerProps> = ({
  slot,
  currentId,
  onClose,
  onEquip,
  onUnequip,
  busy = false,
  error = null,
  bossContext,
}) => {
  const player = usePlayerStore();

  // ── State ──────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<string>('owned');
  const [activeFamilies, setActiveFamilies] = useState<Set<ConsumableFamily>>(new Set());

  const toggleFamily = useCallback((family: ConsumableFamily) => {
    setActiveFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setActiveFamilies(new Set());
    setSearch('');
  }, []);

  // ── Owned defs ─────────────────────────────────────────────────
  const ownedDefs = useMemo(() => {
    return allConsumableDefs().filter((def) => player.getConsumableCount(def.id) > 0);
  }, [player]);

  // ── Family→count over the owned set ────────────────────────────
  const familyCounts = useMemo(() => {
    const counts: Partial<Record<ConsumableFamily, number>> = {};
    for (const def of ownedDefs) {
      counts[def.family] = (counts[def.family] ?? 0) + 1;
    }
    return counts;
  }, [ownedDefs]);

  const activeSortOptions: SortOption[] = useMemo(() => {
    if (!bossContext) return BASE_SORT_OPTIONS;
    return [
      { key: 'bossContext', label: `Matches ${bossContext.bossName}` },
      ...BASE_SORT_OPTIONS,
    ];
  }, [bossContext]);

  // ── Filter + sort ──────────────────────────────────────────────
  const results = useMemo(() => {
    let items = ownedDefs;

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      items = items.filter((def) => {
        if (def.name.toLowerCase().includes(q)) return true;
        if (def.family.toLowerCase().includes(q)) return true;
        if (def.tacticalRole.toLowerCase().includes(q)) return true;
        if (def.shortDescription.toLowerCase().includes(q)) return true;
        if (def.counterTags.some((tag) => tag.toLowerCase().includes(q))) return true;
        const familyLabel = FAMILY_LABELS[def.family]?.toLowerCase() ?? '';
        if (familyLabel.includes(q)) return true;
        return false;
      });
    }

    if (activeFamilies.size > 0) {
      items = items.filter((def) => activeFamilies.has(def.family));
    }

    items = [...items].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'family') return a.family.localeCompare(b.family);
      if (sortBy === 'owned') {
        return player.getConsumableCount(b.id) - player.getConsumableCount(a.id);
      }
      if (sortBy === 'bossContext' && bossContext) {
        const aMatches = a.counterTags.filter((t) => bossContext.missingCounters.includes(t)).length;
        const bMatches = b.counterTags.filter((t) => bossContext.missingCounters.includes(t)).length;
        if (aMatches !== bMatches) return bMatches - aMatches;
        // Tiebreak: owned count desc
        return player.getConsumableCount(b.id) - player.getConsumableCount(a.id);
      }
      return 0;
    });

    return items;
  }, [ownedDefs, search, activeFamilies, sortBy, bossContext, player]);

  const currentDef = useMemo(
    () => (currentId ? (CONSUMABLES[currentId] as ConsumableDef | undefined) ?? null : null),
    [currentId],
  );

  const hasFilters = activeFamilies.size > 0;

  // ── Render ────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end bg-black/75"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        className="h-[92vh] w-full flex flex-col border-t-2 border-border bg-bg"
        onClick={(event) => event.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-3 border-b border-border/50">
          <div>
            <div className="bl-title text-2xl text-text-primary">{SLOT_LABEL[slot]}</div>
            <div className="text-[10px] text-text-muted">
              {results.length} of {ownedDefs.length} consumables
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
              placeholder="Search by name, family, role, counter…"
              className="w-full h-9 pl-8 pr-3 border-2 border-border bg-bg/80 text-sm font-bold text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-amber/60"
              style={signClip}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* ── Family filter chips ────────────────────────────── */}
        <div className="shrink-0 px-4 pb-2 space-y-1.5">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="text-[8px] font-black uppercase tracking-wider text-text-muted shrink-0">Family</span>
            {(Object.keys(FAMILY_LABELS) as ConsumableFamily[]).map((family) => {
              const count = familyCounts[family] ?? 0;
              if (count === 0) return null;
              const isActive = activeFamilies.has(family);
              const familyTone = FAMILY_COLORS[family];
              return (
                <button
                  key={family}
                  type="button"
                  onClick={() => toggleFamily(family)}
                  className={`shrink-0 px-2 py-0.5 text-[9px] font-black border transition-colors ${
                    isActive
                      ? 'border-amber/60 bg-amber/10 text-amber'
                      : 'border-border/50 bg-bg/50 text-text-muted hover:border-amber/30'
                  } ${!isActive ? familyTone : ''}`}
                  style={chipClip}
                >
                  {FAMILY_LABELS[family]} ({count})
                </button>
              );
            })}
          </div>

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
                {activeSortOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </div>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[9px] font-black text-red hover:text-red/80"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* ── Error banner ────────────────────────────────────── */}
        {error && (
          <div className="shrink-0 px-4 pb-2">
            <div
              className="border-2 border-red/40 bg-red/10 p-2 text-[11px] font-bold text-red-light"
              style={signClip}
            >
              {error}
            </div>
          </div>
        )}

        {/* ── Currently equipped ─────────────────────────────── */}
        {currentDef && (
          <div className="shrink-0 px-4 pb-2">
            <div className="text-[8px] font-black uppercase tracking-[0.18em] text-amber mb-1">
              Currently Equipped
            </div>
            <div
              className="border-2 border-amber/50 bg-amber/5 p-2.5 flex items-center justify-between gap-2"
              style={signClip}
            >
              <div className="min-w-0">
                <div className="text-sm font-black text-text-primary truncate">{currentDef.name}</div>
                <div className="text-[10px] text-text-muted">
                  {FAMILY_LABELS[currentDef.family]} · {currentDef.tacticalRole}
                </div>
                <div className="text-[9px] text-amber mt-0.5">
                  {player.getConsumableCount(currentDef.id)} in stock
                </div>
              </div>
              <button
                type="button"
                onClick={onUnequip}
                disabled={busy}
                className="bl-secondary px-2 py-1 text-[9px] font-black text-red shrink-0 disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Unequip'}
              </button>
            </div>
          </div>
        )}

        {/* ── Item list ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {results.filter((def) => def.id !== currentId).length === 0 ? (
            <div
              className="border border-border bg-bg/70 p-6 text-center text-xs text-text-muted"
              style={signClip}
            >
              {search || hasFilters
                ? 'No consumables match your search or filters.'
                : 'No owned consumables in your inventory.'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {results
                .filter((def) => def.id !== currentId)
                .map((def) => {
                  const familyTone = FAMILY_COLORS[def.family];
                  const owned = player.getConsumableCount(def.id);
                  return (
                    <button
                      key={def.id}
                      type="button"
                      disabled={busy}
                      onClick={() => onEquip(def.id)}
                      className="w-full border-2 border-border bg-surface/90 p-2.5 text-left active:scale-[0.99] transition-transform hover:border-amber/30 disabled:opacity-50 disabled:scale-100"
                      style={signClip}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-lg font-black shrink-0" style={{ color: `var(--${def.visual.accent})` }}>
                              {def.visual.glyph}
                            </span>
                            <span className={`text-xs font-black truncate ${familyTone}`}>{def.name}</span>
                            <span className="text-[9px] text-text-muted shrink-0">
                              Lv.{def.quality.vendorQuality}% · ×{owned}
                            </span>
                          </div>
                          <div className="text-[10px] text-text-muted mt-0.5 truncate">
                            {def.tacticalRole} · {def.trigger}
                          </div>
                          {def.counterTags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {def.counterTags.slice(0, 4).map((tag) => {
                                const isMatch = bossContext?.missingCounters.includes(tag);
                                return (
                                  <span
                                    key={tag}
                                    className={`text-[8px] px-1 py-0.5 border ${
                                      isMatch
                                        ? 'border-green/60 bg-green/10 text-green'
                                        : 'border-border/50 bg-bg/70 text-text-muted'
                                    }`}
                                    style={chipClip}
                                  >
                                    #{tag}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          {currentDef && (
                            <ConsumableCompare
                              currentId={currentDef.id}
                              candidateId={def.id}
                              compact
                            />
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
