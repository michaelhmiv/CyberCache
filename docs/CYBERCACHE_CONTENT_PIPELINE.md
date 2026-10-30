# CyberCache Content Pipeline

CyberCache static gameplay content should be versioned, validated, simulated, and then consumed by runtime systems. The spreadsheet/workbook is a design workspace, not a production dependency.

> **Status note — professions (2026-10-30, Phase 0 Slice 5):** Professions are
> **design-only / NOT implemented**. The `PROFESSION_TRACKS` corpus in
> `src/content/gameContent.ts` is a design record: no screen imports it, no
> gameplay system reads it, and profession XP has no mechanical effect in the
> shipped game. Mentions of professions below describe the intended design
> pipeline, not shipped behavior. The corpus is kept as a future candidate;
> do not treat it as a live system.

## Intended Flow

1. Design or rebalance content in the workbook or directly in `src/content/`.
2. Convert stable design decisions into TypeScript/JSON-style records under `src/content/`.
3. Run content validation and simulation tests.
4. Migrate one runtime system at a time to consume the content layer.
5. Store player-specific state in Supabase/Postgres, not in static content files.

## Static Content Belongs In GitHub

Examples:

- professions and profession curves
- materials and material tiers
- recipes and recipe inputs/outputs
- quality curves
- loot pools and loot tables
- XP action rewards
- gear slot rules
- starter-store rules
- vehicle classes
- service-market rules
- mechanic decisions

## Runtime State Belongs In Supabase/Postgres

Examples:

- user profiles
- inventory item instances
- generated weapon rolls
- material stacks
- profession XP
- active action state
- market listings
- service jobs
- escrow records
- boss attempts
- transaction history

## Migration Rules

- Do not add new long-term balance/probability values directly inside React components.
- Do not add new drop tables or recipes to UI code.
- Do not treat Markdown as the source of a probability.
- If a gameplay value should be testable, put it in `src/content/`.
- If a mechanic is unresolved, mark it as `needs_decision` in a registry before implementation.

## Recommended Migration Order

1. Keep `src/content` validation and tests green.
2. Migrate boss loot tables to use `src/content/LOOT_TABLES`.
3. Migrate XP rewards to use `src/content/XP_ACTION_REWARDS`.
4. Migrate starter store and consumables to use `src/content` recipe and supply-mode rules.
5. Add Supabase schemas for item instances, profession state, active actions, service jobs, and escrow.
6. Wire UI screens only after the static content and runtime schema are stable.

## Validation Expectations

The content layer should reject:

- duplicate IDs
- missing material/profession/loot-pool references
- negative or impossible probabilities
- quality curves that do not sum to 100%
- recipes with no inputs or outputs
- loot entries with non-positive weights

## Simulation Expectations

The simulation layer should support:

- deterministic seeded loot rolls
- quality roll checks using effective skill
- daily XP stress tests
- level-curve estimates
- future Monte Carlo economy checks

## First Era Content Decisions

- Player level is the core pacing spine.
- Early legendary drops are allowed, but item level prevents early max gear.
- Equipped weapons do not break from normal use.
- Broken/damaged/unstable states apply to components and cores first.
- Legendary cores are loot-only.
- Consumables, fuel, repair kits, and utility goods are intended to be primarily player-made.
- Starter-store goods are limited, low-quality, account-bound, and non-resellable.
- One productive action progresses at a time.
- Vehicles are intentionally simple in First Era.
