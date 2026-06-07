# AGENTS.md — CyberCache Agent Operating Instructions

> **Read this before any gameplay, mechanics, documentation, or workflow change.**

---

## 1. Project Identity

CyberCache is a **mobile-first idle roguelite looter RPG**.

**Main loop:** Roaming Combat → Loot/Salvage → Workshop/Crafting → Boss Prep → Boss Attempts → Unlocks/Better Builds.

**Roaming Combat and Boss Combat are intentionally separate.** Roaming is idle/AFK field combat; bosses are deliberate prep-based encounters.

---

## 2. Required Startup Reading

Before any gameplay/mechanics work, read **in this order:**

1. **AGENTS.md** (this file) — agent workflow, documentation rules, guardrails
2. **MECHANICS.md** — canonical game mechanics, status labels
3. **README.md** — project overview, setup, tech stack, feature summary
4. **Relevant source files** depending on the task:
   - Constants: `src/constants/` (bosses, consumables, roamingAreas, craftingRecipes, manufacturers, elements, weaponTypes, legendaryEffects, rarities, salvageRules, zones, skillTrees)
   - Types: `src/types/` (game, boss, items, player, workshop, skill, market)
   - Simulation: `src/lib/simulation/bossSimulator.ts`
   - Stores: `src/store/slices/` (boss, idle, loadout, inventory, player, skill, market, workshop)
   - Screens: `src/screens/FightScreen.tsx`, `src/components/fight/BossPrepModal.tsx`

---

## 3. Source-of-Truth Hierarchy

| Priority | File | Role |
|---|---|---|
| 1 | **AGENTS.md** | Agent workflow rules, documentation freshness rules, repo operating instructions |
| 2 | **MECHANICS.md** | Canonical game mechanics, honest status labels |
| 3 | **README.md** | Project overview, setup, tech stack, high-level feature list |
| 4 | `src/constants/*.ts` | Executable data contracts, current content definitions |
| 5 | `src/types/*.ts` | Type contracts |
| 6 | `scripts/validate-mechanics.ts` | Data integrity guardrail |
| 7 | Test files | Behavioral guardrails |

---

## 4. Documentation Freshness Contract

**When you change gameplay mechanics, combat logic, boss definitions, consumables, weapon behavior, manufacturers, roaming areas, crafting recipes, salvage/economy, loot tables, progression, validation scripts, tests, or any player-facing gameplay flow:**
→ **Update MECHANICS.md in the same change.**

**When you change agent workflow, source-of-truth files, required checks, repo structure, validation scripts, package scripts, or development workflow:**
→ **Update AGENTS.md in the same change.**

**When you change setup commands, project structure, scripts, or the public feature summary:**
→ **Update README.md if the README would otherwise become stale.**

**When you add a new mechanic:**
→ Mark it honestly as **implemented**, **approximated**, **scaffolded**, **planned**, or **deferred**.

**A mechanic is implemented only if gameplay behavior is wired and validated.** Do not claim implementation solely from data or UI presence.

**Final summaries after any task must include a documentation freshness check:**
- MECHANICS.md: updated / not needed (with reason)
- AGENTS.md: updated / not needed (with reason)
- README.md: updated / not needed (with reason)

---

## 5. Required Checks

Before completing any task, run available checks. Do not invent results for commands that do not exist or were not run.

```bash
npm run build          # TypeScript/Vite production build
npm run test           # Vitest test suite
npm run lint           # ESLint
npm run mechanics:validate   # Data integrity validation
npm run mechanics:report     # Boss balance sanity report
```

---

## 6. Agent Workflow

1. **Inspect repo status** before editing (`git status`, `git diff --stat`, `git log --oneline -10`)
2. **Create a concise internal implementation plan** - plan and proceed in the same run
3. **Proceed unless blocked** by a genuine blocker (ask the user if blocked)
4. **Keep changes focused** - avoid broad unrelated refactors
5. **List exact commands run** in the final summary
6. **List known limitations honestly** - do not hide scaffolded or approximated mechanics

---

## 7. Mechanics Status Definitions

| Status | Meaning |
|---|---|
| **implemented** | Real behavior exists and is wired into gameplay |
| **approximated** | Represented through current score/multiplier model but not final event behavior |
| **scaffolded** | Data/UI exists but gameplay behavior is minimal or inactive |
| **planned** | Intended future work, not currently present |
| **deferred** | Intentionally out of current scope |

---

## 8. Guardrails

- **Do not rewrite the whole app** unless specifically asked.
- **Do not merge roaming and bossing into one automatic loop.**
- **Do not auto-consume rare boss consumables during roaming** unless explicitly designed and documented.
- **Do not treat bosses as automatic idle farming content** without a deliberate mastery/auto-farm unlock design.
- **Do not add mechanics without validation and docs.**
- **Do not leave MECHANICS.md stale** after mechanics changes.
- **Do not leave AGENTS.md stale** after workflow/source-of-truth changes.
- **Do not add backend, auth, multiplayer, monetization, or unrelated large features.**
- **Do not push unless explicitly asked.**
- **Do not create pull requests unless explicitly asked.**
- **Do not commit secrets** (.env, credentials, etc.).

---

## 9. Tech Stack Quick Reference

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 6 |
| Build | Vite 8 |
| Styling | Tailwind CSS 4 (dark cyberpunk theme) |
| State | Zustand 5 (with localStorage persistence) |
| Animation | Framer Motion 12 |
| Icons | Lucide React |
| Testing | Vitest 4, @testing-library/react |
| Linting | ESLint 10, typescript-eslint |

---

## 10. Key File Map

```
src/
├── constants/           # Game data definitions
│   ├── bosses.ts        # 7 Region 1 boss definitions with tags, phases, prep metadata
│   ├── consumables.ts   # ~20 consumables with V2 tactical metadata
│   ├── roamingAreas.ts  # 7 roaming areas with manufacturer influence
│   ├── craftingRecipes.ts # 21 crafting recipes
│   ├── manufacturers.ts # 6 manufacturer definitions
│   ├── elements.ts      # 6 element definitions with matchups
│   ├── weaponTypes.ts   # 6 weapon type definitions with signature mechanics
│   ├── legendaryEffects.ts # 25 legendary effect definitions
│   ├── rarities.ts      # 5 rarity tier definitions
│   ├── salvageRules.ts  # Salvage yield formulas
│   └── zones.ts         # Legacy zone progression data
├── lib/
│   ├── simulation/
│   │   └── bossSimulator.ts  # 4-phase boss simulation engine
│   ├── legendaryEffects.ts   # Legendary effect application logic
│   ├── craftingEngine.ts     # Workshop offline crafting math
│   └── generators/           # Procedural item generators
├── store/slices/        # Zustand stores
├── types/               # TypeScript interfaces and enums
├── screens/             # Full-screen views
├── components/          # Reusable UI components
└── test/                # Test files
scripts/
├── validate-mechanics.ts      # Data integrity validation
└── mechanics-balance-report.ts # Boss balance sanity report
```