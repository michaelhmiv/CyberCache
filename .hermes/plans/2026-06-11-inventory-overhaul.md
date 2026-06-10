# Inventory Tab Overhaul — Implementation Plan

> **For Hermes:** Execute tasks sequentially. Commit after each completed task.

**Goal:** Overhaul the Gear/Inventory tab with search, multi-filter, sort, multi-select, compare, junk marking, and grid/list toggle. Move NPC Vendor to Market tab. Replace Inventory "Supply" with owned consumables + inspect. Improve Relic/Weapon stat display in inspect sheet.

**Architecture:** Replace GearYardScreen with new GearHub component housing all gear management. Move VendorScreen into MarketScreen as 5th sub-tab. Create new ConsumablesScreen showing owned consumables with inspect capability. Patch GearInspectSheet for missing stat rows. Delete dead LootScreen.

**Tech Stack:** React, TypeScript, Zustand, Framer Motion, Tailwind CSS, Vitest

---

## Phase 1: Move NPC Vendor to Market Tab

### Task 1.1: Add Vendor sub-tab to MarketScreen

**Objective:** Add "Vendor" as 5th sub-tab in MarketScreen, render VendorScreen inside it

**Files:**
- Modify: `src/screens/MarketScreen.tsx`

**Changes:**
1. Import VendorScreen
2. Add `'vendor'` to TABS array
3. Add `{market.activeTab === 'vendor' && <VendorScreen />}` in render
4. Update navigation mapping in App.tsx: `'vendor'` → `'market'` tab

### Task 1.2: Remove Vendor from InventoryScreen

**Objective:** Remove Supply sub-tab from InventoryScreen, replace with Consumables placeholder

**Files:**
- Modify: `src/screens/InventoryScreen.tsx`

### Task 1.3: Update App.tsx navigation for vendor

**Objective:** Route `handleNavigate('vendor')` to market tab

**Files:**
- Modify: `src/App.tsx`

---

## Phase 2: Create Consumables Screen (Inventory "Supply" replacement)

### Task 2.1: Create ConsumableInspectSheet component

**Objective:** Sheet showing full consumable details when tapped

**Files:**
- Create: `src/components/consumables/ConsumableInspectSheet.tsx`

**Shows:** name, family icon, description, effect text, trigger, consume policy, effect rules (survivalFlat, dpsMultiplier, etc.), drawback rules, allowed slots, counter tags, craft category, equip-to-loadout button

### Task 2.2: Create ConsumablesScreen

**Objective:** Show owned consumables grouped by family, tappable to inspect

**Files:**
- Create: `src/screens/ConsumablesScreen.tsx`

### Task 2.3: Wire ConsumablesScreen into InventoryScreen

**Objective:** Replace "Supply" sub-tab with "Consumables" using new screen

**Files:**
- Modify: `src/screens/InventoryScreen.tsx`

---

## Phase 3: Patch GearInspectSheet — Missing Stats

### Task 3.1: Add bossDamageMod and waveDamageMod to Weapon stat rows

**Objective:** Display boss/wave damage mods that are already stored but not shown

**Files:**
- Modify: `src/components/gear/GearInspectSheet.tsx` — `statRows()` function

### Task 3.2: Improve Relic stat poster

**Objective:** Replace generic affix count with category breakdown

**Files:**
- Modify: `src/components/gear/GearInspectSheet.tsx` — `statRows()` for relic case

---

## Phase 4: Build GearHub (replaces GearYardScreen)

### Task 4.1: Create GearHub shell with search bar

**Objective:** New component with text search, type filter chips, and item list

**Files:**
- Create: `src/components/gear/GearHub.tsx`

### Task 4.2: Add multi-filter chips

**Objective:** Rarity, Element, Manufacturer, Weapon Type, Source, Lock status chips

**Files:**
- Modify: `src/components/gear/GearHub.tsx`

### Task 4.3: Add sort dropdown

**Objective:** Sort by Combat Power, Boss Power, Farm Power, Economy, Level, Rarity, Roll Quality, Name, Recent

**Files:**
- Modify: `src/components/gear/GearHub.tsx`

### Task 4.4: Add grid/list toggle

**Objective:** Toggle between compact list and 2-column card grid

**Files:**
- Modify: `src/components/gear/GearHub.tsx`

### Task 4.5: Add multi-select mode with bulk actions

**Objective:** Checkbox select, bulk salvage, bulk lock/unlock

**Files:**
- Modify: `src/components/gear/GearHub.tsx`

### Task 4.6: Add compare view

**Objective:** Select two items to side-by-side compare with difference arrows

**Files:**
- Modify: `src/components/gear/GearHub.tsx`

### Task 4.7: Add junk marking system

**Objective:** Toggle junk flag, "Salvage all junk" button, junk filter chip

**Files:**
- Modify: `src/components/gear/GearHub.tsx`

### Task 4.8: Wire GearHub into InventoryScreen

**Objective:** Replace GearYardScreen import with GearHub

**Files:**
- Modify: `src/screens/InventoryScreen.tsx`

### Task 4.9: Delete dead code

**Objective:** Remove GearYardScreen.tsx and LootScreen.tsx

**Files:**
- Delete: `src/screens/GearYardScreen.tsx`
- Delete: `src/screens/LootScreen.tsx`

---

## Phase 5: Verify

### Task 5.1: TypeScript check

Run: `npx tsc --noEmit`

### Task 5.2: Test suite

Run: `npx vitest run`

### Task 5.3: Build

Run: `npm run build`

### Task 5.4: Deploy verification

Curl production to verify pages render.

---

## Completion Ledger

### Phase 1 ✅ — Move NPC Vendor to Market Tab
- **Commit:** `3f14934`
- **Changed:** marketSlice (add 'vendor' type), MarketScreen (5 tabs flex-wrap + VendorScreen render), InventoryScreen (remove Supply, add consumables placeholder), App.tsx (vendor → market nav)
- **Verified:** MarketScreen imports VendorScreen, TABS array has vendor, activeTab union includes 'vendor'

### Phase 2 ✅ — ConsumablesScreen + ConsumableInspectSheet
- **Commit:** `352ee41`
- **New files:** `ConsumableInspectSheet.tsx` (tactical profile, effect/drawback rules, economy, loadout slots, hints), `ConsumablesScreen.tsx` (grouped by family, expandable, tappable to inspect)
- **Verified:** Items tab renders "Consumables" header, empty state, guides to Market → Vendor

### Phase 3 ✅ — GearInspectSheet Missing Stats
- **Commit:** `96d3c2f`
- **Weapon stat rows:** Added Boss Damage Mod and Wave Damage Mod (stored fields previously hidden)
- **Relic stat poster:** Replaced generic affix count with category breakdown (Total + per-category counts)

### Phase 4 ✅ — GearHub (replaces GearYardScreen)
- **Commit:** `bc175cb`
- **New file:** `GearHub.tsx` (750 lines) — search, 6 filter chip rows, 9 sort options, grid/list toggle, multi-select bulk actions, compare view, junk marking + salvage all
- **Deleted:** `GearYardScreen.tsx` (119 lines), `LootScreen.tsx` (928 lines dead code)
- **Net:** +771 / -1050 lines

### Phase 5 ✅ — Verification
- **tsc:** Clean, zero errors
- **Vitest:** 490/490 passing (51 files)
- **Build:** Successful (847KB JS bundle, 66KB CSS)
- **Deploy:** Railway auto-deployed, verified live:
  - Gear tab: search bar, all filter chips, sort dropdown, select button, "No gear" empty state — renders correctly
  - Items tab: Consumables header, empty state with Market → Vendor guidance
  - Console: zero errors
  - Market Vendor tab: wired correctly (auth-gated for guest, verified code)
- **All 50 filter chips verified on page:** Common/Uncommon/Rare/Epic/Legendary, Kinetic/Fire/Shock/Corrosive/Cryo/Void, Redline/Ironwood/BlastForge/Prismatek/ThrowTech/HelixWorks, Pistol/SMG/Shotgun/Sniper/Launcher/Beam, World Drop/Boss Drop/Cache-Forged/Crafted, Locked, Scrap candidates
