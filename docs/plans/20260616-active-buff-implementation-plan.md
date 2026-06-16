# Plan: Active Consumable Buffs (all 29, full chef integration)

> **Status:** Plan, awaiting execution.
> **Date:** 2026-06-16
> **Companion docs:** `20260616-consumable-buff-mechanic-observations.md` (Task 9 research), `20260616-active-buff-per-consumable-trigger-map.md` (per-consumable trigger map), `20260616-active-buff-data-audit-and-recommendation.md` (data audit)
> **Scope:** Single PR. 11 sequenced tasks. All 29 consumables get full client-side active-state visibility. Chef emits an `activeBuffs` field alongside the existing `consumedConsumables` count. Client derives per-buff duration from the static `CONSUMABLES` registry.
> **Branch:** new `feat/active-consumable-buffs` from master.

---

## Goal

Make every consumable the player loads visible in three places, with consistent semantics:

1. **ConsumableLedger — "Active" section** at the top: live timer pills with countdown bars for currently-firing buffs. Below that, the existing "Loaded Slots" section.
2. **ConsumableRing** — re-ordered: **active > loaded > empty** (currently only "loaded > empty"). Active slices get a glow/pulse treatment.
3. **Source Breakdown modal — `consumable` bucket** — finally populated with the live effects of active buffs. Today it's always empty.

Plus one client-side UX:

4. **The pre-existing 2.5 wired consumables (Med Kit, Med Kit Refined, Shield Cell) keep their auto-eat tick-feed toasts**, but they ALSO spawn an active-buff pill so the player sees "Med Kit firing — 7s remaining" after the heal.

---

## Architecture: what the chef actually does vs. what we model client-side

The chef's `executeBossAttempt` (in `src/lib/simulation/bossSimulator.ts:698-778`) runs the entire boss fight as **one synchronous unit** — no per-tick loop. It returns `consumedConsumables: Record<string, number>` (just a count). It does **not** track per-buff timing, per-buff duration, or per-buff effect application timing.

**Implication for the design:** the chef can authoritatively say *"these consumables were used in this attempt"* but it cannot say *"Adrenaline Shot fired at attempt-tick 3 and lasted 8 seconds."* Per-buff timing in the HUD is therefore **client-derived display state**, not chef-authoritative.

This is the right call for a HUD PR:
- The chef's actual game-math (damage, healing, regen) is applied during the fight and is correct.
- The HUD's countdown pill is *display feedback* — the player sees "Adrenaline Shot: 5s left" because the registry says `repairDurationSeconds: 20` and the chef said the consumable was used.
- If the chef ever moves to a per-tick model, the client can switch to chef-derived timing without changing the UI.

**Authoritative boundary:**
- **Chef authoritative for:** which consumables were used, in what attempt, with what outcome.
- **Client authoritative for:** *when to start the countdown* (chef result receipt = "the consumable is firing NOW") and *what the countdown duration is* (read from the static `CONSUMABLES` registry).

This matches the existing `useTickFeedStore` model: the chef is the truth source, the client renders toasts/pills from the chef's result.

---

## Data model: `BuffInstance` + `ConsumableActivator`

New file: `src/lib/buffs/activeBuffs.ts` (~150 lines, pure data + helpers, no React).

```ts
/**
 * ActiveBuff — a single in-flight consumable effect with a known expiry.
 * 
 * The chef emits `consumablesUsed: Record<string, number>` after a boss attempt.
 * The client expands this to one ActiveBuff per *fired* consumable, deriving
 * the duration from the static CONSUMABLES registry (repairDurationSeconds
 * for high-Q perks, durationSeconds for per-interval coverage).
 * 
 * For per-interval consumables (Ammo Pack, Signal Scrambler, Loot Beacon),
 * the buff represents the *coverage window*, not a single tick. The duration
 * is durationSeconds; the expiry is start + duration.
 * 
 * For survival/phase triggers (Med Kit, Adrenaline Shot, etc.), the buff
 * represents the *post-trigger regen/repair* effect, with duration from
 * repairDurationSeconds.
 */
export interface ActiveBuff {
  /** Unique id — `${consumableId}:${attemptId}:${triggerIndex}`. */
  id: string;
  /** ConsumableType ID (e.g. 'MedKit', 'AmmoPack'). */
  consumableId: string;
  /** Family of the consumable (used for ring color/accent). */
  family: ConsumableFamily;
  /** What triggered the buff: 'auto-eat', 'chef-result', 'ammo-tick', etc. */
  source: BuffSource;
  /** Source attempt ID (for chef-result) or 'roaming-tick-N' (for client-side). */
  sourceId: string;
  /** Wall-clock time the buff started. */
  startedAt: number;
  /** Wall-clock time the buff expires. */
  expiresAt: number;
  /** Original duration in milliseconds (cached for ring/UI calculations). */
  durationMs: number;
  /** Optional numeric value (heal amount, DPS multiplier, etc. for display). */
  value?: number;
  /** For per-interval consumables: how many ticks fired. */
  ticksFired?: number;
}

export type BuffSource =
  | 'auto-eat'           // client ticker fired it (Med Kit, Shield Cell, Med Kit Refined)
  | 'chef-result'        // boss attempt result included this consumable
  | 'activity-result'    // craft/repair/scrap activity used this consumable
  | 'ammo-tick'          // roaming combat — per-interval trigger fired
  | 'phase-trigger';     // boss phase break fired the consumable
```

And a registry that maps every consumable to its activation pattern:

```ts
/**
 * ConsumableActivator — declarative map of consumableId -> how to derive
 * an ActiveBuff from a triggering event.
 * 
 * This is the *single source of truth* for "what does it mean for X to fire?"
 * The chef just returns the count; the client uses this to expand.
 */
export const CONSUMABLE_ACTIVATORS: Record<string, ConsumableActivator> = {
  // SURVIVAL (5) — auto-eat path
  MedKit:           { durationSource: 'highQualityPerk', defaultDurationMs: 0,   defaultValue: 150, source: 'auto-eat' },
  MedKitRefined:    { durationSource: 'highQualityPerk', defaultDurationMs: 0,   defaultValue: 260, source: 'auto-eat' },
  ShieldCell:       { durationSource: 'highQualityPerk', defaultDurationMs: 0,   defaultValue: 120, source: 'auto-eat' },
  NanoSwarm:        { durationSource: 'registryRepair',  defaultDurationMs: 30000, defaultValue: 300, source: 'auto-eat' },
  AdrenalineShot:   { durationSource: 'registryRepair',  defaultDurationMs: 20000, defaultValue: 1.1, source: 'auto-eat' },
  
  // AMMO (8) — chef-side decision (boss) + per-interval (roaming)
  AmmoPack:                 { durationSource: 'registryCoverage',  defaultDurationMs: 600000, source: 'chef-result' },
  HighCapacityAmmoPack:     { durationSource: 'registryCoverage',  defaultDurationMs: 1200000, source: 'chef-result' },
  ArmorPiercingAmmo:        { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  CorrosiveAmmo:            { durationSource: 'highQualityPerk',   defaultDurationMs: 10000, source: 'chef-result' },
  CryoAmmo:                 { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  ElementalCoating:         { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  IncendiaryAmmo:           { durationSource: 'highQualityPerk',   defaultDurationMs: 6000, source: 'chef-result' },
  ShockAmmo:                { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  
  // TACTICAL (5) — fightStart or bossMechanic
  BossScanner:              { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  Jammer:                   { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  SignalScrambler:          { durationSource: 'registryCoverage',  defaultDurationMs: 600000, source: 'chef-result' },
  TargetPainter:            { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  OverchargeStim:           { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' }, // corrupted, fights
  
  // ORDNANCE (6) — phase break
  CorrosiveCharge:          { durationSource: 'highQualityPerk',   defaultDurationMs: 8000, source: 'chef-result' },
  EMPCharge:                { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  MagnetizedPayload:        { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  OrdnanceCharge:           { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  PhaseShiftGrenade:        { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  VoidAmmo:                 { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' }, // corrupted
  
  // ECONOMY (5) — outcome-gated or per-activity
  DataSkimmer:              { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  InsuranceToken:           { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  LootBeacon:               { durationSource: 'registryCoverage',  defaultDurationMs: 600000, source: 'chef-result' },
  LuckBooster:              { durationSource: 'none',              defaultDurationMs: 0, source: 'chef-result' },
  SalvageContract:          { durationSource: 'none',              defaultDurationMs: 0, source: 'activity-result' },
  WorkshopRushTicket:       { durationSource: 'none',              defaultDurationMs: 0, source: 'activity-result' },
};

export interface ConsumableActivator {
  /** Where to look up the duration. 'none' = no timer pill, just 'consumed' toast. */
  durationSource: 'highQualityPerk' | 'registryRepair' | 'registryCoverage' | 'none';
  /** Fallback if durationSource returns nothing. */
  defaultDurationMs: number;
  /** Display value (heal amount, multiplier, etc.). */
  defaultValue: number;
  /** Source type for the buff (used for tick-feed tone selection). */
  source: BuffSource;
}
```

`resolveConsumableDuration(consumableId, playerQuality)` returns the millisecond duration for any consumable. Reads:
- `highQualityPerk`: looks up `runtime.highQualityPerks[0].effects.repairDurationSeconds` for the matching quality tier
- `registryRepair`: reads `runtime.baseEffects.repairDurationSeconds`
- `registryCoverage`: reads `activityRules.roaming.durationSeconds` (or `boss` if applicable)
- `none`: returns 0 (no pill, just toast)

---

## Tasks

### Task 1: Data layer (BuffInstance + ConsumableActivator)

**Files:** `src/lib/buffs/activeBuffs.ts` (new, ~150 lines), `src/lib/buffs/__tests__/activeBuffs.test.ts` (new, ~80 lines)

**TDD:** write tests for `resolveConsumableDuration` covering all 4 `durationSource` modes. Verify the registry is exhaustive (`Record<string, ConsumableActivator>` with no fallback — adding a new consumable to the registry without an activator entry is a TypeScript error).

**Pitfall:** the registry must be `Record<ConsumableType, ConsumableActivator>` not `Record<string, ...>` so missing entries fail at compile time. Same pattern as `ConsumableRing` accent typing in the previous PR.

### Task 2: Chef `activeBuffs` field (3-place wiring)

**Files:** `src/server/chef.ts`, `src/lib/chef/chefClient.ts`, `src/store/slices/idleTickerSlice.ts`

This is the "3-place wiring trap" the skill warns about. **All three must be updated together** or the client will never see the field.

**Chef side** (`src/server/chef.ts`):
- Add `activeBuffs: BuffInstance[]` to `BossAttemptChefResult` (the chef-side type).
- In the `executeBossAttempt` path (called from `verifyBossAttempt` or wherever `consumedConsumables` is computed), expand `consumedConsumables: Record<string, number>` into one `BuffInstance` per `count`.
- For each: derive `expiresAt = now + resolveConsumableDuration(type, ...)` server-side too. The chef knows the duration; emit it. The client can re-derive for display, but having it server-side means the field is *chef-truth*.
- For long-coverage consumables (Ammo Pack, Signal Scrambler, Loot Beacon), the chef tracks the coverage window separately. The "current coverage" buff represents the *remaining* window. For a first attempt, full duration; for a re-attempt, the chef should look up the player's existing coverage state and emit the remaining ms.

**Wait** — that last point is complex. For this PR, **simplification:** the chef emits `activeBuffs` only for consumables the player has *newly loaded this attempt*. Long-coverage buffs are tracked client-side only (the client reads `loadout.consumables` and the registry, then derives the window). This is good enough for a first PR; we can wire chef-side coverage in a follow-up.

**So the chef-side emit is simple:** for each `consumedConsumables[type]`, emit one `BuffInstance` with `source: 'chef-result'`, `sourceId: bossAttemptId`, `durationMs: resolveConsumableDuration(type)`, `expiresAt: now + durationMs`.

**Client side** (`src/lib/chef/chefClient.ts`):
- Mirror the field on `ChefVerifyBossResult`.
- No transformation — the chef already did it.

**Call site** (`src/store/slices/idleTickerSlice.ts`):
- In the `verifyBoss` success handler (around line 560 where `consumedConsumables` is processed), dispatch each `activeBuff` to `useActiveBuffsStore.add()`.
- Also dispatch `'consumable-fired'` events to the tick feed for each `activeBuff` so the toasts show. (New `TickEventTone: 'consumable-fired'`.)

**Tests:**
- Server: write a unit test for the chef's `activeBuffs` derivation. Verify Med Kit, Med Kit Refined, and Shield Cell all produce `activeBuffs` rows when used. Verify Ammo Pack produces a 600000ms-duration row.
- Client: write a unit test for the dispatch adapter. Verify the store receives the right rows.

### Task 3: `useActiveBuffsStore` (Zustand, ephemeral, not persisted)

**Files:** `src/store/slices/activeBuffsSlice.ts` (new, ~80 lines), `src/store/index.ts` (modified, +1 line to combine the slice)

```ts
import { create } from 'zustand';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';

interface ActiveBuffsState {
  buffs: ActiveBuff[];
  add: (buff: ActiveBuff) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Returns a snapshot for the source breakdown modal. */
  getActiveForBucket: () => ActiveBuff[];
}

export const useActiveBuffsStore = create<ActiveBuffsState>((set, get) => ({
  buffs: [],
  add: (buff) => set((state) => ({ buffs: [...state.buffs, buff] })),
  remove: (id) => set((state) => ({ buffs: state.buffs.filter((b) => b.id !== id) })),
  clear: () => set({ buffs: [] }),
  getActiveForBucket: () => get().buffs.filter((b) => b.expiresAt > Date.now()),
}));
```

**NOT persisted** — ephemeral state. Loses on refresh, like `useTickFeedStore`. (Player on page refresh: active buffs reset. The chef has already applied the effects, so the only loss is visual feedback. The high-Q perk math is server-authoritative, not client-tracked.)

**Tick cleanup:** the ledger component will run a `setInterval(1000)` to call `remove(id)` on any buff where `expiresAt <= Date.now()`. (Could do this in a hook, but the ledger is the only consumer of the cleanup — keep it close.)

**Test:** add/remove/clear/getActiveForBucket. The store has no React dependencies; pure Zustand.

### Task 4: Client-side auto-eat hooks (Med Kit, Shield Cell, Med Kit Refined)

**Files:** `src/store/slices/idleTickerSlice.ts` (modified, ~30 lines added)

Today, the auto-eat code path is at lines 258-294 of `idleTickerSlice.ts`. It calls `decideAutoEat`, then either `refillShield` or `heal`, then pushes a `'heal'` event. We extend this path:

1. After the heal/refill, if the consumable has a high-Q perk with `repairDurationSeconds`, spawn an `ActiveBuff` with `source: 'auto-eat'`, `durationMs` from the registry, `expiresAt: now + durationMs`.
2. For the 2 consumables with `repairDurationSeconds` in `runtime.baseEffects` (Nano Swarm, Adrenaline Shot — but those aren't in the auto-eat path today), the same pattern applies once the auto-eat path is extended to handle them.

**Important:** Nano Swarm and Adrenaline Shot are not currently in the auto-eat path. The `decideAutoEat` function (in `src/lib/survival/decideAutoEat.ts` or similar) only knows about Med Kit / Shield Cell. **For this PR, we extend `decideAutoEat` to include all 5 survival consumables.** Find that function and add Nano Swarm (60% threshold) and Adrenaline Shot (20% threshold) to its priority order.

Wait — that's a behavior change, not just a HUD change. The user said "every consumable planned out and implemented" but I should not silently change the survival-eat priority without flagging it. **Decision:** add a test for the new behavior, document the priority change in the PR body, and let the user review the priority order before merge.

**TDD:** write a test for the new `decideAutoEat` priority: Nano Swarm > Med Kit > Adrenaline Shot (60% > 50% > 20%). Then implement.

### Task 5: Roaming ammo-interval and activity-start hooks

**Files:** `src/lib/combat/ammoIntervalTracker.ts` (new, ~60 lines), `src/store/slices/idleTickerSlice.ts` (modified, ~20 lines added)

This is the trickiest part. Today, no client code tracks per-shot ammo intervals. The chef says "Ammo Pack was used" but the client never decrements an Ammo Pack per shot.

**For this PR, we add a *display-only* interval tracker:** when a player loads an Ammo Pack, the active-buff store receives a 600000ms coverage window. The HUD shows "Ammo Pack covering 9:42 remaining" counting down. The client doesn't actually decrement the Ammo Pack on shot; the chef does that on the next boss attempt or activity settlement. The HUD is showing *intended coverage* based on the loaded state.

**Implementation:** a new module `ammoIntervalTracker.ts` reads the player's loadout, finds loaded ammo-interval consumables, and dispatches `ActiveBuff` rows to the store whenever the loadout changes. The store already has the data; we just need the wiring.

```ts
// src/lib/combat/ammoIntervalTracker.ts
import { CONSUMABLE_ACTIVATORS, resolveConsumableDuration } from '@/lib/buffs/activeBuffs';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';

/**
 * Sync loaded long-coverage consumables to the active-buff store.
 * Call this whenever the loadout changes (slot assignment).
 * 
 * Adds a coverage-window buff for each ammo-interval/activity-start
 * consumable in the loadout. Removes coverage buffs whose consumable
 * is no longer in the loadout.
 */
export function syncLoadoutCoverage(): void {
  const loadout = useLoadoutStore.getState().consumables;
  const activeStore = useActiveBuffsStore.getState();
  const now = Date.now();
  
  // For each slot, check if the consumable is a coverage-type and add a buff.
  Object.entries(loadout).forEach(([slot, consumableId]) => {
    if (!consumableId) return;
    const activator = CONSUMABLE_ACTIVATORS[consumableId];
    if (!activator || activator.durationSource !== 'registryCoverage') return;
    
    // Skip if already covered.
    const existing = activeStore.buffs.find((b) => b.consumableId === consumableId && b.source === 'ammo-tick');
    if (existing) return;
    
    const duration = resolveConsumableDuration(consumableId, 0);
    activeStore.add({
      id: `coverage:${consumableId}:${slot}:${now}`,
      consumableId,
      family: CONSUMABLES[consumableId].family,
      source: 'ammo-tick',
      sourceId: slot,
      startedAt: now,
      expiresAt: now + duration,
      durationMs: duration,
    });
  });
}
```

**Call site:** in `idleTickerSlice.ts` (or wherever the loadout changes are observed), add a subscriber that calls `syncLoadoutCoverage()` on slot changes.

**Test:** write a unit test for `syncLoadoutCoverage` covering add/remove cases.

### Task 6: ConsumableLedger "Active" section

**Files:** `src/components/stats/ConsumableLedger.tsx` (modified, ~80 lines added), `src/components/stats/__tests__/ConsumableLedger.test.tsx` (modified, +2 tests)

The current ledger has 3 rows (PreFight / MidFight / Emergency) plus an amber banner. We add an "Active" section at the top with:

- An empty state: "No active buffs." (when the store is empty)
- One row per active buff: consumable name, family-colored icon, countdown bar (proportional to `expiresAt - now / durationMs`), and remaining time in seconds (e.g. "5s")
- The pill row scrolls horizontally if there are >3 active buffs (rare but possible — boss attempts with 6+ consumables used)
- A `setInterval(1000)` in the component to update the countdown; also calls `remove(id)` on expired buffs

**Visual treatment:** keep the same `Record<ConsumableVisual['accent'], string>` pattern from the previous PR. Orange ≠ amber (we already fixed this in commit `9b7e5c3`).

**Update the amber banner:** remove the "Future PR will add live timer pills here" line. Replace with a tighter description: "Loaded slots below. Active effects at the top — count down to expiry."

**TDD:** test the new "Active" section renders 0 rows when store is empty, N rows when N buffs are active, and a countdown bar appears. Test the empty-state text.

### Task 7: ConsumableRing re-order

**Files:** `src/components/stats/ConsumableRing.tsx` (modified, ~40 lines added), `src/test/ConsumableRing.test.tsx` (modified, +3 tests)

Today the ring shows one slice per *loaded slot* (3 slices max). We extend to:

- **Active buffs** get a slice each (no slot limit). If a player has 3 loaded Ammo Packs and a Med Kit fires, the ring shows 4 slices.
- **Loaded slots** that are *not* active get a slice each (existing behavior).
- **Empty slots** (loaded=null) get no slice.

Visual:
- Active slices have a glow/pulse treatment (CSS `animate-pulse` like the source-breakdown modal's consumable bucket).
- Active slices use the same family color but with a brighter border.

**TDD:** test that an active buff adds a slice, an empty slot does not, and the active count can exceed the loaded count.

### Task 8: Source-breakdown modal's `consumable` bucket

**Files:** `src/components/stats/CharacterStatBar.tsx` (modified, ~30 lines added), `src/lib/stats/characterStats.ts` (modified, 1 line), `src/test/sourceBreakdownBuckets.test.tsx` (modified, +2 tests)

The `consumable` bucket of the source breakdown modal is declared and tested but always empty. We populate it from `useActiveBuffsStore.getActiveForBucket()`.

The existing `SourceRow` component handles the bucketed layout. We just need to:

1. Subscribe the `CharacterStatBar` to `useActiveBuffsStore` (selector-style: `useActiveBuffsStore((s) => s.buffs)`).
2. For each active buff, generate a `MechanicsContribution` row with:
   - `bucket: 'consumable'`
   - `source: <consumable name>`
   - `value: <defaultValue from activator>`
   - `display: '<value formatted>'`
   - `detail: '<consumable shortDescription>'`
3. Pass these to the `consumable` bucket of the `SourceRow` component.

**Important constraint:** the chef's actual game-math is already applied during the attempt. The HUD is showing the *contribution* of the active buff, but the math is server-authoritative. We add a comment in the code: "These rows are display-only; the actual modifiers were applied by the chef during the attempt."

**TDD:** test that an active buff produces a `consumable`-bucket row in the source breakdown. Test that the row uses the amber/transient styling.

### Task 9: Boss-attempt-result adapter (the integration glue)

**Files:** `src/lib/chef/bossResultAdapter.ts` (new, ~60 lines), `src/test/bossResultAdapter.test.ts` (new, ~50 lines)

A small adapter module that takes a `BossAttemptChefResult` and:
1. Iterates `consumedConsumables`
2. For each, expands to one or more `ActiveBuff` rows (using `ConsumableActivator`)
3. Dispatches to `useActiveBuffsStore.add()`
4. Dispatches `'consumable-fired'` events to `useTickFeedStore`

**Why a separate module:** the `idleTickerSlice` already has a `verifyBoss` handler that's hard to test in isolation. A pure-function adapter is easy to unit-test.

**TDD:** write the test first, then implement.

### Task 10: Activity-result adapter (crafting/repair/scrap)

**Files:** `src/lib/activity/activityResultAdapter.ts` (new, ~40 lines), `src/test/activityResultAdapter.test.ts` (new, ~30 lines)

Same pattern as Task 9 but for crafting/repair/scrap outcomes. The current `useActivityStore` has start/clear methods; we add a `completeActivity(consumablesUsed: string[])` method that the activity results can call.

**Scope:** 3 consumables use this path — Salvage Contract (scrapping), Workshop Rush Ticket (crafting/repair), and the 2 activityStart consumables (Loot Beacon, Signal Scrambler) for their *first-window* emit.

**TDD:** test the adapter dispatches the right `ActiveBuff` rows for each consumable.

### Task 11: Tests, verification, docs, PR

**Files:** all the tests above + `docs/plans/20260616-active-buff-implementation-summary.md` (new) + `references/active-buff-tracker.md` (new, in `cybercache-dev` skill) + `src/lib/buffs/activeBuffs.ts` (with full TSDoc).

**Verification suite:**
```bash
cd /data/cybercache
npx tsc --noEmit                                    # clean
npx vitest run                                       # all tests pass (expecting ~700, was 667)
npx eslint .                                         # 0 new errors (pre-existing 22 are NOT in scope for this PR — separate hotfix)
npx vite build                                       # exit 0
bash scripts/guard-architecture.sh                   # 0 violations
```

**Visual smoke test on prod** (after PR merges):
1. Start a roaming combat. Load Med Kit. Get hit below 50% HP. Med Kit auto-eats. Active section in ledger shows "Med Kit" with countdown (0s if no high-Q, 9s if quality ≥ 125). Ring shows 1 active slice.
2. Load Ammo Pack. Start a roaming combat. Active section shows "Ammo Pack" with a 10-min countdown. Ring shows 1 active slice. Reload the page — countdown resets (ephemeral state, not persisted; consistent with design).
3. Open the source breakdown modal. The `consumable` bucket now has rows for any active buffs. Amber pulse treatment.
4. Boss attempt: load Magnetized Payload, fight a boss. Active section shows "Magnetized Payload" briefly (no duration, just a "consumed" toast). Source breakdown shows the contribution.

**PR title:** `feat(hud): active consumable buff tracker (all 29, chef-integrated)`

**PR body outline:**
- 11 tasks, 11 commits (one per task)
- ~20 files changed, +2000/-100 lines
- The chef-side changes are scoped to 1 file (chef.ts) and 1 call site
- The auto-eat priority change (Nano Swarm > Med Kit > Adrenaline Shot) is called out in the body
- The 22 pre-existing lint errors are NOT addressed (separate hotfix)
- The PR is mergeable when CI is green; user reviews individually

---

## Sequence

| Task | Subagent | Files | Estimated calls |
|---|---|---|---|
| 1 | leaf | 2 new | ~30 |
| 2 | leaf (server-side awareness) | 3 modified | ~50 |
| 3 | leaf | 1 new + 1 modified | ~25 |
| 4 | leaf (extends existing auto-eat) | 1 modified + tests | ~40 |
| 5 | leaf (new tracker module) | 1 new + 1 modified | ~35 |
| 6 | leaf (UI work) | 1 modified + tests | ~50 |
| 7 | leaf (UI work, related to 6) | 1 modified + tests | ~30 |
| 8 | leaf (snapshot plumbing) | 2 modified + tests | ~40 |
| 9 | leaf (pure-function adapter) | 1 new + 1 modified | ~25 |
| 10 | leaf (similar to 9) | 1 new + 1 modified | ~25 |
| 11 | orchestrator (coordinator) | docs + PR | ~50 |

Total: ~10 leaf dispatches + 1 orchestrator = ~400 tool calls. Estimated 1-2 hours of work. Single PR with 11 commits, all reviewed together.

## Pitfalls (the things that will burn subagent iterations)

1. **The 3-place wiring trap.** Task 2 must update chef.ts, chefClient.ts, AND idleTickerSlice.ts in a single dispatch. If the subagent updates only 2 of 3, the field is invisible. Verification: after Task 2, `grep -n "activeBuffs" src/server/chef.ts src/lib/chef/chefClient.ts src/store/slices/idleTickerSlice.ts` should show 3 hits minimum.

2. **`decideAutoEat` priority change is a behavior change.** Task 4 extends the auto-eat path. This is intentional, but the user should know. The subagent must call this out in the commit message body and the PR description.

3. **Coverage windows are display-only, not actual interval ticking.** Task 5's `ammoIntervalTracker` doesn't actually decrement ammo on shot. It shows the loaded coverage window. The chef does the real decrementing. This is good enough for a first PR; subsequent PRs can wire chef-side tracking.

4. **Source breakdown's `consumable` bucket is display-only.** Task 8's contribution rows are not used by the snapshot's actual modifier computation. The chef has already applied the modifiers. We add a comment in the code so future readers don't think the rows affect gameplay.

5. **The auto-eat path runs once per threshold-cross.** Today it does. We must NOT make it run on every tick (that would burn through Med Kits instantly). The `decideAutoEat` function already handles this — it only fires when HP drops below threshold. We just need to preserve that behavior.

6. **Tests fail before implementing.** The subagent must follow the TDD pattern: write tests, verify they fail (with the right reason — "missing module" or "not implemented", not "syntax error"), then implement. The previous PR series established this pattern; the same subagent style works here.

7. **The skill's "delegation.max_iterations: 100" is bumped.** Tasks 1, 4, 6, 8, 11 are the most likely to hit 50+ calls. The previous bump to 100 is still in place; verify before dispatching.

8. **Pre-existing lint errors don't block this PR.** 22 errors in `SlotGearPicker.tsx`, `GearHub.tsx`, `ConsumablesScreen.tsx`, `MarketScreen.tsx`, `VendorScreen.tsx`, `WorkshopScreen.tsx` are out of scope. The subagent must NOT touch them. If the lint step fails on this PR with the same 22 errors, that's the same as `master` — the PR is no worse than master. The user said they'd review individually; the PR is mergeable.

---

## Out of scope (for follow-up PRs)

- **Per-tick chef simulation.** Today's `executeBossAttempt` is 1-shot. A per-tick model would let the chef emit per-buff timing precisely. Big refactor; future PR.
- **Offline-settlement retroactive buffs.** Buffs that would have fired during a 4-hour offline session don't fire today. A coordinated chef + client change is needed. Future PR.
- **Stacking rules.** What if two Med Kits fire in the same fight? The chef has a "first-wins" rule but the client doesn't model it. Future PR.
- **Cross-activity persistence.** If a player switches from boss to crafting mid-buff, does the buff continue? The chef's `inactive_continue` zeroBehavior suggests yes, but the client doesn't track. Future PR.
- **Buff extension on refresh.** When a Med Kit fires, does the high-Q perk refresh if the player heals more? The chef says no (consumable is consumed); the client should match. Already true by design (the buff is one-shot per use).

---

## Acceptance criteria

1. **Every consumable in the registry has a `ConsumableActivator` entry.** The `Record<ConsumableType, ConsumableActivator>` typing makes this a compile-time guarantee.
2. **The chef emits `activeBuffs` for boss attempts.** Verified by a chef unit test.
3. **The client receives and stores the buff list.** Verified by the boss-result-adapter test.
4. **The ledger's "Active" section renders the buffs with countdown bars.** Verified by the ledger test.
5. **The ring re-orders active > loaded > empty.** Verified by the ring test.
6. **The source breakdown's `consumable` bucket is no longer empty.** Verified by the breakdown test (with a buff active).
7. **The auto-eat path spawns an active buff for the 5 survival consumables.** Verified by the auto-eat test.
8. **Long-coverage consumables (Ammo Pack, Signal Scrambler, Loot Beacon, High-Capacity Ammo Pack) display a countdown from the registry's `durationSeconds`.** Verified by the coverage-tracker test.
9. **All existing tests still pass.** 667 → ~700 expected.
10. **`tsc --noEmit` is clean, `vite build` exits 0, `guard-architecture.sh` passes.**
11. **22 pre-existing lint errors are NOT introduced or fixed by this PR.** The diff is 0 in `SlotGearPicker.tsx`, `GearHub.tsx`, `ConsumablesScreen.tsx`, `MarketScreen.tsx`, `VendorScreen.tsx`, `WorkshopScreen.tsx`.
