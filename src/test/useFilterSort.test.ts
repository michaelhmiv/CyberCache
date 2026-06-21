import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFilterSort } from '@/lib/hooks/useFilterSort';

interface TestItem {
  id: string;
  name: string;
  rarity: string;
  element: string;
  power: number;
}

function makeItems(): TestItem[] {
  return [
    { id: 'a', name: 'Nova Blaster', rarity: 'Legendary', element: 'Fire', power: 100 },
    { id: 'b', name: 'Frost Rifle', rarity: 'Rare', element: 'Ice', power: 70 },
    { id: 'c', name: 'Shock Pistol', rarity: 'Epic', element: 'Shock', power: 85 },
    { id: 'd', name: 'Ice Dagger', rarity: 'Common', element: 'Ice', power: 40 },
  ];
}

describe('useFilterSort', () => {
  it('returns all items when no filters or search', () => {
    const { result } = renderHook(() =>
      useFilterSort<TestItem>({
        items: makeItems(),
        searchFields: [(i) => i.name],
        sorts: [{ key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) }],
      }),
    );
    expect(result.current.filtered).toHaveLength(4);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('filters by search text across configured fields', () => {
    const { result } = renderHook(() =>
      useFilterSort<TestItem>({
        items: makeItems(),
        searchFields: [(i) => i.name],
        sorts: [{ key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) }],
      }),
    );
    act(() => result.current.setSearch('pistol'));
    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].id).toBe('c');
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('filters across multiple search fields (OR)', () => {
    const { result } = renderHook(() =>
      useFilterSort<TestItem>({
        items: makeItems(),
        searchFields: [(i) => i.name, (i) => i.element],
        sorts: [{ key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) }],
      }),
    );
    act(() => result.current.setSearch('ice'));
    // Should match Frost Rifle (element Ice) and Ice Dagger (name Ice)
    expect(result.current.filtered.map((i) => i.id).sort()).toEqual(['b', 'd']);
  });

  it('filters by a single facet value', () => {
    const { result } = renderHook(() =>
      useFilterSort<TestItem>({
        items: makeItems(),
        searchFields: [(i) => i.name],
        facets: [
          {
            key: 'element',
            label: 'Element',
            values: () => ['Fire', 'Ice', 'Shock'],
            matches: (item, value) => item.element === value,
          },
        ],
        sorts: [{ key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) }],
      }),
    );
    act(() => result.current.toggleFacet('element', 'Ice'));
    expect(result.current.filtered.map((i) => i.id).sort()).toEqual(['b', 'd']);
  });

  it('ORs values within the same facet, ANDs across facets', () => {
    const { result } = renderHook(() =>
      useFilterSort<TestItem>({
        items: makeItems(),
        searchFields: [(i) => i.name],
        facets: [
          {
            key: 'element',
            label: 'Element',
            values: () => ['Fire', 'Ice', 'Shock'],
            matches: (item, value) => item.element === value,
          },
          {
            key: 'rarity',
            label: 'Rarity',
            values: () => ['Common', 'Rare', 'Epic', 'Legendary'],
            matches: (item, value) => item.rarity === value,
          },
        ],
        sorts: [{ key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) }],
      }),
    );
    // Within element facet OR: Ice + Shock
    act(() => result.current.toggleFacet('element', 'Ice'));
    act(() => result.current.toggleFacet('element', 'Shock'));
    // Across facets AND: must also be Rare
    act(() => result.current.toggleFacet('rarity', 'Rare'));
    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].id).toBe('b');
  });

  it('sorts using the selected comparator', () => {
    const { result } = renderHook(() =>
      useFilterSort<TestItem>({
        items: makeItems(),
        searchFields: [(i) => i.name],
        sorts: [
          { key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
          { key: 'power', label: 'Power', compare: (a, b) => b.power - a.power },
        ],
      }),
    );
    act(() => result.current.setSortKey('power'));
    expect(result.current.filtered.map((i) => i.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('clears all filters with clearFacets', () => {
    const { result } = renderHook(() =>
      useFilterSort<TestItem>({
        items: makeItems(),
        searchFields: [(i) => i.name],
        facets: [
          {
            key: 'rarity',
            label: 'Rarity',
            values: () => ['Common', 'Rare', 'Epic', 'Legendary'],
            matches: (item, value) => item.rarity === value,
          },
        ],
        sorts: [{ key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) }],
      }),
    );
    act(() => result.current.setSearch('Nova'));
    act(() => result.current.toggleFacet('rarity', 'Legendary'));
    act(() => result.current.clearFacets());
    expect(result.current.search).toBe('');
    expect(result.current.activeFacets.rarity?.size ?? 0).toBe(0);
    expect(result.current.filtered).toHaveLength(4);
  });

  it('uses default sort key when provided', () => {
    const { result } = renderHook(() =>
      useFilterSort<TestItem>({
        items: makeItems(),
        searchFields: [(i) => i.name],
        sorts: [
          { key: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
          { key: 'power', label: 'Power', compare: (a, b) => b.power - a.power },
        ],
        defaultSortKey: 'power',
      }),
    );
    expect(result.current.sortKey).toBe('power');
    expect(result.current.filtered[0].id).toBe('a');
  });
});
