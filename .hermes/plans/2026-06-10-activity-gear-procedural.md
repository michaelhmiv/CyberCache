# Phase 3: Procedural Activity Gear — Drawing Board

**Goal**: Bring every gear slot (weapon, shield, ordnance, relic, classMod) into
strategic relevance for ALL activities — crafting, salvaging, workshop, market,
roaming — with Borderlands-level procedural depth. No flat +5% stat stickers.

**Anti-pattern rejected**: A static catalog of 37 named affixes with fixed min/max
ranges. That gives 37 options. Borderlands gives billions.

---

## 1. Core Architecture

### 1.1 Activity Modules → Procedural Affixes

Every piece of gear can roll zero or more **Activity Modules**. A module is an
`Affix` with `category: 'activity'` that carries a `subStats` map. The module is
generated procedurally from the item's own context — level, rarity, manufacturer,
and RNG seed.

```
Item generation context:
  level=42, rarity=Epic, manufacturer=Redline, pixelSeed=0xDEADBEEF

→ Activity Module: "Redline Overclock Module"
  stat: 'craftingModule'
  value: 0.82          ← quality roll (0–1), visible as a percentage bar
  subStats:
    craftingSpeed:       0.22   ← base 12% × level scalar × rarity × mfg × quality
    materialEfficiency:  0.08   ← Redline bonus dimension
    burstCraftChance:    0.12   ← Epic-tier unlock (chance to craft 2x instantly)
  displayText: "Crafting [82%] +22% Speed · +8% Eff · 12% Burst"
```

Billions come from: 6 manufacturers × 5 rarities × 50 levels × 100 quality
ticks × (slot count) × (module type per activity) × (sub-stat roll ranges).

### 1.2 Affix Interface Extension

```ts
// src/types/items.ts — add to existing Affix interface
export interface Affix {
  id: string;
  category: 'combat' | 'elemental' | 'boss' | 'idle' | 'skill' | 'activity';  // +'activity'
  stat: keyof WeaponStats | string;
  value: number;
  subStats?: Record<string, number>;  // NEW — multi-dimensional activity outputs
  displayText: string;
}
```

`subStats` is optional. Combat affixes don't use it. Activity affixes encode all
their dimensional outputs there. The `value` field for activity affixes holds the
quality roll (0–1 scale), used as the "progress bar" in UI.

### 1.3 Activity Modifier Aggregation

`src/lib/stats/activityModifiers.ts` — `sumActivityModifier(gear, activity)`:
- Walks all equipped gear's `affixes[]`
- For affixes with `category === 'activity'`, iterates `subStats`
- Maps sub-stat keys to the ActivityModifiers record
- Also reads legacy single-stat affixes that map to activities (backward compat)
- Returns a flat `ActivityModifiers` object

Same function is imported by Chef for server-side verification.

---

## 2. Manufacturer Activity Identity

Each manufacturer's combat identity carries over to activity gear. When an
activity module rolls on an item, the manufacturer determines bonus dimensions
and behavioral quirks.

| Manufacturer | Combat Identity | Activity Identity | Bonus Dimensions |
|---|---|---|---|
| **Redline** | Ramping speed/sustained DPS | Speed burst, momentum | `burstChance`, speed ramps per consecutive action |
| **Ironwood** | Precision, crits, boss kill | Quality, exceptional outputs | `critCraftChance`, `precisionExtraction`, premium market pricing |
| **BlastForge** | Explosions, splash, armor | Volume, destruction, mass output | `massProductionChance`, `explosiveSalvage`, overclock bursts |
| **Prismatek** | Elemental, status effects | Elemental infusion into activities | `elementalCraftBonus` (scales w/ element), `essenceExtraction`, affinity pricing |
| **ThrowTech** | Deployables, wave damage | Automation, drones, passive output | `droneAssistSpeed`, `autoCollectChance`, deployable workshop boost |
| **HelixWorks** | Modular, flexible, better stats | Better variance, extra minor bonuses | Higher quality floor (+10), chance for extra minor sub-stat |

These manifest as:
1. **Bonus sub-stats** — e.g., Redline modules always add `burstCraftChance` that
   non-Redline modules don't get (or get at much lower values).
2. **Multiplier biases** — e.g., Ironwood modules have +25% to precision-related
   sub-stat values but -10% to speed sub-stats.
3. **Unique legendary behaviors** — e.g., a Legendary ThrowTech crafting module
   gets "Auto-Crafter Drone: passively crafts 1 item per 5 minutes."

---

## 3. Module Generator System

### 3.1 Generator Function Signature

```ts
// src/lib/generators/activityModuleGenerator.ts

export interface ActivityModuleContext {
  itemLevel: number;
  itemRarity: Rarity;
  manufacturer: Manufacturer;
  slot: 'weapon' | 'shield' | 'ordnance' | 'relic' | 'classMod';
  /** The activity this module targets (e.g., 'crafting', 'salvaging'). */
  activityKind: ActivityKind;
  rng: () => number;  // seeded PRNG from item context
}

export function generateActivityModule(ctx: ActivityModuleContext): Affix
```

### 3.2 Activity-Specific Module Types

Each activity has its own module type with its own sub-stat dimensions:

**Crafting Module** (`crafting`):
```
subStats:
  craftingSpeed        — time reduction (primary)
  materialEfficiency   — reduced material cost
  critCraftChance      — chance for higher-quality output
  burstCraftChance     — chance for instant double-craft (Redline/BlastForge bonus)
  elementalCraftBonus  — bonus when crafting matching-element items (Prismatek)
  droneAssistSpeed     — passive auto-craft speed (ThrowTech)
```

**Salvage Module** (`salvaging`):
```
subStats:
  salvageYield         — output multiplier (primary)
  rareMaterialChance   — chance for rare material drops
  essenceExtraction    — bonus essence yield (Prismatek)
  explosiveSalvage     — chance for burst material output (BlastForge)
  precisionExtraction  — chance to preserve a part/affix (Ironwood)
  autoCollectChance    — passive salvage collection from kills (ThrowTech)
```

**Market Module** (`market_listing`):
```
subStats:
  marketFeeReduction   — listing fee reduction (primary)
  marketSaleBonus      — sale price bonus
  listingDurationBonus — listings stay up longer before expiry
  premiumPricingChance — chance for significantly higher sale price (Ironwood)
  affinityPricing      — elemental-matching items sell for more (Prismatek)
  bulkListingSlots     — extra concurrent listings (BlastForge)
```

**Workshop Module** (`workshop_service`):
```
subStats:
  workshopSpeed        — queue time reduction (primary)
  parallelQueueSlots   — extra parallel workshop queues
  overclockChance      — chance for instant completion burst (BlastForge)
  droneAssistSpeed     — passive drone that speeds queues (ThrowTech)
  failureReduction     — reduced chance of workshop failure
  qualityTierBonus     — chance to output higher-tier result (Ironwood)
```

**Roaming Module** (`roaming_loot`):
```
subStats:
  creditsPerKill       — bonus credits from kills (primary)
  rareDropChanceMod    — increased rare drop chance
  scrapYieldMod        — increased scrap per kill
  materialFindChance   — increased material find
  xpBoostMod           — increased XP gain
  cacheFragmentChance  — increased cache fragment drops
```

**Idle Module** (`idle_standby`):
```
subStats:
  offlineEarningsMod   — offline credit earnings (primary)
  offlineScrapMod      — offline scrap accumulation
  offlineXpMod         — offline XP gain
  offlineMaterialMod   — passive material generation
```

### 3.3 Scaling Formula

Each sub-stat value is computed from:

```
subStatValue = baseValue
  × levelScalar
  × rarityMultiplier
  × manufacturerMultiplier
  × qualityRoll
  × varianceRoll
```

Where:
- **baseValue**: Per-stat constant (e.g., craftingSpeed base = 0.05 at level 1)
- **levelScalar**: `1 + (itemLevel - 1) × levelGrowthRate` (e.g., 0.015 per level →
  level 50 = 1.735×)
- **rarityMultiplier**: Common=0.6, Uncommon=1.0, Rare=1.4, Epic=1.8, Legendary=2.5
- **manufacturerMultiplier**: 1.0 baseline; biased stats get 1.15–1.3, anti-biased
  stats get 0.85–0.9 (mirrors existing `baseStatBias` system)
- **qualityRoll**: `0.85 + qualityTicks × 0.15` (range 0.85–1.0, scaled by HelixWorks
  floor bonus)
- **varianceRoll**: `seededRandom(0.8, 1.2, rng)` — the ±20% that makes every
  module unique

### 3.4 Rarity-Gated Dimensions

Not all sub-stats are available at all rarities:

| Rarity | Sub-stats Available |
|---|---|
| Common | 1 (primary only) |
| Uncommon | 1–2 (primary + 1 bonus) |
| Rare | 2–3 |
| Epic | 3–4 |
| Legendary | 4–5 + unique behavior |

The `rarityUnlocks` map in the module definition controls which sub-stats unlock
at which rarity. A Common crafting module only gives `craftingSpeed`. A Legendary
one gives all 6 dimensions plus the manufacturer's unique legendary behavior.

### 3.5 Legendary Unique Behaviors

When a module rolls on a Legendary item (and passes the `specialEffectChance=1.0`
gate from RARITIES), it gains a unique behavior specific to its manufacturer:

| Manufacturer | Legendary Crafting Behavior |
|---|---|
| Redline | **Momentum Crafter**: Each consecutive craft increases speed by 2% (max 30%). Resets on different recipe. |
| Ironwood | **Masterwork Chance**: 15% chance crafted item is one rarity tier higher. |
| BlastForge | **Salvo Craft**: 25% chance to produce 3 copies instead of 1. |
| Prismatek | **Elemental Infusion**: Crafted item gains +15% to its element's primary stat. |
| ThrowTech | **Auto-Crafter Drone**: Passively crafts queued items at 20% speed, even while in other activities. |
| HelixWorks | **Adaptive Module**: +5% to ALL activity stats (cross-activity universal boost). |

These are stored in `subStats` as special keys (e.g., `legendaryBehavior: 'momentumCrafter'`)
and a `legendaryValue` sub-stat, so `sumActivityModifier` doesn't need to know
about them — the activity execution engine reads them.

---

## 4. Integration with Item Generators

### 4.1 Module Roll Chance

When an item is generated, after rolling combat affixes, the generator rolls for
activity modules:

```
activityModuleChance = 0.20 (base)
  + (rarity === Rare ? 0.10 : rarity === Epic ? 0.20 : rarity === Legendary ? 0.30 : 0)
  + (manufacturer === HelixWorks ? 0.10 : 0)
```

If the roll succeeds, it picks a random activity kind (uniform, or weighted by
the item's slot tendencies — e.g., ordnance favors salvaging, relics favor idle,
classMods favor crafting).

Then it calls `generateActivityModule(ctx)` and pushes the resulting affix into
the item's `affixes[]`.

### 4.2 Per-Slot Tendencies

Each gear slot has natural affinities. The random activity pick respects these
weighted tendencies:

| Slot | Favored Activities | Weight Bias |
|---|---|---|
| Weapon (primary/secondary/heavy) | roaming_loot, boss_fight | roaming: 3×, boss: 2× |
| Shield | idle_standby, roaming_loot | idle: 2×, roaming: 1.5× |
| Ordnance | salvaging, workshop_service | salvage: 3×, workshop: 2× |
| Relic | idle_standby, crafting, roaming | idle: 2×, craft: 1.5×, roam: 1.5× |
| ClassMod | crafting, workshop_service, market | craft: 3×, workshop: 2×, market: 2× |

This creates natural specialization without hard-locking slots to activities.

### 4.3 Chef Integration

The Chef imports `sumActivityModifier` from the shared lib. When processing a
claim (roaming, crafting completion, salvage operation, workshop tick, market
listing), it:

1. Reads the player's equipped gear
2. Calls `sumActivityModifier(gear, activityKind)` 
3. Applies the modifiers:
   - `craftingSpeed` → reduces craft duration: `duration *= 1 / (1 + craftingSpeed)`
   - `salvageYield` → multiplies salvage output: `output *= (1 + salvageYield)`
   - `marketFeeReduction` → reduces fee: `fee -= marketFeeReduction`
   - etc.

The Chef does NOT call the generator — it only consumes the affix sub-stats
already baked into the item. The generator runs client-side during item creation
and the Chef verifies determinism by regenerating (same RNG seed → same output).

---

## 5. UI Wiring

### 5.1 Action Tab Modifier Display

A new component `ActivityModifierPanel` shows the currently-active modifiers for
the selected activity. It reads from `sumActivityModifier` and renders each
contributing gear piece with its sub-stat breakdown.

Layout: Compact row of gear icons + total modifier percentages. Expandable to
show per-item contribution.

### 5.2 Gear Inspect Enhancement

The existing gear inspect modal (or future detail view) shows activity modules
alongside combat affixes, with:
- Quality bar (0–100)
- Sub-stat list with values
- Manufacturer badge with color
- Legendary behavior callout (if applicable)

---

## 6. File Plan

| File | Action | Purpose |
|---|---|---|
| `src/types/items.ts` | MODIFY | Add `'activity'` to `Affix.category`, add `subStats?: Record<string, number>` |
| `src/content/activityAffixes.ts` | REPLACE | Replace static catalog with module type definitions and scaling constants |
| `src/lib/generators/activityModuleGenerator.ts` | CREATE | `generateActivityModule(ctx)` — the procedural generator |
| `src/lib/stats/activityModifiers.ts` | CREATE | `sumActivityModifier(gear, activity)` — aggregation |
| `src/lib/generators/weaponGenerator.ts` | MODIFY | Add activity module roll after affix generation |
| `src/lib/generators/shieldGenerator.ts` | MODIFY | Add activity module roll |
| `src/lib/generators/ordnanceGenerator.ts` | MODIFY | Add ordnance affixes + activity module roll |
| `src/lib/generators/relicGenerator.ts` | MODIFY | Add activity module roll |
| `src/lib/generators/classModGenerator.ts` | MODIFY | Add activity module roll |
| `src/server/chef.ts` | MODIFY | Import and apply `sumActivityModifier` to claims |
| `src/components/action/ActivityModifierPanel.tsx` | CREATE | UI for current activity modifiers |
| `src/screens/ActionScreenContextual.tsx` | MODIFY | Wire ActivityModifierPanel below loadout |
| `src/test/activityModuleGenerator.test.ts` | CREATE | Determinism, scaling, rarity gate, manufacturer identity tests |

---

## 7. Billions Math (Validation)

With:
- 6 manufacturers
- 5 rarities
- 50 levels
- 100 quality ticks
- 5 activity kinds (per module)
- 7 gear slots
- Multiple sub-stats with ±20% variance each
- Rarity-gated dimension unlocks

Each module has: `6 × 5 × 50 × 100 × (sub-stat combinations)` unique outputs.
With 3–6 sub-stats each having independent variance rolls, the combinatorics
easily exceed billions before even considering multi-module gear.

---

## 8. Implementation Order

1. Extend `Affix` type (add `subStats`, `'activity'` category)
2. Build `activityModuleGenerator.ts` — the core procedural generator
3. Build `activityModifiers.ts` — `sumActivityModifier` aggregation
4. Add `src/content/activityModuleDefs.ts` — module type definitions (sub-stat
   bases, rarity unlocks, manufacturer biases per module type)
5. Wire into all 5 item generators (roll activity modules after combat affixes)
6. Build `ActivityModifierPanel.tsx` UI component
7. Wire into `ActionScreenContextual.tsx`
8. Wire Chef
9. Tests (determinism, scaling, rarity gates, manufacturer identity)
10. Build, verify, deploy

---

*Drafted 2026-06-10. Awaiting user feedback before implementation.*
