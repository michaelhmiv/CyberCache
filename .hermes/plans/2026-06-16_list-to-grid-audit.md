# List-to-Grid Audit & Refactor — CyberCache

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace all "mindless vertical lists" across the app with grid-based or functionally appropriate layouts, and remove noisy hashtags from the Supply/Consumables view.

**Architecture:** Each screen gets its own layout decision based on the data's nature — 2-col card grids for browsable collections (gear, recipes, consumables, vendor), ranked lists stay lists (leaderboard), and tiny data sets stay as-is. The GearHub's existing list/grid toggle serves as the UX baseline.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Framer Motion

---

## Full Audit: Every List in the Codebase

| # | Screen/Component | Current Layout | Data Shape | Verdict |
|---|---|---|---|---|
| 1 | **GearHub** (Gear tab) | `space-y-1.5` list + `grid grid-cols-2` grid toggle | Gear cards (illustration, stats, badges) | ✅ Already has grid. Keep as-is. |
| 2 | **WorkshopScreen** (Bench tab) | `space-y-2` vertical recipe list | Recipe cards (icon, name, mats, craft btn) | 🔴 Convert to grid |
| 3 | **ConsumablesScreen** (Supply/Items tab) | Accordion groups → `space-y-1.5` within each | Consumable cards (glyph, name, tags, count) | 🔴 Convert to grid, remove hashtags |
| 4 | **VendorScreen** (Market → Vendor tab) | `space-y-2` vertical list | Vendor item cards (icon, name, tags, buy btn) | 🔴 Convert to grid |
| 5 | **MarketScreen — Buy tab** | `space-y-2` vertical list | Listing cards (gear mini-card, price, buy btn) | 🟡 Convert to grid |
| 6 | **MarketScreen — Sell tab** | `space-y-2` vertical list | Tradeable item cards (gear mini-card, price input, list btn) | 🟡 Convert to grid |
| 7 | **MarketScreen — My Listings** | `space-y-2` vertical list | Active listing cards | 🟡 Convert to grid |
| 8 | **MarketScreen — History** | `space-y-2` vertical list | Transaction rows (name, price, party) | ⬜ Stay list (compact rows) |
| 9 | **LeaderboardList** | Vertical ranked rows with overflow scroll | Ranked entries (rank, name, value) | ⬜ Stay list (inherently ranked) |
| 10 | **ChestScreen — Server Odds** | 5-item vertical key-value list | Rarity odds (5 rows max) | ⬜ Too small, stay |
| 11 | **ChestScreen — Revealed items** | Modal vertical cards | 1–few gear cards | ⬜ Modal, fine |
| 12 | **ProfileScreen — Death Log** | `<ul>` vertical list | Death entries (monster, area, date) | ⬜ Small, stay list |
| 13 | **ProfileScreen — Top Areas/Weapons** | `<ul>` vertical lists | 3-item key-value pairs | ⬜ Tiny, stay |
| 14 | **ProfileScreen — Progression/Combat/Economy** | `grid grid-cols-2` | StatCards | ✅ Already grid |
| 15 | **DashboardScreen — Action Board** | Mixed 1-col + 2-col grid | Action buttons | ✅ Already functional |
| 16 | **DashboardScreen — Turf Selector** | Horizontal scroll row | Turf chips | ✅ Already functional |
| 17 | **ActionScreenContextual — Boss phases** | `space-y-2` vertical | Phase checklist (4 phases) | ⬜ Small, stays |
| 18 | **ActionScreenContextual — Crafting queues** | `space-y-2` vertical | Active bench queues | ⬜ Small, stays |

---

## Task Breakdown

### Phase 1: Workshop Bench → Grid

#### Task 1.1: Convert Workshop recipe list to 2-column grid
**Objective:** Replace the `space-y-2` vertical recipe list with a `grid grid-cols-2 gap-2` layout.

**Files:** `src/screens/WorkshopScreen.tsx:329`

**Change:** Line 329: `space-y-2` → `grid grid-cols-2 gap-2`

**Also:** Recipe cards become compact grid tiles. Each card currently shows: icon, name, level badge, quality info, clock, materials, craft button. In grid mode, keep all the same info but adjust sizing slightly — reduce icon from h-8/w-8 to h-10/w-10, tighten padding.

**Card redesign for grid:**
```tsx
// The MobileCard wrapper stays. Inside:
// - Stack vertically: glyph icon (centered) → name + level badge → materials row → craft button
// - Materials wrap to 2 lines max with truncation
// - Clock inline with materials or below
```

**Verification:** Visual check — recipes tile into 2 columns, category filter pills still work, craft button still dispatches.

#### Task 1.2: Adjust recipe card layout for compact grid tiles
**Objective:** Tighten the recipe card internals so they look good at ~half screen width.

**Files:** `src/screens/WorkshopScreen.tsx:354-383`

**Changes:**
- Center the glyph icon (remove inline flex row, stack it above the name)
- Move clock into the materials row
- Reduce font sizes slightly: name `text-[11px]`, materials `text-[9px]`
- Keep the craft button full-width at the bottom
- Ensure `MobileCard` padding works in grid context

---

### Phase 2: Consumables (Supply) → Grid + Remove Hashtags

#### Task 2.1: Remove hashtag-style tags from consumable cards
**Objective:** The user says "remove the hashtags" — these are the `layoutChannel`, quality band, and slot tags displayed as bordered pills with `#` prefix (lines 162-167 in ConsumablesScreen.tsx). Remove them entirely from the card view.

**Files:** `src/screens/ConsumablesScreen.tsx:161-167`

**Change:** Delete the `<div className="mt-0.5 flex flex-wrap gap-1">` block that renders `layoutChannel`, `bestQuality`, and `allowedSlots` as pills.

**Also in VendorScreen:** Same hashtag pills exist at lines 78-85 (`counterTags` rendered as `#{tag}`). Remove those too.

**Files:** `src/screens/VendorScreen.tsx:78-85`

#### Task 2.2: Convert consumable display from accordion+list to flat grid
**Objective:** Replace the family-grouped accordion layout with a flat grid of consumable cards, keeping a family filter rail at the top (like GearHub's kind rail).

**Files:** `src/screens/ConsumablesScreen.tsx:120-179`

**Changes:**
- Remove accordion expand/collapse logic (`expandedFamily` state)  
- Add family filter chips at top: "All | Survival | Ammo | Ordnance | Tactical | Economy | Corrupted"
- Render filtered items in `grid grid-cols-2 gap-2`
- Each card is a compact tile: glyph icon centered → name → count → "Best XX%" quality

**Card component for grid:**
```tsx
<button onClick={() => setInspecting(def)} className="...">
  <div className="flex items-center justify-center h-12">
    <span className="text-2xl">{def.visual.glyph}</span>
  </div>
  <div className="text-[10px] font-black truncate">{def.name}</div>
  <div className="text-[9px] text-amber">Best {bestQuality.toFixed(0)}%</div>
  <div className="text-sm font-black">x{count}</div>
</button>
```

**Verification:** All consumables visible at once (no accordion toggles needed), family filter works, tapping opens inspect sheet.

#### Task 2.3: Add total-owned counter to the filter rail
**Objective:** Show per-family counts in the filter chips (matching GearHub's kind rail pattern).

**Files:** `src/screens/ConsumablesScreen.tsx` (filter rail section)

**Change:** Each filter chip shows: `Survival (3)` etc., using the same grouped counts already computed.

---

### Phase 3: Vendor Screen → Grid

#### Task 3.1: Convert VendorScreen vertical list to grid
**Objective:** Same treatment as Consumables — 2-column grid for vendor items.

**Files:** `src/screens/VendorScreen.tsx:54-97`

**Changes:**
- `space-y-2` → `grid grid-cols-2 gap-2`
- Compact vendor item cards: icon centered → name → price → buy button
- Remove hashtag `counterTags` (already done in Task 2.1 if VendorScreen tags are addressed there)

**Verification:** Vendor items display in 2 columns, buy button works, "Buying…" state works.

---

### Phase 4: Market Buy/Sell/My Listings → Grid

#### Task 4.1: Convert Market Buy tab to grid
**Objective:** Market buy listings in a 2-column grid.

**Files:** `src/screens/MarketScreen.tsx:196-199`

**Changes:**
- `space-y-2` → `grid grid-cols-2 gap-2` on line 198
- Compact listing cards: gear illustration centered → name → rarity/level → price → "Buy Now" button
- Adjust GearMiniCard usage — may need a grid-specific variant or just stack the elements differently

#### Task 4.2: Convert Market Sell tab to grid
**Objective:** Sell tab items in a 2-column grid.

**Files:** `src/screens/MarketScreen.tsx:204-211`

**Changes:** Same as Buy tab — `space-y-2` → `grid grid-cols-2 gap-2`

#### Task 4.3: Convert My Listings tab to grid
**Objective:** My Listings in a 2-column grid.

**Files:** `src/screens/MarketScreen.tsx:215-218`

**Changes:** Same pattern — grid layout for listing cards with cancel button.

#### Task 4.4: Market History stays list
**Rationale:** Transaction history is inherently a chronological feed, not browsable inventory. List with compact rows is correct UX.

---

### Phase 5: Leaderboard — Keep List, Add Density Option

#### Task 5.1: Leaderboard stays a ranked list
**Objective:** No layout change needed. Leaderboards are inherently ranked top-to-bottom. This is correct UX.

**Optional enhancement (future):** Add a "compact" toggle that shows more entries per screen by reducing row height.

---

### Phase 6: Final Pass — Remove Unused Accordions

#### Task 6.1: Clean up unused state/imports
**Objective:** After removing accordion patterns, clean up unused state variables and imports.

**Files:**
- `src/screens/ConsumablesScreen.tsx` — remove `expandedFamily` state, `FAMILY_ORDER` usage changes
- `src/screens/VendorScreen.tsx` — no major state changes needed

**Verification:** TypeScript compiles without unused variable warnings.

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `src/screens/WorkshopScreen.tsx` | Recipe list → grid (lines 329, 354-383) |
| `src/screens/ConsumablesScreen.tsx` | Accordion → grid, remove hashtags, add filter rail (lines 120-179) |
| `src/screens/VendorScreen.tsx` | List → grid, remove hashtags (lines 54-97) |
| `src/screens/MarketScreen.tsx` | Buy/Sell/MyListings → grid (lines 196-218) |

## Files NOT Changed

| File | Reason |
|------|--------|
| `src/components/gear/GearHub.tsx` | Already has grid toggle — no change needed |
| `src/components/leaderboard/LeaderboardList.tsx` | Ranked list is correct UX for leaderboards |
| `src/screens/LeaderboardsScreen.tsx` | Thin wrapper, no list rendering |
| `src/screens/ChestScreen.tsx` | Tiny data sets (5 odds, 1 item reveal) |
| `src/screens/DashboardScreen.tsx` | Already functional mixed layouts |
| `src/screens/ProfileScreen.tsx` | Stats already grids, death log small |
| `src/screens/ActionScreenContextual.tsx` | Boss phases/craft queues are small procedural lists |
| `src/screens/SyncedLoadoutScreen.tsx` | Loadout slot grid (not a list at all) |

---

## Risks & Tradeoffs

- **Grid scrolling:** 2-column grids on mobile are standard; more items visible per scroll. No performance concern with current item counts (<200).
- **Card height consistency:** Recipe cards vary in height (different material counts). CSS grid auto-rows may leave gaps. Solution: `grid-auto-rows: auto` or use a masonry approach if needed. For now, auto-rows is fine — taller cards just take more vertical space in their row.
- **Market grid with GearIllustration:** The `GearIllustration` component uses SVG; won't break in grid but may need size adjustment for compact tiles.
- **Consumable family grouping lost:** Currently accordion groups items by family. Grid with filter rail is a better pattern (matches GearHub). Users who want to see all items at once get that by default with All selected.

## Testing / Verification

After each phase:
1. `cd /data/cybercache && npm run build` — no TS errors
2. Visual smoke test on mobile viewport (375px width)
3. Verify all interactive elements still work (craft, buy, equip, inspect, claim)
4. Verify filter chips correctly filter content
5. Verify empty states still render correctly
