# CLAUDE.md

This file provides guidance to Claude Code and related coding agents working on CyberCache.

## Required Repo Check

Before changing files, verify:

- repository: `michaelhmiv/CyberCache`
- default branch: `master`
- `package.json` name: `cybercache`

If the active repo is Sportfolio or any other project, stop and switch context before making changes.

## Project Overview

CyberCache is a mobile-first idle roguelite looter RPG. The design direction is a Borderlands-inspired loot/buildcraft game with boss fights, generated gear, professions, player-made consumables, simple vehicle travel, and eventually marketplace/service systems.

## Source of Truth

- Static gameplay content belongs in `src/content/`.
- Legacy constants under `src/constants/` should be migrated intentionally.
- Markdown explains mechanics but must not be the only source for probabilities, XP, recipes, or loot tables.
- Runtime player state belongs in Supabase/Postgres, not static files.

## Content Framework

Read these before modifying gameplay systems:

- `src/content/gameContent.ts`
- `src/content/mechanicFramework.ts`
- `src/content/runtimeModel.ts`
- `src/content/simulation.ts`
- `src/content/validation.ts`
- `src/test/content.test.ts`

## Development Rules

1. Do not add new hardcoded balance values in UI components.
2. Do not introduce new mechanics without a lifecycle: state variables, triggers, formula/rule, UI surface, economy impact, and validation path.
3. Preserve the First Era decisions unless explicitly asked to change them:
   - no normal-use weapon durability,
   - legendary cores are loot-only,
   - starter-store goods are low-quality/account-bound/non-resellable,
   - one productive action at a time,
   - gunsmithing does not freely create top-tier weapons,
   - first-era vehicles stay simple.
4. Prefer small migrations from legacy constants to `src/content` over broad rewrites.
5. Add tests for content validation, simulation, or rules whenever static data changes.

## Verification

Run when possible:

```bash
npm test
npm run build
npm run lint
```

If a command fails, report whether it appears pre-existing or introduced.

## DPS Computation

All DPS math lives in `src/lib/stats/dpsChain.ts`. The chain is the
single source of truth — every UI surface goes through it. Do not
inline DPS formulas. See [`docs/dps-chain-v2.md`](./docs/dps-chain-v2.md)
for the chain's contract, the 6 multiplicative steps, the `DpsContext`
shape, the call patterns, and the recipe for adding a new modifier.
