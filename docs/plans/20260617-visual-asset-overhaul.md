# Visual Asset Overhaul — Phased Plan

> **Goal:** Eliminate every generic `lucide-react` placeholder icon used for game entities, screens, and navigation. Replace with the existing procedural visual system (`visualAssets.ts`, `ResourceIcon`, `MaterialBadge`, gear illustrations) and extend that system to cover bosses, areas, skill trees, activities, and branding.
>
> **Investigation date:** 2026-06-17
> **Status:** Planning — awaiting kickoff

---

## Executive Summary

The codebase has a **robust procedural visual registry** (`src/constants/visualAssets.ts`, 304 lines) with dedicated SVG renderers (`ResourceIcon`, `MaterialBadge`, `VisualBadge`, `GearIllustration`). However, **42 source files** import from `lucide-react` and most use generic outline icons (Coins, Wrench, Skull, Package, Shield, Zap, etc.) where game-specific visuals should appear.

The fix is phased from **pure wiring** (use what exists — no new code) through **registry buildout** (new visual data + renderers) to **generated art** (commissions/GAI for hero pieces).

---

## Phase 1 — Pure Wiring Wins (No New Code)

> **Dependency:** None. Each item is an independent PR.
> **Scope:** Swap lucide imports for existing visual systems in components that already have the data.

### 1.1 OfflineRecap ("While You Were Away")

**File:** `src/components/activity/OfflineRecap.tsx`
**Current:** `Coins, Wrench, Zap, Key, Gem, Package` from lucide. Materials and essences both use `Gem` — visually identical.
**Target:**
- Credits → `ResourceIcon id="credits"`
- Scrap → `ResourceIcon id="scrap"`
- XP → `ResourceIcon id="xp"`
- Cache Fragments → `ResourceIcon id="cacheFragment"`
- Materials → `MaterialBadge` (already exists, never used anywhere)
- Essences → `MaterialBadge` with essence visual (already falls through via `getMaterialVisual`)
- Gear Drops → `GearIcon` or `ResourceIcon id="loot"`

### 1.2 DeathOverlay

**File:** `src/components/action/DeathOverlay.tsx`
**Current:** `Skull, Clock, Coins, Ticket` from lucide.
**Target:**
- Skull header → keep (UI affordance, not a game entity) OR replace with game skull sigil if created later
- Credits cost → `ResourceIcon id="credits"`
- Revive Token → `getConsumableVisual('ReviveToken')` glyph/mark
- Clock timer → keep (UI affordance)

### 1.3 ActiveBuffPills — Use Consumable Glyphs

**File:** `src/components/stats/ActiveBuffPills.tsx`
**Current:** `Shield, Zap, Crosshair, PackageOpen` chosen by `iconForMechanicKind()` — generic per-mechanic lucide icons.
**Target:** Use `CONSUMABLES[buff.consumableId].visual.glyph` (already imported `CONSUMABLES`, already reads `def.visual.accent` — just not using `def.visual.glyph` for the icon itself).

### 1.4 ConsumableInspectSheet — Family Icons

**File:** `src/components/consumables/ConsumableInspectSheet.tsx`
**Current:** `FAMILY_ICONS` maps to lucide (`Shield, Crosshair, PackagePlus, Radio, Star, AlertTriangle`).
**Target:** Either derive from `consumable.visual` (glyph + accent already there) or create a `ConsumableFamilyVisual` registry. The glyph is already shown in the 14×14 box; the family icon is redundant — consider removing it or making it a colored family sigil.

### 1.5 VendorScreen — Family Icons

**File:** `src/screens/VendorScreen.tsx`
**Current:** Same `FAMILY_ICONS` lucide map duplicated from ConsumableInspectSheet.
**Target:** Single shared `ConsumableFamilyVisual` registry, consumed by both.

### 1.6 AuthScreen + ProfileScreen — Brand Logo

**Files:** `src/screens/AuthScreen.tsx`, `src/screens/ProfileScreen.tsx`
**Current:** No logo anywhere. AuthScreen is the first thing users see — pure text + lucide icons.
**Target:** Import `cybercache-logo.png` (already in `src/assets/`) as a header image on AuthScreen. Add a smaller version to ProfileScreen header.

### 1.7 Dead File Cleanup

**Files:** `src/assets/hero.png`, `src/assets/branding/cybercache-logo.png`
**Current:** 2.2MB each, never imported by any source file. Duplicates of `public/cybercache-logo.png`.
**Target:** Delete both. The canonical copy lives in `public/`.

---

## Phase 2 — Consumable Visual System Consolidation

> **Dependency:** None (can run parallel to Phase 1).
> **Scope:** Merge the two parallel consumable visual systems into one.

### Problem

Two systems define consumable visuals:
1. **`visualAssets.ts`** → `getConsumableVisual()` returns `VisualAsset` with `mark` (single letter like `+`, `G`, `A`)
2. **`consumables.ts`** → `ConsumableVisual` with `glyph` (unicode like `✚`, `⬡`, `✦`, `⚡`), `accent` (color name), `silhouette` (shape name), `frame` (style name)

Components pick one, the other, or neither. Same consumable shows as `+` in one place, `✚` in another, lucide `Shield` in a third.

### Plan

- **Pick `consumables.ts` `ConsumableVisual` as canonical** — it's richer (glyph + accent + silhouette + frame).
- **Deprecate `BASIC_CONSUMABLE_VISUALS` in `visualAssets.ts`** — make `getConsumableVisual()` delegate to `CONSUMABLES[id].visual`.
- **Update `getVisualAsset()` switch** to route consumable lookups through the canonical system.
- **Audit all consumers** and ensure they use the unified path.

---

## Phase 3 — Missing Registry + Component Buildout

> **Dependency:** None (foundational work, Phase 4 depends on it).
> **Scope:** Build the visual data and renderers that don't exist yet.

### 3.1 Boss Visual System

**Problem:** `BossDef` (in `src/types/boss.ts`) has no visual field. All bosses render as generic `Skull`.

**Plan:**
- Add `visual: BossVisual` field to `BossDef` interface:
  ```ts
  interface BossVisual {
    sigil: string;       // glyph/mark for the boss (e.g., 'DTD' for Dune Tyrant)
    color: string;       // primary color
    accentColor: string; // secondary
    portrait?: string;   // optional path to generated portrait image
  }
  ```
- Add `visual` to every boss in `src/constants/bosses.ts` (REGION_1_BOSSES + any others)
- Create `src/components/common/BossSigil.tsx` — procedural SVG renderer (derives shape from element + tier + tags)
- Wire into `BossSelectModal.tsx` and `BossPrepModal.tsx`

### 3.2 Area Sigil System

**Problem:** `RoamingAreaDef` has no visual identifier. Area cards distinguished by text only.

**Plan:**
- Add `sigil` / `visual` field to `RoamingAreaDef` in `src/constants/roamingAreas.ts`
- Derive from existing `manufacturerInfluence` + `elementBias` + `weaponBias` (data already there)
- Create `src/components/common/AreaSigil.tsx`
- Wire into DashboardScreen area cards + ActionScreenContextual area selector

### 3.3 Skill Tree Sigils

**Problem:** Gunslinger/Demolition/Scavenger have colors but no sigils.

**Plan:**
- Add `sigil` glyph to the `TREES` array in `SkillTreeScreen.tsx` (or better, a `src/constants/skillTreeVisuals.ts`)
- Create procedural sigil or use distinct unicode/glyph per tree
- Wire into SkillTreeScreen tab headers + DashboardScreen skill summary

### 3.4 Activity-Kind Visual Registry

**Problem:** `ActivityModifierPanel.tsx` hardcodes lucide icons per `ActivityKind`. No central registry.

**Plan:**
- Create `src/constants/activityVisuals.ts`:
  ```ts
  export const ACTIVITY_VISUALS: Record<ActivityKind, ActivityVisual> = {
    crafting:     { glyph: '⚒', color: '#FF9000', label: 'Crafting' },
    salvaging:    { glyph: '♻', color: '#7CFC00', label: 'Salvaging' },
    market_listing: { glyph: '$', color: '#F7D20B', label: 'Market' },
    workshop_service: { glyph: '⚙', color: '#3B82F6', label: 'Workshop' },
    roaming_loot: { glyph: '📡', color: '#A855F7', label: 'Roaming' },
    idle_standby: { glyph: '⏸', color: '#B8B0A8', label: 'Idle' },
  };
  ```
- Wire into `ActivityModifierPanel.tsx`, `ActionScreenContextual.tsx`, `WorldPulseFeed.tsx`

### 3.5 BottomNav Tab Sigils

**Problem:** 6 primary tabs use `Backpack, Gauge, PlayCircle, ShoppingCart, Trophy, User` — generic.

**Plan:**
- Design 6 game-themed tab sigils (procedural SVG or distinct glyphs)
- Options: derive from existing visual systems (e.g., Board → area sigil, Action → activity icon, Gear → gear slot visual, Market → resource visual, Rank → trophy sigil, Hunter → player sigil)
- Create `src/components/layout/NavSigil.tsx`
- Wire into `BottomNav.tsx`

### 3.6 ConsumableFamily Visual Registry

**Problem:** `FAMILY_ICONS` duplicated across `ConsumableInspectSheet.tsx` and `VendorScreen.tsx`, both using lucide.

**Plan:**
- Create `src/constants/consumableFamilyVisuals.ts` with per-family glyph + color + silhouette
- Replace both duplicated `FAMILY_ICONS` maps

---

## Phase 4 — Full Screen Rewiring

> **Dependency:** Phase 3 registries must exist.
> **Scope:** Systematically replace every remaining lucide game-entity icon across all screens.

### 4.1 Fight Screens

| File | Lucide icons to replace | Replacement |
|---|---|---|
| `BossSelectModal.tsx` | `Skull, Shield, Zap, Crosshair, CheckCircle, Lock, X` | Boss sigils, element visuals, phase visuals |
| `BossPrepModal.tsx` | `Activity, AlertTriangle, CheckCircle, Gauge, Heart, PackageCheck, Shield, Skull, Sparkles, Swords, Target, X, Zap` | Phase status visuals, boss sigil, stat visuals |

### 4.2 Dashboard + Action

| File | Lucide icons to replace | Replacement |
|---|---|---|
| `DashboardScreen.tsx` | `Activity, Backpack, BarChart3, Box, ChevronDown, ChevronRight, Crosshair, Hammer, Lock, Map, PackageSearch, Sparkles, Trophy` | Area sigils, activity visuals, gear visuals |
| `ActionScreenContextual.tsx` | `Activity, Clock, Crosshair, Hammer, Package, Radar, Recycle, ShoppingCart, Skull, Target, Wrench, X` | Activity visuals, resource icons |

### 4.3 Profile + Stats

| File | Lucide icons to replace | Replacement |
|---|---|---|
| `ProfileScreen.tsx` | `Activity, Award, HelpCircle, LogOut, Settings, ShieldCheck, Skull, Sword, Target, User, Zap` | Stat category sigils, action row icons |
| `StatCard.tsx` | `Lock` | (may keep as UI affordance) |
| `StatDetailPanel.tsx` | `TrendingUp, TrendingDown, Minus, Trophy` | (may keep as data viz affordances) |
| `CharacterStatBar.tsx` | `ChevronDown, Crosshair, HeartPulse, Radar, RefreshCw, Shield, Sparkles, X` | Stat category visuals |
| `MetricCard.tsx` | `ChevronDown` | (UI affordance — keep) |
| `ConsumableLedger.tsx` | `PackageOpen, TimerReset` | Consumable visuals |
| `ProgressionHistoryCard.tsx` | `TrendingUp` | (data viz — keep) |

### 4.4 Inventory + Market

| File | Lucide icons to replace | Replacement |
|---|---|---|
| `InventoryScreen.tsx` | `Backpack, Box, Hammer, Pill, Shield` | Tab sigils |
| `ChestScreen.tsx` | `Box, Sparkles, Info, Lock, Unlock, Scissors, Sword` | Gear visuals, chest visual |
| `MarketScreen.tsx` | `Filter, History, List, RefreshCw, Search, ShoppingCart, Store, Tag, X` | Market sigil, resource visuals |
| `WorkshopScreen.tsx` | `Activity, Clock, ChevronDown, Search, X` | Activity visuals |
| `ConsumablesScreen.tsx` | `AlertTriangle, Crosshair, PackagePlus, Radio, Search, Shield, Star, Store, X` | Family visuals |
| `GearHub.tsx` | (check imports) | Gear slot visuals |
| `GearInspectSheet.tsx` | `Lock, PackageSearch, Scroll, ShoppingCart, Sparkles, Sword, X, Zap` | Gear visuals, resource icons |
| `SlotGearPicker.tsx` | `ChevronDown, Search, ArrowUpDown, X` | (UI affordances — keep) |

### 4.5 Help + Settings

| File | Lucide icons to replace | Replacement |
|---|---|---|
| `HelpScreen.tsx` | `ArrowRight, Box, ChevronDown, ChevronUp, Compass, Database, Gauge, PlayCircle, Search, Shield, Sparkles, Star, Sword, TrendingUp, User, X, Zap` | Section sigils (8 sections need game-themed icons) |
| `SettingsScreen.tsx` | `Clock, Zap, AlertTriangle, Info, Settings, ExternalLink` | (mostly UI affordances — keep most) |

### 4.6 Misc Components

| File | Lucide icons to replace | Replacement |
|---|---|---|
| `WorldPulseFeed.tsx` | `Activity, Crosshair, Hammer, PackageSearch, Radio, Trophy` | Activity visuals, family visuals |
| `ActionLoadout.tsx` | `ChevronDown, ChevronUp, Crosshair, Shield, Zap, Diamond, Gem` | Gear slot visuals, resource icons |
| `ActionWorkspace.tsx` | `ChevronDown, PackageSearch, Sparkles` | Activity visuals |
| `PresetSwitcher.tsx` | `Bookmark, Plus, Trash2, Pencil` | (UI affordances — keep) |
| `SalvageToast.tsx` | `Recycle` | Activity visual for salvaging |
| `ResourceBar.tsx` | `Loader2, Plus, Play, X` | (UI affordances — keep) |
| `LeaderboardList.tsx` / `LeaderboardRow.tsx` | `Trophy, TrendingUp, TrendingDown, Minus` | (data viz — keep or add rank sigils) |
| `PublicProfilePanel.tsx` | `User` | Player sigil |
| `LiveTurfDiorama.tsx` | `Box, ChevronDown, Crosshair, Sparkles` | Already mostly procedural — audit remaining |

### 4.7 Leadership / Ranking

| File | Notes |
|---|---|
| `LeaderboardsScreen.tsx` | `Trophy` — may become a rank sigil |
| `LeaderboardRow.tsx` | Trend arrows — data viz, keep |

---

## Phase 5 — Generated / Commissioned Art

> **Dependency:** Phases 1-4 should be done first so we know exactly what procedural SVG can't cover.
> **Scope:** Commission or GAI-generate images for hero pieces that need more than vector shapes.

### Candidates

| Asset | Why procedural won't work | Dimensions | Priority |
|---|---|---|---|
| **Boss portraits** | Sigils work for selection lists, but boss fight modals deserve full art | 256×256 or 512×512 | High — bosses are the climax |
| **AuthScreen hero banner** | First impression — logo alone may not fill the space | Full-width, ~400px tall | High |
| **Skill tree keystone illustrations** | Keystones are build-defining — deserve unique art | 64×64 each | Medium |
| **HelpScreen section headers** | 8 sections — could use small illustration per section | 32×32 each | Low |
| **Data Cache / chest opening art** | ChestScreen has no chest visual — just `Box` lucide | 128×128 | Medium |
| **Area background textures** | Area cards could use subtle background art per biome | Tileable, 256×256 | Low |

### Approach

- Use `image_generate` for rapid prototyping of each piece
- Review with Michael before committing to `public/`
- Reference the existing `cybercache-logo.png` art style (industrial sci-fi, cel-shaded, heavy outlines, weathered textures, orange/cyan/gray palette)
- Store generated art in `public/art/` with clear naming

---

## Phase 6 — Polish + Audit

> **Dependency:** All previous phases.
> **Scope:** Final sweep to ensure consistency.

- [ ] Audit every `lucide-react` import — classify each as "game entity (must replace)" vs "UI affordance (keep)"
- [ ] Verify no screen shows a generic icon for a game entity
- [ ] Verify `MaterialBadge` is actually used (currently defined, never used)
- [ ] Verify `ResourceIcon` is used beyond just `ResourceBar`
- [ ] Run the app and screenshot every screen — visual QA pass
- [ ] Update `QA-CHECKLIST.md` with a visual consistency section
- [ ] Ensure dark theme contrast for all new visuals
- [ ] Ensure mobile (< 24px) legibility for all sigils/glyphs

---

## UI Affordance vs. Game Entity — Decision Rule

Not every lucide icon needs replacing. The rule:

| Category | Examples | Action |
|---|---|---|
| **Game entity** — represents an in-game thing (resource, item, boss, activity, area, skill) | Credits, Scrap, Med Kit, Dune Tyrant, Crafting, Badlands, Gunslinger | **Must replace** with game visual |
| **UI affordance** — represents an interface action (close, search, filter, expand, scroll) | X (close), Search, ChevronDown, Filter, Plus, Trash2, RefreshCw | **Keep** as lucide |
| **Data viz** — represents a data trend or status | TrendingUp, TrendingDown, Minus, Lock, CheckCircle | **Keep** as lucide (or replace if game-themed alternative improves clarity) |

---

## PR Strategy

- One PR per phase item (e.g., `1.1-offline-recap-visuals`, `3.1-boss-sigil-system`)
- Each PR is independently mergeable
- Phase 1 PRs can go immediately — no dependencies
- Phase 3 PRs should land before Phase 4 PRs that depend on them
- Phase 5 generated art PRs can land anytime after the corresponding Phase 3/4 wiring is in place (the `portrait?` field is optional)
