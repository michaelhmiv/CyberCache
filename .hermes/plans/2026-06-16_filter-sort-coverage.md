# Filter & Sort Coverage — CyberCache

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add search, filtering, and sorting to every selection surface where users choose from multiple options — prioritized by data volume and decision complexity.

**Architecture:** Follow GearHub's established patterns: horizontal filter chip rails (not accordions), compact sort dropdown, search bar with clear button. Per-kind sort options for SlotGearPicker mirror GearHub's `SORTS_BY_KIND`. Consumable filters reuse the `ConsumableFamily` and `ConsumableSlot` enums already in the codebase.

**Tech Stack:** React 19, TypeScript, Tailwind CSS. No new dependencies.

---

## Priority Tiers

| Tier | Surface | Data Volume | Missing |
|------|---------|-------------|---------|
| 🔴 P1 | SlotGearPicker | ~50–200 items | Per-kind sort, filters for non-weapon slots |
| 🔴 P2 | ConsumablesScreen | ~25 types | Search, family/channel filters, sort |
| 🔴 P3 | VendorScreen | ~15 items | Search, family filters, sort |
| 🟡 P4 | MarketScreen | Variable | Sort on Buy/Sell/MyListings |
| 🟡 P5 | WorkshopScreen | ~25 recipes | Search, sort |

---

## Phase 1: SlotGearPicker — Per-kind sort + expanded filters

### Task 1.1: Add per-kind sort options

**Objective:** Mirror GearHub's `SORTS_BY_KIND` — when picking a shield, sort options should be HP, Mitigation, Recharge, etc. Not generic "Power."

**Files:** `src/components/action/SlotGearPicker.tsx`

**Current sort (lines 311-314):**
```tsx
<option value="power">Sort: Power ↓</option>
<option value="rarity">Sort: Rarity ↓</option>
<option value="level">Sort: Level ↓</option>
<option value="name">Sort: Name A-Z</option>
```

**Replacement:** Compute sort options based on the active `slot` prop. Use the existing `SORTS_BY_KIND` pattern from GearHub but inlined for the picker's simpler sort keys:

```tsx
// Define sort options per slot kind
const SLOT_SORT_OPTIONS: Record<LoadoutSlot, Array<{ key: string; label: string }>> = {
  primary: [
    { key: 'power', label: 'DPS ↓' },
    { key: 'boss', label: 'Boss ↓' },
    { key: 'farm', label: 'Farm ↓' },
    { key: 'economy', label: 'Economy ↓' },
    { key: 'roll', label: 'Roll ↓' },
    { key: 'level', label: 'Level ↓' },
    { key: 'rarity', label: 'Rarity ↓' },
    { key: 'name', label: 'Name A-Z' },
  ],
  secondary: [ /* same as primary */ ],
  heavy: [ /* same as primary */ ],
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
```

**Sort function:** Extend the existing `useMemo` filter+sort to handle the new sort keys. Reuse the scoring logic from GearHub's `itemComparable` (already in the shared `gearCardSummary.ts` — add per-key score computation there, or inline it).

**Step 1:** Add the sort options map
**Step 2:** Wire the `<select>` to use `SLOT_SORT_OPTIONS[slot]` instead of hardcoded options
**Step 3:** Implement the new sort keys in the filter+sort `useMemo`

**Verification:** Open each slot type — the sort dropdown shows the right options. "HP ↓" for shields, "DPS ↓" for weapons, etc.

### Task 1.2: Add Source filter for all slot types

**Objective:** Currently Source filtering is missing entirely. Add a Source/DropSource filter chip row, always visible regardless of slot type.

**Files:** `src/components/action/SlotGearPicker.tsx`

**Change:** Add a 5th filter row after Element chips:
```tsx
<div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
  <span className="text-[8px] font-black uppercase tracking-wider text-text-muted shrink-0">Source</span>
  {SOURCE_OPTIONS.map((src) => (
    <button key={src} onClick={() => toggleFilter('sources', src)} ...>
      {src}
    </button>
  ))}
</div>
```

Add `sources` to the `filters` state, gather unique sources from filtered items, add to `clearFilters`.

**Verification:** Source filter chips appear for all slot types. Filtering works.

---

## Phase 2: ConsumablesScreen — Search + Filter + Sort

### Task 2.1: Add family filter chips (replacing accordion)

**Objective:** Replace the accordion family grouping with horizontal filter chips — matching GearHub's kind rail pattern. Show all consumables in a flat list, filtered by the selected family.

**Files:** `src/screens/ConsumablesScreen.tsx`

**Changes:**
- Keep the family grouping data (already computed in `grouped`)
- Add state: `const [filterFamily, setFilterFamily] = useState<ConsumableFamily | 'all'>('all');`
- Add filter chip rail below the header:
```tsx
<div className="flex gap-1.5 overflow-x-auto pb-0.5">
  <FilterChip active={filterFamily === 'all'} onClick={() => setFilterFamily('all')}>All ({totalOwned})</FilterChip>
  {FAMILY_ORDER.map((family) => {
    const count = grouped[family].reduce((s, i) => s + i.count, 0);
    if (count === 0) return null;
    const Icon = FAMILY_ICONS[family];
    return (
      <FilterChip key={family} active={filterFamily === family} onClick={() => setFilterFamily(family)}>
        <Icon size={10} />
        <span className="ml-1">{FAMILY_LABELS[family]} ({count})</span>
      </FilterChip>
    );
  })}
</div>
```
- Flatten the list: when `filterFamily` is 'all', show all items; otherwise filter by family
- Remove the accordion expand/collapse state (`expandedFamily`) entirely — all matching items visible at once
- Keep the card layout with tactical role + quality badges (from our earlier PR)

**Verification:** Filter chips appear. Clicking "Survival" shows only survival consumables. Clicking "All" shows everything. Counts update correctly.

### Task 2.2: Add search bar

**Objective:** Search consumables by name and description.

**Files:** `src/screens/ConsumablesScreen.tsx`

**Changes:**
- Add: `const [search, setSearch] = useState('');`
- Add search input below the filter chips:
```tsx
<div className="relative">
  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
  <input value={search} onChange={(e) => setSearch(e.target.value)}
    placeholder="Search consumables…"
    className="w-full h-9 pl-8 pr-8 rounded-lg border border-border bg-surface-raised text-xs text-text-primary placeholder:text-text-muted" />
  {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={14} /></button>}
</div>
```
- Filter: `items.filter(({ def }) => def.name.toLowerCase().includes(search.toLowerCase()) || def.shortDescription.toLowerCase().includes(search.toLowerCase()))`

**Verification:** Type in search, items filter in real-time. Clear button works. Combined with family filter.

### Task 2.3: Add sort dropdown

**Objective:** Sort by count (most owned first), quality (best first), or name.

**Files:** `src/screens/ConsumablesScreen.tsx`

**Changes:**
- Add: `const [sortBy, setSortBy] = useState<'count' | 'quality' | 'name'>('count');`
- Add sort select next to the search bar or in the toolbar row:
```tsx
<select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
  className="text-[9px] font-black uppercase border border-border bg-surface rounded px-1.5 py-1 text-text-primary">
  <option value="count">Most Owned</option>
  <option value="quality">Best Quality</option>
  <option value="name">Name A-Z</option>
</select>
```
- Sort logic in the filtered items:
```tsx
.sort((a, b) => {
  if (sortBy === 'count') return b.count - a.count;
  if (sortBy === 'quality') return b.bestQuality - a.bestQuality;
  return a.def.name.localeCompare(b.def.name);
})
```

**Verification:** Sort dropdown works. "Most Owned" shows highest count first. Combined with search and family filter.

---

## Phase 3: VendorScreen — Search + Filter + Sort

### Task 3.1: Add family filter chips

**Objective:** Same pattern as ConsumablesScreen — filter vendor items by family.

**Files:** `src/screens/VendorScreen.tsx`

**Changes:**
- Add state: `const [filterFamily, setFilterFamily] = useState<ConsumableFamily | 'all'>('all');`
- Add filter chip rail using `FAMILY_ICONS` and `FAMILY_LABELS` (already available in the file)
- Filter: `VENDOR_CONSUMABLES.filter((c) => filterFamily === 'all' || c.family === filterFamily)`
- Each chip shows count: `Survival (3)`

**Verification:** Filter chips filter vendor items. "All" shows everything.

### Task 3.2: Add search bar

**Objective:** Search vendor items by name and description.

**Same implementation as ConsumablesScreen Task 2.2.**

### Task 3.3: Add sort dropdown

**Objective:** Sort by price (cheapest first), owned count, or name.

**Files:** `src/screens/VendorScreen.tsx`

**Changes:**
- Add: `const [sortBy, setSortBy] = useState<'price' | 'owned' | 'name'>('price');`
- Sort: cheapest first by default (helps the user find affordable items)
- `{ key: 'price', label: 'Cheapest' }`, `{ key: 'owned', label: 'Most Owned' }`, `{ key: 'name', label: 'Name A-Z' }`

**Verification:** Sort works. "Cheapest" shows lowest price first.

---

## Phase 4: MarketScreen — Sort on listing tabs

### Task 4.1: Add sort to Buy tab

**Objective:** Sort buy listings by price, rarity, or name.

**Files:** `src/screens/MarketScreen.tsx`

**Changes:**
- Add: `const [buySort, setBuySort] = useState<'price' | 'rarity' | 'name'>('price');`
- Add sort select next to the search bar
- Sort `filteredListings` after filtering

### Task 4.2: Add sort to Sell tab

**Same pattern as Buy tab** — sort sellable items by rarity, level, combat power, or name.

### Task 4.3: Add sort to My Listings tab

**Same pattern** — sort own listings by price, rarity, name.

**Verification:** Sort dropdowns appear on each tab, sorting works independently per tab.

---

## Phase 5: WorkshopScreen — Search + Sort

### Task 5.1: Add search bar for recipes

**Objective:** Search recipes by name.

**Files:** `src/screens/WorkshopScreen.tsx`

**Changes:**
- Add: `const [search, setSearch] = useState('');`
- Add search input above the recipe list
- Filter `filteredRecipes` by name match

### Task 5.2: Add sort dropdown

**Objective:** Sort recipes by craft time, level requirement, or name.

**Files:** `src/screens/WorkshopScreen.tsx`

**Changes:**
- Add: `const [sortBy, setSortBy] = useState<'time' | 'level' | 'name'>('level');`
- Add sort select next to the search bar
- Sort `filteredRecipes` after filtering

**Sort keys:**
- `time`: shortest craft time first
- `level`: lowest level requirement first
- `name`: alphabetical

**Verification:** Search finds recipes by name. Sort by time shows fastest crafts first.

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `src/components/action/SlotGearPicker.tsx` | Per-kind sort options, Source filter row |
| `src/screens/ConsumablesScreen.tsx` | Family filter chips, search bar, sort dropdown; remove accordion |
| `src/screens/VendorScreen.tsx` | Family filter chips, search bar, sort dropdown |
| `src/screens/MarketScreen.tsx` | Sort dropdowns on Buy/Sell/MyListings tabs |
| `src/screens/WorkshopScreen.tsx` | Search bar, sort dropdown |

## Files NOT Changed

| File | Reason |
|------|--------|
| `GearHub.tsx` | Already has comprehensive filtering/sorting |
| `LeaderboardList.tsx` | Already has metric/period pickers; search is future work |
| `ActionScreenContextual.tsx` | Contextual pickers have 6-12 items each; search overkill |
| `ChestScreen.tsx` | Single-item reveal, no selection needed |
| `DashboardScreen.tsx` | Action buttons, not a selection list |

## Verification

After each phase:
1. `npm run build` — zero TS errors
2. Smoke test: filter chips toggle correctly, search filters in real-time, sort reorders items
3. Combined filters: search + family filter + sort all work together
4. Empty states: "No items match your search" when nothing found
