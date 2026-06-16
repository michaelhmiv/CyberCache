# Plan: Active Consumable Feedback Across CyberCache (all ConsumableType entries, display-only client tracker)

> **Status:** Revised plan, awaiting execution. No implementation started from this revision.
> **Date:** 2026-06-16
> **Companion docs:** `20260616-consumable-buff-mechanic-observations.md` (Task 9 research), `20260616-active-buff-per-consumable-trigger-map.md` (per-consumable trigger map), `20260616-active-buff-data-audit-and-recommendation.md` (data audit)
> **Scope:** Single PR. Cover every `ConsumableType` enum member across the site, including legacy `Grenade`, by adding a declarative activation registry, an ephemeral client display store, and UI surfaces for active/timed, armed/coverage, and instant consumable feedback.
> **Branch:** continue `feat/active-consumable-buffs` from current branch state.
> **Current state:** Task 1 data layer has already begun in commit `7147885 feat(hud): add ActiveBuff data model and ConsumableActivator registry`; verify and adapt rather than duplicating it.

---

## Goal

Make consumable behavior understandable everywhere the player makes or reviews consumable decisions:

1. **ConsumableLedger**
   - Add a top **Live Effects** section.
   - Timed active buffs show countdown pills and progress bars.
   - Armed/coverage consumables show a distinct “armed” treatment if we choose to show loaded coverage before actual consumption.
   - Instant consumables show recent-use feedback only if they have an explicit short visual TTL.
   - Existing loaded slots remain below as **Loaded Slots**.

2. **ConsumableRing**
   - Re-order slices by status: **active/timed > armed/coverage > loaded > empty**.
   - Active slices glow/pulse.
   - Armed coverage slices are visually distinct from fired active buffs so the HUD does not imply the item already triggered.

3. **Source Breakdown modal — `consumable` bucket**
   - Populate from display-only active consumable contributions.
   - Rows are transient and amber/pulsing.
   - Rows are explicit presentation metadata; they do **not** drive gameplay math.

4. **Tick feed / recent event feedback**
   - Every consumed/triggered consumable gets a visible event, including zero-duration consumables.
   - Current auto-eat paths must not silently consume zero-heal consumables.

5. **Consumable inventory / inspect / slotting screens**
   - Make trigger semantics visible enough that players understand whether a consumable is timed, instant, armed/coverage, activity-start, victory/defeat-gated, or legacy.
   - Do not add decorative filler text. Show decision-relevant mechanics: trigger, consume policy, duration/TTL, scope, and whether the effect is display-tracked.

---

## Core architecture decision

### Chosen model for this PR: client-derived display state from existing consumption signals

The chef remains authoritative for gameplay math and item consumption. The client derives display rows from existing signals:

- Boss result: `consumedConsumables: Record<string, number>`
- Roaming auto-eat: local `decideAutoEat` / survival ticker event
- Activity completion/start: crafting, repair, scrapping, and roaming coverage hooks
- Loaded slot state: optional “armed/coverage” display for long-window consumables

**Do not add a chef-emitted `activeBuffs` field in this PR.**

Rationale:

- Current chef boss simulation is one synchronous unit, not a per-tick simulation.
- `BossSimulationInput.consumables` is aggregate count data (`Record<string, number>`), not batch-quality-specific usage.
- High-quality durations depend on quality, but the boss request currently does not carry exact consumed batch quality.
- A chef-emitted `activeBuffs` field would look authoritative while still relying on approximations.

Therefore:

- **Chef authoritative for:** which consumables were consumed, boss attempt outcome, resource/item mutations, combat math.
- **Client display layer authoritative for:** countdown start time, visual TTL, UI categorization, and presentation rows.
- **Future PR:** if we add per-batch slot quality and/or per-tick chef simulation, the display store can switch to chef-provided rows without changing the UI surfaces.

---

## Terminology: timed active vs armed coverage vs instant event

The previous plan blurred these concepts. This revision separates them so all consumables can be represented honestly.

### 1. Timed active effect

A consumable with `durationMs > 0` after an actual trigger/consumption event.

Examples:

- High-quality Med Kit repair window
- Nano Swarm repair window
- Adrenaline Shot window
- Ammo Pack if a confirmed result says it fired and we choose to represent the coverage window

UI:

- Ledger countdown pill
- Ring active slice
- Source breakdown contribution while active
- Tick feed event

### 2. Armed / coverage display

A loaded long-window consumable that is ready to cover an activity window, but has not necessarily been consumed yet.

Examples:

- Ammo Pack loaded for roaming ammo interval
- High Capacity Ammo Pack loaded for roaming ammo interval
- Signal Scrambler / Loot Beacon loaded for roaming activity-start coverage

UI:

- Ledger “armed” row, not “active” row
- Ring armed slice, visually distinct from active pulse
- No gameplay contribution row unless actually triggered or we explicitly label it as armed/display-only

Important: if we add armed coverage, the copy must not say “firing now.” It should say “armed for next ammo interval / roaming window.”

### 3. Instant event

A consumed/triggered item with no meaningful active timer.

Examples:

- Magnetized Payload
- Ordnance Charge
- Boss Scanner
- Insurance Token
- many victory/defeat/phase consumables
- legacy `Grenade`

UI:

- Tick feed event
- Optional short “recently fired” visual TTL, e.g. 2500ms, if we want it to flash in ledger/ring.
- No countdown bar unless we explicitly assign `visualTtlMs`.

### 4. Legacy item

`ConsumableType.Grenade` remains in the enum for save compatibility. It must have an activator entry so `Record<ConsumableType, ConsumableActivator>` stays exhaustive, but UI copy should mark it legacy/not vendor-stocked if surfaced.

---

## Data model

Current file exists:

- `src/lib/buffs/activeBuffs.ts`
- `src/lib/buffs/__tests__/activeBuffs.test.ts`

Verify and adjust instead of recreating it.

### Required concepts

```ts
export type BuffDisplayState = 'active' | 'armed' | 'recent' | 'expired';

export interface ActiveBuff {
  id: string;
  consumableId: ConsumableType;
  family: ConsumableFamily;
  source: BuffSource;
  sourceId: string;
  startedAt: number;
  expiresAt: number;
  durationMs: number;
  /** Optional short TTL for instant/recent visual feedback. */
  visualTtlMs?: number;
  /** active = actually fired, armed = loaded/ready, recent = instant visual flash. */
  displayState: BuffDisplayState;
  /** Display-only value; chef/server remains authoritative for actual math. */
  value?: number;
  /** Batch quality if known; otherwise undefined and resolver uses fallback. */
  qualityPercent?: number;
  ticksFired?: number;
}
```

`BuffSource` should remain broad enough for all site paths:

```ts
export type BuffSource =
  | 'auto-eat'
  | 'boss-result'
  | 'activity-result'
  | 'loadout-armed'
  | 'roaming-coverage'
  | 'phase-trigger'
  | 'instant-event';
```

### Activator registry requirements

`CONSUMABLE_ACTIVATORS` must be typed as:

```ts
Record<ConsumableType, ConsumableActivator>
```

so every enum member is compile-time covered.

`ConsumableActivator` should include enough metadata to drive UI semantics, not just duration lookup:

```ts
export interface ConsumableActivator {
  durationSource: 'highQualityPerk' | 'registryRepair' | 'registryCoverage' | 'none';
  defaultDurationMs: number;
  defaultValue: number;
  defaultDisplayState: 'active' | 'armed' | 'recent';
  /** For durationSource='none', optional brief flash duration. */
  visualTtlMs?: number;
  source: BuffSource;
  /** Human-readable mechanic class for inventory/inspect/ledger copy. */
  mechanicKind:
    | 'survival-repair'
    | 'survival-boost'
    | 'ammo-coverage'
    | 'phase-break'
    | 'boss-prep'
    | 'boss-mechanic'
    | 'economy-outcome'
    | 'activity-start'
    | 'legacy-instant';
}
```

### Duration resolution constraints

`resolveConsumableDuration(consumableId, qualityPercent)`:

- `highQualityPerk`: read `runtime.highQualityPerks[]` and use the highest matched `repairDurationSeconds`.
- `registryRepair`: read `runtime.baseEffects.repairDurationSeconds`; fall back to `defaultDurationMs` only for display.
- `registryCoverage`: read `runtime.activityRules.roaming.durationSeconds`, or boss/activity-specific rule where appropriate.
- `none`: return 0.

Quality caveat:

- If batch quality is unknown, resolver uses vendor/default quality (currently 100) or the activator fallback.
- UI copy must not imply high-quality duration is exact unless `qualityPercent` is known.

---

## Store design

New file:

- `src/store/slices/activeBuffsSlice.ts`

Do **not** persist this store. It is presentation state like the tick feed.

Required API:

```ts
interface ActiveBuffsState {
  buffs: ActiveBuff[];
  add: (buff: ActiveBuff) => void;
  upsert: (buff: ActiveBuff) => void;
  remove: (id: string) => void;
  clear: () => void;
  pruneExpired: (now?: number) => void;
  getVisible: (now?: number) => ActiveBuff[];
  getActive: (now?: number) => ActiveBuff[];
  getArmed: (now?: number) => ActiveBuff[];
  getRecent: (now?: number) => ActiveBuff[];
}
```

Rules:

- UI components should not rely on raw `buffs` without filtering expired rows.
- Avoid Zustand selectors that allocate arrays inline, e.g. do not use `useActiveBuffsStore((s) => s.getVisible())` directly in render.
- Subscribe to `buffs`, then filter with `useMemo`, or use stable primitive selectors.
- `pruneExpired()` should be called by a small hook or by each consumer interval; cleanup must not depend only on opening the ledger.

---

## Tick feed integration

Add a new tone only if all render/test surfaces are updated together:

```ts
export type TickEventTone = ... | 'consumable';
```

Prefer `consumable` over `consumable-fired` because events may be armed, triggered, refunded, or instant.

Update all required places:

- `src/store/slices/tickSlice.ts`
- `src/test/tickFeedTones.test.ts`
- any tone-to-style maps in Dashboard / Action screens / diorama event rendering
- tests for a consumable event render

Every actual consumed/triggered consumable should produce a tick feed event, including zero-duration consumables.

---

## Site-wide UI responsibilities

### ConsumableLedger

File:

- `src/components/stats/ConsumableLedger.tsx`

Add sections:

1. **Live Effects**
   - timed active rows only
   - countdown text and progress bar
   - empty state: “No timed effects active.”

2. **Armed Windows**
   - loaded long-coverage items if armed display is enabled
   - copy like “armed for next roaming ammo interval”
   - no active countdown unless the window has actually started

3. **Recent Triggers**
   - optional rows for instant events within `visualTtlMs`
   - copy like “fired just now” instead of countdown

4. **Loaded Slots**
   - existing Pre-Fight / Mid-Fight / Emergency rows
   - remove stale “Future PR will add live timer pills here” copy

### ConsumableRing

File:

- `src/components/stats/ConsumableRing.tsx`

Render order:

1. active timed buffs
2. armed coverage windows
3. loaded slots not already represented
4. omit empty slots unless existing visual design requires placeholders

Rules:

- Multiple active buffs can exceed the number of loaded slots.
- Active glow/pulse only for actual active/recent rows, not merely loaded rows.
- Armed coverage uses a distinct border/dash/opacity treatment.

### Source Breakdown modal

Files:

- `src/components/stats/CharacterStatBar.tsx`
- new helper: `src/lib/stats/activeConsumableContribs.ts`
- tests in `src/test/sourceBreakdownBuckets.test.tsx`

Do not put Zustand logic into `characterStats.ts`.

Add a pure augmentation helper:

```ts
export function augmentSummaryWithActiveConsumables(
  summary: CharacterStatSummary,
  buffs: ActiveBuff[],
  now = Date.now(),
): CharacterStatSummary
```

`CharacterStatBar` should:

- subscribe to raw `buffs`
- memoize `summaryWithBuffs`
- render existing `SourceRow` grouped buckets

Contribution rules:

- Only timed active/recent triggered rows should populate the `consumable` bucket.
- Armed-but-not-triggered rows should either be omitted or clearly labeled as armed/display-only.
- Map consumables to relevant metrics instead of adding every buff to every stat.
- Include code comment: “Consumable contribution rows are display-only; chef/server math remains authoritative.”

### Consumable inspect / inventory / slotting surfaces

Files to audit during implementation:

- `src/components/consumables/ConsumableInspectSheet.tsx`
- `src/screens/ConsumablesScreen.tsx`
- slot/loadout UI that displays consumable mechanics

Add or verify decision-relevant fields:

- trigger
- consume policy
- scope: roaming / boss / crafting / repair / scrapping / market
- duration / visual TTL / instant
- active vs armed semantics
- zero behavior
- implementation status if approximated/legacy

Do not use decorative text. The player is deciding what to slot; show what will happen and when.

---

## Adapter strategy

### Boss result adapter

New file:

- `src/lib/chef/bossResultAdapter.ts`

Purpose:

1. Read `ChefVerifyBossResult.consumedConsumables` or `result.consumablesUsed`.
2. Expand each count into one display row using `CONSUMABLE_ACTIVATORS`.
3. Add timed/recent rows to `useActiveBuffsStore`.
4. Push `consumable` tick events to `useTickFeedStore`.

Important:

- Do **not** add `activeBuffs` to `src/server/chef.ts` in this PR.
- Do **not** double-expand if a future field appears. The adapter should have one source of truth.
- If quality is unknown, pass `undefined` or default quality and mark display duration as approximate where visible.

### Auto-eat adapter

Files:

- `src/store/slices/idleTickerSlice.ts`
- `src/lib/combat/damageContract.ts`
- tests in `src/test/damageContract.test.ts` and idle ticker tests

Current reality to preserve/audit:

```ts
AUTO_EAT_PRIORITY = ['MedKit', 'ShieldCell', 'NanoSwarm', 'AdrenalineShot']
```

Current gaps:

- `MedKitRefined` is not in the priority list.
- `NanoSwarm` and `AdrenalineShot` have `computeHealAmount() === 0`.
- Zero-heal auto-eat can be consumed without a visible heal event if not handled explicitly.

Implementation decisions required before coding:

1. Should `MedKitRefined` be auto-eat? If yes, where in priority and what heal amount?
2. Should `NanoSwarm` and `AdrenalineShot` auto-trigger from HP threshold despite no direct heal?
3. What is the intended priority order?

Recommended default for this plan:

- `MedKitRefined` should be included before basic `MedKit` if it is a stronger medkit.
- Zero-heal survival items should create explicit consumable tick events even if they do not call `heal()`.
- Do not change NanoSwarm/AdrenalineShot priority without calling it out in PR body.

### Armed coverage / loadout adapter

New file if we keep armed coverage:

- `src/lib/combat/consumableCoverageTracker.ts`

Purpose:

- Watch loaded consumables.
- Add/update `displayState: 'armed'` rows for long-coverage consumables.
- Remove armed rows when unloaded.

Rules:

- Armed rows are not active buffs.
- They should not say the consumable was consumed.
- If actual consumption later arrives from boss/activity result, the adapter should promote/add an active/recent row rather than mutating semantics ambiguously.

### Activity result adapter

New file:

- `src/lib/activity/activityResultAdapter.ts`

Purpose:

- Convert crafting/repair/scrapping/roaming activity consumable usage into display rows and tick events.
- Cover:
  - Salvage Contract
  - Workshop Rush Ticket
  - Loot Beacon
  - Signal Scrambler
  - any future activity-scoped consumable from registry metadata

Do not invent gameplay-side consumption in this adapter. It should respond to existing activity result signals or explicit start hooks.

---

## Tasks

### Task 1: Reconcile existing ActiveBuff data layer

**Files:**

- `src/lib/buffs/activeBuffs.ts`
- `src/lib/buffs/__tests__/activeBuffs.test.ts`

**Work:**

- Keep current exhaustive `Record<ConsumableType, ConsumableActivator>` approach.
- Add/verify `displayState`, `visualTtlMs`, `mechanicKind`, quality caveat support.
- Confirm every current enum member is covered, including legacy `Grenade`.
- Update tests for:
  - all duration source modes
  - `durationMs === 0` instant behavior
  - visual TTL behavior
  - long coverage behavior
  - legacy `Grenade`

**Verification:**

```bash
npx vitest run src/lib/buffs/__tests__/activeBuffs.test.ts
npx tsc --noEmit
```

---

### Task 2: Add `useActiveBuffsStore`

**Files:**

- `src/store/slices/activeBuffsSlice.ts`
- `src/store/index.ts`
- `src/store/slices/__tests__` or nearest test location

**Work:**

- Non-persisted Zustand store.
- Add `add`, `upsert`, `remove`, `clear`, `pruneExpired`, `getVisible`, `getActive`, `getArmed`, `getRecent`.
- Tests for expiry behavior and no stale visible rows.

**Pitfall:** do not make cleanup depend only on the ledger being mounted.

---

### Task 3: Tick feed tone and event rendering

**Files:**

- `src/store/slices/tickSlice.ts`
- `src/test/tickFeedTones.test.ts`
- Dashboard/action/diorama tick feed render sites

**Work:**

- Add `consumable` tone.
- Update all tone maps.
- Add rendering tests.

**Verification:**

```bash
npx vitest run src/test/tickFeedTones.test.ts
```

---

### Task 4: Boss result adapter, client-derived only

**Files:**

- `src/lib/chef/bossResultAdapter.ts`
- `src/test/bossResultAdapter.test.ts`
- `src/store/slices/idleTickerSlice.ts` or boss verify call site

**Work:**

- Expand `consumedConsumables` into display rows.
- Push rows into `useActiveBuffsStore`.
- Push `consumable` tick events.
- Treat zero-duration consumables as recent/instant events with optional visual TTL.

**Explicit non-work:**

- Do not edit `src/server/chef.ts` to add `activeBuffs`.
- Do not add `ChefVerifyBossResult.activeBuffs`.

---

### Task 5: Auto-eat audit and adapter

**Files:**

- `src/lib/combat/damageContract.ts`
- `src/store/slices/idleTickerSlice.ts`
- `src/test/damageContract.test.ts`
- `src/test/idleTickerSurvival.test.ts`

**Work:**

- Audit current priority and behavior.
- Decide and test `MedKitRefined` behavior.
- Ensure zero-heal auto-eat items create visible events.
- Spawn active/recent display rows after consumption.
- Preserve “do not consume every tick” behavior.

**PR body must call out:** any priority or behavior change.

---

### Task 6: Armed coverage tracker for loaded long-window consumables

**Files:**

- `src/lib/combat/consumableCoverageTracker.ts`
- loadout slot change call site
- tests for add/remove/promote behavior

**Work:**

- Add armed rows for long-coverage items when loaded.
- Remove rows when unloaded.
- Do not call armed rows “active.”
- Do not imply consumption.

**Decision checkpoint:** if this feels too confusing, skip armed rows in this PR and only show loaded-slot metadata.

---

### Task 7: ConsumableLedger live sections

**Files:**

- `src/components/stats/ConsumableLedger.tsx`
- `src/test/ConsumableLedger.test.tsx`

**Work:**

- Add Live Effects, Armed Windows, Recent Triggers, Loaded Slots sections.
- Add countdown/progress bars for timed active rows.
- Add distinct styling for armed vs active vs recent.
- Remove stale future-PR banner.

**Tests:**

- empty active state
- active timed row
- armed coverage row
- recent instant row
- loaded slots still render
- expired rows do not render

---

### Task 8: ConsumableRing status ordering

**Files:**

- `src/components/stats/ConsumableRing.tsx`
- `src/test/ConsumableRing.test.tsx`

**Work:**

- Render active > armed > loaded.
- Active count can exceed loaded slots.
- Empty slots do not create misleading slices unless required by existing design.

**Tests:**

- active row adds slice
- armed row uses armed treatment
- loaded row omitted if already represented active/armed
- active count can exceed loaded count

---

### Task 9: Source breakdown consumable bucket

**Files:**

- `src/lib/stats/activeConsumableContribs.ts`
- `src/components/stats/CharacterStatBar.tsx`
- `src/test/sourceBreakdownBuckets.test.tsx`

**Work:**

- Add pure `augmentSummaryWithActiveConsumables()` helper.
- CharacterStatBar subscribes to buffs and memoizes augmented summary.
- Add display-only consumable rows to relevant metric buckets.
- Do not mutate gameplay/stat math.

**Tests:**

- active buff adds consumable bucket row
- row has transient styling
- armed-only row does not masquerade as active contribution unless explicitly labeled
- expired row omitted

---

### Task 10: Consumable inspect / inventory / slotting metadata

**Files:**

- `src/components/consumables/ConsumableInspectSheet.tsx`
- `src/screens/ConsumablesScreen.tsx`
- relevant slot/loadout UI tests

**Work:**

- Show trigger, consume policy, scope, duration/instant/armed behavior.
- For quality-dependent duration, show exact duration only when quality known; otherwise show base/default behavior.
- Mark legacy/approximated statuses accurately.

**Decision framing:** help the user answer “what should I slot for this activity?”

---

### Task 11: Activity result adapter

**Files:**

- `src/lib/activity/activityResultAdapter.ts`
- activity store/call sites
- tests

**Work:**

- Add display rows/tick events for activity-scoped consumables when existing activity signals indicate use.
- Cover Salvage Contract, Workshop Rush Ticket, Loot Beacon, Signal Scrambler, and future registry-driven activity entries.

---

### Task 12: Verification, docs, PR

**Files:**

- tests above
- `docs/plans/20260616-active-buff-implementation-summary.md`

**Do not include Hermes skill reference edits in the repo PR.** If the implementation produces durable workflow knowledge, update the `cybercache-dev` skill separately after verification.

**Verification suite:**

```bash
cd /data/cybercache
npx tsc --noEmit
npx vitest run
npx eslint .
npx vite build
bash scripts/guard-architecture.sh
```

Lint note:

- If existing lint errors are still present on master, do not fix unrelated files in this PR.
- Document “no new lint errors” by comparing touched files or master baseline.

**PR title:**

```text
feat(hud): display active, armed, and instant consumable feedback
```

**PR body must call out:**

- Client-derived display model; no chef `activeBuffs` field yet.
- All `ConsumableType` enum members covered, including legacy `Grenade`.
- Quality caveat for aggregate consumable counts.
- Any auto-eat priority/behavior changes.
- Difference between active, armed, and instant/recent feedback.
- Existing lint baseline if applicable.

---

## Acceptance criteria

1. Every `ConsumableType` enum member has an activator entry, including legacy `Grenade`.
2. Timed active effects render in ledger, ring, and source breakdown while unexpired.
3. Instant zero-duration consumables produce visible tick feed events and optional recent visual flash; they do not silently disappear.
4. Armed/coverage consumables are visually distinct from active fired buffs.
5. Boss-result consumable display is derived client-side from existing `consumedConsumables`; no chef `activeBuffs` field is added in this PR.
6. Auto-eat behavior is fully tested, including `MedKitRefined`, `NanoSwarm`, and `AdrenalineShot` decisions.
7. Source breakdown consumable bucket is populated through a pure summary augmentation helper and remains display-only.
8. Consumable inspect/inventory/slotting screens show trigger, policy, scope, and duration/instant semantics.
9. Zustand selectors avoid allocation-instability patterns.
10. `npx tsc --noEmit` passes.
11. Relevant focused tests pass, then full `npx vitest run` passes.
12. Build and architecture guard pass.
13. PR body documents caveats and any behavior changes.

---

## Out of scope / follow-up PRs

- Chef-emitted authoritative `activeBuffs` rows.
- Per-tick boss simulation.
- Exact batch-quality-aware consumed buff durations for boss attempts.
- Offline-settlement retroactive buff reconstruction.
- Cross-refresh buff persistence.
- Stacking/refresh rules beyond current display dedupe.
- Server-side coverage-window state for Ammo Pack / Signal Scrambler / Loot Beacon.
