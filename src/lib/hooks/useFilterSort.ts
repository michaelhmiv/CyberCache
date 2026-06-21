/**
 * useFilterSort — generic search + multi-facet filter + sort hook for pickers.
 *
 * Encapsulates the pattern currently duplicated across SlotGearPicker and
 * GearHub so future pickers cannot regress.
 */
import { useMemo, useState } from 'react';

export interface Facet<T> {
  /** Machine key, e.g. 'rarity' or 'element'. */
  key: string;
  /** Human label shown above the chips. */
  label: string;
  /** All possible values for this facet (used to render chips). */
  values: (items: T[]) => string[];
  /** Return true when `item` belongs to `value` for this facet. */
  matches: (item: T, value: string) => boolean;
}

export interface SortOption<T> {
  key: string;
  label: string;
  compare: (a: T, b: T) => number;
}

export interface UseFilterSortArgs<T> {
  items: T[];
  /** Each closure returns searchable text. All are lowercased and OR-searched. */
  searchFields: Array<(item: T) => string>;
  facets?: Facet<T>[];
  sorts: SortOption<T>[];
  defaultSortKey?: string;
}

export interface UseFilterSortResult<T> {
  search: string;
  setSearch: (value: string) => void;
  activeFacets: Record<string, Set<string>>;
  toggleFacet: (key: string, value: string) => void;
  clearFacets: () => void;
  sortKey: string;
  setSortKey: (key: string) => void;
  sortOptions: SortOption<T>[];
  filtered: T[];
  totalCount: number;
  hasActiveFilters: boolean;
}

export function useFilterSort<T>({
  items,
  searchFields,
  facets = [],
  sorts,
  defaultSortKey,
}: UseFilterSortArgs<T>): UseFilterSortResult<T> {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(defaultSortKey ?? sorts[0]?.key ?? '');
  const [activeFacets, setActiveFacets] = useState<Record<string, Set<string>>>({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return items
      .filter((item) => {
        if (!q) return true;
        return searchFields.some((field) => field(item).toLowerCase().includes(q));
      })
      .filter((item) => {
        for (const [facetKey, selected] of Object.entries(activeFacets)) {
          if (!selected || selected.size === 0) continue;
          const facet = facets.find((f) => f.key === facetKey);
          if (!facet) continue;
          // Within a facet, selected values are ORed.
          const matches = Array.from(selected).some((value) => facet.matches(item, value));
          if (!matches) return false;
        }
        return true;
      })
      .sort((sorts.find((s) => s.key === sortKey) ?? sorts[0])?.compare ?? (() => 0));
  }, [items, search, searchFields, activeFacets, facets, sortKey, sorts]);

  const totalCount = items.length;
  const hasActiveFilters = search.trim().length > 0 || Object.values(activeFacets).some((s) => s.size > 0);

  const toggleFacet = (key: string, value: string) => {
    setActiveFacets((prev) => {
      const next = { ...prev };
      const current = new Set(next[key] ?? []);
      if (current.has(value)) current.delete(value);
      else current.add(value);
      next[key] = current;
      return next;
    });
  };

  const clearFacets = () => {
    setActiveFacets({});
    setSearch('');
  };

  return {
    search,
    setSearch,
    activeFacets,
    toggleFacet,
    clearFacets,
    sortKey,
    setSortKey,
    sortOptions: sorts,
    filtered,
    totalCount,
    hasActiveFilters,
  };
}
