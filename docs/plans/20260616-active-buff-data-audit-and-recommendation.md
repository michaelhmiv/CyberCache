# Active Consumable Buffs — Data Audit + Design Recommendations

> **Companion to:** `docs/plans/20260616-consumable-buff-mechanic-observations.md` (Task 9 research doc)
> **Date:** 2026-06-16 (post-HUD-PR)
> **Question this answers:** "How did we agree to show stuff like consumables that are used in bursts?" — short answer: we didn't, and the codebase is more underdeveloped than the docs imply.

---

## Part 1: The 12 consumables with time-bounded effects (real data)

From `src/constants/consumables.ts`, 12 consumables declare either `repairDurationSeconds` (high-quality perk duration) or `durationSeconds` (per-interval coverage window):

| # | Name | Family | Trigger | Repair(s) | Coverage | Notes |
|---|---|---|---|---|---|---|
| 1 | Med Kit | survival | hpBelowThreshold | 9s | — | High-Q perk: overheal→regen |
| 2 | Med Kit (Refined) | survival | hpBelowThreshold | 12s | — | High-Q perk: DoT cleanse |
| 3 | Shield Cell | survival | shieldBelowThreshold | 15s | — | High-Q perk: recharge accel |
| 4 | Nano Swarm | survival | hpBelowThreshold | 30s (FULL) | — | Has `repairTotalHp` DoT effect |
| 5 | Adrenaline Shot | survival | hpBelowThreshold | 20s (FULL) | — | +dpsMultiplier: 1.1, +fatigueDamagePct: 0.05 |
| 6 | Ammo Pack | ammo | ammoInterval | FULL | 600s | Consumed per shot interval |
| 7 | High-Capacity Ammo Pack | ammo | ammoInterval | FULL | 1200s | Same, longer |
| 8 | Incendiary Ammo | ammo | activityStart | 6s | — | High-Q: 6s burn persistence |
| 9 | Corrosive Amo | ammo | armorPhase | 10s | — | High-Q perk: 10s suppression extension |
| 10 | Corrosive Charge | ordnance | armorPhase | 8s | — | High-Q: armor-break persists 8s |
| 11 | Signal Scrambler | tactical | activityStart | FULL | 600s | Per-interval coverage |
| 12 | Loot Beacon | economy | activityStart | FULL | 600s | Per-interval coverage |

**Distribution:** 5 are <30s bursts (the "high-Q perk" DoT/repair effects). 4 are long coverage windows (600-1200s = 10-20 min). 3 are "FULL_DURATION" placeholders (resolved at runtime by the chef).

**Categorization for the UI:**
- **Burst buffs** (5): Med Kit, Med Kit (Refined), Shield Cell, Nano Swarm, Adrenaline Shot — these are the "consumables used in bursts" your question is about. All survival, all sub-30s, all fire on HP/shield threshold or fight start. The high-quality perk adds a follow-up DoT/repair/regen effect.
- **Long coverage** (4): Ammo Pack, High-Capacity Ammo Pack, Signal Scrambler, Loot Beacon — these are "loaded for the activity" rather than burst-fired. Duration 600-1200s. Player should see "this is covering your next 10 minutes" rather than "this fired for 8 seconds."
- **Phase-triggered DoT/break** (3): Incendiary Ammo, Corrosive Ammo, Corrosive Charge — fire on phase transitions (armorPhase, shieldPhase, activityStart) and apply 6-10s debuffs to enemies.

---

## Part 2: What's actually wired up today (the honest answer)

I checked every reference to `repairDurationSeconds` and `durationSeconds` in `src/`. **Zero hits outside the registry itself.**

```
$ grep -rn "repairDurationSeconds\|durationSeconds" src/lib/ src/server/ src/store/ src/components/
(empty)
```

That means:

- **The chef doesn't apply durations.** The boss simulator (`src/lib/simulation/bossSimulator.ts:298-316` `getBossConsumableUsage`) decides *was this consumable consumed* but never *for how long its effect persisted*.
- **The client ticker doesn't apply durations either.** It only auto-triggers Med Kit / Shield Cell on HP/shield threshold (one-shot heals, no follow-up regen from the high-Q perk).
- **The HUD/ring/ledger doesn't show them.** The shipped ConsumableRing/ConsumableLedger only display the *loaded slot* state.
- **The 4 `ammoInterval` / `activityStart` consumables aren't wired anywhere.** Ammo Pack, High-Capacity Ammo Pack, Signal Scrambler, Loot Beacon declare a 600-1200s window but no code path consumes that window.

**Translation:** the "burst" effect system the user asked about is *declared* in the consumable registry but not yet *implemented* in the chef, the ticker, or the HUD. The 12 consumables with durations are aspirational design content — they're waiting for someone to wire them up.

### The one piece of plumbing that exists

`useTickFeedStore` already has a `'heal'` event tone. The client ticker emits it when Med Kit / Shield Cell auto-trigger (`idleTickerSlice.ts:276, 287, 536`). The tone is consumed by the World Pulse Feed (toast popups) and nothing else.

```ts
// src/store/slices/tickSlice.ts:5
export type TickEventTone = 'xp' | 'loot' | 'cash' | 'cache' | 'level' | 'kill' | 'material' | 'essence' | 'fragment' | 'damage' | 'heal' | 'death';
```

So a `'heal'` event has: `tone`, `label` (e.g. "Med Kit"), `detail` (e.g. "Auto-ate a Med Kit (+150 HP)."), `value` (heal amount), `areaId`, `at`. **No `effectId`, no `expiresAt`, no `repairDurationSeconds`** — the event is a one-shot, not a duration.

---

## Part 3: The four possible shapes of "show active buffs"

The Task 9 research doc listed 4 design branches in §4. With the data above, here's how each maps to the actual consumable set:

### Branch A — "Loaded + Active" pill row (most pragmatic, narrowest scope)

**The HUD already has a `consumable` bucket in the source breakdown that's always empty.** The cheapest move: when a consumable with `repairDurationSeconds` fires, the client receives a `'heal'` (or new `'buffStart'`) event with the duration, adds it to a new `useActiveBuffsStore`, and the ledger shows a pill row at the top:

```
[ACTIVE BUFFS]
┌──────────────────────────────────────┐
│ 🟢 Med Kit          ████████░░  5s   │ ← 9s repairDuration, 4s left
│ 🔵 Shield Cell      ██████████  12s  │ ← 15s, 3s left (HIGH-Q)
└──────────────────────────────────────┘
[LOADED SLOTS]
Pre-Fight  [Empty / tap to load]
Mid-Fight  [Empty / tap to load]
Emergency  [Empty / tap to load]
```

**Pros:** Doesn't change the ring (still "loaded only"). Buffs show as transient pills that count down. The amber banner in the current ledger becomes a header for the active section.

**Cons:** Only covers the 5 burst buffs and the 3 phase-trigger DoT effects. The 4 long-coverage consumables (Ammo Pack etc.) still have no UI — they'd need a "remaining time" treatment, not a "seconds left" countdown.

### Branch B — Reuse the ring (ring "goes active")

The ring shows 3 slices (one per loaded slot). When a consumable is *active*, the slice changes from "loaded" state to "active + countdown" state. Color shifts (e.g. red→green = active). Click still opens the ledger.

**Pros:** Reuses existing affordance. Player doesn't need to learn a new pattern.

**Cons:** Ring becomes visually busy when a slot is loaded AND active. Click ambiguity (loaded + active both want to open the ledger, but the player might want to see the countdown). The 4 long-coverage consumables (10-20 min windows) don't fit the "ring slice" model at all.

### Branch C — Separate "Buffs" tab on the consumable ledger

The ledger gets a tab switcher: `[Loaded] [Active]`. Active tab shows the time-bounded effects in a list with countdown bars.

**Pros:** Clean separation. Loaded and active have different semantics anyway (loaded = "what's in my bag," active = "what's firing right now"). Doesn't fight the ring for space.

**Cons:** Tab discovery — most players won't think to switch tabs. The active state is more *urgent* than loaded; hiding it behind a tab is the wrong priority order.

### Branch D — Inline in the top of the diorama (the "what's buffing my stats right now" surface)

Above the chip bar (or as a 5th chip), a thin "ACTIVE" row that shows the highest-impact active buff's name + remaining time. Like the existing "XP CHALK MARK" widget already in the diorama.

**Pros:** Highest visibility. Player sees the buff while watching combat.

**Cons:** Only one buff can show at a time (the highest-impact one). Lower-impact buffs (e.g. Signal Scrambler) wouldn't surface. Doesn't replace the ledger.

---

## Part 4: My recommendation

**Branch A (loaded + active pill row) + add `'buffStart'` / `'buffEnd'` tick tones + new `useActiveBuffsStore`.**

### Why A, not B/C/D

1. **The data shape demands it.** Burst buffs (5 of the 12) are sub-30s, high-Q perk DoT effects. Long-coverage consumables (4) are 10-20 min windows. Phase-triggered DoT (3) are 6-10s. **No single visual treatment fits all three.** A pill row that varies by `expiresAt - now` (a countdown bar that scales with duration) covers all three naturally — short bursts = quick pills, long coverage = wide pills, phase triggers = debuff icons.

2. **The ring is sacred.** It's the *loaded slot state* — the "what's in my bag" affordance. Mixing active into it breaks the one-click-one-destination rule we just established in the HUD PR (`hunter-totals-hud.md` §"Click affordance map": *one click target = one expand destination*). A separate "Active" section in the ledger preserves that rule.

3. **The chef integration is incremental.** We can ship the buff pill row first, then wire up the chef push later. The store starts empty; the ledger section starts as "No active buffs." Once the chef starts emitting `buffStart`/`buffEnd` events, the pills appear. No coordination required.

4. **It composes with the existing `consumable` bucket.** When the snapshot's `consumable` bucket finally gets populated (a future PR wires `consumableMods`), the source breakdown modal will show the active effects' contributions. The pill row in the ledger is the *summary*; the breakdown modal is the *detail*. Same pattern as the existing chip bar + source breakdown modal.

### Concrete plan

**Phase 1 (this PR, ship with lint cleanup + buff-tracker PR cycle):**
1. Add `'buffStart' | 'buffEnd'` to `TickEventTone` union in `src/store/slices/tickSlice.ts:5`
2. Create `src/store/slices/activeBuffsSlice.ts` — a Zustand slice with `{ id, consumableId, family, sourceTrigger, expiresAt, value? }` rows. NOT persisted (ephemeral, like a notification queue). 100 lines max.
3. Update `ConsumableLedger.tsx` to render an "Active" pill row at the top, before the loaded slots. Empty state: "No active buffs." Non-empty: count down via `setInterval` (1Hz) and remove when `expiresAt <= now`.
4. Add a test for the new ledger section. Update the amber banner to remove the "future PR will add live timer pills here" line (since this PR adds it).

**Phase 2 (separate PR, server-side):**
1. Modify the chef to emit `buffStart` events with the `repairDurationSeconds` from the registry.
2. Modify the client ticker to emit `buffStart` for Med Kit / Shield Cell high-Q perks (the only ones currently wired).
3. Don't touch `ammoInterval` or `activityStart` consumables in this phase — those need a different server-push architecture (interval-based, not trigger-based).

**Phase 3 (post-MVP, separate PR):**
1. Wire `ammoInterval` / `activityStart` consumables as "coverage windows" — the active buff store gets a `coverageWindow: { startsAt, endsAt }` variant that's not triggered by an event but tracked by the loadout itself.
2. Add the `consumable` bucket to the source breakdown modal (the deferred backend-coordination work).
3. Visualize long-coverage buffs as a different pill style (wider bar, "10:00 remaining" label).

### What this PR should NOT do

- **Don't wire the chef.** The chef changes are server-side and need their own PR cycle with the server-authority review. The client-side scaffold (store + ledger section + tests) ships independently.
- **Don't backfill the 7 unwired consumables.** Ammo Pack, High-Capacity Ammo Pack, Signal Scrambler, Loot Beacon, Incendiary Ammo, Corrosive Amo, Corrosive Charge have no client logic to observe yet. Adding "Active" pills for them would be aspirational UI showing "no active buffs" forever. Phase 2 / Phase 3 will wire them in turn.
- **Don't add a 5th chip to the diorama for active buffs.** Keep the chip bar as the *current stats* surface. Active buffs are a *state* surface, not a *stat* surface.

### The one-sentence version

**Add a non-persisted `useActiveBuffsStore` (Zustand slice), a new top-of-ledger "Active" pill row that counts down from `repairDurationSeconds`, and `'buffStart'`/`'buffEnd'` tick tones — ship client-side first, wire chef-side in a follow-up PR. Defer the 4 long-coverage consumables to Phase 3.**
