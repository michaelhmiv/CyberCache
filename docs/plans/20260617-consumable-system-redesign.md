# Consumable System Redesign — Implementation Plan

## Problem

Consumables are designed for a one-shot boss sim model but the game is an idle ticker. Result:
- Ammo, ordnance, tactical, economy consumables never fire during roaming (90% of gameplay)
- NanoSwarm and AdrenalineShot are consumed but do nothing (computeHealAmount returns 0)
- All active buffs incorrectly show as DPS sources in the breakdown modal
- Med Kit uses reactive heal (action-game pattern) instead of proactive buffer (idle pattern)
- Redundant items (MedKit/Refined, AmmoPack/HighCap, Grenade/OrdnanceCharge) clutter the economy

## Design Principles

1. **High throughput** — consumables burn fast enough to keep the player market liquid
2. **Duration-based** — most consumables activate for X seconds, tick down, then are consumed
3. **Visible depletion** — ActiveBuffPills shows remaining time/charges for every active consumable
4. **One distinct role per item** — no two consumables do the same thing
5. **Player picks based on failure mode** — burst damage? sustained pressure? barely losing?

---

## Phase 1: Roaming Consumable Activation System

### New file: `src/lib/consumables/roamingConsumableEngine.ts`

The core engine that activates, ticks, and depletes consumables during roaming.

**Activation:** When roaming starts (activity.kind = roaming_loot), all 3 loaded consumable slots activate as duration-based buffs. Each gets an `expiresAt` timestamp.

**Per-tick processing:** Every 3-second tick, the engine:
1. Checks each active consumable — if `expiresAt <= now`, consume it (`player.removeConsumable`)
2. Applies the consumable's active effects to the tick calculations (DPS mod, loot mod, damage reduction, etc.)
3. Returns updated modifier map for the tick

**Reactive consumables** (Med Kit, Adrenaline Shot) don't activate on a timer — they watch for conditions:
- Med Kit: adds HP buffer on activation, depleted when buffer absorbed
- Adrenaline Shot: fires when HP < threshold, consumed after burst duration

### Data model

```ts
interface ActiveRoamingConsumable {
  consumableId: string;
  slot: ConsumableSlot;
  activatedAt: number;
  expiresAt: number;          // 0 for reactive (condition-based)
  remainingBuffer?: number;    // for Med Kit HP buffer
  consumed: boolean;
}
```

### Where it plugs in

```
idleTickerSlice.tickNow()
  ├── roamingConsumableEngine.activate(loadout.consumables)  // on roaming start
  ├── roamingConsumableEngine.tick(now)                      // every tick
  │     ├── expire depleted consumables → removeConsumable
  │     ├── return active modifier map
  │     └── handle reactive triggers (Med Kit buffer, Adrenaline)
  ├── applySurvivalTick(areaId, ticks, consumableMods)       // mods affect damage calc
  └── rollPreviewEvents(areaId, ticks, consumableMods)       // mods affect loot/credits
```

### Duration balance (for market liquidity)

| Consumable | Duration | Consumption rate |
|---|---|---|
| Ammo Pack | 10 min | ~6 per hour of roaming |
| Elemental ammo | 10 min | ~6 per hour |
| Med Kit | Until 150 dmg absorbed | ~3-5 per hour (depends on area) |
| Shield Cell | 3 min (resistance) | ~20 per hour |
| Nano Swarm | 5 min (regen) | ~12 per hour |
| Adrenaline Shot | 20s burst, one-shot | ~2-4 per hour (threshold-based) |
| Signal Scrambler | 10 min | ~6 per hour |
| Loot Beacon | 10 min | ~6 per hour |
| Luck Booster | 10 min | ~6 per hour |
| Salvage Contract | Per-salvage action | N/A (salvaging screen) |
| Workshop Rush | Per-craft action | N/A (workshop screen) |
| Ordnance | Per-elite encounter | ~3-5 per hour |

A player roaming for 1 hour with a full 3-slot loadout burns through **15-30 consumables**. That's the liquidity target.

---

## Phase 2: Survival Consumable Redesign

### Med Kit — HP Buffer (proactive)

**Activation:** On roaming start, adds `healHp` (150 base, quality-scaled) as a damage-absorbing buffer.

**Depletion:** Damage that would go to HP is absorbed by the buffer first (after shield). When buffer hits 0, Med Kit is consumed.

**Damage absorption order:** shield → med kit buffer → HP

**Display:** Shows as a third segment on the HP composition bar (chassis / shield / med kit buffer). In ActiveBuffPills, shows remaining buffer HP.

**Removes:** `autoEatThreshold` logic for Med Kit. No more reactive threshold — the buffer is proactive from the start.

**Cut:** Med Kit Refined — quality scaling on Med Kit handles the "stronger buffer" case.

### Shield Cell — Shield Restore + Temporary Resistance

**Activation:** On roaming start, immediately refills shield to full AND grants temporary damage resistance (`survivalMultiplier: 1.15` for 180s).

**Depletion:** Timer expires after 180s (quality-scaled). Shield restore is instant; resistance fades.

**Display:** ActiveBuffPills shows countdown timer. Damage resistance visible as a mitigation modifier in the damage calc.

**Differentiation from Med Kit:** Med Kit adds more HP pool. Shield Cell reduces incoming damage. They address different failure modes — burst vs sustained pressure.

### Nano Swarm — HP Regen Per Tick

**Activation:** On roaming start, grants +10 HP/tick for 30 ticks (90 seconds at 3s/tick = 300 HP total).

**Depletion:** Tick counter exhausts after 30 ticks. Quality scales total HP and/or tick count.

**Display:** ActiveBuffPills shows remaining ticks. Each tick's heal shows in the tick feed as a heal event.

**Differentiation:** Med Kit is a one-time buffer. Nano Swarm is slow trickle healing. If you're taking steady small hits, Nano Swarm's total healing (300) exceeds Med Kit's buffer (150) — but it can't save you from burst.

### Adrenaline Shot — Emergency DPS Burst (reactive)

**Activation:** Does NOT activate on roaming start. Watches for `playerHp / maxHp < 0.2` (the threshold from the consumable def).

**When triggered:** +10% DPS for 20 seconds. No heal. Consumed after the burst.

**Depletion:** Timer expires after 20s. One-shot — consumed on trigger.

**Display:** ActiveBuffPills shows "ARMED" while waiting, then shows active burst with countdown when triggered.

**Differentiation:** This is the gamble consumable. You're barely losing — the DPS burst might flip the fight. It doesn't help you survive longer, it helps you kill faster. If you were going to die anyway, this is your Hail Mary.

**Fix:** `computeHealAmount()` currently returns 0 for Adrenaline. The new engine bypasses `computeHealAmount` entirely — Adrenaline is a DPS modifier, not a heal.

---

## Phase 3: Ammo/Ordnance/Tactical/Economy — Duration Buffs

All non-survival consumables become duration-based passive modifiers during roaming.

### Activation

On roaming start, each loaded consumable in PreFight/MidFight/Emergency slots activates for its `ammoCoveredSeconds` duration (from `runtime.baseEffects`). The engine reads the effect fields and produces a modifier map:

```ts
interface RoamingConsumableMods {
  dpsMultiplier: number;          // multiplicative (e.g., 1.05 for Ammo Pack)
  shieldBreakMultiplier: number;  // for elemental ammo (not relevant in roaming, but stored)
  armorBreakMultiplier: number;
  survivalMultiplier: number;     // damage resistance
  incomingDpsMultiplier: number;  // Cryo Ammo: reduce incoming damage
  incomingAccuracyMultiplier: number; // Signal Scrambler
  bonusLootChance: number;        // Luck Booster, Loot Beacon
  extraLootRollChance: number;    // Data Skimmer
  scrapYieldMod: number;          // Salvage Contract
  rareDropChanceMod: number;      // various
  eventChanceBonus: number;       // Loot Beacon
  enemyPressureMultiplier: number; // Loot Beacon drawback
  xpBoostMod: number;             // future
}
```

### How mods apply to tick calculations

| Mod | Where it applies in the tick |
|---|---|
| `dpsMultiplier` | `loadoutEffectiveDps()` result — multiplies player DPS before kill cycle |
| `survivalMultiplier` | `loadoutSurvivalStats()` — multiplies maxHp |
| `incomingDpsMultiplier` | `computeMonsterDamageVsHunter()` — multiplies monster attackPower |
| `incomingAccuracyMultiplier` | `computeMonsterDamageVsHunter()` — multiplies monster accuracy |
| `bonusLootChance` | `DROP_CHANCE` in rollPreviewEvents — increases gear drop probability |
| `extraLootRollChance` | Adds bonus roll after kill cycle victory |
| `scrapYieldMod` | Multiplies scrapPerTick |
| `rareDropChanceMod` | Biases gear rarity rolls |
| `eventChanceBonus` | Increases elite/cache event chance |
| `enemyPressureMultiplier` | Increases monster attackPower (Loot Beacon drawback) |
| `xpBoostMod` | Multiplies xpPerTick |

### Ordnance during roaming

Ordnance consumables (Ordnance Charge, EMP Charge, etc.) are boss-phase tools that don't have a direct roaming equivalent. For roaming, they activate as a flat damage burst against elite encounters:

- When an elite monster spawns (rare event), ordnance auto-fires
- Applies `shieldBreakMultiplier` / `armorBreakMultiplier` as bonus damage
- Consumed after one elite encounter
- If no elite spawns during the duration, not consumed (refunded)

This gives ordnance a roaming purpose without making it overpowered.

### Economy consumables (onVictory/onDefeat trigger)

These stay as one-shot triggers but now also fire during roaming:

| Consumable | Roaming trigger | Effect |
|---|---|---|
| Insurance Token | Player dies during roaming | Reduces death fee |
| Data Skimmer | Elite kill during roaming | Chance for extra loot roll |
| Luck Booster | Active for duration | +25% bonus loot chance on all drops |
| Loot Beacon | Active for duration | +10% event chance, +5% enemy pressure |
| Salvage Contract | Per-salvage action | Already works (salvaging screen) |
| Workshop Rush | Per-craft action | Already works (workshop screen) |

---

## Phase 4: Fix the Display Bug

### Problem

`activeConsumableContribs` in `characterStats.ts` dumps ALL active buffs into both `dpsContribs` and `bossContribs` regardless of what the consumable actually does.

### Fix

Replace the blanket splat with per-effect-type routing:

```ts
// Instead of:
...activeConsumableContribs.filter((entry) => entry.value !== 0),

// Route by what the consumable actually affects:
...activeConsumableContribs
  .filter((c) => c.consumableFamily === 'ammo' || c.consumableFamily === 'corrupted')
  .filter((entry) => entry.value !== 0),
// Only DPS-affecting consumables show as DPS sources
```

This requires adding `consumableFamily` to the `ActiveBuff` type or looking it up from `CONSUMABLES[buff.consumableId].family` at contribution-build time.

### Routing table

| Contribution goes to... | Consumable families |
|---|---|
| `dpsContribs` | ammo, corrupted (VoidAmmo, OverchargeStim) |
| `bossContribs` | ammo, corrupted, tactical (TargetPainter, OverchargeStim) |
| Health/HP metrics | survival (Med Kit buffer, Shield Cell, Nano Swarm) |
| Rare find / loot metrics | economy (Luck Booster, Loot Beacon, Data Skimmer) |
| Scrap metrics | economy (Salvage Contract) |
| Nothing (don't show as a stat source) | tactical intel (Boss Scanner), economy insurance (Insurance Token) |

---

## Phase 5: Cut Redundant Items

| Cut | Reason | Migration |
|---|---|---|
| MedKitRefined | Quality scaling on MedKit handles stronger buffers | Convert existing inventory to MedKit with quality bonus |
| HighCapacityAmmoPack | Quality scaling on AmmoPack handles duration | Convert existing inventory to AmmoPack |
| Grenade (legacy ID) | Duplicate of OrdnanceCharge | Already has legacy compat, just stop generating |
| ElementalCoating | Already marked legacy, not vendor-stocked | Already deprecated, just remove from CONSUMABLES |

**31 → 27 consumables.** Each has a distinct mechanical purpose.

---

## Phase 6: ActiveBuffPills Enhancement

The existing `ActiveBuffPills` component already shows active consumable buffs. Enhancements:

1. **Duration countdown** — show remaining time (e.g., "8:34") on each pill
2. **Med Kit buffer** — show remaining buffer HP instead of a timer
3. **Adrenaline Shot** — show "ARMED" state while waiting, then "ACTIVE 18s" when triggered
4. **Charge counter** — for ordnance (1 charge remaining) and Data Skimmer (1 roll pending)
5. **Pulse animation** — when a consumable is about to expire (< 30s remaining), pulse the pill

---

## File Change Summary

| File | Action | Changes |
|---|---|---|
| `src/lib/consumables/roamingConsumableEngine.ts` | **Create** | Activation, per-tick processing, depletion, modifier map |
| `src/lib/combat/damageContract.ts` | **Modify** | Add med kit buffer to damage absorption order; add incomingDpsMultiplier and incomingAccuracyMultiplier to `computeMonsterDamageVsHunter` |
| `src/lib/combat/loadoutSurvival.ts` | **Modify** | Apply consumable survival mods (survivalMultiplier, resistance) to stats |
| `src/lib/combat/bossTick.ts` | **Modify** | Replace medkit auto-eat with buffer model |
| `src/store/slices/idleTickerSlice.ts` | **Modify** | Wire roamingConsumableEngine into tick loop; apply consumable mods to preview events and Chef claim |
| `src/store/slices/survivalSlice.ts` | **Modify** | Add medKitBuffer field; update applyDamage to absorb from buffer |
| `src/lib/stats/characterStats.ts` | **Modify** | Route consumable contributions by family instead of blanket splat |
| `src/lib/buffs/consumableModsAdapter.ts` | **Modify** | Expand from 4 fields to full effect extraction |
| `src/constants/consumables.ts` | **Modify** | Remove 4 redundant items; update Med Kit/Shield Cell/Nano Swarm/Adrenaline models |
| `src/components/stats/ActiveBuffPills.tsx` | **Modify** | Add countdown timers, buffer display, armed/active states |
| `src/test/consumableEngine.test.ts` | **Create** | Test activation, tick-down, depletion, reactive triggers |
| `src/test/survivalBuffer.test.ts` | **Create** | Test Med Kit buffer absorption order |

---

## Implementation Order

1. **Phase 5** (cuts) — simplest, reduces scope for everything else
2. **Phase 2** (survival redesign) — changes the data model, needed before engine
3. **Phase 1** (roaming engine) — the core activation/tick/depletion loop
4. **Phase 3** (ammo/ordnance/tactical/economy) — wire into the engine
5. **Phase 4** (display fix) — route contributions correctly
6. **Phase 6** (ActiveBuffPills) — UI enhancement, lowest risk

---

## Expected Outcome

- **Market liquidity:** 15-30 consumables consumed per hour of roaming
- **Clear depletion:** every consumable shows remaining time/buffer/charges in ActiveBuffPills
- **Distinct roles:** each consumable addresses a specific failure mode
- **No dead consumables:** everything fires during roaming, nothing consumed without effect
- **Correct display:** Med Kit no longer shows as a DPS source
