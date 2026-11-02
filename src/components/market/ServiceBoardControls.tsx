import React from 'react';
import { Filter, Search } from 'lucide-react';
import {
  hasServiceBoardBrowseTerms,
  type ServiceBoardQuery,
  type ServiceBoardSort,
} from '@/lib/market/boardQuery';

/**
 * Service-board browse controls (market-lane parity) — the Buy
 * lane's toolkit in the Buy lane's shapes and vocabulary, shared by
 * the Repair and Shield Tech boards: search, rarity chips, the
 * requirements-met chip ("Jobs I can take"), price / work-size
 * bands, a sort select, a match count, and a clear-filters button.
 * Lane-specific facets (vehicle classes, condition band, behavior
 * swap) render through `children` between the chips and the bands.
 *
 * The query itself lives in useMarketStore (the boards unmount on
 * tab switch); this component is a pure editor of it. Numeric
 * inputs write parsed numbers (blank = unbounded) on every
 * keystroke — the boards debounce the refetch.
 */

const filterInputCls =
  'w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-muted';

const BOARD_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

export interface ServiceBoardSortOption {
  value: ServiceBoardSort;
  label: string;
}

interface ServiceBoardControlsProps {
  query: ServiceBoardQuery;
  onChange: (patch: Partial<ServiceBoardQuery>) => void;
  /** Matching open postings (server total); null while loading. */
  total: number | null;
  searchPlaceholder: string;
  sortOptions: ServiceBoardSortOption[];
  /** Singular noun for the count line ("job"). */
  noun: string;
  children?: React.ReactNode;
}

const numOrUndefined = (raw: string): number | undefined => {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits === '') return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
};

export const ServiceBoardControls: React.FC<ServiceBoardControlsProps> = ({
  query,
  onChange,
  total,
  searchPlaceholder,
  sortOptions,
  noun,
  children,
}) => {
  const active = hasServiceBoardBrowseTerms(query);
  const clearAll = () =>
    onChange({
      search: undefined,
      rarity: undefined,
      vehicleClass: undefined,
      fromBehavior: undefined,
      toBehavior: undefined,
      conditionMin: undefined,
      conditionMax: undefined,
      pointsMin: undefined,
      pointsMax: undefined,
      priceMin: undefined,
      priceMax: undefined,
      canTake: undefined,
      sort: undefined,
    });
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query.search ?? ''}
            onChange={(e) => onChange({ search: e.target.value || undefined })}
            placeholder={searchPlaceholder}
            aria-label="Search open postings"
            className="w-full rounded-lg border border-border bg-surface-raised py-2 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-muted"
          />
        </div>
        <button
          type="button"
          onClick={clearAll}
          disabled={!active}
          aria-label="Clear board filters"
          className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-text-muted transition-colors active:text-amber disabled:opacity-40"
        >
          <Filter size={14} />
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {BOARD_RARITIES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onChange({ rarity: query.rarity === r ? undefined : r })}
            className={`whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-bold ${query.rarity === r ? 'border-amber bg-amber text-bg' : 'border-border bg-surface-raised text-text-secondary'}`}
          >
            {r}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ canTake: query.canTake ? undefined : true })}
          aria-pressed={query.canTake === true}
          className={`whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-bold ${query.canTake ? 'border-emerald-500 bg-emerald-500 text-bg' : 'border-border bg-surface-raised text-text-secondary'}`}
        >
          Jobs I can take
        </button>
      </div>
      {children}
      <div className="flex gap-2">
        <input
          value={query.priceMin ?? ''}
          onChange={(e) => onChange({ priceMin: numOrUndefined(e.target.value) })}
          inputMode="numeric"
          placeholder="Min cr"
          aria-label="Minimum job price in credits"
          className={filterInputCls}
        />
        <input
          value={query.priceMax ?? ''}
          onChange={(e) => onChange({ priceMax: numOrUndefined(e.target.value) })}
          inputMode="numeric"
          placeholder="Max cr"
          aria-label="Maximum job price in credits"
          className={filterInputCls}
        />
        <input
          value={query.pointsMin ?? ''}
          onChange={(e) => onChange({ pointsMin: numOrUndefined(e.target.value) })}
          inputMode="numeric"
          placeholder="Min pts"
          aria-label="Minimum work size in points"
          className={filterInputCls}
        />
        <input
          value={query.pointsMax ?? ''}
          onChange={(e) => onChange({ pointsMax: numOrUndefined(e.target.value) })}
          inputMode="numeric"
          placeholder="Max pts"
          aria-label="Maximum work size in points"
          className={filterInputCls}
        />
      </div>
      <div className="flex items-center justify-between">
        <select
          value={query.sort ?? 'newest'}
          onChange={(e) => onChange({ sort: e.target.value as ServiceBoardSort })}
          aria-label="Sort open postings"
          className="text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {total != null && (
          <span className="text-[10px] text-text-muted">
            {total.toLocaleString()} {noun}{total === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  );
};
