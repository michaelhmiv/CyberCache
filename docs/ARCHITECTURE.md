# CyberCache Architecture — Source of Truth Map

The canonical guide for gameplay architecture. Every agent working in this
repo must read this document before touching game logic.

> **Related docs:** `docs/ACTIVE_ACTIVITY_STATE.md`, `docs/SINGLE_ACTIVITY_ENFORCEMENT.md`,
> `docs/dps-chain-v2.md`, and the cybercache-dev skill references
> (`single-source-of-truth-tick.md`, `persistence-architecture.md`).

---

## 1. Gameplay Source of Truth Map

Each gameplay domain has **exactly one owner** file/module. Duplicate logic
in screens or components is forbidden.

| Domain | Owner | Notes |
|---|---|---|
| **Activity lifecycle** (start, stop, heartbeat) | `src/lib/supabase/activityService.ts` + `src/store/useActivityStore` | Server-backed via `active_actions` table |
| **Roaming tick execution** | `src/store/slices/idleTickerSlice.ts` | Mounted once in `App.tsx`. 3s cadence. Calls `cc_claim_roaming_rewards` RPC. |
| **Server reward claiming** | `src/store/slices/idleTickerSlice.ts` → `verifiedOps` → `cc_claim_roaming_rewards` RPC | Server is source of truth; client is instant preview |
| **Tick feed events** | `src/store/slices/tickSlice.ts` | `TickEvent` / `TickEventTone`. Capped at 50, FIFO. |
| **Inventory mutation** | `src/store/slices/inventorySlice.ts` | `addItem`, `removeItem`, `generateAndAdd*` |
| **Player resources** (credits, XP, scrap, materials, essences, cache keys/fragments) | `src/store/slices/playerSlice.ts` | `addCredits`, `addXP`, `addScrap`, `addMaterial`, `addEssence`, `addCacheKeyFragments` |
| **Loadout** | `src/store/slices/loadoutSlice.ts` | 7-slot loadout with consumable slots |
| **Survival HP / death / medkit** | `src/store/slices/survivalSlice.ts` | Persisted via Supabase runtime snapshot |
| **Kill cycle / enemy HP** | `src/store/slices/killCycleSlice.ts` | Persisted via Supabase runtime snapshot |
| **Boss prep / boss fight** | `src/store/slices/bossSlice.ts` + `src/lib/simulation/bossSimulator.ts` | Pure sim, no side effects |
| **Crafting / salvaging / workshop** | `src/store/slices/workshopSlice.ts` + `src/lib/craftingEngine.ts` | Queue-based |
| **Public profile activity** | `src/types/activity.ts` → `ActiveActivity.publicPayload` | Display-only; derived from activity store |
| **Animation / diorama display** | `src/lib/animation/fightTimeline.ts` + `src/lib/activity/ActionStage.tsx` | Pure reads of gameplay state |
| **DPS computation** | `src/lib/stats/dpsChain.ts` | See `docs/dps-chain-v2.md` |
| **Supabase persistence** | `src/store/runtimeSupabaseSync.ts` | 500ms debounced snapshot of all 10 stores |
| **XP curve** | `src/content/simulation.ts` (`xpToNextLevel`) | Mirrored server-side in migration 057 |

---

## 2. Allowed Mutation Paths

### Tick rewards (roaming)
```
idleTickerSlice.tickNow()
  → rollClientEvents()          # client preview (Math.random ok HERE only)
  → applyEvents()               # mutate player + inventory + push tickFeed
  → cc_claim_roaming_rewards()  # server re-rolls, validates, returns authoritative state
  → apply server response       # overwrite client preview with server truth
```

### Survival damage (per tick)
```
idleTickerSlice.tickNow()
  → computeMonsterDamageVsHunter()  # pure function
  → survivalSlice.applyDamage()     # state mutation
  → decideAutoEat()                 # pure function
  → playerSlice.consumeConsumable() # state mutation
```

### Cache opening
```
ActionScreenContextual.openCache()
  → verifiedOps.makeItem()           # server RPC
  → serverItemRowToDisplayGear()     # adapter
  → inventory.addItem()              # state mutation (server-authoritative item)
```

### Boss attempt
```
BossPrepModal → bossSimulator.executeBossAttempt()  # pure simulation
  → bossSlice.recordAttempt()                        # state mutation
  → display result via animation                      # UI only
```

### Activity transitions
```
screen → activityStore.start(input)   # writes to Supabase active_actions
screen → activityStore.clear()        # clears active action
```

---

## 3. Forbidden Patterns

Screens and visual components are **consumers, not engines**. They must NOT:

- Roll rewards independently (no `Math.random` for drops/XP/credits in screens)
- Generate drops (`inventory.generateAndAdd*` from screen-level code)
- Mint cache fragments
- Award XP, credits, scrap, materials, or essences directly
- Mutate inventory directly
- Mutate authenticated player resources directly
- Run combat math
- Run survival/death logic
- Own gameplay `setInterval` timers

**Exception:** Client-side randomness in `rollClientEvents()` inside
`idleTickerSlice.ts` is the ONLY allowed gameplay `Math.random` outside of
pure simulation functions (`bossSimulator.ts`, `damageContract.ts`).
It is explicitly marked as "client preview" and is always overwritten by
the server response.

---

## 4. UI Consumption Rules

UI components read from canonical stores:

| UI Surface | Reads From | Must Not Do |
|---|---|---|
| `DashboardScreen` | `useTickFeedStore` (gain toasts), `usePlayerStore` (HUD stats) | Must not generate rewards |
| `ActionScreenContextual` | `useTickFeedStore` (feed events), `useActivityStore` (current action), `usePlayerStore` (resources) | Must not run its own tick loop |
| `ProfileScreen` | `usePlayerStore`, `useInventoryStore`, `useLoadoutStore` | Must not mutate |
| `InventoryScreen` | `useInventoryStore`, `useLoadoutStore` | Must not generate items |
| `LiveTurfDiorama` | `useTickFeedStore` (latest event), `usePlayerStore` (stats) | Must not generate rewards |
| `ActionStage` | `useActionStageOrchestrator` (beat index), `activityStore` (kind) | Must not generate gameplay outcomes |

Display-only timers are allowed for:
- Elapsed time display (seconds since activity started)
- Animation pacing (RAF loops)
- Countdown presentation (crafting completion)

These timers must never mutate gameplay state.

---

## 5. Server Verification Rules

- **All progression-affecting rewards** must go through Supabase RPCs wrapped
  in `verifiedOps` + `verifiedStateSync`.
- **Client-side randomness** is only for instant animation feedback.
  The server re-rolls and the server response is authoritative.
- **localStorage may only be used for:** UI preferences and cross-tab coordination
  locks (`activitySettlement.ts`).
- **Authenticated game progression must not depend on localStorage.**

---

## 6. How to Add a New Action

1. Add the kind to `ActivityKind` in `src/types/activity.ts`.
2. Add the label to `PRODUCTIVE_ACTIVITY_LABELS` in the same file.
3. Add a `MechanicWorkspaceSpec` entry in `src/lib/activity/actionWorkspaceSpecs.ts`.
4. Add a build helper in `src/lib/activity/activityBuilders.ts`.
5. Add a UI panel in the contextual workspace (follow existing patterns in
   `ActionScreenContextual.tsx`).
6. Add animation beats in `src/lib/activity/actionAnimationDirector.ts`.
7. Add stage assets in `actionWorkspaceSpecs.ts` if visual rendering is needed.
8. If the action produces rewards, add the RPC path to `verifiedOps` and wire
   it into the ticker or a dedicated action settlement path. **Do not add a
   screen-level reward loop.**

---

## 7. How to Add a New Reward/Event Type

1. Add the tone to `TickEventTone` in `src/store/slices/tickSlice.ts`.
2. Add the rendering fallback in `DashboardScreen.tsx`'s `gainToneClass` (add
   the new tone + ensure `'unknown'` fallback still works).
3. Add handling in `rollClientEvents()` (client preview) and the corresponding
   server RPC.
4. **Do NOT** add a new `RunEventTone` or `RunEventKind` for gameplay rewards.
   Those types are for UI lifecycle events only.

---

## 8. How to Add a New Inspectable Gear Surface

1. Follow the `dps-chain-v2.md` contract — never inline DPS math.
2. Use `computeWeaponDps` / `computeLoadoutDps` / `computeStandardDps` from
   `src/lib/stats/dpsChain.ts`.
3. If you need a new modifier, add it to the chain and update the DPS doc
   in the same PR.

---

## 9. How to Add a New Screen Without Creating a New Engine

1. Import canonical stores (`usePlayerStore`, `useTickFeedStore`, etc.).
2. Subscribe via Zustand selectors. Use `useShallow` or split into scalar
   selectors to avoid the "result of getSnapshot should be cached" loop.
3. Call high-level intent methods from stores (`.start()`, `.clear()`,
   `.equipItem()`, etc.). Do not call mutation methods directly on player/
   inventory stores from the screen.
4. If you need elapsed time, derive it from `activity.current.startedAt`.
5. If you need a display timer, use a `useEffect` + `setInterval` that only
   calls `setState` — never gameplay mutations.

---

## 10. Agent Checklist Before Opening a PR

- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] `npx tsc --noEmit` is clean
- [ ] No `Math.random` for gameplay in `src/screens/*` or `src/components/*`
- [ ] No `setInterval` for gameplay rewards in screens (display timers OK)
- [ ] No direct `player.addCredits/XP/Scrap/Material/Essence/CacheKeyFragments`
      from screens or components (domain stores / RPC paths only)
- [ ] Tick feed events use the canonical `TickEventTone` from `tickSlice.ts`
- [ ] No duplicated `TickEventTone` or `ActivityKind` unions
- [ ] New event tones have test coverage including `'unknown'` fallback
- [ ] Authenticated progression does not depend on localStorage
- [ ] Architecture doc is updated if a new source of truth is introduced
- [ ] `AGENTS.md` rules are followed
- [ ] Static architecture guard (`scripts/guard-architecture.sh`) passes

---

*Last updated: 2026-06-10 — stabilization pass removing duplicate client engines.*
