# AGENTS.md

Operational guidance for coding agents working in the CyberCache repository.

## ⚠️ MANDATORY — READ FIRST

Before making any change:

- **Read `docs/ARCHITECTURE.md` first.** It defines the single sources of truth for every gameplay domain.
- **Do not duplicate domain types.** If `TickEventTone`, `ActivityKind`, or any shared type already exists, import it — do not recreate narrower local unions.
- **Do not add screen-level reward/tick/probability engines.** Screens are consumers, not engines. See ARCHITECTURE.md §3.
- **Do not mutate authenticated progression outside approved domain modules/RPC paths.** `player.addCredits()`, `player.addXP()`, `player.addCacheKeyFragments()`, etc. must only be called from domain stores or the canonical ticker.
- **Add tests when adding new event tones, activity kinds, reward types, or mutation paths.**
- **If a requested change appears to require a new source of truth, stop and update `docs/ARCHITECTURE.md` first.**
- **Do not bypass static architecture guards without documenting why.** Run `scripts/guard-architecture.sh` after changes.
- **Do not treat UI animation as gameplay execution.** Dioramas, action stages, and loot popups read from stores — they do not produce gameplay outcomes.
- **The Chef is the authoritative engine.** All roaming tick processing, item generation, and resource awards happen server-side (`src/server/chef.ts`). The client is a display layer — NEVER add item generation or resource mutation to the client ticker path. See `docs/ARCHITECTURE.md` §8.
- **Boss attempts are Chef-owned.** BossPrepModal and other screens may send intent/loadout selection and animate returned results, but they must not call `executeBossAttempt()`, mutate player progression, consume items, roll loot, update pity/unlocks, or provide client loot fallbacks.
- **Displayed mechanics come from the snapshot.** Shared stat surfaces should consume `src/lib/mechanics/buildCharacterMechanicsSnapshot.ts` (or helpers that consume it) for HP, DPS, break, loot, XP, scrap, and offline modifiers instead of re-computing formulas locally.
- **All item generators are shared.** `src/lib/generators/*` is imported by BOTH the Chef and the client. One source of truth. Do not create generator copies.

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

1. `src/content/` is the code-side static source of truth for content rules, loot tables, quality curves, XP assumptions, recipes, professions, mechanics, and validation utilities.
2. `docs/ARCHITECTURE.md` is the runtime source-of-truth map — domain owners, mutation paths, and forbidden patterns.
3. Supabase/Postgres is for runtime player state: profiles, generated item instances, inventory, profession XP, active actions, market listings, service jobs, escrow, boss attempts, and transactions.
4. `src/constants/*` files are legacy/static implementation data until migrated. Do not add new long-term economy, loot, crafting, or probability logic there if it belongs in `src/content/`.
5. Markdown docs explain systems, but Markdown is not the canonical source for probabilities, recipes, drop tables, or XP rules.

## Architecture Rules (from ARCHITECTURE.md)

### Screens are consumers, not engines

Screens may call high-level intent methods:
- `activityStore.start(input)` / `activityStore.clear()`
- `loadoutStore.equipItem(slot, itemId)` / `loadoutStore.unequipItem(slot)`
- `inventoryStore.addItem(item)` / `inventoryStore.removeItem(itemId)`

Screens must NOT independently:
- Roll rewards, generate drops, mint cache fragments
- Award XP, credits, scrap, materials, or essences
- Mutate inventory or player resources directly
- Run combat math, survival logic, or own gameplay timers

### One owner per domain

Every gameplay domain has exactly one owner file. See ARCHITECTURE.md §1 for the full map. If you find a second implementation of the same logic, delete the duplicate and route through the canonical owner.

### Tick events

The tick feed (`useTickFeedStore`) is the single source of truth for roaming reward events. All consumers must import `TickEvent`/`TickEventTone` from `@/store/slices/tickSlice`. The `runEvents.ts` module is for UI lifecycle display events only — not gameplay rewards.

### DPS computation

All DPS math is `src/lib/stats/dpsChain.ts`. See `docs/dps-chain-v2.md`. Do not inline DPS formulas anywhere.

## Verification Before Completion

Run from repo root when possible:

1. `npm test`
2. `npm run build`
3. `npm run lint`
4. `bash scripts/guard-architecture.sh`
5. `npx tsc --noEmit`

If any command fails, report whether it appears pre-existing or introduced by the change.

## Git Safety

- Confirm the repo is `michaelhmiv/CyberCache` before each write.
- Review changed files before completion.
- Never include credentials, secrets, tokens, or private API keys.
- Keep changes targeted and reversible.
