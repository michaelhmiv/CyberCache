# Active Consumable Buffs — Full Per-Consumable Trigger Map

> **Companion to:** `docs/plans/20260616-consumable-buff-mechanic-observations.md` and `docs/plans/20260616-active-buff-data-audit-and-recommendation.md`
> **Source of truth:** `src/constants/consumables.ts` (29 consumables, 6 families, 16 trigger types)
> **Wire-up status:** verified by grepping `src/lib/`, `src/server/`, `src/store/`, `src/components/`

---

## How to read this

Every consumable has 4 trigger dimensions that determine **when** and **how often** it fires:

1. **`trigger`** — the *event* that activates the consumable (e.g. `hpBelowThreshold`, `fightStart`, `lootRoll`).
2. **`consumePolicy`** — what happens to the consumable after the trigger fires:
   - `onAttempt` — **consumed on the same tick as the attempt/fight start**, even before any combat.
   - `onTrigger` — **consumed only if the trigger condition is met** during the attempt (e.g. shield actually broke, armor actually took damage). If the condition never fires, the consumable is preserved.
   - `onVictory` / `onDefeat` — consumed at end of attempt based on outcome.
   - `ifUsed` — consumed only if the player's HP/shield actually needed healing (i.e. was below threshold AND there was a need).
   - `perInterval` — consumed at a fixed cadence (every Nth shot, every N minutes) rather than on a single event.
3. **`activeIn`** — which activities the consumable participates in (`roaming`, `boss`, `crafting`, `scrapping`, `repair`, `market`).
4. **`activityRules`** — per-activity overrides for `trigger`, `consumePolicy`, and `durationSeconds`. **The default is the global trigger; the override is per-activity.**

**The four per-consumable activation patterns:**

| Pattern | Trigger | Policy | Cadence | Example |
|---|---|---|---|---|
| **Once per attempt, at start** | `fightStart` | `onAttempt` | 1 | Magnetized Payload |
| **Conditional, mid-fight** | `armorPhase` / `shieldPhase` / `hpBelowThreshold` | `onTrigger` or `ifUsed` | 0..N | Med Kit, Corrosive Charge |
| **Cadence, per-interval** | `ammoInterval` / `activityStart` | `perInterval` | every Nth | Ammo Pack |
| **Post-event, on outcome** | `victory` / `defeat` / `lootRoll` | `onVictory` / `onDefeat` | 0..1 per attempt | Data Skimmer, Luck Booster |

---

## The 29 consumables, by family and trigger

### SURVIVAL (6) — slot: `emergency` — fires on HP/shield threshold

All active in: `roaming`, `boss`. All `ZeroBehavior: inactive_continue` (the activity continues even if the consumable count hits 0; the slot just stays empty).

| # | Consumable | Trigger | Policy | Threshold | Frequency | Status |
|---|---|---|---|---|---|---|
| 1 | **Med Kit** | `hpBelowThreshold` | `ifUsed` | 50% | once per threshold-cross | ✅ **WIRED** (idleTickerSlice:268) — auto-eats and emits `tone:'heal'` tick event. High-Q perk (9s regen) is **NOT** applied. |
| 2 | **Med Kit (Refined)** | `hpBelowThreshold` | `ifUsed` | 50% | once per threshold-cross | ⚠️ **Half-wired** — `decideAutoEat` selects it the same way as Med Kit, but the high-Q perk (12s DoT cleanse) is **NOT** applied. |
| 3 | **Shield Cell** | `shieldBelowThreshold` | `ifUsed` | 25% | once per threshold-cross | ✅ **WIRED** (idleTickerSlice:271) — auto-fires and emits `tone:'heal'` with shield refill. High-Q perk (15s recharge accel) is **NOT** applied. |
| 4 | **Nano Swarm** | `hpBelowThreshold` | `ifUsed` | 60% | once per threshold-cross | ❌ **NOT WIRED** — no client logic consumes it on threshold. Registry says `repairTotalHp: 300` over 30s, but no code reads it. |
| 5 | **Adrenaline Shot** | `hpBelowThreshold` | `ifUsed` | 20% | once per threshold-cross | ❌ **NOT WIRED** — fires at 20% (lowest of the survival set). Registry says +DPS multiplier for 20s, but no code applies it. |
| 6 | (no other survival consumables in registry) | | | | | |

**Survival group summary:** Of 5 emergency-slot consumables, **2.5 are wired** (Med Kit + Shield Cell work; Med Kit Refined uses the same code path so it auto-fires but its unique high-Q effect doesn't). 2 (Nano Swarm, Adrenaline Shot) are completely dead. All 5 declare high-Q perk durations (9-30s) that the client never observes.

### AMMO (8) — slot: `ammo` — fires on shot intervals or phase breaks

| # | Consumable | Trigger | Policy | Frequency | Wire-up |
|---|---|---|---|---|---|
| 7 | **Ammo Pack** | `ammoInterval` | `perInterval` | every Nth shot, 600s window | ❌ NOT WIRED — neither trigger nor window consumed. Activity rule overrides: `roaming` keeps per-interval, `boss` becomes `onAttempt` at fight start. |
| 8 | **High-Capacity Ammo Pack** | `ammoInterval` | `perInterval` | every Nth shot, **1200s** window | ❌ NOT WIRED — same as Ammo Pack but 20-min window. |
| 9 | **Armor-Piercing Ammo** | `armorPhase` | `onTrigger` | once per armor-phase break | ❌ NOT WIRED — fires when the enemy armor actually takes damage (chef-side). |
| 10 | **Corrosive Ammo** | `armorPhase` | `onTrigger` | once per armor-phase break | ❌ NOT WIRED — registry says 10s armor-break extension at high-Q, not observed. |
| 11 | **Cryo Ammo** | `activityStart` | `onTrigger` | once per activity start | ❌ NOT WIRED — activity start is the roaming/boss/encounter init. |
| 12 | **Elemental Coating** | `manual` | `onAttempt` | 1 per attempt (boss only) | ❌ NOT WIRED — only active in `boss`, `auto_unequip` if no boss targeted. Manual trigger. |
| 13 | **Incendiary Ammo** | `activityStart` | `onTrigger` | once per activity start | ❌ NOT WIRED — registry says 6s burn persistence at high-Q, not observed. |
| 14 | **Shock Ammo** | `shieldPhase` | `onTrigger` | once per shield-phase break | ❌ NOT WIRED — fires when enemy shield is broken. |

**Ammo group summary:** All 8 are completely unwired in the client. The 5 with `onTrigger` policy are *chef-side* decisions (the chef runs the boss sim and applies the effect at the right tick). The 2 with `perInterval` (Ammo Pack, High-Capacity Ammo Pack) need a *client-side shot counter* that doesn't exist. The 1 manual (`Elemental Coating`) needs a player-tap flow that doesn't exist.

### TACTICAL (5) — slot: `tactical` (mostly) — fights start or boss mechanics

| # | Consumable | Trigger | Policy | Frequency | Wire-up |
|---|---|---|---|---|---|
| 15 | **Boss Scanner** | `fightStart` | `onAttempt` | 1 per attempt (boss only) | ❌ NOT WIRED — but a related 4-high-Q-perk behavior is in the boss sim. Registry declares 4 quality-gated perks; not surfaced to client. |
| 16 | **Jammer** | `bossMechanic` | `onTrigger` | when boss mechanic fires | ❌ NOT WIRED — chef-side, mid-fight, reactive to boss phase shifts. |
| 17 | **Signal Scrambler** | `activityStart` | `perInterval` | 600s window (roaming only) | ❌ NOT WIRED — same as Ammo Pack, 10-min coverage window. |
| 18 | **Target Painter** | `fightStart` | `onAttempt` | 1 per attempt (boss only) | ❌ NOT WIRED — boss-only, consumed at fight start. |
| 19 | (no other tactical consumables; there are 5 in the family) | | | | |

**Tactical group summary:** All 4 active-with-`fightStart` consumables are *chef-side* decisions (the chef knows the boss is starting). The chef's `executeBossAttempt` reads them from the request and applies them. None emit client-visible buff events.

### ORDNANCE (5) — slot: `ordnance` (boss only) — phase breaks

| # | Consumable | Trigger | Policy | Frequency | Wire-up |
|---|---|---|---|---|---|
| 20 | **Corrosive Charge** | `armorPhase` | `onTrigger` | once per armor break (boss only) | ❌ NOT WIRED — registry says 8s armor-break persistence at high-Q. |
| 21 | **EMP Charge** | `shieldPhase` | `onTrigger` | once per shield break (boss only) | ❌ NOT WIRED — chef-side mid-fight. |
| 22 | **Magnetized Payload** | `fightStart` | `onAttempt` | 1 per attempt (boss only) | ❌ NOT WIRED — boss-only, consumed at fight start. |
| 23 | **Ordnance Charge** (`Grenade`) | `shieldPhase` | `onAttempt` | 1 per attempt (boss only) | ❌ NOT WIRED — note: `onAttempt` not `onTrigger`, so it's consumed whether or not shield actually broke. |
| 24 | **Ordnance Charge** (`OrdnanceCharge`) | `shieldPhase` | `onAttempt` | 1 per attempt (boss only) | ❌ NOT WIRED — duplicate entry? Two registry keys, similar name. |
| 25 | **Phase Shift Grenade** | `armorPhase` | `onTrigger` | once per armor break (boss only) | ❌ NOT WIRED — chef-side mid-fight. |

**Ordnance group summary:** 6 entries in registry (one is a duplicate). All boss-only. All chef-side (no client signal). 2 declare durations at high-Q (8s Corrosive Charge, 6-10s for Incendiary Ammo/Corrosive Ammo).

### CORRUPTED (2) — slot: `tactical` / `ammo` (boss only) — fights start

| # | Consumable | Trigger | Policy | Frequency | Wire-up |
|---|---|---|---|---|---|
| 26 | **Overcharge Stim** | `fightStart` | `onAttempt` | 1 per attempt (boss only) | ❌ NOT WIRED — boss-only, consumed at fight start. |
| 27 | **Void Ammo** | `fightStart` | `onAttempt` | 1 per attempt (boss only) | ❌ NOT WIRED — boss-only, ammo slot, consumed at fight start. |

**Corrupted group summary:** Both are `fightStart + onAttempt` — they fire at the start of every boss attempt. No durations, no client events.

### ECONOMY (5) — slot: `utility` or `workshop` — various activities

| # | Consumable | Trigger | Policy | Frequency | Wire-up |
|---|---|---|---|---|---|
| 28 | **Data Skimmer** | `lootRoll` | `onVictory` | once per victory (boss only) | ❌ NOT WIRED — consumed only if the boss attempt ends in victory. |
| 29 | **Insurance Token** | `defeat` | `onDefeat` | once per defeat (boss only) | ❌ NOT WIRED — consumed only if the boss attempt ends in defeat. |
| 30 | **Loot Beacon** | `activityStart` | `perInterval` | 600s window (roaming only) | ❌ NOT WIRED — 10-min coverage window during roaming. High-Q perk adds `rarityBias: 0.05`. |
| 31 | **Luck Booster** | `lootRoll` | `onVictory` | once per victory (boss + roaming) | ❌ NOT WIRED — fires on every loot roll, consumed only on victory. |
| 32 | **Salvage Contract** | `scrapStart` | `onAttempt` | 1 per scrap attempt (scrapping only) | ❌ NOT WIRED — scrapping-activity only. |
| 33 | **Workshop Rush Ticket** | `craftStart` / `repairStart` | `onAttempt` | 1 per craft or repair | ❌ NOT WIRED — activity rule override: `crafting` triggers on `craftStart`, `repair` triggers on `repairStart`. |

**Economy group summary:** 6 entries. Three are boss-outcome-gated (`onVictory`/`onDefeat`). One is roaming-coverage (Loot Beacon). One is per-scrape. One is per-craft/repair. All 6 are chef-side decisions; none emit client events today.

---

## When does each one ACTUALLY fire today?

If I were a player right now, the consumables that **actually do something** are:

1. **Med Kit** — auto-eats when HP drops below 50% during roaming combat. One-shot heal. Consumes the Med Kit. ✅
2. **Med Kit (Refined)** — same path as Med Kit (auto-eats below 50%, consumes it). The 12s DoT cleanse from the high-Q perk is **not applied**. ⚠️
3. **Shield Cell** — auto-fires when shield drops below 25% during roaming combat. One-shot shield refill. Consumes the Shield Cell. ✅
4. **All other 26 consumables** — loadable into the loadout, visible in the ledger, but **the chef doesn't apply their effects client-visibly**. They're either chef-side only (no client event) or completely unwired. ❌

---

## What the chef *does* emit back to the client

The chef's boss attempt result includes:
- `consumablesUsed: Record<string, number>` — which consumables were consumed in the attempt (boss outcome)
- `consumablesLost: Record<string, number>` — same map, post-refund-chance

That's it. The chef doesn't emit per-buff events. It doesn't emit durations. It doesn't tell the client "Adrenaline Shot is firing for 20s starting now." It just returns the count of consumables used and lets the client decrement the inventory.

**The gap:** if a buff lasts 8 seconds, the chef applies its effects on ticks 1..N (up to 8 ticks later), but the client has no idea any buff is active between those ticks. The player sees "Adrenaline Shot x1 was used" in the post-fight summary, but never sees "Adrenaline Shot firing — 7s remaining" during the fight.

---

## What a player would *expect* to see

If a player loads Adrenaline Shot and starts a roaming run, they expect to see:
1. **"Loaded" state** — visible in the ConsumableLedger as "Emergency: Adrenaline Shot loaded." ✅ (current HUD)
2. **"Active" state** — at HP <20%, an in-flight indicator that says "Adrenaline Shot firing — 18s remaining" with a countdown bar. ❌ (does not exist)
3. **"Consumed" state** — after the duration expires, the slot goes back to "Empty" and a tick-feed toast says "Adrenaline Shot consumed." ❌ (no client event for end-of-buff; only the auto-eat path has a `'heal'` event)

If a player loads High-Capacity Ammo Pack, they expect to see:
1. **"Loaded" state** — visible in the ConsumableLedger as "Mid-Fight: High-Capacity Ammo Pack." ✅
2. **"Coverage" state** — a 20-minute countdown in the ledger showing "covering your next 19m 42s of roaming." ❌ (no coverage-window UI)
3. **"Ammo consumed" feedback** — every Nth shot, the player sees a "1 ammo pack used" toast and the coverage window ticks down. ❌ (no per-interval client signal)

If a player loads Signal Scrambler, they expect the same as Ammo Pack but 10 minutes for a *tactical* effect (incoming accuracy reduction).

---

## The summary table — when does each consumable actually fire today?

| Consumable | Family | Slot | Trigger | Policy | Active in | Frequency | Wire-up | Client visibility today |
|---|---|---|---|---|---|---|---|---|
| Med Kit | survival | emergency | hpBelowThreshold (50%) | ifUsed | roaming, boss | once per threshold-cross | ✅ FULL | `'heal'` event with heal amount |
| Med Kit (Refined) | survival | emergency | hpBelowThreshold (50%) | ifUsed | roaming, boss | once per threshold-cross | ⚠️ PARTIAL | `'heal'` event; high-Q 12s DoT cleanse not applied |
| Shield Cell | survival | emergency | shieldBelowThreshold (25%) | ifUsed | roaming, boss | once per threshold-cross | ✅ FULL | `'heal'` event with shield refill |
| Nano Swarm | survival | emergency | hpBelowThreshold (60%) | ifUsed | roaming, boss | once per threshold-cross | ❌ NONE | nothing — slot shows "loaded" only |
| Adrenaline Shot | survival | emergency | hpBelowThreshold (20%) | ifUsed | roaming, boss | once per threshold-cross | ❌ NONE | nothing — slot shows "loaded" only |
| Ammo Pack | ammo | ammo | ammoInterval (600s) | perInterval | roaming, boss | every Nth shot | ❌ NONE | nothing — chef-side decision only |
| High-Capacity Ammo Pack | ammo | ammo | ammoInterval (1200s) | perInterval | roaming, boss | every Nth shot | ❌ NONE | nothing — chef-side decision only |
| Armor-Piercing Ammo | ammo | ammo | armorPhase | onTrigger | roaming, boss | once per armor break | ❌ NONE | nothing — chef-side only |
| Corrosive Ammo | ammo | ammo | armorPhase | onTrigger | roaming, boss | once per armor break | ❌ NONE | nothing — chef-side only |
| Cryo Ammo | ammo | ammo | activityStart | onTrigger | roaming, boss | once per activity start | ❌ NONE | nothing — chef-side only |
| Elemental Coating | ammo | ammo | manual | onAttempt | boss | 1 per attempt | ❌ NONE | nothing — chef-side only |
| Incendiary Ammo | ammo | ammo | activityStart | onTrigger | roaming, boss | once per activity start | ❌ NONE | nothing — chef-side only |
| Shock Ammo | ammo | ammo | shieldPhase | onTrigger | roaming, boss | once per shield break | ❌ NONE | nothing — chef-side only |
| Overcharge Stim | corrupted | tactical | fightStart | onAttempt | boss | 1 per boss attempt | ❌ NONE | nothing — chef-side only |
| Void Ammo | corrupted | ammo | fightStart | onAttempt | boss | 1 per boss attempt | ❌ NONE | nothing — chef-side only |
| Data Skimmer | economy | utility | lootRoll | onVictory | boss | 1 per victory | ❌ NONE | nothing — chef-side only |
| Insurance Token | economy | utility | defeat | onDefeat | boss | 1 per defeat | ❌ NONE | nothing — chef-side only |
| Loot Beacon | economy | utility | activityStart | perInterval (600s) | roaming | 10-min window | ❌ NONE | nothing — chef-side only |
| Luck Booster | economy | utility | lootRoll | onVictory | boss, roaming | 1 per victory | ❌ NONE | nothing — chef-side only |
| Salvage Contract | economy | utility | scrapStart | onAttempt | scrapping | 1 per scrap | ❌ NONE | nothing — chef-side only |
| Workshop Rush Ticket | economy | workshop | craftStart / repairStart | onAttempt | crafting, repair | 1 per craft/repair | ❌ NONE | nothing — chef-side only |
| Corrosive Charge | ordnance | ordnance | armorPhase | onTrigger | boss | once per armor break | ❌ NONE | nothing — chef-side only |
| EMP Charge | ordnance | ordnance | shieldPhase | onTrigger | boss | once per shield break | ❌ NONE | nothing — chef-side only |
| Magnetized Payload | ordnance | ordnance | fightStart | onAttempt | boss | 1 per boss attempt | ❌ NONE | nothing — chef-side only |
| Ordnance Charge (Grenade) | ordnance | ordnance | shieldPhase | onAttempt | boss | 1 per attempt | ❌ NONE | nothing — chef-side only |
| Ordnance Charge (OrdnanceCharge) | ordnance | ordnance | shieldPhase | onAttempt | boss | 1 per attempt | ❌ NONE | nothing — chef-side only (possible duplicate entry) |
| Phase Shift Grenade | ordnance | ordnance | armorPhase | onTrigger | boss | once per armor break | ❌ NONE | nothing — chef-side only |
| Boss Scanner | tactical | tactical | fightStart | onAttempt | boss | 1 per attempt | ❌ NONE | nothing — chef-side only |
| Jammer | tactical | tactical | bossMechanic | onTrigger | boss | once per boss mechanic | ❌ NONE | nothing — chef-side only |
| Signal Scrambler | tactical | tactical | activityStart | perInterval (600s) | roaming | 10-min window | ❌ NONE | nothing — chef-side only |
| Target Painter | tactical | tactical | fightStart | onAttempt | boss | 1 per attempt | ❌ NONE | nothing — chef-side only |

---

## What this means for the active-buff PR

**The 5 burst-effect consumables (Med Kit, Med Kit Refined, Shield Cell, Nano Swarm, Adrenaline Shot) are the natural target for a Phase 1 client-side scaffold.** They're the only ones with the auto-eat client-side path today, and their high-Q perks are 6-30s — short enough to fit a "live timer pill" UX.

**The 26 other consumables are chef-side decisions.** The client never sees them fire because the chef applies the effect internally and never tells the client. To make them visible, the chef needs to emit per-buff events — that's a server-side PR, not a client-side one.

**The 4 long-coverage consumables (Ammo Pack, High-Capacity Ammo Pack, Signal Scrambler, Loot Beacon)** are a separate design problem — they have 600-1200s windows, not sub-30s bursts. They need a different visual (a wide coverage bar, not a per-second countdown pill) and a different trigger model (loadout-tracked, not event-tracked). Phase 3.
