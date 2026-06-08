# AGENTS.md

Operational guidance for coding agents working in the CyberCache repository.

## Mandatory Repo Verification

Before making any change, verify that the active repository is exactly:

- `michaelhmiv/CyberCache`
- default branch: `master`
- package name in `package.json`: `cybercache`

If the repo is `Sportfolio`, `Sportfolio-Replit`, or anything else, stop immediately and switch repositories. Do not create or update files until this check is complete.

## Project Snapshot

- Product: CyberCache — mobile-first idle roguelite looter RPG with Borderlands-inspired loot, boss fights, buildcraft, player-made consumables, professions, simple first-era vehicles, and marketplace/service systems.
- Stack: Vite + React + TypeScript.
- App source: `src/`.
- Static content foundation: `src/content/`.
- Legacy gameplay constants: `src/constants/` remain in place and should be migrated deliberately.

## Source-of-Truth Hierarchy

Gameplay probabilities and balance rules must not be hidden in UI components or prose-only docs.

1. `src/content/` is the code-side static source of truth for content rules, loot tables, quality curves, XP assumptions, recipes, professions, mechanics, and validation utilities.
2. Spreadsheet/workbook artifacts are design workspaces and reference imports, not runtime dependencies.
3. Markdown docs explain systems, but Markdown is not the canonical source for probabilities, recipes, drop tables, or XP rules.
4. Supabase/Postgres is for runtime player state: profiles, generated item instances, inventory, profession XP, active actions, market listings, service jobs, escrow, boss attempts, and transactions.
5. Existing `src/constants/*` files are legacy/static implementation data until migrated. Do not add new long-term economy, loot, crafting, or probability logic there if it belongs in `src/content/`.

## Current Content Framework Files

- `src/content/gameContent.ts` — seed data for professions, materials, material quality, quality curves, recipes, loot pools, loot tables, XP action rewards, simulation assumptions, and explicit mechanic decisions.
- `src/content/mechanicFramework.ts` — gear slot rules, starter store rules, first-era vehicles, action-slot rules, service marketplace rules, core processing, durability policies, gunsmithing boundaries, UI surface mapping, and market controls.
- `src/content/runtimeModel.ts` — static/runtime boundary and TypeScript shapes for Supabase-backed item instances, professions, service jobs, escrow, market listings, and active actions.
- `src/content/simulation.ts` — deterministic simulation helpers for loot rolls, quality rolls, daily XP, and level curves.
- `src/content/validation.ts` — validation utilities for duplicate IDs, missing references, invalid chances, malformed recipes, and bad loot tables.
- `src/content/mechanicsValidator.ts` — validation bridge for current legacy constants while they are being migrated.
- `src/content/mechanicsBalanceReport.ts` — deterministic boss/loadout sanity report utility for current encounter balance.
- `src/test/content.test.ts` — safety tests for the content layer.
- `src/test/mechanicsValidation.test.ts` — legacy mechanics validation coverage.
- `src/test/balanceReport.test.ts` — balance report coverage.

## Product-Critical Rules

1. Player level is the main long-term pacing spine. Early legendary drops are allowed, but item level and player progression prevent early max gear.
2. Equipped weapons do not lose condition from normal use in First Era. Broken, damaged, and unstable states apply to components/cores unless explicitly changed later.
3. Legendary cores are loot-only. Professions may process/bind them, but they must not create legendary cores from raw materials.
4. Consumables, fuel, repair kits, and utility goods are intended to become primarily player-produced.
5. Starter-store items are limited, low-quality, account-bound, and non-resellable safety valves.
6. Only one productive action progresses at a time: roaming, boss fight, crafting, refining, repairing, traveling, or service work.
7. First-era vehicles should remain simple: roughly six classes that primarily affect travel speed, fuel use, and condition.
8. Gunsmithing may tune, restore, extract, and process. It must not freely create infinite top-tier weapons.
9. Service jobs require explicit state, queue behavior, and escrow before implementation.

## Refactor Rules

- Prefer migrating one system at a time to `src/content`.
- Do not hardcode new drop probabilities, recipe costs, profession curves, or quality chances in React components.
- If a value affects balance, put it in `src/content` and add validation or simulation coverage.
- If a mechanic is vague, add it to a registry as `needs_decision` instead of silently implementing an assumption.
- Keep current gameplay behavior intact unless the task explicitly asks to wire the content layer into runtime.

## Recommended Implementation Order

1. Keep content layer green: `npm test`.
2. Add validation for new static content before wiring it into screens.
3. Migrate loot table logic from hardcoded boss/generator paths to `src/content`.
4. Migrate XP/action rewards to `src/content`.
5. Migrate recipes/professions/work queues after runtime state tables are designed.
6. Add Supabase-backed item instance and service-market tables only after static content boundaries are clear.

## Verification Before Completion

Run from repo root when possible:

1. `npm test`
2. `npm run build`
3. `npm run lint`
4. `npm run mechanics:validate`
5. `npm run mechanics:report`

If any command fails, report whether it appears pre-existing or introduced by the change.

## Git Safety

- Confirm the repo is `michaelhmiv/CyberCache` before each write.
- Review changed files before completion.
- Never include credentials, secrets, tokens, or private API keys.
- Keep changes targeted and reversible.
