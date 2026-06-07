# CyberCache

**Mobile-first idle roguelite looter RPG.** Roam areas for loot, build your loadout, fight bosses with deep simulation mechanics, and trade on the marketplace.

> See [AGENTS.md](./AGENTS.md) for agent operating instructions and [MECHANICS.md](./MECHANICS.md) for canonical game mechanics.

## Gameplay

- **Roaming Combat** - Passive loot and XP generation. Earn offline rewards.
- **Deep Weapon System** - 6 weapon types x 6 manufacturers x 6 elements x 5 rarities. Modular parts, procedural affixes, 25 legendary effects.
- **7 Gear Slots** - Primary, Secondary, Heavy, Ordnance, Shield, Class Mod, Relic.
- **Boss Combat** - 4-phase simulation (Survival -> Break -> DPS -> Mechanics). Risk settings, elemental matchups, consumable planning, win chance estimation.
- **Skill Trees** - Gunslinger (weapon tree), Demolition (explosives), Scavenger (idle/economy). 50 points to spend across 3 trees.
- **Economy** - Credits, Scrap, Cache Keys, Cache Key Fragments. Vendor, Marketplace (simulated NPCs), Fusion Lab, Data Caches.
- **Persistent Progress** - Everything saves to localStorage.

## Tech Stack

- **React 19** + **TypeScript 6**
- **Vite 8** (dev/build)
- **Tailwind CSS 4** (dark cyberpunk theme)
- **Zustand 5** (state management with persistence)
- **Framer Motion 12** (animations)
- **idb** (IndexedDB ready)
- **Lucide React** (icons)

## Quick Start

`ash
npm install
npm run dev
`

## Validation

`ash
npm run mechanics:validate   # Data integrity guardrail
npm run mechanics:report     # Boss balance sanity report
`

## Mobile-First

Designed for 480px mobile viewport with bottom tab navigation:
- **Fight** - Roam areas, boss prep, recent field finds
- **Loadout** - Equip 7 gear slots
- **Loot** - Inventory with filters, scrap, lock
- **Market** - Buy/sell weapons
- **More** - Data Cache, Skill Trees, Fusion Lab, Vendor, Workshop, Profile, Settings, Guide

## Build

`ash
npm run build    # production build
npm run preview  # preview production build
`

## Project Structure

`
src/
  components/       # Reusable UI (WeaponCard, BossPrepModal, BottomNav, etc.)
    common/         # RollQualityBadge, RarityGlow
    fight/          # BossPrepModal, BossSelectModal
    layout/         # ScreenWrapper, MobileCard, BottomNav
    pixelArt/       # WeaponCanvas renderer
  constants/        # Game data (bosses, rarities, weapons, skills, etc.)
  hooks/            # useIdleTicker, useOfflineClaim
  lib/
    generators/     # Procedural item generators (weapons, shields, etc.)
    pixelArt/       # Canvas sprite renderer with animations
    simulation/     # Boss combat simulation engine
    utils/          # Seeded RNG, naming, IDs
  screens/          # Full-screen views (Fight, Loadout, Loot, Market, More + sub-screens)
  store/slices/     # Zustand stores (player, inventory, loadout, boss, skills, market, idle, workshop)
  types/            # TypeScript interfaces and enums
scripts/
  validate-mechanics.ts      # Data integrity validation
  mechanics-balance-report.ts  # Boss balance sanity report
`

## Features

- **Procedural weapon generation** with 6 weapon types, 6 manufacturers, 6 elements, 5 rarities, 6 modular parts, affixes from 3 pools, and 25 legendary effects
- **7 bosses** (Region 1) with unique mechanics (enrage, shield regen, burning ground, phase-out, armor repair, three-phase siege)
- **Cache opening** with guaranteed Rare+ drops and rarity odds display
- **Fusion Lab** - improve weapon roll quality by consuming 2+ similar weapons
- **Offline earnings** with configurable cap (2-12 hours)
- **Auto-salvage** - auto-scrap low-quality drops
- **Level-up notifications**
- **Skill tree bonuses** feed directly into boss simulations