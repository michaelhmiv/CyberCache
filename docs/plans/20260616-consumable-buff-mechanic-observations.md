# Consumable Buff Mechanic — Runtime Observations

> **Status:** Design input for a *future* `useActiveBuffsStore` PR. Not implementation.
> **Author:** HUD series, Task 9 (research). Companion to the Hunter Totals HUD PR.
> **Source of truth today:** `src/constants/consumables.ts` (declarative) and the Chef (server, runtime).
> **What this doc is NOT:** a fabricated list of behaviors. Everything in the *runtime* section is a hypothesis to verify; the *architecture* section is observable from the codebase.

---

## 1. Why this doc exists

The Hunter Totals HUD shows loaded consumable slots in the ring (`ConsumableRing`) and the ledger (`ConsumableLedger`). It does **not** show *active* buffs. Adding "active" requires:

1. A client-side store that knows which buffs are firing right now and for how long.
2. Server-pushed events that the client can subscribe to (chef → ticker → store).
3. A way to scope buff effects into the snapshot's `consumable` bucket (currently always empty — see `references/hunter-totals-hud.md` §"Out of scope").

None of those exist. Before designing them, we need to know what the chef *actually* does today. Idle games have edge cases (offline settlement, batched ticks, server-authoritative timing) that don't show up in the declarative `CONSUMABLES` registry. The risk of designing against the registry is that we'd implement the wrong contract.

**This document is the input to a planning conversation, not a spec.** Run the game. Watch what happens. Fill in the table in §3.

---

## 2. Architecture (observable from code today)

### 2.1 Consumable registry — declarative

`src/constants/consumables.ts`:

- 6 families: `survival` | `ammo` | `ordnance` | `tactical` | `economy` | `corrupted`
- 16 trigger types: `fightStart`, `shieldPhase`, `armorPhase`, `bossMechanic`, `survivalFailure`, `hpBelowThreshold`, `shieldBelowThreshold`, `activityStart`, `ammoInterval`, `craftStart`, `scrapStart`, `repairStart`, `victory`, `defeat`, `lootRoll`, `manual`
- 6 consume policies: `onAttempt` | `onTrigger` | `onVictory` | `onDefeat` | `ifUsed` | `perInterval`
- Each consumable has `effectRules` (a `ConsumableEffectRules` object) and `baseEffects` (`ConsumableRuntimeEffects`). The HUD reads `ledgerText` (human description), `visual.accent` (ring color), `visual.glyph`, and `visual.silhouette`.
- 4 quality-scaling modes: `none` | `flat` | `duration` | `chance` | `multiplierDelta` | `inverseMultiplierDelta`. The first letter suggests which effectRules field scales (`duration` → a `*DurationSeconds` field).

### 2.2 Loadout store — loaded slots, not active

`useLoadoutStore().consumables` is a `Record<ConsumableSlot, string | null>` (3 slots: `PreFight` | `MidFight` | `Emergency`). The HUD's ring and ledger read this. The store does **not** track active effects.

### 2.3 Snapshot → HUD — what the HUD could in theory see

`buildCharacterMechanicsSnapshot(input)` accepts a `consumableMods?: MechanicsScalar` parameter. The `consumable` bucket of the source breakdown is wired to read from this. **No caller passes it** (verified: `LiveTurfDiorama.tsx` constructs the snapshot without it). Adding in-flight buff tracking requires the producer side to be populated.

### 2.4 Tick feed — the client signal that already exists

`useTickFeedStore` fires events with `tone` (`'loot' | 'kill' | 'damage' | ...`) and `detail`. The HUD already subscribes to specific tones for visual effects (`LootParticles` on `kill`, `LegendaryDropFlash` on legendary). A buff-tracker can use the same pattern: subscribe to specific `detail` substrings or new event types.

### 2.5 Chef — opaque to the client today

The chef (`src/lib/chef/chef.ts` etc.) applies consumable effects on trigger. The client sees the *result* (a damage number, a heal popup, an XP gain) but not the *cause* (which consumable fired, with what duration, with what stack rules). To track active buffs, the chef either needs to emit per-buff events into the tick feed, or the snapshot needs a new `activeBuffs: BuffInstance[]` field that the chef populates alongside `consumableMods`.

---

## 3. Runtime observation template (to fill in)

**Run a session per family.** For each of the 6 families, slot at least one consumable and trigger its fire path. The matrix to fill in:

| Family | Consumable tested | Trigger | Visible client-side? | Duration (stopwatch) | Stacks w/ self? | Stacks w/ other family? | Persists across activity transition? | Persists offline-settlement? |
|---|---|---|---|---|---|---|---|---|
| `survival` | _(e.g. Med Kit)_ | `hpBelowThreshold` | | | | | | |
| `ammo` | | `ammoInterval` | | | | | | |
| `ordnance` | | `bossMechanic` | | | | | | |
| `tactical` | | `fightStart` | | | | | | |
| `economy` | | `lootRoll` | | | | | | |
| `corrupted` | | _(varies)_ | | | | | | |

**For each row, also capture:**
- Exact event in `useTickFeedStore` (label, detail, tone, any new fields)
- Whether the chef's response is *visible* (popup, number change) or *invisible* (DPS just went up)
- Whether the consumable's `effectRules` field of type `*DurationSeconds` is actually applied (registry says it exists; does code honor it?)
- Whether the `*Multiplier` fields are applied multiplicatively, additively, or in some specific order with the base `mechanicsSnapshot` computation
- Whether the buff is consumed (slot becomes empty) or kept (slot persists with reduced effect)

### 3.1 Specific hypotheses to verify

1. **`hpBelowThreshold` survival consumables** — slot is consumed on fire, but only the first time HP drops below threshold per fight. Reset between fights? Verified reset between activities? (This is the spec-vs-runtime gap that motivated the HUD work.)
2. **`ammoInterval` consumables** — fire every Nth shot. Does the interval count from the start of the fight, or per weapon, or per slot? Does the client see "this shot cost 0 ammo" or no signal at all?
3. **`fightStart` tactical consumables** — fire at the start of boss fight. The chef's `executeBossAttempt` already has a `tactical` slot reservation. Does the consumable consume on the boss-prep → boss-fight transition, or on the first damage tick?
4. **`lootRoll` economy consumables** — fire on each loot drop. Stack across drops? Or single-use with `*UsesRemaining`? The registry says `*Uses` exists; verify it's actually decremented client-visible.
5. **Stacking rules** — can two survival consumables both fire from HP threshold? Can an ordnance and a tactical both fire on `bossMechanic`? The chef likely has a `first-wins` rule; we need to know which order.
6. **Offline settlement** — do consumable triggers fire retroactively? The "20-tick foreground clamp" pitfall (see `references/offline-settlement-architecture.md`) likely means buffs that would fire during a long offline don't fire at all. This is the most likely "hidden bug" class.

### 3.2 Edge cases that are easy to miss

- **Boss prep → boss fight transition**: a `fightStart` consumable slotted but not fired in prep — does it fire when the fight actually starts, or get silently dropped?
- **Player dies mid-buff**: a survival consumable that grants +50% shield for 8 seconds. Player dies at second 3. Does the buff persist into the next fight, or reset?
- **Player switches activities mid-buff**: a tactical consumable that grants +20% crit for 14 seconds. Player starts a crafting action at second 6. Does the buff continue into the craft ticks, or vanish?
- **Two consumables of the same family**: slot `PreFight = Adrenaline Shot`, `MidFight = Adrenaline Shot+`. Both fire on `fightStart`. Does the second one override, stack, or both fire (and double the duration)?
- **Empty slot → load consumable mid-fight**: chef sees the slot change. Does it retro-apply, or only fire on the next trigger?

---

## 4. Design implications (preliminary, pending §3 data)

**If buffs are short-lived (≤10s) and never cross activity boundaries:** a `useActiveBuffsStore` with `{ id, source, family, expiresAt }` rows is enough. Subscribe via tick-feed events with TTL cleanup. The ring and ledger can re-order slots by `expiresAt` ascending.

**If buffs cross activity boundaries:** the store needs a "follow current activity" mode that hides buffs from the previous activity's bucket. This is the same UX as the headline chip rotation — and likely uses the same `overrideActivity` mechanic the HUD already has.

**If buffs stack:** the ring can't show "1 of 3 slots active" — it has to show "N buffs active" with a count, or the segment count goes above the loaded-slot count. This is a UI change to `ConsumableRing`, not just a data change.

**If buffs are mostly invisible client-side (the §3 hypothesis):** the entire tracker is a *speculation* surface. The data we have is the snapshot's effect deltas. We can derive "a buff is active" by diffing the snapshot against the no-buff baseline, but we can't tell *which* consumable. This is the worst case — the buff ring becomes a "your stats are different from baseline, go check the ledger" indicator.

**If offline settlement doesn't honor buffs:** the doc becomes a "what we know" list with explicit gaps. The future PR scopes "online-only" tracking and treats offline buffs as out-of-scope until a coordinated fix.

---

## 5. Suggested research sessions (one per family)

For each, write down the timer reading and a screenshot of the tick feed. The goal isn't to test every consumable — it's to map the *family's* behavior. Per family, one consumable is enough; two if they have very different triggers (e.g. survival has both `hpBelowThreshold` and `shieldBelowThreshold` consumables).

Estimated total session time: 90 minutes for a thorough pass. Truncatable to 30 minutes if you only cover the 3 most common families (`survival`, `ammo`, `tactical`) and skip the edge cases in §3.2.

---

## 6. Hand-off to the next PR

Once §3 is filled in, the next PR (post-merge of this HUD series) should:

1. Define the `BuffInstance` type (or equivalent) based on what the chef actually emits.
2. Add the producer side: chef populates `consumableMods` and (optionally) a new `activeBuffs` field on the snapshot/claim result.
3. Add the consumer side: `useActiveBuffsStore` (Zustand slice, ephemeral — not persisted) with TTL cleanup.
4. Extend the HUD: ring re-orders by `expiresAt`, ledger shows "active" rows for active buffs, source breakdown's `consumable` bucket populates.
5. Update `references/hunter-totals-hud.md` §"Future extension point" with the actual contract (no more "future PR will figure this out").

**Out of scope for that PR (call out explicitly):** offline settlement retroactive buffs (separate, server-side). Cross-activity persistence (separate, requires chef + client coordination on the activity boundary event).

---

## Appendix A: Cheat sheet for the observation session

**Where to look in the running game:**
- Tick feed (bottom of the dashboard or action tab) — every consumable trigger should fire an event here
- `localStorage` → `cybercache-*` keys — the loadout and player stores are persisted
- DevTools → Application → IndexedDB → `cybercache` — the snapshot store if you want to inspect the raw mechanics data
- DevTools → Network — watch for the `cc_*` RPC calls; the chef's response includes the consumable mod deltas (if any)

**Useful DevTools console snippets (paste and run):**
```js
// Dump current consumables
useLoadoutStore?.getState?.()?.consumables
// (if exposed) Inspect the latest tick feed event
useTickFeedStore?.getState?.()?.events?.slice(-5)
// (if exposed) Inspect the current snapshot's buckets
usePlayerStore?.getState?.()?.lastSnapshot?.buckets
```

If the stores aren't exposed globally, add a temporary `window.__CC_STORES__ = { useLoadoutStore, useTickFeedStore, usePlayerStore }` line in `src/main.tsx` for the duration of the session. **Remove before committing.**
