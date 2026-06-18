# Hunter Totals — Collapse `boss_prep` → `boss_fight` (delta plan)

> **Context.** The Hunter Totals HUD scope was scoped in the prior plan
> (`docs/plans/20260616-hunter-totals-rotating-chips-and-consumable-ring.md`).
> On discovery, **all 9 tasks of that plan are already implemented and
> green** — `CharacterStatBarBody`, `ActiveBuffPills`, `ConsumableRing`,
> `ConsumableLedger`, `useActiveBuffsStore`, the `ActiveBuff` type, the
> chef and activity adapters, and the bucketed source breakdown are all
> in `main` with 717 tests passing. Live buff timers are wired end-to-end
> (chef result → adapter → store → pill component).
>
> Two user decisions still require follow-up:
>
> 1. **Collapse `boss_prep` into `boss_fight`.** The two `ActivityKind`
>    values are conceptually one boss encounter; prep is a sub-state
>    (the window between picking a boss and clicking "Start Fight").
>    This delta plan implements that collapse.
> 2. **Live buff timers** are already done in the prior work (option B
>    from the prior scoping conversation is what shipped). No additional
>    work required.
>
> **Out of scope:** the consumable ring's pie-slice geometry, the
> bucketed source breakdown visual treatment, the active-buff data
> model, the chef → store delivery pipeline. All already shipped.

---

## Decision: one `ActivityKind`, two `bossPhase` values

`boss_prep` and `boss_fight` collapse into a single `ActivityKind: 'boss_fight'`.
The "currently in prep window" state lives on the activity's payload
as a new `bossPhase: 'prep' | 'fight'` discriminator, defaulting to
`'prep'`. The payload field is a sibling of `targetId`, `targetLabel`,
`activityPayload` (which is currently a free-form `Record<string,
unknown>` — adding a typed field there is the smallest-blast-radius
change and keeps `ActiveActivity` structurally compatible with the
existing serialised payloads on disk).

`startActivity` keeps a single `kind: 'boss_fight'` input; the
"start fight" action flips the same activity's `bossPhase` from
`'prep'` to `'fight'` via a new `setBossPhase` action on the
activity store (instead of starting a new activity).

The diorama mode mapping collapses `'bossPrep'` and `'bossFight'` into
one mode keyed off `activityKind === 'boss_fight'` with a sub-state
driven by `bossPhase`.

---

## Task 1: Type + label updates

**File:** `src/types/activity.ts`

- Remove `'boss_prep'` from the `ActivityKind` union.
- Remove the `PRODUCTIVE_ACTIVITY_LABELS` entry for `'boss_prep'`.
- Add to `ActiveActivity`:
  ```ts
  bossPhase: 'prep' | 'fight';
  ```
- Add to `IDLE_ACTIVITY`:
  ```ts
  bossPhase: 'prep',
  ```
- Add to `StartActivityInput`:
  ```ts
  bossPhase?: 'prep' | 'fight';
  ```
- Export:
  ```ts
  export const DEFAULT_BOSS_PHASE: 'prep' = 'prep';
  export function isBossPhase(value: unknown): value is 'prep' | 'fight' { ... }
  ```
- Add a `PRODUCTIVE_ACTIVITY_LABELS` entry update: `boss_fight: 'Boss fight'`
  (unchanged, but confirm no other entry moved).

**File:** `src/lib/hud/headlineMetrics.ts`

- Remove the `boss_prep` entry from `HEADLINE_METRIC_KEYS` (the prior
  PR already collapsed it to the same 4 chips as `boss_fight`:
  `boss / dps / shieldBreak / armorBreak`).
- `getHeadlineMetricKeys('boss_fight')` already returns the right set.

---

## Task 2: Activity store updates

**File:** `src/store/slices/activitySlice.ts` (path TBD — locate via grep)

- Add `setBossPhase(phase: 'prep' | 'fight')` action.
- `setActiveActivity` and any activity-start action accept and persist
  `bossPhase` (default `'prep'`).
- `getActiveActivity()` returns the activity with `bossPhase` populated
  (defensively back-fill `'prep'` when loading from old serialised state
  that lacks the field).

---

## Task 3: Builder updates

**File:** `src/lib/activity/activityBuilders.ts`

- `buildBossPrepActivity(...)` is removed. Add
  `buildBossFightActivity(target, weapon, phase: 'prep' | 'fight' = 'prep')`
  that returns the unified activity object with `kind: 'boss_fight'`
  and `bossPhase: phase`.
- Confirm `buildBossPrepActivity` is no longer referenced anywhere
  (grep `buildBossPrepActivity`). The prior grep of the codebase
  shows it's used in `BossPrepModal.tsx` and `ActionScreenContextual.tsx`
  — both will switch to `buildBossFightActivity(target, weapon, 'prep')`.

---

## Task 4: Boss prep modal update

**File:** `src/components/fight/BossPrepModal.tsx`

- Import `buildBossFightActivity` instead of `buildBossPrepActivity`.
- The modal's "Start Fight" button no longer calls
  `startAction(buildBossPrepActivity(...))` followed by a separate
  `startAction(buildBossFightActivity(...))` — it now:
  1. Starts the activity as `buildBossFightActivity(target, weapon, 'prep')`
     if no boss activity is active.
  2. Flips `setBossPhase('fight')` to commit.
- "Cancel prep" action calls `setBossPhase('prep')` on the active
  activity (does not cancel the activity itself — the user stays in
  prep until they confirm or pick a different boss).

---

## Task 5: Diorama mode collapse

**File:** `src/components/dashboard/LiveTurfDiorama.tsx`

- `DioramaMode` type: remove `'bossPrep'`. Add `bossPhase` reading
  from the activity payload via the activity store.
- `kindToMode` mapping: `boss_fight` no longer branches on phase —
  it returns the unified boss mode and reads `bossPhase` for
  per-phase visual deltas (backdrop, label, primary action).
- The `prep` and `fight` visual branches in the SVG layer collapse
  into one boss block with a `phase === 'prep' ? <PrepBackdrop /> : <FightBackdrop />`
  inner switch.
- `<BossHpOverlay active={...}>` switches from
  `kind === 'boss_fight' || kind === 'boss_prep'` to
  `kind === 'boss_fight' && bossPhase === 'fight'`.

---

## Task 6: Action screen — remove prep/fight dual-branch

**File:** `src/screens/ActionScreenContextual.tsx`

- Remove the `boss_prep` entry from `ACTION_WORKSPACE_SPECS` (the
  prior grep shows it's at line 84 with title `'Boss Prep'` and a
  `coreDecision` string). Reuse the `boss_fight` spec; the spec's
  `coreDecision` text should be updated to remove "Prep" wording.
- `currentKind === 'boss_prep'` references (lines 428, 466, 474, 649,
  700, 713, 717, 739) collapse to `currentKind === 'boss_fight' &&
  bossPhase === 'prep'`.
- "Start Fight" button (line 713) calls `setBossPhase('fight')` on
  the active activity instead of starting a new `boss_fight` activity.
- `makeRunEvent('BOSS PREP', ...)` (line 428) becomes
  `makeRunEvent('BOSS FIGHT', ...)` for the unified activity start.
- "Choose Boss" affordance (line 717) stays the same on prep; on
  fight it becomes disabled.

---

## Task 7: Animation director

**File:** `src/lib/activity/actionAnimationDirector.ts`

- Remove the `boss_prep` animation case if present. Boss animations
  key off `boss_fight` with `bossPhase` as a runtime sub-state.

---

## Task 8: Run events

**File:** `src/lib/run/runEvents.ts`

- The `'BOSS PREP'` event label (if present) becomes `'BOSS FIGHT'`
  with a `phase: 'prep' | 'fight'` field in the event payload.

---

## Task 9: Test updates

**Files:** all `.test.ts` and `.test.tsx` files that mention
`boss_prep`:

- `src/test/headlineMetrics.test.ts` line 6: drop `'boss_prep'`
  from the kinds array.
- `src/test/idleTickerBossFight.test.ts` (and any others): replace
  `kind: 'boss_prep'` literals with `kind: 'boss_fight', bossPhase: 'prep'`.

**Run:** `npx vitest run` — expect all 717 tests to still pass.

---

## Task 10: PR + docs

- Update `references/hunter-totals-hud.md` (per the prior plan) to
  remove references to `boss_prep`.
- Update `SKILL.md` trigger list: replace "boss prep" with "boss phase".
- Open a single PR with the title
  `refactor(activity): collapse boss_prep into boss_fight + bossPhase payload`.

---

## Acceptance criteria

- The `ActivityKind` union has no `boss_prep` member. Lint, build,
  `tsc --noEmit`, and `vitest run` are all green.
- The "Start Fight" button on the boss prep modal calls
  `setBossPhase('fight')` on the active activity — it does not
  start a new activity.
- `bossPhase` is preserved across the round-trip
  (UI → store → serialised state → store → UI) for any activity
  whose `kind === 'boss_fight'`. Old serialised state (no
  `bossPhase` field) back-fills to `'prep'`.
- The Hunter Totals HUD (`CharacterStatBarBody`) shows boss chips
  for the entire boss encounter (prep + fight), with no visible
  state change between phases.
- The diorama backdrop and primary-action label change between
  prep and fight phases (visual continuity for the existing UX).
- The `boss_prep` keyword is absent from `src/` after the change
  (grep returns nothing).
